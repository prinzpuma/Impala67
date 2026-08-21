"use strict";

import { CLOUDFLARE_SYNC } from "./sync-cloudflare.js";

export const CLOUD_COMPACT_THRESHOLD_PERCENT = 80;
export const CLOUD_COMPACT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const AUTO_DELAY_MS = 1500;
const LS_LAST_COMPACT = "impala67_cf_last_compaction_at";

let compactPromise = null;
let autoTimer = 0;

function storageOrNull() {
	try { return typeof localStorage !== "undefined" ? localStorage : null; }
	catch { return null; }
}

function readLastCompaction(storage = storageOrNull()) {
	try { return Math.max(0, Number(storage?.getItem(LS_LAST_COMPACT)) || 0); }
	catch { return 0; }
}

function writeLastCompaction(value, storage = storageOrNull()) {
	try { storage?.setItem(LS_LAST_COMPACT, String(value)); } catch { /* gesperrter Speicher */ }
}

export function shouldCompactCloud(status, lastCompactedAt = 0, now = Date.now()) {
	const percent = Number(status?.usage?.percent);
	return status?.status === "connected" && Number.isFinite(percent) &&
		percent >= CLOUD_COMPACT_THRESHOLD_PERCENT &&
		Math.max(0, Number(now) || 0) - Math.max(0, Number(lastCompactedAt) || 0) >= CLOUD_COMPACT_COOLDOWN_MS;
}

export async function compactCloudData(sync = CLOUDFLARE_SYNC, { storage = storageOrNull(), now = Date.now() } = {}) {
	if (compactPromise) return compactPromise;
	compactPromise = (async () => {
		if (!sync?.isConfigured?.()) throw new Error("Cloudflare-Sync ist nicht eingerichtet.");

		// Erst vollständig konvergieren. Danach ist der lokale Zustand die sichere
		// Quelle für den neuen kompaktierten Generation-Stand.
		await sync.syncNow();
		const before = Number(sync.status?.()?.usage?.bytes) || 0;

		// Der bestehende v4-Generation-Reset entfernt alte Eventpakete UND Blobs.
		// Der anschließende Sync startet mit Cursor 0; push() verwendet dadurch
		// DB.compactEvents(local) und syncBlobs() lädt nur noch lebende Blobs hoch.
		if (!(await sync.purgeCloudData())) throw new Error("Cloud-Compaction konnte den Generation-Reset nicht ausführen.");
		await sync.syncNow();

		const after = Number(sync.status?.()?.usage?.bytes) || 0;
		writeLastCompaction(now, storage);
		const result = { compacted: true, before, after, reclaimed: Math.max(0, before - after) };
		if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
			window.dispatchEvent(new CustomEvent("impala67:cloudflare-compacted", { detail: result }));
		}
		return result;
	})().finally(() => { compactPromise = null; });
	return compactPromise;
}

function scheduleAutoCompaction(status) {
	if (typeof navigator !== "undefined" && navigator.onLine === false) return;
	if (typeof document !== "undefined" && document.hidden) return;
	const storage = storageOrNull();
	if (!shouldCompactCloud(status, readLastCompaction(storage))) return;
	clearTimeout(autoTimer);
	autoTimer = setTimeout(() => {
		compactCloudData(CLOUDFLARE_SYNC, { storage }).catch((error) => {
			console.warn("Cloud-Compaction fehlgeschlagen:", error);
		});
	}, AUTO_DELAY_MS);
}

if (typeof window !== "undefined") {
	window.addEventListener("impala67:cloudflare-sync-status", (event) => scheduleAutoCompaction(event.detail));
}

export const SYNC_MAINTENANCE = {
	compactCloudData,
	shouldCompactCloud,
	status: () => ({
		thresholdPercent: CLOUD_COMPACT_THRESHOLD_PERCENT,
		cooldownMs: CLOUD_COMPACT_COOLDOWN_MS,
		lastCompactedAt: readLastCompaction(),
		running: !!compactPromise,
	}),
};
