//! SQLite-Standardimplementierung für die nativen Apps.
//!
//! Schema mit Versionsnummer (`PRAGMA user_version`); Migrationen fügen nur hinzu und laufen je
//! Schritt in einer Transaktion. Eine Datenbank aus einer neueren App-Version wird nicht
//! angefasst ([`Error::NewerSchema`]). WAL-Modus: Lesen blockiert Schreiben nicht.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::Value;

use crate::Error;
use crate::event::{LogInfo, Object, Seq, id_key, is_own};
use crate::memory::with_seq;
use crate::storage::{Blob, CheckpointSlot, PartKind, Storage, Write};

/// Migrationen in Reihenfolge; Index + 1 = Schema-Version danach. Nie ändern, nur anhängen.
const MIGRATIONS: &[&str] = &[
    // 1: Stores wie in IndexedDB. AUTOINCREMENT: Nummern werden nie wiederverwendet (wie der
    // IndexedDB-Schlüsselgenerator), sonst hielte der Sync einen Log nach Löschungen für neu.
    "CREATE TABLE events (
        seq  INTEGER PRIMARY KEY AUTOINCREMENT,
        id   TEXT,            -- Dublettenschlüssel (event::id_key), nicht eindeutig: Altdaten nie abweisen
        body TEXT NOT NULL    -- Event als JSON, ohne seq
    );
    CREATE INDEX events_id ON events(id);
    CREATE TABLE blobs (key TEXT PRIMARY KEY, bytes BLOB NOT NULL, meta TEXT);
    CREATE TABLE vecs (key TEXT PRIMARY KEY, rec TEXT NOT NULL);
    CREATE TABLE checkpoints (slot INTEGER PRIMARY KEY, rec TEXT NOT NULL);
    CREATE TABLE checkpoint_parts (
        kind INTEGER NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (kind, hash)
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    // 2: Eigene Events (`event::is_own`) markiert und indiziert: Die Konflikt-Prüfung liest sonst
    // je Import das ganze Log – nach einer Wiederherstellung sind das fast nur übernommene Events.
    // Unlesbare Zeilen gelten als fremd (lesen ließen sie sich ohnehin nicht).
    "ALTER TABLE events ADD COLUMN own INTEGER NOT NULL DEFAULT 0;
    UPDATE events SET own = CASE WHEN json_valid(body) THEN
        COALESCE(json_extract(body, '$._remote') IN (0, ''), 1)
        AND COALESCE(json_extract(body, '$._derived') IN (0, ''), 1)
    ELSE 0 END;
    CREATE INDEX events_own ON events(seq) WHERE own = 1;",
    // 3: Heft-Bilder nur noch einmal speichern. `blob_hash` markiert `heftBlob`-Events mit Daten;
    // ein Checkpoint-Bild ist dann ein Verweis (`seq`, `data` leer) auf sein Event statt einer
    // zweiten Kopie. Vorhandene Kopien werden hier umgestellt, wenn das Bild im Log liegt.
    "ALTER TABLE events ADD COLUMN blob_hash TEXT;
    UPDATE events SET blob_hash = json_extract(body, '$.payload.hash')
        WHERE CASE WHEN json_valid(body) THEN json_extract(body, '$.type') = 'heftBlob'
            AND json_type(body, '$.payload.hash') = 'text' AND json_type(body, '$.payload.data') = 'text'
        ELSE 0 END;
    CREATE INDEX events_blob ON events(blob_hash, seq) WHERE blob_hash IS NOT NULL;
    ALTER TABLE checkpoint_parts ADD COLUMN seq INTEGER;
    UPDATE checkpoint_parts
        SET seq = (SELECT MAX(e.seq) FROM events e WHERE e.blob_hash = checkpoint_parts.hash), data = ''
        WHERE kind = 1 AND EXISTS (SELECT 1 FROM events e WHERE e.blob_hash = checkpoint_parts.hash);",
];

pub const SCHEMA_VERSION: u32 = MIGRATIONS.len() as u32;

fn db(e: rusqlite::Error) -> Error {
    Error::Backend(e.to_string())
}

fn json_err(e: serde_json::Error) -> Error {
    Error::Json(e.to_string())
}

fn slot_id(slot: CheckpointSlot) -> i64 {
    match slot {
        CheckpointSlot::Legacy => 1,
        CheckpointSlot::Current => 2,
    }
}

fn kind_id(kind: PartKind) -> i64 {
    match kind {
        PartKind::HeftBlob => 1,
        PartKind::HeftDoc => 2,
    }
}

fn to_i64(seq: Seq) -> i64 {
    i64::try_from(seq).unwrap_or(i64::MAX)
}

fn parse_object(text: &str) -> Result<Object, Error> {
    serde_json::from_str(text).map_err(json_err)
}

pub struct SqliteStorage {
    conn: Connection,
}

impl SqliteStorage {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, Error> {
        Self::init(Connection::open(path).map_err(db)?)
    }

    pub fn open_in_memory() -> Result<Self, Error> {
        Self::init(Connection::open_in_memory().map_err(db)?)
    }

    fn init(mut conn: Connection) -> Result<Self, Error> {
        // journal_mode liefert eine Zeile zurück („wal“ bzw. „memory“).
        conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(())).map_err(db)?;
        // journal_size_limit: Nach jedem WAL-Checkpoint schrumpft das Schreib-Log wieder auf
        // höchstens 4 MB, statt so groß zu bleiben wie die größte Schreibspitze.
        conn.execute_batch("PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA journal_size_limit = 4194304;")
            .map_err(db)?;
        migrate(&mut conn)?;
        Ok(Self { conn })
    }

    /// Platz gelöschter Zeilen ans System zurückgeben: SQLite verwendet freie Seiten nur wieder,
    /// die Datei schrumpft nie von selbst. `VACUUM` baut sie neu – nur, wenn mindestens ein Viertel
    /// (und ≥ 1 MB) leer steht, denn es schreibt die ganze Datei. Liefert, ob neu gebaut wurde.
    pub fn reclaim(&self) -> Result<bool, Error> {
        let pragma = |name: &str| self.conn.query_row(&format!("PRAGMA {name}"), [], |r| r.get::<_, i64>(0)).map_err(db);
        let (pages, free, page_size) = (pragma("page_count")?, pragma("freelist_count")?, pragma("page_size")?);
        let vacuum = free * page_size >= 1 << 20 && free * 4 >= pages;
        if vacuum {
            self.conn.execute_batch("VACUUM").map_err(db)?;
        }
        // Liefert eine Zeile (busy, log, checkpointed).
        self.conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())).map_err(db)?;
        Ok(vacuum)
    }

    pub fn schema_version(&self) -> Result<u32, Error> {
        self.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(db)
    }

    /// Kontrolle gegen doppelten Speicher (wie `DB.storageCheck()` der PWA); im Normalfall alles 0.
    /// `blobs`: aktueller Heft-Zustand, sonst bleiben verwaiste Bilder ungezählt. Liest alle
    /// Bild-Events einmal – nur auf Nachfrage aufrufen.
    pub fn storage_check(&self, blobs: Option<&impala_sync::BlobKeep>) -> Result<StorageCheck, Error> {
        let blob = kind_id(PartKind::HeftBlob);
        let (copies, copies_bytes): (i64, i64) = self
            .conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(length(data)), 0) FROM checkpoint_parts p
                WHERE kind = ?1 AND seq IS NULL AND EXISTS (SELECT 1 FROM events e WHERE e.blob_hash = p.hash)",
                [blob],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(db)?;
        let dead: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM checkpoint_parts p WHERE kind = ?1 AND seq IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM events e WHERE e.seq = p.seq AND e.blob_hash = p.hash)",
                [blob],
                |r| r.get(0),
            )
            .map_err(db)?;
        let mut check = StorageCheck {
            checkpoint_copies: copies as u64,
            checkpoint_copies_bytes: copies_bytes as u64,
            dead_pointers: dead as u64,
            live_known: blobs.is_some(),
            ..StorageCheck::default()
        };
        if let Some(keep) = blobs {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT blob_hash, COALESCE(json_extract(body, '$.t'), ''), length(json_extract(body, '$.payload.data'))
                    FROM events WHERE blob_hash IS NOT NULL",
                )
                .map_err(db)?;
            let mut rows = stmt.query([]).map_err(db)?;
            while let Some(r) = rows.next().map_err(db)? {
                let hash: String = r.get(0).map_err(db)?;
                let t: String = r.get(1).map_err(db)?;
                if !keep.live.contains(&hash) && crate::js::cmp(&t, keep.since).is_lt() {
                    check.orphan_images += 1;
                    check.orphan_images_bytes += r.get::<_, Option<i64>>(2).map_err(db)?.unwrap_or(0) as u64;
                }
            }
        }
        Ok(check)
    }
}

/// Ergebnis von [`SqliteStorage::storage_check`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StorageCheck {
    /// Checkpoint-Bilder als Kopie, obwohl das Bild im Log liegt (sollte ein Verweis sein).
    pub checkpoint_copies: u64,
    pub checkpoint_copies_bytes: u64,
    /// Verweise auf ein Event, das es nicht (mehr) gibt (gelesen wird dann ein anderes desselben Bildes).
    pub dead_pointers: u64,
    /// Bilder, die kein Heft zeigt, älter als die Schonfrist (fallen bei der nächsten Kompaktierung).
    pub orphan_images: u64,
    pub orphan_images_bytes: u64,
    /// Ob der Heft-Zustand bekannt war (sonst ist `orphan_images` nicht gezählt).
    pub live_known: bool,
}

impl StorageCheck {
    pub fn ok(&self) -> bool {
        self.checkpoint_copies == 0 && self.dead_pointers == 0 && self.orphan_images == 0
    }
}

fn migrate(conn: &mut Connection) -> Result<(), Error> {
    let found: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(db)?;
    if found > SCHEMA_VERSION {
        return Err(Error::NewerSchema { found, supported: SCHEMA_VERSION });
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(found as usize) {
        let tx = conn.transaction().map_err(db)?;
        tx.execute_batch(sql).map_err(db)?;
        tx.pragma_update(None, "user_version", i as u32 + 1).map_err(db)?;
        tx.commit().map_err(db)?;
    }
    Ok(())
}

/// Hash eines `heftBlob`-Events mit Bilddaten (Spalte `blob_hash`, Regel wie Migration 3).
fn blob_hash_of(ev: &Object) -> Option<&str> {
    if ev.get("type").and_then(Value::as_str) != Some("heftBlob") {
        return None;
    }
    let p = ev.get("payload")?;
    p.get("data")?.as_str()?;
    p.get("hash")?.as_str()
}

/// Neuestes Event mit diesem Bild.
fn blob_event(conn: &Connection, hash: &str) -> Result<Option<i64>, Error> {
    conn.prepare_cached("SELECT MAX(seq) FROM events WHERE blob_hash = ?1")
        .and_then(|mut s| s.query_row([hash], |r| r.get(0)))
        .map_err(db)
}

fn apply_one(tx: &Transaction, w: Write, added: &mut Vec<Seq>) -> Result<(), Error> {
    match w {
        Write::AddEvent(mut ev) => {
            ev.shift_remove("seq");
            let id = ev.get("id").and_then(id_key);
            let own = is_own(&ev);
            let blob_hash = blob_hash_of(&ev);
            let body = serde_json::to_string(&ev).map_err(json_err)?;
            tx.prepare_cached("INSERT INTO events (id, body, own, blob_hash) VALUES (?1, ?2, ?3, ?4)")
                .and_then(|mut s| s.execute(params![id, body, own, blob_hash]))
                .map_err(db)?;
            added.push(tx.last_insert_rowid() as Seq);
        }
        Write::DeleteEvent(seq) => {
            let seq = to_i64(seq);
            let hash: Option<String> = tx
                .prepare_cached("SELECT blob_hash FROM events WHERE seq = ?1")
                .and_then(|mut s| s.query_row([seq], |r| r.get(0)).optional())
                .map_err(db)?
                .flatten();
            // Zeigt ein Checkpoint-Bild auf dieses Event: auf ein anderes mit demselben Bild umhängen,
            // sonst die Daten als Kopie übernehmen – ein Verweis geht nie ins Leere.
            if let Some(hash) = &hash {
                tx.prepare_cached(
                    "UPDATE checkpoint_parts SET
                        data = CASE WHEN EXISTS (SELECT 1 FROM events WHERE blob_hash = ?2 AND seq <> ?1) THEN ''
                            ELSE (SELECT json_extract(body, '$.payload.data') FROM events WHERE seq = ?1) END,
                        seq = (SELECT MAX(seq) FROM events WHERE blob_hash = ?2 AND seq <> ?1)
                    WHERE kind = ?3 AND hash = ?2 AND seq = ?1",
                )
                .and_then(|mut s| s.execute(params![seq, hash, kind_id(PartKind::HeftBlob)]))
                .map_err(db)?;
            }
            tx.prepare_cached("DELETE FROM events WHERE seq = ?1").and_then(|mut s| s.execute([seq])).map_err(db)?;
        }
        Write::PutBlob(key, blob) => {
            let meta = blob.meta.as_ref().map(serde_json::to_string).transpose().map_err(json_err)?;
            tx.prepare_cached("INSERT OR REPLACE INTO blobs (key, bytes, meta) VALUES (?1, ?2, ?3)")
                .and_then(|mut s| s.execute(params![key, blob.bytes, meta]))
                .map_err(db)?;
        }
        Write::DeleteBlob(key) => {
            tx.prepare_cached("DELETE FROM blobs WHERE key = ?1").and_then(|mut s| s.execute([key])).map_err(db)?;
        }
        Write::PutVec(key, rec) => {
            let rec = serde_json::to_string(&rec).map_err(json_err)?;
            tx.prepare_cached("INSERT OR REPLACE INTO vecs (key, rec) VALUES (?1, ?2)")
                .and_then(|mut s| s.execute(params![key, rec]))
                .map_err(db)?;
        }
        Write::DeleteVec(key) => {
            tx.prepare_cached("DELETE FROM vecs WHERE key = ?1").and_then(|mut s| s.execute([key])).map_err(db)?;
        }
        Write::ClearVecs => {
            tx.execute("DELETE FROM vecs", []).map_err(db)?;
        }
        Write::PutCheckpoint(slot, cp) => {
            let rec = serde_json::to_string(&cp).map_err(json_err)?;
            tx.prepare_cached("INSERT OR REPLACE INTO checkpoints (slot, rec) VALUES (?1, ?2)")
                .and_then(|mut s| s.execute(params![slot_id(slot), rec]))
                .map_err(db)?;
        }
        Write::DeleteCheckpoint(slot) => {
            tx.prepare_cached("DELETE FROM checkpoints WHERE slot = ?1")
                .and_then(|mut s| s.execute([slot_id(slot)]))
                .map_err(db)?;
        }
        Write::PutPart(kind, hash, data) => {
            // Liegt das Bild im Log, genügt ein Verweis auf sein Event (keine zweite Kopie).
            let seq = match kind {
                PartKind::HeftBlob => blob_event(tx, &hash)?,
                PartKind::HeftDoc => None,
            };
            let data = if seq.is_some() { String::new() } else { data };
            tx.prepare_cached("INSERT OR REPLACE INTO checkpoint_parts (kind, hash, data, seq) VALUES (?1, ?2, ?3, ?4)")
                .and_then(|mut s| s.execute(params![kind_id(kind), hash, data, seq]))
                .map_err(db)?;
        }
        Write::DeletePart(kind, hash) => {
            tx.prepare_cached("DELETE FROM checkpoint_parts WHERE kind = ?1 AND hash = ?2")
                .and_then(|mut s| s.execute(params![kind_id(kind), hash]))
                .map_err(db)?;
        }
        Write::ClearParts(kind) => {
            tx.execute("DELETE FROM checkpoint_parts WHERE kind = ?1", [kind_id(kind)]).map_err(db)?;
        }
        Write::SetMeta(key, Some(value)) => {
            tx.prepare_cached("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)")
                .and_then(|mut s| s.execute(params![key, value]))
                .map_err(db)?;
        }
        Write::SetMeta(key, None) => {
            tx.execute("DELETE FROM meta WHERE key = ?1", [key]).map_err(db)?;
        }
    }
    Ok(())
}

/// Zeilen `(seq, body)` als Events mit `seq`.
fn read_events(mut rows: rusqlite::Rows<'_>) -> Result<Vec<Object>, Error> {
    let mut out = Vec::new();
    while let Some(r) = rows.next().map_err(db)? {
        let seq: i64 = r.get(0).map_err(db)?;
        let body: &str = r.get_ref(1).map_err(db)?.as_str().map_err(|e| Error::Backend(e.to_string()))?;
        out.push(with_seq(parse_object(body)?, seq as Seq));
    }
    Ok(out)
}

impl Storage for SqliteStorage {
    fn events_after(&self, after: Seq, up_to: Option<Seq>, limit: Option<usize>) -> Result<Vec<Object>, Error> {
        let upper = up_to.map_or(i64::MAX, to_i64);
        let lower = to_i64(after);
        if upper <= lower {
            return Ok(Vec::new());
        }
        let limit = limit.map_or(-1, |n| i64::try_from(n).unwrap_or(i64::MAX));
        let mut stmt = self
            .conn
            .prepare_cached("SELECT seq, body FROM events WHERE seq > ?1 AND seq <= ?2 ORDER BY seq LIMIT ?3")
            .map_err(db)?;
        read_events(stmt.query(params![lower, upper, limit]).map_err(db)?)
    }

    fn own_events_after(&self, after: Seq) -> Result<Vec<Object>, Error> {
        let mut stmt = self
            .conn
            .prepare_cached("SELECT seq, body FROM events WHERE own = 1 AND seq > ?1 ORDER BY seq")
            .map_err(db)?;
        read_events(stmt.query([to_i64(after)]).map_err(db)?)
    }

    fn event_at(&self, seq: Seq) -> Result<Option<Object>, Error> {
        let body: Option<String> = self
            .conn
            .prepare_cached("SELECT body FROM events WHERE seq = ?1")
            .and_then(|mut s| s.query_row([to_i64(seq)], |r| r.get(0)).optional())
            .map_err(db)?;
        body.map(|b| parse_object(&b).map(|ev| with_seq(ev, seq))).transpose()
    }

    fn log_info(&self) -> Result<LogInfo, Error> {
        let count: i64 = self.conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).map_err(db)?;
        let last: Option<(i64, String)> = self
            .conn
            .query_row("SELECT seq, body FROM events ORDER BY seq DESC LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(db)?;
        let (max_seq, last_event_id) = match last {
            Some((seq, body)) => {
                let ev = parse_object(&body)?;
                let id = ev.get("id").filter(|v| crate::js::truthy(v)).map(crate::js::to_string).unwrap_or_default();
                (seq as Seq, id)
            }
            None => (0, String::new()),
        };
        Ok(LogInfo { count: count as u64, max_seq, last_event_id })
    }

    fn known_ids(&self, keys: &[String]) -> Result<HashSet<String>, Error> {
        let mut stmt = self.conn.prepare_cached("SELECT 1 FROM events WHERE id = ?1 LIMIT 1").map_err(db)?;
        let mut found = HashSet::new();
        for key in keys {
            if !found.contains(key) && stmt.exists([key]).map_err(db)? {
                found.insert(key.clone());
            }
        }
        Ok(found)
    }

    fn blob(&self, key: &str) -> Result<Option<Blob>, Error> {
        let row: Option<(Vec<u8>, Option<String>)> = self
            .conn
            .prepare_cached("SELECT bytes, meta FROM blobs WHERE key = ?1")
            .and_then(|mut s| s.query_row([key], |r| Ok((r.get(0)?, r.get(1)?))).optional())
            .map_err(db)?;
        let Some((bytes, meta)) = row else { return Ok(None) };
        let meta = meta.map(|m| serde_json::from_str::<Value>(&m)).transpose().map_err(json_err)?;
        Ok(Some(Blob { bytes, meta }))
    }

    fn blob_keys(&self) -> Result<Vec<String>, Error> {
        let mut stmt = self.conn.prepare_cached("SELECT key FROM blobs ORDER BY key").map_err(db)?;
        let keys = stmt.query_map([], |r| r.get(0)).map_err(db)?;
        keys.collect::<Result<_, _>>().map_err(db)
    }

    fn vec(&self, key: &str) -> Result<Option<Value>, Error> {
        let rec: Option<String> = self
            .conn
            .prepare_cached("SELECT rec FROM vecs WHERE key = ?1")
            .and_then(|mut s| s.query_row([key], |r| r.get(0)).optional())
            .map_err(db)?;
        rec.map(|r| serde_json::from_str(&r)).transpose().map_err(json_err)
    }

    fn vecs(&self) -> Result<Vec<(String, Value)>, Error> {
        let mut stmt = self.conn.prepare_cached("SELECT key, rec FROM vecs ORDER BY key").map_err(db)?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(db)?;
        let mut out = Vec::new();
        for row in rows {
            let (k, rec) = row.map_err(db)?;
            out.push((k, serde_json::from_str(&rec).map_err(json_err)?));
        }
        Ok(out)
    }

    fn checkpoint(&self, slot: CheckpointSlot) -> Result<Option<Object>, Error> {
        let rec: Option<String> = self
            .conn
            .prepare_cached("SELECT rec FROM checkpoints WHERE slot = ?1")
            .and_then(|mut s| s.query_row([slot_id(slot)], |r| r.get(0)).optional())
            .map_err(db)?;
        rec.map(|r| parse_object(&r)).transpose()
    }

    fn part(&self, kind: PartKind, hash: &str) -> Result<Option<String>, Error> {
        let row: Option<(String, Option<i64>)> = self
            .conn
            .prepare_cached("SELECT data, seq FROM checkpoint_parts WHERE kind = ?1 AND hash = ?2")
            .and_then(|mut s| s.query_row(params![kind_id(kind), hash], |r| Ok((r.get(0)?, r.get(1)?))).optional())
            .map_err(db)?;
        let Some((data, seq)) = row else { return Ok(None) };
        let Some(seq) = seq else { return Ok(Some(data)) };
        // Verweis: Daten aus dem Event; zeigt er ins Leere, aus einem anderen Event desselben Bildes.
        self.conn
            .prepare_cached(
                "SELECT json_extract(body, '$.payload.data') FROM events WHERE blob_hash = ?1
                ORDER BY seq = ?2 DESC, seq DESC LIMIT 1",
            )
            .and_then(|mut s| s.query_row(params![hash, seq], |r| r.get(0)).optional())
            .map_err(db)
    }

    fn part_hashes(&self, kind: PartKind) -> Result<Vec<String>, Error> {
        let mut stmt =
            self.conn.prepare_cached("SELECT hash FROM checkpoint_parts WHERE kind = ?1 ORDER BY hash").map_err(db)?;
        let rows = stmt.query_map([kind_id(kind)], |r| r.get(0)).map_err(db)?;
        rows.collect::<Result<_, _>>().map_err(db)
    }

    fn meta(&self, key: &str) -> Result<Option<String>, Error> {
        self.conn
            .prepare_cached("SELECT value FROM meta WHERE key = ?1")
            .and_then(|mut s| s.query_row([key], |r| r.get(0)).optional())
            .map_err(db)
    }

    fn apply(&mut self, writes: Vec<Write>) -> Result<Vec<Seq>, Error> {
        let tx = self.conn.transaction().map_err(db)?;
        let mut added = Vec::new();
        for w in writes {
            apply_one(&tx, w, &mut added)?; // Fehler: tx fällt ohne commit → Rollback
        }
        tx.commit().map_err(db)?;
        Ok(added)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_newer_schema_and_keeps_data() {
        let dir = std::env::temp_dir().join(format!("impala-storage-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&dir);
        {
            let mut s = SqliteStorage::open(&dir).unwrap();
            assert_eq!(s.schema_version().unwrap(), SCHEMA_VERSION);
            let ev = serde_json::json!({"id": "a", "t": "x", "type": "p"}).as_object().cloned().unwrap();
            s.apply(vec![Write::AddEvent(ev)]).unwrap();
        }
        {
            let s = SqliteStorage::open(&dir).unwrap();
            assert_eq!(s.log_info().unwrap().count, 1, "erneutes Öffnen migriert nicht neu");
            s.conn.pragma_update(None, "user_version", SCHEMA_VERSION + 1).unwrap();
        }
        assert!(matches!(SqliteStorage::open(&dir), Err(Error::NewerSchema { .. })));
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", dir.display()));
        }
    }

    fn obj(v: serde_json::Value) -> Object {
        v.as_object().cloned().unwrap()
    }

    fn blob_ev(id: &str, t: &str, hash: &str) -> Write {
        Write::AddEvent(obj(serde_json::json!({
            "id": id, "t": t, "type": "heftBlob", "payload": {"hash": hash, "data": format!("data:{hash}")}
        })))
    }

    fn stored(s: &SqliteStorage, hash: &str) -> (String, Option<i64>) {
        s.conn
            .query_row("SELECT data, seq FROM checkpoint_parts WHERE kind = 1 AND hash = ?1", [hash], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap()
    }

    #[test]
    fn heft_images_are_stored_once() {
        let mut s = SqliteStorage::open_in_memory().unwrap();
        s.apply(vec![blob_ev("a", "1", "A"), blob_ev("a2", "2", "A")]).unwrap();
        let put = |h: &str| Write::PutPart(PartKind::HeftBlob, h.into(), format!("data:{h}"));
        s.apply(vec![put("A"), put("X")]).unwrap();
        assert_eq!(stored(&s, "A"), (String::new(), Some(2)), "Verweis auf das neueste Event");
        assert_eq!(stored(&s, "X"), ("data:X".into(), None), "ohne Event bleibt die Kopie");
        assert_eq!(s.part(PartKind::HeftBlob, "A").unwrap().as_deref(), Some("data:A"));
        assert!(s.storage_check(None).unwrap().ok());

        // Event weg: auf das andere umhängen, beim letzten die Daten übernehmen.
        s.apply(vec![Write::DeleteEvent(2)]).unwrap();
        assert_eq!(stored(&s, "A"), (String::new(), Some(1)));
        s.apply(vec![Write::DeleteEvent(1)]).unwrap();
        assert_eq!(stored(&s, "A"), ("data:A".into(), None));
        assert_eq!(s.part(PartKind::HeftBlob, "A").unwrap().as_deref(), Some("data:A"));

        // Verwaiste Bilder zählen nur mit bekanntem Heft-Zustand und außerhalb der Schonfrist.
        s.apply(vec![blob_ev("b", "2026-01-01", "B"), blob_ev("c", "2026-03-01", "C")]).unwrap();
        let live: HashSet<String> = HashSet::new();
        let check = s.storage_check(Some(&impala_sync::BlobKeep { live: &live, since: "2026-02-01" })).unwrap();
        assert_eq!((check.orphan_images, check.orphan_images_bytes, check.live_known), (1, 6, true));
    }

    #[test]
    fn migrates_old_checkpoint_copies_to_pointers() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(&format!("{};{}", MIGRATIONS[0], MIGRATIONS[1])).unwrap();
        conn.pragma_update(None, "user_version", 2).unwrap();
        conn.execute(
            "INSERT INTO events (id, body) VALUES ('a', ?1)",
            [r#"{"id":"a","t":"1","type":"heftBlob","payload":{"hash":"A","data":"data:A"}}"#],
        )
        .unwrap();
        conn.execute("INSERT INTO checkpoint_parts VALUES (1, 'A', 'data:A'), (1, 'X', 'data:X'), (2, 'A', '{}')", [])
            .unwrap();
        migrate(&mut conn).unwrap();
        let s = SqliteStorage { conn };
        assert_eq!(stored(&s, "A"), (String::new(), Some(1)));
        assert_eq!(stored(&s, "X"), ("data:X".into(), None));
        assert_eq!(s.part(PartKind::HeftBlob, "A").unwrap().as_deref(), Some("data:A"));
        assert_eq!(s.part(PartKind::HeftDoc, "A").unwrap().as_deref(), Some("{}"));
        assert_eq!(s.storage_check(None).unwrap(), StorageCheck::default());
    }

    #[test]
    fn marks_own_events_also_in_old_databases() {
        let bodies = [
            r#"{"id":"a","t":"1","type":"p"}"#,
            r#"{"id":"b","t":"2","type":"p","_remote":true,"_remoteSource":"drive"}"#,
            r#"{"id":"c","t":"3","type":"p","_derived":true}"#,
            r#"{"id":"d","t":"4","type":"p","_remote":false,"_derived":null}"#,
            "kaputt",
        ];
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        for b in bodies {
            conn.execute("INSERT INTO events (id, body) VALUES ('x', ?1)", [b]).unwrap();
        }
        migrate(&mut conn).unwrap();
        let own: Vec<i64> = conn
            .prepare("SELECT seq FROM events WHERE own = 1")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(own, vec![1, 4]);

        let mut s = SqliteStorage::open_in_memory().unwrap();
        let ev = |v: serde_json::Value| Write::AddEvent(v.as_object().cloned().unwrap());
        s.apply(vec![
            ev(serde_json::json!({"id": "a", "t": "1", "type": "p"})),
            ev(serde_json::json!({"id": "b", "t": "2", "type": "p", "_remote": true})),
            ev(serde_json::json!({"id": "c", "t": "3", "type": "p"})),
        ])
        .unwrap();
        let ids = |after| -> Vec<String> {
            s.own_events_after(after).unwrap().iter().map(|e| e["id"].as_str().unwrap().to_owned()).collect()
        };
        assert_eq!(ids(0), ["a", "c"]);
        assert_eq!(ids(1), ["c"]);
    }
}
