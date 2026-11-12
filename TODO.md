# Impala67 – Backlog & Offene Punkte

Stand: 7. November 2026 (letzter Release-Tag v2.2.123; Versionsnummern kommen aus den Release-Tags)

---

## 1. Zuletzt umgesetzt (Erledigt)

- [x] **Android-Editor & Suchleistung (7. November 2026)**:
  - Android: Eine Seite gilt erst nach erfolgreichem Schreiben als gespeichert; Fehlschläge werden wiederholt, Schreiben läuft nacheinander im Hintergrund statt auf dem Hauptthread (`1ef697f`).
  - Rust-Suche: Vektorsuche ohne Zwischen-Scores, Titel-Zählungen ohne Klon (`d79f51a`).

- [x] **iPad-App am Gerät geprüft und Basis gefestigt (4.–7. November 2026)**:
  - MCP-Bridge über WLAN (`mcp/lan-setup.mjs`, Port 8766), Diagnose, Profiler, Bildschirmfoto, UI-Baum, Tippen/Texteingabe sowie Seiten anlegen/ändern; Testbericht: `docs/IPAD-TESTBERICHT-2026-11-07.md`.
  - Startseite, Seitenleiste, Heft-Laden, Sync unter Last, Suche, Wissensgraph, KI-Streaming und Bibliothek laufen am Gerät ohne Hänger. Offen laut Bericht: 193 ms Kartenübersicht, 258 ms Einstellungen, 429 ms Kern-Sperre beim Karten-Sync, 789 ms Kaltstart, fehlender Versionsverlauf und Bridge-Lücken.
  - Einstellungen im PWA-Look, Heft-Bilder/Texte direkt bedienbar, Heftseiten durchlaufend, Striche als Bitmap, Speicher-Aufräumen; Kern-Sperre beim Aufräumen, Indexieren und Datei-Sync verkürzt; Heft-Undo klont nicht mehr das ganze Heft.
  - CI: Versionen kommen aus den Release-Tags (`version-from-tags.mjs`); GitHub-Releases werden nur noch manuell ausgelöst, der PWA-Deploy bleibt automatisch.

- [x] **Vollständige Rust-Kern- & WASM-Umstellung der PWA (27.–28. Oktober 2026, NATIV-PLAN 3a–3f)**:
  - **Architektur (Crux-Muster)**: Sämtliche Nicht-UI-Logik läuft im gemeinsamen Rust-Kern (`core/impala-core`, 12 Crates); der Kern rechnet ohne eigene E/A und nutzt asynchrone Plattform-Traits (`HttpClient`, Stores). PWA lädt den Kern beim Start synchron als WASM (`web/rust-core.js`), ohne JS-Rückfall.
  - **Datenmodell (`ModelCore`)**: Gesamter Zustand, Reducer (46 Typen), Replay, Checkpoint 1–3, Reihenfolge und Drei-Wege-Merge laufen im Kern. JS-Reducer, Checkpoint- und Konfliktlogik gelöscht. Schreibgeschützte Ansichten in `S` (`web/state-views.js`).
  - **Bedarfsweises Heft-Laden**: Hefte aus Checkpoints bleiben geprüfter Text bis zum ersten Zugriff; unveränderte Hefte werden nicht neu geschrieben (`fa5a12a`).
  - **Sync & Backup**: `SyncCore` (Cloudflare-Sync v4) und `DriveCore` (Google Drive) laufen vollständig in Rust (WASM); parallele Übertragungen via `impala_net::join_all` (Sync 3-fach, Drive 6-fach/3-fach).
  - **Fachlogik in Rust**: FSRS-5 (`impala-srs`), Markdown-Parser & Text-Helfer (`impala-markdown`), Seitensuche / Unscharfsuche / RAG-Ranking (`impala-search`, WASM-Index im Worker), Handschrift-Ablauf & Beam-Search (`impala-ink`), Heft-Geometrie / Gesten / PDF / Diff (`impala-heft`), KI-Agent-Schleife (`impala-ai`) und Log-Kompaktierung (`impala-sync`, `CORE.compactOrder`).

- [x] **Prüf- und Aufräumrunde (21. Oktober 2026)** – Befunde aus Code-Review und Live-Messung:
  - Start: Checkpoint wird bei verspäteten Fremd-Events weiterverwendet (`web/event-order.js`); vorher ~9 s Voll-Replay statt ~1,4 s. Checkpoints speichern nur noch sortierte Stände; Kompaktierung behält die höchste seq (kein Komplett-Neu-Upload).
  - Sicherheit: MCP-Bridge nur über Loopback, Sync-Schlüssel nicht mehr in Diagnosen, Kopplungslink nur mit Rückfrage, `javascript:`-Links im Editor nicht klickbar.
  - Daten: Seitentitel landet nicht mehr auf der falschen Seite, verdeckte Bestätigungen lösen nichts aus (`U.closeOverlay`), keine doppelten Events bei gleichzeitigem Cloudflare-/Drive-Import, Drive zeigt Importe sofort, Cloud-Reset ohne doppelten Upload.
  - Heft: Undo/Ziehen/Text-Editor nach dem Speichern, Textfelder verschwinden nicht mehr, Handballen und Zwei-Finger-Zoom zeichnen nicht mehr, Speicher für Kacheln/Scanner/PDF wird freigegeben, flache Linien legen die Handschrift-Erkennung nicht mehr lahm, Suche folgt Radieren/Rückgängig.
  - Lernen & KI: FSRS-Formel wie Referenz, Wissensgraph zeigt echten Lernstand, ⏹ stoppt KI-Läufe jederzeit, Stream-Fehler werden gemeldet, KI-Zwischenstände gehen nicht mehr in den Sync.
  - Aufräumen: ~400 Zeilen totes Lernzeit-Widget + CSS, tote Bibliotheks-Handler und Exporte, doppelte Helfer (Escape, gzip, Fokus, leere Heftseite), Import-Zyklus aufgelöst.

- [x] **Capacitor Android-Integration & Native Schicht (`web/platform-native.js`)**:
  - Basis-Setup (`capacitor.config.json`, `android/`), automatischer APK-Build via GitHub Actions (Release: `.github/workflows/release.yml`, Debug-Prüfbau: `android-check.yml`) und permanente Edge-to-Edge-Statusleiste.
  - Hardware-Back-Button, Haptik, lokale SRS-Erinnerungen, Dateisystem-Backup (`Documents/Impala67/`), ML Kit Document Scanner, Offline-Spracheingabe und „Senden an Impala67" (Share-Intent).
- [x] **Lokale Handschrifterkennung (Bild-Modell v2)**:
  - Plattformunabhängige ONNX-Erkennung im Worker (`handwriting/` → `web/handwriting-model.onnx`, ResNet18 + BiLSTM + CTC) ersetzt ML Kit OCR.
  - Beam-Search mit deutschem Wörterbuch (`core/impala-ink/src/ctc.rs`), Mathe-Formeln (MathWriting) und eigener Abschreib-Modus (`web/abschreiben.js`).
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

### iPad-Wunschliste (Nutzer, 12.11.2026) – Ziel: Heft so gut wie GoodNotes
- [ ] **Lasso wie GoodNotes**: Das jetzige Lasso reicht selbst für die Grundfunktionen nicht (Auswählen, Verschieben, Größe, Duplizieren, Ausschneiden/Kopieren, Löschen, Farbe).
- [ ] **Text direkt auf der Seite** schreiben und bearbeiten (wie GoodNotes) statt im Sheet.
- [ ] **Neue Seite durch Weiterziehen** am Heft-Ende.
- [ ] **Laserpointer** im Heft.
- [ ] **Cover für Notizen** (Farbe/Bild) – soll richtig gut aussehen.
- [ ] **Mehrere Blöcke auswählen** im Editor (⌘A zweistufig).
- [x] **Aktivitäts-Heatmap** und **Kartenbrowser mit Sortierung** (Intervall, Fehler) auf dem iPad – am Gerät prüfen.
- [x] **Lern-Extras standardmäßig aus** (Overlearning-Sperre, Pausen-Erinnerung) in PWA, iPad und Android; Karteikarten und Lernzeit-Messung bleiben an. Dabei behoben: PWA-Pausen-Erinnerung ließ sich nicht abschalten (`lernzeit.js` las „0“, gespeichert wird „off“).
- Später: Lernanalyse (erst wenn das Design in der PWA passt), Heft-Vorschau in Notizen.
- Nicht geplant: Anki-.apkg (TXT/CSV reicht), eigener KI-Knopf im Heft (KI-Knopf oben rechts reicht), Daily-Notizen, Abschreiben, „x % analysiert“, Export „Alle Handschrift“, Schulnoten.

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
- [x] **Große Dateien weiter geschnitten**:
  - `web/heft.js` (~1.670 Zeilen): Stift-Eingabe (`onDown`/`onMove`/`onUp`, Radierer, Lasso-Griffe, Formerkennung) in `web/heft-input.js`; gemeinsamer Zustand über Getter/Setter.
  - `web/app.js` (~850 Zeilen): Zentraler Klick-Handler in `web/app-click-chat.js`, `app-click-anki.js`, `app-click-pages.js`, `app-click-buttons.js` aufgeteilt; Helfer in `web/app-ui.js`, Touch/Handy-Erkennung in `web/platform.js` (statt `window.PLATFORM`).
  - `web/editor.js` (~1.900 Zeilen): Text-/Tabellen-/Code-Tasten in `web/editor-keys.js`.
- [ ] **Große Dateien optional weiter schneiden**:
  - `web/editor.js`: Blockauswahl-Tasten (`handleSelectionKeys`) und Host-Verkabelung (`wire`) — teilen sich viel Auswahl-Zustand, nur mit Getter/Setter-Schnittstelle sinnvoll.
  - `web/app.js`: Eingabe-/Change-Handler in `wireEvents()`.
- [x] **Restliche CSS-Überlagerungen abgebaut**:
  - Abgeleitete Design-Tokens (`--b-*`) nach `web/css/variables.css` überführt und die Komponenten-Regeln aus `web/design.css` direkt in `web/home.css`, `web/styles.css`, `web/css/editor.css` und `web/css/heft.css` integriert (`web/design.css` enthält nur noch Querschnitts-Kartenbasis und `motion.js`-Übergänge).
- [x] **Abhängigkeits-Knäuel & `window`-Brücke aufgelöst (`docs/ARCHITEKTUR.md` B1/B2)**:
  - Alle zirkulären Modul-Importe (0 verbleibende Zyklen in `web/*.js`) über `web/event-bus.js` (`BUS.on`/`emit`/`provide`/`call`) und direkte Submodul-Importe (`web/app-dialogs.js`, `web/state.js`) entkoppelt; veraltete Einzelfunktions-Aliase auf `window` in `web/main.js` entfernt. Die Modul-Objekte dort bleiben bewusst nur als Auswertungsschnittstelle für `impala_eval`; Fachmodule importieren direkt.

- [ ] **Bewusst offen gelassen (gemessen unkritisch)**:
  - Heft: Speichern vergleicht das ganze Heft (`diffDocument`); bei den größten Heften (~2.700 Striche) ~1 ms. Erst bei deutlich größeren Heften auf „nur geänderte Seiten“ umstellen.
  - KI-Werkzeug `change` kopiert vor jeder Änderung alle Seiten/Karten für das Undo (`tools.js` `managedSnapshot`).
  - RAG: `related()` liest alle Vektoren im Hauptthread (aktuell ~200 Einträge).
  - Laufzeit-Reihenfolge: Ein verspätetes, kollidierendes Fremd-Event wird bis zum nächsten Start in Ankunftsreihenfolge angezeigt (korrekt sortiert erst nach dem Neustart).

### Priorität 2: Heft-KI & Handschrift im Alltag nutzbar machen
- [ ] **KI-Funktionen direkt fürs Heft**:
  - Auf Basis des erkannten Heft-Textes (`ocrText` aus `heft-indexer.js`) und der Seitenbilder direkte Aktionen anbieten wie „Lernzettel aus diesem Heft erstellen" oder „Karteikarten aus Heft-Seite generieren".
- [ ] **Handschrifterkennung gezielt weiter schärfen**:
  - Erkennungsqualität auf echten Notizseiten (`handwriting/evaluate_notes_benchmark.py`) bei längeren Sätzen, Skizzen-Abgrenzung und Mathe-Ausdrücken weiter verbessern.

### Langfristig: Rust-Kern & native Apps
- [ ] **Plan in `docs/NATIV-PLAN.md`**: Gemeinsamer Rust-Kern (auch als WASM in der PWA), danach iPad, Android, Windows/Linux nativ.
  - [x] Schritt 1: Spike `core/` – Event-Kompaktierung in Rust; als WASM langsamer als JS, deshalb rechnet die PWA weiter in JS. Ergebnis und Messwerte im Plan.
  - [x] Schritt 2: Ganze Nicht-UI-Logik als Rust-Kern (12 Crates, Golden-Tests gegen JS, Stand im Plan).
  - [x] Kern ohne eigene Ein-/Ausgabe: `HttpClient`, Sync-, Drive- und KI-Traits asynchron.
  - [x] PWA-Sync nur noch über den Rust-Kern (`SyncCore`, WASM), JS-Sync-Logik gelöscht.
  - [x] Drive-Backup Rust only (`DriveCore` in `core/impala-wasm/src/drive.rs`, `web/drive.js` nur noch Anmeldung, Timer, Ein-/Ausgabe).
  - [x] Drive und Sync: Dateien wieder parallel (Drive 6 herunter/3 hoch, Sync 3), über `impala_net::join_all`.
  - [ ] Drive: Login/Upload großer Dateien (resumable, `Location`-Header) mit echtem Google-Konto prüfen.
  - [x] Rust only in der PWA: FSRS, Markdown, Suche/RAG, Handschrift, Heft-Logik, KI, Kompaktierung.
  - [x] Datenmodell nur noch in Rust (`ModelCore`, NATIV-PLAN 3f); JS-Reducer, Checkpoint-, Reihenfolge- und Konfliktlogik gelöscht.
  - [ ] Heft-Editor: Speichern serialisiert die ganze Arbeitskopie für den Diff (≈ 50 ms bei 2000 Strichen, wie vorher) – nur geänderte Seiten übergeben.
  - [ ] Start vom Checkpoint ≈ 15–30 % langsamer als die JS-Fassung (Text-Übergabe an WASM, `opt-level = "z"`); Kern-Zustand als Binärformat oder Teile je Sammlung prüfen.
  - [ ] Sync: WASM-Größe senken.
  - [x] UniFFI-Schnittstelle für `impala-core` (Swift/Kotlin), grobe Aufrufe (`core/impala-ffi`).
  - [x] iPad-App nativ (`ios/`, Stand in `ios/README.md`): erster CI-Build und Gerätetest erledigt (07.11.2026, App `2.2.124+25`); Bericht: `docs/IPAD-TESTBERICHT-2026-11-07.md`. Startseite, Heft, Suche, Graph, KI, Bibliothek und Sync wurden am Gerät geprüft.
    - [ ] Offen laut Bericht: am Gerät nachmessen – Einstellungen „Darstellung“ (258 ms) und Kern-Sperre nach dem Sync (429 ms) sind seit `bf594f7` im Code behoben; Kartenübersicht (193 ms) liest den Kern schon im Hintergrund, der Rest ist Zeichenzeit und nur mit Messung zu finden; Kaltstart (789 ms) prüfen. Verlauf am Gerät prüfen (Notizen: `PageHistorySheet`, Hefte: `HeftHistory`), Bridge am Gerät prüfen (`impala_create_page`/`impala_update_page`/`impala_list_flashcards`/`impala_create_flashcard` neu, `impala_type` nachgebessert), SwiftUI-Menüs barrierefrei machen.
    - [ ] Semantik auf dem iPad mit Apples Satzmodell (`NLEmbedding`, ohne Download; Vektoren nur lokal): „Verwandt“ gebaut (`Notes/SemanticIndex.swift`), am Gerät prüfen, ob die Schwelle 0,5 passt. Offen: Suche nach Bedeutung, RAG-Quellen im Chat, Fach-Einordnung per Embedding.
    - [ ] Toten Cloud-Embedding-Weg entfernen (Einstellungen bieten nur noch Bekko lokal): `SemanticSearch::with_cloud_embeddings`/`cloud` in `core/impala-ffi/src/rag.rs`, Remote-Queue in `web/ai.js` (`embedProvider`, `remoteEmbed*`).
  - [x] PWA: RAG-Index als WASM im Worker.
  - [ ] WASM-Größe (2,29 MB mit Datenmodell): `opt-level` (gemessen: `3` → 4,4 MB, Start ≈ 25 % schneller), `regex` in impala-ai ersetzen.
  - [ ] Fach-Erkennung: `core/impala-fach` (Golden-Tests gegen `web/fach.js`) nutzt bisher nur die iPad-App; PWA auf den Kern umstellen (`web/fach.js` bis auf die Embedding-Einordnung löschen, Ergebnis der Einordnung an den Kern übergeben).
  - [ ] Rust-Kern: Bekko-Embedding mit tract Ende-zu-Ende prüfen; `ort`-Feature oder Plattform-Erkenner statt tract.
- [ ] **JS-Fehler, beim Rust-Kern gefunden** (Details in den Commits auf `claude/rust-kern`):
  - [x] Erst-Sync eines neuen Geräts lädt alles Abgerufene erneut hoch und verdoppelt die Cloud-Belegung; Fehler ohne Status werden endlos wiederholt (beides mit dem Rust-Sync behoben).
  - [x] Markdown-Parser: Endlos-Hänger bei Callout-Titel mit U+2028/U+2029 im Rust-Parser behoben (`impala-markdown`); Farb-Serialisierung wie im JS-Original.
  - [x] KI: `view_heft_page` liefert dem Modell nie das Bild (JS-`pruneRunHistory`); Prompt nennt nicht angebotene Werkzeuge. Im Rust-Kern behoben: `prune_run_history` behält das angeforderte Heftbild, die Werkzeug-Anweisung entsteht aus der tatsächlich angebotenen Liste.
  - [x] Drive: 60-s-Aufschub greift nie (in `drive.js` behoben), Alt-Blob-Dateien werden bei jedem Sync neu geladen, kaputtes Base64 blockiert jeden Sync (beides mit dem Rust-Kern behoben).
  - [x] Handschrift: Skizzen-Striche zählen in der Strich-Bilanz (Rust-Ablauf).
  - [x] Start-Absturz bei Patch, der kein Objekt ist (früher `event-order.js:16`); Heft: Kreis-Bounds NaN, `s-` ohne Liste bricht Event ab (mit dem Rust-Datenmodell behoben).
  - [x] FSRS: Obergrenze der Stabilität nach Vergessen im Rust-Kern umgesetzt (`forget_stability`: `.min(s)`); Anzeige „60 Min“/„1 Jahre“ bleibt für Golden-Kompatibilität.
  - [x] Kompaktierung: Läuft nur noch im Rust-Kern (`CORE.compactOrder`); alter JS-Code und veraltete Kommentar-Regel 4 sind abgelöst.

### Priorität 3: Native Android-App (Kotlin + Jetpack Compose + UniFFI Rust-Kern)
*Ersatz der Capacitor-Hülle durch eine native App (Beschluss 28. Oktober 2026).*

*Inhaltlich am 1. November 2026 gegen den Code in `android/` geprüft, Kästchen am 7. November 2026 gezählt.
Oberfläche: Checkliste aller PWA-Elemente in [`android/UI-INVENTAR.md`](android/UI-INVENTAR.md)
(1451 Elemente, davon 496 offen). `[x]` heißt „im Code vorhanden“, nicht „am Emulator bestätigt“; ein Punkt gilt erst
als erledigt, wenn ein Emulator-Screenshot neben der PWA (gleiche Breite) übereinstimmt.*

- [x] **Strategie & Setup (Option B – harter Schnitt direkt in `android/`)**:
  - Capacitor- und Cordova-Reste aus `android/` entfernt.
  - Gradle mit Kotlin und Jetpack Compose (Material 3 Expressive).
  - Rust-NDK-Build und UniFFI-Kotlin-Bindings (`npm run build:android-core`, `tools/android-core.mjs`).
  - JNA eingebunden.
- [x] **Daten & Schlüssel**: Daten kommen über Cloudflare-Sync bzw. Drive-Backup in den Rust-Kern (keine Übernahme aus der alten Capacitor-App – bewusst, Absicherung über Backup/Drive). Der Sync-Schlüssel liegt auf dem Gerät mit dem Android Keystore verschlüsselt (`settings/SecretBox.kt`).
- [x] **Plattform-Features & Bibliotheken**:
  - [x] **Stift / Zeichnen**: Jetpack Ink (`androidx.ink`) im Heft.
  - [x] **Handschrifterkennung**: ML Kit Digital Ink (Suchindex).
  - [x] **Dokumentenscanner (Dual-Modus)**: ML Kit Document Scanner ✅; eigener Bild-Scanner und Auswahl zwischen beiden ✅ (Code 2.11., am Gerät ungeprüft).
  - [x] **Hintergrund-Sync**: WorkManager, stündlich ein Cloudflare-Durchgang mit Netz (`sync/BackgroundWork.kt`).
  - [x] **Sicherheit**: Sync-Schlüssel im Keystore ✅; Drive-Token nur im Arbeitsspeicher ✅; KI-API-Schlüssel liegen wie in der PWA in `settings.aiProviders` (reisen E2EE mit dem Sync; `SecretBox` brächte dort nichts, weil der Kern sie ohnehin speichert).
  - [x] **Diktat**: `SpeechRecognizer` (de-DE) im Chat – Teilergebnisse live, Ergebnis wird gesendet (`ai/Dictation.kt`). Vorlesen der Antwort fehlt (in der PWA standardmäßig aus).
  - [x] **Systemintegration**: Teilen *aus* der App ✅ (nur Tablet); Teilen *an* die App ✅ (Text → neue Seite, Bilder/PDF → neues Heft, `share/Incoming.kt`); App-Shortcuts ✅; Predictive Back ✅.
  - [x] **Lokale Erinnerung „Karteikarten fällig“**: täglich 18 Uhr über WorkManager, Tipp öffnet das Lernen.
- [ ] **Oberfläche wie die PWA** – Abarbeitung nach `android/UI-INVENTAR.md` (Reihenfolge oben in der Datei):
  - [x] Heft: sichtbare Fehler – Bilder/Scans/Textfelder zeichnen, Farbpunkte, Marker-Farbe, Werkzeugzustand speichern, Zoom 0,4–6, Werkzeugleiste oben mittig mit Optionsleiste darunter (auch Telefon), Einklappen, Schreib-Rückzug.
  - [ ] Heft: Formerkennung ✅, Laser ✅, Radierer halten ✅, Doppeltipp-Zoom ✅, Zwei-/Drei-Finger-Tipp ✅, „Seite hinzufügen“ Davor/Danach/Am Ende ✅, Bild-/Text-Werkzeug ✅, Import/Export ✅ (auch in andere Hefte bzw. als Notiz), Verlauf ✅, Lesemodus (Telefon) ✅; offen: PDF-Text beim Import übernehmen.
  - [ ] Seitenmenü (⋯): Tablet ✅ inkl. „Als Vorlesungsübersicht“ bis auf „Fach…“ (mit dem Fächer-Modul); Telefon offen (zurückgestellt, erst Tablet).
  - [x] Editor: `[[`-Links ✅, Blockgriff mit Blockmenü ✅, Bilder/Dateien (`img:`/`file:`) ✅, Link-Schema ✅, Slash-Menü vollständig ✅ (Strukturblöcke über Rohtext), Toggle-Zustand gespeichert ✅, Formelblöcke (KaTeX) ✅, Mermaid/SVG mit Live-Vorschau ✅ (WebView, Bibliotheken wie die PWA vom CDN, danach im Cache), Datenbankansicht ✅ (Kern: `page_db`/`page_props`/`set_page_db`/`set_page_prop`), Inline-Formatierung per Tasten und Werkzeugleiste ✅ (Strg+B/I/U/E/K, Strg+Shift+S/H, Strg+Z/Y). Inline-Formeln `$…$` als KaTeX ✅, Tabellenzellen direkt bearbeiten ✅.
  - [x] Shell: Vor-Navigation ✅, Chat-/Karten-Tabs ✅, Drag & Drop (Seiten, Stapel, Tabs) ✅, Breitengriff ✅, Langdruck-Menüs ✅, Dichte/Schrift/Bewegung ✅, Tabs in Seitenleiste ✅, Tabs/Aufklappzustand gespeichert ✅, Dock bei Tastatur/Lernen ausblenden ✅, Daily Notes ✅, Gemini-Notebook-Tab ✅ (Code 2.11., am Gerät ungeprüft).
  - [x] KI: Anhänge, Modellwahl, Aktionen je Nachricht (Diktat ✅; Code 2.11., am Gerät ungeprüft).
  - [ ] Lernen: Statistik, Archiv, Import/Export, Feynman/Experimente, Lernanalyse, Lernzeit-Erfassung ✅ (Code 2./3.11.); Fächer und Schulnoten zurückgestellt (siehe unten).
  - [ ] Einstellungen: Übersicht ✅, KI-Quellen und Modellwahl ✅ (Kern: `ai_list_models`/`ai_ping_provider`), Backup Export/Import ✅, Gefahrenzone ✅ (Kern: `clear_pages`/`delete_all_cards`/`card_totals`), Speicher ✅; Suche, Diagnose, Modell-Favoriten, Weitere Exporte, Performance-Profiler und APK-Update ✅ (Code 2./3.11.); offen: Embedding-/Handschrift-Modell, Controller, Beta-Lernfunktionen.
  - [x] Neue Module: Wissensgraph, Gemini Notebook, PDF-Ansicht, Bibliothek-Ordner, Daily Notes ✅ (Code 2./3.11., am Gerät ungeprüft).
  - [x] Akzentfarbe aus dem Android-Hintergrundbild (Material You, ab Android 12; Standard) – Akzentauswahl wird jetzt auch angewendet.
- [x] **Android Google Drive OAuth**: Anmeldung über Google Identity (`sync/DriveController.kt`).
- [x] **Umgesetzt (2. November 2026, noch nicht auf dem Gerät getestet)**: eigener Impala-Scanner (Kern: `scan_detect`/`scan_process`,
  Auswahl in Einstellungen → App), Wissensgraph (Anzeige/Bearbeiten des synchronisierten Graphen, KI-Analyse ohne Embeddings),
  Gemini Notebook (Inbox nur auf dem Gerät), Bibliothek mit Heft-Regal/Ordnern und eingebetteter PDF-Ansicht, Tastaturkürzel
  (Editor, Heft, Lernen, Palette, Chat), Statistik-Tab, Lern-Analyse, Startseiten-Lernanalyse, Lernzeit-Erfassung
  (Kern: `learning_stats_json`), Karten-Import/-Export (TXT/CSV/Anki-Text/.apkg), Weitere Exporte, Performance-Profiler,
  KI (Anhänge, Seitenkontext-Chip, Modellmenü mit Favoriten/Denkaufwand, Kopieren/Anpassen/Bearbeiten, Status-Chip, Verlauf;
  Kern: `AiAssistant.complete`/`refine`).
  Noch offen davon: Seiten-Diff der KI-Änderungen, Toggle-/Blockauswahl-Tasten, Höhen-Griff eingebetteter PDFs,
  eigenes Cover-Bild anzeigen.
- [x] **Umgesetzt (3. November 2026, noch nicht auf dem Gerät getestet)**: Inline-Formeln `$…$`/`\(…\)` als KaTeX
  (Notizen und Chat), Tabellenzellen direkt bearbeiten (Tab/Enter/↑↓, „+ Zeile“/„+ Spalte“), Archiv-Banner und
  Unterseiten-Liste am Seitenende, Daily Notes (Kalender und Tagesseite; Kern: `daily_notes`/`open_daily_note`),
  Karten-Archiv mit Wiederherstellen, Feynman-Lernmodus (je Stapel und alle Stapel, KI-Prüfung mit Notenvorschlag),
  Ehrlichkeits- und Pausen-Hinweis beim Lernen, Backup-Hinweis auf der Startseite (Kern: `drive_backup_view` zählt
  jetzt auch Drive als Kanal), Startfehler-Anzeige und Hinweis bei langem Start, Einstellungssuche, Kartenzahl am
  App-Symbol über die Erinnerung. Bewusst nicht übernommen, weil in der PWA ohne Wirkung: Lerntimer-Start, Vorlesen.
  Noch offen: „Verwandt“-Leiste und RAG-Quellen (brauchen den semantischen Index auf Android).
  `android/UI-INVENTAR.md` ist nachgezogen (955 von 1451 Kästchen erledigt), aber noch nicht am Emulator geprüft.
- **Erstmal irrelevant (zurückgestellt)**: Schulnoten, Fächer, Abschreiben (Schreibübung), Beta-Lernfunktionen (Experimente),
  Handschrift-Training/-Einstellungen, Export-Feinheiten, Seitenkopf-Reste (Cover-Bild, Breite, Schrift),
  Controller, Fach-Vorschläge, Heft-Kopfmenüs, Startbildschirm-Widget und die ganze
  Telefon-Oberfläche (Teil 6 im Inventar).

- [ ] **Android Home-Screen Widget (optional)**:
  - Startbildschirm-Widget für einen schnellen Blick auf heute fällige Karteikarten.
