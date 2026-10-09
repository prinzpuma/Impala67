"use strict";

// web/mcp-bridge-flag.js - Ob die MCP-Live-Bridge auf diesem Gerät aktiv ist.
// Auf localhost:8000 (Dev-Server) immer an; sonst per Einstellung oder ?mcpBridge=1 / ?mcpBridge=0.
const KEY = "impala.mcpBridge";

export function isLocalDev() {
	const host = String(window.location?.hostname || "");
	return (host === "localhost" || host === "127.0.0.1") && String(window.location?.port || "") === "8000";
}

export function setMcpBridgeEnabled(on) {
	try {
		if (on) localStorage.setItem(KEY, "1");
		else localStorage.removeItem(KEY);
	} catch {}
}

export function mcpBridgeEnabled() {
	if (window.__IMPALA_ENABLE_MCP_BRIDGE === true || isLocalDev()) return true;
	try {
		const q = new URLSearchParams(window.location?.search || "").get("mcpBridge");
		if (q === "1" || q === "0") setMcpBridgeEnabled(q === "1");
		return localStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
}
