# Impala67 – Arbeitsregeln

## Produkt und Architektur

- Impala67 ist eine statische, installierbare PWA. `web/` ist zugleich der veröffentlichte App-Ordner.
- Die App ist local-first: fachliche Daten liegen in IndexedDB; Google Drive synchronisiert optional über `appDataFolder`, der Cloudflare Worker optional über E2EE-Events.
- Das Frontend bleibt eine statische PWA ohne Desktop-Wrapper. `server/` enthält die optionale Cloudflare-Komponente mit Worker, Durable Objects, D1 und R2. Neue Frontend-Funktionen müssen in aktuellen Browsern und als installierte PWA funktionieren.
- Die App nutzt native ES-Module ohne Bundler. Bewahre diesen Ansatz, außer eine Aufgabe fordert ausdrücklich eine Baukette.
- Bugs sollen an der Wurzel gelöst werden. Ich will nicht, dass dieselbe Regel an verschiedenen Stellen im Code behandelt wird.
- Schreibe kompakten, gut testbaren Code nach aktuellen Web-Standards. Bevorzuge DRY/KISS/YAGNI und vermeide parallele Implementierungen derselben Fachregel.
- Lasse große UI-Orchestratoren nicht weiter anwachsen: Extrahiere verhaltensneutrale, fachlich geschlossene Regeln bevorzugt in kleine ES-Module mit direkten Tests; öffentliche Modul-APIs und Persistenzformate bleiben dabei stabil.

## Wichtige Bereiche

- Einstieg und Start: `web/index.html`, `web/main.js`, `web/boot.js`
- Mobile UI: `web/mobile.js`, `web/mobile-view.js`, `web/mobile.css`
- Persistenz und Sync: `web/db.js`, `web/state.js`, `web/drive.js`, `web/sync-core.js`, `web/sync-crypto.js`, `web/sync-cloudflare.js`, `web/sync-maintenance.js`, `server/`
- KI und RAG: `web/ai.js`, `web/embedding.js`, `web/embedding-worker.js`, `web/rag.js`
- Offline und Updates: `web/service-worker.js`, `web/updater.js`, `web/version.json`
- Veröffentlichung: `.github/workflows/release.yml`

## Sicherheitsregeln

- Niemals API-Schlüssel, OAuth-Secrets, Tokens oder `web/config.local.js` committen.
- Eine statische PWA darf nur öffentliche Client-IDs enthalten. Zugangsdaten von KI-Anbietern bleiben nutzerlokal.
- Bei Änderungen an IndexedDB, Event-Log oder Drive-Sync Rückwärtskompatibilität standardmäßig wahren; ein absichtlicher Format-Cut braucht eine ausdrückliche Nutzerfreigabe und eine klare Protokollversion.
- Cloudflare-Sync verwendet Protokoll v4. D1 speichert nur Index-/Quota-Metadaten; verschlüsselte Eventpakete und Blobs liegen in R2. D1-Inline-Payloads und globale Alt-Cursor werden nicht unterstützt.
- Cloudflare-Wire-Events enthalten niemals lokale `seq`-/Replay-Metadaten; eingehende Events erhalten immer einen neuen lokalen IndexedDB-Schlüssel.
- Fremd-Events tragen ihre lokale Herkunft in `_remoteSource` (`drive` oder `cloudflare`); jeder Transport unterdrückt nur sein eigenes Echo, damit Drive als vollständiges Backup funktionieren kann.
- Große Sync-Payloads sowohl nach Eventanzahl als auch nach tatsächlichen UTF-8-Bytes begrenzen; Zeichenanzahl ist kein Byte-Limit.
- Cloudflare-Erststände werden vor E2EE in begrenzte Eventpakete gebündelt; fachliche Einzelereignisse nicht unnötig als einzelne R2-Objekte speichern.
- Cloud-Compaction erfolgt clientseitig als Generation-Cut: erst vollständig synchronisieren, dann `/api/reset`, danach aus dem lokalen Zustand nur den kompaktierten Eventstand und noch referenzierte Blobs neu hochladen. So bleiben E2EE und Offline-Geräte kompatibel.

## Arbeitsweise

- Beim Ändern gecachter App-Dateien die Service-Worker-Version erhöhen und Offline-Start sowie Reload prüfen. Veröffentlichte Builds erhalten ihre Release-Version im Workflow.
- Prüfe, ob diese `AGENTS.md` noch zum aktuellen Projektstand passt, und nenne bei Abweichungen konkrete Verbesserungsvorschläge.
- Arbeite tokeneffizient und verfolge betroffene Codepfade bis zu Persistenz, Sync, Cache und sichtbarer Oberfläche.
- Führe für ausgelieferte PWA-Änderungen Syntaxprüfung, passende Tests, den PWA-Cache-Check und `git diff --check` aus. Trenne lokale Prüfungen klar von echtem Provider-, Deployment- und iPad-Nachweis.

## Veröffentlichung

- Ein Push nach `main` veröffentlicht ausschließlich die PWA über GitHub Pages.
- Der CI-Workflow setzt `web/version.json`, `web/updater.js` und den Service-Worker-Cache für den Release. Lokale Versionen nur bewusst ändern.
