"use strict";

// Eine Quelle der Wahrheit fuer alle fest versionierten, optionalen CDN-Pakete.
// Die Dateien werden nur in Cache Storage abgelegt; sie werden beim Prefetch
// weder als Skript eingebunden noch geparst oder ausgefuehrt.
export const OPTIONAL_MODULE_URLS = Object.freeze({
	katexCss: "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css",
	katex: "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
	katexAutoRender: "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js",
	highlightCss: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css",
	highlight: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
	mermaid: "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js",
	math: "https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.3/math.min.js",
	pdf: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
	pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
	sql: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.min.js",
	sqlWasm: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm",
});

export const OPTIONAL_MODULE_GROUPS = Object.freeze([
	Object.freeze({ name: "KaTeX", urls: Object.freeze([OPTIONAL_MODULE_URLS.katexCss, OPTIONAL_MODULE_URLS.katex, OPTIONAL_MODULE_URLS.katexAutoRender]) }),
	Object.freeze({ name: "Highlight.js", urls: Object.freeze([OPTIONAL_MODULE_URLS.highlightCss, OPTIONAL_MODULE_URLS.highlight]) }),
	Object.freeze({ name: "Mermaid", urls: Object.freeze([OPTIONAL_MODULE_URLS.mermaid]) }),
	Object.freeze({ name: "Math.js", urls: Object.freeze([OPTIONAL_MODULE_URLS.math]) }),
	Object.freeze({ name: "PDF.js", urls: Object.freeze([OPTIONAL_MODULE_URLS.pdf, OPTIONAL_MODULE_URLS.pdfWorker]) }),
	Object.freeze({ name: "SQL.js", urls: Object.freeze([OPTIONAL_MODULE_URLS.sql, OPTIONAL_MODULE_URLS.sqlWasm]) }),
]);

const OPTIONAL_CACHE = "impala67-optional-modules";
const SLOW_CONNECTIONS = new Set(["slow-2g", "2g"]);
let scheduledPrefetch = null;

export function mayPrefetchOptionalModules(connection) {
	return !connection?.saveData && !SLOW_CONNECTIONS.has(connection?.effectiveType || "");
}

export function stylesheetAssetUrls(css, stylesheetUrl) {
	const urls = [];
	const seen = new Set();
	for (const match of String(css || "").matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
		const value = match[2].trim();
		if (!value || value.startsWith("data:") || value.startsWith("#")) continue;
		const absolute = new URL(value, stylesheetUrl).href;
		if (!seen.has(absolute)) {
			seen.add(absolute);
			urls.push(absolute);
		}
	}
	return urls;
}

function validModuleResponse(response, url) {
	if (!response?.ok) return false;
	const type = (response.headers?.get("content-type") || "").toLowerCase();
	return !(/\.(?:js|css|wasm)(?:$|\?)/i.test(url) && type.includes("text/html"));
}

async function fetchModule(url, fetchImpl) {
	const response = await fetchImpl(url, {
		cache: "no-store",
		credentials: "omit",
		mode: "cors",
		priority: "low",
	});
	if (!validModuleResponse(response, url)) throw new Error("Ungueltige CDN-Antwort fuer " + url);
	return response;
}

// Eine Gruppe wird erst geschrieben, nachdem alle fehlenden Haupt- und Folgeassets
// erfolgreich geladen wurden. Schlaegt Cache.put fehl, werden nur die in diesem
// Durchlauf neu angelegten Eintraege wieder entfernt.
export async function cacheOptionalModuleGroup(cache, group, fetchImpl = fetch) {
	const available = new Map();
	const fetched = new Map();
	for (const url of group.urls) {
		const cached = await cache.match(url);
		if (cached) available.set(url, cached);
		else {
			const response = await fetchModule(url, fetchImpl);
			available.set(url, response);
			fetched.set(url, response);
		}
	}

	for (const url of group.urls.filter((item) => /\.css(?:$|\?)/i.test(item))) {
		const css = await available.get(url).clone().text();
		for (const assetUrl of stylesheetAssetUrls(css, url)) {
			if (available.has(assetUrl)) continue;
			const cached = await cache.match(assetUrl);
			if (cached) available.set(assetUrl, cached);
			else {
				const response = await fetchModule(assetUrl, fetchImpl);
				available.set(assetUrl, response);
				fetched.set(assetUrl, response);
			}
		}
	}

	const written = [];
	try {
		for (const [url, response] of fetched) {
			await cache.put(url, response.clone());
			written.push(url);
		}
	} catch (error) {
		await Promise.allSettled(written.map((url) => cache.delete(url)));
		throw error;
	}
	return { name: group.name, cached: available.size, downloaded: fetched.size };
}

function idlePause(windowRef) {
	return new Promise((resolve) => {
		if (typeof windowRef?.requestIdleCallback === "function") {
			windowRef.requestIdleCallback(resolve, { timeout: 15000 });
		} else {
			windowRef?.setTimeout ? windowRef.setTimeout(resolve, 4000) : setTimeout(resolve, 4000);
		}
	});
}

export async function prefetchOptionalModules({
	cacheStorage = globalThis.caches,
	fetchImpl = globalThis.fetch,
	navigatorRef = globalThis.navigator,
	windowRef = globalThis.window,
	groups = OPTIONAL_MODULE_GROUPS,
} = {}) {
	if (!cacheStorage || typeof fetchImpl !== "function") return { skipped: "unsupported", groups: [] };
	if (navigatorRef?.onLine === false) return { skipped: "offline", groups: [] };
	if (!mayPrefetchOptionalModules(navigatorRef?.connection)) return { skipped: "connection", groups: [] };
	const cache = await cacheStorage.open(OPTIONAL_CACHE);
	const results = [];
	for (const group of groups) {
		await idlePause(windowRef);
		if (navigatorRef?.onLine === false || !mayPrefetchOptionalModules(navigatorRef?.connection)) break;
		try {
			results.push(await cacheOptionalModuleGroup(cache, group, fetchImpl));
		} catch (error) {
			console.warn("[optional-modules] " + group.name + " nicht vorgeladen:", error);
		}
	}
	return { skipped: null, groups: results };
}

// Fire-and-forget nach dem App-Start. Ein Offline-Start versucht es beim naechsten
// Online-Ereignis erneut; parallele Prefetch-Laeufe werden zusammengefasst.
export function scheduleOptionalModulePrefetch(options = {}) {
	if (scheduledPrefetch) return scheduledPrefetch;
	const navigatorRef = options.navigatorRef || globalThis.navigator;
	const windowRef = options.windowRef || globalThis.window;
	const start = () => {
		scheduledPrefetch = prefetchOptionalModules(options).catch((error) => {
			console.warn("[optional-modules] Hintergrund-Prefetch fehlgeschlagen:", error);
			return { skipped: "error", groups: [] };
		});
		return scheduledPrefetch;
	};
	if (navigatorRef?.onLine === false && windowRef?.addEventListener) {
		scheduledPrefetch = new Promise((resolve) => {
			windowRef.addEventListener("online", () => resolve(start()), { once: true });
		});
		return scheduledPrefetch;
	}
	return start();
}
