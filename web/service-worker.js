"use strict";
// Service-Worker: App-Dateien network-first (immer aktuell, offline aus dem Cache),
// CDN-Bibliotheken cache-first (URLs sind versionsgepinnt, Inhalt ändert sich nie).
// Neue App-Version veröffentlichen = Dateien auf GitHub Pages pushen — fertig.
// config.local.js (gerätespezifisch, optional) wird grundsätzlich NICHT behandelt.

// 📜 Versions-Changelog: lebt in der Projekt-Doku („Projekt-Doku kompakt — Fixes, Audit,
// Build & Release“). Der frühere ~100-Zeilen-Kommentar-Verlauf hat in einer bei jedem
// Update ausgelieferten Datei nichts verloren (Ballast bei jedem Download, Merge-
// Konflikt bei jedem Bump). Hier steht nur noch der aktuelle Cache-Schlüssel.
const CACHE = "impala67-v109"; // v109: 📱 Mobile-Politur (23. Juli): Desktop-Tabstrip auf kleinen Bildschirmen entfernt (keine doppelte Navigation, mehr Lernfläche); Mehr-Ansicht ordnet alle fünf Schnellbereiche in einer Zeile; KI-Kopfzeile zeigt keinen wirkungslosen Vollbild-Knopf mehr. // v108: 🐛 Mobile-Navigationsfix (23. Juli): KI-Fokus wurde fälschlich als geöffnete Bildschirmtastatur interpretiert und blendete die Tab-Leiste aus; die Navigation war danach nicht mehr erreichbar. Tastatur-Erkennung nutzt jetzt nur noch VisualViewport-Resize. Wechsel von KI zu Lernen/Notizen/Mehr klappt die KI sauber ein, damit keine Ansicht unsichtbar über der nächsten liegt. // v107: 📱 Mobile UI v4 (23. Juli): vollständiger zweiter Neubau nach echtem Smartphone-App-Prinzip — eigenes Header-/Tab-Bar-Design mit Lernen, Notizen, KI und Mehr; Vollbild-App-Bereich statt Desktop-Sidebar-Sheet; Kartenlernen nutzt die komplette verfügbare Fläche; KI ist eine eigene Ansicht; keine erzwungene Karten-Weiterleitung beim Start; robuste Tastaturbehandlung; Darstellung in mobile.css vollständig von Desktop-CSS getrennt. // v106: 📱 Mobile Shell v3 (23. Juli): Handy-UI komplett neu geschrieben — mobile.js (NEU) ist die einzige Quelle der Handy-Schale: feste Tab-Leiste unten mit den zwei Haupt-Anwendungsfällen 🃏 Karten (Fällig-Badge, Start-Ansicht wenn Karten fällig sind) und ✦ KI (Panel als Vollbild-Sheet, Eingabe sofort fokussiert) plus ＋ Neu und ☰ Menü (Sidebar als Bottom-Sheet mit echtem Scrim-Element — alle Desktop-Funktionen erreichbar); fragile :has(:focus)-Ausblende-Heuristiken der alten Dock-Pille durch robustes focusin/focusout ersetzt; alte Shell entfernt (app.js, styles.css, index.html). // v105: 🃏 Karteikarten als eigener Tab (anki:main) + KI-Kontext + ⛶ Vollbild (23. Juli). // v104: 🧑‍🏫 Feynman-Fix (23. Juli): Die KI-Bewertung im Feynman-Lernmodus verschwand sofort wieder — der Telemetrie-Re-Render direkt nach der Prüfung baute die Karte neu auf und löschte das frisch eingefügte Feedback aus dem DOM. Das Feedback bleibt jetzt bis zur Bewertung gespeichert und wird nach jedem Re-Render neu eingesetzt; war die Karte beim Prüf-Ende schon aufgedeckt (␣ während „Prüfe …“), wird es direkt nachgerüstet (experimente.js). // v103: 🧹 KISS-Runde (23. Juli): doppelte, widersprüchliche CSS-Regeln aus extras.js entfernt und in styles.css zusammengeführt (#sideContextChip, .file-chip, Lernmodus-Zähler folgen jetzt der Akzentfarbe), verwaiste .study-meta-Regeln gelöscht (styles.css, extras.js) · ⏹-Stopp bricht ALLE laufenden KI-Anfragen ab statt nur der zuletzt gestarteten, Edit-Karte nach create_page findet die neue Seite per id statt Titel-Suche (ai.js) · Doppel-Tipp-Schutz der Bewertungsleiste reaktiviert nur noch selbst gesperrte Knöpfe (extras.js). // v102: 🐛 Bugfix-Runde (23. Juli): KI-Kreis unten rechts überlappte „⚙️ Optionen“ in der Lern-Fußleiste — Karten-Bereich reserviert unten jetzt 96px für fixe Elemente; Heft-Ausblendung des KI-Kreises deckt zusätzlich .heft-stage ab; Gratulations-/Warte-Karte in der Lern-Bühne vertikal zentriert (styles.css). // v101: 🃏 Karteikarten-Redesign v1 (22. Juli, Nacht): Lern-Ansicht als ruhige Karten-Bühne mit Mindesthöhe und zentrierter Frage, Frage/Antwort-Labels + Trennlinie mit „Antwort“-Label, großer akzentfarbener „Antwort zeigen“-Button, farbkodierte Bewertungsleiste (mobil 2×2), Meta-Infos als kompakte Kopfzeile mit Tooltip (render-anki.js, styles.css) · Karten-Design-Spezifikation im KI-Prompt: kompaktes Standardformat, Kernantwort zuerst, Tabellen/Mermaid nur wenn nötig (tools.js). // v100: 🃏 Karteikarten-Bugfix-Runde (22. Juli): Aufdecken springt nicht mehr auf eine andere Karte — sichtbare Karte wird beim Aufdecken festgepinnt, Space/Enter bewertet immer die sichtbare Karte (app.js, render-anki.js) · Klick auf die Frage deckt nicht mehr auf, nur noch „Antwort zeigen“/Leertaste (render-anki.js) · ✎ Bearbeiten im Lernmodus wechselt nicht mehr den aktiven Stapel (app.js) · Favicon-Link in den <head> verschoben, damit das neue Vektor-Icon überall greift (index.html, ?build=53 für die Worker-Registrierung). // v99: 📋 „kommt noch“-Runde (22. Juli): Backup-Empfehlungen vom Home entfernt + Home-Bereiche weiterhin nur über Einstellungen → Home ausblendbar (render.js, styles.css) · Markieren über Blockgrenzen per Maus-Drag → Blockauswahl (editor.js) · Stapel in der linken Spalte per Drag & Drop sortierbar (app.js, state.js, render-anki.js) · Senden-Button wird während der Antwort zum ⏹-Abbrechen, Teilantwort bleibt erhalten (ai.js, chat-fullscreen.js, app.js) · Stapel direkt löschbar in der Stapel-Übersicht (render-anki.js) · einheitliches Vektor-App-Icon statt Emoji-Font (icon.svg, manifest.json). // v98: 🏠 Home v4 (21. Juli): personalisierte Homeseite (Begrüßungsname, ✨ Für-dich-Tipps aus den Lerndaten, 🃏 Stapel-Überblick, ★ Favoriten) + komplett neuer Home-Editor unter Einstellungen → Home — EINE Quelle der Wahrheit für Bereiche, Sichtbarkeit & Reihenfolge (render.js, settings.js, app.js). // v97: 🧪 Telemetrie v3 (21. Juli): Experimente messbar — TELE.mark hängt Experiment-Nutzung als exp-Array ans review-Event, TELE.onReview ersetzt die zweite Zustandsmaschine in analyse.js (DRY), experimente.js loggt jede Nutzung als expEvent (track/trackCard), neue Auswertung „Experimente × Erfolg“ im Statistik-Tab (telemetrie.js, experimente.js, analyse.js). // v96: 🐛 Sync+Konflikt-Fixes (21. Juli): Bug1 Konflikt-Dialog zeigt alte Seite (localStorage-Quota-Fallback + Live-Rekonstruktion aus S.pages), Bug2 Heft-Konflikt zeigt korrekte Abweichungsseite, Bug3 Heft-Vorschau Vor/Zurück-Navigation, Bug4 Sync-Divergenz (Web Lock ohne ifAvailable + Post-Upload-Delta-Sweep in drive.js). // v95: 🎨 Design-Politur (21. Juli): ROOT-CAUSE-FIX „Seite springt nach oben“ (app.js: focusout-Reset nur noch bei echter Bildschirmtastatur + tote #-Anker abgefangen), Touch-Ziele ≥44px, mehr Whitespace in Menüs/Chat, Chat-Typografie = Editor (16px/1.6), Light-Mode-Kontrast erhöht, DRY: doppelte button-Transitions & Reduce-Motion-Blöcke entfernt (styles.css, index.html ?build=53)

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
	"./mobile.js",
	"./mobile.css",
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
			// CDN-Bibliotheken: cache-first — die URLs sind versionsgepinnt und damit
			// unveränderlich (tools/gen-sri.mjs erzwingt das Pinning). Das frühere
			// stale-while-revalidate lud jede Bibliothek bei JEDEM Start erneut übers
			// Netz — Bandbreite/Akku ohne Nutzen. Fehlt die Datei, wird sie einmal geladen.
			if (cached) return cached;
			const res = await fetch(e.request);
			if (res && res.ok) cache.put(e.request, res.clone());
			return res;
		})
	);
});