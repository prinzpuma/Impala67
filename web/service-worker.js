"use strict";
// Service-Worker: cached alle App-Dateien und CDN-Bibliotheken für Offline-Nutzung
// und aktualisiert sie bei jedem Aufruf im Hintergrund (stale-while-revalidate).
// Neue App-Version veröffentlichen = Dateien auf GitHub Pages pushen — fertig.

// Neuer Cache-Name nach der Umbenennung — der alte "notion-v2"-Cache wird bei der
// Aktivierung unten automatisch aufgeräumt (keys-Filter löscht alles außer CACHE).
const CACHE = "impala67-v2";

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
	"./app.js",
	"./updater.js",
	"./render-anki.js",
	"./extras.js",
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
	return url.origin === self.location.origin ||
		url.hostname === "cdn.jsdelivr.net" ||
		url.hostname === "cdnjs.cloudflare.com";
}

self.addEventListener("fetch", (e) => {
	if (!shouldHandle(e.request)) return;
	e.respondWith(
		caches.open(CACHE).then(async (cache) => {
			const cached = await cache.match(e.request);
			// Im Hintergrund frisch laden und den Cache aktualisieren.
			const fresh = fetch(e.request)
				.then((res) => {
					if (res && res.ok) cache.put(e.request, res.clone());
					return res;
				})
				.catch(() => cached);
			// Sofort aus dem Cache antworten (schnell + offline), sonst aufs Netz warten.
			return cached || fresh;
		})
	);
});