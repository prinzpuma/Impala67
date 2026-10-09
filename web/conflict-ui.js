// Sync-Konflikt-Dialog: reine Darstellung. Die Funktionen bekommen Daten übergeben und liefern
// nur HTML-Strings zurück. Kein DOM-Zugriff, kein Zugriff auf Seiten oder Speicher.
// Zustand, Aktionen und Events bleiben in render.js.
import { U } from "./util.js";

const esc = (s) => U.esc(s);

const DATETIME_OPTS = { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" };
export function fmtConflictTime(iso) {
	if (!iso) return "unbekannt";
	try { return new Date(iso).toLocaleString("de-DE", DATETIME_OPTS); } catch { return String(iso); }
}

const KIND_LABEL = { both: "Beide geändert", delete: "Gelöscht vs. geändert" };
const KIND_EXPLAIN = {
	both: "Auf diesem Gerät und auf Drive wurde die Seite unterschiedlich geändert.",
	delete: "Auf einem Gerät wurde die Seite gelöscht, auf dem anderen geändert oder verschoben.",
};
const HERE = "Dieses Gerät";
const OTHER = "Anderes Gerät / Drive";

export const conflictKind = (c) => (c.legacy ? "legacy" : c.conflictType === "delete-change" ? "delete" : "both");
const COPY_PREFIX = /^(⚠ Konflikt( \(gelöscht\/verschoben\))?:\s*)+/;
export const conflictTitle = (c) => String(c.title || "").replace(COPY_PREFIX, "").replace(/ — Stand .*$/, "") || "Seite";

// ---- Gerettete Alt-Kopien ------------------------------------------------------------
// Von früheren Kollisionen ist nur die Kopie übrig. Verglichen wird sie mit der heutigen Seite
// gleichen Titels: Steht alles schon dort, kann sie gefahrlos weg.
const textLines = (text) => String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
export function legacyCopyInfo(copy, pages) {
	const title = conflictTitle(copy);
	const nested = /^(⚠ Konflikt[^:]*:\s*){2,}/.test(String(copy.title || ""));
	const copyLines = textLines(copy.content);
	const others = pages.filter((p) => p.id !== copy.id && !String(p.title || "").startsWith("⚠ Konflikt"))
		.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
	const missingIn = (p) => { const have = new Set(textLines(p.content)); return copyLines.filter((l) => !have.has(l)).length; };
	const same = others.filter((p) => p.title === title);
	// Umbenannte Seite: ohne Titel-Treffer zählt eine Seite, die den ganzen Text der Kopie schon enthält.
	const original = same.find((p) => (p.parentId || null) === (copy.parentId || null)) || same[0] ||
		(copyLines.length ? others.find((p) => missingIn(p) === 0) : null) || null;
	const extraLines = original ? missingIn(original) : null;
	return { title, nested, original, extraLines };
}
// Kann die Kopie weg, ohne dass etwas verloren geht?
const legacySafe = (c) => !!(c.nested || (c.pageId && c.extraLines === 0));
const lineCount = (n) => n + (n === 1 ? " Zeile" : " Zeilen");
function legacyLabel(c) {
	if (c.nested) return "Alte Kopie";
	if (!c.pageId) return "Original fehlt";
	return c.extraLines ? lineCount(c.extraLines) + " neu" : "Nichts Neues";
}
function legacyExplain(c) {
	if (c.nested) return "Kopie einer älteren Konfliktkopie, die schon verworfen war. Sie kann weg.";
	if (!c.pageId) return "Die ursprüngliche Seite gibt es nicht mehr (umbenannt oder gelöscht). Schau kurz rein, ob du den Text noch brauchst.";
	const page = `„${c.originalTitle || "Seite"}“`;
	if (!c.extraLines) return `Alles aus dieser Kopie steht schon in ${page}. Du verlierst nichts, wenn du sie verwirfst.`;
	return `Die Kopie enthält ${lineCount(c.extraLines)}, die in ${page} fehlen (unten grün markiert). Brauchst du sie, behalte die Kopie als eigene Seite.`;
}
export const conflictKindLabel = (c) => (conflictKind(c) === "legacy" ? legacyLabel(c) : KIND_LABEL[conflictKind(c)]);
const conflictExplain = (c) => (conflictKind(c) === "legacy" ? legacyExplain(c) : KIND_EXPLAIN[conflictKind(c)]);
export const conflictTime = (c) => c.localTime || c.changedAt || c.loserTime || null;

// Entscheidungen je Konflikt-Art. `action` ist der Wert für resolveConflict() in render.js.
// Die Empfehlung ist immer der neuere Stand (bzw. „Löschen gewinnt“ beim Löschkonflikt).
export function conflictActions(c) {
	const kind = conflictKind(c);
	if (kind === "delete") return [
		{ action: "use-loser", title: "Seite behalten (wiederherstellen)", sub: "Die Seite kommt mit dem geänderten Stand zurück." },
		{ action: "keep-winner", title: "Gelöscht lassen", sub: "Die Seite bleibt gelöscht. Der geänderte Stand landet im Papierkorb.", recommended: true, badge: "Empfohlen · Löschen gewinnt" },
	];
	if (kind === "legacy") return [
		{ action: "keep-winner", title: "Kopie verwerfen", sub: "Die Kopie landet im Papierkorb. Die Seite bleibt unverändert.", recommended: legacySafe(c), badge: "Empfohlen · nichts geht verloren" },
		{ action: "keep-both", title: "Als eigene Seite behalten", sub: "Die Kopie wird eine normale Seite mit dem Zusatz „(Kopie)“. Nichts wird gelöscht." },
	];
	const localWins = c.winner !== "remote";
	return [
		{
			action: localWins ? "keep-winner" : "use-loser", title: "Dieses Gerät behalten", recommended: localWins, badge: "Empfohlen · neuer",
			sub: localWins ? "Die Fassung von Drive kommt in den Papierkorb." : "Die Seite bekommt diesen Stand. Der Drive-Stand bleibt im Verlauf.",
		},
		{
			action: localWins ? "use-loser" : "keep-winner", title: "Anderen Stand behalten", recommended: !localWins, badge: "Empfohlen · neuer",
			sub: localWins ? "Die Seite bekommt den Drive-Stand. Der Stand von diesem Gerät bleibt im Verlauf." : "Die Fassung von diesem Gerät kommt in den Papierkorb.",
		},
		{ action: "keep-both", title: "Beide behalten", sub: "Die Konfliktkopie bleibt als eigene Seite. Nichts wird gelöscht." },
	];
}

// Aktion für „Alle … mit Empfehlung lösen“. Gerettete Alt-Kopien haben keine Empfehlung.
export const recommendedAction = (c) => conflictActions(c).find((a) => a.recommended)?.action || null;

// ---- Zeilenvergleich: erst zuschneiden, dann ausrichten -------------------------
// U.diffLines steigt oberhalb von 400 Zeilen in einen groben Modus aus. Deshalb wird vorab
// identischer Anfang und identisches Ende abgeschnitten und nur die abweichende Mitte gediffed.
const DIFF_MAX_MIDDLE = 400;
export function conflictDiff(left, right) {
	const A = String(left ?? "").split("\n"), B = String(right ?? "").split("\n");
	let pre = 0;
	while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
	let post = 0;
	while (post < A.length - pre && post < B.length - pre && A[A.length - 1 - post] === B[B.length - 1 - post]) post++;
	const midA = A.slice(pre, A.length - post), midB = B.slice(pre, B.length - post);
	if (midA.length > DIFF_MAX_MIDDLE || midB.length > DIFF_MAX_MIDDLE) return null;
	const same = (text) => ({ type: "same", text });
	const out = A.slice(0, pre).map(same);
	// Leere Seite bewusst selbst behandeln: U.diffLines("", x) erzeugt sonst eine Geister-Leerzeile.
	if (!midA.length && midB.length) out.push(...midB.map((text) => ({ type: "add", text })));
	else if (!midB.length && midA.length) out.push(...midA.map((text) => ({ type: "del", text })));
	else if (midA.length) out.push(...U.diffLines(midA.join("\n"), midB.join("\n")));
	out.push(...A.slice(A.length - post).map(same));
	return out;
}

// Beide Spalten zeilengenau ausrichten: gelöschte und hinzugefügte Zeilen eines Blocks bilden
// Paare, die kürzere Seite bekommt Leerzeilen. Lange unveränderte Strecken werden eingeklappt.
const COLLAPSE_AFTER = 8, COLLAPSE_KEEP = 3;
export function alignDiffRows(diff) {
	const rows = [];
	let dels = [], adds = [];
	const flush = () => {
		const n = Math.max(dels.length, adds.length);
		for (let k = 0; k < n; k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null, changed: true, start: k === 0 });
		dels = []; adds = [];
	};
	for (const d of diff) {
		if (d.type === "del") dels.push(d.text);
		else if (d.type === "add") adds.push(d.text);
		else { flush(); rows.push({ left: d.text, right: d.text, changed: false }); }
	}
	flush();
	const out = [];
	for (let i = 0; i < rows.length; i++) {
		if (rows[i].changed) { out.push(rows[i]); continue; }
		let j = i;
		while (j < rows.length && !rows[j].changed) j++;
		const run = j - i;
		if (run <= COLLAPSE_AFTER) out.push(...rows.slice(i, j));
		else out.push(...rows.slice(i, i + COLLAPSE_KEEP), { gap: run - 2 * COLLAPSE_KEEP }, ...rows.slice(j - COLLAPSE_KEEP, j));
		i = j - 1;
	}
	return out;
}

const diffCell = (text, cls, mark) => text === null
	? '<div class="cf-line is-empty">&nbsp;</div>'
	: `<div class="cf-line${cls ? " is-" + cls : ""}"><span class="cf-line-mark">${mark}</span>${esc(text) || "&nbsp;"}</div>`;

// EINE Tabelle mit zwei Spalten: die Ausrichtung bleibt auch bei umbrechenden Zeilen erhalten.
// data-changeidx markiert den Beginn jedes Änderungsblocks (Sprungziel für „Nächste Änderung“).
export function diffTableHtml(rows, { leftTime, rightTime, leftLabel = HERE, rightLabel = OTHER } = {}) {
	let changes = 0;
	const head = `<thead><tr><th scope="col">${esc(leftLabel)}<small>${esc(fmtConflictTime(leftTime))}</small></th>` +
		`<th scope="col">${esc(rightLabel)}<small>${esc(fmtConflictTime(rightTime))}</small></th></tr></thead>`;
	const body = rows.map((r) => {
		if (r.gap) return `<tr class="cf-gap"><td colspan="2">··· ${r.gap} unveränderte Zeilen ···</td></tr>`;
		const attr = r.changed && r.start ? ` data-changeidx="${changes++}"` : "";
		return `<tr${attr}><td>${diffCell(r.left, r.changed ? "del" : "", r.changed ? "−" : "")}</td>` +
			`<td>${diffCell(r.right, r.changed ? "add" : "", r.changed ? "+" : "")}</td></tr>`;
	}).join("");
	return { html: '<table class="cf-table">' + head + "<tbody>" + body + "</tbody></table>", changes };
}

// ---- Vergleichsbereich ---------------------------------------------------------
const note = (text) => `<span class="cf-note">${esc(text)}</span>`;
const compareShell = (barHtml, bodyHtml) => `<div class="cf-compare">${barHtml ? `<div class="cf-compare-bar">${barHtml}</div>` : ""}${bodyHtml}</div>`;
const pane = (cls, label, time, text) => `<section class="cf-pane ${cls}"><header class="cf-pane-head"><b>${esc(label)}</b>` +
	`${time ? `<small>${esc(fmtConflictTime(time))}</small>` : ""}</header><pre class="cf-pane-text">${esc(text) || "(Kein Text vorhanden.)"}</pre></section>`;

// copyText = Volltext der gerretteten Konfliktkopie (aus dem Live-Zustand, von render.js übergeben).
function legacyCompareHtml(c, copyText) {
	const copy = c.loserContent ?? copyText;
	const single = () => `<div class="cf-body-single">${pane("is-single", "Gerettete Kopie", c.loserTime, copy)}</div>`;
	if (legacySafe(c)) return `<details class="cf-more"><summary>Inhalt der Kopie ansehen</summary>${compareShell("", single())}</details>`;
	if (!c.pageId) return compareShell("", single());
	const diff = conflictDiff(c.remoteContent, copy);
	if (!diff) return compareShell("", single());
	const table = diffTableHtml(alignDiffRows(diff), { leftTime: c.remoteTime, rightTime: c.loserTime, leftLabel: "Aktuelle Seite", rightLabel: "Gerettete Kopie" });
	const bar = '<span class="cf-legend"><span class="cf-key is-del">− nur in der aktuellen Seite</span><span class="cf-key is-add">+ nur in der Kopie</span></span>' +
		(table.changes ? `<button type="button" class="mini cf-next" data-conflictdiffnext="1">Nächste Änderung (${table.changes})</button>` : "");
	return compareShell(bar, `<div class="cf-scroll" id="conflictDiffScroll">${table.html}</div>`);
}

function compareHtml(c, copyText) {
	const kind = conflictKind(c);
	if (kind === "legacy") return legacyCompareHtml(c, copyText);
	if (kind === "delete") return compareShell(note("Das Löschen gewinnt beim Zusammenführen. Der geänderte Stand ist hier gerettet."),
		`<div class="cf-body-single">${pane("is-single", "Geänderter Stand", c.changedAt, copyText)}</div>`);
	const left = c.localContent || "", right = c.remoteContent || "";
	if (!left && !right) return `<div class="cf-compare cf-compare--empty">${note("Die Änderung betrifft nur den Seitenstatus, nicht den Text.")}</div>`;
	const diff = conflictDiff(left, right);
	if (!diff) return compareShell(note("Sehr große Seite: Die Fassungen unterscheiden sich auf über 400 Zeilen. Beide Volltexte stehen nebeneinander."),
		`<div class="cf-panes">${pane("is-local", HERE, c.localTime, left)}${pane("is-remote", OTHER, c.remoteTime, right)}</div>`);
	const table = diffTableHtml(alignDiffRows(diff), { leftTime: c.localTime, rightTime: c.remoteTime });
	const bar = '<span class="cf-legend"><span class="cf-key is-del">− nur auf diesem Gerät</span>' +
		'<span class="cf-key is-add">+ nur auf Drive / anderem Gerät</span></span>' +
		(table.changes ? `<button type="button" class="mini cf-next" data-conflictdiffnext="1">Nächste Änderung (${table.changes})</button>` : "");
	return compareShell(bar, `<div class="cf-scroll" id="conflictDiffScroll">${table.html}</div>`);
}

// ---- Dialog-Bausteine ------------------------------------------------------------
function listItemHtml(c, k, active) {
	return `<li><button type="button" class="cf-item" data-conflictopen="${k}" aria-current="${active ? "true" : "false"}">` +
		`<b class="cf-item-title">${esc(conflictTitle(c))}</b>` +
		`<span class="cf-item-kind">${esc(conflictKindLabel(c))}</span>` +
		`<small class="cf-item-time">${esc(fmtConflictTime(conflictTime(c)))}</small></button></li>`;
}

function actionHtml(a) {
	return `<button type="button" class="cf-action${a.recommended ? " is-rec" : ""}" data-conflictresolve="${a.action}">` +
		`<span class="cf-action-head"><b>${esc(a.title)}</b>${a.recommended ? `<span class="cf-badge">${esc(a.badge)}</span>` : ""}</span>` +
		`<span class="cf-action-sub">${esc(a.sub)}</span></button>`;
}

// Kompletter Dialog-Inhalt für Konflikt `items[i]`. copyText = Volltext der Konfliktkopie.
export function conflictDialogHtml(items, i, { copyText = "" } = {}) {
	const n = items.length, c = items[i];
	const bulkN = items.filter((x) => recommendedAction(x)).length;
	const list = `<nav class="cf-list" aria-label="Offene Konflikte"><ul>${items.map((x, k) => listItemHtml(x, k, k === i)).join("")}</ul></nav>`;
	const nav = n > 1
		? `<div class="cf-compact-nav"><button type="button" class="mini" data-conflictnav="-1" aria-label="Vorheriger Konflikt">‹</button>` +
			`<span class="cf-counter">${i + 1} / ${n}</span>` +
			`<button type="button" class="mini" data-conflictnav="1" aria-label="Nächster Konflikt">›</button></div>`
		: "";
	const bulk = bulkN >= 2 ? `<button type="button" class="cf-bulk" data-conflictbulk="1">Alle ${bulkN} Konflikte mit Empfehlung lösen</button>` : "";
	return '<div class="modal conflict-modal" role="dialog" aria-modal="true" aria-labelledby="conflictDialogTitle" tabindex="-1">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen (Esc)" aria-label="Schließen">✕</button>' +
		'<header class="cf-top"><h1 class="cf-top-title" id="conflictDialogTitle"><span class="cf-warn" aria-hidden="true">⚠</span>' +
		"Synchronisation braucht eine Entscheidung</h1>" +
		`<div class="cf-top-tools">${bulk}${nav}</div></header>` +
		`<div class="cf-body">${list}<section class="cf-detail" aria-labelledby="cfDetailTitle">` +
		`<p class="cf-kicker">Konflikt ${i + 1} von ${n} · ${esc(conflictKindLabel(c))}</p>` +
		`<h2 class="cf-title" id="cfDetailTitle">${esc(conflictTitle(c))}</h2>` +
		`<p class="cf-explain">${esc(conflictExplain(c))}</p>` +
		(c.reason ? `<details class="cf-more"><summary>Mehr dazu</summary><p>${esc(c.reason)}</p></details>` : "") +
		compareHtml(c, copyText) +
		`<div class="cf-actions" role="group" aria-label="Entscheidung">${conflictActions(c).map(actionHtml).join("")}</div>` +
		"</section></div></div>";
}
