// Linke Seitenleiste auf-/zuklappen: ☰-Knöpfe (Tab-Leiste, Seite, Heft) und Strg/Cmd+B.
// Spalte einklappen, der Zustand bleibt über Neustarts.

export function toggleSidebar() {
	const on = document.body.classList.toggle("sidebar-collapsed");
	try { localStorage.setItem("impala67.sidebarCollapsed", on ? "1" : "0"); } catch { /* ignore */ }
}
