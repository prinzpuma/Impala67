# Impala67 – Cloudflare Real-Time Sync Server

Dieser Worker stellt das aktuelle **Sync-Protokoll v4** bereit. Ältere Protokollgenerationen werden bewusst nicht weitergeführt; ein Generation-Reset lässt Clients anschließend aus ihrem aktuellen lokalen Stand wieder konvergieren.

## Sicherheits- & Speicher-Eigenschaften
- **100 % Ende-zu-Ende-Verschlüsselung (E2EE):** Eventpakete und Binärblobs werden im Browser mit AES-GCM verschlüsselt. Der Server verarbeitet nur Ciphertext und Metadaten.
- **D1 + R2 Hybrid-Architektur:** D1 speichert ausschließlich Index-, Deduplizierungs- und Quota-Metadaten; verschlüsselte Eventpakete und Blobs liegen in R2.
- **Geordnete v4-Eventfolge:** D1 vergibt pro Nutzer eine serverseitige `seq`; Clients prüfen beim Pull auf lückenlose Reihenfolge. Lokale IndexedDB-`seq`-Werte werden nie über das Wire-Format übertragen.
- **Atomare Deduplizierung:** Eventpakete haben deterministische IDs. Bereits vorhandene Pakete werden nicht erneut gespeichert.
- **Generation-Reset:** `/api/reset` leert Eventpakete und Blobs, erhöht die Generation und zwingt alle Clients zu einem sauberen Cursor-Neustart. Die PWA nutzt das auch für sichere Cloud-Compaction.
- **1.000 MB Quota pro Sync-Schlüssel:** Eventpakete und Blobs zählen gemeinsam gegen das Limit.
- **WebSockets via Durable Objects:** WebSockets dienen zur Invalidierung/Benachrichtigung; die eigentliche geordnete Übertragung läuft über HTTP-Pull/-Push.
- **Geschützter AI-Proxy:** `/api/ai` verwendet den serverseitigen `GROQ_API_KEY`; der Schlüssel wird nie an die PWA ausgeliefert.
- **Geschützter Notion-Proxy:** `/api/notion` akzeptiert nur erlaubte Notion-API-Pfade und verwendet die bestehende Sync-Autorisierung.

---

## Einrichtung

### 1. Bei Cloudflare einloggen
```bash
npx wrangler login
```

### 2. D1-Datenbank erstellen und Schema anwenden
```bash
npx wrangler d1 create impala67-db
npx wrangler d1 execute impala67-db --remote --file=./schema.sql
```

Die ausgegebene `database_id` gehört in `server/wrangler.toml`.

### 3. R2-Bucket erstellen
```bash
npx wrangler r2 bucket create impala67-sync
```

### 4. Worker veröffentlichen
Aus dem Repository-Root:
```bash
npm run deploy
```

Oder direkt aus `server/`:
```bash
npx wrangler deploy
```

### 5. Groq-AI konfigurieren (optional)
Im Cloudflare-Dashboard beim Worker ein Secret `GROQ_API_KEY` anlegen.

Aktuelle Fallback-Reihenfolge:
1. `qwen/qwen3.6-27b`
2. `openai/gpt-oss-120b`
3. `openai/gpt-oss-20b`

Bildnachrichten werden nur an dafür freigegebene Vision-Modelle geschickt; aktuell ist das `qwen/qwen3.6-27b`. Bei einem Rate-Limit (`429`) wird, soweit möglich, das nächste Modell versucht.

---

## Cloud-Reset und Compaction

`POST /api/reset` löscht für den authentifizierten Sync-Schlüssel alle Cloud-Eventpakete und Blobs und erhöht die Generation. Lokale Daten werden dadurch nicht gelöscht.

Die PWA kann daraus eine **Compaction** bauen:
1. vollständig pullen/pushen,
2. Generation-Reset ausführen,
3. den lokal kompaktierten Eventstand neu hochladen,
4. nur noch tatsächlich referenzierte Blobs erneut hochladen.

Damit können alte Eventpakete und verwaiste R2-Blobs entfernt werden, ohne dass der Server E2EE-Inhalte verstehen muss.

Für einen administrativen Komplettreset aller Accounts:
```bash
npm run db:reset
```

R2 muss bei einem globalen manuellen Reset separat geleert werden; `db:reset` löscht nur die D1-Metadaten.

---

## In Impala67 eintragen
1. Impala67 → **Einstellungen → Sync & Dienste** öffnen.
2. Worker-URL eintragen.
3. Einen 128-Bit-Sync-Schlüssel generieren oder bestehenden Schlüssel übernehmen.
4. **Verbinden & Synchronisieren** wählen.
5. Auf weiteren Geräten dieselbe Worker-URL und denselben Schlüssel verwenden.
