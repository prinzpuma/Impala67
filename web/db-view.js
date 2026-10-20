// Datenbank-Seite (pg.db): Unterseiten als editierbare Tabelle.
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
const pillsHtml = (type, v) => pillValues(type, v).map((s) => `<span class="db-pill db-tone-${tone(s)}">${esc(s)}</span>`).join("");

function cellHtml(row, col, listId) {
	const raw = String((row.props || {})[col.name] ?? "");
	const v = esc(raw);
	const t = col.type || "text";
	if (RO[t]) return `<td class="db-td db-ro"><span class="db-show">${v}</span></td>`;
	const data = `data-dbrow="${row.id}" data-dbcol="${esc(col.name)}" aria-label="${esc(col.name)}"`;
	if (t === "number") return `<td class="db-td db-num"><input class="db-cell" ${data} value="${v}" inputmode="decimal" autocomplete="off"></td>`;
	// Nur echte ISO-Tage als Datumsfeld; Bereiche/Freitext bleiben Text, sonst gingen sie beim Speichern verloren.
	if (t === "date" && (!raw || ISO_DATE.test(raw))) return `<td class="db-td db-date"><input type="date" class="db-cell" ${data} value="${v}" required></td>`;
	// In Ruhe umbrechende Anzeige (Chips oder Text, nichts wird abgeschnitten), beim Bearbeiten
	// das darübergelegte Eingabefeld (CSS :focus-within) – ein Feld, kein Extra-Zustand.
	const show = PILL[t] ? pillsHtml(t, raw) : v;
	return `<td class="db-td db-fld${PILL[t] ? " db-pills" : ""}"><input class="db-cell" ${data} value="${v}"${listId ? ` list="${listId}"` : ""} autocomplete="off" spellcheck="false">` +
		`<span class="db-show" aria-hidden="true">${show}</span></td>`;
}

// Vorschlagsliste je Auswahl-Spalte: alle bereits benutzten Werte (für Tippen/Wählen)
function datalist(id, col, rows) {
	if (col.type !== "select" && col.type !== "status") return "";
	const vals = [...new Set(rows.map((r) => String((r.props || {})[col.name] ?? "").trim()).filter(Boolean))];
	return vals.length ? `<datalist id="${id}">${vals.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>` : "";
}

export function dbTableHtml(pg) {
	const cols = ((pg.db && pg.db.schema) || []).filter((c) => c.type !== "title");
	const titleCol = ((pg.db && pg.db.schema) || []).find((c) => c.type === "title");
	const rows = STATE.childrenOf(pg.id, pg.workspaceId);
	const lists = cols.map((c, i) => datalist(`dbl-${pg.id}-${i}`, c, rows));
	const head = `<tr><th class="db-th db-name">${esc(titleCol?.name || "Name")}</th>` +
		cols.map((c) => `<th class="db-th${c.type === "number" ? " db-num" : ""}" title="${esc(c.type || "text")}">${esc(c.name)}</th>`).join("") + "</tr>";
	const body = rows.map((r) => `<tr><th class="db-td db-name" scope="row"><button class="db-open" data-page="${r.id}" title="Öffnen">` +
		`<span class="db-open-ic">${pageIcon(r, "note")}</span><span class="db-open-t">${esc(r.title || "Unbenannt")}</span></button></th>` +
		cols.map((c, i) => cellHtml(r, c, lists[i] && `dbl-${pg.id}-${i}`)).join("") + "</tr>").join("");
	return '<section class="db-view" aria-label="Datenbank">' +
		`<div class="db-bar">${rows.length} ${rows.length === 1 ? "Eintrag" : "Einträge"}</div>` +
		`<div class="db-scroll"><table class="db-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>` +
		`<button class="db-add-row" data-dbnewrow="${pg.id}">${icon("plus")}Neue Zeile</button>${lists.join("")}</section>`;
}
