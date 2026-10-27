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
use crate::event::{LogInfo, Object, Seq, id_key};
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
        conn.execute_batch("PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;").map_err(db)?;
        migrate(&mut conn)?;
        Ok(Self { conn })
    }

    pub fn schema_version(&self) -> Result<u32, Error> {
        self.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(db)
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

fn apply_one(tx: &Transaction, w: Write, added: &mut Vec<Seq>) -> Result<(), Error> {
    match w {
        Write::AddEvent(mut ev) => {
            ev.shift_remove("seq");
            let id = ev.get("id").and_then(id_key);
            let body = serde_json::to_string(&ev).map_err(json_err)?;
            tx.prepare_cached("INSERT INTO events (id, body) VALUES (?1, ?2)")
                .and_then(|mut s| s.execute(params![id, body]))
                .map_err(db)?;
            added.push(tx.last_insert_rowid() as Seq);
        }
        Write::DeleteEvent(seq) => {
            tx.prepare_cached("DELETE FROM events WHERE seq = ?1")
                .and_then(|mut s| s.execute([to_i64(seq)]))
                .map_err(db)?;
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
            tx.prepare_cached("INSERT OR REPLACE INTO checkpoint_parts (kind, hash, data) VALUES (?1, ?2, ?3)")
                .and_then(|mut s| s.execute(params![kind_id(kind), hash, data]))
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
        let rows = stmt
            .query_map(params![lower, upper, limit], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(db)?;
        let mut out = Vec::new();
        for row in rows {
            let (seq, body) = row.map_err(db)?;
            out.push(with_seq(parse_object(&body)?, seq as Seq));
        }
        Ok(out)
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
        self.conn
            .prepare_cached("SELECT data FROM checkpoint_parts WHERE kind = ?1 AND hash = ?2")
            .and_then(|mut s| s.query_row(params![kind_id(kind), hash], |r| r.get(0)).optional())
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
}
