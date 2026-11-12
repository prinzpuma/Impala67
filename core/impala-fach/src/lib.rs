//! Fach-Erkennung wie `web/fach.js` der PWA: aus Fachfeld, Tags, Elternseiten, Titel, Unterseiten,
//! Fließtext und Workspace-Namen; dazu Stapel und Karten. Reine Funktionen über [`Pages`].
//!
//! Nicht hier: die Embedding-Einordnung der PWA (Modell nötig). Sie liefert nur dann etwas, wenn
//! alle Regeln hier nichts finden; ohne sie bleibt es bei „Sonstiges“.

mod text;

use std::sync::OnceLock;

use serde::Deserialize;

pub use text::sanitize;
use text::{Terms, overview_word, tag_value, utf16_prefix};

/// Kein Fach, sondern Kategorie: nicht eindeutig zuzuordnen.
pub const DEFAULT_SUBJECT: &str = "Sonstiges";
/// Sammelseite (Semester, gemischte Fächer): Unterseiten haben eigene Fächer.
pub const OVERVIEW_SUBJECT: &str = "Übersicht";

#[derive(Deserialize)]
struct Definition {
    name: String,
    aliases: Vec<String>,
    keywords: Vec<String>,
}

struct Rule {
    name: String,
    aliases: Option<Terms>,
    keywords: Option<Terms>,
}

struct Catalog {
    rules: Vec<Rule>,
    /// Kleingeschriebener Name oder Alias → Fach (Soforttreffer).
    exact: Vec<(String, usize)>,
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let defs: Vec<Definition> = serde_json::from_str(include_str!("subjects.json")).unwrap_or_default();
        let mut exact: Vec<(String, usize)> = Vec::new();
        let mut put = |key: String, i: usize| match exact.iter_mut().find(|(k, _)| *k == key) {
            Some(e) => e.1 = i,
            None => exact.push((key, i)),
        };
        let index = |name: &str| defs.iter().position(|d| d.name == name);
        for (key, name) in [("info", "Informatik"), ("et", "Elektrotechnik")] {
            if let Some(i) = index(name) {
                put(key.into(), i);
            }
        }
        for (i, d) in defs.iter().enumerate() {
            put(d.name.to_lowercase(), i);
            for a in &d.aliases {
                put(a.to_lowercase(), i);
            }
        }
        let rules = defs
            .iter()
            .map(|d| Rule {
                name: d.name.clone(),
                // „art“ nicht als Kunst werten („eine Art …“).
                aliases: Terms::new(d.aliases.iter().filter(|a| !(d.name == "Kunst" && a.as_str() == "art"))),
                keywords: Terms::new(&d.keywords),
            })
            .collect();
        Catalog { rules, exact }
    })
}

/// Die echten Fächer in Katalog-Reihenfolge (ohne „Übersicht“ und „Sonstiges“).
pub fn known_subjects() -> Vec<&'static str> {
    catalog().rules.iter().map(|r| r.name.as_str()).collect()
}

fn is_known(name: &str) -> bool {
    catalog().rules.iter().any(|r| r.name == name)
}

/// Punkte je Fach, absteigend (bei Gleichstand Katalog-Reihenfolge).
fn rank(text: &str, alias_weight: usize, keyword_weight: usize) -> Vec<(usize, &'static str)> {
    let chars: Vec<char> = text.chars().collect();
    let mut ranked: Vec<(usize, &'static str)> = catalog()
        .rules
        .iter()
        .filter_map(|r| {
            let score = r.aliases.as_ref().map_or(0, |t| t.count(&chars)) * alias_weight
                + r.keywords.as_ref().map_or(0, |t| t.count(&chars)) * keyword_weight;
            (score > 0).then_some((score, r.name.as_str()))
        })
        .collect();
    ranked.sort_by_key(|&(score, _)| std::cmp::Reverse(score));
    ranked
}

/// Nur eindeutig: genug Punkte und mindestens doppelt so viele wie das zweitbeste Fach.
fn clear_winner(ranked: &[(usize, &'static str)], min_score: usize) -> Option<&'static str> {
    let &(best, name) = ranked.first()?;
    if best < min_score {
        return None;
    }
    ranked.get(1).is_none_or(|&(second, _)| best >= 2 * second).then_some(name)
}

/// Fach aus Titel, Tag oder Stapelname: ein Name oder ein eindeutiger Fachbegriff genügt.
pub fn resolve_subject(text: &str) -> Option<&'static str> {
    let clean = sanitize(text);
    if clean.is_empty() {
        return None;
    }
    let lower = clean.to_lowercase();
    if let Some((_, i)) = catalog().exact.iter().find(|(k, _)| *k == lower) {
        return Some(catalog().rules[*i].name.as_str());
    }
    clear_winner(&rank(&clean, 4, 2), 2)
}

/// Fließtext: mindestens drei Fachbegriffe (oder Name und Begriffe) mit klarem Vorsprung.
fn content_subject(content: &str) -> Option<&'static str> {
    if content.is_empty() {
        return None;
    }
    clear_winner(&rank(utf16_prefix(content, 3000), 3, 2), 6)
}

/// Nennt der Titel mehrere Fächer beim Namen („ET × Mathe × Physik“)?
fn names_several(text: &str) -> bool {
    let chars: Vec<char> = sanitize(text).chars().collect();
    catalog().rules.iter().filter(|r| r.aliases.as_ref().is_some_and(|t| t.count(&chars) > 0)).count() >= 2
}

/// Sammelseite am Titel: „Semester 3“, „Übersicht“, „Stundenplan“ … oder mehrere Fachnamen.
pub fn is_overview_title(title: &str) -> bool {
    let chars: Vec<char> = sanitize(title).chars().collect();
    overview_word(&chars) || names_several(title)
}

/// Ausdrücklich gesetzter Wert (Fachfeld, Tag) mit „Übersicht“/„Sonstiges“ samt Schreibvarianten.
fn resolve_explicit(value: &str) -> Option<&'static str> {
    let lower = sanitize(value).to_lowercase();
    if lower.is_empty() {
        return None;
    }
    if lower == OVERVIEW_SUBJECT.to_lowercase() || lower == "uebersicht" {
        return Some(OVERVIEW_SUBJECT);
    }
    if lower == DEFAULT_SUBJECT.to_lowercase() || lower == "allgemein" {
        return Some(DEFAULT_SUBJECT);
    }
    resolve_subject(value)
}

/// Gespeicherter Wert in Anzeigeform (`FACH.clean`): bekanntes Fach oder „Sonstiges“.
pub fn clean(value: &str) -> &'static str {
    resolve_explicit(value).unwrap_or(DEFAULT_SUBJECT)
}

/// Woher ein Fach kommt (`source` der PWA).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// Fachfeld oder Tag der Seite selbst.
    Manual,
    /// Von der nächsten Elternseite mit festgelegtem Fach.
    Inherited,
    /// Aus dem eigenen Titel.
    Title,
    /// Aus dem Titel einer Elternseite.
    PageRoot,
    /// Sammelseite.
    Overview,
    /// Klare Mehrheit der Unterseiten.
    Children,
    /// Aus dem Fließtext.
    Content,
    /// Aus dem Namen des Workspace.
    Workspace,
    /// Aus dem Stapelnamen.
    DeckRoot,
    /// Nichts gefunden.
    Fallback,
}

impl Source {
    /// Name wie in der PWA (gespeichert z. B. in `subjectSource` der Lernzeit).
    pub fn as_str(self) -> &'static str {
        match self {
            Source::Manual => "manual",
            Source::Inherited => "inherited",
            Source::Title => "title",
            Source::PageRoot => "page-root",
            Source::Overview => "overview",
            Source::Children => "children",
            Source::Content => "content",
            Source::Workspace => "workspace",
            Source::DeckRoot => "deck-root",
            Source::Fallback => "fallback",
        }
    }
}

/// Ergebnis: Fachname und Herkunft.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Subject {
    pub name: &'static str,
    pub source: Source,
}

const FALLBACK: Subject = Subject { name: DEFAULT_SUBJECT, source: Source::Fallback };

/// Was die Erkennung von einer Seite braucht.
#[derive(Debug, Clone, Default)]
pub struct PageFacts {
    pub id: String,
    pub title: String,
    pub content: String,
    /// Fachfeld (`subject`), schon als Text.
    pub subject: Option<String>,
    pub tags: Vec<String>,
    pub parent: Option<String>,
    /// Workspace-ID (leer = `default`).
    pub workspace: String,
    pub trashed: bool,
}

/// Zugriff auf die Seiten (Datenmodell).
pub trait Pages {
    fn page(&self, id: &str) -> Option<PageFacts>;
    /// Direkte Unterseiten samt Papierkorb (`childPagesOf`).
    fn children(&self, id: &str) -> Vec<PageFacts>;
    fn workspace_name(&self, id: &str) -> Option<String>;
}

/// Fachfeld oder Tags („fach: Mathe“, „Biologie“) der Seite selbst.
fn explicit(page: &PageFacts) -> Option<&'static str> {
    if let Some(s) = page.subject.as_deref().filter(|s| !s.is_empty()).and_then(resolve_explicit) {
        return Some(s);
    }
    page.tags.iter().find_map(|raw| match tag_value(&sanitize(raw)) {
        Some(value) => resolve_explicit(&value),
        None => resolve_subject(raw),
    })
}

/// Seitenkette von der obersten Seite bis zur Seite selbst (Zyklen enden).
fn lineage(pages: &impl Pages, page: &PageFacts) -> Vec<PageFacts> {
    let mut chain = vec![page.clone()];
    let mut seen = vec![page.id.clone()];
    let mut parent = page.parent.clone().filter(|p| !p.is_empty());
    while let Some(id) = parent {
        if seen.contains(&id) {
            break;
        }
        let Some(p) = pages.page(&id) else { break };
        seen.push(id);
        parent = p.parent.clone().filter(|p| !p.is_empty());
        chain.insert(0, p);
    }
    chain
}

/// Fach einer Seite nur aus ihr selbst – für die Abstimmung der Unterseiten.
fn intrinsic(page: &PageFacts) -> Option<&'static str> {
    match explicit(page) {
        Some(s) => is_known(s).then_some(s),
        None if is_overview_title(&page.title) => None,
        None => resolve_subject(&page.title).or_else(|| content_subject(&page.content)),
    }
}

/// Unterseiten stimmen ab: klare Mehrheit (≥ 2/3) → ihr Fach, gemischt → Übersicht.
fn children_vote(pages: &impl Pages, page: &PageFacts) -> Option<Subject> {
    let mut votes: Vec<(&'static str, usize)> = Vec::new();
    let mut n = 0;
    for child in pages.children(&page.id).iter().filter(|c| !c.trashed) {
        let Some(s) = intrinsic(child) else { continue };
        n += 1;
        match votes.iter_mut().find(|(name, _)| *name == s) {
            Some(v) => v.1 += 1,
            None => votes.push((s, 1)),
        }
    }
    if n < 2 {
        return None;
    }
    // Bei Gleichstand das zuerst gezählte Fach (stabile Sortierung der PWA).
    let (top, count) = votes.iter().fold(votes[0], |best, &v| if v.1 > best.1 { v } else { best });
    Some(if count * 3 >= n * 2 {
        Subject { name: top, source: Source::Children }
    } else {
        Subject { name: OVERVIEW_SUBJECT, source: Source::Overview }
    })
}

/// Fach einer Seite (`FACH.page`). Reihenfolge = Verlässlichkeit: Die Ordnerstruktur schlägt den
/// eigenen Titel („Funktionen“ im Ordner „Informatik 1“ ist Informatik, nicht Mathematik).
pub fn page_subject(pages: &impl Pages, page: &PageFacts) -> Subject {
    if let Some(name) = explicit(page) {
        return Subject { name, source: Source::Manual };
    }
    let chain = lineage(pages, page);
    let ancestors = &chain[..chain.len() - 1];
    if let Some(name) = ancestors.iter().rev().filter_map(explicit).find(|&s| s != OVERVIEW_SUBJECT) {
        return Subject { name, source: Source::Inherited };
    }
    for (i, node) in chain.iter().enumerate() {
        if is_overview_title(&node.title) {
            continue;
        }
        if let Some(name) = resolve_subject(&node.title) {
            let source = if i == chain.len() - 1 { Source::Title } else { Source::PageRoot };
            return Subject { name, source };
        }
    }
    if is_overview_title(&page.title) {
        return Subject { name: OVERVIEW_SUBJECT, source: Source::Overview };
    }
    if let Some(vote) = children_vote(pages, page) {
        return vote;
    }
    if let Some(name) = content_subject(&page.content) {
        return Subject { name, source: Source::Content };
    }
    let ws = if page.workspace.is_empty() { "default" } else { page.workspace.as_str() };
    if let Some(name) = pages.workspace_name(ws).and_then(|n| resolve_subject(&n)) {
        return Subject { name, source: Source::Workspace };
    }
    FALLBACK
}

/// Fach eines Stapels: der erste Pfadteil („Mathematik::Analysis“) mit Fach, sonst der ganze Name.
pub fn deck_subject(deck: &str) -> Subject {
    let raw = sanitize(deck);
    if raw.is_empty() {
        return FALLBACK;
    }
    raw.split("::")
        .map(|p| p.trim_matches(text::is_js_space))
        .filter(|p| !p.is_empty())
        .find_map(resolve_subject)
        .or_else(|| resolve_subject(&raw))
        .map_or(FALLBACK, |name| Subject { name, source: Source::DeckRoot })
}

/// Fach einer Karte: Stapel vor Seite; findet keiner etwas, das Ergebnis der Seite (falls vorhanden).
pub fn card_subject(pages: &impl Pages, deck: &str, page_id: Option<&str>) -> Subject {
    let by_deck = deck_subject(deck);
    if by_deck.source != Source::Fallback {
        return by_deck;
    }
    match page_id.filter(|id| !id.is_empty()).and_then(|id| pages.page(id)) {
        Some(p) => page_subject(pages, &p),
        None => by_deck,
    }
}
