"use strict";

// Reine Zustandsregeln fuer kontextabhaengige Settings-Aktionen. Renderer und
// Event-Handler verwenden dieselben Deskriptoren, damit Desktop, Mobile und
// Detailseiten weder Beschriftungen noch erlaubte Aktionen unterschiedlich raten.
export function driveActionState({ hasClient = false, connected = false, needsLogin = false } = {}) {
	if (!hasClient) return { action: "setup", label: "Drive einrichten" };
	if (needsLogin) return { action: "sync", label: "Drive-Anmeldung erneuern" };
	if (connected) return { action: "sync", label: "Drive synchronisieren" };
	return { action: "sync", label: "Mit Google anmelden & synchronisieren" };
}

export function cloudflareActionState({ status = "disconnected", configured = false } = {}) {
	if (status === "syncing") return { action: "sync", label: "Cloudflare synchronisiert…", disabled: true };
	if (status === "connecting") return { action: "connect", label: "Cloudflare verbindet…", disabled: true };
	if (status === "connected") return { action: "sync", label: "Cloudflare synchronisieren" };
	if (status === "error" && configured) return { action: "connect", label: "Cloudflare erneut verbinden" };
	if (configured) return { action: "connect", label: "Cloudflare verbinden & synchronisieren" };
	return { action: "setup", label: "Cloudflare einrichten" };
}

export function backupActionState({ hasBackup = false, busy = false } = {}) {
	if (busy) return { label: "Backup wird erstellt…", disabled: true };
	return { label: hasBackup ? "Backup erneut erstellen" : "Backup erstellen" };
}

export function updateActionState(mode = "check", version = "") {
	if (mode === "checking") return { mode, label: "Prüfe…", disabled: true };
	if (mode === "install") return { mode, label: version ? "Update v" + version + " installieren" : "Update installieren" };
	if (mode === "reload") return { mode, label: "App neu laden" };
	if (mode === "installing") return { mode, label: "Update wird geladen…", disabled: true };
	return { mode: "check", label: "Nach Updates suchen" };
}
