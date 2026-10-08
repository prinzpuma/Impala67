// Startseite für PC und Tablet (die Mobil-Ansicht hat ihr eigenes Home in mobile-view.js).
// Idee: Der Begrüßungssatz ist selbst die Bedienung, darunter Weitermachen + zwei Kennzahlen,
// unten die Lernanalyse (lernanalyse.js). Reines Markup aus fertigen Daten; render.js sammelt.
// Klicks laufen über die data-*-Handler in app.js. Styles: home.css.
import { U } from "./util.js";
import { ICON } from "./icons.js";
import { HEFT } from "./heft.js";
import { TELE } from "./telemetrie.js";

const esc = (s) => U.esc(s);
const DAY = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const GEAR = ICON.gear;


function when(iso) {
	const d = new Date(iso);
	if (isNaN(d)) return "";
	const min = Math.round((Date.now() - d) / 60000);
	if (min < 1) return "gerade eben";
	if (min < 60) return `vor ${min} Min.`;
	const today = new Date(); today.setHours(0, 0, 0, 0);
	const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
	if (d >= today) return `heute ${time}`;
	if (d >= today - 864e5) return `gestern ${time}`;
	if (d >= today - 6 * 864e5) return d.toLocaleDateString("de-DE", { weekday: "long" });
	return d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}

function dur(min) {
	min = Math.round(min);
	const h = Math.floor(min / 60), m = min % 60;
	return h ? `${h} h${m ? " " + m : ""}` : `${m} Min`;
}

// Sekunden pro Karte: eigene Denkzeit (Median) plus Aufdecken und Bewerten; ohne Daten 20 s
function secPerCard() {
	const think = TELE.thinkMedian ? TELE.thinkMedian() : 0;
	return think ? Math.min(60, think / 1000 + 4) : 20;
}

// Erste Textzeilen als Vorschau — Markdown-Zeichen weg, Leerzeilen raus, keine Titel-Dopplung
const plain = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
function excerpt(pg) {
	const lines = String(pg.content || "").split("\n")
		.map((l) => l.replace(/^\s*(#{1,6}|[-*+]|\d+\.|>|- \[[ x]\])\s*/i, "").replace(/[*_`~]|!?\[([^\]]*)\]\([^)]*\)/g, "$1").trim())
		.filter(Boolean);
	const t = plain(pg.title);
	if (lines.length && t && plain(lines[0]).includes(t)) lines.shift();
	return lines.slice(0, 7);
}

function preview(pg) {
	if (pg.kind === "heft") return `<span class="hv-prev heft"><img data-key="th:${esc(pg.id)}" data-heftthumb="${esc(pg.id)}" alt=""></span>`;
	if (pg.pdfId) return '<span class="hv-prev pdf"><span>PDF</span></span>';
	const lines = excerpt(pg);
	return `<span class="hv-prev text">${lines.length ? lines.map((l) => `<span>${esc(l)}</span>`).join("") : '<span class="hv-empty">Leere Seite</span>'}</span>`;
}

function contMeta(pg) {
	if (pg.kind === "heft") {
		const n = HEFT.pagesOf(pg.id), at = Math.min(HEFT.lastPage(pg.id), n - 1) + 1;
		return `Heft · Seite ${at}${n > 1 ? " von " + n : ""}`;
	}
	return pg.pdfId ? "PDF" : "Notiz";
}
// „Weißt du's noch?“: täglich eine andere schon gelernte Karte, nur zum Aufdecken (keine Bewertung,
// der Lernplan bleibt unberührt). Bilder/Formeln/HTML raus, Lückentext wird zur Lücke.
const CLOZE = /\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g;
function cardText(md) {
	return String(md || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<[^>]+>/g, " ").replace(/\$\$?[^$]*\$\$?/g, "…")
		.replace(/[*_`#>~]/g, "").replace(/\s+/g, " ").trim();
}
function recall(cards) {
	const pool = cards.filter((c) => c && !c.suspended && c.srs && c.srs.state === "review" && cardText(c.front).length >= 3);
	if (pool.length < 5) return "";
	const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5);
	const c = pool[(day * 2654435761 >>> 0) % pool.length];
	const cloze = CLOZE.test(c.front); CLOZE.lastIndex = 0;
	const q = cloze ? cardText(c.front.replace(CLOZE, "＿＿＿")) : cardText(c.front);
	const a = cloze ? [...c.front.matchAll(CLOZE)].map((m) => cardText(m[1])).join(" · ") : cardText(c.back);
	if (!a) return "";
	const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
	return `<details class="hv-recall" data-key="recall:${esc(c.id)}"><summary><small>Weißt du's noch?</small><span>${esc(cut(q, 140))}</span><em>Antwort zeigen</em></summary><p>${esc(cut(a, 220))}</p></details>`;
}

function title(pg) { return (pg.icon ? `<span class="hv-ico">${esc(pg.icon)}</span>` : "") + esc(pg.title || "Ohne Titel"); }

export function homeViewHtml({ greeting, name, dateLine, conflictCount, last, favPages, study, cards: allCards, todaySeconds, week, goalMin, streak, analysisHtml }) {
	const hasCards = allCards.length > 0;
	const open = study.neu + study.review + study.learn;
	const estMin = Math.max(1, Math.round(open * secPerCard() / 60));
	const todayMin = Math.round((todaySeconds || 0) / 60);
	// Ein Satz, was heute zählt: Streak in Gefahr > Ziel in Reichweite > Ziel geschafft > heutige Zeit
	const weekMin = week.reduce((s, x) => s + x.seconds, 0) / 60;
	const left = goalMin - weekMin;
	const nudge = streak && !todayMin && new Date().getHours() >= 14 ? ` Dein Streak von ${streak} ${streak === 1 ? "Tag" : "Tagen"} wartet noch auf heute.`
		: left > 0 && left <= 60 ? ` Nur noch ${dur(left)} bis zum Wochenziel.`
			: left <= 0 && weekMin > 0 ? " Das Wochenziel hast du schon geschafft."
				: todayMin ? ` Heute schon ${dur(todayMin)} gelernt.` : "";
	const hello = `<span class="hv-hello">${greeting}${name ? ", " + esc(name) : ""}.</span>`;
	const fresh = !last && !hasCards;
	const sum = fresh
		? "Leg deine erste Seite an. Sobald du lernst, füllt sich diese Seite."
		: (open
			? `<button class="hv-link" data-homeaction="cards">${open} ${open === 1 ? "Karte" : "Karten"}</button> ${open === 1 ? "wartet" : "warten"}, etwa ${estMin} ${estMin === 1 ? "Minute" : "Minuten"}.`
			: hasCards ? "Für heute ist alles gelernt." : "Noch keine Karteikarten angelegt.") +
		nudge;

	const head = '<header class="hv-top">' +
		`<span class="hv-date">${esc(dateLine)}</span>` +
		'<span class="hv-tools">' +
		'<button class="hv-btn" data-homeaction="newpage">+ Neue Seite</button>' +
		`<button class="hv-ghost" data-set="home" aria-label="Startseite anpassen" title="Startseite anpassen">${GEAR}</button>` +
		"</span></header>";

	const alert = conflictCount
		? `<p class="hv-alert"><span>${conflictCount} ${conflictCount === 1 ? "Seite wurde" : "Seiten wurden"} auf zwei Geräten verschieden geändert.</span><button data-conflictopen="0">Ansehen</button></p>`
		: "";

	const cont = last
		? `<button class="hv-continue" data-page="${esc(last.id)}">${preview(last)}` +
			`<span class="hv-cont-copy"><small>Weitermachen</small><b>${title(last)}</b><span>${contMeta(last)} · ${esc(when(last.updated))}</span></span></button>`
		: '<button class="hv-continue empty" data-homeaction="newpage"><span class="hv-prev text"><span class="hv-empty">+</span></span><span class="hv-cont-copy"><small>Noch keine Seiten</small><b>Erste Seite anlegen</b></span></button>';

	const pins = favPages.length
		? '<nav class="hv-pins" aria-label="Angeheftet">' + favPages.slice(0, 6).map((pg) => `<button class="hv-pin" data-page="${esc(pg.id)}">${title(pg)}</button>`).join("") + "</nav>"
		: "";

	const todayIdx = (new Date().getDay() + 6) % 7;
	const scale = Math.max(goalMin / 7, ...week.map((x) => x.seconds / 60), 1);
	const bars = week.map((x, i) => {
		const min = x.seconds / 60;
		const h = min >= 1 ? Math.max(12, Math.round(min / scale * 100)) : 0;
		return `<span class="hv-day${i === todayIdx ? " today" : ""}${i > todayIdx ? " later" : ""}" title="${DAY[i]}: ${min >= 1 ? dur(min) : "nichts"} gelernt"><span class="hv-bar"><i style="height:${h}%"></i></span>${DAY[i]}</span>`;
	}).join("");
	const pctGoal = Math.min(100, Math.round(weekMin / goalMin * 100));
	const CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

	const cards = open
		? `<button class="hv-stat hv-cards due" data-homeaction="cards"><small>Heute fällig</small><b>${open} ${open === 1 ? "Karte" : "Karten"}</b><span>etwa ${estMin} Min · Lernen starten</span></button>`
		: hasCards
			? `<button class="hv-stat hv-cards done" data-homeaction="cards"><small>Heute fällig</small><b>${CHECK} Alles gelernt</b><span>Morgen geht's weiter</span></button>`
			: '<button class="hv-stat hv-cards" data-homeaction="cards"><small>Heute fällig</small><b>Keine Karten</b><span>Karten anlegen</span></button>';
	const weekCard = `<div class="hv-stat hv-week${pctGoal >= 100 ? " reached" : ""}">` +
		`<small>Diese Woche gelernt</small>` +
		`<b>${dur(weekMin)} <span>${pctGoal >= 100 ? "· Ziel geschafft" : "von " + dur(goalMin)}</span></b>` +
		`<span class="hv-goalbar" role="progressbar" aria-valuenow="${pctGoal}" aria-valuemin="0" aria-valuemax="100" aria-label="Wochenziel"><i style="width:${pctGoal}%"></i></span>` +
		`<span class="hv-bars">${bars}</span>` +
		`<span class="hv-week-foot"><span>${streak ? `${streak} ${streak === 1 ? "Tag" : "Tage"} am Stück` : "Heute lernen startet einen Streak"}</span>` +
		'<button data-lz-goal="1" title="Wochenziel umschalten">Ziel ändern</button></span></div>';

	return '<div class="home hv" data-key="home"><div class="hv-page">' +
		head + alert + `<p class="hv-lead">${hello} ${sum}</p>` +
		`<div class="hv-grid"><div class="hv-main">${cont}${pins}${recall(allCards)}</div><div class="hv-stats">${cards}${weekCard}</div></div>` +
		analysisHtml +
		"</div></div>";
}

// Nach dem Rendern: echte Heft-Vorschau der zuletzt angesehenen Seite nachladen (HEFT cached)
export function hydrateHome(root) {
	for (const img of root.querySelectorAll("img[data-heftthumb]")) {
		const id = img.dataset.heftthumb;
		HEFT.thumbnail(id, HEFT.lastPage(id), 480).then((url) => url || HEFT.thumbnail(id, 0, 480)).then((url) => {
			if (!url || img.getAttribute("src") === url) return;
			img.src = url;
			img.dataset.hydrated = "1";
		}).catch(() => {});
	}
}
