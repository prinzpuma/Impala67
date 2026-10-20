// Datenbank-Seite (pg.db): Unterseiten als Liste; jede Zeile zeigt ihre Eigenschaften als
// umbrechendes Raster – passt immer in die Textbreite, kein seitliches Scrollen.
// Zell-Änderungen laufen über .db-cell als pageUpdate-Event (app.js, change-Listener).
import { STATE } from "./state.js";
import { U } from "./util.js";
import { icon, pageIcon } from "./icons.js";

const esc = U.esc;
const RO = { formula: 1, rollup: 1, created_time: 1, last_edited_time: 1, created_by: 1, last_edited_by: 1, people: 1, relation: 1, files: 1, button: 1, unique_id: 1, verification: 1 };
const PILL = { select: 1, status: 1, multi_select: 1 };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Bekannte Stufen bekommen eine sprechende Farbe, alles andere eine stabile aus dem Namen.
const TONE_BY_VALUE = {
	leicht: "green", niedrig: "green", gering: "green", erledigt: "green", fertig: "green", done: "green", zusammengefasst: "green", bestanden: "green",
	mittel: "yellow", "in arbeit": "yellow", "in bearbeitung": "yellow", "in progress": "yellow", teilweise: "yellow",
	schwer: "orange", hoch: "orange", wichtig: "orange",
	"sehr schwer": "red", "sehr hoch": "red", offen: "red", "nicht begonnen": "gray", "not started": "gray",
};
const TONES = ["blue", "purple", "pink", "green", "orange", "yellow", "red", "gray"];
function tone(v) {
	const known = TONE_BY_VALUE[v.toLowerCase()];
	if (known) return known;
	let h = 0;
	for (const ch of v) h = (h * 31 + ch.charCodeAt(0)) | 0;
	return TONES[Math.abs(h) % TONES.length];
}

const pillValues = (type, v) => (type === "multi_select" ? v.split(",") : [v]).map((s) => s.trim()).filter(Boolean);
// Mehrfachauswahl (Themen o. Ä.) bleibt neutral grau – Farbe nur dort, wo sie eine Stufe bedeutet.
const pillsHtml = (type, v) => pillValues(type, v).map((s) => `<span class="db-pill db-tone-${type === "multi_select" ? "gray" : tone(s)}">${esc(s)}</span>`).join("");

const WIDE = { multi_select: 1, text: 1, rich_text: 1, url: 1, email: 1 };
const deDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });

function showHtml(t, raw) {
	if (!raw) return '<span class="db-empty">–</span>';
	if (PILL[t]) return pillsHtml(t, raw);
	if (t === "date" && ISO_DATE.test(raw)) return esc(deDate(raw));
	return esc(raw);
}

// Ein Feld: in Ruhe die Anzeige (Chips/Text, bricht um), beim Bearbeiten das darübergelegte
// Eingabefeld (CSS :focus-within) – ein Feld, kein Extra-Zustand. <label>: Klick fokussiert.
function fieldHtml(row, col, listId) {
	const raw = String((row.props || {})[col.name] ?? "");
	const t = col.type || "text";
	// Leere Felder blendet CSS aus, bis die Karte gehovert/fokussiert wird.
	const cls = "db-prop" + (t === "multi_select" ? " db-full" : WIDE[t] ? " db-wide" : "") + (RO[t] ? " db-ro" : "") + (raw.trim() ? "" : " db-blank");
	const label = `<span class="db-label">${esc(col.name)}</span>`;
	if (RO[t]) return `<div class="${cls}">${label}<div class="db-val"><span class="db-show">${showHtml(t, raw)}</span></div></div>`;
	// Nur echte ISO-Tage als Datumsfeld; Bereiche/Freitext bleiben Text, sonst gingen sie beim Speichern verloren.
	const type = t === "date" && (!raw || ISO_DATE.test(raw)) ? ' type="date"' : t === "number" ? ' inputmode="decimal"' : "";
	return `<label class="${cls}">${label}<span class="db-val"><input class="db-cell"${type} data-dbrow="${row.id}" data-dbcol="${esc(col.name)}" value="${esc(raw)}"` +
		`${listId ? ` list="${listId}"` : ""} autocomplete="off" spellcheck="false"><span class="db-show" aria-hidden="true">${showHtml(t, raw)}</span></span></label>`;
}

// Vorschlagsliste je Auswahl-Spalte: alle bereits benutzten Werte (für Tippen/Wählen)
function datalist(id, col, rows) {
	if (col.type !== "select" && col.type !== "status") return "";
	const vals = [...new Set(rows.map((r) => String((r.props || {})[col.name] ?? "").trim()).filter(Boolean))];
	return vals.length ? `<datalist id="${id}">${vals.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>` : "";
}

export function dbViewHtml(pg) {
	const all = ((pg.db && pg.db.schema) || []).filter((c) => c.type !== "title");
	// Die erste Zahlenspalte (Nr/VL) ist die Laufnummer: kein eigenes Feld, sondern „#1“ vor dem Titel.
	const numCol = all.find((c) => c.type === "number");
	const cols = all.filter((c) => c !== numCol);
	const rows = STATE.childrenOf(pg.id, pg.workspaceId);
	const no = (r) => String((numCol && (r.props || {})[numCol.name]) ?? "").trim();
	const lists = cols.map((c, i) => datalist(`dbl-${pg.id}-${i}`, c, rows));
	const items = rows.map((r) => '<article class="db-item">' +
		`<button class="db-open" data-page="${r.id}" title="Öffnen">${no(r) ? `<span class="db-no">#${esc(no(r))}</span>` : ""}<span class="db-open-ic">${pageIcon(r, "note")}</span><span class="db-open-t">${esc(r.title || "Unbenannt")}</span></button>` +
		(cols.length ? '<div class="db-props">' + cols.map((c, i) => fieldHtml(r, c, lists[i] && `dbl-${pg.id}-${i}`)).join("") + "</div>" : "") +
		"</article>").join("");
	return '<section class="db-view" aria-label="Datenbank">' +
		`<div class="db-bar">${rows.length} ${rows.length === 1 ? "Eintrag" : "Einträge"}</div>` +
		`<div class="db-list">${items}</div>` +
		`<button class="db-add-row" data-dbnewrow="${pg.id}">${icon("plus")}Neue Zeile</button>${lists.join("")}</section>`;
}
