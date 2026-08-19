# Impala67 – Cloudflare Real-Time Sync Server

Dieser Serverlose Worker ermöglicht den **blitzschnellen Echtzeit-Sync (< 50 ms)** zwischen all deinen Geräten bei **0 € monatlichen Kosten** auf Cloudflare.

## Sicherheits- & Speicher-Eigenschaften
- **100 % Ende-zu-Ende-Verschlüsselung (E2EE):** Alle Events werden im Browser mit AES-GCM (256-Bit) verschlüsselt. Der Server speichert nur unlesbaren Zeichensalat.
- **D1 + R2 Hybrid-Architektur:** Cloudflare D1 verwaltet blitzschnelle Indizes und Deduplizierung; Cloudflare R2 speichert die verschlüsselten Datenpakete (10 GB kostenloser Speicherplatz ohne 500-MB-Datenbankgrenze).
- **1.000 MB (1 GB) Quota pro Sync-Schlüssel:** Großzügiger Speicherplatz für Notizen, Bilder und Notizheft-Zeichnungen.
- **WebSockets (Durable Objects):** Sofortige Live-Übertragung bei geöffneter App (< 30 ms) + nahtloser Download verpasster Änderungen nach Offline-Phasen.
- **Geschützter AI-Proxy:** `/api/ai` leitet Textanfragen mit dem serverseitigen `GROQ_API_KEY` an Groq weiter. Der Sync-Token muss gültig sein; der Groq-Key wird nie an die PWA ausgeliefert.

---

## 🚀 4-Schritte Einrichtung (Dauert ca. 2 Minuten)

### 1. Bei Cloudflare einloggen
Öffne ein Terminal in diesem Ordner (`server/`) und logge dich einmalig ein:
```bash
npx wrangler login
```

### 2. D1 Datenbank erstellen
Erstelle deine kostenlose D1-Datenbank:
```bash
npx wrangler d1 create impala67-db
```
Kopiere die ausgegebene `database_id` in die Datei `server/wrangler.toml`.

Führe danach das Datenbankschema aus:
```bash
npx wrangler d1 execute impala67-db --remote --file=./schema.sql
```

### 3. R2 Speicher-Bucket erstellen
Erstelle deinen kostenlosen 10-GB R2 Bucket:
```bash
npx wrangler r2 bucket create impala67-sync
```

### 4. Worker veröffentlichen
```bash
npx wrangler deploy
```
Wrangler zeigt dir anschließend deine persönliche URL an, z. B.:
`https://impala67-sync.<dein-account>.workers.dev`

### 4. Groq-AI konfigurieren (optional)

Im Cloudflare-Dashboard beim Worker unter **Settings → Variables and Secrets** ein Secret mit dem Namen `GROQ_API_KEY` anlegen. Die AI-Route verwendet aktuell diese Fallback-Reihenfolge und akzeptiert nur Textnachrichten:

1. `openai/gpt-oss-120b`
2. `openai/gpt-oss-20b`
3. `qwen/qwen3.6-27b`

Bei einem Groq-Rate-Limit (`429`) wird automatisch das nächste Modell versucht.
Ein zusätzliches Impala67-Anfragenlimit wird derzeit nicht erzwungen; maßgeblich sind die aktuellen Groq-Free-Tier-Limits.

---

## 📱 In Impala67 eintragen
1. Öffne Impala67 -> ⚙️ **Einstellungen** -> **Sync & Dienste**.
2. Unter **Cloudflare Echtzeit-Sync**:
   - Trage deine Worker-URL ein (`https://impala67-sync.<dein-account>.workers.dev`).
   - Klicke auf **Schlüssel generieren** (oder trage deinen bestehenden Schlüssel ein).
   - Klicke auf **Verbinden & Synchronisieren**.
3. Gib denselben Sync-Schlüssel und dieselbe URL auf deinen anderen Geräten ein -> **Fertig!**
