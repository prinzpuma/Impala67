"use strict";

export const ANDROID_FULLSCREEN_KEY = "impala67AndroidFullscreen";

const defaultNavigator = () => globalThis.navigator;
const defaultDocument = () => globalThis.document;
const defaultStorage = () => globalThis.localStorage;

export function isAndroidPlatform(navigatorRef = defaultNavigator()) {
	const platform = navigatorRef?.userAgentData?.platform || "";
	return /android/i.test(platform) || /android/i.test(navigatorRef?.userAgent || "");
}

export function isAndroidFullscreenAvailable(documentRef = defaultDocument(), navigatorRef = defaultNavigator()) {
	return isAndroidPlatform(navigatorRef) &&
		documentRef?.fullscreenEnabled !== false &&
		typeof documentRef?.documentElement?.requestFullscreen === "function";
}

export function isAndroidFullscreenEnabled(storage = defaultStorage()) {
	try { return storage?.getItem(ANDROID_FULLSCREEN_KEY) === "1"; }
	catch { return false; }
}

function remember(enabled, storage) {
	try {
		if (enabled) storage?.setItem(ANDROID_FULLSCREEN_KEY, "1");
		else storage?.removeItem(ANDROID_FULLSCREEN_KEY);
	} catch { /* gesperrter Speicher: Vollbild funktioniert trotzdem für diese Sitzung */ }
}

async function enterFullscreen(documentRef) {
	if (documentRef.fullscreenElement) return true;
	await documentRef.documentElement.requestFullscreen();
	return !!documentRef.fullscreenElement;
}

export async function setAndroidFullscreenEnabled(enabled, options = {}) {
	const documentRef = options.documentRef || defaultDocument();
	const navigatorRef = options.navigatorRef || defaultNavigator();
	const storage = options.storage || defaultStorage();
	if (!isAndroidFullscreenAvailable(documentRef, navigatorRef)) return false;
	if (!enabled) {
		remember(false, storage);
		if (documentRef.fullscreenElement && typeof documentRef.exitFullscreen === "function") {
			await documentRef.exitFullscreen();
		}
		return true;
	}
	try {
		const active = await enterFullscreen(documentRef);
		if (active) remember(true, storage);
		return active;
	} catch {
		return false;
	}
}

// Browser erlauben requestFullscreen() nur innerhalb einer Nutzeraktion. Nach einem
// Neustart kann die gespeicherte Wahl deshalb erst beim ersten normalen Tippen greifen.
export function initAndroidFullscreen(options = {}) {
	const documentRef = options.documentRef || defaultDocument();
	const navigatorRef = options.navigatorRef || defaultNavigator();
	const storage = options.storage || defaultStorage();
	if (!isAndroidFullscreenAvailable(documentRef, navigatorRef) || !isAndroidFullscreenEnabled(storage)) return () => {};

	const restore = async (event) => {
		if (event?.target?.closest?.("#inpAndroidFullscreen")) return;
		try {
			if (await enterFullscreen(documentRef)) documentRef.removeEventListener("click", restore, true);
		} catch { /* ein späterer Nutzertipp darf es erneut versuchen */ }
	};
	documentRef.addEventListener("click", restore, true);
	return () => documentRef.removeEventListener("click", restore, true);
}

export const ANDROID_FULLSCREEN = {
	available: isAndroidFullscreenAvailable,
	enabled: isAndroidFullscreenEnabled,
	init: initAndroidFullscreen,
	setEnabled: setAndroidFullscreenEnabled,
};
