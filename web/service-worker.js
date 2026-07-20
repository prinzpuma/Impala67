"use strict";
// Service-Worker: App-Dateien network-first (immer aktuell, offline aus dem Cache),
// CDN-Bibliotheken stale-while-revalidate (URLs sind versioniert, Inhalt ändert sich nie).
// Neue App-Version veröffentlichen = Dateien auf GitHub Pages pushen — fertig.
// config.local.js (gerätespezifisch, optional) wird grundsätzlich NICHT behandelt.

// v4: einmaliger Cache-Reset — räumt auf allen Geräten evtl. vergiftete v3-Caches auf
// (eine HTML-Fallback-Antwort war unter config.local.js gelandet und blockierte den
// Start bis zum Hard Reload). Alte Caches löscht der activate-Handler automatisch.
// v5: notebooklm.js in APP_FILES aufgenommen (fehlte — offline brach damit der
// gesamte ES-Module-Graph, weil render.js/tools.js/extras.js es importieren).
// v6: sql.js (.apkg-Import) in den CDN-Precache aufgenommen — der Anki-Import
// funktioniert damit auch offline.
// v13: version.json + latest.json im Precache (PWA-Update-Check same-origin)
// v14: ink.js (GoodNotes-Ebene) — später wieder entfernt
// v15: heft.js (GoodNotes-Hefte)
// v16: ink.js entfernt — nur noch heft.js für Handschrift
// v17: Heft-Taskbar v3 (Seiten-Popup, Bilder-Option, ＋-Menü, PDF-Scanner)
// v18: Dokument-Scanner v2 (Dokumenterkennung, Entzerrung, Filter, Nachbearbeitung)
// v19: Scanner-Bugfixes (Video-play, Busy-UI, Warp-Maße, null-sichere Exports)
// v20: Scanner live-Filter/Drehen + stärkere Papier-Aufhellung
// v21: Scanner v3 — robuste Dokumenterkennung + klar erkennbarer Scan-Look
// v22: Scanner-Audit — korrekte konvexe Quad-Prüfung für Dokumenterkennung
// v23: Scanner v4 — Live-Qualität, Rahmen, Auto-Auslösen, Vorher/Nachher
// v24: Scanner-Audit — Sitzungsisolierung, Bild-Cache, speicherärmerer Warp/Detect
// v25: Tesseract.js für lokale Heft-OCR
// v26: Scanner-Fix — randfestes bilineares Sampling und Validierung manueller Zuschnitte
// v27: Scanner-Ablauf — Autoaufnahme nur einmal je Blatt, Berechtigungs-Fallback, kein Fallback-Crop
// v28: Scanner-UX — Auto-Scan standardmäßig aus, sichtbare letzte Scan-Vorschau
// v29: Scanner-Workflow — Kachel-Vorschau erst bei Antippen, kein automatischer Zuschnitt
// v30: Scanner-Zuschnitt — robuste Papier-Ecken, Sicherheitsrand, ohne Auto-Zuschnitt-Menü
// v31: Heft-Zoom/Scanner-Update — eigener Cache-Schlüssel, damit installierte iPad-PWAs
//       die neuen Dateien unabhängig von einem alten Offline-Cache abrufen.
// v32: Mobile Shell v2 — Dock-Pille + Bottom-Sheet-Navigator (Bottom-Nav & Off-Canvas entfernt)
// v33: Scanner-Ecken bleiben im vollständigen Rohbild editierbar.
// v34: iPadOS-Update-Fix — App-Dateien umgehen zusätzlich den Safari-HTTP-Cache.
// v35: Mobile Shell v2.1 — Scrim nur bei offenem Navigator (#app::after + mnav-open-Guard),
//      Einstellungs-Dialog auf dem Handy gestapelt statt zweispaltig
// v36: schneller Drive-Sync — sync-core.js + Statusanzeige
// v37: Einheitlicher Updater — „Suchen" prüft nur noch, Installieren ist ein eigener Schritt
// v38: Heft-Fokus am Tablet — Vollbild-Animation wenn Sidebar ausgeblendet
// v39: PWA-Startschutz — transiente Overlay-Ebenen können keine Klicks blockieren
// v40: editor-v2.js — isolierter Rich-Text-Testeditor
// v41: voice.js — Browser-Sprachsteuerung ohne Audio-Backend
// v42: Chrome-Update-Fix — neuer Worker-Schlüssel erzwingt nach der Editor-
//       Änderung eine atomare, aktuelle App-Version statt alter Worker/Module.
// v43: Precache darf nicht an optionalen Dateien scheitern. Fehlende Favicon-
//       oder Release-Metadaten verhinderten mit cache.addAll() die Aktivierung
//       des gesamten Workers und ließen Chrome auf einem alten Cache stehen.
// v45: !important Flag für #app Padding und Gap im iPad-Querformat ergänzt,
//       damit die Ränder tatsächlich randlos überschrieben werden.
// v46: Problematischen body::after-Filler für Safe-Area entfernt, der einen
//       weißen Rand über die App gezeichnet hat.
// v47: iPad-Bugfix-Paket — ⋯-/Löschen-Menü (kein :active-transform auf .row,
//       Re-Positionierung nach Sidebar-Rebuild), Drag & Drop im Baum
//       (user-select:none bei pointer:coarse), Theme-Streifen (html ohne
//       eigenen Hintergrund, Canvas nimmt body-Hintergrund).
// v48: pdfpaste.js + Web Share Target: PDF aus dem Android/iPadOS-Teilen-Dialog
//       wird kurz im Cache abgelegt und danach an die App weitergereicht.
// v49: Lernzeit v2 — synchronisierte Lern-Sitzungen, Aktivitätskategorien,
//       editierbares Tagesprotokoll und Timer-Abschlusskarte.
// v50: think-heuristik.js — Sticky-Thinking-Heuristik aus ai.js ausgelagert
// v51: handschrift.js (Handschrift-Erkennung v2: Vision-KI + Tesseract-Fallback),
//       Prompt-Diät + Auto-RAG (ai.js, tools.js, rag.js), RAG-Suche v2
// v52: Heft-Text-Boxen — KI schreibt sichtbar in Hefte (heft.js, tools.js),
//      RAG v2.1 Modellwechsel-Fix (rag.js)
// v53: Datei-Split — Scanner-Bildverarbeitung (SCANCORE) aus heft.js nach
//      heft-scan.js ausgelagert; neue Datei im Precache
// v54: NotebookLM-Inbox + Bibliothek v2 — Downloads als Artefakte mit Art/Herkunft,
//      Einordnen-Dialog + #nlm:-Einbettungen (notebooklm.js); Bibliothek mit
//      Ansichts-Umschalter Notion/GoodNotes/NotebookLM (library.js, state.js)
// v55: GoodNotes-Bibliothek — Ordner immer erstellbar (kein Auto-Jump in den
//      einzigen Workspace) + Cover-Picker pro Heft (library.js)
// v56: GoodNotes-Bibliothek — einheitlicher „＋ Neu“-Ablauf für Heft/Ordner,
//      Heft-Cover bereits beim Anlegen, diskretes Kontextmenü je Heft
// v57: Eigenständiger GoodNotes-Dateibaum: Ordnerhierarchie und Reihenfolge
//      getrennt von Notion, Drag-and-drop von Heften und Unterordnern
// v58: GoodNotes-Dokumente v2 — Screenshot-orientierte Dokumentenansicht,
//      eigener Root, Breadcrumbs und echte Drag-and-drop-Ablage
// v59: GoodNotes-Finalisierung — keine Notion-Unterseiten-Aktionen im Regal,
//      Cache-Bump nach Syntax- und Interaktionsprüfung
// v60: GoodNotes-Ordneroptionen (sicheres Löschen) + einheitlicher
//      Bibliothekskopf in Notion, GoodNotes und NotebookLM
// v61: Hefte können aus GoodNotes in den Papierkorb; Papierkorb hat eine
//      bestätigte Aktion zum vollständigen, endgültigen Leeren
// v62: iPad-Rahmen v6 — Komfortmodus-Außenabstände pro Achse (--ipad-frame-x/-y)
//      statt Maximum aller Safe-Area-Kanten auf allen vier Seiten (styles.css)
// v63: UI-Fixes v7 (Touch-Sichtbarkeit, Z-Index-Skala, Composer-CSS konsolidiert,
//      flexible Tab-Breite, Kontrast) + Home v3 (persönliches Dashboard mit
//      Kennzahlen, Insights, ausklappbaren Bereichen) + Lernzeit v3 (Widget mit
//      Folds, Timer mit Pause, Wochenziel, Streak) + NEU telemetrie.js
//      (Lern-Telemetrie über das Event-Log) — neue Datei im Precache.
// v64: styles.css-Refactor — 12 % kleiner: Kommentare komprimiert, Duplikate
//      zusammengeführt, iPad-Sonderrahmen komplett entfernt (UI = Desktop,
//      Safe-Area nur noch als max()-Innenabstand), Statusleiste opak (index.html).
// v65: Neuer-Tab-„+“ als kleiner quadratischer Knopf direkt hinter dem letzten
//      Tab (Browser-Standard) statt tab-breiter Fläche (min-width-Bug in .tabchip-new).
// v66: Phase 1 komplett — Overlearning-Sperre (frisch bewertete Karten nicht mehr
//      sofort per Learn-Ahead drillbar, Hinweis „Kurzzeitgedächtnis-Falle“) und
//      Interleaved Practice (🔀 Gemischt lernen: Reviews+New stapelübergreifend
//      deterministisch gemischt). state.js, render-anki.js, app.js.
// v71: Bugfix-Paket Chat/Gedankengang — Live-Think-Box in-place gepatcht +
//      pointerdown-Toggle (render.js, app.js), Tool-Gating für Abruf-Fragen,
//      Netzwerk-Retry bei "Failed to fetch", rollierende Chat-Zusammenfassung (ai.js)
const CACHE = "impala67-v89"; // v89: 🐛 Offene-Punkte-Runde (20. Juli): 🖨 PDF-Export repariert (Druckfenster mit sichtbaren Knöpfen, schließt sich nach dem Drucken selbst) und NEU für Hefte als echte PDF-Datei (extras.js, heft.js) + ▤ Seiten-Menü im Heft: einzelne Seiten auswählen → Export als PDF/Bild + ✏️ Heft-Toolbar-Fixes (kaputtes Zeichen ersetzt, SVG-Icons für ▤/＋/✦/⌄, Farbfelder sichtbar, kein Neuaufbau pro Strich mehr = kein Springen; Vorlagen-Wechsel jetzt im ＋-Menü statt in der Toolbar) + ⚡️ Tab-Wechsel: Chat-Log-DOM je Chat gecacht (kein KaTeX/Highlight-Neuaufbau langer Chats, Scroll bleibt) + 📎 Seitenkontext-/Anhang-Chips vereinheitlicht (render.js, extras.js) // v88: 🐛 Bugfix-Runde (19. Juli): ⏱ Lernzeit-Widget- und Topbar-CSS fest in styles.css statt Laufzeit-<style> (Home-Widget erschien auf manchen Geräten komplett ungestylt) + Topbar-Menüs (Teilen/⋯) zentral in app.js VOR closeOutside inkl. blurActive-Fix (renderMain übersprang den Neuaufbau bei Fokus im Editor — Menü öffnete nicht); extras.js ohne zweiten Topbar-Listener, Menüpunkte schließen explizit (styles.css, lernzeit.js, app.js, extras.js) // v87: 🐛 Bugfix-Runde (18. Juli, spät v3): 🏠 Home erzwingt echte einspaltige Anordnung (Kennzahlen/Pillen zerfallen nicht mehr neben Hero & Bereiche) + 📊 Erfolgsquote-Kachel zeigt kein „—“ mehr, wenn die Lern-Insights bereits eine Quote nennen (Fallback auf alle bewerteten Reviews) + 🔍 Doppeltipp-Zoom im Heft GPU-flüssig wie der Pinch (eine Layout-Anwendung am Ende statt pro Frame — kein Ruckeln/Snap-Sprung) + ⏱ CSS-Fallback fürs Lernzeit-Widget (Fokusblock-Zeilen, Fold-Pfeile) + ⚡️ Performance-Paket (memoisierte Backlinks/Lern-Snapshots, entprelltes [[-Menü, DOM-Updates nur bei echten Änderungen, kein Doppel-Render pro Dispatch) // v86: 📌 Scroll-Fix: Hintergrund-Updates (Lernzeit „Lernst du noch?“, Sync, Status) bauen Chat/Heft/Seite nicht mehr neu — kein Springen nach unten mehr, Zoom+Undo im Heft bleiben erhalten + 🚀 flüssiger Pinch-Zoom im Heft (GPU-Transform statt Relayout pro Frame) + 🧭 Home-Scroll-Leiste jetzt am rechten Rand wie im Rest der App // v85: 🧮 neues KI-Tool calculate (math.js: Grundrechenarten, Brüche, komplexe Zahlen, Einheiten, Vektoren/Matrizen, symbolische Ableitungen, Integrale per Simpson-Regel) + 🔎 neues KI-Tool search_chat_history (durchsucht rückwärts ALLE Chats inkl. angehängter Dateien) — keine Änderung an der Modell-Auswahl // v84: 🧮 LaTeX bulletproof (Formeln werden vor dem Markdown-Parser maskiert — kein „amp;“, keine rohen $$-Blöcke mehr), 💭 Gedankengang bleibt über alle Tool-Schritte sichtbar & wird komplett gespeichert, 📓 neues KI-Tool get_heft_page_image (die KI holt sich Heftseiten selbst als Bild), 🔍 Doppeltipp zoomt erst ab 190 % zurück zur ganzen Seite, 🩺 Boot-Splash + IndexedDB-Timeout-Retry gegen den iPad-Start-Hänger // v83: 📱 iPad-Tastatur: App rutscht nach dem Einklappen wieder herunter, 💬 Chat zeigt eigene Nachricht sofort, 🖼️ Bilder per Copy-Paste in den Chat, 📓 Heft-Seite als Bild an die KI anhängen (+ ehrlicher Hinweis bei Nicht-Vision-Modell), 🔍 Doppeltipp-Zoom-Toggle, 🖊️ weiche Stift-Kurven statt Punktketten, 🖐️ Palm-Schutz mit Nachlauf gegen Seiten-Springen // v82: 🔕 UI-Events (Tab-Wechsel & Co.) stoßen keinen Auto-Sync mehr an, 🆚 Konflikt-Popup zeigt immer beide Stände nebeneinander (auch Hefte & Lösch-Konflikte); 👁 Vision-Anbindung aus v81 wurde wieder zurückgenommen // v81: 👁 Vision-Modell richtig eingebunden (Chat-Bilder + Handschrift), 🪢 Lasso-Verschieben, ⚡️ Sync v3.1 (robuster Heft-Fastpath, parallele Aufräum-Löschungen) // v80: ⚡️ Drive-Sync v3 (kein Blob-Vollscan mehr, parallele Transfers, Ein-Rutsch-Log-Merge), 🔑 API-Key-Sync repariert // v79: 🧠 Themen-Analyse über ALLE Karten (inkrementell), 👆 Langdruck/Rechtsklick-Menüs, ☁️ Google-Status-Fix, 🏠 Home-Scroll-Fix // v78: 📚 Fach→Themen-Hierarchie, 🔗 Verbindungen löschbar, Seiten-Filter im Themen-Modus // v77: 🧠 Themen-Graph (Embedding-Cluster + LLM), 📱 smooth Pinch-Zoom & Trägheits-Pan, ★ Modell-Favoriten // v76: ✍️ Inline-Text-Editor, ➕ Pull-to-add-Seite, 🩹 Radierer-Größen, ⧉ Lasso-Duplizieren + 10 QoL // v75: 🧽 Radierer trifft die echte Strich-Geometrie (auch Form-Snap-Linien) + 🪢 Lasso-Fix mit Aktionsleiste // v74: 📈 Lern-Analyse (analyse.js) + 🤖 Graph-KI (Entitäten, Synthese-Fragen, Mapping-Karten) // v73: 🕸 Wissensgraph (neues Modul graph.js), Form-Snap statt Formen-Tool + SVG-Toolbar-Icons, 🧑‍🏫 Feynman-Lernmodus beim Stapel-Start, Tool-Angebot v3 (Schalter + request_tools) // v72: 🧪 Experimente (Phase 2 KI-Lernmodi, neues Modul experimente.js), Anki-Lernlayout, kompakte Heft-Toolbar mit Schreib-Rückzug, Zurück-Logik-Fix, Neuer-Chat-Button, Tool-Gating v2 // v70: Performance-Runde (Chat-Signatur ohne Stringify, Stream-Drossel, Papierkorb-GC im Hintergrund) // v68: Feinschliff v9 (native Controls, +-Zeichen, Touch-Ziele, Autofill)

const APP_FILES = [
	"./",
	"./index.html",
	"./styles.css",
	"./manifest.json",
	"./version.json",
	// latest.json ist optional: updater.js fällt auf version.json zurück.
	// icon.svg wird direkt aus dem Netz geladen; ein Favicon darf den Offline-
	// Cache niemals als Pflichtdatei blockieren.
	"./icon.svg",
	"./main.js",
	"./collapse.js",
	"./chats.js",
	"./import-notion.js",
	"./util.js",
	"./db.js",
	"./srs.js",
	"./state.js",
	"./tools.js",
	"./ai.js",
	"./think-heuristik.js",
	"./handschrift.js",
	"./rag.js",
	"./drive.js",
	"./sync-core.js",
	"./pdfs.js",
	"./pdfpaste.js",
	"./lernzeit.js",
	"./telemetrie.js",
	"./schulnoten.js",
	"./experimente.js",
	"./graph.js",
	"./analyse.js",
	"./editor.js",
	"./render.js",
	"./library.js",
	"./settings.js",
	"./tabs.js",
	"./search.js",
	"./shortcuts.js",
	"./chat-fullscreen.js",
	"./popovers.js",
	"./boot.js",
	"./app.js",
	"./updater.js",
	"./voice.js",
	"./render-anki.js",
	"./extras.js",
	"./notebooklm.js",
	"./heft.js",
	"./heft-scan.js",
];

// CDN-Bibliotheken beim Installieren vorab cachen (best effort) — damit Markdown,
// LaTeX, Highlighting, Mermaid und PDF auch offline funktionieren, ohne dass jede
// Bibliothek vorher einmal benutzt worden sein muss.
const CDN_FILES = [
	"https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js",
	"https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
	"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
	"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
	"https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css",
	"https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
	"https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js",
	"https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css",
	"https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
	"https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js",
	"https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
	"https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.min.js",
	"https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm",
	"https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.3/math.min.js",
];

// Installation: App-Dateien verpflichtend, CDN-Dateien best effort vorab cachen.
self.addEventListener("install", (e) => {
	e.waitUntil(
		caches.open(CACHE)
			.then((c) => c.addAll(APP_FILES).then(() => Promise.allSettled(CDN_FILES.map((u) => c.add(u)))))
			.then(() => self.skipWaiting())
	);
});

// Aktivierung: alte Cache-Versionen aufräumen und sofort übernehmen.
self.addEventListener("activate", (e) => {
	e.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

// Web Share Target: Android/iPadOS sendet ein PDF als POST an ./share-target.
// Service Worker legt es nur einmal in einem separaten Cache ab und leitet dann
// zur normalen App-URL weiter. pdfpaste.js löscht den temporären Eintrag direkt
// nach dem erfolgreichen Import.
self.addEventListener("fetch", (e) => {
	const url = new URL(e.request.url);
	if (e.request.method !== "POST" || url.origin !== self.location.origin || !url.pathname.endsWith("/share-target")) return;
	e.respondWith((async () => {
		const data = await e.request.formData();
		const file = data.get("pdf");
		if (file && file.type === "application/pdf") {
			const shareCache = await caches.open("impala67-pdf-share");
			await shareCache.put("/share-target-payload", new Response(file));
		}
		return Response.redirect(new URL("./index.html?share-target=1", self.location.href).href, 303);
	})());
});

// Nur GET-Anfragen an die eigene Domain oder die genutzten CDNs behandeln —
// API-Aufrufe (OpenAI, Google Drive, …) gehen unverändert ins Netz.
function shouldHandle(req) {
	if (req.method !== "GET") return false;
	const url = new URL(req.url);
	// config.local.js ist gerätespezifisch & optional — niemals abfangen oder cachen.
	if (url.origin === self.location.origin && url.pathname.endsWith("/config.local.js")) return false;
	return url.origin === self.location.origin ||
		url.hostname === "cdn.jsdelivr.net" ||
		url.hostname === "cdnjs.cloudflare.com";
}

// Cache-Vergiftung verhindern: niemals HTML-Fallbacks unter Skript-/Asset-Pfaden
// speichern (SPA-/404-Fallbacks liefern HTML mit Status 200 — einmal gecacht,
// wirft z.B. ein .js-Pfad beim nächsten Start "SyntaxError: Unexpected token '<'").
function isHtmlFallback(req, res) {
	const ct = (res.headers.get("content-type") || "").toLowerCase();
	const path = new URL(req.url).pathname;
	return /\.(js|css|json|svg)$/.test(path) && ct.includes("text/html");
}

self.addEventListener("fetch", (e) => {
	if (!shouldHandle(e.request)) return;
	const sameOrigin = new URL(e.request.url).origin === self.location.origin;
	e.respondWith(
		caches.open(CACHE).then(async (cache) => {
			const cached = await cache.match(e.request);
			// App-Dateien: network-first — jeder normale Start lädt die aktuelle Version
			// (kein Strg+Shift+R mehr nötig); offline dient der Cache als Fallback.
			if (sameOrigin) {
				try {
					// iPadOS kann auch hinter einem network-first Worker noch eine alte HTTP-
					// Cache-Antwort liefern. App-Module, CSS und HTML müssen deshalb wirklich
					// vom Netz kommen; der Cache bleibt ausschließlich Offline-Fallback.
					const freshReq = new Request(e.request, { cache: "no-store" });
					const res = await fetch(freshReq);
					if (res && res.ok && !isHtmlFallback(e.request, res)) cache.put(e.request, res.clone());
					return res;
				} catch {
					return cached || Response.error();
				}
			}
			// CDN-Bibliotheken: stale-while-revalidate — URLs sind versioniert,
			// der Inhalt ändert sich nie, Offline-Start bleibt schnell.
			const fresh = fetch(e.request)
				.then((res) => {
					if (res && res.ok) cache.put(e.request, res.clone());
					return res;
				})
				.catch(() => cached);
			return cached || fresh;
		})
	);
});