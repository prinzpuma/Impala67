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
- Mehrere MCP-Server (z. B. je Claude-Sitzung) teilen sich den Port: der erste spricht mit dem Browser, die anderen reichen ihre Aufrufe als Relay durch. Ein Relay schickt sein eigenes Timeout mit, damit ein älterer Primärserver neue, lang laufende Tools nicht nach 10 s abbricht.
- Browser-Verbindungen werden nur von `localhost`, `127.0.0.1` und `https://prinzpuma.github.io` angenommen; weitere Herkunft per `IMPALA_ALLOWED_ORIGINS` (kommagetrennt).
- **Native iPad-App im WLAN:** `node mcp/lan-setup.mjs` legt einen Kopplungs-Code in `mcp/.lan-token` an (nicht committet) und zeigt die Adresse `ws://<PC-IP>:8766/?token=…`. Nach einem Neustart des MCP-Servers lauscht der Primärserver zusätzlich auf Port 8766 (`IMPALA_LAN_PORT`) für alle Netzwerkschnittstellen, nimmt dort aber nur Verbindungen mit diesem Code an. Die Adresse kommt in die iPad-App unter Einstellungen → App & Speicher → Für Entwickler. Ohne Code bleibt der WLAN-Port zu. Auf dem iPad gibt es Diagnose, Profiler, Seiten/Suche, UI-Aktionen, `impala_screenshot` und die Bedienung über den Accessibility-Baum (`impala_ui_tree` listet Elemente, `impala_tap` löst sie aus, `impala_type` tippt ins fokussierte Feld), aber kein `impala_eval`.

## 3. Tools

**Inhalte**
Dieselben flachen Werkzeuge wie die App-KI (Definitionen: `core/impala-ai/src/tool_defs_flat.json`, eingelesen von `mcp/content-tools.mjs`). Ausgeführt werden sie in der App (`web/tools.js` → `TOOLS.runFlat`) bzw. auf dem iPad im Kern (`ImpalaCore.runMcpTool`), mit denselben Prüfungen wie im KI-Chat. Seiten gehen per Titel oder ID.
- `impala_search` — Stichwortsuche (`semantic: true`: Bedeutungssuche); Treffer mit Ordner und Ausschnitt.
- `impala_read_pages` — Seiten/Hefte lesen (`titles`): Inhalt, Ordner, Unterseiten; bei Verzeichnissen Spalten und Einträge, bei Einträgen ihre Spaltenwerte (`props`).
- `impala_list_pages`, `impala_get_context` — Seitenliste mit Ordner bzw. Datum, offene und zuletzt bearbeitete Seiten.
- `impala_create_pages` — mehrere Seiten in einem Aufruf (`pages: [{ title, content, parent, props }]`); `props` werden gegen die Spalten des Verzeichnisses geprüft.
- `impala_edit_page` — kleinste Änderung: `edits: [{ search, replace }]` (leerraum-tolerant), `append`, `props`, `rename`, `move_to`; `content` ersetzt alles und braucht `allow_deleting_content`, wenn Abschnitte verloren gingen.
- `impala_organize_pages` (trash/archive/unarchive), `impala_write_to_heft`.
- `impala_list_cards`, `impala_list_decks`, `impala_create_cards` (Unterstapel mit `::`), `impala_edit_cards`, `impala_edit_deck`, `impala_search_chats`.
- Jedes schreibende Werkzeug nimmt `dry_run: true`: alles prüfen, nichts speichern (Benchmark).

**Diagnose & Testen**
- `impala_get_diagnostics` — aktive Seite, Tabs, Zähler, Heap, Sync-Status, letzte Fehler.
- `impala_get_performance_trace` — Profiler-Trace inkl. App- und KI-Fehler; `enable`, `mode` (`anomalies`/`all`, Detail-Trace nur hierüber), `clear`.
- `impala_get_ai_trace` — vollständiges KI-Debugprotokoll der Sitzung (Anfragen, Status, Dauer, Fallbacks); `clear`.
- `impala_eval` — JavaScript in der App ausführen (Funktionsrumpf mit `return`; `S`, `STATE`, `RENDER`, `TABS`, `PERF_PROFILER`, `CLOUDFLARE_SYNC`, `DRIVE`, `SEARCH` verfügbar).
- `impala_run_ui_action` — `open_page`, `close_active_tab`, `search_ui`, `trigger_sync`, `toggle_sidebar`, `go_back`, `dismiss` (nur iPad).

**Handschrift-Training**
- `impala_heft_page_image` — Heftseite als Bild mit Raster (inkl. Seitenhintergrund wie PDF-Vorlagen) plus Lesung des lokalen Modells.
- `impala_heft_label_lines` — eigene Zeilen-Lesung als Trainingsbeispiele speichern.
- `impala_heft_add_pages` — Bild oder PDF (`file_path` oder `data_base64`) als festliegende Seitenvorlage an beliebiger Stelle ins Heft legen. Derselbe Aufruf (gleiches Heft, gleiche Datei, gleiche Stelle) wird in der App nur einmal ausgeführt, auch wenn er nach einem Timeout wiederholt wird (Antwort dann mit `deduplicated: true`).
- `impala_heft_delete_pages` — Heftseiten ab 1 löschen; Seiten mit Handschrift, Bildern oder Textboxen nur mit `allow_content: true`.

**Speicher**
- `impala_storage_report` — größte PDFs und Cloudflare-Quota.
- `impala_storage_cleanup` — PDF-Binärdaten auslagern; Standard `dryRun: true`.

## 4. Tests

```bash
node --test mcp/test-mcp.mjs
```
