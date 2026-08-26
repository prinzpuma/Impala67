import test from "node:test";
import assert from "node:assert/strict";

import {
	isRetryableSyncError,
	requestWithStallTimeout,
	syncRetryDelayMs,
	transferBodyBytes,
} from "../web/sync-transfer.js";

class ListenerTarget {
	listeners = new Map();
	addEventListener(type, listener) {
		const list = this.listeners.get(type) || [];
		list.push(listener); this.listeners.set(type, list);
	}
	emit(type, event = {}) {
		for (const listener of this.listeners.get(type) || []) listener(event);
	}
}

function xhrClass(run) {
	return class FakeXHR extends ListenerTarget {
		upload = new ListenerTarget();
		status = 200;
		statusText = "OK";
		response = new TextEncoder().encode('{"ok":true}').buffer;
		open() {}
		setRequestHeader() {}
		getAllResponseHeaders() { return "content-type: application/json\r\n"; }
		send(body) { run(this, body); }
		abort() { this.emit("abort"); }
	};
}

test("Stillstands-Timeout läuft bei fortlaufendem Upload-Fortschritt nicht ab", async () => {
	const progress = [];
	const XHR = xhrClass((xhr) => {
		setTimeout(() => xhr.upload.emit("progress", { loaded: 1, total: 3, lengthComputable: true }), 10);
		setTimeout(() => xhr.upload.emit("progress", { loaded: 2, total: 3, lengthComputable: true }), 25);
		setTimeout(() => xhr.upload.emit("progress", { loaded: 3, total: 3, lengthComputable: true }), 40);
		setTimeout(() => xhr.emit("load"), 55);
	});
	const response = await requestWithStallTimeout("https://sync.example/api/events", { method: "POST", body: "abc" }, {
		stallTimeoutMs: 20,
		XMLHttpRequestCtor: XHR,
		onProgress: (value) => progress.push(value.loaded),
	});
	assert.equal(response.ok, true);
	assert.deepEqual(progress, [1, 2, 3]);
});

test("Stillstands-Timeout bricht nur ohne Datenbewegung ab", async () => {
	const XHR = xhrClass(() => {});
	await assert.rejects(
		requestWithStallTimeout("https://sync.example/api/events", {}, { stallTimeoutMs: 15, XMLHttpRequestCtor: XHR }),
		/keine Datenübertragung/,
	);
});

test("Retry-Regeln unterscheiden vorübergehende und endgültige Fehler", () => {
	assert.equal(isRetryableSyncError(new TypeError("Failed to fetch")), true);
	assert.equal(isRetryableSyncError(Object.assign(new Error("Server"), { status: 503 })), true);
	assert.equal(isRetryableSyncError(Object.assign(new Error("Auth"), { status: 403 })), false);
	assert.equal(syncRetryDelayMs(0), 1000);
	assert.equal(syncRetryDelayMs(99), 30000);
	assert.equal(transferBodyBytes("ä"), 2);
});
