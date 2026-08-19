-- Impala67 Cloudflare D1 Datenbank-Schema
-- Hybrid-Architektur: D1 verwaltet Indizes & Metadaten; R2 speichert die Chiffrate.
-- 100 % E2EE: Der Server sieht ausschließlich clientseitig verschlüsselte Daten.

CREATE TABLE IF NOT EXISTS sync_events (
    user_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    iv TEXT NOT NULL,
    r2_key TEXT,
    data TEXT,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, seq)
);

-- Eindeutige Indizes für schnelle Abfragen und strenge Deduplizierung
CREATE INDEX IF NOT EXISTS idx_sync_events_user_seq ON sync_events(user_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_events_user_event_unique ON sync_events(user_id, event_id);

CREATE TABLE IF NOT EXISTS user_storage (
    user_id TEXT PRIMARY KEY,
    auth_token_hash TEXT,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
