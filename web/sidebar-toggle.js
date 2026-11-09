// Linke Seitenleiste auf-/zuklappen: ☰-Knöpfe (Tab-Leiste, Seite, Heft) und Strg/Cmd+B.
// Handy: Navigator-Sheet öffnen. Sonst: Spalte einklappen, der Zustand bleibt über Neustarts.
import { PLATFORM } from "./platform.js";

export function toggleSidebar() {
	if (PLATFORM.isPhone()) {
		document.body.classList.toggle("mnav-open");
		return;
	}
	const on = document.body.classList.toggle("sidebar-collapsed");
	try { localStorage.setItem("impala67.sidebarCollapsed", on ? "1" : "0"); } catch { /* ignore */ }
}
