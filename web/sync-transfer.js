"use strict";

const UTF8_ENCODER = new TextEncoder();

export function transferBodyBytes(body) {
	if (typeof body === "string") return UTF8_ENCODER.encode(body).byteLength;
	if (body instanceof ArrayBuffer) return body.byteLength;
	if (ArrayBuffer.isView(body)) return body.byteLength;
	if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
	return 0;
}

export function isRetryableSyncError(error) {
	const status = Number(error?.status) || 0;
	return !status || status === 408 || status === 425 || status === 429 || status >= 500;
}

export function syncRetryDelayMs(attempt, { base = 1000, max = 30000 } = {}) {
	return Math.min(max, Math.round(base * 1.6 ** Math.max(0, Number(attempt) || 0)));
}

function responseHeaders(xhr) {
	const headers = new Headers();
	for (const line of String(xhr.getAllResponseHeaders?.() || "").trim().split(/[\r\n]+/)) {
		if (!line) continue;
		const at = line.indexOf(":");
		if (at > 0) headers.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	return headers;
}

function xhrRequest(url, init, { stallTimeoutMs, onProgress, XMLHttpRequestCtor }) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequestCtor();
		let timer = 0, settled = false;
		const signal = init.signal;
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener?.("abort", abortFromSignal);
		};
		const finish = (fn, value) => {
			if (settled) return;
			settled = true; cleanup(); fn(value);
		};
		const fail = (error) => finish(reject, error instanceof Error ? error : new Error(String(error || "Netzwerkfehler")));
		const armStallTimer = () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				finish(reject, new Error("Zeitüberschreitung beim Cloudflare-Sync: keine Datenübertragung."));
				try { xhr.abort(); } catch {}
			}, stallTimeoutMs);
		};
		const progress = (direction) => (event) => {
			armStallTimer();
			onProgress?.({ direction, loaded: Number(event.loaded) || 0, total: Number(event.total) || 0, lengthComputable: !!event.lengthComputable });
		};
		const abortFromSignal = () => {
			try { xhr.abort(); } catch {}
			fail(signal?.reason || new Error("Cloudflare-Sync abgebrochen."));
		};

		xhr.open(init.method || "GET", url, true);
		xhr.responseType = "arraybuffer";
		for (const [name, value] of new Headers(init.headers || {})) xhr.setRequestHeader(name, value);
		xhr.upload?.addEventListener?.("progress", progress("upload"));
		xhr.addEventListener?.("progress", progress("download"));
		xhr.addEventListener?.("load", () => {
			const status = Number(xhr.status) || 0;
			const bytes = xhr.response instanceof ArrayBuffer ? xhr.response : new ArrayBuffer(0);
			const body = [204, 205, 304].includes(status) || bytes.byteLength === 0 ? null : bytes;
			finish(resolve, new Response(body, { status, statusText: xhr.statusText || "", headers: responseHeaders(xhr) }));
		});
		xhr.addEventListener?.("error", () => fail(new TypeError("Der Cloudflare-Sync-Server ist nicht erreichbar.")));
		xhr.addEventListener?.("abort", () => {
			if (!settled) fail(signal?.reason || new Error("Cloudflare-Sync abgebrochen."));
		});
		if (signal?.aborted) { abortFromSignal(); return; }
		signal?.addEventListener?.("abort", abortFromSignal, { once: true });
		armStallTimer();
		xhr.send(init.body ?? null);
	});
}

export async function requestWithStallTimeout(url, init = {}, {
	stallTimeoutMs = 45000,
	onProgress,
	XMLHttpRequestCtor = globalThis.XMLHttpRequest,
	fetchImpl = globalThis.fetch,
} = {}) {
	if (typeof XMLHttpRequestCtor === "function") {
		return xhrRequest(url, init, { stallTimeoutMs, onProgress, XMLHttpRequestCtor });
	}

	// Test-/Server-Fallback. Aktuelle Browser nehmen den XHR-Pfad, dessen Timer bei
	// jedem übertragenen Byte-Fortschritt neu beginnt.
	if (typeof AbortController === "undefined") return fetchImpl(url, init);
	const controller = new AbortController(), upstream = init.signal;
	const abort = () => controller.abort(upstream?.reason);
	if (upstream?.aborted) abort();
	else upstream?.addEventListener?.("abort", abort, { once: true });
	const timer = setTimeout(() => controller.abort(new Error("Zeitüberschreitung beim Cloudflare-Sync: keine Datenübertragung.")), stallTimeoutMs);
	try { return await fetchImpl(url, { ...init, signal: controller.signal }); }
	finally { clearTimeout(timer); upstream?.removeEventListener?.("abort", abort); }
}
