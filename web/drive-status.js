"use strict";

export const DRIVE_AUTH_STATE = Object.freeze({
	DISCONNECTED: "disconnected",
	CONNECTING: "connecting",
	CONNECTED: "connected",
	RENEWAL_REQUIRED: "renewal-required",
});

export function driveAuthState({ tokenValid = false, sessionKnown = false } = {}) {
	if (tokenValid) return DRIVE_AUTH_STATE.CONNECTED;
	return sessionKnown ? DRIVE_AUTH_STATE.RENEWAL_REQUIRED : DRIVE_AUTH_STATE.DISCONNECTED;
}

export function isCurrentDriveAuthRequest(requestGeneration, currentGeneration) {
	return requestGeneration === currentGeneration;
}

// Eine gemeinsame, sichtbare Aussage aus Anmeldung, Netzwerk und letztem Sync-Zustand.
// Dadurch können Sidebar und Einstellungen nicht mehr unabhängig voneinander raten.
export function driveStatusView({ authState, syncState = "idle", online = true, email = "", label = "", detail = "" } = {}) {
	if (authState === DRIVE_AUTH_STATE.CONNECTING) {
		return { state: "syncing", label: "Anmeldung läuft…", detail: "Google-Verbindung wird hergestellt" };
	}
	if (authState === DRIVE_AUTH_STATE.DISCONNECTED) {
		return { state: "idle", label: "Nicht verbunden", detail: "Google Drive ist nicht verbunden" };
	}
	if (!online) {
		return { state: "waiting", label: "Offline", detail: "Drive-Sync wartet auf eine Internetverbindung" };
	}
	if (authState === DRIVE_AUTH_STATE.RENEWAL_REQUIRED) {
		return { state: "error", label: "Anmeldung nötig", detail: "Google-Sitzung abgelaufen – einmal synchronisieren" };
	}
	if (syncState !== "idle") {
		return { state: syncState, label: label || "Drive-Sync", detail: detail || label || "Drive-Sync" };
	}
	return {
		state: "idle",
		label: "Verbunden",
		detail: email ? "Verbunden als " + email : "Google Drive ist verbunden",
	};
}
