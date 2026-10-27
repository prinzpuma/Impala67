"use strict";

// Cloud-Kompaktierung: Wann es Zeit ist und der Ablauf selbst stehen im Rust-Kern
// (core/impala-sync); hier bleiben Zeitstempel, Timer und das Ereignis für die Anzeige.
import { CLOUDFLARE_SYNC } from "./sync-cloudflare.js";
import { CORE } from "./rust-core.js";

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

export async function compactCloudData(sync = CLOUDFLARE_SYNC, { storage = storageOrNull(), now = Date.now(), bypassCooldown = false } = {}) {
	if (compactPromise) return compactPromise;
	compactPromise = (async () => {
		if (!sync?.isConfigured?.()) throw new Error("Cloudflare-Sync ist nicht eingerichtet.");
		const { before, after, reclaimed } = await sync.compactCloud(bypassCooldown);
		writeLastCompaction(now, storage);
		const result = { compacted: true, before, after, reclaimed };
		if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
			window.dispatchEvent(new CustomEvent("impala67:cloudflare-compacted", { detail: result }));
		}
		return result;
	})().finally(() => { compactPromise = null; });
	return compactPromise;
}

async function scheduleAutoCompaction(status) {
	if (typeof navigator !== "undefined" && navigator.onLine === false) return;
	if (typeof document !== "undefined" && document.hidden) return;
	if (status?.status !== "connected" || compactPromise) return;
	const storage = storageOrNull();
	const percent = Number(status?.usage?.percent);
	if (!CORE.shouldCompactCloud(true, Number.isFinite(percent) ? percent : undefined, readLastCompaction(storage), Date.now(), false)) return;
	clearTimeout(autoTimer);
	autoTimer = setTimeout(() => {
		compactCloudData(CLOUDFLARE_SYNC, { storage }).catch((error) => {
			console.warn("Cloud-Compaction fehlgeschlagen:", error);
		});
	}, AUTO_DELAY_MS);
}

if (typeof window !== "undefined") {
	window.addEventListener("impala67:cloudflare-sync-status", (event) => {
		scheduleAutoCompaction(event.detail).catch((error) => console.warn("Cloud-Compaction-Prüfung fehlgeschlagen:", error));
	});
}

export const SYNC_MAINTENANCE = {
	compactCloudData,
	status: () => ({
		thresholdPercent: CLOUD_COMPACT_THRESHOLD_PERCENT,
		cooldownMs: CLOUD_COMPACT_COOLDOWN_MS,
		lastCompactedAt: readLastCompaction(),
		running: !!compactPromise,
	}),
};
