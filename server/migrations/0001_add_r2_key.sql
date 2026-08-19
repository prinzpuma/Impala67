-- Impala67 D1 Migration: r2_key Spalte für Cloudflare R2 Objektspeicherung hinzufügen
ALTER TABLE sync_events ADD COLUMN r2_key TEXT;
