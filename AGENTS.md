# Impala67 – Arbeitsregeln

## 1. Produkt und Plattformen

- **Plattformunabhängige PWA**: Impala67 ist eine statische, installierbare Progressive Web App (Local-First). Sie läuft nahtlos auf allen Plattformen:
  - **iPad / Tablet**: Für handschriftliche Notizen und Zeichnungen mit dem Stift (Heft-Ansicht).
  - **Laptop / PC (Linux, Windows, macOS)**: Für strukturiertes Tippen mit Tastatur (Markdown-Editor).
  - **Smartphone**: Für schnelles Lesen und mobile Kurznotizen.
- **Kostenlos & unabhängig**: Das Projekt ist darauf ausgelegt, dauerhaft ohne laufende Serverkosten für mich betrieben zu werden (Cloudflare Free Tier, GitHub Pages).
- **Direkt ohne Bundler**: Die App nutzt native ES-Module und Standard-CSS. Alles läuft direkt im Browser ohne vorgeschalteten Build- oder Kompilierungsschritt.
- **Plattformübergreifende Entwicklung**: Alle Entwickler-Tools, npm-Skripte und Tests müssen gleichermaßen unter Windows, Linux und macOS funktionieren.

## 2. Daten und Synchronisation

- **Local-First**: Alle Notizen und Daten liegen primär lokal im Browser (IndexedDB). Die App funktioniert immer offline.
- **Cloudflare Live-Sync (E2EE)**: Schneller, Ende-zu-Ende-verschlüsselter Live-Sync zwischen Geräten über Cloudflare.
- **Google Drive Backup**: Dient als optionales, unabhängiges Notfall-Backup.
- **Protokoll-Details ausgelagert**: Spezifische technische Regeln für das Protokoll v4 (R2-Speicher, D1-Index, clientseitige Kompaktierung) liegen gebündelt im Skill `cloudflare-sync-v4`, um diese Datei übersichtlich zu halten.

## 3. Wichtige Bereiche

- **Einstieg & Shell**: `web/index.html`, `web/main.js`, `web/boot.js`, `web/app.js`
- **Editor & Notizen**: `web/editor.js`, `web/render.js`
- **Handschrift & Zeichnen (Heft)**: `web/heft.js`
- **Mobile & Touch**: `web/mobile.js`, `web/mobile-view.js`, `web/mobile.css`
- **Daten & Sync**: `web/db.js`, `web/state.js`, `web/sync-core.js`, `web/sync-crypto.js`, `web/sync-cloudflare.js`, `web/drive.js`, `server/`
- **KI & Suche (RAG)**: `web/ai.js`, `web/embedding.js`, `web/embedding-worker.js`, `web/rag.js`
- **Offline & Cache**: `web/service-worker.js`, `web/updater.js`, `web/version.json`
- **Veröffentlichung**: `.github/workflows/release.yml`

## 4. Code-Qualität und Sicherheit

- **Bugs an der Wurzel lösen**: Keine doppelten Regeln oder parallelen Sonderfälle (DRY / KISS / YAGNI).
- **Dateigrößen im Zaum halten**: Große Module (`heft.js`, `editor.js`, `state.js`) nicht endlos aufblähen. Neue, in sich geschlossene Logik bevorzugt in kleine, gut testbare Hilfsmodule auslagern.
- **Sicherheit & Geheimnisse**: Niemals API-Schlüssel, Tokens oder `web/config.local.js` committen. KI-Schlüssel bleiben rein nutzerlokal im Browser.
- **Rückwärtskompatibilität**: Lokale Daten in IndexedDB dürfen durch Updates niemals verloren gehen oder ungefragt inkompatibel werden.
- **Offline-Cache**: Werden gecachte App-Dateien geändert, muss die Cache-Version im Service-Worker angepasst werden.

## 5. Kommunikation und Arbeitsweise

- **Knapp & prägnant**: Antworten immer so kurz und direkt wie möglich halten. Auf den Punkt kommen, keine ausschweifenden Erklärungen oder langen Einleitungen.
- **Verständliche Antworten**: Erkläre Änderungen in einfacher, alltagstauglicher Sprache. Beschreibe immer konkret, was sich für die Bedienung, das Verhalten oder den Nutzen der App ändert.
- **Hintergründe auf den Punkt**: Erkläre bei wichtigen Entscheidungen kurz und verständlich die Gründe ("Warum wurde dieser Weg gewählt?"), ohne dich in Code-Monologen zu verlieren.
- **Keine Code-Wiederholungen im Chat**: Vermeide es, lange Codeblöcke im Chattext zu duplizieren.
- **Kontext sparen**: Große Dateien (>300 Zeilen) nicht ungezielt komplett laden, sondern mit `grep` und Zeilenausschnitten arbeiten.
- **Gezielt testen**: Vor Änderungen zuerst die betroffenen Einzeltests ausführen. Vollständige Checks (`npm run verify`) kurz halten.

## 6. Veröffentlichung

- Ein Push auf den `main`-Branch veröffentlicht die PWA automatisch über GitHub Pages.
- Versionsnummern und Cache-Strings für Releases werden im CI-Workflow gesetzt.

## 7. KI- & Entwickler-Integration (MCP Live-Bridge)

- **Direkte App-Verbindung (`mcp/` & `web/mcp-bridge.js`)**: Der MCP-Server verbindet KI-Assistenten (wie Antigravity) über einen lokalen WebSocket (`ws://127.0.0.1:8765`) direkt mit der im Browser laufenden App (`http://localhost:8000`).
- **Live-Tools**:
  - **Inhalte verwalten**: `impala_list_pages`, `impala_get_page`, `impala_create_page`, `impala_update_page`, `impala_search`, `impala_list_flashcards`, `impala_create_flashcard`.
  - **Diagnose & Performance**: `impala_get_diagnostics` (aktive Seite, Tabs, Speicher, Sync-Status, Console-Errors) und `impala_get_performance_trace` (Profiler-Trace, Long-Tasks).
  - **Live-Testing & UI-Interaktion**: `impala_eval` (beliebigen JS-Code im Browser-Kontext ausführen) und `impala_run_ui_action` (Seiten öffnen, Tabs schließen, Suche öffnen, Sync anstoßen).
- **Entwickler-Workflow**: Der Agent kann neue Features, Fehlerbehebungen und UI-Zustände direkt im echten Browser-Tab prüfen, Messwerte auslesen und ohne manuelle Testschritte des Nutzers verifizieren.
- **NotebookLM CLI-Integration (`notebooklm-py`)**: Auf dem Desktop-PC steht die offizielle CLI bereit (`notebooklm`). Der Agent kann Notizen via `impala67`-MCP auslesen, per CLI an Google NotebookLM übergeben (`notebooklm source add`), Studio-Artefakte wie Audio-Podcasts, Quizzes oder Flashcards generieren (`notebooklm generate`/`download`) und fertige Karteikarten oder Zusammenfassungen lautlos per `impala_create_flashcard` / `impala_update_page` direkt in Impala67 zurückschreiben.

