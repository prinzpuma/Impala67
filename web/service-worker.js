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
const CACHE = "impala67-v47";

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
	"./rag.js",
	"./drive.js",
	"./sync-core.js",
	"./pdfs.js",
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