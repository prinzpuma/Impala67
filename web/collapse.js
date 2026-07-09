"use strict";

// ---------- Ein-/Ausklapp-Zustand (Sidebar-Baum), überlebt einen Neustart ----------
export const COLLAPSE = (() => {
	let set = new Set();
	try { set = new Set(JSON.parse(localStorage.getItem("impala67.collapsed") || localStorage.getItem("notion.collapsed") || "[]")); } catch { /* leer starten */ }
	function persist() {
		try { localStorage.setItem("impala67.collapsed", JSON.stringify([...set])); } catch (e) { console.warn(e); }
	}
	return {
		isCollapsed: (key) => set.has(key),
		toggle(key) { set.has(key) ? set.delete(key) : set.add(key); persist(); },
	};
})();