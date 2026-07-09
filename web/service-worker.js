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
const CACHE = "impala67-v8";

const APP_FILES = [
	"./",
	"./index.html",
	"./styles.css",
	"./manifest.json",
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
	"./render-anki.js",
	"./extras.js",
	"./notebooklm.js",
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
					const res = await fetch(e.request);
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