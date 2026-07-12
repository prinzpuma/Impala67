"use strict";

import { S, STATE } from "./state.js";

// ---------- Ein-/Ausklapp-Zustand (Sidebar-Baum), geräteübergreifend ----------
// Seiten sind standardmäßig EINGEKLAPPT; Workspaces dagegen AUSGEKLAPPT.
// treeOpen enthält daher offene Seiten und (nur bei explizitem Schließen) den
// Wert false für Workspaces. Die Änderungen gehen durch Event-Log und Drive-Sync.
export const COLLAPSE = (() => {
	const isWorkspace = (key) => String(key).startsWith("ws:");
	const isCollapsed = (key) => isWorkspace(key) ? S.treeOpen[key] === false : !S.treeOpen[key];
	async function toggle(key) {
		if (!key) return;
		await STATE.dispatch("uiTreeSet", { key, open: isCollapsed(key) });
	}
	return { isCollapsed, toggle };
})();