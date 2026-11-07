//! Einstellungssuche (nach Vorbild von `web/settings-schema.js: searchSettings`).
//! Sucht über normalisierte Stichwörter, IDs und Bereichs-IDs.
//! Formatierte UI-Texte (Labels, Beschreibungen, Icons) verbleiben in der jeweiligen App.

use unicode_normalization::UnicodeNormalization;

use crate::settings_catalog::DEFAULT_CATALOG;

/// Normalisierung wie `normalize` in `settings-schema.js`:
/// Kleinbuchstaben, diakritische Zeichen (NFD) entfernen, Zeichen außerhalb von [a-z0-9] zu Leerzeichen, getrimmt.
pub fn normalize_settings_text(value: &str) -> String {
    let lower = value.to_lowercase();
    let nfd: String = lower.nfd().filter(|&c| !('\u{300}'..='\u{36f}').contains(&c)).collect();
    let mut out = String::with_capacity(nfd.len());
    let mut last_space = true;
    for c in nfd.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            last_space = false;
        } else if !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

/// Suchtreffer einer Einstellung.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SettingsHit {
    pub id: String,
    pub section: String,
    pub score: u32,
}

/// Definition eines Eintrags im Einstellungsindex.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SettingsItemDef {
    pub id: String,
    pub section: String,
    pub platform: Option<String>,
    pub title: String,
    pub haystack: String,
}

/// Suchindex für Einstellungen.
#[derive(Debug, Clone, Default)]
pub struct SettingsIndex {
    items: Vec<SettingsItemDef>,
}

impl SettingsIndex {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_items(items: Vec<SettingsItemDef>) -> Self {
        Self { items }
    }

    /// Standard-Katalog aller 40 Einstellungs-Punkte der Impala67-Architektur.
    pub fn default_catalog() -> Self {
        let items = DEFAULT_CATALOG
            .iter()
            .map(|&(id, section, platform, title, haystack)| SettingsItemDef {
                id: id.to_owned(),
                section: section.to_owned(),
                platform: platform.map(str::to_owned),
                title: title.to_owned(),
                haystack: haystack.to_owned(),
            })
            .collect();
        Self { items }
    }

    pub fn add(&mut self, item: SettingsItemDef) {
        self.items.push(item);
    }

    /// Sucht Einstellungen nach `query`. `platform`: optionaler Filter ("web" oder "native"; None = alle).
    pub fn search(&self, query: &str, limit: usize, platform: Option<&str>) -> Vec<SettingsHit> {
        let norm_q = normalize_settings_text(query);
        let terms: Vec<&str> = norm_q.split_whitespace().collect();
        if terms.is_empty() {
            return Vec::new();
        }

        let mut hits: Vec<(SettingsHit, String)> = Vec::new();
        for item in &self.items {
            if let Some(plat) = &item.platform
                && let Some(req_plat) = platform
                && plat != req_plat
            {
                continue;
            }

            if !terms.iter().all(|&t| item.haystack.contains(t)) {
                continue;
            }

            let mut score = 0u32;
            for &term in &terms {
                if item.title.starts_with(term) {
                    score += 4;
                } else if item.title.contains(term) {
                    score += 2;
                } else {
                    score += 1;
                }
            }

            hits.push((SettingsHit { id: item.id.clone(), section: item.section.clone(), score }, item.title.clone()));
        }

        hits.sort_by(|a, b| b.0.score.cmp(&a.0.score).then_with(|| a.1.cmp(&b.1)));
        hits.truncate(limit);
        hits.into_iter().map(|(h, _)| h).collect()
    }
}
