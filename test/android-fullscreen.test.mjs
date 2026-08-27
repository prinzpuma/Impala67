import test from "node:test";
import assert from "node:assert/strict";

import {
	ANDROID_FULLSCREEN_KEY,
	initAndroidFullscreen,
	isAndroidFullscreenAvailable,
	isAndroidFullscreenEnabled,
	isAndroidPlatform,
	setAndroidFullscreenEnabled,
} from "../web/android-fullscreen.js";

function memoryStorage(initial = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, String(value)),
		removeItem: (key) => values.delete(key),
	};
}

function fakeDocument() {
	const listeners = new Map();
	const documentRef = {
		fullscreenEnabled: true,
		fullscreenElement: null,
		documentElement: {
			async requestFullscreen() { documentRef.fullscreenElement = documentRef.documentElement; },
		},
		async exitFullscreen() { documentRef.fullscreenElement = null; },
		addEventListener(type, fn) { listeners.set(type, fn); },
		removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
		listeners,
	};
	return documentRef;
}

const androidNavigator = { userAgent: "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile" };

test("Android detection excludes iPadOS and desktop platforms", () => {
	assert.equal(isAndroidPlatform(androidNavigator), true);
	assert.equal(isAndroidPlatform({ userAgent: "Mozilla/5.0 (iPad; CPU OS 27_0 like Mac OS X)" }), false);
	assert.equal(isAndroidPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }), false);
});

test("availability requires Android and the Fullscreen API", () => {
	const documentRef = fakeDocument();
	assert.equal(isAndroidFullscreenAvailable(documentRef, androidNavigator), true);
	assert.equal(isAndroidFullscreenAvailable(documentRef, { userAgent: "iPad" }), false);
	delete documentRef.documentElement.requestFullscreen;
	assert.equal(isAndroidFullscreenAvailable(documentRef, androidNavigator), false);
});

test("toggle enters, persists and exits Android fullscreen", async () => {
	const documentRef = fakeDocument();
	const storage = memoryStorage();
	assert.equal(await setAndroidFullscreenEnabled(true, { documentRef, navigatorRef: androidNavigator, storage }), true);
	assert.equal(documentRef.fullscreenElement, documentRef.documentElement);
	assert.equal(isAndroidFullscreenEnabled(storage), true);
	assert.equal(await setAndroidFullscreenEnabled(false, { documentRef, navigatorRef: androidNavigator, storage }), true);
	assert.equal(documentRef.fullscreenElement, null);
	assert.equal(storage.getItem(ANDROID_FULLSCREEN_KEY), null);
});

test("saved fullscreen is restored on the first ordinary click", async () => {
	const documentRef = fakeDocument();
	const storage = memoryStorage({ [ANDROID_FULLSCREEN_KEY]: "1" });
	initAndroidFullscreen({ documentRef, navigatorRef: androidNavigator, storage });
	assert.equal(typeof documentRef.listeners.get("click"), "function");
	await documentRef.listeners.get("click")({ target: { closest: () => null } });
	assert.equal(documentRef.fullscreenElement, documentRef.documentElement);
	assert.equal(documentRef.listeners.has("click"), false);
});
