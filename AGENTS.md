# Impala67 – Arbeitsregeln

## 1. Produkt: drei Versionen, ein Kern

Impala67 ist Local-First und wird in **drei Versionen** gepflegt, die sich einen Rust-Kern (`core/`) und dieselben Daten (Sync) teilen:

| Version | Code | Technik | Hauptzweck | Eigene Regeln / Stand |
|---|---|---|---|---|
| **PWA** | `web/` | native ES-Module, Standard-CSS, kein Bundler; Kern als WASM (`web/core/` über `web/rust-core.js`) | Laptop/PC (Markdown-Editor), Fallback auf allen Geräten | dieses Dokument |
| **Android-App** | `android/` | Kotlin/Compose, Material 3 Expressive; Kern über UniFFI (`core/impala-ffi`) | Smartphone: schnelles Lesen, Kurznotizen; Tablet | `android/PORTING.md`, `android/UI-INVENTAR.md` |
| **iPad-App** | `ios/` | SwiftUI/PencilKit (iPadOS 27); Kern über UniFFI (`core/impala-ffi`) | Handschrift und Zeichnen mit dem Stift (Heft) | `ios/README.md`, `ios/PARITAET.md` |

- **Die PWA ist die Vorlage**: Aussehen, Verhalten und Texte der nativen Apps richten sich nach der PWA (mit Plattform-Feinschliff). Die nativen Apps nutzen `web/` nicht und übernehmen nichts aus der alten Capacitor-App.
- **Logik gehört in den Kern**: Was keine Oberfläche ist, steht in Rust (`core/`, Plan: `docs/NATIV-PLAN.md`, Regeln: `core/AGENT-REGELN.md`) und gilt damit automatisch für alle drei. Umgestellte Teile laufen nur noch in Rust (kein JS-Rückfall). Fehlt einer App eine Funktion, die FFI-Hülle erweitern – nicht in Kotlin/Swift nachbauen.
- **Kostenlos**: Ohne laufende Serverkosten betreibbar (Cloudflare Free Tier, GitHub Pages).
- **Plattformübergreifende Entwicklung**: Entwickler-Tools, npm-Skripte und Tests müssen unter Windows, Linux und macOS funktionieren (`node`-Skripte statt `.bat`/`.sh`).

### Welche Version betrifft eine Änderung?

Vor jeder Änderung klären, wo sie landen muss:

- **Kern (`core/`)** → wirkt in allen drei. Danach bauen und mitcommitten:
  - PWA: `npm run build:core`, `web/core/` + `core/wasm-build.json` committen (FFI-Änderungen ändern den WASM-Stempel nicht).
  - Android: `npm run build:android-core` (bei Änderungen in `core/impala-ffi`).
  - iPad: `npm run build:ios-core`, erzeugte Swift-Bindings (`ios/Impala67/Core/Generated/`, `ios/Bindings/`) committen.
- **Nur Oberfläche einer Version** → nur dort ändern. Ist es ein Verhalten, das die PWA vorgibt, den Abgleich festhalten: iPad in `ios/PARITAET.md`, Android in `android/UI-INVENTAR.md`. Neue PWA-Funktionen dort als offene Lücke eintragen, statt sie ungefragt in allen Apps nachzubauen.
- **Gespeicherte oder synchronisierte Formate** → müssen zwischen allen Versionen austauschbar bleiben (eine ältere App darf neuere Daten nicht zerstören).
- **Icons** kommen für alle aus `web/icons.svg` (`npm run android:icons`, `npm run ios:icons`).

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
- **Daten & Sync**: `web/db.js`, `web/state.js` (Ein-/Ausgabe und Abfragen für das Rust-Datenmodell `ModelCore`), `web/state-views.js` (nur lesbare Ansichten in `S`), `web/sync-cloudflare.js` (Ein-/Ausgabe für den Rust-Sync), `web/drive.js` (Anmeldung, Timer und Ein-/Ausgabe für das Rust-Drive-Backup), `server/`
- **Rust-Kern**: `core/` (ein Crate je Fachgebiet; Datenmodell: `core/impala-model`, Sync: `core/impala-sync`, E2EE: `core/impala-crypto`, Drive-Backup: `core/impala-drive`, Fächer: `core/impala-fach`), WASM-Hülle `core/impala-wasm`, Ausgabe `web/core/`; UniFFI-Hülle für native Apps `core/impala-ffi` (ändert den WASM-Stempel nicht)
- **KI & Suche (RAG)**: `web/ai.js`, `web/embedding.js`, `web/embedding-worker.js`, `web/rag.js`
- **Native Apps**: `android/` (Kotlin/Compose, Regeln: `android/PORTING.md`), `ios/` (SwiftUI/PencilKit, Stand: `ios/README.md`, Parität: `ios/PARITAET.md`), gemeinsame Brücke `core/impala-ffi`
- **Offline & Cache**: `web/service-worker.js`, `web/updater.js`, `web/version.json`
- **Doku**: `docs/ARCHITEKTUR.md`, `docs/NATIV-PLAN.md`, `docs/IPAD-TESTAUFTRAG.md` und Testberichte `docs/IPAD-TESTBERICHT-*.md`
- **Veröffentlichung**: `.github/workflows/release.yml` (manuelles Release mit Android-APK), `deploy-pwa.yml` (PWA bei jedem Push), `android-check.yml` (Debug-Bau), `ios-build.yml` (unsignierte IPA); Versionen aus `.github/scripts/version-from-tags.mjs`, gesetzt über `.github/scripts/set-version.mjs`
- **Backlog**: `TODO.md`

## 4. Code-Qualität und Sicherheit

- **Ursachen lösen, nicht Symptome**: Keine doppelten Regeln oder Sonderfälle nebeneinander. Einfachste Lösung zuerst (KISS), nichts auf Vorrat bauen (YAGNI).
- **Dateigrößen**: Neue, in sich geschlossene Logik in kleine, testbare Module auslagern. Große Dateien, die nicht endlos wachsen sollen: `web/heft.js`, `web/editor.js`, `web/app.js`, `web/render.js`, `web/state.js`, `web/settings.js`, `web/ai.js`.
- **Sicherheit & Geheimnisse**: Keine API-Schlüssel, Tokens oder `web/config.local.js` committen. KI-Schlüssel bleiben nur lokal im Browser.
- **Rückwärtskompatibilität**: Lokale IndexedDB-Daten dürfen durch Updates nie verloren gehen oder ungefragt inkompatibel werden.
- **Native Apps**: Ein Paket/Ordner je Fachgebiet, Dateien möglichst < 300 Zeilen; Daten nur über `ImpalaStore` (Kotlin bzw. Swift) lesen und schreiben. Erzeugte Bindings nie von Hand ändern.
- **Zustand nur über Events** (PWA): Gespeicherte Daten (`S.pages`, `S.cards`, … und Hefte) liegen im Rust-Kern und ändern sich nur über `STATE.dispatch`. Die Ansichten in `S` sind schreibgeschützt; Hefte nur über `STATE.heftDoc`/`heftPage` lesen, nie alle auf einmal.
- **Offline-Cache**: Jeder Push auf `main` bekommt automatisch eine eigene Cache-Version (Zwischenstand `x.y.z-dev.N`, Release `x.y.z`, siehe `.github/workflows/deploy-pwa.yml`). Neue App-Dateien müssen nur in `APP_FILES` im Service Worker stehen.

## 5. Arbeitsweise

- **Antwort = Abschluss-Box**: Am Ende einer Aufgabe nur die Zusammenfassungs-Box der App (Claude Code: `wrap_up`) als Antwort nutzen, kein zusätzlicher Fließtext. Gibt es keine Box, höchstens wenige Sätze. Ausführlich nur, wenn der Nutzer ausdrücklich eine Erklärung will.
- **Kommunikation**: Kurz und verständlich antworten. Änderungen so beschreiben, wie sie sich für Bedienung, Verhalten oder Nutzen der App auswirken. Keine langen Code-Blöcke im Chat wiederholen.
- **Kontext sparen**: Dateien über 300 Zeilen nicht komplett laden, sondern mit `grep` und Zeilenausschnitten arbeiten. Details zu Agenten-Delegation stehen in `CLAUDE.md`.
- **Testen je Version**:
  - **PWA**: betroffene Einzeltests (`node --test test/<name>.test.mjs`), Live-Prüfung über die MCP-Bridge; `npm run verify` nur bei Bedarf.
  - **Kern**: `cd core && cargo test -p <crate>` und `cargo clippy -p <crate> --all-targets -- -D warnings`.
  - **Android**: `cd android && ./gradlew assembleDebug` muss bauen (Emulator/Details: `android/PORTING.md` §6).
  - **iPad**: baut nur auf macOS – unter Windows/Linux die Bindings erzeugen, die App baut `ios-build.yml`. Auf dem Gerät über die MCP-Bridge (WLAN) prüfen, Ablauf: `docs/IPAD-TESTAUFTRAG.md`.
- **Keine ungefragten Tests**: Neue Testdateien (`test/*.test.mjs`) nur auf ausdrücklichen Wunsch anlegen. Sonst über bestehende Tests, gezielte Checks oder die MCP-Live-Bridge verifizieren.

## 6. Veröffentlichung

- **PWA**: Ein Push auf `main` geht sofort live (GitHub Pages über `deploy-pwa.yml`). Vorher prüfen, ob die Änderung fertig ist.
- **Android**: `android-check.yml` baut auf Nebenzweigen bei Änderungen in `android/` oder `core/` eine Debug-APK; das offizielle Release mit signierter APK nur manuell über `release.yml`.
- **iPad**: `ios-build.yml` baut bei Änderungen in `ios/` oder `core/impala-ffi/` eine unsignierte IPA (Artefakt `Impala67-ipa`), Installation per Sideloading.
- **Versionen automatisch**: Quelle sind die Release-Tags (`version-from-tags.mjs`), gesetzt und geprüft über `.github/scripts/set-version.mjs`. `package.json` und `web/version.json` werden im Repo nicht von Hand hochgezählt.

## 7. KI- & Entwickler-Integration (MCP Live-Bridge)

- **Verbindung**: Der MCP-Server in `mcp/` verbindet KI-Assistenten über einen lokalen WebSocket (`ws://127.0.0.1:8765`) mit der im Browser laufenden App (`http://localhost:8000`). Die Gegenseite in der App ist `web/mcp-bridge.js`. Die native iPad-App nutzt dieselbe Bridge über WLAN (`ws://<IP>:8766`, Einrichtung: `mcp/lan-setup.mjs`).
- **Tools** (Stand: Code in `mcp/` und `web/mcp-bridge.js`):
  - **Inhalte**: `impala_list_pages`, `impala_get_page`, `impala_create_page`, `impala_update_page`, `impala_search`, `impala_list_flashcards`, `impala_create_flashcard`
  - **Diagnose & Performance**: `impala_get_diagnostics`, `impala_get_performance_trace`, `impala_get_ai_trace`
  - **Live-Testing & UI**: `impala_eval`, `impala_run_ui_action`; nur iPad-App: `impala_screenshot`, `impala_ui_tree`, `impala_tap`, `impala_type`
  - **Handschrift-Training**: `impala_heft_page_image` (Seite als Bild + Modell-Lesung), `impala_heft_label_lines` (KI legt Zeilen und Text fest → Trainingsbeispiele)
  - **Speicher**: `impala_storage_report`, `impala_storage_cleanup`
- **Entwickler-Workflow**: Der Agent prüft Features und Fehler direkt im echten Browser-Tab und liest Messwerte aus. Der Nutzer muss dafür keine manuellen Testschritte machen.
