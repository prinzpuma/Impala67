//! Ausführung der KI-Werkzeuge auf dem Datenmodell – eine Implementierung für PWA (WASM) und
//! native Apps (FFI). `inspect` liest, `change` ändert atomar und liefert einen Änderungs-Satz
//! `{ pages, cards, decks, heftDocs }` (je `{ id, before, after }`), den [`undo`] zurückspielt,
//! solange die betroffenen Daten seitdem unverändert sind. Flache Werkzeuge (`impala_ai::flat`)
//! übersetzt [`run_flat`]. Was nur die Plattform kann (Bedeutungssuche, Rechnen, Rückfragen,
//! Heftseite als Bild), bleibt bei den Hüllen.
//!
//! Ein-/Ausgabe läuft über [`Host`]: Zustand lesen, Events absetzen, IDs erzeugen. Die FFI
//! speichert jedes Event sofort; die WASM-Hülle wendet es an und reicht es der PWA zum Speichern.

mod change;
mod read;
mod undo;
mod write;

use std::collections::BTreeSet;

use impala_ai::LocalTime;
use impala_model::Model;
use impala_model::search::NoteSearch;
use serde_json::{Value, json};

pub use undo::apply as undo;

/// Datenzugriff der Werkzeuge.
pub trait Host {
    fn model(&self) -> &Model;
    /// Modell und Stichwortsuche zusammen (die Suche baut ihren Index aus dem Modell).
    fn model_search(&mut self) -> (&Model, &mut NoteSearch);
    /// Eigenes Event (`kind` wie im Log) absetzen und anwenden.
    fn dispatch(&mut self, kind: &str, payload: Value) -> Result<(), String>;
    /// Neue ID (UUID) für Seiten, Karten und Heft-Elemente.
    fn new_id(&mut self) -> String;
}

/// Umgebung eines Aufrufs (von der Oberfläche).
#[derive(Debug, Clone)]
pub struct Context {
    /// Geöffnete Seite: Ziel neuer Karten ohne Seitenangabe, `currentPage` im Kontext.
    pub active_page: Option<String>,
    /// Arbeitsbereich neuer Seiten ohne Ordner; sonst der der geöffneten Seite, sonst `default`.
    pub workspace: Option<String>,
    pub now: LocalTime,
    pub now_ms: i64,
    pub utc_offset: i32,
    /// Gerade gelernte Karte (`currentCard` im Kontext), sonst `null`.
    pub current_card: Value,
    /// Chat-Sitzungen, wenn sie nicht (nur) im Modell liegen (PWA: lokale Chats); sonst die des Modells.
    pub chats: Option<Vec<Value>>,
}

impl Context {
    /// Kontext zur Uhrzeit `now_ms` (UTC) mit Zeitzonen-Versatz in Minuten.
    pub fn at(now_ms: i64, utc_offset: i32) -> Context {
        Context {
            active_page: None,
            workspace: None,
            now: local_time(now_ms, utc_offset),
            now_ms,
            utc_offset,
            current_card: Value::Null,
            chats: None,
        }
    }
}

/// Ortszeit aus UTC-Millisekunden und Versatz in Minuten (proleptischer Gregorianischer Kalender).
pub fn local_time(utc_ms: i64, offset_minutes: i32) -> LocalTime {
    let secs = utc_ms.div_euclid(1000) + i64::from(offset_minutes) * 60;
    let (days, day_secs) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let (era, doe) = (z.div_euclid(146_097), z.rem_euclid(146_097));
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u8;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u8;
    let year = (yoe + era * 400 + i64::from(month <= 2)) as i32;
    LocalTime {
        year,
        month,
        day,
        weekday: (days + 4).rem_euclid(7) as u8,
        hour: (day_secs / 3600) as u8,
        minute: (day_secs % 3600 / 60) as u8,
    }
}

/// `inspect` oder `change` ausführen: `(Ergebnis, Änderungs-Satz)`. `None` für andere Namen
/// (Plattform-Werkzeuge). Fehler stehen als `{ "error" }` im Ergebnis.
pub fn run(host: &mut dyn Host, ctx: &Context, name: &str, args: &Value) -> Option<(Value, Option<Value>)> {
    let mut t = Tools { host, ctx };
    match name {
        "inspect" => Some((t.inspect(args).unwrap_or_else(|e| json!({ "error": e })), None)),
        "change" => Some(t.change(args)),
        _ => None,
    }
}

/// Flaches Werkzeug (`read_pages`, `edit_page` …) wie [`run`]; `dry_run: true` prüft Schreibwünsche
/// nur und liefert die übersetzten Operationen als `ops` mit. `None`: kein flaches Werkzeug.
/// Bedeutungssuche (`search` mit `semantic`) übernimmt die Hülle vorher, sonst gilt die Stichwortsuche.
pub fn run_flat(host: &mut dyn Host, ctx: &Context, name: &str, args: &Value) -> Option<(Value, Option<Value>)> {
    let (tool, mut inner) = match impala_ai::flat_call(name, args)? {
        Ok(call) => call,
        Err(e) => return Some((json!({ "error": e }), None)),
    };
    let dry = tool == "change" && args.get("dry_run") == Some(&Value::Bool(true));
    if dry {
        inner["dry_run"] = Value::Bool(true);
    }
    let (mut out, undo) = run(host, ctx, tool, &inner)?;
    if dry && out.get("dryRun") == Some(&Value::Bool(true)) {
        out["ops"] = inner["operations"].clone();
    }
    Some((out, undo))
}

/// Übersetzt einen flachen Aufruf nur (für Hüllen, die vorher selbst Plattform-Werkzeuge abfangen).
pub fn translate_flat(name: &str, args: &Value) -> Option<Result<(&'static str, Value), String>> {
    impala_ai::flat_call(name, args)
}

/// Werkzeug-Umgebung: jede Methode ist ein internes Werkzeug (`create_page`, `list_pages` …).
struct Tools<'a> {
    host: &'a mut dyn Host,
    ctx: &'a Context,
}

impl Tools<'_> {
    fn ev(&mut self, kind: &str, payload: Value) -> Result<(), String> {
        self.host.dispatch(kind, payload)
    }

    fn page_id(&self, title: &str) -> Option<String> {
        self.host.model().state().find_page(title, true).map(|p| p.id().to_owned())
    }

    fn page_by_title(&self, title: &str) -> Result<String, String> {
        self.page_id(title).ok_or_else(|| format!("Seite nicht gefunden: {title}"))
    }

    fn page_json(&self, id: &str) -> Value {
        self.host.model().state().pages.get(id).map(ser).unwrap_or(Value::Null)
    }

    /// Arbeitsbereich neuer Seiten: Ordner, sonst der des Aufrufers, sonst der der geöffneten Seite.
    fn workspace_for(&self, parent: Option<&str>) -> String {
        let state = self.host.model().state();
        if let Some(p) = parent.and_then(|p| state.pages.get(p)) {
            return p.workspace().to_owned();
        }
        if let Some(ws) = self.ctx.workspace.as_deref().filter(|w| !w.is_empty()) {
            return ws.to_owned();
        }
        self.ctx
            .active_page
            .as_deref()
            .and_then(|p| state.pages.get(p))
            .map_or_else(|| "default".to_owned(), |p| p.workspace().to_owned())
    }
}

type Res = Result<Value, String>;

fn fail<T>(m: impl Into<String>) -> Result<T, String> {
    Err(m.into())
}

// ---------------------------------------------------------------------------
// kleine JS-Helfer

fn str_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string().trim_matches('"').to_owned(),
    }
}

/// `String(a[k] || "")`
fn arg(a: &Value, k: &str) -> String {
    a.get(k).filter(|v| truthy(v)).map(str_of).unwrap_or_default()
}

fn targ(a: &Value, k: &str) -> String {
    arg(a, k).trim().to_owned()
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

fn truthy_at(v: &Value, k: &str) -> bool {
    v.get(k).is_some_and(truthy)
}

fn num(a: &Value, k: &str) -> Option<f64> {
    match a.get(k)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// Erste `n` UTF-16-Einheiten (wie `slice(0, n)` in JS).
fn head16(s: &str, n: usize) -> &str {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        units += c.len_utf16();
        if units > n {
            return &s[..i];
        }
    }
    s
}

fn len16(s: &str) -> usize {
    s.encode_utf16().count()
}

fn lower(s: &str) -> String {
    s.to_lowercase()
}

fn ser<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

fn is_descendant_of(state: &impala_model::State, pg: &impala_model::Page, root_id: &str) -> bool {
    let mut cur = pg.parent();
    for _ in 0..64 {
        let Some(id) = cur else { break };
        if id == root_id {
            return true;
        }
        cur = state.pages.get(id).and_then(|p| p.parent());
    }
    false
}

fn full_page_path(state: &impala_model::State, pg: &impala_model::Page) -> String {
    let mut parts = vec![pg.title()];
    let mut cur = pg.parent();
    for _ in 0..64 {
        let Some(id) = cur else { break };
        let Some(p) = state.pages.get(id) else { break };
        parts.push(p.title());
        cur = p.parent();
    }
    parts.reverse();
    parts.join("/")
}

fn newest_first(a: &impala_model::Page, b: &impala_model::Page) -> std::cmp::Ordering {
    b.updated().cmp(a.updated())
}

/// Leere Menge für Aufrufe ohne gelöschte Seiten.
fn no_ids() -> BTreeSet<String> {
    BTreeSet::new()
}

#[cfg(test)]
mod tests;
