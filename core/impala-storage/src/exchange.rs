//! Export/Import im Format von `DB.exportAll`/`DB.importAll` der PWA:
//! `{ app: "impala67", version: 1, exportedAt, events: [...], blobs: { key: { meta?, b64 } } }`.
//! Ein PWA-Export lässt sich hier einspielen und umgekehrt.

use std::collections::HashSet;

use base64::Engine;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use serde_json::Value;

use crate::event::{self, Object};
use crate::storage::{Blob, Storage, Write};
use crate::{Error, checkpoint, compaction, js};

/// Gerätelokale Kompaktierungs-Untergrenze (PWA: `localStorage["impala67_compact_floor"]`).
pub const COMPACT_FLOOR_KEY: &str = "impala67_compact_floor";
/// Nur diese Typen blockiert die Untergrenze; alte Inhalts-Patches müssen weiter ankommen.
pub const DROPPABLE_TYPES: [&str; 2] = ["uiTabsSet", "uiTreeSet"];

/// `atob` ist nachsichtig: Leerraum und fehlendes Padding sind erlaubt.
const LENIENT: GeneralPurpose = GeneralPurpose::new(
    &base64::alphabet::STANDARD,
    GeneralPurposeConfig::new()
        .with_decode_padding_mode(DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true),
);

fn decode_b64(s: &str) -> Option<Vec<u8>> {
    let clean: String = s.chars().filter(|c| !matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0c')).collect();
    LENIENT.decode(clean).ok()
}

#[derive(Debug, Clone)]
pub struct ExportOptions {
    /// `false` spart die Blobs (Drive-Snapshot).
    pub include_blobs: bool,
    /// Standard: Geheimnisse entfernen (Exporte können das Konto verlassen).
    pub redact_secrets: bool,
    /// Zeitstempel für `exportedAt` (der Kern hat keine Uhr).
    pub exported_at: String,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self { include_blobs: true, redact_secrets: true, exported_at: String::new() }
    }
}

/// Export als JSON-Text, Bytes wie `JSON.stringify` der PWA. Events kompaktiert und in
/// Log-Reihenfolge (nach `t`, dann `seq`), ohne gerätelokale Marken.
pub fn export_all<S: Storage + ?Sized>(storage: &S, opts: &ExportOptions) -> Result<String, Error> {
    let mut all = storage.events_after(0, None, None)?;
    let order = compaction::keep_indices(&all).unwrap_or_else(|| {
        // Ohne Kompaktierung (unbekannte Event-Form) trotzdem dieselbe Reihenfolge.
        let mut order: Vec<usize> = (0..all.len()).collect();
        order.sort_by(|&a, &b| {
            js::cmp(event::time(&all[a]), event::time(&all[b])).then(event::seq(&all[a]).cmp(&event::seq(&all[b])))
        });
        order
    });
    let mut events = Vec::with_capacity(order.len());
    for i in order {
        let ev = event::strip_local_flags(std::mem::take(&mut all[i]));
        let ev = if opts.redact_secrets { event::redact_secrets(ev) } else { Some(ev) };
        events.extend(ev.map(Value::Object));
    }
    let mut blobs = Object::new();
    if opts.include_blobs {
        for key in storage.blob_keys()? {
            let Some(blob) = storage.blob(&key)? else { continue };
            let mut entry = Object::new();
            if let Some(meta) = blob.meta {
                entry.insert("meta".into(), meta);
            }
            entry.insert("b64".into(), Value::from(base64::engine::general_purpose::STANDARD.encode(&blob.bytes)));
            blobs.insert(key, Value::Object(entry));
        }
    }
    let mut file = Object::new();
    file.insert("app".into(), Value::from("impala67"));
    file.insert("version".into(), Value::from(1));
    file.insert("exportedAt".into(), Value::from(opts.exported_at.clone()));
    file.insert("events".into(), Value::Array(events));
    file.insert("blobs".into(), Value::Object(blobs));
    Ok(js::stringify(&Value::Object(file)))
}

#[derive(Debug, Clone, Default)]
pub struct ImportOptions {
    /// `Some(quelle)`: echter Download eines Sync-Transports („drive“, „cloudflare“). Diese Events
    /// werden `_remote` markiert und nicht wieder hochgeladen. `None`: lokale Nutzeraktion (Backup).
    pub remote: Option<String>,
    /// Nur bei `remote`: `false` entfernt Geheimnisse aus eingehenden Einstellungen.
    pub deny_secrets: bool,
}

/// Geprüfter, noch nicht geschriebener Import. Die Sync-Schicht darf vor dem Schreiben
/// abgeleitete Events (Merge/Konfliktkopien, `_derived`) an `fresh` anhängen.
#[derive(Debug, Clone)]
pub struct PreparedImport {
    /// Neue Events (Dubletten und Events unter der Kompaktierungs-Untergrenze sind raus).
    pub fresh: Vec<Object>,
    /// Unbrauchbare Events (fehlende id/t/type).
    pub malformed: usize,
    remote_ids: HashSet<String>,
    remote_source: Option<String>,
    blobs: Object,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImportReport {
    pub added: usize,
    pub malformed: usize,
    /// Blobs mit kaputtem Base64 (JS brach dann den Rest des Imports ab).
    pub bad_blobs: usize,
    /// Die geschriebenen Events (ohne `seq`) für den Live-Replay.
    pub imported: Vec<Object>,
}

/// Prüft eine Exportdatei bzw. ein Sync-Paket gegen den lokalen Log.
pub fn prepare<S: Storage + ?Sized>(storage: &S, data: &Value, opts: &ImportOptions) -> Result<PreparedImport, Error> {
    let app = data.get("app").and_then(Value::as_str);
    if !data.is_object() || !matches!(app, Some("impala67" | "notion")) {
        return Err(Error::NotAnExport);
    }
    let incoming = data.get("events").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    let normalized: Vec<Object> = incoming.iter().filter_map(event::normalize_incoming).collect();
    let malformed = incoming.len() - normalized.len();
    let normalized: Vec<Object> = if opts.remote.is_some() && opts.deny_secrets {
        normalized.into_iter().filter_map(event::redact_secrets).collect()
    } else {
        normalized
    };
    let floor = storage.meta(COMPACT_FLOOR_KEY)?.unwrap_or_default();
    let keys: Vec<String> = normalized.iter().filter_map(|ev| ev.get("id").and_then(event::id_key)).collect();
    let mut seen = storage.known_ids(&keys)?;
    let mut fresh = Vec::new();
    for ev in normalized {
        let Some(key) = ev.get("id").and_then(event::id_key) else { continue };
        let below_floor = !floor.is_empty()
            && js::cmp(event::time(&ev), &floor).is_lt()
            && DROPPABLE_TYPES.contains(&event::kind(&ev));
        if below_floor || !seen.insert(key) {
            continue;
        }
        fresh.push(ev);
    }
    let remote_ids = match opts.remote {
        Some(_) => fresh.iter().filter_map(|ev| ev.get("id").and_then(event::id_key)).collect(),
        None => HashSet::new(),
    };
    let blobs = data.get("blobs").and_then(Value::as_object).cloned().unwrap_or_default();
    Ok(PreparedImport { fresh, malformed, remote_ids, remote_source: opts.remote.clone(), blobs })
}

/// Schreibt einen geprüften Import: Events (neue lokale `seq`) und fehlende Blobs in EINER
/// Transaktion. Abweichung von JS: dort lagen Events und Blobs in getrennten Transaktionen.
pub fn commit<S: Storage + ?Sized>(storage: &mut S, prepared: PreparedImport) -> Result<ImportReport, Error> {
    let PreparedImport { fresh, malformed, remote_ids, remote_source, blobs } = prepared;
    let mut imported = Vec::with_capacity(fresh.len());
    for mut ev in fresh {
        ev.shift_remove("seq");
        if ev.get("id").and_then(event::id_key).is_some_and(|k| remote_ids.contains(&k)) {
            ev.insert("_remote".into(), Value::Bool(true));
            ev.insert("_remoteSource".into(), Value::from(remote_source.clone().unwrap_or_else(|| "drive".into())));
        }
        imported.push(ev);
    }
    let mut writes: Vec<Write> = imported.iter().cloned().map(Write::AddEvent).collect();
    let mut bad_blobs = 0;
    if !blobs.is_empty() {
        let have: HashSet<String> = storage.blob_keys()?.into_iter().collect();
        for (key, entry) in blobs {
            if checkpoint::is_checkpoint_key(&key) || have.contains(&key) {
                continue;
            }
            match entry.get("b64").and_then(Value::as_str).and_then(decode_b64) {
                Some(bytes) => writes.push(Write::PutBlob(key, Blob { bytes, meta: entry.get("meta").cloned() })),
                None => bad_blobs += 1,
            }
        }
    }
    storage.apply(writes)?;
    Ok(ImportReport { added: imported.len(), malformed, bad_blobs, imported })
}

/// `importAll` ohne Konflikterkennung: prüfen und schreiben.
pub fn import_all<S: Storage + ?Sized>(
    storage: &mut S,
    json: &str,
    opts: &ImportOptions,
) -> Result<ImportReport, Error> {
    let data: Value = serde_json::from_str(json).map_err(|e| Error::Json(e.to_string()))?;
    let prepared = prepare(storage, &data, opts)?;
    commit(storage, prepared)
}
