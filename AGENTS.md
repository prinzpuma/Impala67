# Impala67 – Arbeitsregeln

## Produkt und Architektur

- Impala67 ist eine statische, installierbare PWA. `web/` ist zugleich der veröffentlichte App-Ordner.
- Die App ist local-first: fachliche Daten liegen in IndexedDB; Google Drive synchronisiert optional über `appDataFolder`.
- Es gibt keinen Desktop-Wrapper und keine serverseitige Anwendung. Neue Funktionen müssen in aktuellen Browsern und als installierte PWA funktionieren.
- Die App nutzt native ES-Module ohne Bundler. Bewahre diesen Ansatz, außer eine Aufgabe fordert ausdrücklich eine Baukette.
- bugs sollen an ihrer wurzel gelöst warden. ich will nicht dass an verschiedenen stellen im code das gleiche behandelt wird
- sauberen code schreiben, der state of the art code prinzipien verwendet, um das project nicht aufzublähen und es perfekt für ein vibecoding project zu machen

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

- Beim Ändern gecachter App-Dateien die Service-Worker-Version erhöhen und Offline-Start sowie Reload prüfen.
- prüfe ob die agents.md datei noch aktuell ist und mach eventuell verbesserungsvorschläge

## Veröffentlichung

- Ein Push nach `main` veröffentlicht ausschließlich die PWA über GitHub Pages.
- Der CI-Workflow setzt `web/version.json` und `web/updater.js` für den Release. Lokale Versionen nur bewusst ändern.
