# Impala67 – Arbeitsregeln

## 1. Produkt und Plattformen

- **PWA auf allen Geräten**: Impala67 ist eine statische, installierbare Progressive Web App (Local-First) mit Android-Hülle (Capacitor). Nutzung:
  - **iPad / Tablet**: Handschriftliche Notizen und Zeichnungen mit dem Stift (Heft-Ansicht).
  - **Laptop / PC (Linux, Windows, macOS)**: Strukturiertes Tippen (Markdown-Editor).
  - **Smartphone / Android**: Schnelles Lesen und mobile Kurznotizen.
- **Kostenlos**: Ohne laufende Serverkosten betreibbar (Cloudflare Free Tier, GitHub Pages).
- **Ohne Bundler**: Der Web-Code (`web/`) nutzt native ES-Module und Standard-CSS, ohne Build-Schritt. Capacitor kopiert nur die fertigen Dateien in die Android-Hülle.
- **Plattformübergreifende Entwicklung**: Entwickler-Tools, npm-Skripte und Tests müssen unter Windows, Linux und macOS funktionieren.

## 2. Daten und Synchronisation

- **Local-First**: Alle Daten liegen primär lokal im Browser (IndexedDB). Die App funktioniert immer offline.
- **Cloudflare Live-Sync (E2EE)**: Schneller, Ende-zu-Ende-verschlüsselter Sync zwischen Geräten.
- **Google Drive Backup**: Optionales, unabhängiges Notfall-Backup.
- **Protokoll-Details**: Technische Regeln für Protokoll v4 (R2, D1, Kompaktierung) stehen im Skill `cloudflare-sync-v4`.

## 3. Wichtige Bereiche

- **Einstieg & Shell**: `web/index.html`, `web/main.js`, `web/boot.js`, `web/app.js`
- **Editor & Notizen**: `web/editor.js`, `web/render.js`
- **Handschrift & Zeichnen (Heft)**: `web/heft.js`
- **Mobile & Touch**: `web/mobile.js`, `web/mobile-view.js`, `web/mobile.css`
- **Daten & Sync**: `web/db.js`, `web/state.js`, `web/sync-core.js`, `web/sync-crypto.js`, `web/sync-cloudflare.js`, `web/drive.js`, `server/`
- **KI & Suche (RAG)**: `web/ai.js`, `web/embedding.js`, `web/embedding-worker.js`, `web/rag.js`
- **Offline & Cache**: `web/service-worker.js`, `web/updater.js`, `web/version.json`
- **Veröffentlichung**: `.github/workflows/release.yml`, `.github/scripts/set-version.mjs`
- **Backlog**: `TODO.md`

## 4. Code-Qualität und Sicherheit

- **Ursachen lösen, nicht Symptome**: Keine doppelten Regeln oder Sonderfälle nebeneinander. Einfachste Lösung zuerst (KISS), nichts auf Vorrat bauen (YAGNI).
- **Dateigrößen**: Neue, in sich geschlossene Logik in kleine, testbare Module auslagern. Große Dateien, die nicht endlos wachsen sollen: `web/heft.js`, `web/editor.js`, `web/app.js`, `web/render.js`, `web/state.js`, `web/settings.js`, `web/ai.js`.
- **Sicherheit & Geheimnisse**: Keine API-Schlüssel, Tokens oder `web/config.local.js` committen. KI-Schlüssel bleiben nur lokal im Browser.
- **Rückwärtskompatibilität**: Lokale IndexedDB-Daten dürfen durch Updates nie verloren gehen oder ungefragt inkompatibel werden.
- **Offline-Cache**: Werden gecachte App-Dateien geändert, muss die Cache-Version im Service Worker angepasst werden.

## 5. Arbeitsweise

- **Kommunikation**: Kurz und verständlich antworten. Änderungen so beschreiben, wie sie sich für Bedienung, Verhalten oder Nutzen der App auswirken. Keine langen Code-Blöcke im Chat wiederholen.
- **Kontext sparen**: Dateien über 300 Zeilen nicht komplett laden, sondern mit `grep` und Zeilenausschnitten arbeiten. Details zu Agenten-Delegation stehen in `CLAUDE.md`.
- **Testen**: Vor einer Änderung die betroffenen Einzeltests ausführen. `npm run verify` nur bei Bedarf.
- **Keine ungefragten Tests**: Neue Testdateien (`test/*.test.mjs`) nur auf ausdrücklichen Wunsch anlegen. Sonst über bestehende Tests, gezielte Checks oder die MCP-Live-Bridge verifizieren.

## 6. Veröffentlichung

- **Ein Push auf `main` geht sofort live**: Er veröffentlicht die PWA automatisch über GitHub Pages. Vorher prüfen, ob die Änderung fertig ist.
- **Versionen automatisch**: Der CI-Workflow setzt Versionsnummern und Cache-Strings über `.github/scripts/set-version.mjs`. Nicht von Hand ändern.

## 7. KI- & Entwickler-Integration (MCP Live-Bridge)

- **Verbindung**: Der MCP-Server in `mcp/` verbindet KI-Assistenten über einen lokalen WebSocket (`ws://127.0.0.1:8765`) mit der im Browser laufenden App (`http://localhost:8000`). Die Gegenseite in der App ist `web/mcp-bridge.js`.
- **Tools** (Stand: Code in `mcp/` und `web/mcp-bridge.js`):
  - **Inhalte**: `impala_list_pages`, `impala_get_page`, `impala_create_page`, `impala_update_page`, `impala_search`, `impala_list_flashcards`, `impala_create_flashcard`
  - **Diagnose & Performance**: `impala_get_diagnostics`, `impala_get_performance_trace`
  - **Live-Testing & UI**: `impala_eval`, `impala_run_ui_action`
  - **Heft-Import**: `impala_heft_scan_extract`, `impala_heft_scan_review_list`, `impala_heft_scan_consensus_import`
  - **Speicher**: `impala_storage_report`, `impala_storage_cleanup`
- **Entwickler-Workflow**: Der Agent prüft Features und Fehler direkt im echten Browser-Tab und liest Messwerte aus. Der Nutzer muss dafür keine manuellen Testschritte machen.
