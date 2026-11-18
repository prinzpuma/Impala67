//! Fehlertolerante Suche (wie `web/search-fuzzy.js`): findet Seiten trotz Tippfehlern,
//! „ae“ statt „ä“, „f“ statt „ph“ und halb getippter Wörter.
//!
//! Reihenfolgen (Wortschatz, Seiten je Wort, Wortformen) folgen den JS-`Map`/`Set`s:
//! Einfügereihenfolge, ein entferntes und neu eingefügtes Element rückt ans Ende. Davon
//! hängt die Reihenfolge gleich bewerteter Treffer ab.

use unicode_normalization::UnicodeNormalization;

use crate::text::{FxMap, FxSet, is_word_char, lower};

/// Schreibweisen angleichen (Suchwort und Seitentext laufen beide hier durch).
pub fn fold(s: &str) -> String {
    let mut s = if s.is_ascii() {
        s.to_ascii_lowercase() // Schnellweg: ohne Umlaute und Akzente
    } else {
        let s = lower(s).replace('ä', "ae").replace('ö', "oe").replace('ü', "ue").replace('ß', "ss");
        s.nfd().filter(|c| !('\u{300}'..='\u{36f}').contains(c)).collect()
    };
    if s.contains("ph") {
        s = s.replace("ph", "f");
    }
    if s.contains("th") {
        s = s.replace("th", "t");
    }
    s
}

/// Wortformen (klein) → gefaltete Form, jede Form einmal, in Textreihenfolge.
fn words(text: &str) -> Vec<(String, String)> {
    let lc = lower(text);
    let mut out: Vec<(String, String)> = Vec::new();
    let mut seen: FxSet<&str> = Default::default();
    for form in lc.split(|c: char| !is_word_char(c)) {
        if crate::text::utf16_len(form) >= 2 && seen.insert(form) {
            out.push((form.to_owned(), fold(form)));
        }
    }
    out
}

/// Editierdistanz mit Vertauschung (OSA) zwischen `a` und den ersten `b_len` Einheiten von `b`
/// (UTF-16 wie `charCodeAt`); bricht mit `max + 1` ab, sobald sie sicher darüber liegt.
pub fn typo_distance(a: &[u16], b: &[u16], max: usize, b_len: usize) -> usize {
    let b = &b[..b_len.min(b.len())];
    if a.len().abs_diff(b.len()) > max {
        return max + 1;
    }
    let w = b.len() + 1;
    // Drei Zeilen in einem Puffer, für übliche Wortlängen auf dem Stack.
    let mut stack = [0usize; 3 * 48];
    let mut heap = Vec::new();
    let buf: &mut [usize] = if 3 * w <= stack.len() {
        &mut stack[..3 * w]
    } else {
        heap.resize(3 * w, 0);
        &mut heap
    };
    let (mut prev2, mut prev, mut cur) = (0, w, 2 * w);
    for j in 0..w {
        buf[prev + j] = j;
    }
    for i in 1..=a.len() {
        let ai = a[i - 1];
        buf[cur] = i;
        let mut row_min = i;
        for j in 1..w {
            let bj = b[j - 1];
            let mut v = buf[prev + j - 1] + usize::from(ai != bj);
            v = v.min(buf[prev + j] + 1).min(buf[cur + j - 1] + 1);
            if i > 1 && j > 1 && ai == b[j - 2] && a[i - 2] == bj {
                v = v.min(buf[prev2 + j - 2] + 1);
            }
            buf[cur + j] = v;
            row_min = row_min.min(v);
        }
        if row_min > max {
            return max + 1;
        }
        (prev2, prev, cur) = (prev, cur, prev2);
    }
    buf[prev + b.len()]
}

/// Bequem für Rust-Aufrufer: Distanz zweier Zeichenketten.
pub fn typo_distance_str(a: &str, b: &str, max: usize) -> usize {
    let (a, b): (Vec<u16>, Vec<u16>) = (a.encode_utf16().collect(), b.encode_utf16().collect());
    typo_distance(&a, &b, max, b.len())
}

/// Trefferqualität eines Suchworts für ein Wort des Wortschatzes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Quality {
    None = 0,
    Typo = 1,
    Prefix = 2,
    Exact = 3,
}

fn quality(term: &[u16], word: &[u16]) -> Quality {
    if word == term {
        return Quality::Exact;
    }
    if word.starts_with(term) {
        return Quality::Prefix;
    }
    let max = match term.len() {
        8.. => 2,
        4.. => 1,
        _ => return Quality::None,
    };
    if typo_distance(term, word, max, word.len()) <= max {
        return Quality::Typo;
    }
    // Wort wird noch getippt: Tippfehler im Anfang („fotosint“ → „fotosintese“).
    if term.len() >= 5 && word.len() > term.len() && typo_distance(term, word, max, term.len()) <= max {
        return Quality::Typo;
    }
    Quality::None
}

/// Treffer: Seite, Punktzahl (Summe der besten Qualität je Suchwort), getroffene Wortformen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FuzzyHit {
    pub id: String,
    pub score: u32,
    pub forms: Vec<String>,
}

struct Word {
    key: Vec<u16>,
    /// Seiten in Einfügereihenfolge.
    pages: Vec<u32>,
    /// Wortformen in Einfügereihenfolge (bleiben, solange das Wort existiert).
    forms: Vec<String>,
}

/// Wortindex über alle Seiten.
#[derive(Default)]
pub struct FuzzyIndex {
    /// Wörter in Einfügereihenfolge; `None` = entfernt.
    words: Vec<Option<Word>>,
    slot_of: FxMap<String, usize>,
    page_ids: Vec<String>,
    page_of: FxMap<String, u32>,
    /// Gefaltete Wörter je Seite.
    page_keys: Vec<Vec<String>>,
    live: usize,
}

impl FuzzyIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Text einer Seite (neu) aufnehmen.
    pub fn set_page(&mut self, id: &str, text: &str) {
        let page = match self.page_of.get(id) {
            Some(&p) => p,
            None => {
                let p = self.page_ids.len() as u32;
                self.page_ids.push(id.to_owned());
                self.page_of.insert(id.to_owned(), p);
                self.page_keys.push(Vec::new());
                p
            }
        };
        for key in std::mem::take(&mut self.page_keys[page as usize]) {
            let Some(&slot) = self.slot_of.get(&key) else { continue };
            let Some(word) = self.words[slot].as_mut() else { continue };
            if let Some(at) = word.pages.iter().position(|&p| p == page) {
                word.pages.remove(at);
                if word.pages.is_empty() {
                    self.words[slot] = None;
                    self.slot_of.remove(&key);
                    self.live -= 1;
                }
            }
        }
        let mut keys: Vec<String> = Vec::new();
        let mut seen: FxSet<String> = Default::default();
        for (form, key) in words(text) {
            let slot = match self.slot_of.get(&key) {
                Some(&s) => s,
                None => {
                    self.words.push(Some(Word {
                        key: key.encode_utf16().collect(),
                        pages: Vec::new(),
                        forms: Vec::new(),
                    }));
                    self.slot_of.insert(key.clone(), self.words.len() - 1);
                    self.live += 1;
                    self.words.len() - 1
                }
            };
            let word = self.words[slot].as_mut().expect("Slot lebt");
            // Innerhalb eines Aufrufs kann die Seite nur zuletzt eingetragen sein (alte Einträge sind entfernt).
            if word.pages.last() != Some(&page) {
                word.pages.push(page);
            }
            if !word.forms.contains(&form) {
                word.forms.push(form);
            }
            if seen.insert(key.clone()) {
                keys.push(key);
            }
        }
        self.page_keys[page as usize] = keys;
        self.compact_if_sparse();
    }

    /// Entfernte Slots aufräumen, wenn sie überwiegen (Reihenfolge bleibt).
    fn compact_if_sparse(&mut self) {
        if self.words.len() < 1024 || self.live * 2 > self.words.len() {
            return;
        }
        self.words.retain(Option::is_some);
        self.slot_of.clear();
        for (i, w) in self.words.iter().enumerate() {
            if let Some(w) = w {
                self.slot_of.insert(String::from_utf16_lossy(&w.key), i);
            }
        }
    }

    /// Sucht Suchwörter (≥ 3 Zeichen nach dem Falten) auf erlaubten Seiten (`allow`, z. B. ohne
    /// Archiv): zuerst streng als UND (alle Wörter müssen vorkommen); bleibt das bei mehreren
    /// Suchwörtern leer, greift ein Teil-Treffer-Fallback nach Anzahl getroffener Wörter.
    pub fn search(&self, query: &str, allow: impl Fn(&str) -> bool) -> Vec<FuzzyHit> {
        let mut terms: Vec<Vec<u16>> = Vec::new();
        for (_, key) in words(query) {
            let t: Vec<u16> = key.encode_utf16().collect();
            if t.len() >= 3 && !terms.contains(&t) {
                terms.push(t);
            }
        }
        if terms.is_empty() {
            return Vec::new();
        }
        struct Hit<'a> {
            q: Quality,
            score: u32,
            forms: Vec<&'a str>,
        }
        let mut hits: Option<(Vec<u32>, FxMap<u32, Hit>)> = None;
        for term in &terms {
            let mut order: Vec<u32> = Vec::new();
            let mut next: FxMap<u32, Hit> = FxMap::default();
            for word in self.words.iter().flatten() {
                let q = quality(term, &word.key);
                if q == Quality::None {
                    continue;
                }
                for &page in &word.pages {
                    let ok = match &hits {
                        Some((_, h)) => h.contains_key(&page),
                        None => allow(&self.page_ids[page as usize]),
                    };
                    if !ok {
                        continue;
                    }
                    let h = next.entry(page).or_insert_with(|| {
                        order.push(page);
                        Hit { q: Quality::None, score: 0, forms: Vec::new() }
                    });
                    h.q = h.q.max(q);
                    h.forms.extend(word.forms.iter().map(String::as_str));
                }
            }
            for page in &order {
                let prev = hits.as_mut().and_then(|(_, h)| h.remove(page));
                let h = next.get_mut(page).expect("in order");
                h.score = prev.as_ref().map_or(0, |p| p.score) + h.q as u32;
                if let Some(p) = prev {
                    h.forms.extend(p.forms);
                }
            }
            if order.is_empty() {
                hits = None;
                break;
            }
            hits = Some((order, next));
        }
        if let Some((order, mut hits)) = hits {
            return order
                .into_iter()
                .map(|page| {
                    let h = hits.remove(&page).expect("in order");
                    FuzzyHit {
                        id: self.page_ids[page as usize].clone(),
                        score: h.score,
                        forms: dedup_forms(h.forms),
                    }
                })
                .collect();
        }
        if terms.len() >= 2 { self.search_partial(&terms, &allow) } else { Vec::new() }
    }

    /// Teil-Treffer-Fallback bei Mehrfachbegriffen ohne Voll-UND: zählt getroffene Suchwörter
    /// je Seite und verwirft 1-Wort-Rauschen, sobald mindestens eine Seite ≥ 2 Wörter trifft.
    fn search_partial(&self, terms: &[Vec<u16>], allow: &impl Fn(&str) -> bool) -> Vec<FuzzyHit> {
        struct Partial<'a> {
            matched: u32,
            quality: u32,
            forms: Vec<&'a str>,
        }
        let mut order: Vec<u32> = Vec::new();
        let mut acc: FxMap<u32, Partial> = FxMap::default();
        for term in terms {
            let mut term_order: Vec<u32> = Vec::new();
            let mut term_hits: FxMap<u32, (Quality, Vec<&str>)> = FxMap::default();
            for word in self.words.iter().flatten() {
                let q = quality(term, &word.key);
                if q == Quality::None {
                    continue;
                }
                for &page in &word.pages {
                    let known = term_hits.contains_key(&page) || acc.contains_key(&page);
                    if !known && !allow(&self.page_ids[page as usize]) {
                        continue;
                    }
                    let entry = term_hits.entry(page).or_insert_with(|| {
                        term_order.push(page);
                        (Quality::None, Vec::new())
                    });
                    entry.0 = entry.0.max(q);
                    entry.1.extend(word.forms.iter().map(String::as_str));
                }
            }
            for page in term_order {
                let (q, forms) = term_hits.remove(&page).expect("in term_order");
                let p = acc.entry(page).or_insert_with(|| {
                    order.push(page);
                    Partial { matched: 0, quality: 0, forms: Vec::new() }
                });
                p.matched += 1;
                p.quality += q as u32;
                p.forms.extend(forms);
            }
        }
        if order.is_empty() {
            return Vec::new();
        }
        let max_matched = acc.values().map(|p| p.matched).max().unwrap_or(0);
        let min_matched = if max_matched >= 2 { 2 } else { 1 };
        let mut out: Vec<FuzzyHit> = order
            .into_iter()
            .filter_map(|page| {
                let p = acc.remove(&page).expect("in order");
                (p.matched >= min_matched).then(|| FuzzyHit {
                    id: self.page_ids[page as usize].clone(),
                    score: p.matched * 20 + p.quality,
                    forms: dedup_forms(p.forms),
                })
            })
            .collect();
        out.sort_by_key(|a| std::cmp::Reverse(a.score));
        out
    }
}

fn dedup_forms(raw: Vec<&str>) -> Vec<String> {
    let mut forms = Vec::new();
    for f in raw {
        if !forms.iter().any(|x| x == f) {
            forms.push(f.to_owned());
        }
    }
    forms
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folding() {
        assert_eq!(fold("Größe Photosynthese Thema"), "groesse fotosyntese tema");
        assert_eq!(fold("Café naïve"), "cafe naive");
    }

    #[test]
    fn distances() {
        assert_eq!(typo_distance_str("fotosintese", "fotosyntese", 2), 1);
        assert_eq!(typo_distance_str("ab", "ba", 1), 1);
        assert_eq!(typo_distance_str("abc", "xyz", 1), 2);
        assert_eq!(typo_distance_str("", "abc", 3), 3);
    }

    #[test]
    fn and_search_with_order() {
        let mut ix = FuzzyIndex::new();
        ix.set_page("a", "Photosynthese in Pflanzen");
        ix.set_page("b", "Fotosynthese und Zellatmung");
        ix.set_page("c", "Zellatmung");
        let hits = ix.search("fotosintese", |_| true);
        assert_eq!(hits.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(hits[0].forms, vec!["photosynthese", "fotosynthese"]); // Formen hängen am gefalteten Wort
        let both = ix.search("fotosynthese zellatmung", |_| true);
        assert_eq!(
            both,
            vec![FuzzyHit {
                id: "b".into(),
                score: 6,
                forms: vec!["zellatmung".into(), "photosynthese".into(), "fotosynthese".into()]
            }]
        );
        assert!(ix.search("fotosynthese", |id| id == "c").is_empty());
        ix.set_page("b", "leer");
        assert_eq!(ix.search("zellatmung", |_| true).len(), 1);
    }

    #[test]
    fn partial_fallback_when_and_empty() {
        let mut ix = FuzzyIndex::new();
        ix.set_page("a", "Dioden Kennlinie");
        ix.set_page("b", "Praktikum Dioden Abgabe");
        ix.set_page("c", "Praktikum Schwingkreis");
        ix.set_page("d", "Dioden Praktikum Kennlinie");

        // Bestehende UND-Suche liefert nur Voll-UND ("b" hat nicht "Kennlinie", wird nicht ergänzt).
        let exact = ix.search("dioden kennlinie", |_| true);
        assert_eq!(exact.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), vec!["a", "d"]);

        // 3-Wort-Suche ohne Voll-UND: nur ≥2-Wort-Treffer, keine 1-Wort-Treffer ("c" fehlt).
        let partial = ix.search("praktikum dioden abgabe fehlen", |_| true);
        let ids: Vec<&str> = partial.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids[0], "b");
        assert!(!ids.contains(&"c"));
        assert!(ids.contains(&"d"));

        // 2-Wort-Suche mit max. 1 Treffer liefert die 1-Wort-Treffer.
        let one = ix.search("schwingkreis unbekannt", |_| true);
        assert_eq!(one.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), vec!["c"]);
    }
}
