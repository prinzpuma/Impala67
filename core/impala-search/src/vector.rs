//! Vektor-Mathe – die einzige Implementierung für RAG, verwandte Seiten, Fach-Erkennung
//! (`fach.js`) und Wissensgraph (`graph.js`, `graph-worker.js`).
//!
//! Wie in `rag-ranking.js`: `dot` rechnet über die kürzere Länge, `norm` liefert für den
//! Nullvektor 1 (Kosinus mit einem Nullvektor ist damit 0 statt NaN).
//! Die Vektorsuche nimmt eine flache Zeilen-Matrix (`&[f32]`, `n × dim`) – ein Aufruf über
//! die WASM-Grenze statt eines Aufrufs je Vektor.

/// Fehler bei falsch geformten Eingaben der Vektorsuche.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VectorError {
    /// Dimension 0 oder Matrix-Länge kein Vielfaches der Dimension.
    BadShape { len: usize, dim: usize },
    /// Anfrage-Vektor hat eine andere Dimension als die Matrix.
    DimMismatch { query: usize, dim: usize },
}

impl std::fmt::Display for VectorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadShape { len, dim } => write!(f, "Matrix mit {len} Werten passt nicht zu Dimension {dim}"),
            Self::DimMismatch { query, dim } => write!(f, "Anfrage hat {query} statt {dim} Dimensionen"),
        }
    }
}

impl std::error::Error for VectorError {}

/// Skalarprodukt über die gemeinsame Länge. Acht unabhängige Summen, damit der Compiler
/// die Schleife vektorisiert (SIMD nativ wie in WASM).
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let (a, b) = (&a[..n], &b[..n]);
    let mut acc = [0f32; 8];
    let (ca, cb) = (a.chunks_exact(8), b.chunks_exact(8));
    let (ra, rb) = (ca.remainder(), cb.remainder());
    for (x, y) in ca.zip(cb) {
        for i in 0..8 {
            acc[i] += x[i] * y[i];
        }
    }
    let mut s = (acc[0] + acc[4]) + (acc[1] + acc[5]) + (acc[2] + acc[6]) + (acc[3] + acc[7]);
    for (x, y) in ra.iter().zip(rb) {
        s += x * y;
    }
    s
}

/// Betrag; 1 für den Nullvektor (wie `norm` in `rag-ranking.js`).
pub fn norm(v: &[f32]) -> f32 {
    let n = dot(v, v).sqrt();
    if n > 0.0 { n } else { 1.0 }
}

/// Kosinus-Ähnlichkeit.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    dot(a, b) / (norm(a) * norm(b))
}

/// Auf Länge 1 gebracht (Nullvektor bleibt null).
pub fn normalized(v: &[f32]) -> Vec<f32> {
    let n = norm(v);
    v.iter().map(|x| x / n).collect()
}

/// Richtung des Mittelwerts mehrerer Vektoren gleicher Dimension: jeder zählt mit Länge 1,
/// das Ergebnis ist normiert („Seitenvektor“ für verwandte Seiten). `None`, wenn nichts übrig
/// bleibt oder sich alles aufhebt.
pub fn mean_direction<'a>(vecs: impl IntoIterator<Item = &'a [f32]>, dim: usize) -> Option<Vec<f32>> {
    let mut sum = vec![0f32; dim];
    let mut any = false;
    for v in vecs {
        if v.len() != dim {
            continue;
        }
        let n = norm(v);
        for (s, x) in sum.iter_mut().zip(v) {
            *s += x / n;
        }
        any = true;
    }
    let n = dot(&sum, &sum).sqrt();
    if !any || n.is_nan() || n <= 0.0 {
        return None;
    }
    sum.iter_mut().for_each(|x| *x /= n);
    Some(sum)
}

/// Prüft die Form einer flachen Matrix; liefert die Zeilenzahl.
pub fn rows(matrix: &[f32], dim: usize) -> Result<usize, VectorError> {
    if dim == 0 || !matrix.len().is_multiple_of(dim) {
        return Err(VectorError::BadShape { len: matrix.len(), dim });
    }
    Ok(matrix.len() / dim)
}

/// Kosinus der Anfrage zu jeder Zeile. `norms` (optional) sind vorberechnete Zeilenbeträge.
pub fn cosine_scores(
    matrix: &[f32],
    dim: usize,
    query: &[f32],
    norms: Option<&[f32]>,
) -> Result<Vec<f32>, VectorError> {
    let n = rows(matrix, dim)?;
    if query.len() != dim {
        return Err(VectorError::DimMismatch { query: query.len(), dim });
    }
    let qn = norm(query);
    Ok(matrix
        .chunks_exact(dim)
        .enumerate()
        .take(n)
        .map(|(i, row)| {
            let rn = norms.and_then(|v| v.get(i)).copied().filter(|x| *x > 0.0).unwrap_or_else(|| norm(row));
            dot(query, row) / (qn * rn)
        })
        .collect())
}

/// Treffer der Vektorsuche: Zeilenindex und Kosinus.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scored {
    pub index: u32,
    pub score: f32,
}

/// Die `k` ähnlichsten Zeilen, absteigend; bei Gleichstand die kleinere Zeile zuerst.
pub fn top_k(matrix: &[f32], dim: usize, query: &[f32], k: usize) -> Result<Vec<Scored>, VectorError> {
    let scores = cosine_scores(matrix, dim, query, None)?;
    Ok(best_k(&scores, k))
}

/// Die `k` größten Werte (NaN zählt als kleinster), absteigend, stabil.
pub fn best_k(scores: &[f32], k: usize) -> Vec<Scored> {
    let key = |s: f32| if s.is_nan() { f32::NEG_INFINITY } else { s };
    let order = |a: &Scored, b: &Scored| key(b.score).total_cmp(&key(a.score)).then(a.index.cmp(&b.index));
    let mut all: Vec<Scored> = scores.iter().enumerate().map(|(i, &score)| Scored { index: i as u32, score }).collect();
    if k == 0 {
        return Vec::new();
    }
    if k < all.len() {
        all.select_nth_unstable_by(k - 1, order);
        all.truncate(k);
    }
    all.sort_by(order);
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn math_like_js() {
        assert_eq!(dot(&[1.0, 2.0, 3.0], &[4.0, 5.0]), 14.0);
        assert_eq!(norm(&[0.0, 0.0]), 1.0);
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 0.0]), 0.0);
        let long: Vec<f32> = (0..37).map(|i| i as f32).collect();
        assert_eq!(dot(&long, &long), (0..37).map(|i| (i * i) as f32).sum::<f32>());
        assert!((cosine(&[1.0, 1.0], &[1.0, 0.0]) - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
    }

    #[test]
    fn mean_direction_is_unit() {
        let a = [3.0, 0.0];
        let b = [0.0, 1.0];
        let m = mean_direction([&a[..], &b[..], &[1.0][..]], 2).unwrap();
        assert!((m[0] - m[1]).abs() < 1e-6 && (dot(&m, &m) - 1.0).abs() < 1e-6);
        assert_eq!(mean_direction([&[1.0, 0.0][..], &[-1.0, 0.0][..]], 2), None);
        assert_eq!(mean_direction([&[0.0, 0.0][..]], 2), None);
    }

    #[test]
    fn top_k_on_flat_matrix() {
        let m = [1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0];
        let hits = top_k(&m, 2, &[1.0, 0.1], 3).unwrap();
        assert_eq!(hits.iter().map(|h| h.index).collect::<Vec<_>>(), vec![0, 3, 2]);
        assert_eq!(top_k(&m, 3, &[1.0, 0.0, 0.0], 1), Err(VectorError::BadShape { len: 8, dim: 3 }));
        assert_eq!(top_k(&m, 2, &[1.0], 1), Err(VectorError::DimMismatch { query: 1, dim: 2 }));
        assert_eq!(best_k(&[f32::NAN, 0.5], 5).iter().map(|h| h.index).collect::<Vec<_>>(), vec![1, 0]);
    }
}
