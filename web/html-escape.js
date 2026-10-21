"use strict";

// EIN HTML-Escape für Text in Markup und Attributen (util.js U.esc, icons.js). Heißeste
// Funktion der UI – jede Zeile, jeder Titel: Strings ohne Sonderzeichen kommen unverändert
// zurück, die Ersetzungstabelle wird nur einmal angelegt.
const SPECIAL = /[&<>"']/;
const SPECIAL_ALL = /[&<>"']/g;
const ENTITY = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
	const s = String(value ?? "");
	return SPECIAL.test(s) ? s.replace(SPECIAL_ALL, (c) => ENTITY[c]) : s;
}
