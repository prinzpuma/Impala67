"use strict";
// Service-Worker: versionierte App-Dateien cache-first (atomar, sofort, offline),
// CDN-Bibliotheken cache-first (URLs sind versionsgepinnt, Inhalt aendert sich nie).
// Neue App-Version veroeffentlichen = Dateien auf GitHub Pages pushen.
// config.local.js (geraetespezifisch, optional) wird grundsaetzlich NICHT behandelt.
// Versions-Changelog: siehe Projekt-Doku. Hier nur der aktuelle Cache-Schluessel.
const CACHE = "impala67-v248"; // Release-Workflow ersetzt diesen Wert im veröffentlichten Build.
// Geteilte PDFs & nachgeladene Zusatz-Module liegen in EIGENEN, versionsübergreifenden Caches.
// Sie bleiben auch bei einem App-Update (Wechsel von CACHE) vollständig erhalten.
const SHARE_CACHE = "impala67-pdf-share";
const OPTIONAL_CACHE = "impala67-optional-modules";

const APP_FILES = [
	"./",
	"./index.html",
	"./styles.css",
	"./manifest.json",
	// Der Update-Check fragt version.json mit no-store an. Der Fetch-Handler nimmt
	// daher online immer den Serverstand, kann bei Netz-/Pages-Fehlern aber auf
	// diese gecachte Kopie zurückfallen, statt den ganzen Check abzubrechen.
	"./version.json",
	// icon.svg wird direkt aus dem Netz geladen; ein Favicon darf den Offline-
	// Cache niemals als Pflichtdatei blockieren.
	"./icon.svg",
	"./main.js",
	"./mobile.js",
	"./mobile-view.js",
	"./mobile.css",
	"./android-fullscreen.js",
	"./collapse.js",
	"./chats.js",
	"./import-notion.js",
	"./util.js",
	"./optional-modules.js",
	"./db.js",
	"./cooperative.js",
	"./checkpoint-scheduler.js",
	"./srs.js",
	"./state.js",
	"./state-checkpoint.js",
	"./tools.js",
	"./ai.js",
	"./embedding.js",
	"./think-heuristik.js",
	"./handschrift.js",
	"./rag.js",
	"./rag-ranking.js",
	"./rag-worker.js",
	"./embedding-worker.js",
	"./drive.js",
	"./drive-status.js",
	"./drive-sync-policy.js",
	"./sync-core.js",
	"./sync-crypto.js",
	"./sync-transfer.js",
	"./sync-cloudflare.js",
	"./sync-maintenance.js",
	"./qrcode.js",
	"./pdfs.js",
	"./pdfpaste.js",
	"./lernzeit.js",
	"./lernzeit-context.js",
	"./telemetrie.js",
	"./fach.js",
	"./schulnoten.js",
	"./experimente.js",
	"./graph.js",
	"./graph-worker.js",
	"./analyse.js",
	"./controller.js",
	"./editor.js",
	"./render.js",
	"./library.js",
	"./export-media.js",
	"./settings.js",
	"./settings-schema.js",
	"./settings-ui.js",
	"./settings-action-state.js",
	"./settings-renderer.js",
	"./settings-sync.js",
	"./performance-profiler.js",
	"./performance-profiler-settings.js",
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
	"./heft-document-core.js",
	"./heft-geometry.js",
	"./heft-pages-core.js",
	"./heft-scan.js",
];

// Leichtgewichtige Basis-CDN-Bibliotheken beim Installieren vorab cachen.
// Fest versionierte Zusatzmodule werden nach dem App-Start im Leerlauf in den
// OPTIONAL_CACHE geladen, aber weiterhin erst bei ihrer Nutzung ausgefuehrt.
// Nutzerabhaengige OCR-/Transformers-Dateien bleiben echtes On-Demand-Material.
const CDN_FILES = [
	"https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js",
	"https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
];

// Installation: App-Dateien verpflichtend, CDN-Dateien best effort vorab cachen.
// Der neue Worker bleibt danach bewusst in "waiting", solange noch die alte App
// läuft. Erst updater.js sendet nach dem ausdrücklichen Update-Klick SKIP_WAITING.
// Dadurch bedient niemals ein neues Cache-Bundle eine noch laufende alte UI.
self.addEventListener("install", (e) => {
	e.waitUntil(
		caches.open(CACHE)
			.then((c) => c.addAll(APP_FILES.map((u) => new Request(u, { cache: "reload" })))
				.then(() => Promise.allSettled(CDN_FILES.map((u) => c.add(u)))))
	);
});

self.addEventListener("message", (e) => {
	if (e.data?.type === "SKIP_WAITING") e.waitUntil(self.skipWaiting());
	if (e.data?.type === "GET_VERSION" && e.ports?.[0]) {
		e.ports[0].postMessage({ type: "VERSION", version: CACHE.replace(/^impala67-v/, "") });
	}
});

// Aktivierung: alte Cache-Versionen aufräumen, versionsübergreifende Caches (OPTIONAL_CACHE, SHARE_CACHE, transformers-cache) bewahren.
self.addEventListener("activate", (e) => {
	e.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE && k !== OPTIONAL_CACHE && !k.includes("transformers") && !k.includes("impala67-models")).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

// Web Share Target: unterstützte installierte PWAs (vor allem Android/ChromeOS)
// senden ein PDF als POST. iPadOS registriert eine reine PWA derzeit nicht als
// Share Target; dort führt die Dateiauswahl in denselben Import-Screen.
// App-URL weiter. pdfpaste.js löscht den temporären Eintrag nach dem Import.
// FIX: Scheiterte formData() (abgebrochene Freigabe, fremder Inhalt), wurde die
// Antwort abgelehnt und das Gerät zeigte eine Browser-Fehlerseite statt der App.
async function handleShare(req) {
	try {
		const file = (await req.formData()).get("pdf");
		if (file && file.type === "application/pdf") {
			const shareCache = await caches.open(SHARE_CACHE);
			await shareCache.put("/share-target-payload", new Response(file, { headers: {
				"content-type": "application/pdf",
				"x-impala-file-name": encodeURIComponent(file.name || "shared.pdf"),
			} }));
		}
	} catch { /* ohne Nutzdaten trotzdem zurück in die App */ }
	return Response.redirect(new URL("./index.html?share-target=1", self.location.href).href, 303);
}

// Nur GET-Anfragen an die eigene Domain oder die genutzten CDNs behandeln -
// API-Aufrufe (OpenAI, Google Drive, ...) gehen unverändert ins Netz.
function shouldHandle(req, url) {
	if (req.method !== "GET") return false;
	// config.local.js ist gerätespezifisch & optional - niemals abfangen oder cachen.
	if (url.origin === self.location.origin && url.pathname.endsWith("/config.local.js")) return false;
	return url.origin === self.location.origin ||
		url.hostname === "cdn.jsdelivr.net" ||
		url.hostname === "cdnjs.cloudflare.com";
}

// Cache-Vergiftung verhindern: niemals HTML-Fallbacks unter Skript-/Asset-Pfaden
// speichern (SPA-/404-Fallbacks liefern HTML mit Status 200 - einmal gecacht,
// wirft z.B. ein .js-Pfad beim nächsten Start "SyntaxError: Unexpected token '<'").
// Gilt jetzt auch für die CDNs (Captive-Portal-/Fehlerseiten) und für .wasm.
function isHtmlFallback(path, res) {
	const ct = (res.headers.get("content-type") || "").toLowerCase();
	return /\.(js|css|json|svg|wasm)$/.test(path) && ct.includes("text/html");
}

// EIN Fetch-Handler für alles: vorher prüften zwei Listener JEDE Anfrage doppelt
// und parsten die URL bis zu dreimal.
self.addEventListener("fetch", (e) => {
	const req = e.request;
	const url = new URL(req.url);
	const sameOrigin = url.origin === self.location.origin;
	if (req.method === "POST") {
		if (sameOrigin && url.pathname.endsWith("/share-target")) e.respondWith(handleShare(req));
		return;
	}
	if (!shouldHandle(req, url)) return;
	// Cache-Schlüssel OHNE Query: "?share-target=1" & Co. trafen keinen Eintrag —
	// offline blieb die App danach weiß. Ein Eintrag je Pfad statt je Query-Variante.
	const key = sameOrigin ? url.pathname : req;
	e.respondWith(
		(async () => {
			if (sameOrigin) {
				const cache = await caches.open(CACHE);
				const cached = await cache.match(key);
				// Installierte PWA: App-Shell atomar aus dem versionierten Cache starten.
				// Vorher warteten index.html + rund 40 ES-Module bei JEDEM Start erneut auf
				// das Netz. Updates bleiben sicher: ein neuer Worker befüllt CACHE erst
				// vollständig und aktiviert ihn danach. Explizite no-store-Abfragen
				// (insbesondere updater.js -> version.json) bleiben netzaktuell.
				if (cached && req.cache !== "no-store") return cached;
				try {
					const res = await fetch(new Request(req, { cache: "no-store" }));
					if (res && res.ok && !isHtmlFallback(url.pathname, res)) cache.put(key, res.clone());
					return res;
				} catch {
					return cached || Response.error();
				}
			}
			// CDN-Bibliotheken & Zusatzmodule: versionsübergreifenden OPTIONAL_CACHE zuerst prüfen
			const optCache = await caches.open(OPTIONAL_CACHE);
			let cached = await optCache.match(key);
			if (!cached) {
				const mainCache = await caches.open(CACHE);
				cached = await mainCache.match(key);
			}
			if (cached) return cached;
			const res = await fetch(req);
			if (res && res.ok && !isHtmlFallback(url.pathname, res)) {
				optCache.put(key, res.clone());
			}
			return res;
		})()
	);
});
