# Impala67 MCP-Server (Model Context Protocol)

Verbindet KI-Assistenten (Claude Code, Claude Desktop, Cursor, Antigravity …) mit der **im Browser geöffneten** Impala67-App. Alle Tools arbeiten direkt auf den Daten der App; ist keine App verbunden, melden sie das als Fehler.

## 1. Einrichtung

Im Projekt ist der Server schon über `.mcp.json` eingetragen. Für andere Clients:

```json
{
  "mcpServers": {
    "impala67": { "command": "node", "args": ["<Pfad zum Repo>/mcp/server.mjs"] }
  }
}
```

## 2. Verbindung zur App

- **Lokal:** Auf `http://localhost:8000` ist die Bridge immer an.
- **Gehostete PWA:** `?mcpBridge=1` anhängen oder in Einstellungen → Daten → Diagnose einschalten. Chrome/Firefox erlauben `ws://127.0.0.1` von HTTPS-Seiten, Safari/iPad meist nicht.
- Die App verbindet sich per WebSocket mit `ws://127.0.0.1:8765` (Port per `IMPALA_WS_PORT` änderbar). Ein Aufruf wartet bis zu 3,5 s, falls die App gerade neu verbindet.
- Mehrere MCP-Server (z. B. je Claude-Sitzung) teilen sich den Port: der erste spricht mit dem Browser, die anderen reichen ihre Aufrufe als Relay durch.
- Browser-Verbindungen werden nur von `localhost`, `127.0.0.1` und `https://prinzpuma.github.io` angenommen; weitere Herkunft per `IMPALA_ALLOWED_ORIGINS` (kommagetrennt).

## 3. Tools

**Inhalte**
- `impala_list_pages` — Notizen auflisten; Filter `query`, `kind`, `subject`, `archived`/`includeArchived`, `limit`.
- `impala_get_page` — Inhalt per `id` oder `title`; bei Heften OCR- und Textbox-Text aller Seiten.
- `impala_create_page` — neue Notiz (`title`, `content`, `subject`, `parentId`/`parent_title`, `kind`).
- `impala_update_page` — Titel, Inhalt, Fach, Archiv. Bei Heften wird Text als neue Textbox auf Seite 1 gelegt, Striche bleiben unberührt.
- `impala_search` — Stichwortsuche in Notizen und Karteikarten; mit `semantic: true` Bedeutungssuche über den RAG-Index der App (braucht eingerichtete Embeddings, sonst Rückfall auf Stichworte).
- `impala_list_flashcards`, `impala_create_flashcard` — Karteikarten.

**Diagnose & Testen**
- `impala_get_diagnostics` — aktive Seite, Tabs, Zähler, Heap, Sync-Status, letzte Fehler.
- `impala_get_performance_trace` — Profiler-Trace inkl. App- und KI-Fehler; `enable`, `mode` (`anomalies`/`all`, Detail-Trace nur hierüber), `clear`.
- `impala_get_ai_trace` — vollständiges KI-Debugprotokoll der Sitzung (Anfragen, Status, Dauer, Fallbacks); `clear`.
- `impala_eval` — JavaScript in der App ausführen (Funktionsrumpf mit `return`; `S`, `STATE`, `RENDER`, `TABS`, `PERF_PROFILER`, `CLOUDFLARE_SYNC`, `DRIVE`, `SEARCH` verfügbar).
- `impala_run_ui_action` — `open_page`, `close_active_tab`, `search_ui`, `trigger_sync`, `toggle_sidebar`.

**Handschrift-Training**
- `impala_heft_page_image` — Heftseite als Bild mit Raster plus Lesung des lokalen Modells.
- `impala_heft_label_lines` — eigene Zeilen-Lesung als Trainingsbeispiele speichern.

**Speicher**
- `impala_storage_report` — größte PDFs und Cloudflare-Quota.
- `impala_storage_cleanup` — PDF-Binärdaten auslagern; Standard `dryRun: true`.

## 4. Tests

```bash
node --test mcp/test-mcp.mjs
```
