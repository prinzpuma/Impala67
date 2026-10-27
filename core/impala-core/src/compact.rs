//! Kompaktierung des Event-Logs: verlustfrei und deterministisch (nur Weglassen), damit der
//! Log-Merge konsistent bleibt, auch wenn Geräte zu verschiedenen Zeitpunkten kompaktieren.
//!
//! Regeln (gleiches Verhalten wie `compactEvents` in `web/compact-events.js`):
//! 1. Patches (`pageUpdate`, `cardUpdate`, `settingsSet`) fallen weg, wenn neuere Patches
//!    desselben Ziels alle ihre Felder überschreiben. Die jüngsten
//!    [`KEEP_CONTENT_VERSIONS`] Inhalts-Stände je Seite bleiben immer (Seitenverlauf).
//! 2. Updates von Seiten/Karten fallen weg, wenn diese danach gelöscht wurden.
//! 3. UI-Zustand: vom Tab-Snapshot nur der jüngste, vom Seitenbaum der jüngste je Schlüssel.
//! 4. Chats/Tagesartikel sind Last-write-wins-Schnappschüsse: nur der Gewinner je Eintrag;
//!    von den Tagesartikeln nur die [`ARTICLE_KEEP`] neuesten.
//! 5. Bilder (`heftBlob`) bleiben nur, solange ein behaltenes Heft-Event sie referenziert.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};

use crate::event::{Body, Event, Patch, Snapshot};

pub const KEEP_CONTENT_VERSIONS: usize = 10;
pub const ARTICLE_KEEP: usize = 30;

/// Liefert die Indizes der behaltenen Events, in Log-Reihenfolge (nach `t`, dann `seq`).
pub fn compact(events: &[Event]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..events.len()).collect();
    order.sort_by(|&a, &b| js_cmp(&events[a].t, &events[b].t).then(events[a].seq.cmp(&events[b].seq)));

    let deleted = Deletions::of(events, &order);
    let snapshots = Snapshots::of(events, &order);
    let mut patches = Patches::default();
    let mut tabs_kept = false;
    let mut tree_keys = Set::default();

    let mut keep: Vec<usize> = Vec::with_capacity(order.len());
    for &i in order.iter().rev() {
        let ev = &events[i];
        let kept = match &ev.body {
            Body::UiTabsSet => !std::mem::replace(&mut tabs_kept, true),
            Body::UiTreeSet(key) => key.as_deref().is_some_and(|key| tree_keys.insert(key)),
            Body::ChatUpsert(Some(_)) => snapshots.is_winner(i),
            Body::HomeArticleUpsert(snapshot) => snapshot.is_some() && snapshots.is_kept_article(i),
            Body::PageUpdate(Some(u)) => {
                !deleted.page_after(&u.id, &ev.t)
                    && u.patch.as_ref().is_none_or(|p| patches.keeps(Target::Page(&u.id), p))
            }
            Body::CardUpdate(Some(u)) => {
                !deleted.card_after(&u.id, &ev.t)
                    && u.patch.as_ref().is_none_or(|p| patches.keeps(Target::Card(&u.id), p))
            }
            Body::SettingsSet(keys) => patches.keeps_keys(Target::Settings, keys, false),
            _ => true,
        };
        if kept {
            keep.push(i);
        }
    }
    keep.reverse();

    let used: Set<&str> = keep
        .iter()
        .filter_map(|&i| match &events[i].body {
            Body::HeftRefs(refs) => Some(refs.iter().map(String::as_str)),
            _ => None,
        })
        .flatten()
        .collect();
    keep.retain(|&i| match &events[i].body {
        Body::HeftBlob(hash) => hash.as_deref().is_some_and(|h| used.contains(h)),
        _ => true,
    });
    keep
}

/// Schneller, nicht kryptografischer Hash (FxHash): Schlüssel sind lokale IDs, kein Angriffsziel.
#[derive(Default)]
struct Fx(u64);

impl Hasher for Fx {
    fn write(&mut self, bytes: &[u8]) {
        for chunk in bytes.chunks(8) {
            let mut word = [0u8; 8];
            word[..chunk.len()].copy_from_slice(chunk);
            self.write_u64(u64::from_le_bytes(word));
        }
    }
    fn write_u64(&mut self, word: u64) {
        self.0 = (self.0.rotate_left(5) ^ word).wrapping_mul(0x517c_c1b7_2722_0a95);
    }
    fn write_u8(&mut self, b: u8) {
        self.write_u64(b.into());
    }
    fn write_usize(&mut self, n: usize) {
        self.write_u64(n as u64);
    }
    fn finish(&self) -> u64 {
        self.0
    }
}

type Map<K, V> = HashMap<K, V, BuildHasherDefault<Fx>>;
type Set<K> = HashSet<K, BuildHasherDefault<Fx>>;

/// Stringvergleich wie JS `<`: nach UTF-16-Codeeinheiten.
fn js_cmp(a: &str, b: &str) -> Ordering {
    if a.is_ascii() && b.is_ascii() {
        return a.cmp(b);
    }
    a.encode_utf16().cmp(b.encode_utf16())
}

/// Letzter Löschzeitpunkt je Seite/Karte (leer zählt nicht, wie in JS falsy).
#[derive(Default)]
struct Deletions<'a> {
    pages: Map<&'a str, &'a str>,
    cards: Map<&'a str, &'a str>,
}

impl<'a> Deletions<'a> {
    fn of(events: &'a [Event], order: &[usize]) -> Self {
        let mut d = Deletions::default();
        for &i in order {
            let ev = &events[i];
            match &ev.body {
                Body::PageDelete(Some(id)) => d.pages.insert(id, &ev.t),
                Body::CardDelete(Some(id)) => d.cards.insert(id, &ev.t),
                _ => None,
            };
        }
        d
    }

    fn page_after(&self, id: &str, t: &str) -> bool {
        Self::after(&self.pages, id, t)
    }

    fn card_after(&self, id: &str, t: &str) -> bool {
        Self::after(&self.cards, id, t)
    }

    fn after(map: &Map<&str, &str>, id: &str, t: &str) -> bool {
        map.get(id).is_some_and(|d| !d.is_empty() && js_cmp(t, d) != Ordering::Greater)
    }
}

/// Gewinner je Chat/Tagesartikel und welche Tagesartikel überhaupt bleiben.
struct Snapshots {
    /// je Event-Index: Gewinner seines Eintrags bzw. behaltener Tagesartikel
    winners: Vec<bool>,
    kept_articles: Vec<bool>,
}

impl Snapshots {
    fn of(events: &[Event], order: &[usize]) -> Self {
        // Schlüssel → (Event, updated); `slots` hält die Reihenfolge des ersten Auftretens.
        let mut slot_of: Map<(bool, &str), usize> = Map::default();
        let mut slots: Vec<(bool, usize, &str)> = Vec::new();
        for &i in order {
            let ev = &events[i];
            let (article, s): (bool, &Snapshot) = match &ev.body {
                Body::ChatUpsert(Some(s)) => (false, s),
                Body::HomeArticleUpsert(Some(s)) => (true, s),
                _ => continue,
            };
            let updated = if s.updated.is_empty() { ev.t.as_str() } else { s.updated.as_str() };
            match slot_of.get(&(article, s.id.as_str())) {
                // Gleichstand: das spätere Event gewinnt, wie beim Replay.
                Some(&slot) if js_cmp(updated, slots[slot].2) == Ordering::Less => {}
                Some(&slot) => slots[slot] = (article, i, updated),
                None => {
                    slot_of.insert((article, s.id.as_str()), slots.len());
                    slots.push((article, i, updated));
                }
            }
        }
        let created = |i: usize| match &events[i].body {
            Body::HomeArticleUpsert(Some(s)) => s.created.as_str(),
            _ => "",
        };
        let mut articles: Vec<usize> = slots.iter().filter(|s| s.0).map(|s| s.1).collect();
        articles.sort_by(|&a, &b| js_cmp(created(b), created(a)));
        articles.truncate(ARTICLE_KEEP);
        let mut winners = vec![false; events.len()];
        let mut kept_articles = vec![false; events.len()];
        slots.iter().for_each(|s| winners[s.1] = true);
        articles.into_iter().for_each(|i| kept_articles[i] = true);
        Snapshots { winners, kept_articles }
    }

    fn is_winner(&self, i: usize) -> bool {
        self.winners[i]
    }

    fn is_kept_article(&self, i: usize) -> bool {
        self.kept_articles[i]
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Target<'a> {
    Page(&'a str),
    Card(&'a str),
    Settings,
}

/// Rückwärts gesehene Patch-Felder je Ziel und gezählte Inhalts-Stände je Seite.
#[derive(Default)]
struct Patches<'a> {
    covered: Map<Target<'a>, Set<&'a str>>,
    content_kept: Map<&'a str, usize>,
}

impl<'a> Patches<'a> {
    fn keeps(&mut self, target: Target<'a>, patch: &'a Patch) -> bool {
        self.keeps_keys(target, &patch.keys, patch.has_content)
    }

    /// Ein Patch bleibt, wenn er mindestens ein noch nicht überschriebenes Feld setzt
    /// (oder ein geschützter Inhalts-Stand ist). Ein leerer Patch bleibt immer.
    fn keeps_keys(&mut self, target: Target<'a>, keys: &'a [String], has_content: bool) -> bool {
        let seen = self.covered.entry(target).or_default();
        let protected = match target {
            Target::Page(id) if has_content => {
                let n = self.content_kept.entry(id).or_default();
                *n < KEEP_CONTENT_VERSIONS && {
                    *n += 1;
                    true
                }
            }
            _ => false,
        };
        if !protected && !keys.is_empty() && keys.iter().all(|k| seen.contains(k.as_str())) {
            return false;
        }
        seen.extend(keys.iter().map(String::as_str));
        true
    }
}
