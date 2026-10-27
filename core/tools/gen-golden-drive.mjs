// Schreibt rules.json für `cargo test -p impala-drive` (core/impala-drive/tests/golden/) aus den
// JS-Regeln, die in der PWA bleiben (Anzeige und Timer: drive-sync-policy.js, drive-status.js,
// backup-status.js, settings-action-state.js).
//
// flows.json (ganze Durchgänge gegen eine nachgebaute Drive-API) ist der eingefrorene Stand der
// letzten JS-Fassung von drive.js: Der Ablauf läuft seitdem nur noch im Rust-Kern, sein Generator
// ist entfallen (Git-Verlauf). Alte Backups und lokale Zustände müssen weiter lesbar bleiben.
//
// jsdom stellt window/document/localStorage bereit; ein Lade-Hook ersetzt db.js und state.js
// (IndexedDB gibt es in Node nicht). Neu erzeugen: node core/tools/gen-golden-drive.mjs
process.env.TZ = "UTC";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "../impala-drive/tests/golden");

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator", "CustomEvent"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });
globalThis.setTimeout = () => 0; // backup-status.js plant beim Laden einen Lauf ein: nie auslösen

const FIXED = Date.parse("2026-10-27T14:05:00Z");
const RealDate = Date;

// db.js/state.js → Attrappen aus globalThis
const hooks = `
export async function resolve(spec, ctx, next) {
	const m = /(?:^|\\/)(db|state)\\.js$/.exec(spec);
	if (m && ctx.parentURL && ctx.parentURL.includes("/web/")) {
		const src = m[1] === "db" ? "export const DB = globalThis.__mockDB;"
			: "export const S = globalThis.__mockS; export const STATE = globalThis.__mockSTATE;";
		return { url: "data:text/javascript," + encodeURIComponent(src), shortCircuit: true };
	}
	return next(spec, ctx);
}`;
register("data:text/javascript," + encodeURIComponent(hooks));

globalThis.__mockDB = { isOpen: () => false };
globalThis.__mockS = { settings: {}, pages: {} };
globalThis.__mockSTATE = { onAfterDispatch() {} };

// ── Reine Regeln ─────────────────────────────────────────────────────────────
const policy = await import("../../web/drive-sync-policy.js");
const status = await import("../../web/drive-status.js");
const actions = await import("../../web/settings-action-state.js");
const { backupView } = await import("../../web/backup-status.js");
const minuteInputs = [undefined, null, 5, 15, 30, 60, 180, 1440, 7, "15", "abc", 0, -5, 30.5];
const rules = {
	intervals: minuteInputs.map((m) => ({ input: m === undefined ? null : m, minutes: policy.normalizeDriveSyncMinutes({ driveAutoSyncMinutes: m }), ms: policy.driveSyncIntervalMs({ driveAutoSyncMinutes: m }) })),
	afterChange: [true, false, "true", 1, null].map((v) => ({ input: v, result: policy.driveSyncAfterChange({ driveSyncAfterChange: v }) })),
	authState: [[false, false], [false, true], [true, false], [true, true]].map(([tokenValid, sessionKnown]) => ({ tokenValid, sessionKnown, result: status.driveAuthState({ tokenValid, sessionKnown }) })),
	statusView: [],
	backupView: [],
	actionState: [],
};
for (const authState of Object.values(status.DRIVE_AUTH_STATE)) {
	for (const syncState of ["idle", "syncing", "waiting", "ok", "error"]) {
		for (const online of [true, false]) {
			for (const [email, label, detail] of [["", "", ""], ["a@b.de", "Synchronisiere…", ""], ["a@b.de", "Sync fehlgeschlagen", "Drive-Fehler 500"]]) {
				rules.statusView.push({ input: { authState, syncState, online, email, label, detail }, result: status.driveStatusView({ authState, syncState, online, email, label, detail }) });
			}
		}
	}
}
for (const hasChannel of [true, false]) {
	for (const since of [null, "kaputt", new RealDate(FIXED - 3600e3).toISOString(), new RealDate(FIXED - 24 * 3600e3).toISOString(), new RealDate(FIXED - 30 * 3600e3).toISOString()]) {
		rules.backupView.push({ hasChannel, unsafeSince: since, now: FIXED, result: backupView({ hasChannel, unsafeSince: since, now: FIXED }) });
	}
}
for (const hasClient of [true, false]) for (const connected of [true, false]) for (const needsLogin of [true, false]) {
	rules.actionState.push({ hasClient, connected, needsLogin, result: actions.driveActionState({ hasClient, connected, needsLogin }) });
}
fs.writeFileSync(path.join(outDir, "rules.json"), JSON.stringify(rules, null, 1) + "\n");
console.log("rules.json geschrieben");
process.exit(0);
