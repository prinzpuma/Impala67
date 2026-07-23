"use strict";
// Service-Worker: App-Dateien network-first (immer aktuell, offline aus dem Cache),
// CDN-Bibliotheken cache-first (URLs sind versionsgepinnt, Inhalt aendert sich nie).
// Neue App-Version veroeffentlichen = Dateien auf GitHub Pages pushen.
// config.local.js (geraetespezifisch, optional) wird grundsaetzlich NICHT behandelt.
// Versions-Changelog: siehe Projekt-Doku. Hier nur der aktuelle Cache-Schluessel.
const CACHE = "impala67-v112"; // Mobile UI v5.1: Kopfzeilen, Empty-States, Feinschliff.

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

// CDN-Bibliotheken beim Installieren vorab cachen (best effort) - damit Markdown,
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

// Nur GET-Anfragen an die eigene Domain oder die genutzten CDNs behandeln -
// API-Aufrufe (OpenAI, Google Drive, ...) gehen unverändert ins Netz.
function shouldHandle(req) {
	if (req.method !== "GET") return false;
	const url = new URL(req.url);
	// config.local.js ist gerätespezifisch & optional - niemals abfangen oder cachen.
	if (url.origin === self.location.origin && url.pathname.endsWith("/config.local.js")) return false;
	return url.origin === self.location.origin ||
		url.hostname === "cdn.jsdelivr.net" ||
		url.hostname === "cdnjs.cloudflare.com";
}

// Cache-Vergiftung verhindern: niemals HTML-Fallbacks unter Skript-/Asset-Pfaden
// speichern (SPA-/404-Fallbacks liefern HTML mit Status 200 - einmal gecacht,
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
			// App-Dateien: network-first - jeder normale Start lädt die aktuelle Version
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
			// CDN-Bibliotheken: cache-first - die URLs sind versionsgepinnt und damit
			// unveränderlich (tools/gen-sri.mjs erzwingt das Pinning). Das frühere
			// stale-while-revalidate lud jede Bibliothek bei JEDEM Start erneut übers
			// Netz - Bandbreite/Akku ohne Nutzen. Fehlt die Datei, wird sie einmal geladen.
			if (cached) return cached;
			const res = await fetch(e.request);
			if (res && res.ok) cache.put(e.request, res.clone());
			return res;
		})
	);
});