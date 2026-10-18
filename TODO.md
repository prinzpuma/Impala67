# Impala67 – Backlog & Offene Punkte

Stand: v2.2.77 (Oktober 2026)

---

## 1. Zuletzt umgesetzt (Erledigt)

- [x] **Capacitor Android-Integration & Native Schicht (`web/platform-native.js`)**:
  - Basis-Setup (`capacitor.config.json`, `android/`), automatischer APK-Build via GitHub Actions (`.github/workflows/android-build.yml`) und permanente Edge-to-Edge-Statusleiste.
  - Hardware-Back-Button, Haptik, lokale SRS-Erinnerungen, Dateisystem-Backup (`Documents/Impala67/`), ML Kit Document Scanner, Offline-Spracheingabe und „Senden an Impala67" (Share-Intent).
- [x] **Lokale Handschrifterkennung (Bild-Modell v2)**:
  - Plattformunabhängige ONNX-Erkennung im Worker (`handwriting/` → `web/handwriting-model.onnx`, ResNet18 + BiLSTM + CTC) ersetzt ML Kit OCR.
  - Beam-Search mit deutschem Wörterbuch (`web/handwriting-ctc.js`), Mathe-Formeln (MathWriting) und eigener Abschreib-Modus (`web/abschreiben.js`).
  - Benchmark-Stand (Lauf 3, siehe `handwriting/README.md`): **0,0 % TEST-CER** auf eigenen Benchmark-Wörtern, **5,3 % CER** auf Abschreib-Zeilen.
  - Zentrale, akkuschonende Hintergrund-Indexierung über `HEFT_INDEXER.schedulePage` (`web/heft-indexer.js`) und reduzierte Stiftlatenz (`desynchronized: true`).
- [x] **UI-Designsystem & Icon-Sprache**:
  - Typografie- (`--text-*`) und Spacing-Skala (`--space-*`) in `web/css/variables.css` konsolidiert.
  - Zentrales SVG-Icon-Sprite (`web/icons.svg` + `web/icons.js`) ersetzt UI-Emojis und verstreute Inline-SVGs in über 40 Dateien.
  - Ruhige, aus `--accent` abgeleitete Flächen-Tokens (`--b-tint*`, `--b-card`, `--b-float`) und Feder-Animationen (`web/design.css`, `web/motion.js`) als Standard übernommen; `web/beta-ui.css` als leerer Experimentier-Slot zurückgesetzt.
- [x] **Erste Entschlackung & Modularisierung**:
  - Architektur, Datenflüsse und Baustellen (B1–B6) in `docs/ARCHITEKTUR.md` dokumentiert.
  - Tote Funktionen (~30 Exporte) und doppelte Helfer (`mapLimit`, `sha256Hex`, `gzipBytes`, `norm`/`dot`, `LOCAL_EMBED_MODEL_ID`) bereinigt.
  - Event-Kompaktierung in Hintergrund-Worker ausgelagert (`web/compact-events.js`, `web/compact-worker.js`).
  - Module aus Monolithen geschnitten: `web/editor-menus.js` (aus `editor.js`), `web/heft-lasso.js`, `web/heft-scanner-ui.js`, `web/heft-pages-beta.js`, `web/heft-toolbar-beta.js` (aus `heft.js`), `web/conflict-ui.js` (aus `render.js`).

---

## 2. Jetzt am nötigsten (Priorisierte nächste Schritte)

### Priorität 1: Monolithen, CSS-Schichten & Modul-Grenzen aufräumen (KISS & DRY)
- [x] **Beta-Namensreste & Heft-CSS-Überlagerung bereinigt**:
  - `web/heft-pages-beta.js` und `web/heft-toolbar-beta.js` in `web/heft-pages-ui.js` und `web/heft-toolbar-ui.js` überführt; die gesamte Toolbar-, Tray- und Popover-HTML-Erzeugung aus `web/heft.js` dorthin ausgelagert.
  - `web/css/heft-ui.css` vollständig mit `web/css/heft.css` zusammengeführt und als separate Datei entfernt.
- [x] **Doppelte Zuständigkeiten auflösen (`docs/ARCHITEKTUR.md` B3)**:
  - Embedding-Worker-Verwaltung und lokaler Modellkatalog aus `web/ai.js` vollständig nach `web/embedding.js` verlagert.
  - Doppelte HTML-Erzeugung zwischen `web/settings.js` und `web/settings-renderer.js` (Modell-Liste, lokaler Embedding-Status) im Renderer zusammengeführt.
- [x] **Weitere Monolithen-Schnitte umgesetzt**:
  - `web/heft-import.js` (Datei-/Bild-/PDF-Import) und `web/heft-storage.js` (Blob-Referenzen, Altbestand-Migration, Verlauf-Snapshots) aus `web/heft.js` ausgelagert.
  - `web/app-sidebar-events.js` (Sidebar-Drag-&-Drop, Inline-Umbenennen, Breitenanpassung) und `web/app-dialogs.js` (Dialoge, Seiten-Flows, Anki-/Lernmodus-Helfer) aus `web/app.js` ausgelagert.
  - `web/editor-inline.js` (Inline-Markdown, KaTeX-Hydrierung, Caret-Berechnung) aus `web/editor.js` ausgelagert.
- [ ] **Große Dateien weiter schneiden**:
  - `web/heft.js` (~2.075 Zeilen): Viewport/Zoom/Kacheln und Finger-Gesten sind in `web/heft-viewport.js` ausgelagert. Offen: Stift-Eingabe (`onDown`/`onMove`/`onUp`, eng mit Werkzeugen, Auswahl und Undo verflochten) in `heft-input.js` herauslösen.
  - `web/app.js` (~1.815 Zeilen): Verbleibende Bereiche in `wireEvents()` (z. B. Anki/Lernmodus-Klicks, Daily Notes, Kontextmenüs) aufteilen.
  - `web/editor.js` (~2.215 Zeilen): Verbleibende Teilbereiche (z. B. Tastatur-Handler / Block-Operationen) modularisieren.
- [x] **Restliche CSS-Überlagerungen abgebaut**:
  - Abgeleitete Design-Tokens (`--b-*`) nach `web/css/variables.css` überführt und die Komponenten-Regeln aus `web/design.css` direkt in `web/home.css`, `web/styles.css`, `web/css/editor.css` und `web/css/heft.css` integriert (`web/design.css` enthält nur noch Querschnitts-Kartenbasis und `motion.js`-Übergänge).
- [x] **Abhängigkeits-Knäuel & `window`-Brücke aufgelöst (`docs/ARCHITEKTUR.md` B1/B2)**:
  - Alle zirkulären Modul-Importe (0 verbleibende Zyklen in `web/*.js`) über `web/event-bus.js` (`BUS.on`/`emit`/`provide`/`call`) und direkte Submodul-Importe (`web/app-dialogs.js`, `web/state.js`) entkoppelt; veraltete Einzelfunktions-Aliase auf `window` in `web/main.js` entfernt.

### Priorität 2: Heft-KI & Handschrift im Alltag nutzbar machen
- [ ] **KI-Funktionen direkt fürs Heft**:
  - Auf Basis des erkannten Heft-Textes (`ocrText` aus `heft-indexer.js`) und der Seitenbilder direkte Aktionen anbieten wie „Lernzettel aus diesem Heft erstellen" oder „Karteikarten aus Heft-Seite generieren".
- [ ] **Handschrifterkennung gezielt weiter schärfen**:
  - Erkennungsqualität auf echten Notizseiten (`handwriting/evaluate_notes_benchmark.py`) bei längeren Sätzen, Skizzen-Abgrenzung und Mathe-Ausdrücken weiter verbessern.

### Priorität 3: Android & Plattform-Ergänzungen
- [ ] **Google Drive Login in Android-APK verifizieren**:
  - OAuth2-Ablauf in der nativen Capacitor-Umgebung testen und absichern (Webclient-ID vs. Android OAuth-Redirect / Chrome Custom Tabs).
- [ ] **Android Home-Screen Widget (optional)**:
  - Startbildschirm-Widget für einen schnellen Blick auf heute fällige Karteikarten.
