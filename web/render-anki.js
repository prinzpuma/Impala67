"use strict";
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

function ankiDueOf(deck) {
	const now = new Date();
	// Tageslimits aus den Stapel-Optionen gelten auch hier (wie in STATE.dueCards)
	return STATE.applyDailyLimits(ankiCardsOf(deck).filter((c) => !c.suspended && new Date(c.srs.due) <= now)
		.sort((a, b) => a.srs.due.localeCompare(b.srs.due)));
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
				'<button data-ankistudy="' + U.esc(d) + '" ' + (due ? "" : "disabled") + ">▶ Lernen</button>" +
				'<button data-ankideckfilter="' + U.esc(d) + '">🔍 Durchsuchen</button>' +
				'<button data-decksub="' + U.esc(d) + '" title="Unterstapel anlegen">＋</button>' +
			"</div></div>";
	}).join("");
	const totalDue = ankiDueOf(null).length;
	return '<div class="deck-list">' + rows + "</div>" +
		'<div class="row-btns" style="margin-top:14px;max-width:720px">' +
			'<button data-ankistudy="" ' + (totalDue ? "" : "disabled") + ">▶ Alle Stapel lernen (" + totalDue + " fällig)</button>" +
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

// Lern-Ansicht: Vorderseite → Antwort zeigen → vier Bewertungen mit Intervall-Vorschau.
function ankiStudyHtml() {
	const due = ankiDueOf(S.ankiDeck);
	const canUndo = typeof EXTRAS !== "undefined" && EXTRAS.canUndoReview();
	const head = '<div class="hint study-head">Stapel: <b>' + U.esc(S.ankiDeck || "Alle") + "</b> · noch " + due.length + " fällig " +
		'<button class="mini" data-ankiundo="1" ' + (canUndo ? "" : "disabled") + ' title="Letzte Bewertung rückgängig machen">↺ Rückgängig</button></div>';
	if (!due.length) {
		return head + '<div class="study-done"><h2>Alles wiederholt 🎉</h2>' +
			'<p class="hint">In diesem Stapel ist gerade nichts fällig.</p>' +
			'<button data-ankitab="decks">Zurück zu den Stapeln</button></div>';
	}
	const c = due[0];
	const pv = SRS.preview(c.srs);
	const stLabel = { new: "Neu", learning: "Lernen", relearning: "Neu lernen", review: "Wiederholen" }[c.srs.state] || c.srs.state;
	let html = head + '<div class="study-card">' +
		'<div class="hint study-meta">' + stLabel + " · " + (c.srs.reps || 0) + "× gelernt · " + (c.srs.lapses || 0) + " Fehler · Intervall " +
			(c.srs.state === "review" ? Math.max(1, Math.round(c.srs.stability)) + " Tage" : "—") + " · Stapel " + U.esc(c.deck || "Standard") +
			(c.leech ? ' · <span class="leech-badge" title="Leech: fällt immer wieder durch — Karte umformulieren oder aufteilen!">🐛 Leech</span>' : "") + "</div>" +
		'<div class="card-face md">' + U.md(c.front) + "</div>";
	if (S.reviewShowBack) {
		html += '<div class="card-face back md">' + U.md(c.back) + "</div>" +
			'<div class="grades">' +
				'<button data-ankigrade="1" data-card="' + c.id + '">Nochmal<span class="grade-ivl">' + pv[1] + "</span></button>" +
				'<button data-ankigrade="2" data-card="' + c.id + '">Schwer<span class="grade-ivl">' + pv[2] + "</span></button>" +
				'<button data-ankigrade="3" data-card="' + c.id + '">Gut<span class="grade-ivl">' + pv[3] + "</span></button>" +
				'<button data-ankigrade="4" data-card="' + c.id + '">Einfach<span class="grade-ivl">' + pv[4] + "</span></button>" +
			"</div>";
	} else {
		html += '<div class="modal-actions"><button data-ankishowback="1">Antwort zeigen</button></div>';
	}
	html += "</div>";
	return html;
}

// Karten-Editor (neu anlegen oder bearbeiten) — Stapel frei wählbar (neue Stapel einfach eintippen).
function openCardEditor(cardId) {
	const c = cardId ? S.cards[cardId] : null;
	const o = U.el("overlay");
	o.hidden = false;
	o.innerHTML = modal(
		"<h3>" + (c ? "Karte bearbeiten" : "Neue Karte") + "</h3>" +
		'<div><label for="cardDeck">Stapel (neuen Namen eintippen = neuer Stapel)</label>' +
		'<input id="cardDeck" list="deckList" value="' + U.esc(c ? (c.deck || "Standard") : (S.ankiDeck || "Standard")) + '">' +
		'<datalist id="deckList">' + ankiDecks().map((d) => '<option value="' + U.esc(d) + '">').join("") + "</datalist></div>" +
		'<div><label for="cardFront">Vorderseite (Markdown + LaTeX)</label><textarea id="cardFront" rows="3">' + U.esc(c ? c.front : "") + "</textarea></div>" +
		'<div><label for="cardBack">Rückseite</label><textarea id="cardBack" rows="3">' + U.esc(c ? c.back : "") + "</textarea></div>" +
		'<p class="hint">Cloze: Text in der Vorderseite markieren, „Lücke einfügen“ klicken — „Als Cloze speichern“ erzeugt pro Lücke eine eigene Karte.</p>' +
		'<div class="modal-actions"><button data-cardeditorsave="' + (c ? c.id : "new") + '">Speichern</button>' +
		'<button data-clozewrap="1" title="Auswahl in der Vorderseite in eine Cloze-Lücke verwandeln">［…］ Lücke einfügen</button>' +
		'<button data-clozesave="1" title="Pro Lücke eine Karte erzeugen">Als Cloze speichern</button>' +
		'<button id="btnCloseOverlay">Abbrechen</button></div>'
	);
}