# Impala67 – Architektur

Stand: 2026-11-07 · ca. 39.800 Zeilen in `web/*.js`, 135 Module (ohne Zyklen im Import-Graphen).
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
2. `main.js`: importiert **alle** Module und legt die Modul-Objekte für die MCP-Auswertung (`impala_eval`) und die Konsole auf `window`. Fachmodule importieren direkt; Einzelfunktions-Aliase gibt es nicht mehr (siehe B2).
3. `boot.js:initApp`: `DB.open` → `STATE.load` (JS liest Checkpoint + Rest-Events aus IndexedDB, der Rust-Kern spielt ab) → Migrationen → `TABS.restoreSession` → `APP.wireEvents` → erstes `render()`.
4. Danach im Hintergrund: Cloudflare-Sync, Drive-Auto-Sync, MCP-Bridge, Update-Watcher, Heft-OCR-Indexer, Prefetch optionaler Module.

---

## 3. Daten

### `S` und `STATE` (`state.js`, Datenmodell im Rust-Kern)
- Der gespeicherte Zustand liegt **im Rust-Kern** (`core/impala-model`, in der PWA `ModelCore` aus `core/impala-wasm/src/model.rs`): Reducer, Laden aus Checkpoint und Log, Event-Reihenfolge, Checkpoints, Merge/Konflikte, Abfragen, Lernwarteschlange. Es gibt keine JS-Fassung mehr.
- **`S`** = flüchtiger UI-Zustand (`view`, `tabs`, `navHistory`, `aiBusy` …) plus **nur lesbare Ansichten** auf den Kern (`state-views.js`): `pages`, `cards`, `decks`, `settings`, `reviews` … Geholt wird beim Lesen und nur, was sich laut Kern geändert hat. `pg.content` kommt erst beim Zugriff aus dem Kern. Zuweisungen werfen.
- **Hefte und Heft-Bilder** gibt es nur über Abfragen: `STATE.heftDoc(id)`, `heftPage(id, i)`, `heftPageById`, `heftMeta(id)`, `heftBlob(hash)`, `heftIndexSummary()`. Der Heft-Editor arbeitet auf einer eigenen Arbeitskopie (`heft.js`), schickt Unterschiede als `heftOps` und übernimmt Fremdänderungen über `STATE.heftPreview` (Kern legt Ungespeichertes auf seinen neuen Stand).
- **`STATE`** = `dispatch` (speichert in IndexedDB, dann wendet der Kern an), `applyRemoteEvents`, `load`, Checkpoints, Abfragen (`activePages`, `dueCards`, `searchNotes`, `backlinksOf` …) – alles Aufrufe an den Kern.
- Regel: Der gespeicherte Zustand ändert sich nur über Events (`STATE.dispatch`). Flüchtiger UI-Zustand (auch `S.tabs` als Arbeitsstand der Tab-Leiste, gespeichert per `uiTabsSet`) bleibt in JS.

### IndexedDB (`db.js`)
| Store | Inhalt |
|---|---|
| `events` | das Event-Log (Quelle der Wahrheit) |
| `blobs` | Bilder, PDFs, Heft-Versionen (`heftver:*`), Checkpoints |
| `vecs` | Embeddings für die KI-Suche |

**Checkpoints** (im Kern: `impala-storage` checkpoint.rs, Zeitplan `checkpoint-scheduler.js`): Schnappschuss des Zustands mit Event-Nummer. Beim Start wird nur der Rest des Logs nachgespielt → schneller Start. Hefte liegen als eigene, inhaltsadressierte Teile; der Kern liest sie erst beim ersten Zugriff und schreibt unveränderte nicht neu.
- **Regel:** Ein Checkpoint entspricht immer dem nach Zeit sortierten Replay seiner Events. Wendet die Laufzeit ein verspätetes Fremd-Event an, das mit neueren Events kollidiert, wird kein Checkpoint davon gespeichert (der nächste Start sortiert es richtig ein).
- **Verspätete Fremd-Events** (`impala-model` order.rs): Der Checkpoint merkt sich je Sache (Seite, Heft, Karte, Chat …) den spätesten Event-Zeitpunkt (`orderTimes`). Ein älteres Event im Rest wird einfach angehängt, wenn es nichts Neueres berührt; nur echte Überschneidungen erzwingen den Voll-Replay. Neue Event-Typen ohne Eintrag in `order_keys` gelten als „wirkt auf vieles“ – das ist sicher, kostet aber Startzeit.

### Heft-Daten
- `STATE.heftDoc(pageId) = { v:2, rev, pages:[{ id, paper, strokes, images, texts, ocrText }] }` (Kopie aus dem Kern)
- Stroke: `{ id, tool, color, size, pts:[[x,y,p]], shape?, bbox? }`
- Bilder liegen inhaltsadressiert im Kern (`STATE.heftBlob(hash)`, bei Bedarf aus dem Checkpoint nachgeladen), das Heft verweist per `ref`.
- Änderungen laufen als **`heftOps`**-Events (`pg+`, `s+`, `i+`, `x+`, `ocr` …), erzeugt per Diff (`heft-document-core.js`).
- `s=`/`i=`/`x=` ersetzen den **Inhalt** des vorhandenen Objekts, nicht das Objekt: Undo-Einträge, laufende Gesten und der Text-Editor halten Verweise darauf. Ansichtszustand (z. B. „wird gerade bearbeitet“) gehört nie ins Dokument – er würde mitgespeichert und synchronisiert.
- Die Handschrift-Erkennung wird beim Speichern für jede Seite mit geänderten Strichen angestoßen (`persistDoc` → `heft:schedule-page`).

### Sync
- **Cloudflare** (Ablauf im Rust-Kern `core/impala-sync` + `core/impala-crypto`, als WASM aus `web/core/`; `sync-cloudflare.js` liefert nur fetch, IndexedDB, Timer, WebSocket und Status; Server: `server/worker.js`): Push nach jedem Dispatch (entprellt), Pull per WebSocket-Hinweis. Ende-zu-Ende-verschlüsselt. Protokoll v4, Details im Skill.
- **Konflikte**: Seiteninhalte per 3-Wege-Merge (`DB.merge3`), Heft-Striche konfliktfrei als Einzel-Ops. Nicht lösbare Konflikte zeigt `conflict-ui.js` an.
- **Google Drive** (Ablauf im Rust-Kern `core/impala-drive`, Anmeldung und Timer in `drive.js`): unabhängiges Backup (gzip, **nicht** verschlüsselt; liegt im privaten `appDataFolder`) aus Snapshot + Delta-Dateien + Blobs.

---

## 4. Modul-Landkarte

Jedes Modul exportiert ein großes Objekt (`export const HEFT = (() => { … return {…} })()`).

### Shell & Oberfläche
| Datei | Zeilen | Aufgabe |
|---|---:|---|
| `main.js` | 74 | lädt alles, Modul-Objekte für `impala_eval`/Konsole auf `window` |
| `boot.js` | 341 | Startablauf |
| `app.js` | 821 | Event-Verkabelung (`wireEvents`), Dialoge, Teilen-Empfang, Karten-Bewertung |
| `app-click-chat.js`, `app-click-anki.js`, `app-click-pages.js`, `app-click-buttons.js` | 200–335 | zentrale Klick-Handler je Bereich |
| `app-sidebar-events.js`, `app-dialogs.js`, `app-ui.js`, `platform.js` | klein | Sidebar-Drag/Umbenennen, Dialoge/Seiten-Flows, UI-Helfer, Handy-Erkennung |
| `render.js` | 1801 | Sidebar, Tabs, Home, Chat-Ansicht, Modals |
| `conflict-ui.js` | 183 | Konflikt-Dialog (aus `render.js`) |
| `render-anki.js` | 692 | Karteikarten-Oberfläche |
| `tabs.js` | 330 | Tabs, Vor/Zurück |
| `popovers.js`, `collapse.js`, `shortcuts.js`, `search.js` | klein | Popover, Baum-Klappzustand, Tastenkürzel, Strg+K |
| `mobile.js`, `mobile-view.js` | 492 / 71 | Smartphone-Navigation |
| `library.js` | 778 | Bibliothek (Kacheln/Tabelle) |
| `controller.js` | 308 | Gamepad-Steuerung |

### Editor (Tastatur)
| Datei | Zeilen | Aufgabe |
|---|---:|---|
| `editor.js` | 1955 | Block-Editor (contenteditable): Blöcke, Caret, Undo, Slash-Menü, Tastatur, Drag & Drop |
| `editor-keys.js` | 330 | Text-, Tabellen- und Code-Tasten |
| `editor-inline.js` | 264 | Inline-Markdown, KaTeX-Hydrierung, Caret-Berechnung |
| `editor-markdown.js` | 16 | Markdown ↔ Blöcke (Hülle um den Rust-Kern) |

### Heft (Stift)
| Datei | Zeilen | Aufgabe |
|---|---:|---|
| `heft.js` | 1823 | Heft-Oberfläche: Rendern, Zoom/Kacheln, Lasso, Undo, Menüs |
| `heft-input.js` | 511 | Stift-Eingabe, Radierer, Lasso-Griffe, Formerkennung |
| `heft-import.js`, `heft-storage.js` | 325 / 198 | Datei-/Bild-/PDF-Import, Blob-Referenzen, Altbestand-Migration, Verlauf |
| `heft-scanner-ui.js` | 849 | Scanner-Oberfläche (Kamera, Live-Prüfung, Nachbearbeitung, Android-Google-Scanner) |
| `heft-document-core.js`, `heft-pages-core.js`, `heft-geometry.js`, `heft-tools.js` | 37 / 17 / 103 / 39 | reine Logik (Diff, Seiten, Geometrie, Werkzeug-Einstellungen) |
| `heft-export.js` | 154 | PDF/PNG-Export |
| `heft-scan.js` | 202 | Scanner-Bildverarbeitung (Randerkennung, Entzerrung) |
| `heft-indexer.js` | 371 | Hintergrund-Handschrifterkennung für die Suche |
| `handschrift.js` | 217 | Handschrift → Text (ONNX-Modell im Worker) |
| `pdfs.js`, `pdfpaste.js` | 485 / 62 | PDF-Import, -Anzeige, -Text |

### KI & Lernen
| Datei | Zeilen | Aufgabe |
|---|---:|---|
| `ai.js` | 498 | Anbieter-Anfragen, Streaming, Agent-Schleife (Logik im Rust-Kern), **lokale Embeddings** |
| `tools.js` | 943 | Werkzeuge, die die KI benutzen darf |
| `chats.js`, `chat-fullscreen.js` | 211 / 517 | Chat-Daten und Chat-Oberfläche |
| `rag.js`, `rag-ranking.js`, `rag-worker.js`, `embedding.js`, `embedding-worker.js` | 292 / 52 / 56 / 162 / 387 | Semantische Suche |
| `srs.js` | 18 | Hülle um FSRS im Rust-Kern |
| `extras.js` | 696 | Lückentext, CSV/Anki-Import/Export, Seiten-PDF, Multi-Tab |
| `lernzeit.js`, `telemetrie.js`, `lernmuster.js`, `fach.js` | 446 / 420 / 208 / 723 | Lernzeit, Statistik, Fächer-Erkennung |
| `schulnoten.js`, `notebooklm.js`, `voice.js` | 172 / 609 / 183 | Noten, NotebookLM-Panel, Sprache |
| `experimente.js` | 656 | experimentelle Lernmodi (standardmäßig aus) |
| `graph.js` + `graph-worker.js` | 584 + 60 | Wissensgraph (Knopf unten links; verdrahtet sich beim Import selbst an `#btnGraph`) |

### Einstellungen
| Datei | Zeilen | Aufgabe |
|---|---:|---|
| `settings.js` | 1352 | Logik + Aktionen aller Einstellungen (Theme, Sync-Kopplung, Drive, KI-Anbieter, Backup, Home-Layout) |
| `settings-schema.js`, `settings-renderer.js`, `settings-ui.js`, `settings-action-state.js` | 98 / 673 / 68 / 33 | Abschnitte, HTML, Bausteine, Button-Zustände |

### Plattform & Infrastruktur
`util.js` (Helfer `U`, inkl. `U.morph`, `U.closeOverlay` als einziger Schließweg für `#overlay`), `html-escape.js` (einziges HTML-Escape), `event-bus.js` (Entkopplung statt Import-Zyklen), `cooperative.js`, `platform-native.js` (Android/Capacitor), `platform.js`, `performance-profiler*.js`, `optional-modules.js` (CDN-Nachladen), `mcp-bridge.js` (Live-Bridge), `service-worker.js`, `updater.js`, `types.js` (nur JSDoc-Typen).

---

## 5. Baustellen (Befund 2026-10-07, Stand 2026-11-07)

Ich habe die Punkte per Skript oder direkt im Code geprüft. Zeilenangaben dienen als Orientierung.

### B1 – Abhängigkeits-Knäuel ✅ erledigt
Alle zirkulären Modul-Importe sind aufgelöst (0 Zyklen in `web/*.js`). Querschnitts-Aufrufe laufen über `event-bus.js` (`BUS.on`/`emit`/`provide`/`call`) oder direkte Submodul-Importe (`web/app-dialogs.js`, `web/state.js`); die früheren Lazy-Aliase sind entfallen.

### B2 – `window`-Brücke ✅ überwiegend erledigt
`main.js` hängt keine Einzelfunktionen mehr an `window`. Die Modul-Objekte (z. B. `S`, `RENDER`, `APP`) bleiben bewusst als Auswertungsschnittstelle für `impala_eval` und die Konsole; Fachmodule importieren direkt.

### B3 – Riesen-Funktionen und Mischverantwortung ✅ erledigt
- `app.js` (821 Zeilen): `wireEvents` verteilt Klicks an `app-click-chat.js`, `app-click-anki.js`, `app-click-pages.js`, `app-click-buttons.js`; Sidebar-Ereignisse und Dialoge liegen in `app-sidebar-events.js` und `app-dialogs.js`.
- `editor.js` (1955 Zeilen): Tasten in `editor-keys.js`, Inline-Markdown/Caret in `editor-inline.js`.
- Embedding-Worker-Verwaltung liegt in `embedding.js`; Einstellungs-HTML nur im `settings-renderer.js`.

### B4 – Doppelte Logik ✅ bereinigt
Tote Exporte und doppelte Helfer (`mapLimit`, `sha256Hex`, `gzipBytes`, `norm`/`dot`, `LOCAL_EMBED_MODEL_ID`) sind zusammengeführt. Offene, bewusst hingenommene Doppelungen stehen in `TODO.md`.

### B5 – Toter Code ✅ bereinigt
Rund 30 ungenutzte Exporte sowie das alte Lernzeit-Widget und doppelte Bibliotheks-Handler sind entfernt. Vorsicht bleibt bei Modulen, die sich beim Import selbst an DOM-Knöpfe hängen.

### B6 – Altlasten mit Kompatibilitätspflicht (nicht einfach löschen!)
Migrationen alter Datenformate: `db.js:59–75` (alte DB „notion“), Checkpoint-Formate 1–2 (`impala-storage` checkpoint.rs), alte Secrets (`impala-model` migrate.rs), `heft.js:233–300` (Heft aus localStorage), `core/impala-drive/src/format.rs` (v1-Snapshots, Drive-Zustand aus `localStorage`), `sync-cloudflare.js:648` (`migrateLocalV4`). Entfernen nur mit festgelegter Mindestversion, ab der alte Daten nicht mehr vorkommen.

---

## 6. Umbauplan (Stand 2026-11-07)

Reihenfolge nach **Nutzen pro Risiko**. Jeder Schritt einzeln committen, vorher und nachher `npm test` und eine Live-Prüfung über die MCP-Bridge.

1. **Aufräumen ohne Verhaltensänderung** ✅ erledigt.
2. **Monolithen schneiden** ✅ weitgehend erledigt: `heft.js` → `heft-input.js`, `heft-scanner-ui.js`, `heft-import.js`, `heft-storage.js`; `render.js` → `conflict-ui.js`; `app.js` → `app-click-*.js`, `app-dialogs.js`, `app-sidebar-events.js`; `editor.js` → `editor-keys.js`, `editor-inline.js`.
3. **Knäuel lösen (B1/B2)** ✅ erledigt; offen bleibt nur die bewusste `window`-Auswertungsschnittstelle für `impala_eval`.
4. **Doppelte Zuständigkeiten (B3)** ✅ erledigt.
5. **Optional weiter schneiden** (nicht dringend): `editor.js` `handleSelectionKeys`/`wire` und `app.js` `wireEvents` teilen viel Auswahl-Zustand; nur mit klarer Getter/Setter-Schnittstelle trennen.
