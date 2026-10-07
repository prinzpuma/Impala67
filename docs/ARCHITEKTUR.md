# Impala67 – Architektur

Stand: 2026-10-07 · ca. 40.000 Zeilen in `web/*.js`, 89 Module.
Diese Datei beschreibt, **wie die App gebaut ist** und **wo es hakt**. Regeln stehen in `AGENTS.md`, Sync-Details im Skill `cloudflare-sync-v4`.

---

## 1. Das Grundprinzip in drei Sätzen

1. Jede Änderung ist ein **Event** (`STATE.dispatch(type, payload)`), das zuerst in IndexedDB landet und dann den Speicherstand `S` verändert. (Event-Sourcing)
2. Die Oberfläche wird aus `S` **neu berechnet** (`RENDER.render()`), aber nur geänderte DOM-Teile werden ersetzt (`U.morph`).
3. Sync verschickt **dieselben Events** verschlüsselt an Cloudflare; andere Geräte spielen sie ein. Drive ist nur Backup.

```
 Nutzer-Aktion
      │
      ▼
 app.js / editor.js / heft.js ──► STATE.dispatch(type, payload)
                                        │
                     ┌──────────────────┼──────────────────┐
                     ▼                  ▼                  ▼
              DB.addEvent()        STATE.reduce()     onAfterDispatch
              (IndexedDB)          ändert S            │
                                        │              ▼
                                        ▼        sync-cloudflare.js
                                  RENDER.render()  push (AES-GCM)
                                  (rAF-gebündelt,      │
                                   DOM-Diff)           ▼
                                                 Cloudflare Worker
                                                 (D1-Index + R2)
                                                       │
                                  anderes Gerät ◄──────┘
                                  pull → STATE.applyRemoteEvents()
```

---

## 2. Start der App

`index.html` → `main.js` → `boot.js:initApp()`

1. `index.html`: Fehler-Fänger, Darstellung vorab (Theme), CDN-Bibliotheken (DOMPurify, marked), Service-Worker-Registrierung.
2. `main.js`: importiert **alle** Module und hängt sie zusätzlich an `window` (Übergangslösung, siehe Baustelle B2).
3. `boot.js:initApp`: `DB.open` → `STATE.load` (Checkpoint laden + Rest-Events nachspielen) → Migrationen → `TABS.restoreSession` → `APP.wireEvents` → erstes `render()`.
4. Danach im Hintergrund: Cloudflare-Sync, Drive-Auto-Sync, MCP-Bridge, Update-Watcher, Heft-OCR-Indexer, Prefetch optionaler Module.

---

## 3. Daten

### `S` und `STATE` (`state.js`)
- **`S`** = der komplette Speicherstand als einfaches Objekt: `pages`, `cards`, `decks`, `heftDocs`, `heftBlobs`, `settings` … plus flüchtiger UI-Zustand (`view`, `tabs`, `navHistory`, `aiBusy` …). Nur ein Teil wird gespeichert (`INITIAL_PERSISTED_STATE`).
- **`STATE`** = Logik: `dispatch`, `reduce` (großer `switch` mit ~60 Event-Typen, `state.js:469–980`), `load`, Checkpoints, Abfragen (`activePages`, `dueCards`, `searchNotes`, `backlinksOf` …).
- Regel: `S` wird nur über `dispatch` → `reduce` verändert. (Ausnahme: flüchtiger UI-Zustand.)

### IndexedDB (`db.js`)
| Store | Inhalt |
|---|---|
| `events` | das Event-Log (Quelle der Wahrheit) |
| `blobs` | Bilder, PDFs, Heft-Versionen (`heftver:*`), Checkpoints |
| `vecs` | Embeddings für die KI-Suche |

**Checkpoints** (`state-checkpoint.js`, `checkpoint-scheduler.js`): Schnappschuss von `S` mit Event-Nummer. Beim Start wird nur der Rest des Logs nachgespielt → schneller Start.

### Heft-Daten
- `S.heftDocs[pageId] = { v:2, rev, pages:[{ id, paper, strokes, images, texts, ocrText }] }`
- Stroke: `{ id, tool, color, size, pts:[[x,y,p]], shape?, bbox? }`
- Bilder liegen inhaltsadressiert in `S.heftBlobs[hash]`, das Heft verweist per `ref`.
- Änderungen laufen als **`heftOps`**-Events (`pg+`, `s+`, `i+`, `x+`, `ocr` …), erzeugt per Diff (`heft-document-core.js`).

### Sync
- **Cloudflare** (`sync-cloudflare.js` + `sync-core.js` + `sync-crypto.js` + `sync-transfer.js`, Server: `server/worker.js`): Push nach jedem Dispatch (entprellt), Pull per WebSocket-Hinweis. Ende-zu-Ende-verschlüsselt. Protokoll v4, Details im Skill.
- **Konflikte**: Seiteninhalte per 3-Wege-Merge (`DB.merge3`), Heft-Striche konfliktfrei als Einzel-Ops. Nicht lösbare Konflikte zeigt `render.js:854–1141` an.
- **Google Drive** (`drive.js`): unabhängiges, verschlüsseltes Backup aus Snapshot + Delta-Dateien + Blobs.

---

## 4. Modul-Landkarte

Jedes Modul exportiert ein großes Objekt (`export const HEFT = (() => { … return {…} })()`).

### Shell & Oberfläche
| Datei | Zeilen | Aufgabe |
|---|---:|---|
| `main.js` | 94 | lädt alles, `window`-Brücke |
| `boot.js` | 329 | Startablauf |
| `app.js` | 2400 | Event-Verkabelung (`wireEvents` = **eine Funktion mit ~1860 Zeilen**), Dialoge, Teilen-Empfang, Karten-Bewertung |
| `render.js` | 2021 | Sidebar, Tabs, Home, Chat-Ansicht, Konflikt-Dialog, Modals |
| `render-anki.js` | 677 | Karteikarten-Oberfläche |
| `tabs.js` | 242 | Tabs, Vor/Zurück |
| `popovers.js`, `collapse.js`, `shortcuts.js`, `search.js` | klein | Popover, Baum-Klappzustand, Tastenkürzel, Strg+K |
| `mobile.js`, `mobile-view.js` | 355 / 143 | Smartphone-Navigation |
| `library.js` | 839 | Bibliothek (Kacheln/Tabelle) |
| `controller.js` | 304 | Gamepad-Steuerung |

### Editor (Tastatur)
| Datei | Zeilen | Aufgabe |
|---|---:|---|
| `editor.js` | 2557 | Block-Editor (contenteditable): Blöcke, Caret, Undo, Slash-Menü, Tastatur, Drag & Drop |
| `editor-markdown.js` | 323 | Markdown ↔ Blöcke |

### Heft (Stift)
| Datei | Zeilen | Aufgabe |
|---|---:|---|
| `heft.js` | 3575 | Alles rund ums Heft: Rendern, Zoom/Kacheln, Stifteingabe, Lasso, Undo, Menüs, Import, **Scanner-Oberfläche** |
| `heft-document-core.js`, `heft-pages-core.js`, `heft-geometry.js`, `heft-tools.js` | klein | reine Logik (Diff, Seiten, Geometrie, Werkzeug-Einstellungen) |
| `heft-export.js` | 179 | PDF/PNG-Export |
| `heft-scan.js` | 603 | Scanner-Bildverarbeitung (Randerkennung, Entzerrung) |
| `heft-indexer.js` | 108 | Hintergrund-Handschrifterkennung für die Suche |
| `handschrift.js` + `handwriting-*.js` | ~1200 | Handschrift → Text (ONNX-Modell im Worker) |
| `pdfs.js`, `pdfpaste.js` | 424 / 63 | PDF-Import, -Anzeige, -Text |

### KI & Lernen
| Datei | Zeilen | Aufgabe |
|---|---:|---|
| `ai.js` | 1449 | Anbieter-Anfragen, Streaming, Agent-Schleife, Prompts, **lokale Embeddings** |
| `tools.js` | 1006 | Werkzeuge, die die KI benutzen darf |
| `chats.js`, `chat-fullscreen.js` | 210 / 517 | Chat-Daten und Chat-Oberfläche |
| `rag.js`, `rag-ranking.js`, `rag-worker.js`, `embedding*.js` | ~840 | Semantische Suche |
| `srs.js` | 224 | Wiederholungs-Algorithmus (FSRS) |
| `extras.js` | 711 | Lückentext, CSV/Anki-Import/Export, Seiten-PDF, Multi-Tab |
| `lernzeit.js`, `telemetrie.js`, `analyse.js`, `fach.js` | ~2150 | Lernzeit, Statistik, Fächer-Erkennung |
| `schulnoten.js`, `notebooklm.js`, `voice.js` | | Noten, NotebookLM-Panel, Sprache |
| `experimente.js` | 652 | experimentelle Lernmodi (standardmäßig aus) |
| `graph.js` + `graph-worker.js` | 662 | Wissensgraph – **von keiner Stelle der Oberfläche aufrufbar** |

### Einstellungen
| Datei | Zeilen | Aufgabe |
|---|---:|---|
| `settings.js` | 1548 | Logik + Aktionen aller Einstellungen (Theme, Sync-Kopplung, Drive, KI-Anbieter, Backup, Home-Layout) |
| `settings-schema.js`, `settings-renderer.js`, `settings-ui.js`, `settings-action-state.js` | ~680 | Abschnitte, HTML, Bausteine, Button-Zustände |

### Plattform & Infrastruktur
`util.js` (Helfer `U`), `event-bus.js`, `cooperative.js`, `platform-native.js` (Android/Capacitor), `performance-profiler*.js`, `optional-modules.js` (CDN-Nachladen), `mcp-bridge.js` (Live-Bridge), `service-worker.js`, `updater.js`, `types.js` (nur JSDoc-Typen).

---

## 5. Baustellen (Befund 2026-10-07)

Ich habe die Punkte per Skript oder direkt im Code geprüft. Zeilenangaben dienen als Orientierung.

### B1 – Abhängigkeits-Knäuel (Hauptursache für „keine Übersicht“)
18 Module hängen in **einem einzigen Abhängigkeitskreis**: `ai app chat-fullscreen drive editor extras heft library notebooklm pdfs render render-anki search settings settings-renderer shortcuts tabs tools`.
Jedes davon erreicht über Umwege jedes andere. Direkte Gegenseitig-Importe: `app↔settings`, `app↔library`, `app↔search`, `app↔shortcuts`, `render↔library`, `render↔render-anki`, `render↔settings`.
Die Zyklen werden mit „Lazy-Aliasen“ (`const render = (...a) => RENDER.render(...a)`) und der `window`-Brücke verdeckt. Folge: Die Ladereihenfolge ist zerbrechlich, und man kann kein Modul isoliert verstehen oder testen.
**Wurzel:** Viele Module rufen direkt `RENDER.render()` oder `SETTINGS.x()` auf, statt nur `S` zu ändern bzw. ein Ereignis zu senden.

### B2 – `window`-Brücke
`main.js` hängt ~35 Module und Einzelfunktionen an `window`. Genutzt wird sie noch von `heft.js`, `ai.js`, `controller.js`, `schulnoten.js`, `render-anki.js`, `settings-renderer.js` (z. B. `window.EXP`, `window.ANALYSE`, `window.S`) sowie vom MCP-`impala_eval`.

### B3 – Riesen-Funktionen und Mischverantwortung
- `app.js:518–2380` `wireEvents`: ein Klick-Handler für die ganze App plus Drag & Drop, Inline-Umbenennen, Sidebar-Breite.
- `render.js` enthält Logik: Konflikt-Speicher und -Auflösung (854–1141), localStorage-Zugriffe (222–245).
- `heft.js`: Scanner-UI (2459–3089, ~630 Z.) ist ein eigenständiger Teil.
- `ai.js:361–531`: Embedding-Worker-Verwaltung, obwohl `embedding.js` dafür existiert.
- Einstellungen: `settings.js` und `settings-renderer.js` erzeugen beide HTML für dieselben Bereiche (Modell-Liste, Embedding-Karte).

### B4 – Doppelte Logik
| Was | Wo |
|---|---|
| `mapLimit` | `drive.js:320`, `sync-cloudflare.js:86` |
| `sha256Hex` | `sync-core.js:24`, `sync-crypto.js:35` |
| gzip | `drive.js:420`, `sync-crypto.js:69` |
| Heft-Ops erzeugen | `sync-core.js:106` (`heftBaselineOps`) vs. `heft-document-core.js` (`diffDocument`); `heftDiffOps` (sync-core.js:119) ungenutzt |
| neue Heft-Seite | `heft.js:159` vs. `state.js:364` |
| Handschrift-OCR | `heft.js:110–155` und `heft-indexer.js:37–86` |
| Vektor-Norm/Cosine | `rag-ranking.js`, `rag.js:252`, `fach.js:374`, `graph.js:300`, `graph-worker.js:10` |
| `esc`/`$`/`blurActive`/Overlay-Wrapper | in 5+ Dateien |
| `"local:bekko-a8m"` als Text | 8× statt Konstante |

### B5 – Toter bzw. unerreichbarer Code
- `graph.js` + `graph-worker.js` (~660 Z.): nur importiert, nirgends geöffnet.
- ~35 öffentliche Funktionen ohne jeden Aufrufer (z. B. `AI.debugProbe`, `HEFT.pageCanvas`, `FACH.classifyWithEmbedding`, `LERNZEIT.setActiveStretchMs`, `CLOUDFLARE_SYNC.catchUp`, `SETTINGS.testAllProviders`, `sync-core.heftDiffOps`).
- Viele Module bieten mehr nach außen an, als genutzt wird (nur intern gebrauchte Funktionen im Rückgabe-Objekt).

### B6 – Altlasten mit Kompatibilitätspflicht (nicht einfach löschen!)
Migrationen alter Datenformate: `db.js:59–75` (alte DB „notion“), `state-checkpoint.js` Format 1, `state.js:332–349` (alte Secrets), `heft.js:233–300` (Heft aus localStorage), `drive.js:17/50/527` (v1-Snapshots), `sync-cloudflare.js:648` (`migrateLocalV4`). Entfernen nur mit festgelegter Mindestversion, ab der alte Daten nicht mehr vorkommen.

---

## 6. Umbauplan

Reihenfolge nach **Nutzen pro Risiko**. Jeder Schritt einzeln committen, vorher und nachher `npm test` und eine Live-Prüfung über die MCP-Bridge.

1. **Aufräumen ohne Verhaltensänderung** (risikoarm)
   - Tote Funktionen und `heftDiffOps` entfernen; über `graph.js` entscheiden (anbinden oder löschen).
   - Doppelte Helfer zusammenführen (B4): Krypto/gzip/mapLimit → `sync-core`/`sync-crypto`; Vektor-Mathe → `rag-ranking.js`; Embedding-Konstante.
2. **Monolithen schneiden** (mittel, rein mechanisch)
   - `heft.js` → `heft-scanner-ui.js` (Scanner), danach `heft-viewport.js` (Zoom/Kacheln) und `heft-input.js` (Stift/Lasso).
   - `render.js` → `conflict-ui.js`.
   - `app.js:wireEvents` → nach Bereichen getrennte Verkabelung (`wire-sidebar.js`, `wire-dnd.js` …) mit gemeinsamem Klick-Verteiler.
3. **Knäuel lösen** (B1/B2, größter Hebel, braucht Sorgfalt)
   - Regel einführen: Fachmodule ändern nur `S`/dispatchen. Neu zeichnen löst **ein** zentraler Mechanismus aus (`STATE.onChange` → `render`), nicht jedes Modul selbst.
   - Querschnitts-Aufrufe (`SETTINGS.openSettings`, `APP.x`) über den vorhandenen `event-bus.js` statt Direktimport.
   - Danach `window`-Brücke Stück für Stück abbauen (MCP-Bridge bekommt eigenen Zugriff).
4. **Doppelte Zuständigkeiten** (B3): Embedding-Verwaltung aus `ai.js` nach `embedding.js`, Einstellungs-HTML nur noch im Renderer, eine OCR-Pipeline.
