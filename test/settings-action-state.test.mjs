import test from "node:test";
import assert from "node:assert/strict";

import {
	backupActionState,
	cloudflareActionState,
	driveActionState,
	updateActionState,
} from "../web/settings-action-state.js";

test("Drive-Aktion trennt Einrichtung, Anmeldung und verbundenen Sync", () => {
	assert.deepEqual(driveActionState(), { action: "setup", label: "Drive einrichten" });
	assert.deepEqual(driveActionState({ hasClient: true }), { action: "sync", label: "Mit Google anmelden & synchronisieren" });
	assert.deepEqual(driveActionState({ hasClient: true, needsLogin: true }), { action: "sync", label: "Drive-Anmeldung erneuern" });
	assert.deepEqual(driveActionState({ hasClient: true, connected: true }), { action: "sync", label: "Drive synchronisieren" });
});

test("Cloudflare-Aktion bleibt ein eigener zustandsabhängiger Ablauf", () => {
	assert.deepEqual(cloudflareActionState(), { action: "setup", label: "Cloudflare einrichten" });
	assert.deepEqual(cloudflareActionState({ configured: true }), { action: "connect", label: "Cloudflare verbinden & synchronisieren" });
	assert.deepEqual(cloudflareActionState({ configured: true, status: "error" }), { action: "connect", label: "Cloudflare erneut verbinden" });
	assert.deepEqual(cloudflareActionState({ configured: true, status: "connected" }), { action: "sync", label: "Cloudflare synchronisieren" });
	assert.deepEqual(cloudflareActionState({ configured: true, status: "syncing" }), { action: "sync", label: "Cloudflare synchronisiert…", disabled: true });
});

test("Update-Aktion behält eine stabile Aktion über alle Zustände", () => {
	assert.deepEqual(updateActionState(), { mode: "check", label: "Nach Updates suchen" });
	assert.deepEqual(updateActionState("checking"), { mode: "checking", label: "Prüfe…", disabled: true });
	assert.deepEqual(updateActionState("install", "2.4.0"), { mode: "install", label: "Update v2.4.0 installieren" });
	assert.deepEqual(updateActionState("reload"), { mode: "reload", label: "App neu laden" });
	assert.deepEqual(updateActionState("installing"), { mode: "installing", label: "Update wird geladen…", disabled: true });
});

test("Backup-Aktion zeigt Erststand, Wiederholung und laufenden Export", () => {
	assert.deepEqual(backupActionState(), { label: "Backup erstellen" });
	assert.deepEqual(backupActionState({ hasBackup: true }), { label: "Backup erneut erstellen" });
	assert.deepEqual(backupActionState({ busy: true }), { label: "Backup wird erstellt…", disabled: true });
});
