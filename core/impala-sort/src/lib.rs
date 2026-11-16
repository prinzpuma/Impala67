//! Stabiles Sortieren mit EINER Maschinencode-Instanz.
//!
//! `slice::sort_by` erzeugt je Elementtyp und Vergleichsfunktion eine eigene Kopie der ganzen
//! Sortiermaschine (≈ 4 KB WASM je Aufrufstelle, im Kern zusammen ≈ 250 KB). Hier sortiert eine
//! nicht generische Routine nur Indizes; je Aufrufstelle bleiben der Vergleich und das Umordnen.
//!
//! Ergebnis wie `sort_by` (stabil). Kurze und vorsortierte Listen sind so schnell wie mit
//! `sort_by`; große zufällige Listen dauern etwa viermal so lang (Messung: `examples/bench.rs`).
//! Wo eine solche Liste in einem heißen Pfad sortiert wird, bleibt `sort_by` stehen.

use std::cmp::Ordering;

/// Ersatz für `sort`, `sort_by` und `sort_by_key` (auch für die `unstable`-Fassungen: stabil ist
/// dort ein gültiges Ergebnis).
pub trait SortExt<T> {
    fn sort_small_by(&mut self, cmp: impl FnMut(&T, &T) -> Ordering);

    fn sort_small_by_key<K: Ord>(&mut self, key: impl FnMut(&T) -> K);

    fn sort_small(&mut self)
    where
        T: Ord;
}

impl<T> SortExt<T> for [T] {
    fn sort_small_by(&mut self, mut cmp: impl FnMut(&T, &T) -> Ordering) {
        if self.len() <= INSERTION_MAX {
            // Kurze Listen direkt durch Einfügen, ohne Hilfsspeicher.
            for i in 1..self.len() {
                let mut at = i;
                while at > 0 && cmp(&self[at - 1], &self[at]) == Ordering::Greater {
                    self.swap(at - 1, at);
                    at -= 1;
                }
            }
            return;
        }
        // Schon sortiert (Event-Log, gespeicherte Listen): ein Durchlauf ohne Hilfsspeicher.
        if self.windows(2).all(|w| cmp(&w[0], &w[1]) != Ordering::Greater) {
            return;
        }
        let mut order = sorted_order(self.len(), &mut |a, b| cmp(&self[a], &self[b]) == Ordering::Greater);
        // `order[k]` = bisherige Position des Elements, das an Stelle `k` gehört: Zyklen ablaufen.
        for start in 0..order.len() {
            let mut at = start;
            while order[at] != start {
                let from = order[at];
                self.swap(at, from);
                order[at] = at;
                at = from;
            }
            order[at] = at;
        }
    }

    fn sort_small_by_key<K: Ord>(&mut self, mut key: impl FnMut(&T) -> K) {
        self.sort_small_by(|a, b| key(a).cmp(&key(b)));
    }

    fn sort_small(&mut self)
    where
        T: Ord,
    {
        self.sort_small_by(T::cmp);
    }
}

/// Bis zu dieser Länge wird durch Einfügen sortiert.
const INSERTION_MAX: usize = 16;

/// Indizes `0..n` stabil sortiert; `greater(a, b)`: Element `a` gehört hinter Element `b`.
/// Natürliches Mergesort: aufsteigende Läufe finden, benachbarte paarweise mischen.
#[inline(never)]
fn sorted_order(n: usize, greater: &mut dyn FnMut(usize, usize) -> bool) -> Vec<usize> {
    let mut order: Vec<usize> = (0..n).collect();
    // Anfänge der Läufe, dahinter `n` als Ende.
    let mut runs = vec![0];
    for i in 1..n {
        if greater(i - 1, i) {
            runs.push(i);
        }
    }
    runs.push(n);
    let mut left = Vec::new();
    while runs.len() > 2 {
        let mut merged = 0;
        for r in (0..runs.len() - 1).step_by(2) {
            if let Some(&end) = runs.get(r + 2) {
                merge(&mut order, runs[r], runs[r + 1], end, &mut left, greater);
            }
            runs[merged] = runs[r];
            merged += 1;
        }
        runs[merged] = n;
        runs.truncate(merged + 1);
    }
    order
}

/// Mischt die sortierten Abschnitte `lo..mid` und `mid..hi`; bei Gleichstand gewinnt links.
fn merge(
    order: &mut [usize],
    lo: usize,
    mid: usize,
    hi: usize,
    left: &mut Vec<usize>,
    greater: &mut dyn FnMut(usize, usize) -> bool,
) {
    left.clear();
    left.extend_from_slice(&order[lo..mid]);
    let (mut l, mut r, mut out) = (0, mid, lo);
    while l < left.len() && r < hi {
        if greater(left[l], order[r]) {
            order[out] = order[r];
            r += 1;
        } else {
            order[out] = left[l];
            l += 1;
        }
        out += 1;
    }
    let rest = left.len() - l;
    order[out..out + rest].copy_from_slice(&left[l..]);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kleiner fester Zufallsgenerator (xorshift).
    fn rng(seed: u64) -> impl FnMut() -> u64 {
        let mut x = seed | 1;
        move || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x
        }
    }

    #[test]
    fn matches_std_stable_sort() {
        let mut next = rng(42);
        for n in [0, 1, 2, 3, 7, 16, 17, 100, 1000] {
            for keys in [1, 3, 50, 1 << 30] {
                // (Schlüssel, Ursprungsposition): Gleiche Schlüssel zeigen die Stabilität.
                let v: Vec<(u64, usize)> = (0..n).map(|i| (next() % keys, i)).collect();
                let mut want = v.clone();
                want.sort_by_key(|x| x.0);
                let mut got = v.clone();
                got.sort_small_by(|a, b| a.0.cmp(&b.0));
                assert_eq!(got, want, "n={n} keys={keys}");
                let mut got = v.clone();
                got.sort_small_by_key(|x| x.0);
                assert_eq!(got, want);
            }
        }
    }

    #[test]
    fn sorted_and_reversed_inputs() {
        let mut calls = 0;
        let mut v: Vec<u32> = (0..1000).collect();
        v.sort_small_by(|a, b| {
            calls += 1;
            a.cmp(b)
        });
        assert_eq!(calls, 999, "vorsortiert: ein Durchlauf");
        assert!(v.iter().copied().eq(0..1000));
        v.reverse();
        v.sort_small();
        assert!(v.iter().copied().eq(0..1000));
        let mut words = vec!["b".to_owned(), "a".to_owned(), "c".to_owned(), "a".to_owned()];
        words.sort_small();
        assert_eq!(words, ["a", "a", "b", "c"]);
    }
}
