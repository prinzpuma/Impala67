// Zentrale Icons: alle Symbole liegen einmal in icons.svg (Sprite) und werden hier per <use>
// referenziert. Der Browser lädt die Datei nur einmal (Service-Worker-Cache), Farbe und
// Strichstärke kommen per CSS (.i in styles.css). Keine Inline-SVGs oder Emojis als UI-Icons.
const SPRITE = "icons.svg";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// icon("trash") → SVG-String. cls: zusätzliche Klassen; size: feste Pixelgröße (sonst 1em).
export function icon(name, cls = "", size = 0) {
	const dim = size ? ' width="' + size + '" height="' + size + '"' : "";
	return '<svg class="i' + (cls ? " " + cls : "") + '"' + dim + ' aria-hidden="true" focusable="false"><use href="' + SPRITE + "#" + name + '"/></svg>';
}

// Seiten-Icon: ein selbst gewähltes Emoji bleibt Inhalt des Nutzers. Die früher automatisch
// vergebenen Standard-Emojis (Heft, PDF, Notiz, Daily Note) werden als SVG gezeigt.
const DEFAULT_PAGE_EMOJI = { "📓": "notebook", "📄": "file", "📝": "note", "📅": "calendar" };
export function pageIcon(pg, fallback = "note", cls = "") {
	const own = pg && pg.icon;
	if (own && !DEFAULT_PAGE_EMOJI[own]) return '<span class="page-emoji' + (cls ? " " + cls : "") + '">' + esc(own) + "</span>";
	const name = DEFAULT_PAGE_EMOJI[own] || (pg && pg.kind === "heft" ? "notebook" : pg && pg.pdfId ? "file" : pg && (pg.daily || pg.dailyRoot) ? "calendar" : fallback);
	return name ? icon(name, cls) : "";
}

// Icon vor einem Text (Knopf, Menüeintrag, Überschrift): mit festem Abstand nach rechts.
export const lead = (name) => icon(name, "i-lead");
