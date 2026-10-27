//! Drei-Wege-Abgleich von Seiteninhalten (`DB.merge3`): Zwei Fassungen werden gegen den letzten
//! gemeinsamen Stand verglichen. Hat nur eine Seite einen Abschnitt geändert, gilt diese Änderung;
//! haben beide ihn gleich geändert, einmal; unterschiedlich: echte Überlappung → kein Ergebnis,
//! der Aufrufer rettet den unterlegenen Stand als Konfliktkopie.

use crate::js;

/// Darüber lohnt die O(n·m)-Matrix nicht.
pub const MERGE_MAX_LINES: usize = 1200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Merge3 {
    /// Zusammengeführt; `changed`: Ergebnis weicht von der eigenen Fassung ab.
    Merged { text: String, changed: bool },
    /// Echte Überlappung (oder keine belastbare Basis).
    Conflict,
}

/// Längste gemeinsame Teilfolge als Indexpaare (A, B); gleicher Anfang/Ende ohne Matrix.
fn lcs_pairs(a: &[&str], b: &[&str]) -> Vec<(usize, usize)> {
    let mut pre = 0;
    while pre < a.len() && pre < b.len() && a[pre] == b[pre] {
        pre += 1;
    }
    let mut suf = 0;
    while suf < a.len() - pre && suf < b.len() - pre && a[a.len() - 1 - suf] == b[b.len() - 1 - suf] {
        suf += 1;
    }
    let (n, m) = (a.len() - pre - suf, b.len() - pre - suf);
    let w = m + 1;
    let mut dp = vec![0u32; (n + 1) * w];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i * w + j] = if a[pre + i] == b[pre + j] {
                dp[(i + 1) * w + j + 1] + 1
            } else {
                dp[(i + 1) * w + j].max(dp[i * w + j + 1])
            };
        }
    }
    let mut pairs: Vec<(usize, usize)> = (0..pre).map(|k| (k, k)).collect();
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if a[pre + i] == b[pre + j] {
            pairs.push((pre + i, pre + j));
            i += 1;
            j += 1;
        } else if dp[(i + 1) * w + j] >= dp[i * w + j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    pairs.extend((0..suf).map(|k| (pre + n + k, pre + m + k)));
    pairs
}

/// `merge3(base, mine, theirs)`.
pub fn merge3(base: &str, mine: &str, theirs: &str) -> Merge3 {
    if mine == theirs {
        return Merge3::Merged { text: mine.to_owned(), changed: false };
    }
    if mine == base {
        return Merge3::Merged { text: theirs.to_owned(), changed: true };
    }
    if theirs == base {
        return Merge3::Merged { text: mine.to_owned(), changed: false };
    }
    // Ohne belastbare Basis (leer) ankerte der Abgleich auf Leerzeilen und klebte beide
    // Fassungen still zusammen – lieber ehrlich Konflikt.
    if js::trim(base).is_empty() {
        return Merge3::Conflict;
    }
    let b: Vec<&str> = base.split('\n').collect();
    let m: Vec<&str> = mine.split('\n').collect();
    let t: Vec<&str> = theirs.split('\n').collect();
    if b.len() > MERGE_MAX_LINES || m.len() > MERGE_MAX_LINES || t.len() > MERGE_MAX_LINES {
        return Merge3::Conflict;
    }
    // Stabile Anker: Basiszeilen, die in BEIDEN Fassungen unverändert wiederkehren.
    let m_map: std::collections::HashMap<usize, usize> = lcs_pairs(&b, &m).into_iter().collect();
    let t_map: std::collections::HashMap<usize, usize> = lcs_pairs(&b, &t).into_iter().collect();
    let mut anchors = Vec::new();
    let (mut last_m, mut last_t): (Option<usize>, Option<usize>) = (None, None);
    for (bi, line) in b.iter().enumerate() {
        if js::trim(line).is_empty() {
            continue; // Leerzeilen stehen überall – als Anker wertlos
        }
        let (Some(&mi), Some(&ti)) = (m_map.get(&bi), t_map.get(&bi)) else { continue };
        if last_m.is_some_and(|l| mi <= l) || last_t.is_some_and(|l| ti <= l) {
            continue;
        }
        anchors.push((bi, mi, ti));
        last_m = Some(mi);
        last_t = Some(ti);
    }
    anchors.push((b.len(), m.len(), t.len()));
    let mut out: Vec<&str> = Vec::new();
    let (mut b0, mut m0, mut t0) = (0, 0, 0);
    for (b1, m1, t1) in anchors {
        let b_chunk = b[b0..b1].join("\n");
        let (m_chunk, t_chunk) = (&m[m0..m1], &t[t0..t1]);
        let (m_str, t_str) = (m_chunk.join("\n"), t_chunk.join("\n"));
        if m_str == t_str || t_str == b_chunk {
            out.extend_from_slice(m_chunk);
        } else if m_str == b_chunk {
            out.extend_from_slice(t_chunk);
        } else {
            return Merge3::Conflict;
        }
        if b1 < b.len() {
            out.push(b[b1]);
        }
        (b0, m0, t0) = (b1 + 1, m1 + 1, t1 + 1);
    }
    let text = out.join("\n");
    let changed = text != mine;
    Merge3::Merged { text, changed }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn getrennte_stellen_und_ueberlappung() {
        let base = "a\nb\nc\nd";
        assert_eq!(
            merge3(base, "A\nb\nc\nd", "a\nb\nc\nD"),
            Merge3::Merged { text: "A\nb\nc\nD".into(), changed: true }
        );
        assert_eq!(merge3(base, "X\nb\nc\nd", "Y\nb\nc\nd"), Merge3::Conflict);
        assert_eq!(merge3("", "x", "y"), Merge3::Conflict);
        assert_eq!(merge3("a", "a", "b"), Merge3::Merged { text: "b".into(), changed: true });
    }
}
