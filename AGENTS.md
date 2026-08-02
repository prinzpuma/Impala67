# Impala67 – Arbeitsregeln

## Produkt und Architektur

- Impala67 ist eine statische, installierbare PWA. `web/` ist zugleich der veröffentlichte App-Ordner.
- Die App ist local-first: fachliche Daten liegen in IndexedDB; Google Drive synchronisiert optional über `appDataFolder`.
- Es gibt keinen Desktop-Wrapper und keine serverseitige Anwendung. Neue Funktionen müssen in aktuellen Browsern und als installierte PWA funktionieren.
- Die App nutzt native ES-Module ohne Bundler. Bewahre diesen Ansatz, außer eine Aufgabe fordert ausdrücklich eine Baukette.

## Wichtige Bereiche

- Einstieg und Start: `web/index.html`, `web/main.js`, `web/boot.js`
- Persistenz und Sync: `web/db.js`, `web/state.js`, `web/drive.js`, `web/sync-core.js`
- Offline und Updates: `web/service-worker.js`, `web/updater.js`, `web/version.json`
- Veröffentlichung: `.github/workflows/release.yml`

## Sicherheitsregeln

- Niemals API-Schlüssel, OAuth-Secrets, Tokens oder `web/config.local.js` committen.
- Eine statische PWA darf nur öffentliche Client-IDs enthalten. Zugangsdaten von KI-Anbietern bleiben nutzerlokal.
- Bei Änderungen an IndexedDB, Event-Log oder Drive-Sync Rückwärtskompatibilität wahren und alte Daten nicht still verwerfen.

## Arbeitsweise

- Vor Änderungen zunächst `git status --short` prüfen und vorhandene Nutzeränderungen bewahren.
- Kleine, nachvollziehbare Änderungen bevorzugen; keine automatische Formatierung des gesamten Projekts.
- Nach JavaScript-Änderungen alle Module mit `node --check` prüfen.
- Für manuelle Prüfung die PWA über einen lokalen HTTP-Server aus `web/` starten, nicht per `file://`.
- Beim Ändern gecachter App-Dateien die Service-Worker-Version erhöhen und Offline-Start sowie Reload prüfen.

## Veröffentlichung

- Ein Push nach `main` veröffentlicht ausschließlich die PWA über GitHub Pages.
- Der CI-Workflow setzt `web/version.json` und `web/updater.js` für den Release. Lokale Versionen nur bewusst ändern.
