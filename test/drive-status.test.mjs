import test from "node:test";
import assert from "node:assert/strict";
import { DRIVE_AUTH_STATE, driveAuthState, driveStatusView, isCurrentDriveAuthRequest } from "../web/drive-status.js";

test("nur eine bekannte abgelaufene Sitzung verlangt eine Anmeldung", () => {
	assert.equal(driveAuthState(), DRIVE_AUTH_STATE.DISCONNECTED);
	assert.equal(driveAuthState({ sessionKnown: true }), DRIVE_AUTH_STATE.RENEWAL_REQUIRED);
	assert.equal(driveAuthState({ tokenValid: true, sessionKnown: true }), DRIVE_AUTH_STATE.CONNECTED);
});

test("offline wird nicht als fehlende Anmeldung ausgegeben", () => {
	const status = driveStatusView({ authState: DRIVE_AUTH_STATE.RENEWAL_REQUIRED, online: false });
	assert.equal(status.label, "Offline");
	assert.equal(status.state, "waiting");
});

test("eine nie verbundene App zeigt nicht Anmeldung nötig", () => {
	const status = driveStatusView({ authState: DRIVE_AUTH_STATE.DISCONNECTED, online: true });
	assert.equal(status.label, "Nicht verbunden");
	assert.equal(status.state, "idle");
});

test("Anmeldung und erfolgreicher Sync haben eindeutige Anzeigen", () => {
	assert.equal(driveStatusView({ authState: DRIVE_AUTH_STATE.CONNECTING }).label, "Anmeldung läuft…");
	assert.equal(driveStatusView({ authState: DRIVE_AUTH_STATE.CONNECTED, syncState: "ok", label: "Synchronisiert" }).label, "Synchronisiert");
	assert.equal(driveStatusView({ authState: DRIVE_AUTH_STATE.CONNECTED, email: "test@example.com" }).detail, "Verbunden als test@example.com");
});

test("eine alte Google-Antwort darf eine neuere Anmeldung nicht überschreiben", () => {
	assert.equal(isCurrentDriveAuthRequest(4, 5), false);
	assert.equal(isCurrentDriveAuthRequest(5, 5), true);
});
