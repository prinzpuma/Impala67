# Impala67 MCP-Server (Model Context Protocol)

Ein modularer, eigenständiger MCP-Server für **Impala67**, der KI-Assistenten (wie Google Antigravity, Claude Desktop oder Cursor) direkten, sicheren Zugriff auf Notizen, GoodNotes-Hefte und Karteikarten bietet.

---

## 1. Übersicht & Eigenschaften

- **Stdio JSON-RPC 2.0**: Entspricht der offiziellen MCP-Spezifikation (Transport über `stdin` / `stdout`, Logs über `stderr`).
- **100 % Nicht-invasiv**: Verändert keine Core-Dateien in `web/`, `server/` oder `test/`.
- **E2EE Cloudflare Sync v4**: Nutzt bei konfiguriertem Sync-Schlüssel (`IMPALA67_SYNC_KEY`) dieselbe Ende-zu-Ende-Verschlüsselung (AES-GCM / PBKDF2) wie die PWA und synchronisiert live mit dem Cloudflare Worker Backend.
- **Lokaler Offline-Fallback**: Läuft dank `mcp/.storage.json` sofort und ohne Serveranbindung vollständig offline.
- **Heft-Schutz (GoodNotes)**: Liest Textinhalte und OCR aus Handschrift-Heften aus und erlaubt Textergänzungen, ohne Vektorstriche oder Zeichnungen zu beschädigen.
- **Automatische Fach-Erkennung**: Erkennt Schulfächer anhand von expliziten Feldern, Tags, Titeln oder Text-Heuristiken.

---

## 2. Einrichtung in Antigravity & MCP-Clients

### Antigravity (`~/.gemini/config/mcp_config.json`)

Füge den Server unter `mcpServers` in deiner Antigravity-Konfiguration ein:

```json
{
  "mcpServers": {
    "impala67": {
      "command": "node",
      "args": [
        "C:/Users/joshu/Documents/Notion/mcp/server.mjs"
      ],
      "env": {
        "IMPALA67_SYNC_KEY": "impala-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx"
      }
    }
  }
}
```

> **Hinweis für Linux / macOS**: Verwende den entsprechenden absoluten Pfad, z. B. `"/home/user/Notion/mcp/server.mjs"`.

---

## 3. Konfiguration der Synchronisation

Der MCP-Server unterstützt zwei Möglichkeiten zur Angabe des Sync-Schlüssels:

1. **Umgebungsvariable (empfohlen für Antigravity / CI)**:
   ```bash
   export IMPALA67_SYNC_KEY="impala-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx"
   ```
2. **Lokale Konfigurationsdatei (`mcp/.config.json`)**:
   Erstelle eine Datei `mcp/.config.json` (wird automatisch von Git ignoriert):
   ```json
   {
     "syncKey": "impala-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx",
     "syncUrl": "https://impala67-sync.joshuagayer1.workers.dev"
   }
   ```

*Ist kein Schlüssel angegeben, startet der Server automatisch im Offline-Modus und speichert Daten lokal in `mcp/.storage.json`.*

---

## 4. Verfügbare Werkzeuge (MCP Tools)

### `impala_list_pages`
Listet Notizen in Impala67 auf.
- **Parameter**:
  - `query` *(optional, string)*: Filter nach Suchbegriff im Titel, Inhalt oder Fach.
  - `kind` *(optional, string)*: Filter nach Art: `"all"`, `"notion"` (Standard) oder `"heft"`.
  - `subject` *(optional, string)*: Filter nach Schulfach (z. B. `"Mathematik"`, `"Physik"`).
  - `limit` *(optional, number)*: Maximale Trefferanzahl (Standard: 50).
- **Rückgabe**: Liste von Notizen mit ID, Titel, Art (`notion`/`heft`), Fach, Aktualisierungszeitpunkt.

### `impala_get_page`
Liest den vollständigen Inhalt einer Notiz.
- **Parameter**:
  - `id` *(optional, string)*: ID der Notiz.
  - `title` *(optional, string)*: Titel der Notiz (falls ID nicht bekannt).
- **Rückgabe**: Titel, Inhalt (Markdown bzw. extrahierter Heft-Text/OCR), Fach, Erstellungs- und Änderungszeitpunkt.
- **Besonderheit bei Heften**: Striche bleiben unberührt; der Text aller Seiten wird strukturiert extrahiert.

### `impala_create_page`
Erstellt eine neue Notiz.
- **Parameter**:
  - `title` *(Pflicht, string)*: Titel der neuen Notiz.
  - `content` *(optional, string)*: Text bzw. Markdown-Inhalt.
  - `subject` *(optional, string)*: Fach oder Thema.
  - `parent_title` *(optional, string)*: Titel einer übergeordneten Seite (für Baumstruktur).
  - `kind` *(optional, string)*: `"notion"` (Standard) oder `"heft"`.
- **Rückgabe**: Bestätigung `{ ok: true, id, title, kind, subject }`.

### `impala_update_page`
Aktualisiert eine Notiz oder hängt neuen Inhalt an.
- **Parameter**:
  - `id` *(optional, string)*: ID der Notiz.
  - `title` *(optional, string)*: Titel der Notiz (wenn ID nicht bekannt).
  - `new_title` *(optional, string)*: Neuer Titel.
  - `content` *(optional, string)*: Ersetzt gesamten Inhalt (nur Notion-Seiten).
  - `append_content` *(optional, string)*: Hängt Text an (auch bei Heften sicher als Textbox).
  - `subject` *(optional, string)*: Neues Fach.
- **Rückgabe**: `{ ok: true, id, title, kind, subject }`.

### `impala_search`
Durchsucht alle Notizen und Karteikarten.
- **Parameter**:
  - `query` *(Pflicht, string)*: Suchbegriff oder Frage.
  - `limit` *(optional, number)*: Maximale Treffer (Standard: 20).
- **Rückgabe**: Trefferliste mit Typ (`page` oder `flashcard`), Titel, Fach/Stapel und Textausschnitt (Snippet).

### `impala_list_flashcards`
Listet Karteikarten auf.
- **Parameter**:
  - `deck` *(optional, string)*: Filter nach Stapelname (z. B. `"Standard"` oder `"Mathematik::Analysis"`).
  - `query` *(optional, string)*: Textfilter in Vorder- oder Rückseite.
  - `limit` *(optional, number)*: Maximale Anzahl an Karten (Standard: 50).
- **Rückgabe**: Array von Karten mit ID, Vorderseite, Rückseite, Stapel und Lernstatus.

### `impala_create_flashcard`
Erstellt eine neue Karteikarte.
- **Parameter**:
  - `front` *(Pflicht, string)*: Vorderseite / Frage.
  - `back` *(Pflicht, string)*: Rückseite / Antwort.
  - `deck` *(optional, string)*: Zielstapel (Standard: `"Standard"`).
  - `page_title` *(optional, string)*: Zugehörige Notiz.
- **Rückgabe**: Bestätigung `{ ok: true, id, front, back, deck }`.

---

## 5. Tests & Verifikation

Der MCP-Server verfügt über eine eigene Test-Suite, die den Server als echten Child-Process per Stdio JSON-RPC testet:

```bash
node --test mcp/test-mcp.mjs
```

Die bestehenden Tests des Hauptprojekts bleiben davon völlig unberührt:

```bash
npm test
```
