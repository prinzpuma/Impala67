"use strict";

import { S, STATE } from "./state.js";

// ---------- Ein-/Ausklapp-Zustand (Sidebar-Baum), geräteübergreifend ----------
// Standard ist bewusst EINGEKLAPPT: Nur explizit geöffnete Knoten stehen in
// S.treeOpen. Die Änderungen sind Event-Log-Ereignisse und gehen damit durch
// Export, Import und Drive-Sync; localStorage wäre nur gerätelokal.
export const COLLAPSE = (() => {
	const isCollapsed = (key) => !S.treeOpen[key];
	async function toggle(key) {
		if (!key) return;
		await STATE.dispatch("uiTreeSet", { key, open: isCollapsed(key) });
	}
	return { isCollapsed, toggle };
})();