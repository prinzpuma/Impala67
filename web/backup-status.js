// Datensicherheit als EINE Aussage: Liegen alle Änderungen dieses Geräts auch außerhalb davon?
// Cloudflare-Sync und Drive-Backup merken sich jeweils, bis zu welcher lokalen Seq alles
// hochgeladen ist. Was darüber liegt und von diesem Gerät stammt, existiert nur hier.
// Die Anmeldung bei Google ist dabei nur ein Detail — entscheidend ist, wie alt das Ungesicherte ist.
import { DB } from "./db.js";
import { CLOUDFLARE_SYNC } from "./sync-cloudflare.js";
import { DRIVE } from "./drive.js";

export const BACKUP_STALE_MS = 24 * 3600e3;
// Wer bewusst ohne Sync arbeitet, wird seltener erinnert als bei einem hängenden Sync.
const SNOOZE_MS = { stale: 3 * 24 * 3600e3, local: 14 * 24 * 3600e3 };
const SNOOZE_KEY = "impala67_backup_snooze_until";
const SCAN_CHUNK = 500;

// Rein: safe = nichts Ungesichertes · pending = frisch, wird gleich mitgenommen ·
// stale = Sync eingerichtet, hängt aber hinterher · local = gar kein Sync, Daten nur hier
export function backupView({ hasChannel = false, unsafeSince = null, now = Date.now() } = {}) {
	const since = unsafeSince ? Date.parse(unsafeSince) : NaN;
	if (!Number.isFinite(since)) return { level: "safe", since: null };
	if (now - since < BACKUP_STALE_MS) return { level: "pending", since: unsafeSince };
	return { level: hasChannel ? "stale" : "local", since: unsafeSince };
}

const LS = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem() {}, removeItem() {} };
let current = { level: "safe", since: null };
let refreshing = null;

function channels() {
	const cf = CLOUDFLARE_SYNC.status?.() || {};
	const cfActive = !!(cf.url && cf.syncKey);
	const drive = DRIVE.status?.() || {};
	const driveActive = !!(drive.connected || drive.needsLogin);
	// Der Drive-Wasserstand gilt auch nach dem Abmelden: Was oben liegt, bleibt dort.
	const driveSeq = Number(LS.getItem("impala67_drive_uploaded_seq") || 0);
	return {
		cfActive, driveActive,
		protectedSeq: Math.max(cfActive ? Number(cf.lastUploadedLocalSeq) || 0 : 0, driveSeq),
	};
}

// Erstes eigenes (nicht importiertes) Event oberhalb des Wasserstands — in Häppchen,
// damit ein nie gesichertes Gerät nicht den kompletten Log laden muss.
async function firstUnsafeAt(protectedSeq) {
	const max = await DB.maxSeq();
	for (let seq = protectedSeq; seq < max; seq += SCAN_CHUNK) {
		const hit = (await DB.eventsAfterSeqAll(seq, seq + SCAN_CHUNK)).find((ev) => DB.isLocalOnly(ev, protectedSeq));
		if (hit) return hit.t || null;
	}
	return null;
}

async function compute() {
	if (!DB.isOpen()) return current;
	const ch = channels();
	const next = backupView({ hasChannel: ch.cfActive || ch.driveActive, unsafeSince: await firstUnsafeAt(ch.protectedSeq) });
	next.cloudflare = ch.cfActive;
	next.drive = ch.driveActive;
	const changed = next.level !== current.level || next.since !== current.since || next.drive !== current.drive || next.cloudflare !== current.cloudflare;
	current = next;
	if (changed && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("impala67:backup-status", { detail: current }));
	return current;
}

function refresh() {
	if (!refreshing) refreshing = compute().catch((e) => { console.warn("[backup] Status nicht ermittelbar:", e); return current; }).finally(() => { refreshing = null; });
	return refreshing;
}

// Gebündelt: Sync-Status-Events kommen in Schüben (Fortschritt, Verbinden, Fertig).
let timer = 0;
const scheduleRefresh = () => { clearTimeout(timer); timer = setTimeout(refresh, 1000); };
if (typeof window !== "undefined") {
	window.addEventListener("impala67:sync-status", scheduleRefresh);
	window.addEventListener("impala67:cloudflare-sync-status", scheduleRefresh);
	document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleRefresh(); });
	// Erster Lauf erst, wenn die Sync-Kanäle ihre Wasserstände geladen haben.
	setTimeout(refresh, 5000);
}

const snoozed = () => Number(LS.getItem(SNOOZE_KEY) || 0) > Date.now();

export const BACKUP = {
	view: () => current,
	refresh,
	// Hinweis auf der Startseite nur bei echtem Handlungsbedarf und nicht direkt nach „Später“
	homeHint: () => ((current.level === "stale" || current.level === "local") && !snoozed() ? current : null),
	snooze: () => { LS.setItem(SNOOZE_KEY, String(Date.now() + (SNOOZE_MS[current.level] || SNOOZE_MS.stale))); window.dispatchEvent(new CustomEvent("impala67:backup-status", { detail: current })); },
	// Ein bewusster Klick: Cloudflare sofort abgleichen, Drive bei Bedarf neu anmelden (Popup erlaubt).
	async backupNow() {
		const ch = channels();
		const jobs = [];
		if (ch.cfActive) jobs.push(CLOUDFLARE_SYNC.syncNow());
		if (ch.driveActive) jobs.push((DRIVE.isConnected() ? Promise.resolve() : DRIVE.renewFromUserGesture()).then(() => DRIVE.sync()));
		const results = await Promise.allSettled(jobs);
		await refresh();
		const failed = results.find((r) => r.status === "rejected");
		if (failed && current.level !== "safe" && current.level !== "pending") throw failed.reason;
		return current;
	},
};
