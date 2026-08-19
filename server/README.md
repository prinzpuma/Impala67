# Impala67 – Cloudflare Real-Time Sync Server

Dieser Serverlose Worker ermöglicht den **blitzschnellen Echtzeit-Sync (< 50 ms)** zwischen all deinen Geräten bei **0 € monatlichen Kosten** auf Cloudflare.

## Sicherheits- & Quota-Eigenschaften
- **100 % Ende-zu-Ende-Verschlüsselung (E2EE):** Alle Events werden im Browser mit AES-GCM (256-Bit) verschlüsselt. Der Server speichert nur unlesbaren Zeichensalat.
- **200 MB Quota pro Sync-Schlüssel:** Garantiert faire Nutzung und schützt deinen kostenlosen Cloudflare D1 Speicher.
- **WebSockets & D1:** Sofortige Live-Übertragung bei geöffneter App + nahtloser Download verpasster Änderungen nach Offline-Phasen.

---

## 🚀 3-Schritte Einrichtung (Dauert ca. 2 Minuten)

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
Wrangler gibt dir eine Zeile wie diese aus:
```toml
[[d1_databases]]
binding = "DB"
database_name = "impala67-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```
Kopiere diese `database_id` in die Datei `server/wrangler.toml`.

Führe danach das Datenbankschema aus:
```bash
npx wrangler d1 execute impala67-db --remote --file=./schema.sql
```

### 3. Worker veröffentlichen
```bash
npx wrangler deploy
```
Wrangler zeigt dir anschließend deine persönliche URL an, z. B.:
`https://impala67-sync.<dein-account>.workers.dev`

---

## 📱 In Impala67 eintragen
1. Öffne Impala67 -> ⚙️ **Einstellungen** -> **Sync & Dienste**.
2. Unter **Cloudflare Echtzeit-Sync**:
   - Trage deine Worker-URL ein (`https://impala67-sync.<dein-account>.workers.dev`).
   - Klicke auf **Schlüssel generieren** (oder trage deinen bestehenden Schlüssel ein).
   - Klicke auf **Verbinden & Synchronisieren**.
3. Gib denselben Sync-Schlüssel und dieselbe URL auf deinen anderen Geräten ein -> **Fertig!**
