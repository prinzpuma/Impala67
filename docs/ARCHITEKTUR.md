# Impala67 – Architektur

Stand: 15.11.2026 · ca. 40.000 Zeilen in `web/*.js`, 138 Module (ohne Zyklen im Import-Graphen).
Diese Datei beschreibt, **wie die PWA gebaut ist**. Kern und native Apps: `docs/NATIV-PLAN.md`. Regeln stehen in `AGENTS.md`, Sync-Details im Skill `cloudflare-sync-v4`.

---

## 1. Das Grundprinzip in drei Sätzen

1. Jede Änderung ist ein **Event** (`STATE.dispatch(type, payload)`), das zuerst in IndexedDB landet und dann im Rust-Kern (`ModelCore`) angewendet wird; `S` zeigt den Stand nur lesend. (Event-Sourcing)
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
              DB.addEvent()        ModelCore (WASM)   onAfterDispatch
              (IndexedDB)          wendet an           │
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
2. `main.js`: importiert **alle** Module und legt die Modul-Objekte für die MCP-Auswertung (`impala_eval`) und die Konsole auf `window`. Fachmodule importieren direkt.
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
| Datei | Aufgabe |
|---|---|
| `main.js` | lädt alles, Modul-Objekte für `impala_eval`/Konsole auf `window` |
| `boot.js` | Startablauf |
| `app.js` | Event-Verkabelung (`wireEvents`), Dialoge, Teilen-Empfang, Karten-Bewertung |
| `app-click-chat.js`, `app-click-anki.js`, `app-click-pages.js`, `app-click-buttons.js` | zentrale Klick-Handler je Bereich |
| `app-sidebar-events.js`, `app-dialogs.js`, `app-ui.js`, `platform.js` | Sidebar-Drag/Umbenennen, Dialoge/Seiten-Flows, UI-Helfer, Handy-Erkennung |
| `render.js` | Sidebar, Tabs, Home, Chat-Ansicht, Modals |
| `conflict-ui.js` | Konflikt-Dialog (aus `render.js`) |
| `render-anki.js` | Karteikarten-Oberfläche |
| `tabs.js` | Tabs, Vor/Zurück |
| `popovers.js`, `collapse.js`, `shortcuts.js`, `search.js` | Popover, Baum-Klappzustand, Tastenkürzel, Strg+K |
| `mobile.js`, `mobile-view.js` | Smartphone-Navigation |
| `library.js` | Bibliothek (Kacheln/Tabelle) |
| `controller.js` | Gamepad-Steuerung |

### Editor (Tastatur)
| Datei | Aufgabe |
|---|---|
| `editor.js` | Block-Editor (contenteditable): Blöcke, Caret, Undo, Slash-Menü, Tastatur, Drag & Drop |
| `editor-keys.js` | Text-, Tabellen- und Code-Tasten |
| `editor-inline.js` | Inline-Markdown, KaTeX-Hydrierung, Caret-Berechnung |
| `editor-markdown.js` | Markdown ↔ Blöcke (Hülle um den Rust-Kern) |

### Heft (Stift)
| Datei | Aufgabe |
|---|---|
| `heft.js` | Heft-Oberfläche: Rendern, Zoom/Kacheln, Lasso, Undo, Menüs |
| `heft-input.js` | Stift-Eingabe, Radierer, Lasso-Griffe, Formerkennung |
| `heft-import.js`, `heft-storage.js` | Datei-/Bild-/PDF-Import, Blob-Referenzen, Altbestand-Migration, Verlauf |
| `heft-scanner-ui.js` | Scanner-Oberfläche (Kamera, Live-Prüfung, Nachbearbeitung, Android-Google-Scanner) |
| `heft-document-core.js`, `heft-pages-core.js`, `heft-geometry.js`, `heft-tools.js` | reine Logik (Diff, Seiten, Geometrie, Werkzeug-Einstellungen) |
| `heft-export.js` | PDF/PNG-Export |
| `heft-scan.js` | Scanner-Bildverarbeitung (Randerkennung, Entzerrung) |
| `heft-indexer.js` | Hintergrund-Handschrifterkennung für die Suche |
| `handschrift.js` | Handschrift → Text (ONNX-Modell im Worker) |
| `pdfs.js`, `pdfpaste.js` | PDF-Import, -Anzeige, -Text |

### KI & Lernen
| Datei | Aufgabe |
|---|---|
| `ai.js` | Anbieter-Anfragen, Streaming, Agent-Schleife (Logik im Rust-Kern), **lokale Embeddings** |
| `tools.js` | Werkzeuge, die die KI benutzen darf |
| `chats.js`, `chat-fullscreen.js` | Chat-Daten und Chat-Oberfläche |
| `rag.js`, `rag-ranking.js`, `rag-worker.js`, `embedding.js`, `embedding-worker.js` | Semantische Suche |
| `srs.js` | Hülle um FSRS im Rust-Kern |
| `extras.js` | Lückentext, CSV/Anki-Import/Export, Seiten-PDF, Multi-Tab |
| `lernzeit.js`, `telemetrie.js`, `lernmuster.js`, `fach.js` | Lernzeit, Statistik, Fächer-Erkennung |
| `schulnoten.js`, `voice.js` | Noten, Sprache |
| `experimente.js` | experimentelle Lernmodi (standardmäßig aus) |
| `graph.js` + `graph-worker.js` | Wissensgraph (Knopf unten links; verdrahtet sich beim Import selbst an `#btnGraph`) |

### Einstellungen
| Datei | Aufgabe |
|---|---|
| `settings.js` | Logik + Aktionen aller Einstellungen (Theme, Sync-Kopplung, Drive, KI-Anbieter, Backup, Home-Layout) |
| `settings-schema.js`, `settings-renderer.js`, `settings-ui.js`, `settings-action-state.js` | Abschnitte, HTML, Bausteine, Button-Zustände |

### Plattform & Infrastruktur
`util.js` (Helfer `U`, inkl. `U.morph`, `U.closeOverlay` als einziger Schließweg für `#overlay`), `html-escape.js` (einziges HTML-Escape), `event-bus.js` (Entkopplung statt Import-Zyklen), `cooperative.js`, `platform.js`, `performance-profiler*.js`, `optional-modules.js` (CDN-Nachladen), `mcp-bridge.js` (Live-Bridge), `service-worker.js`, `updater.js`, `types.js` (nur JSDoc-Typen).

---

## 5. Altlasten mit Kompatibilitätspflicht (nicht einfach löschen!)

Migrationen alter Datenformate: `db.js` (alte DB „notion“), Checkpoint-Formate 1–2 (`impala-storage` checkpoint.rs),
alte Secrets (`impala-model` migrate.rs), `heft.js` (Heft aus localStorage), `core/impala-drive/src/format.rs`
(v1-Snapshots, Drive-Zustand aus `localStorage`), `sync-cloudflare.js` (`migrateLocalV4`). Entfernen nur mit
festgelegter Mindestversion, ab der alte Daten nicht mehr vorkommen.

Bewusst hingenommene Doppelungen und optionale Schnitte großer Dateien stehen in `TODO.md`.
