//! Sync-Konflikte: Liste offener Konflikte, Zeilenvergleich und Entscheidungen wie der
//! Konflikt-Dialog der PWA (`web/render.js`, `web/conflict-ui.js`), mit der Logik aus
//! `impala_model::conflict`.
//!
//! Der Import (auch der native Sync) merkt sich die gefundenen Konflikte mit Details in der
//! Datenbank (Meta `pendingConflicts`, in der PWA `impala67_pending_conflicts` im localStorage).
//! Dazu kommen gerettete Alt-Kopien (Seiten mit „⚠ Konflikt“-Titel) aus `legacy_conflict_items`.
//! Abweichung von der PWA: beide Quellen erscheinen zusammen (die PWA zeigt die Alt-Kopien nur, solange
//! die Liste leer ist), und Einträge, deren Kopie auf einem anderen Gerät schon erledigt wurde, fallen weg.

use std::collections::HashSet;

use impala_model::State;
use impala_model::conflict::{
    Conflict, ConflictKind, Resolution, ResolveError, Row, align_diff_rows, conflict_diff, legacy_conflict_items,
    merge_pending,
};
use impala_model::{Merge3, merge3};
use impala_storage::{Storage, Write};
use serde_json::Value;

use crate::{CoreError, ImpalaCore, Inner, invalid};

/// Meta-Schlüssel der offenen Konflikte.
const PENDING_KEY: &str = "pendingConflicts";
/// Mehr merkt sich die Liste nicht (älteste fallen weg).
const PENDING_MAX: usize = 200;
/// Titelanfang einer Konfliktkopie.
const COPY_PREFIX: &str = "⚠ Konflikt";

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ConflictType {
    /// Beide Seiten haben dieselbe Stelle geändert.
    Both,
    /// Auf einem Gerät endgültig gelöscht, auf dem anderen geändert oder verschoben.
    Delete,
    /// Gerettete Alt-Kopie ohne Details.
    Legacy,
}

/// Entscheidung für einen Konflikt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ConflictResolution {
    /// Den gewinnenden Stand behalten, die Kopie in den Papierkorb.
    KeepWinner,
    /// Den unterlegenen Stand übernehmen (bei Lösch-Konflikt: die Seite zurückholen).
    UseLoser,
    /// Beide behalten: die Kopie bleibt als eigene Seite „… (Kopie)“.
    KeepBoth,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ConflictSide {
    Local,
    Remote,
}

/// Eine angebotene Entscheidung.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct ConflictChoice {
    pub resolution: ConflictResolution,
    /// Der neuere Stand bzw. „Löschen gewinnt“.
    pub recommended: bool,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ConflictInfo {
    /// Schlüssel für `resolve_conflict` (ID der Konfliktkopie, sonst der Seite).
    pub key: String,
    pub kind: ConflictType,
    /// Titel ohne „⚠ Konflikt“-Präfix und Zeitstempel.
    pub title: String,
    /// Zeitpunkt für die Liste.
    pub time: Option<String>,
    /// Erklärung für den Dialog.
    pub reason: Option<String>,
    /// Die Seite, um die es geht (bei Alt-Kopien ohne Original: `None`).
    pub page_id: Option<String>,
    /// Die gerettete Kopie des unterlegenen Stands.
    pub copy_page_id: Option<String>,
    /// Wer gewonnen hat (nur bei `Both` und `Legacy`).
    pub winner: Option<ConflictSide>,
    /// Inhalt hier / auf dem anderen Gerät (für den Zeilenvergleich).
    pub local_content: Option<String>,
    pub remote_content: Option<String>,
    pub local_time: Option<String>,
    pub remote_time: Option<String>,
    /// Gelöscht am / geändert am (Lösch-Konflikt).
    pub deleted_at: Option<String>,
    pub changed_at: Option<String>,
    /// Alt-Kopie: Titel des Originals und Zeilen, die dort fehlen.
    pub original_title: Option<String>,
    pub extra_lines: Option<u32>,
    pub choices: Vec<ConflictChoice>,
    pub recommended: Option<ConflictResolution>,
}

/// Eine Zeile des zweispaltigen Vergleichs.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum DiffRow {
    Line {
        left: Option<String>,
        right: Option<String>,
        changed: bool,
        /// Beginn eines Änderungsblocks (Sprungziel „Nächste Änderung“).
        start: bool,
    },
    /// So viele unveränderte Zeilen sind eingeklappt.
    Gap { count: u64 },
}

/// Ergebnis von `resolve_conflicts_recommended`.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct BulkResolve {
    pub resolved: u64,
    /// Warum die Reihenfolge stehen blieb (der Rest ist unverändert).
    pub error: Option<String>,
}

fn resolution_of(r: Resolution) -> ConflictResolution {
    match r {
        Resolution::KeepWinner => ConflictResolution::KeepWinner,
        Resolution::UseLoser => ConflictResolution::UseLoser,
        Resolution::KeepBoth => ConflictResolution::KeepBoth,
    }
}

fn resolution_to(r: ConflictResolution) -> Resolution {
    match r {
        ConflictResolution::KeepWinner => Resolution::KeepWinner,
        ConflictResolution::UseLoser => Resolution::UseLoser,
        ConflictResolution::KeepBoth => Resolution::KeepBoth,
    }
}

fn info(c: &Conflict) -> ConflictInfo {
    let kind = match c.kind() {
        ConflictKind::Both => ConflictType::Both,
        ConflictKind::Delete => ConflictType::Delete,
        ConflictKind::Legacy => ConflictType::Legacy,
    };
    ConflictInfo {
        key: c.key(),
        kind,
        title: c.display_title(),
        time: c.time(),
        reason: c.reason.clone(),
        page_id: c.page_id.clone().filter(|p| !p.is_empty()),
        copy_page_id: c.conflict_page_id.clone().filter(|p| !p.is_empty()),
        winner: match (kind, c.winner.as_deref()) {
            (ConflictType::Delete, _) => None,
            (_, Some("remote")) => Some(ConflictSide::Remote),
            (_, Some("local")) => Some(ConflictSide::Local),
            _ => None,
        },
        local_content: c.local_content.clone(),
        remote_content: c.remote_content.clone(),
        local_time: c.local_time.clone(),
        remote_time: c.remote_time.clone(),
        deleted_at: c.deleted_at.clone(),
        changed_at: c.changed_at.clone(),
        original_title: c.original_title.clone(),
        extra_lines: c.extra_lines.map(|n| n.max(0.0) as u32),
        choices: c
            .choices()
            .into_iter()
            .map(|ch| ConflictChoice { resolution: resolution_of(ch.resolution), recommended: ch.recommended })
            .collect(),
        recommended: c.recommended().map(resolution_of),
    }
}

/// Die Kopie existiert noch als offene Konfliktseite? Sonst ist der Konflikt erledigt
/// (hier, auf einem anderen Gerät oder durch Löschen).
fn copy_is_open(state: &State, c: &Conflict) -> bool {
    match c.conflict_page_id.as_deref().filter(|id| !id.is_empty()) {
        Some(id) => state.pages.get(id).is_some_and(|p| !p.is_trashed() && p.title().starts_with(COPY_PREFIX)),
        None => true,
    }
}

impl Inner {
    fn pending_conflicts(&self) -> Vec<Conflict> {
        let raw = self.storage.meta(PENDING_KEY).ok().flatten();
        // Beschädigter Eintrag: leere Liste statt Fehler (die Alt-Kopien bleiben auffindbar).
        match raw.and_then(|r| serde_json::from_str::<Value>(&r).ok()) {
            Some(Value::Array(list)) => {
                list.into_iter().filter_map(|v| v.as_object().cloned()).map(Conflict::from_object).collect()
            }
            _ => Vec::new(),
        }
    }

    fn save_pending(&mut self, list: &[Conflict]) -> Result<(), CoreError> {
        let skip = list.len().saturating_sub(PENDING_MAX);
        let value = (!list.is_empty())
            .then(|| Value::Array(list[skip..].iter().map(|c| Value::Object(c.to_object())).collect()).to_string());
        self.storage.apply(vec![Write::SetMeta(PENDING_KEY.into(), value)])?;
        Ok(())
    }

    /// Vom Import gefundene Konflikte vormerken (`mergePendingConflicts`).
    pub(crate) fn remember_conflicts(&mut self, found: Vec<Conflict>) -> Result<(), CoreError> {
        if found.is_empty() {
            return Ok(());
        }
        let merged = merge_pending(self.pending_conflicts(), found);
        self.save_pending(&merged)
    }

    /// Offene Konflikte: vorgemerkte (mit fehlenden Texten aus dem Zustand ergänzt), dann gerettete
    /// Alt-Kopien, die dazu nicht schon gehören.
    fn open_conflicts(&self) -> Vec<Conflict> {
        let state = self.model.state();
        let mut list: Vec<Conflict> = self
            .pending_conflicts()
            .into_iter()
            .filter(|c| copy_is_open(state, c))
            .map(|c| c.with_texts_from(state))
            .collect();
        let known: HashSet<String> = list.iter().map(Conflict::key).collect();
        list.extend(legacy_conflict_items(state, &HashSet::new()).into_iter().filter(|c| !known.contains(&c.key())));
        list
    }

    fn resolve_conflict(&mut self, key: &str, how: ConflictResolution) -> Result<(), CoreError> {
        let how = resolution_to(how);
        let Some(conflict) = self.open_conflicts().into_iter().find(|c| c.key() == key) else {
            return Err(invalid(format!("Unbekannter Konflikt {key}")));
        };
        if !conflict.choices().iter().any(|ch| ch.resolution == how) {
            return Err(invalid("Diese Entscheidung gibt es für den Konflikt nicht"));
        }
        let events = conflict.resolve(self.model.state(), how).map_err(|e| match e {
            ResolveError::CopyMissing => invalid("Die gerettete Kopie fehlt. Es wurde nichts geändert."),
            ResolveError::LoserMissing => {
                invalid("Der andere Stand ist nicht mehr vorhanden. Es wurde nichts geändert.")
            }
        })?;
        for (kind, payload) in events {
            self.dispatch(&kind, payload)?;
        }
        // Quittieren: aus der Liste nehmen (sonst käme derselbe Dialog nach dem Neustart wieder).
        let rest: Vec<Conflict> = self.pending_conflicts().into_iter().filter(|c| c.key() != key).collect();
        self.save_pending(&rest)
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Offene Konflikte in Anzeigereihenfolge (ältere Vormerkungen zuerst).
    pub fn conflicts(&self) -> Vec<ConflictInfo> {
        self.lock().open_conflicts().iter().map(info).collect()
    }

    /// Zahl der offenen Konflikte (Hinweis-Zähler).
    pub fn conflict_count(&self) -> u32 {
        self.lock().open_conflicts().len() as u32
    }

    /// Einen Konflikt auflösen. `key` ist `ConflictInfo::key`; erlaubt sind die `choices`. Scheitert
    /// ohne Änderung, wenn Kopie oder Gegenstand fehlen.
    pub fn resolve_conflict(&self, key: String, resolution: ConflictResolution) -> Result<(), CoreError> {
        self.lock().resolve_conflict(&key, resolution)
    }

    /// „Alle Konflikte mit Empfehlung lösen“: wendet die Empfehlung an, wo es eine gibt (Alt-Kopien
    /// mit Verlustgefahr bleiben). Hält beim ersten Fehler an; `resolved` zählt bis dahin.
    pub fn resolve_conflicts_recommended(&self) -> BulkResolve {
        let mut inner = self.lock();
        let todo: Vec<(String, Resolution)> =
            inner.open_conflicts().iter().filter_map(|c| Some((c.key(), c.recommended()?))).collect();
        let mut resolved = 0;
        for (key, how) in todo {
            if let Err(e) = inner.resolve_conflict(&key, resolution_of(how)) {
                return BulkResolve { resolved, error: Some(e.to_string()) };
            }
            resolved += 1;
        }
        BulkResolve { resolved, error: None }
    }
}

/// Zweispaltiger Vergleich zweier Fassungen für den Konflikt-Dialog. `None`, wenn der abweichende
/// Mittelteil zu groß ist (dann beide Volltexte nebeneinander zeigen).
#[uniffi::export]
pub fn conflict_diff_rows(left: String, right: String) -> Option<Vec<DiffRow>> {
    let diff = conflict_diff(&left, &right)?;
    Some(
        align_diff_rows(&diff)
            .into_iter()
            .map(|row| match row {
                Row::Line { left, right, changed, start } => DiffRow::Line { left, right, changed, start },
                Row::Gap(n) => DiffRow::Gap { count: n as u64 },
            })
            .collect(),
    )
}

/// Drei-Wege-Abgleich eines Textes (`base` = gemeinsamer Stand): der zusammengeführte Text, oder
/// `None` bei Überlappung.
#[uniffi::export]
pub fn merge_texts(base: String, mine: String, theirs: String) -> Option<String> {
    match merge3(&base, &mine, &theirs) {
        Merge3::Merged { text, .. } => Some(text),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// Fremdes Event, das nach den lokalen entstand.
    fn remote_update(id: &str, page: &str, content: &str, t: &str) -> Value {
        json!({ "id": id, "t": t, "type": "pageUpdate", "payload": { "id": page, "patch": { "content": content } } })
    }

    #[test]
    fn import_konflikt_und_aufloesen() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let p = core.create_page("Notiz".into(), String::new(), None, None).unwrap();
        core.update_page(p.clone(), None, Some("lokal".into())).unwrap();
        assert!(core.conflicts().is_empty());

        // Fremder Stand, später datiert: gewinnt; der lokale wird zur Konfliktkopie.
        let found = core
            .lock()
            .import_remote(vec![remote_update("fremd-1", &p, "fremd", "2099-01-01T00:00:00.000Z")], 0, "test")
            .unwrap();
        assert_eq!(found, 1);
        let list = core.conflicts();
        assert_eq!(list.len(), 1);
        let c = &list[0];
        assert_eq!(
            (c.kind, c.winner, c.page_id.as_deref()),
            (ConflictType::Both, Some(ConflictSide::Remote), Some(p.as_str()))
        );
        assert_eq!((c.local_content.as_deref(), c.remote_content.as_deref()), (Some("lokal"), Some("fremd")));
        assert_eq!(c.title, "Notiz");
        assert!(c.reason.as_deref().is_some_and(|r| r.contains("derselben Stelle")));
        assert_eq!(c.recommended, Some(ConflictResolution::KeepWinner));
        assert_eq!(c.choices.len(), 3);
        assert_eq!(core.conflict_count(), 1);
        assert_eq!(core.page(p.clone()).unwrap().content, "fremd");

        // Entscheidung, die nicht angeboten wird, und unbekannter Schlüssel.
        assert!(core.resolve_conflict("nope".into(), ConflictResolution::KeepWinner).is_err());
        // Den unterlegenen (lokalen) Stand übernehmen: Seite bekommt ihn, Kopie in den Papierkorb.
        core.resolve_conflict(c.key.clone(), ConflictResolution::UseLoser).unwrap();
        assert_eq!(core.page(p.clone()).unwrap().content, "lokal");
        assert!(core.conflicts().is_empty());
        assert_eq!(core.trashed_pages().len(), 1);
        // Zweiter Versuch: nichts mehr offen.
        assert!(core.resolve_conflict(c.key.clone(), ConflictResolution::KeepWinner).is_err());
    }

    #[test]
    fn vormerkung_ueberlebt_neustart_und_beide_behalten() {
        let dir = std::env::temp_dir().join(format!("impala-conflicts-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("db.sqlite").to_string_lossy().into_owned();
        let page = {
            let core = ImpalaCore::open(path.clone()).unwrap();
            let p = core.create_page("Heft".into(), String::new(), None, None).unwrap();
            core.update_page(p.clone(), None, Some("a".into())).unwrap();
            core.lock()
                .import_remote(vec![remote_update("f1", &p, "b", "2099-01-01T00:00:00.000Z")], 0, "test")
                .unwrap();
            p
        };
        let core = ImpalaCore::open(path).unwrap();
        let list = core.conflicts();
        assert_eq!(list.len(), 1, "{list:?}");
        let key = list[0].key.clone();
        core.resolve_conflict(key, ConflictResolution::KeepBoth).unwrap();
        assert!(core.conflicts().is_empty());
        // Die Kopie bleibt als eigene Seite „… (Kopie)“, die Seite behält den Gewinner.
        assert_eq!(core.page(page).unwrap().content, "b");
        assert!(core.search("Kopie".into(), false).iter().any(|h| h.title.ends_with("(Kopie)")));
        drop(core);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn alt_kopien_und_sammelaufloesung() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let orig = core.create_page("Mathe".into(), "Zeile 1\nZeile 2".into(), None, None).unwrap();
        // Gerettete Kopie früherer Konflikte: Zeilen sind im Original enthalten, darf weg.
        let copy = core
            .create_page("⚠ Konflikt: Mathe — Stand 2026-01-01 10:00".into(), "Zeile 1".into(), None, None)
            .unwrap();
        let list = core.conflicts();
        assert_eq!(list.len(), 1);
        let c = &list[0];
        assert_eq!((c.kind, c.title.as_str()), (ConflictType::Legacy, "Mathe"));
        assert_eq!(
            (c.page_id.as_deref(), c.copy_page_id.as_deref(), c.extra_lines),
            (Some(orig.as_str()), Some(copy.as_str()), Some(0))
        );
        assert_eq!(c.recommended, Some(ConflictResolution::KeepWinner));

        // Kopie mit Zeile, die im Original fehlt: keine Empfehlung, bleibt bei „alle lösen“.
        let risky = core
            .create_page("⚠ Konflikt: Mathe — Stand 2026-01-02 10:00".into(), "Einzigartig".into(), None, None)
            .unwrap();
        let listed = core.conflicts();
        assert_eq!(listed.len(), 2);
        assert_eq!(
            listed.iter().find(|c| c.copy_page_id.as_deref() == Some(risky.as_str())).unwrap().recommended,
            None
        );
        let r = core.resolve_conflicts_recommended();
        assert_eq!((r.resolved, r.error), (1, None));
        assert_eq!(core.conflict_count(), 1);
        assert!(core.page(copy).unwrap().trashed);
        assert_eq!(core.page(orig).unwrap().content, "Zeile 1\nZeile 2");
    }

    #[test]
    fn vergleich_und_abgleich() {
        assert_eq!(conflict_diff_rows("a\nb".into(), "a\nb".into()).unwrap().len(), 2);
        let rows = conflict_diff_rows("a\nb\nc".into(), "a\nB\nc".into()).unwrap();
        assert!(
            matches!(&rows[1], DiffRow::Line { left: Some(l), right: Some(r), changed: true, start: true } if l == "b" && r == "B")
        );
        // Lange unveränderte Strecken klappen ein.
        let long: String = (0..30).map(|i| format!("z{i}\n")).collect();
        let rows = conflict_diff_rows(format!("{long}x"), format!("{long}y")).unwrap();
        assert!(rows.iter().any(|r| matches!(r, DiffRow::Gap { count } if *count > 0)));
        let big: String = (0..450).map(|i| format!("l{i}\n")).collect();
        assert_eq!(conflict_diff_rows(big, String::new()), None);

        assert_eq!(merge_texts("a\nb\nc".into(), "A\nb\nc".into(), "a\nb\nC".into()).as_deref(), Some("A\nb\nC"));
        assert_eq!(merge_texts("a".into(), "b".into(), "c".into()), None);
    }
}
