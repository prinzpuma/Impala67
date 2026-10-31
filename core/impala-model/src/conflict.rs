//! Sync-Konflikte: Erkennung beim Import (`importAll` in `web/db.js`) und die reine Logik des
//! Konflikt-Dialogs (`web/conflict-ui.js`, `render.js`: Empfehlung, Zeilenvergleich, Auflösung).
//!
//! Beim Import werden fremde Events gegen die seit dem letzten Sync lokal entstandenen geprüft:
//! - dieselbe Seite hier und dort inhaltlich geändert → erst [`merge3`](crate::merge3), bei echter
//!   Überlappung gewinnt der spätere Zeitstempel und der andere Stand wird als Konfliktkopie gerettet;
//! - endgültig gelöscht vs. verschoben/geändert → Löschen gewinnt, der andere Stand wird Kopie.
//!
//! Abgeleitete Events tragen IDs aus den Quell-IDs (`merge3-…`, `conflict-…`, `lifeconflict-…`):
//! Beide Geräte erzeugen dieselben, ein zweiter Import legt nichts doppelt an.

use std::collections::HashSet;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::js::{self, Object};
use crate::merge::{Merge3, merge3};
use crate::record::record;
use crate::types::{Page, State};

pub const REASON_BOTH: &str = "Dieselbe Seite wurde seit dem letzten Sync sowohl hier als auch auf einem anderen Gerät geändert — und zwar an derselben Stelle, sodass sie sich nicht automatisch zusammenführen ließ. Der neuere Zeitstempel gewinnt; der ältere Stand liegt als Kopie bereit.";
pub const REASON_DELETE: &str = "Diese Seite wurde auf einem Gerät endgültig gelöscht, während sie auf einem anderen Gerät seit dem letzten Sync verschoben, wiederhergestellt oder geändert wurde. Das Löschen gewinnt beim Merge; der andere Stand liegt als Kopie bereit.";

record! {
    /// Ein Konflikt, wie ihn der Import meldet und die Oberfläche speichert (`conflictDetails`).
    pub struct Conflict {
        page_id: String = "pageId",
        title: String = "title",
        reason: String = "reason",
        local_content: String = "localContent",
        remote_content: String = "remoteContent",
        local_time: String = "localTime",
        remote_time: String = "remoteTime",
        /// `"remote"` oder `"local"`.
        winner: String = "winner",
        loser_content: String = "loserContent",
        loser_time: String = "loserTime",
        conflict_page_id: String = "conflictPageId",
        event_id: String = "eventId",
        /// `"delete-change"` beim Lösch-Konflikt.
        conflict_type: String = "conflictType",
        deleted_at: String = "deletedAt",
        changed_at: String = "changedAt",
        parent_id: String = "parentId",
        workspace_id: String = "workspaceId",
        loser_source: String = "loserSource",
        /// Gerettete Alt-Kopie ohne gespeicherte Details.
        legacy: bool = "legacy",
        nested: bool = "nested",
        extra_lines: f64 = "extraLines",
        original_title: String = "originalTitle",
    }
}

/// Automatisch zusammengeführte Seite (`mergedDetails`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Merged {
    pub page_id: String,
    pub title: Value,
    pub local_time: String,
    pub remote_time: String,
}

/// Ergebnis der Konflikt-Prüfung eines Imports.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ImportConflicts {
    pub conflicts: Vec<Conflict>,
    pub merged: Vec<Merged>,
}

/// Titel und Ablageort einer Seite (`opts.pageInfo` bzw. aus dem Log rekonstruiert).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PageInfo {
    pub title: Option<Value>,
    pub parent_id: Option<Value>,
    pub workspace_id: Option<Value>,
}

impl State {
    /// `S.pages[id]` als [`PageInfo`].
    pub fn page_info(&self, id: &str) -> Option<PageInfo> {
        let pg = self.pages.get(id)?;
        Some(PageInfo { title: pg.get("title"), parent_id: pg.get("parentId"), workspace_id: pg.get("workspaceId") })
    }
}

/// Letzter bekannter Stand einer Seite rein aus Events (`reconstructPageFromEvents`). Wichtig beim
/// Lösch-Konflikt: lokal ist die Seite ggf. schon weg.
#[derive(Debug, Clone, PartialEq)]
pub struct Reconstructed {
    pub title: Value,
    pub content: Value,
    pub kind: Value,
    pub parent_id: Value,
    pub workspace_id: Value,
    /// Alt-Log (vor v8): Zeiger auf eine Drive-Binärdatei (`heftUpdated`).
    pub heft_meta: Value,
}

fn ev_kind(ev: &Object) -> &str {
    ev.get("type").and_then(Value::as_str).unwrap_or("")
}

fn ev_time(ev: &Object) -> &str {
    ev.get("t").and_then(Value::as_str).unwrap_or("")
}

fn ev_id(ev: &Object) -> String {
    ev.get("id").map(js::to_string).unwrap_or_else(|| "undefined".into())
}

fn payload(ev: &Object) -> Option<&Object> {
    ev.get("payload").and_then(Value::as_object)
}

pub fn reconstruct_page<'a>(events: impl IntoIterator<Item = &'a Object>, id: &str) -> Reconstructed {
    let mut pg = Reconstructed {
        title: json!("Seite"),
        content: json!(""),
        kind: json!("notion"),
        parent_id: Value::Null,
        workspace_id: json!("default"),
        heft_meta: Value::Null,
    };
    let is_id = |v: Option<&Value>| v.and_then(Value::as_str) == Some(id);
    let mut relevant: Vec<&Object> = events
        .into_iter()
        .filter(|ev| payload(ev).is_some_and(|p| is_id(p.get("id")) || is_id(p.get("pageId"))))
        .collect();
    relevant.sort_by(|a, b| js::cmp(ev_time(a), ev_time(b)));
    let apply = |pg: &mut Reconstructed, src: &Object, patch: bool| {
        let present = |k: &str| if patch { src.contains_key(k) } else { src.get(k).is_some_and(js::truthy) };
        if present("title") {
            pg.title = src["title"].clone();
        }
        if let Some(c) = src.get("content") {
            pg.content = c.clone();
        }
        if present("kind") {
            pg.kind = src["kind"].clone();
        }
        if src.contains_key("parentId") {
            pg.parent_id = js::or_null(src.get("parentId"));
        }
        if let Some(w) = js::or(src.get("workspaceId")) {
            pg.workspace_id = w.clone();
        }
    };
    for ev in relevant {
        let Some(p) = payload(ev) else { continue };
        match ev_kind(ev) {
            "pageCreate" => apply(&mut pg, p, false),
            "pageUpdate" => {
                if let Some(patch) = p.get("patch").and_then(Value::as_object) {
                    apply(&mut pg, patch, true);
                }
            }
            "pageMove" => pg.parent_id = js::or_null(p.get("parentId")),
            "heftOps" | "heftSnap" => pg.kind = json!("heft"),
            "heftUpdated" => {
                pg.kind = json!("heft");
                let f = |k: &str| p.get(k).cloned().unwrap_or(Value::Null);
                pg.heft_meta =
                    json!({ "rev": f("rev"), "pages": f("pages"), "bytes": f("bytes"), "blobHash": f("blobHash") });
            }
            _ => {}
        }
    }
    pg
}

/// Jüngstes passendes Event je Ziel per Zeitstempel (`headsOf`; die Seq-Reihenfolge lügt nach Importen).
fn heads_of<'a>(
    events: impl IntoIterator<Item = &'a Object>,
    key_of: impl Fn(&Object) -> Option<String>,
    extra: impl Fn(&Object) -> bool,
) -> crate::JsMap<&'a Object> {
    let mut heads: crate::JsMap<&Object> = crate::JsMap::new();
    for ev in events {
        let Some(id) = key_of(ev) else { continue };
        if !extra(ev) {
            continue;
        }
        if heads.get(&id).is_none_or(|h| js::lt(ev_time(h), ev_time(ev))) {
            heads.insert(id, ev);
        }
    }
    heads
}

fn payload_id(ev: &Object) -> Option<String> {
    payload(ev).and_then(|p| p.get("id")).filter(|v| !v.is_null()).map(js::to_string)
}

fn content_key(ev: &Object) -> Option<String> {
    let has_text =
        payload(ev).and_then(|p| p.get("patch")).and_then(|p| p.get("content")).is_some_and(Value::is_string);
    (ev_kind(ev) == "pageUpdate" && has_text).then(|| payload_id(ev)).flatten()
}

fn content_of(ev: &Object) -> &str {
    payload(ev).and_then(|p| p.get("patch")).and_then(|p| p.get("content")).and_then(Value::as_str).unwrap_or("")
}

/// `isLocalOnly`: seit dem letzten Sync hier entstanden, kennt kein anderes Gerät.
pub fn is_local_only(ev: &Object, unsynced_after_seq: u64) -> bool {
    impala_storage::js::seq_of(ev.get("seq")) > unsynced_after_seq && impala_storage::event::is_own(ev)
}

fn derived(id: String, t: String, kind: &str, payload: Value) -> Object {
    let mut o = Object::new();
    o.insert("id".into(), Value::from(id));
    o.insert("t".into(), Value::from(t));
    o.insert("type".into(), Value::from(kind));
    o.insert("_derived".into(), Value::Bool(true));
    o.insert("payload".into(), payload);
    o
}

/// Was die Konflikt-Prüfung vom Aufrufer braucht.
pub struct ImportContext<'a> {
    /// Lokale Events: das ganze Log oder nur das unbestätigte Delta (Cloudflare).
    pub local: &'a [Object],
    /// Folgenummer des letzten Uploads: Events darüber sind „meine ungesyncten Änderungen“.
    pub unsynced_after_seq: u64,
    /// Ist die Event-ID lokal schon bekannt (ganzes Log, nicht nur `local`)?
    pub known: &'a dyn Fn(&str) -> bool,
    /// Das ganze Log; wird höchstens einmal und nur bei einem Kandidaten geholt.
    pub history: &'a mut dyn FnMut() -> Vec<Object>,
    /// Aktueller Stand einer Seite (`S.pages[id]`).
    pub page_info: &'a dyn Fn(&str) -> Option<PageInfo>,
    /// Hybride Uhr für die Zeitstempel abgeleiteter Events (`U.now()`).
    pub now: &'a mut dyn FnMut() -> String,
}

/// Das ganze Log, beim ersten Bedarf geholt.
fn full_log<'c>(cache: &'c mut Option<Vec<Object>>, history: &mut dyn FnMut() -> Vec<Object>) -> &'c [Object] {
    cache.get_or_insert_with(history)
}

/// Titel und Ablageort: aktueller Zustand, sonst aus dem Log (der Zustand kann veraltet sein).
fn page_info_of(
    id: &str,
    page_info: &dyn Fn(&str) -> Option<PageInfo>,
    cache: &mut Option<Vec<Object>>,
    history: &mut dyn FnMut() -> Vec<Object>,
    fresh: &[Object],
) -> PageInfo {
    if let Some(pi) = page_info(id).filter(|p| p.title.as_ref().is_some_and(js::truthy)) {
        return pi;
    }
    let pg = reconstruct_page(full_log(cache, history).iter().chain(fresh.iter()), id);
    PageInfo { title: Some(pg.title), parent_id: Some(pg.parent_id), workspace_id: Some(pg.workspace_id) }
}

fn owned_heads(m: crate::JsMap<&Object>) -> Vec<(String, Object)> {
    m.iter().map(|(k, v)| (k.clone(), (*v).clone())).collect()
}

/// Prüft neue Fremd-Events (`fresh`, schon ohne Dubletten) auf Konflikte und hängt
/// Merge-/Konfliktkopie-Events an `fresh` an (`_derived`, synchronisieren normal).
pub fn detect_import_conflicts(fresh: &mut Vec<Object>, ctx: ImportContext) -> ImportConflicts {
    let ImportContext { local, unsynced_after_seq: after, known, history, page_info, now } = ctx;
    let mut out = ImportConflicts::default();
    if fresh.is_empty() {
        return out;
    }
    let fresh_ids: HashSet<String> = fresh.iter().map(ev_id).collect();
    let seen = |id: &str| known(id) || fresh_ids.contains(id);
    let mut cache: Option<Vec<Object>> = None;

    // (1) Inhalts-Konflikt: gleiche Seite lokal UND fremd geändert. Erst Drei-Wege-Abgleich.
    let local_heads: crate::JsMap<Object> =
        owned_heads(heads_of(local, content_key, |e| is_local_only(e, after))).into_iter().collect();
    let remote_heads = owned_heads(heads_of(fresh.iter(), content_key, |_| true));
    // Letzter GEMEINSAMER Stand: alles, was dieses Gerät schon gesynct bzw. per Sync bekommen hat.
    let mut common: Option<Vec<Object>> = None;
    for (id, remote) in remote_heads {
        let Some(mine) = local_heads.get(&id) else { continue };
        if content_of(mine) == content_of(&remote) {
            continue;
        }
        let (mine_id, remote_id) = (ev_id(mine), ev_id(&remote));
        let (lo, hi) = if js::lt(&mine_id, &remote_id) { (&mine_id, &remote_id) } else { (&remote_id, &mine_id) };
        let merge_id = format!("merge3-{lo}-{hi}");
        if seen(&merge_id) {
            continue; // schon zusammengeführt
        }
        if common.is_none() {
            let all = full_log(&mut cache, history);
            common = Some(all.iter().filter(|e| !is_local_only(e, after)).cloned().collect());
        }
        let base = reconstruct_page(common.iter().flatten(), &id).content;
        let result = match base.as_str() {
            Some(base) => merge3(base, content_of(mine), content_of(&remote)),
            None => Merge3::Conflict, // keine Text-Basis
        };
        if let Merge3::Merged { text, .. } = result {
            let pi = page_info_of(&id, page_info, &mut cache, history, fresh);
            out.merged.push(Merged {
                page_id: id.clone(),
                title: js::or(pi.title.as_ref()).cloned().unwrap_or_else(|| json!("Seite")),
                local_time: ev_time(mine).to_owned(),
                remote_time: ev_time(&remote).to_owned(),
            });
            let t = now();
            fresh.push(derived(merge_id, t, "pageUpdate", json!({ "id": id, "patch": { "content": text } })));
            continue;
        }
        // Echte Überlappung: der spätere Zeitstempel gewinnt; Gleichstand per ID, damit beide
        // Geräte denselben Verlierer wählen.
        let (mt, rt) = (ev_time(mine), ev_time(&remote));
        let remote_wins = if mt != rt { js::lt(mt, rt) } else { js::lt(&mine_id, &remote_id) };
        let loser = if remote_wins { mine } else { &remote };
        let loser_id = ev_id(loser);
        if seen(&format!("conflict-{loser_id}")) {
            continue;
        }
        let pi = page_info_of(&id, page_info, &mut cache, history, fresh);
        let title = js::or(pi.title.as_ref()).cloned().unwrap_or_else(|| json!("Seite"));
        let conflict_page_id = format!("conflictpg-{loser_id}");
        let mut c = Conflict::default();
        c.set("pageId", json!(id));
        c.set("title", title.clone());
        c.set("reason", json!(REASON_BOTH));
        c.set("localContent", json!(content_of(mine)));
        c.set("remoteContent", json!(content_of(&remote)));
        c.set("localTime", json!(mt));
        c.set("remoteTime", json!(rt));
        c.set("winner", json!(if remote_wins { "remote" } else { "local" }));
        c.set("loserContent", json!(content_of(loser)));
        c.set("loserTime", json!(ev_time(loser)));
        c.set("conflictPageId", json!(conflict_page_id));
        c.set("eventId", json!(format!("conflict-{loser_id}")));
        out.conflicts.push(c);
        let stamp = js::head16(ev_time(loser), 16).replacen('T', " ", 1);
        let payload = json!({
            "id": conflict_page_id,
            "title": format!("⚠ Konflikt: {} — Stand {stamp}", js::to_string(&title)),
            "content": content_of(loser),
            "parentId": js::or_null(pi.parent_id.as_ref()),
            "workspaceId": js::or_str(pi.workspace_id.as_ref(), "default"),
        });
        let t = now();
        fresh.push(derived(format!("conflict-{loser_id}"), t, "pageCreate", payload));
    }

    // (2) Hefte haben seit v8 keine Konflikte: Striche reisen als einzelne Operationen.

    // (3) Endgültig gelöscht vs. verschoben/geändert: Löschen gewinnt, der andere Stand wird Kopie.
    const LIFE: [&str; 6] = ["pageMove", "pageUpdate", "pageTrash", "pageRestore", "pageArchive", "pageUnarchive"];
    let del_key = |e: &Object| (ev_kind(e) == "pageDelete").then(|| payload_id(e)).flatten();
    let life_key = |e: &Object| LIFE.contains(&ev_kind(e)).then(|| payload_id(e)).flatten();
    let local_del = owned_heads(heads_of(local, del_key, |e| is_local_only(e, after)));
    let remote_del = owned_heads(heads_of(fresh.iter(), del_key, |_| true));
    let local_life: crate::JsMap<Object> =
        owned_heads(heads_of(local, life_key, |e| is_local_only(e, after))).into_iter().collect();
    let remote_life: crate::JsMap<Object> =
        owned_heads(heads_of(fresh.iter(), life_key, |_| true)).into_iter().collect();
    let mut pairs: Vec<(String, Object, Object, &str)> = Vec::new();
    for (id, del) in local_del {
        if let Some(moved) = remote_life.get(&id) {
            pairs.push((id, del, moved.clone(), "remote"));
        }
    }
    for (id, del) in remote_del {
        if let Some(moved) = local_life.get(&id) {
            pairs.push((id, del, moved.clone(), "local"));
        }
    }
    for (id, del, moved, loser_source) in pairs {
        // Papierkorb/Archiv gegen endgültiges Löschen: beide wollten die Seite weghaben.
        if matches!(ev_kind(&moved), "pageTrash" | "pageArchive") {
            continue;
        }
        let moved_id = ev_id(&moved);
        if seen(&format!("lifeconflict-{moved_id}")) {
            continue;
        }
        let conflict_page_id = format!("conflictpg-{moved_id}");
        let pg = reconstruct_page(full_log(&mut cache, history).iter().chain(fresh.iter()), &id);
        let mut c = Conflict::default();
        c.set("pageId", json!(id));
        c.set("title", pg.title.clone());
        c.set("reason", json!(REASON_DELETE));
        c.set("deletedAt", json!(ev_time(&del)));
        c.set("changedAt", json!(ev_time(&moved)));
        c.set("conflictPageId", json!(conflict_page_id));
        c.set("conflictType", json!("delete-change"));
        c.set("parentId", pg.parent_id.clone());
        c.set("workspaceId", pg.workspace_id.clone());
        c.set("eventId", json!(format!("lifeconflict-{moved_id}")));
        c.set("loserSource", json!(loser_source));
        out.conflicts.push(c);
        let payload = json!({
            "id": conflict_page_id,
            "title": format!("⚠ Konflikt (gelöscht/verschoben): {}", js::to_string(&pg.title)),
            "content": pg.content,
            "parentId": pg.parent_id,
            "workspaceId": pg.workspace_id,
            "kind": pg.kind,
        });
        let t = now();
        fresh.push(derived(format!("lifeconflict-{moved_id}"), t, "pageCreate", payload));
    }
    out
}

// ---- Konflikt-Dialog (reine Logik) ---------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictKind {
    /// Beide Seiten haben den Inhalt geändert.
    Both,
    /// Gelöscht vs. geändert.
    Delete,
    /// Gerettete Alt-Kopie ohne Details.
    Legacy,
}

/// Entscheidung (`resolveConflict(action)`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Resolution {
    /// Die Kopie verwerfen (Papierkorb), der Gewinner bleibt.
    KeepWinner,
    /// Den unterlegenen Stand übernehmen.
    UseLoser,
    /// Die Kopie als eigene Seite behalten.
    KeepBoth,
}

impl Resolution {
    pub fn as_str(self) -> &'static str {
        match self {
            Resolution::KeepWinner => "keep-winner",
            Resolution::UseLoser => "use-loser",
            Resolution::KeepBoth => "keep-both",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "keep-winner" => Resolution::KeepWinner,
            "use-loser" => Resolution::UseLoser,
            "keep-both" => Resolution::KeepBoth,
            _ => return None,
        })
    }
}

/// Eine angebotene Entscheidung; `recommended` = der neuere Stand bzw. „Löschen gewinnt“.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Choice {
    pub resolution: Resolution,
    pub recommended: bool,
}

/// Warum eine Entscheidung nicht ausführbar ist (dann wurde nichts verändert).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolveError {
    /// Lösch-Konflikt: die gerettete Kopie fehlt.
    CopyMissing,
    /// Der andere Stand ist nicht mehr vorhanden.
    LoserMissing,
}

const CONFLICT_PREFIX: &str = "⚠ Konflikt";

fn strip_copy_prefix(mut s: &str) -> &str {
    // /^(⚠ Konflikt( \(gelöscht\/verschoben\))?:\s*)+/
    loop {
        let Some(rest) = s.strip_prefix(CONFLICT_PREFIX) else { return s };
        let rest = rest.strip_prefix(" (gelöscht/verschoben)").unwrap_or(rest);
        let Some(rest) = rest.strip_prefix(':') else { return s };
        s = rest.trim_start_matches(impala_search::text::is_js_space);
    }
}

fn is_line_break(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

impl Conflict {
    pub fn kind(&self) -> ConflictKind {
        if self.truthy("legacy") {
            ConflictKind::Legacy
        } else if self.conflict_type.as_deref() == Some("delete-change") {
            ConflictKind::Delete
        } else {
            ConflictKind::Both
        }
    }

    /// Titel ohne Konflikt-Präfixe und Zeitstempel (`conflictTitle`).
    pub fn display_title(&self) -> String {
        conflict_title(&js::str_or_empty(self.get("title").as_ref()))
    }

    /// Zeitpunkt für die Liste: lokal geändert, sonst geändert/verloren.
    pub fn time(&self) -> Option<String> {
        ["localTime", "changedAt", "loserTime"].iter().find_map(|k| js::or(self.get(k).as_ref()).map(js::to_string))
    }

    /// Kann die Alt-Kopie weg, ohne dass etwas verloren geht?
    fn legacy_safe(&self) -> bool {
        self.truthy("nested") || (self.truthy("pageId") && self.extra_lines == Some(0.0))
    }

    /// Angebotene Entscheidungen in Anzeigereihenfolge (`conflictActions`).
    pub fn choices(&self) -> Vec<Choice> {
        let c = |resolution, recommended| Choice { resolution, recommended };
        match self.kind() {
            ConflictKind::Delete => vec![c(Resolution::UseLoser, false), c(Resolution::KeepWinner, true)],
            ConflictKind::Legacy => vec![c(Resolution::KeepWinner, self.legacy_safe()), c(Resolution::KeepBoth, false)],
            ConflictKind::Both => {
                let local_wins = self.winner.as_deref() != Some("remote");
                let (first, second) = if local_wins {
                    (Resolution::KeepWinner, Resolution::UseLoser)
                } else {
                    (Resolution::UseLoser, Resolution::KeepWinner)
                };
                vec![c(first, local_wins), c(second, !local_wins), c(Resolution::KeepBoth, false)]
            }
        }
    }

    /// Empfehlung für „Alle … mit Empfehlung lösen“ (Alt-Kopien ggf. ohne).
    pub fn recommended(&self) -> Option<Resolution> {
        self.choices().into_iter().find(|c| c.recommended).map(|c| c.resolution)
    }

    /// Schlüssel in der Liste offener Konflikte (`conflictPageId || pageId`).
    pub fn key(&self) -> String {
        let v = js::or(self.get("conflictPageId").as_ref()).cloned().or_else(|| self.get("pageId"));
        js::key_of(v.as_ref())
    }

    /// Fehlende Texte aus dem Zustand ergänzen (gespeichert ohne Texte, weil der Platz knapp war):
    /// die Kopie hält den unterlegenen, die Seite den gewinnenden Stand.
    pub fn with_texts_from(&self, state: &State) -> Conflict {
        let mut c = self.clone();
        let missing = !self.truthy("conflictType") && !self.truthy("localContent") && !self.truthy("remoteContent");
        let (Some(page), Some(copy)) = (self.page_id.as_deref(), self.conflict_page_id.as_deref()) else { return c };
        if !missing || page.is_empty() || copy.is_empty() {
            return c;
        }
        let (winner, loser) = (state.pages.get(page), state.pages.get(copy));
        if winner.is_none() && loser.is_none() {
            return c;
        }
        let text = |p: Option<&Page>| json!(p.map_or(String::new(), |p| js::str_or_empty(p.get("content").as_ref())));
        let (w, l) = (text(winner), text(loser));
        let remote = self.winner.as_deref() == Some("remote");
        c.set("localContent", if remote { l.clone() } else { w.clone() });
        c.set("remoteContent", if remote { w } else { l.clone() });
        let loser_content = js::or(self.get("loserContent").as_ref()).cloned().unwrap_or(l);
        c.set("loserContent", loser_content);
        c
    }

    /// Die Events einer Entscheidung (`applyConflictAction`), in Ausführungsreihenfolge als
    /// `(type, payload)`. Danach gilt der Konflikt als erledigt ([`Conflict::key`] aus der Liste).
    pub fn resolve(&self, state: &State, how: Resolution) -> Result<Vec<(String, Value)>, ResolveError> {
        let copy_id = js::or(self.get("conflictPageId").as_ref()).map(js::to_string);
        let copy = copy_id.as_deref().and_then(|id| state.pages.get(id));
        let delete = self.conflict_type.as_deref() == Some("delete-change");
        let mut out = Vec::new();
        let update = |id: &str, patch: Value| ("pageUpdate".to_owned(), json!({ "id": id, "patch": patch }));
        if how == Resolution::UseLoser {
            if delete {
                let (Some(id), Some(_)) = (&copy_id, copy) else { return Err(ResolveError::CopyMissing) };
                out.push(update(
                    id,
                    json!({
                        "title": self.get("title").unwrap_or(Value::Null),
                        "parentId": js::or_null(self.get("parentId").as_ref()),
                        "workspaceId": js::or_str(self.get("workspaceId").as_ref(), "default"),
                    }),
                ));
            } else {
                let loser = match self.get("loserContent") {
                    Some(v) if !v.is_null() => Some(v),
                    _ => copy.and_then(|p| p.get("content")),
                };
                let page = js::or(self.get("pageId").as_ref()).map(js::to_string);
                match (page, loser) {
                    (Some(page), Some(Value::String(text))) => out.push(update(&page, json!({ "content": text }))),
                    _ => return Err(ResolveError::LoserMissing),
                }
            }
        }
        if let (Some(id), Some(_)) = (&copy_id, copy) {
            if how == Resolution::KeepBoth {
                out.push(update(id, json!({ "title": format!("{} (Kopie)", self.display_title()) })));
            }
            if how == Resolution::KeepWinner || (how == Resolution::UseLoser && !delete) {
                out.push(("pageTrash".to_owned(), json!({ "id": id })));
            }
        }
        Ok(out)
    }
}

/// `conflictTitle` für einen Titeltext.
pub fn conflict_title(title: &str) -> String {
    let s = strip_copy_prefix(title);
    // / — Stand .*$/: erste Fundstelle, hinter der kein Zeilenumbruch mehr kommt.
    let cut =
        s.match_indices(" — Stand ").map(|(i, _)| i).find(|&i| !s[i + " — Stand ".len()..].contains(is_line_break));
    let s = cut.map_or(s, |i| &s[..i]);
    if s.is_empty() { "Seite".to_owned() } else { s.to_owned() }
}

/// Zählt als offene Konfliktkopie (Titel mit ⚠ und nicht schon quittiert)?
pub fn is_conflict_page(page: &Page, resolved: &HashSet<String>) -> bool {
    page.title().starts_with(CONFLICT_PREFIX) && !resolved.contains(page.id())
}

/// Offene Konflikte zusammenführen (`mergePendingConflicts`): gleicher Schlüssel ersetzt, Platz bleibt.
pub fn merge_pending(list: Vec<Conflict>, details: Vec<Conflict>) -> Vec<Conflict> {
    let mut map: IndexMap<String, Conflict> = list.into_iter().map(|c| (c.key(), c)).collect();
    for c in details {
        map.insert(c.key(), c);
    }
    map.into_values().collect()
}

/// Liste ohne den erledigten Konflikt (`copyId || pageId`).
pub fn without_resolved(list: Vec<Conflict>, done: &Conflict) -> Vec<Conflict> {
    let key = js::key_of(js::or(done.get("conflictPageId").as_ref()).cloned().or_else(|| done.get("pageId")).as_ref());
    list.into_iter().filter(|c| c.key() != key).collect()
}

fn text_lines(text: &str) -> Vec<&str> {
    text.split('\n').map(js::trim).filter(|l| !l.is_empty()).collect()
}

/// Ergebnis von [`legacy_copy_info`].
#[derive(Debug, Clone, PartialEq)]
pub struct LegacyInfo {
    pub title: String,
    /// Kopie einer Kopie (mehrfaches Präfix) – kann immer weg.
    pub nested: bool,
    /// Die heutige Seite, von der die Kopie stammt.
    pub original: Option<String>,
    /// Zeilen der Kopie, die im Original fehlen.
    pub extra_lines: Option<usize>,
}

fn nested_prefix(title: &str) -> bool {
    // /^(⚠ Konflikt[^:]*:\s*){2,}/
    let mut s = title;
    let mut n = 0;
    while let Some(rest) = s.strip_prefix(CONFLICT_PREFIX) {
        let Some(colon) = rest.find(':') else { break };
        s = rest[colon + 1..].trim_start_matches(impala_search::text::is_js_space);
        n += 1;
    }
    n >= 2
}

/// Vergleicht eine gerettete Alt-Kopie mit der heutigen Seite gleichen Titels (`legacyCopyInfo`).
pub fn legacy_copy_info(copy: &Page, pages: &[&Page]) -> LegacyInfo {
    let title = conflict_title(&js::str_or_empty(copy.get("title").as_ref()));
    let nested = nested_prefix(copy.title());
    let copy_lines = text_lines(copy.content());
    let mut others: Vec<&Page> =
        pages.iter().copied().filter(|p| p.id() != copy.id() && !p.title().starts_with(CONFLICT_PREFIX)).collect();
    others.sort_by(|a, b| js::cmp(b.updated(), a.updated()));
    let missing_in = |p: &Page| {
        let have: HashSet<&str> = text_lines(p.content()).into_iter().collect();
        copy_lines.iter().filter(|l| !have.contains(*l)).count()
    };
    let same: Vec<&Page> = others.iter().copied().filter(|p| p.title.as_deref() == Some(title.as_str())).collect();
    let original = same
        .iter()
        .find(|p| p.parent() == copy.parent())
        .or(same.first())
        .copied()
        .or_else(|| if copy_lines.is_empty() { None } else { others.iter().copied().find(|p| missing_in(p) == 0) });
    LegacyInfo { title, nested, original: original.map(|p| p.id().to_owned()), extra_lines: original.map(missing_in) }
}

/// Gerettete Kopien früherer Konflikte als Einträge (`legacyConflictItems`).
pub fn legacy_conflict_items(state: &State, resolved: &HashSet<String>) -> Vec<Conflict> {
    let pages = state.active_pages();
    pages
        .iter()
        .filter(|p| is_conflict_page(p, resolved))
        .map(|p| {
            let info = legacy_copy_info(p, &pages);
            let original = info.original.as_deref().and_then(|id| state.pages.get(id));
            let content = json!(js::str_or_empty(p.get("content").as_ref()));
            let mut c = Conflict::default();
            c.set("pageId", original.map_or(Value::Null, |o| json!(o.id())));
            c.set("originalTitle", original.map_or(Value::Null, |o| js::or_null(o.get("title").as_ref())));
            c.set("title", json!(info.title));
            c.set("nested", json!(info.nested));
            c.set("extraLines", info.extra_lines.map_or(Value::Null, |n| json!(n)));
            c.set("localContent", content.clone());
            c.set(
                "remoteContent",
                original.map_or(Value::Null, |o| json!(js::str_or_empty(o.get("content").as_ref()))),
            );
            if let Some(t) = p.get("updated") {
                c.set("localTime", t);
            }
            c.set(
                "remoteTime",
                original.and_then(|o| js::or(o.get("updated").as_ref()).cloned()).unwrap_or(Value::Null),
            );
            c.set("winner", json!("remote"));
            c.set("loserContent", content);
            if let Some(t) = p.get("updated") {
                c.set("loserTime", t);
            }
            c.set("conflictPageId", json!(p.id()));
            c.set("eventId", Value::Null);
            c.set("legacy", json!(true));
            c
        })
        .collect()
}

// ---- Zeilenvergleich -----------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineChange {
    Same,
    Add,
    Del,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffLine {
    #[serde(rename = "type")]
    pub change: LineChange,
    pub text: String,
}

/// Zeilen-Diff (`U.diffLines`); über 400 Zeilen je Seite nur eine grobe Zusammenfassung.
pub fn diff_lines(a: &str, b: &str) -> Vec<DiffLine> {
    let (x, y): (Vec<&str>, Vec<&str>) = (a.split('\n').collect(), b.split('\n').collect());
    let line = |change, text: &str| DiffLine { change, text: text.to_owned() };
    if x.len() > 400 || y.len() > 400 {
        let mut out = Vec::new();
        if !a.is_empty() {
            out.push(line(LineChange::Del, &format!("(bisheriger Inhalt, {} Zeilen)", x.len())));
        }
        if !b.is_empty() {
            out.push(line(LineChange::Add, &format!("(neuer Inhalt, {} Zeilen)", y.len())));
        }
        return out;
    }
    let (n, m) = (x.len(), y.len());
    let w = m + 1;
    let mut dp = vec![0u32; (n + 1) * w];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i * w + j] =
                if x[i] == y[j] { dp[(i + 1) * w + j + 1] + 1 } else { dp[(i + 1) * w + j].max(dp[i * w + j + 1]) };
        }
    }
    let mut out = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if x[i] == y[j] {
            out.push(line(LineChange::Same, x[i]));
            i += 1;
            j += 1;
        } else if dp[(i + 1) * w + j] >= dp[i * w + j + 1] {
            out.push(line(LineChange::Del, x[i]));
            i += 1;
        } else {
            out.push(line(LineChange::Add, y[j]));
            j += 1;
        }
    }
    out.extend(x[i..].iter().map(|t| line(LineChange::Del, t)));
    out.extend(y[j..].iter().map(|t| line(LineChange::Add, t)));
    out
}

/// Darüber zeigt der Dialog beide Volltexte nebeneinander.
pub const DIFF_MAX_MIDDLE: usize = 400;

/// Vergleich zweier Fassungen (`conflictDiff`): gleicher Anfang/Ende abgeschnitten, nur die Mitte
/// gediffed. `None`: die Mitte ist zu groß.
pub fn conflict_diff(left: &str, right: &str) -> Option<Vec<DiffLine>> {
    let (a, b): (Vec<&str>, Vec<&str>) = (left.split('\n').collect(), right.split('\n').collect());
    let mut pre = 0;
    while pre < a.len() && pre < b.len() && a[pre] == b[pre] {
        pre += 1;
    }
    let mut post = 0;
    while post < a.len() - pre && post < b.len() - pre && a[a.len() - 1 - post] == b[b.len() - 1 - post] {
        post += 1;
    }
    let (mid_a, mid_b) = (&a[pre..a.len() - post], &b[pre..b.len() - post]);
    if mid_a.len() > DIFF_MAX_MIDDLE || mid_b.len() > DIFF_MAX_MIDDLE {
        return None;
    }
    let line = |change, t: &&str| DiffLine { change, text: (*t).to_owned() };
    let mut out: Vec<DiffLine> = a[..pre].iter().map(|t| line(LineChange::Same, t)).collect();
    if mid_a.is_empty() && !mid_b.is_empty() {
        out.extend(mid_b.iter().map(|t| line(LineChange::Add, t)));
    } else if mid_b.is_empty() && !mid_a.is_empty() {
        out.extend(mid_a.iter().map(|t| line(LineChange::Del, t)));
    } else if !mid_a.is_empty() {
        out.extend(diff_lines(&mid_a.join("\n"), &mid_b.join("\n")));
    }
    out.extend(a[a.len() - post..].iter().map(|t| line(LineChange::Same, t)));
    Some(out)
}

/// Zeile der zweispaltigen Ansicht.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Row {
    Line {
        left: Option<String>,
        right: Option<String>,
        changed: bool,
        /// Beginn eines Änderungsblocks (Sprungziel „Nächste Änderung“).
        start: bool,
    },
    /// So viele unveränderte Zeilen eingeklappt.
    Gap(usize),
}

const COLLAPSE_AFTER: usize = 8;
const COLLAPSE_KEEP: usize = 3;

/// Beide Spalten zeilengenau ausrichten (`alignDiffRows`).
pub fn align_diff_rows(diff: &[DiffLine]) -> Vec<Row> {
    let mut rows: Vec<Row> = Vec::new();
    let (mut dels, mut adds): (Vec<String>, Vec<String>) = (Vec::new(), Vec::new());
    let flush = |rows: &mut Vec<Row>, dels: &mut Vec<String>, adds: &mut Vec<String>| {
        let n = dels.len().max(adds.len());
        for k in 0..n {
            rows.push(Row::Line {
                left: dels.get(k).cloned(),
                right: adds.get(k).cloned(),
                changed: true,
                start: k == 0,
            });
        }
        dels.clear();
        adds.clear();
    };
    for d in diff {
        match d.change {
            LineChange::Del => dels.push(d.text.clone()),
            LineChange::Add => adds.push(d.text.clone()),
            LineChange::Same => {
                flush(&mut rows, &mut dels, &mut adds);
                rows.push(Row::Line {
                    left: Some(d.text.clone()),
                    right: Some(d.text.clone()),
                    changed: false,
                    start: false,
                });
            }
        }
    }
    flush(&mut rows, &mut dels, &mut adds);
    let changed = |r: &Row| matches!(r, Row::Line { changed: true, .. });
    let mut out = Vec::new();
    let mut i = 0;
    while i < rows.len() {
        if changed(&rows[i]) {
            out.push(rows[i].clone());
            i += 1;
            continue;
        }
        let mut j = i;
        while j < rows.len() && !changed(&rows[j]) {
            j += 1;
        }
        let run = j - i;
        if run <= COLLAPSE_AFTER {
            out.extend_from_slice(&rows[i..j]);
        } else {
            out.extend_from_slice(&rows[i..i + COLLAPSE_KEEP]);
            out.push(Row::Gap(run - 2 * COLLAPSE_KEEP));
            out.extend_from_slice(&rows[j - COLLAPSE_KEEP..j]);
        }
        i = j;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titel_ohne_praefix() {
        assert_eq!(
            conflict_title("⚠ Konflikt: ⚠ Konflikt (gelöscht/verschoben):  Mathe — Stand 2026-01-01 10:00"),
            "Mathe"
        );
        assert_eq!(conflict_title("⚠ Konflikt: "), "Seite");
        assert_eq!(conflict_title("A — Stand x\ny"), "A — Stand x\ny");
        assert!(nested_prefix("⚠ Konflikt: ⚠ Konflikt (x): a"));
        assert!(!nested_prefix("⚠ Konflikt: a"));
    }
}
