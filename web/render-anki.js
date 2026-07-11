"use strict";
import { COLLAPSE } from "./collapse.js";
import { EXTRAS } from "./extras.js";
import { SRS } from "./srs.js";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";

const hydrateImages = (...args) => RENDER.hydrateImages(...args);
const localDayKey = (...args) => RENDER.localDayKey(...args);
const modal = (...args) => RENDER.modal(...args);

// render-anki.js — aus render.js ausgelagert (Datei-Split): der komplette Anki-Bereich
// (Stapel-Baum, Stapel-Liste, Karten-Browser, Statistik mit Heatmap & Retention,
// Lern-Ansicht, Karten-Editor). Lädt in index.html direkt nach render.js.

// ---------- Anki-Bereich (🃏-Tab): Stapel / Browser / Statistik / Lernen ----------
// „Standard" ist der interne Default für Karten ohne expliziten Stapel — er taucht
// nirgends in der UI auf (nicht im Baum, nicht in den Browser-Chips, nicht im Hauptbereich).
function ankiDecks() {
	const set = new Set();
	Object.keys(S.decks || {}).forEach((n) => { if (n !== "Standard") set.add(n); });
	Object.values(S.cards).forEach((c) => { const d = c.deck || ""; if (d && d !== "Standard") set.add(d); });
	// Elternstapel ergänzen: "Mathe::Analysis" erzeugt automatisch auch "Mathe"
	[...set].forEach((n) => {
		const parts = n.split("::");
		for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("::"));
	});
	return [...set].sort((a, b) => a.localeCompare(b, "de"));
}

// Karten eines Stapels INKLUSIVE aller Unterstapel ("Mathe" enthält "Mathe::Analysis")
function ankiCardsOf(deck) {
	return Object.values(S.cards).filter((c) => {
		if (!deck) return true;
		const d = c.deck || "Standard";
		return d === deck || d.startsWith(deck + "::");
	});
}

// Anki hat für die „für den Moment fertig“-Ansicht KEINEN Hintergrund-Timer und
// KEINE live tickende Sekunden-Anzeige — das war vorher selbst erfunden und
// buggy (löste alle ~1 Sekunde einen Re-Render aus, auch wenn die nächste
// Lernkarte erst in Stunden fällig war). Anki zeigt einfach eine statische
// „Congratulations“-Meldung; man kommt per erneutem Öffnen des Stapels zurück.

// Aktuell fällige Queue (Learning → Review → New) inkl. Tageslimits
function ankiDueOf(deck) {
	return STATE.studySnapshot(deck).dueNow;
}
// Study Now aktiv, solange heute noch etwas offen ist (inkl. späterer Learning-Schritte)
function ankiStudyOpen(deck) {
	const snap = STATE.studySnapshot(deck);
	return !snap.done;
}

// Stapel-Baum für die linke Spalte: Unterstapel per "::"-Namensschema (wie in Anki),
// ein-/ausklappbar wie der Seitenbaum, mit Fällig/Neu-Zählern und Aktionen je Zeile.
// „Standard" und „Alle Stapel" tauchen NICHT auf — „Standard" ist nur der interne
// Default für Karten ohne expliziten Stapel, und „Alle" ist überflüssig.
function deckTreeHtml() {
	const all = ankiDecks().filter((n) => n !== "Standard");
	const kidsOf = (parent) => all.filter((n) => {
		if (parent) return n.startsWith(parent + "::") && !n.slice(parent.length + 2).includes("::");
		return !n.includes("::");
	});
	const rowFor = (name, depth) => {
		const label = name.split("::").pop();
		const kids = kidsOf(name);
		const key = "deck:" + name;
		const collapsed = COLLAPSE.isCollapsed(key);
		const due = ankiDueOf(name).length;
		const neu = ankiCardsOf(name).filter((c) => c.srs.state === "new" && !c.suspended).length;
		const chevron = kids.length
			? '<button class="row-chevron' + (collapsed ? "" : " open") + '" data-collapse="' + U.esc(key) + '" title="Ein-/Ausklappen">▸</button>'
			: '<span class="row-chevron spacer"></span>';
		const menuOpen = S.deckMenuOpenName === name;
		const renaming = S.renamingDeck === name;
		let html = '<div class="row deck-tree-row' + (S.ankiDeck === name ? " active" : "") + '" draggable="true" data-deck="' + U.esc(name) + '" data-deckopen="' + U.esc(name) + '" style="padding-left:' + (6 + depth * 16) + 'px">' +
			chevron +
			(renaming
				? '<input class="row-rename-input" data-deckrenamename="' + U.esc(name) + '" value="' + U.esc(label) + '" autocomplete="off">'
				: '<span class="row-title">🃏 ' + U.esc(label) + "</span>") +
			(due ? '<span class="deck-badge due" title="fällig">' + due + "</span>" : "") +
			(neu ? '<span class="deck-badge" title="neu">' + neu + "</span>" : "") +
			'<button class="row-add" draggable="false" data-deckmenu="' + U.esc(name) + '" title="Weitere Optionen">⋯</button>' +
			'<button class="row-add" draggable="false" data-decksub="' + U.esc(name) + '" title="Unterstapel anlegen">+</button>' +
			(menuOpen ? deckMenuHtml(name) : "") +
			"</div>";
		if (kids.length && !collapsed) html += kids.map((k) => rowFor(k, depth + 1)).join("");
		return html;
	};
	return '<div class="ws-head"><span class="ws-name">Stapel</span>' +
		'<button class="mini" data-decknew="1" title="Neuer Stapel">+</button></div>' +
		(all.length ? kidsOf(null).map((n) => rowFor(n, 0)).join("") : '<div class="empty small">Noch keine Stapel — mit + einen anlegen</div>');
}

// Notion-artiges ⋯-Menü je Stapel (wie pageMenuHtml bei Seiten): Umbenennen, Duplizieren, Löschen.
function deckMenuHtml(name) {
	return '<div class="page-menu">' +
		'<button class="menu-item" data-deckrename="' + U.esc(name) + '">✎ Umbenennen</button>' +
		'<button class="menu-item" data-deckduplicate="' + U.esc(name) + '">📋 Duplizieren</button>' +
		'<button class="menu-item danger" data-deckdel="' + U.esc(name) + '">🗑 Löschen</button>' +
		"</div>";
}

function renderAnki(main) {
	const tab = S.ankiTab || "decks";
	const tbtn = (id, label) => '<button data-ankitab="' + id + '" class="' + (tab === id ? "active" : "") + '">' + label + "</button>";
	let html = '<div class="library anki"><div class="lib-head"><h1>🃏 ' + (S.ankiDeck ? U.esc(S.ankiDeck) : "Karteikarten") + "</h1>" +
		'<div class="mode-btns">' + tbtn("decks", "Stapel") + tbtn("browser", "Browser") + tbtn("stats", "Statistik") + "</div>" +
		'<button data-ankinewcard="1">＋ Neue Karte</button>' +
		'<button data-deckconf="' + U.esc(S.ankiDeck || "*") + '" title="Tageslimits & Leech-Verhalten (Stapel-Optionen)">⚙️ Optionen</button>' +
		'<button data-ankiimport="1" title="CSV oder Anki-Paket (.apkg) importieren">⬇ Import</button>' +
		'<button data-ankiexport="1" title="Als CSV oder Anki-Paket (.apkg) exportieren">⬆ Export</button></div>';
	if (tab === "browser") html += ankiBrowserHtml();
	else if (tab === "stats") html += ankiStatsHtml();
	else if (tab === "study") html += ankiStudyHtml();
	else html += ankiDecksHtml();
	html += "</div>";
	main.innerHTML = html;
	U.renderMath(main);
	U.highlightCode(main);
	hydrateImages(main);
}

// Stapel-Übersicht wie Ankis Deck-Liste: hierarchisch eingerückt (Unterstapel per "::"),
// Zähler inklusive Unterstapel, Lernen/Durchsuchen/Unterstapel je Zeile.
function ankiDecksHtml() {
	const rows = ankiDecks().map((d) => {
		const depth = d.split("::").length - 1;
		const label = d.split("::").pop();
		const cards = ankiCardsOf(d);
		const neu = cards.filter((c) => c.srs.state === "new" && !c.suspended).length;
		const due = ankiDueOf(d).length;
		const susp = cards.filter((c) => c.suspended).length;
		return '<div class="deck-row" style="margin-left:' + (depth * 24) + 'px">' +
			'<div class="deck-info"><span class="deck-name">' + U.esc(label) + "</span>" +
			'<span class="deck-counts"><b class="cnt-due">' + due + '</b> fällig · <b class="cnt-new">' + neu + "</b> neu · " + cards.length + " gesamt" + (susp ? " · " + susp + " ausgesetzt" : "") + "</span></div>" +
			'<div class="deck-actions">' +
				'<button data-ankistudy="' + U.esc(d) + '" ' + (ankiStudyOpen(d) ? "" : "disabled") + ">▶ Lernen</button>" +
				'<button data-ankideckfilter="' + U.esc(d) + '">🔍 Durchsuchen</button>' +
				'<button data-decksub="' + U.esc(d) + '" title="Unterstapel anlegen">＋</button>' +
			"</div></div>";
	}).join("");
	// Sichtbarkeits-Fallback: „Standard“ erscheint als Zeile, sobald dort Karten
	// liegen (z.B. Importe ohne Stapel) — vorher waren solche Karten nur über
	// „Alle Stapel lernen“ erreichbar und wirkten wie Geisterkarten.
	const stdCards = ankiCardsOf("Standard");
	let stdRow = "";
	if (stdCards.length) {
		const stdNeu = stdCards.filter((c) => c.srs.state === "new" && !c.suspended).length;
		const stdDue = ankiDueOf("Standard").length;
		stdRow = '<div class="deck-row"><div class="deck-info"><span class="deck-name">Standard <span class="hint">(ohne Stapel)</span></span>' +
			'<span class="deck-counts"><b class="cnt-due">' + stdDue + '</b> fällig · <b class="cnt-new">' + stdNeu + "</b> neu · " + stdCards.length + " gesamt</span></div>" +
			'<div class="deck-actions">' +
				'<button data-ankistudy="Standard" ' + (ankiStudyOpen("Standard") ? "" : "disabled") + ">▶ Lernen</button>" +
				'<button data-ankideckfilter="Standard">🔍 Durchsuchen</button>' +
			"</div></div>";
	}
	const totalOpen = STATE.studySnapshot(null).counts.total;
	return '<div class="deck-list">' + rows + stdRow + "</div>" +
		'<div class="row-btns" style="margin-top:14px;max-width:720px">' +
			'<button data-ankistudy="" ' + (ankiStudyOpen(null) ? "" : "disabled") + ">▶ Alle Stapel lernen (" + totalOpen + " offen)</button>" +
			'<button data-decknew="1">＋ Neuer Stapel</button></div>';
}

// Karten-Browser: Suche, Stapel-Filter-Chips, sortierbare Spalten, Zeilen-Aktionen.
function ankiBrowserHtml() {
	const q = (S.ankiSearch || "").trim().toLowerCase();
	const key = S.ankiSort || "due";
	const dir = S.ankiSortDir || 1;
	let cards = ankiCardsOf(S.ankiDeck);
	if (q) cards = cards.filter((c) => (c.front + "\n" + c.back).toLowerCase().includes(q));
	const val = (c) => {
		if (key === "front") return c.front.toLowerCase();
		if (key === "deck") return (c.deck || "Standard").toLowerCase();
		if (key === "state") return (c.suspended ? "z" : c.srs.state);
		if (key === "interval") return c.srs.stability || 0;
		if (key === "reps") return c.srs.reps || 0;
		if (key === "lapses") return c.srs.lapses || 0;
		if (key === "created") return c.created;
		return c.srs.due;
	};
	cards = cards.slice().sort((a, b) => { const va = val(a), vb = val(b); return (va < vb ? -1 : va > vb ? 1 : 0) * dir; });
	// Nur ein Fenster rendern — 2000+ Zeilen auf einmal machten den Tab spürbar zäh.
	const shown = cards.slice(0, S.ankiBrowserLimit || 200);
	const arrow = (k) => (key === k ? (dir === 1 ? " ↑" : " ↓") : "");
	const chips = '<button class="menu-chip' + (!S.ankiDeck ? " active" : "") + '" data-ankideckfilter="">Alle</button>' +
		ankiDecks().map((d) => '<button class="menu-chip' + (S.ankiDeck === d ? " active" : "") + '" data-ankideckfilter="' + U.esc(d) + '">' + U.esc(d) + "</button>").join("");
	const stateLabel = { new: "Neu", learning: "Lernen", relearning: "Neu lernen", review: "Wiederholen" };
	return '<div class="anki-toolbar"><input id="ankiSearch" placeholder="Karten durchsuchen…" autocomplete="off" value="' + U.esc(S.ankiSearch || "") + '">' +
		'<div class="menu-chips">' + chips + "</div></div>" +
		'<table class="lib-table anki-table"><thead><tr>' +
			'<th data-ankisort="front" title="Klicken zum Sortieren">Vorderseite' + arrow("front") + "</th>" +
			'<th data-ankisort="deck" title="Klicken zum Sortieren">Stapel' + arrow("deck") + "</th>" +
			'<th data-ankisort="state" title="Klicken zum Sortieren">Status' + arrow("state") + "</th>" +
			'<th data-ankisort="due" title="Klicken zum Sortieren">Fällig' + arrow("due") + "</th>" +
			'<th data-ankisort="interval" title="Klicken zum Sortieren">Intervall' + arrow("interval") + "</th>" +
			'<th data-ankisort="reps" title="Klicken zum Sortieren">Wdh.' + arrow("reps") + "</th>" +
			'<th data-ankisort="lapses" title="Klicken zum Sortieren">Fehler' + arrow("lapses") + "</th>" +
			"<th></th>" +
		"</tr></thead><tbody>" +
		shown.map((c) =>
			'<tr class="' + (c.suspended ? "suspended" : "") + '">' +
				'<td class="anki-front" data-ankiedit="' + c.id + '" title="Zum Bearbeiten klicken">' + U.esc(c.front.length > 90 ? c.front.slice(0, 90) + "…" : c.front) + "</td>" +
				"<td>" + U.esc(c.deck || "Standard") + "</td>" +
				"<td>" + (c.suspended ? "⏸ Ausgesetzt" : (stateLabel[c.srs.state] || c.srs.state)) + "</td>" +
				"<td>" + U.fmtDate(c.srs.due) + "</td>" +
				"<td>" + (c.srs.state === "new" ? "—" : Math.max(1, Math.round(c.srs.stability)) + " T") + "</td>" +
				"<td>" + (c.srs.reps || 0) + "</td>" +
				"<td>" + (c.srs.lapses || 0) + "</td>" +
				'<td class="anki-rowbtns">' +
					'<button data-ankiedit="' + c.id + '" title="Bearbeiten">✎</button>' +
					'<button data-ankisuspend="' + c.id + '" title="' + (c.suspended ? "Fortsetzen" : "Aussetzen") + '">' + (c.suspended ? "▶" : "⏸") + "</button>" +
					'<button data-ankidel="' + c.id + '" class="danger" title="Löschen">🗑</button>' +
				"</td></tr>"
		).join("") + "</tbody></table>" +
		(cards.length > shown.length ? '<div class="row-btns" style="margin-top:8px"><button data-ankimore="1">↓ ' + (cards.length - shown.length) + " weitere Karten anzeigen</button></div>" : "") +
		(!cards.length ? '<div class="empty small">Keine Karten' + (q ? " für diese Suche" : "") + "</div>" : "");
}

// Statistik-Dashboard: Kennzahlen, 30-Tage-Diagramm, 7-Tage-Prognose.
function ankiStatsHtml() {
	const cards = ankiCardsOf(S.ankiDeck);
	const now = new Date();
	const due = cards.filter((c) => !c.suspended && new Date(c.srs.due) <= now).length;
	const neu = cards.filter((c) => c.srs.state === "new").length;
	const learned = cards.filter((c) => c.srs.state === "review").length;
	const reviews = (S.reviews || []).filter((r) => !S.ankiDeck || (S.cards[r.cardId] && (S.cards[r.cardId].deck || "Standard") === S.ankiDeck));
	const graded = reviews.filter((r) => r.grade > 0);
	const retention = graded.length ? Math.round(graded.filter((r) => r.grade > 1).length / graded.length * 100) : null;
	const perDay = {};
	reviews.forEach((r) => { const k = localDayKey(r.t); perDay[k] = (perDay[k] || 0) + 1; });
	const dayKeys = [];
	for (let i = 29; i >= 0; i--) dayKeys.push(localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
	const maxN = Math.max(1, ...dayKeys.map((k) => perDay[k] || 0));
	const bars = dayKeys.map((k) => '<div class="bar-wrap" title="' + k + ": " + (perDay[k] || 0) + ' Wiederholungen"><div class="bar" style="height:' + Math.round((perDay[k] || 0) / maxN * 100) + '%"></div></div>').join("");
	const fc = [];
	for (let i = 0; i < 7; i++) {
		const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
		const d1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i + 1);
		const n = cards.filter((c) => !c.suspended && new Date(c.srs.due) >= (i === 0 ? new Date(0) : d0) && new Date(c.srs.due) < d1).length;
		fc.push({ label: i === 0 ? "Heute" : d0.toLocaleDateString("de-DE", { weekday: "short" }), n });
	}
	const fcMax = Math.max(1, ...fc.map((x) => x.n));
	const kpi = (label, value) => '<div class="kpi"><div class="kpi-num">' + value + '</div><div class="kpi-label">' + label + "</div></div>";
	return '<div class="kpi-row">' +
			kpi("Karten", cards.length) + kpi("Fällig", due) + kpi("Neu", neu) + kpi("Gelernt", learned) +
			kpi("Wiederholungen", reviews.length) + kpi("Erfolgsquote", retention === null ? "—" : retention + "%") +
		"</div>" +
		"<h3>Wiederholungen — letzte 30 Tage</h3>" +
		'<div class="bar-chart">' + bars + "</div>" +
		"<h3>Prognose — nächste 7 Tage</h3>" +
		'<div class="bar-chart forecast">' + fc.map((x) => '<div class="bar-wrap" title="' + x.label + ": " + x.n + '"><div class="bar" style="height:' + Math.round(x.n / fcMax * 100) + '%"></div><div class="bar-label">' + x.label + "</div></div>").join("") + "</div>" +
		"<h3>Aktivität — letzte 12 Monate</h3>" + heatmapHtml(reviews) +
		"<h3>Echte Retention</h3>" + retentionTableHtml(reviews);
}

// GitHub-artige Aktivitäts-Heatmap: 53 Wochen × 7 Tage, Farbstufe = Wiederholungen pro Tag.
function heatmapHtml(reviews) {
	const perDay = {};
	reviews.forEach((r) => { const k = localDayKey(r.t); perDay[k] = (perDay[k] || 0) + 1; });
	const now = new Date();
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const start = new Date(end);
	start.setDate(start.getDate() - 364 - ((end.getDay() + 6) % 7)); // auf Montag ausrichten
	let cells = "";
	for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
		const k = localDayKey(d);
		const n = perDay[k] || 0;
		const lvl = n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 30 ? 3 : 4;
		cells += '<div class="heat-cell l' + lvl + '" title="' + k + ": " + n + ' Wiederholungen"></div>';
	}
	return '<div class="heatmap">' + cells + "</div>";
}

// „Echte" Retention wie in Anki: Anteil bestandener Wiederholungen (Bewertung > 1),
// ohne Erstbewertungen neuer Karten, je Zeitraum.
function retentionTableHtml(reviews) {
	const graded = reviews.filter((r) => r.grade > 0 && !r.first);
	const cut = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString(); };
	const row = (label, list) => {
		const pass = list.filter((r) => r.grade > 1).length;
		return "<tr><td>" + label + "</td><td>" + list.length + "</td><td>" + (list.length ? Math.round(pass / list.length * 100) + " %" : "—") + "</td></tr>";
	};
	return '<table class="lib-table retention-table"><thead><tr><th>Zeitraum</th><th>Wiederholungen</th><th>Retention</th></tr></thead><tbody>' +
		row("Letzte 7 Tage", graded.filter((r) => r.t >= cut(7))) +
		row("Letzte 30 Tage", graded.filter((r) => r.t >= cut(30))) +
		row("Letzte 365 Tage", graded.filter((r) => r.t >= cut(365))) +
		row("Gesamt", graded) +
		"</tbody></table>";
}

// Lern-Ansicht — Anki-nah:
// Queue Learning→Review→New, Learn-Ahead 20 Min, Space=Antwort / bei Rückseite=Gut.
function ankiStudyHtml() {
	const snap = STATE.studySnapshot(S.ankiDeck);
	const canUndo = typeof EXTRAS !== "undefined" && EXTRAS.canUndoReview();
	const cnt = snap.counts;
	// Anki-Deck-Übersicht: New | Learning | Review
	const countsHtml =
		'<span class="study-counts" title="Neu · Lernen · Wiederholen (wie Anki)">' +
			'<b class="cnt-new">' + cnt.neu + '</b> neu · ' +
			'<b class="cnt-learn">' + cnt.learn + '</b> lernen · ' +
			'<b class="cnt-due">' + cnt.review + '</b> wdh.' +
		'</span>';
	const head = '<div class="hint study-head">Stapel: <b>' + U.esc(S.ankiDeck || "Alle") + "</b> · " + countsHtml + " " +
		'<button class="mini" data-ankiundo="1" ' + (canUndo ? "" : "disabled") + ' title="Letzte Bewertung rückgängig machen">↺ Rückgängig</button>' +
		'<span class="study-keys hint" title="Tastatur">␣ Antwort/Gut · 1–4 bewerten</span></div>';

	// Wirklich fertig für heute (keine Learning-Schritte mehr heute)
	if (snap.done) {
		return head + '<div class="study-done"><h2>Gratulation! 🎉</h2>' +
			'<p class="hint">Du hast diesen Stapel für heute fertig — keine fälligen Karten und keine offenen Lernschritte mehr.</p>' +
			'<button data-ankitab="decks">Zurück zu den Stapeln</button></div>';
	}

	// Anki: „Congratulations! You have finished this deck for now.“ — Learning-Karten
	// kommen später am Tag zurück. Anki zeigt hier eine STATISCHE Meldung ohne
	// Live-Countdown; man aktualisiert manuell (Button) oder kommt später zurück.
	if (snap.finishedForNow && snap.learnWaiting && snap.learnWaiting.length) {
		return head +
			'<div class="study-wait study-card">' +
				'<h2>Geschafft! 🎉</h2>' +
				'<p class="hint">Du hast diesen Stapel für den Moment fertig gelernt.</p>' +
				'<p class="hint">' + snap.learnWaiting.length + ' Lernkarte(n) sind später heute wieder dran.</p>' +
				'<div class="modal-actions">' +
					'<button class="primary" data-ankiwaitrefresh="1">Erneut prüfen</button>' +
					'<button data-ankitab="decks">Zur Stapelübersicht</button>' +
				'</div></div>';
	}

	const c = snap.dueNow[0];
	const pv = SRS.preview(c.srs);
	const stLabel = { new: "Neu", learning: "Lernen", relearning: "Neu lernen", review: "Wiederholen" }[c.srs.state] || c.srs.state;
	let html = head + '<div class="study-card">' +
		'<div class="hint study-meta">' + stLabel + " · " + (c.srs.reps || 0) + "× · " + (c.srs.lapses || 0) + " Fehler · " +
			(c.srs.state === "review" ? Math.max(1, Math.round(c.srs.stability)) + " T" : "Lernschritt") + " · " + U.esc(c.deck || "Standard") +
			(c.leech ? ' · <span class="leech-badge" title="Leech">🐛 Leech</span>' : "") + "</div>" +
		'<div class="card-face md">' + U.md(c.front) + "</div>";
	if (S.reviewShowBack) {
		// Anki-Look: Vorder-/Rückseite als EINE Karte mit Trennlinie statt zwei Boxen
		html += '<hr class="study-divider">' +
			'<div class="card-face back md">' + U.md(c.back) + "</div>" +
			'<div class="grades">' +
				'<button data-ankigrade="1" data-card="' + c.id + '">Nochmal<span class="grade-ivl">' + pv[1] + '</span><span class="grade-key">1</span></button>' +
				'<button data-ankigrade="2" data-card="' + c.id + '">Schwer<span class="grade-ivl">' + pv[2] + '</span><span class="grade-key">2</span></button>' +
				'<button data-ankigrade="3" data-card="' + c.id + '">Gut<span class="grade-ivl">' + pv[3] + '</span><span class="grade-key">3 / ␣</span></button>' +
				'<button data-ankigrade="4" data-card="' + c.id + '">Einfach<span class="grade-ivl">' + pv[4] + '</span><span class="grade-key">4</span></button>' +
			'</div>';
	} else {
		html += '<div class="modal-actions"><button data-ankishowback="1">Antwort zeigen <span class="grade-key">␣</span></button></div>';
	}
	html += "</div>";
	return html;
}

// Stapel-Liste für den Editor: Baum + Karten + aktuell gewählter Anki-Stapel.
// „Standard“ nur als letzter Fallback, wenn wirklich nichts existiert.
function editorDecks() {
	const set = new Set();
	const add = (n) => {
		const d = String(n || "").trim();
		if (d && d !== "Standard") set.add(d);
	};
	Object.keys(S.decks || {}).forEach(add);
	Object.values(S.cards).forEach((c) => add(c && c.deck));
	add(S.ankiDeck);
	// Elternstapel aus Hierarchie mit aufnehmen
	[...set].forEach((n) => {
		const parts = n.split("::");
		for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("::"));
	});
	const list = [...set].sort((a, b) => a.localeCompare(b, "de"));
	return list.length ? list : ["Standard"];
}

// Liest den gewählten Stapel aus Select bzw. „Neuer Stapel“-Feld.
function readCardEditorDeck() {
	const sel = U.el("cardDeck");
	const neu = U.el("cardDeckNew");
	let deck = sel ? String(sel.value || "").trim() : "";
	if (deck === "__new__") {
		const n = neu ? neu.value.trim().replace(/::/g, ":") : "";
		deck = n || S.ankiDeck || "Standard";
	}
	if (!deck) deck = S.ankiDeck || "Standard";
	return deck;
}

// Karten-Editor: echtes <select> mit aktuellen Stapeln (kein unzuverlässiges datalist),
// optionales Feld für neuen Stapel, Cloze unter „Mehr“ versteckt.
function openCardEditor(cardId) {
	const c = cardId ? S.cards[cardId] : null;
	const decks = editorDecks();
	// Vorauswahl: bestehende Karte → ihr Stapel; sonst aktiver Anki-Stapel; sonst erster Eintrag
	let current = (c && c.deck) || S.ankiDeck || decks[0] || "Standard";
	if (current === "Standard" && decks[0] && decks[0] !== "Standard") current = decks[0];
	if (current !== "Standard" && !decks.includes(current)) decks.unshift(current);

	const opts = decks.map((d) =>
		'<option value="' + U.esc(d) + '"' + (d === current ? " selected" : "") + ">" + U.esc(d) + "</option>"
	).join("");

	const o = U.el("overlay");
	o.hidden = false;
	o.innerHTML = modal(
		'<div class="card-editor">' +
		"<h3>" + (c ? "Karte bearbeiten" : "Neue Karte") + "</h3>" +
		'<label for="cardDeck">Stapel</label>' +
		'<div class="card-deck-row">' +
			'<select id="cardDeck">' + opts +
				'<option value="__new__">＋ Neuer Stapel…</option>' +
			"</select>" +
			'<input id="cardDeckNew" class="card-deck-new" placeholder="Name des neuen Stapels" autocomplete="off" hidden>' +
		"</div>" +
		'<label for="cardFront">Vorderseite</label>' +
		'<textarea id="cardFront" rows="4" placeholder="Frage…">' + U.esc(c ? c.front : "") + "</textarea>" +
		'<label for="cardBack">Rückseite</label>' +
		'<textarea id="cardBack" rows="4" placeholder="Antwort…">' + U.esc(c ? c.back : "") + "</textarea>" +
		'<details class="card-advanced"><summary>Cloze / Lückentext</summary>' +
			'<p class="hint">Text markieren → „Lücke einfügen“. „Als Cloze speichern“ erzeugt pro Lücke eine Karte.</p>' +
			'<div class="row-btns">' +
				'<button type="button" data-clozewrap="1">［…］ Lücke einfügen</button>' +
				'<button type="button" data-clozesave="1">Als Cloze speichern</button>' +
			"</div></details>" +
		'<div class="modal-actions">' +
			'<button type="button" class="primary" data-cardeditorsave="' + (c ? c.id : "new") + '">Speichern</button>' +
			'<button type="button" id="btnCloseOverlay">Abbrechen</button>' +
		"</div></div>"
	);

	const sel = U.el("cardDeck");
	const neu = U.el("cardDeckNew");
	if (sel && neu) {
		sel.addEventListener("change", () => {
			const isNew = sel.value === "__new__";
			neu.hidden = !isNew;
			if (isNew) { neu.focus(); neu.select(); }
		});
	}
	const front = U.el("cardFront");
	if (front) front.focus();
}

export const RENDER_ANKI = {
	ankiDecks,
	ankiCardsOf,
	ankiDueOf,
	ankiStudyOpen,
	deckTreeHtml,
	deckMenuHtml,
	renderAnki,
	openCardEditor,
	readCardEditorDeck
};