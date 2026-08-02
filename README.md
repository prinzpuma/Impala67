# Impala67

Impala67 ist eine local-first PWA für Notizen, PDFs, Handschrift, Karteikarten und KI-gestütztes Lernen.

## Lokal starten

Unter Windows `start_pwa.bat` doppelklicken oder im Ordner `web` einen lokalen HTTP-Server auf Port 8000 starten. Die App anschließend über `http://localhost:8000` öffnen.

## PWA und Daten

- Die App kann im Browser installiert werden und funktioniert offline über einen Service Worker.
- Daten bleiben zunächst in IndexedDB auf dem Gerät. Google-Drive-Sync ist optional.
- Für Google Drive wird ein OAuth-Client vom Typ **Webanwendung** benötigt. Die zugelassene JavaScript-Quelle muss der späteren PWA-Adresse entsprechen.
- Eine Client-ID darf in `web/config.local.js` stehen; API-Schlüssel und OAuth-Secrets gehören nie in eine statische PWA oder ins Repository.

## Veröffentlichung

Ein Push nach `main` veröffentlicht `web/` als PWA über GitHub Pages. Der Workflow prüft alle JavaScript-Dateien und versieht das veröffentlichte Bundle mit der Release-Version.
