"use strict";

// Tagesartikel auf der Startseite: Die KI fasst deine Notizen als kurzen Artikel zusammen und
// ergänzt Hintergrund (eigener Abschnitt). Höchstens einer pro Tag; ein ungelesener bleibt stehen,
// bis er als gelesen markiert ist. Ältere Artikel bleiben als Verlauf. Nur lokal auf diesem Gerät
// (localStorage), kein Sync.
//
// Auswahl — jeden Tag anders:
//  • Ein Thema pro Tag: von den eigenen Themen (Einstellung homeArticleTopics) das am längsten nicht
//    behandelte; ohne Einstellung alle Notizen. Ein Thema ist ein Fach („Mathematik“), eine Seite
//    samt Unterseiten („Semester 3“) oder sonst ein Suchbegriff.
//  • Darin ein Schwerpunkt-Fach, das in den letzten zwei Artikeln nicht dran war, und bevorzugt
//    Notizen, die in den letzten Artikeln nicht vorkamen (neueste zuerst).
//  • Archivierte Notizen sind nie Schwerpunkt, nur kurzer Verweis (außer das Thema hat nur archivierte).
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { AI } from "./ai.js";
import { RAG } from "./rag.js";
import { BUS } from "./event-bus.js";
import { closeOverlay } from "./app-dialogs.js";
import { FACH } from "./fach.js";

const KEY = "impala67.homeArticles";
const KEEP = 30;
const RECENT = 7; // so viele frühere Artikel zählen als „kürzlich verwendet“
const ACTIVE_NOTES = 4, ARCHIVED_NOTES = 2, MIN_TEXT = 40;
const NOTE_CHARS = 1800, ARCHIVED_CHARS = 500, NOTES_TOTAL = 9000;
const esc = (s) => U.esc(s);
const DATE_FMT = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" });

// idle → waiting (Startverzögerung) → busy (KI schreibt) → idle; tried: ein Versuch pro App-Start
let phase = "idle", tried = false, error = "", activePages = () => [];

const pad = (n) => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const load = () => { const l = U.storage.getJson(KEY, []); return Array.isArray(l) ? l : []; };
const save = (list) => U.storage.setJson(KEY, list.slice(0, KEEP));
const enabled = () => (S.settings || {}).homeArticle !== false;
const refresh = () => { if (S.view === "home") BUS.emit("ui:render-main"); };
const newest = (a, b) => String(b.updated || "").localeCompare(String(a.updated || ""));

// Der Artikel für die Startseite: der neueste, solange er ungelesen oder von heute ist
function current() {
	const a = load()[0];
	return a && (!a.readAt || a.day === today()) ? a : null;
}
const due = () => { const a = load()[0]; return !a || (!!a.readAt && a.day !== today()); };

// Eigenes Thema: das am längsten nicht mehr behandelte (nie behandelte zuerst, in Eingabereihenfolge)
function pickTopic(history) {
	const own = String((S.settings || {}).homeArticleTopics || "").split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
	if (!own.length) return null;
	const lastUse = (t) => {
		const i = history.findIndex((a) => String((a.topics || [])[0] || "").toLowerCase() === t.toLowerCase());
		return i < 0 ? Infinity : i;
	};
	return own.reduce((best, t) => (lastUse(t) > lastUse(best) ? t : best));
}

const asSubject = (topic) => FACH.KNOWN_SUBJECTS.find((s) => s.toLowerCase() === topic.toLowerCase());
function findPage(title) {
	const t = title.toLowerCase();
	// Bei gleichem Titel: aktive vor archivierter, dann die zuletzt bearbeitete
	const hits = Object.values(S.pages).filter((p) => !p.trashed && String(p.title || "").trim().toLowerCase() === t)
		.sort((a, b) => (STATE.isPageArchived(a) - STATE.isPageArchived(b)) || newest(a, b));
	return hits[0] || null;
}

// Alle Notizen, aus denen der Artikel zu einem Thema schöpfen darf
async function poolFor(topic, pages) {
	const everything = () => [...pages, ...STATE.archivedPages()];
	if (!topic) return everything();
	const subject = asSubject(topic);
	if (subject) return everything().filter((p) => FACH.page(p).name === subject);
	const root = findPage(topic);
	if (root) return [...STATE.pageSubtreeIds(root.id)].map((id) => S.pages[id]).filter((p) => p && !p.trashed);
	let hits = null;
	try { hits = await RAG.search(topic, 8); } catch { /* Stichwortsuche reicht */ }
	const ids = hits ? hits.map((h) => h.pageId) : (STATE.searchNotes(topic, { includeArchived: true }) || []).slice(0, 8).map((r) => r.page.id);
	return [...new Set(ids)].map((id) => S.pages[id]).filter((p) => p && !p.trashed);
}

// Schwerpunkt-Fach und Notizen wählen — abwechselnd zu den letzten Artikeln
function chooseNotes(pool, history) {
	const recent = history.slice(0, RECENT);
	const used = new Set(recent.flatMap((a) => (a.sources || []).map((src) => src.id)));
	const lastFocus = new Set(recent.slice(0, 2).map((a) => a.focus).filter(Boolean));
	const usable = pool.filter((p) => String(p.content || "").trim().length >= MIN_TEXT)
		.map((p) => ({ p, archived: STATE.isPageArchived(p), subject: FACH.page(p).name, used: used.has(p.id) }))
		.filter((n) => n.subject !== FACH.OVERVIEW_SUBJECT);
	const candidates = usable.some((n) => !n.archived) ? usable.filter((n) => !n.archived) : usable;
	const bySubject = new Map();
	for (const n of candidates) {
		const g = bySubject.get(n.subject) || { fresh: 0, newest: "" };
		if (!n.used) g.fresh++;
		if (String(n.p.updated || "") > g.newest) g.newest = String(n.p.updated || "");
		bySubject.set(n.subject, g);
	}
	const known = (s) => (FACH.KNOWN_SUBJECTS.includes(s) ? 1 : 0);
	const focus = [...bySubject].sort(([a, x], [b, y]) =>
		(lastFocus.has(a) - lastFocus.has(b)) || ((x.fresh ? 0 : 1) - (y.fresh ? 0 : 1)) || (known(b) - known(a)) || y.newest.localeCompare(x.newest))[0]?.[0] || null;
	const inFocus = usable.filter((n) => n.subject === focus).sort((a, b) => (a.used - b.used) || newest(a.p, b.p));
	const main = inFocus.filter((n) => !n.archived || candidates === usable).slice(0, ACTIVE_NOTES);
	const side = inFocus.filter((n) => n.archived && !main.includes(n)).slice(0, ARCHIVED_NOTES);
	return { focus, notes: [...main, ...side] };
}

async function write(pages) {
	const history = load();
	const topic = pickTopic(history);
	const { focus, notes: picked } = chooseNotes(await poolFor(topic, pages), history);
	if (!picked.length && !topic) throw new Error("Noch keine Notizen mit Inhalt — trag Themen in den Einstellungen ein.");
	let budget = NOTES_TOTAL;
	const notes = picked.map(({ p, archived }) => {
		const text = String(p.content || "").trim().slice(0, Math.min(archived ? ARCHIVED_CHARS : NOTE_CHARS, Math.max(0, budget)));
		budget -= text.length;
		return { id: p.id, title: p.title || "Ohne Titel", text, archived };
	}).filter((n) => n.text);
	const label = [topic, focus].filter((x, i, all) => x && (i === 0 || x !== all[0]) && x !== FACH.DEFAULT_SUBJECT);
	const earlier = history.slice(0, 5).map((a) => `„${a.title}“`).join(", ");
	const prompt = `Schreibe einen kurzen Artikel (250–400 Wörter) über: ${label.join(" – ") || topic || focus}.\n` +
		(notes.length
			? "Grundlage sind meine Notizen unten: Fasse ihre Kernaussagen verständlich zusammen und verknüpfe sie. " +
			"Was nicht aus den Notizen stammt (Hintergrund, Beispiele, Zusammenhänge), schreibst du in einen eigenen Abschnitt „## Hintergrund“ am Ende. " +
			"Widerspricht eine Notiz gesichertem Wissen, weise im Hintergrund kurz darauf hin. " +
			"Archivierte Notizen sind älterer Stoff: höchstens am Rand als Verweis oder Zusammenhang erwähnen, nie zum Hauptthema machen.\n"
			: "Zu diesem Thema gibt es noch keine Notizen — schreibe aus allgemeinem Wissen.\n") +
		(earlier ? `Frühere Artikel hießen ${earlier} — wähle einen anderen Schwerpunkt oder Blickwinkel.\n` : "") +
		"Format: Erste Zeile „# Überschrift“ — sie nennt das konkrete Thema (z. B. „Wechselstrom mit komplexen Zeigern“), nicht nur das Fach. " +
		"Danach Markdown-Fließtext. Keine Einleitung wie „Hier ist dein Artikel“." +
		notes.map((n) => `\n\n--- ${n.archived ? "Archivierte Notiz" : "Notiz"}: ${n.title} ---\n${n.text}`).join("");
	const raw = String(await AI.complete(prompt, "Du schreibst kurze, gut lesbare Wissensartikel auf Deutsch für Lernende. Sachlich, anschaulich, ohne Floskeln.") || "").trim();
	if (!raw) throw new Error("Die KI hat keinen Text geliefert.");
	const m = raw.match(/^\s*#\s+(.+)\n?/);
	return {
		id: U.uid(), day: today(), created: U.now(), readAt: null, topics: label.length ? label : [topic || focus], focus,
		title: m ? m[1].trim() : (notes[0] && notes[0].title) || label.join(" · "),
		body: (m ? raw.slice(m[0].length) : raw).trim(),
		sources: notes.map((n) => ({ id: n.id, title: n.title, ...(n.archived ? { archived: true } : {}) })),
	};
}

// Startet höchstens einen Versuch pro App-Start — leicht verzögert, damit der Start flüssig bleibt.
// getPages: liefert die aktiven Notizen ohne Konflikt-Kopien (render.js filtert), erst bei Bedarf.
function ensure(getPages) {
	if (getPages) activePages = getPages;
	if (tried || phase !== "idle" || !enabled() || !due()) return;
	tried = true;
	phase = "waiting";
	setTimeout(() => {
		phase = "busy"; error = ""; refresh();
		write(activePages())
			.then((a) => { if (due()) save([a, ...load()]); })
			.catch((err) => { error = (err && err.message) || "KI nicht erreichbar."; })
			.finally(() => { phase = "idle"; refresh(); });
	}, 1500);
}

function retry() {
	if (phase !== "idle") return;
	tried = false;
	ensure();
}

function markRead() {
	const list = load();
	if (!list[0] || list[0].readAt) return;
	list[0] = { ...list[0], readAt: U.now() };
	save(list);
	refresh();
}

const sourcesHtml = (a) => (a.sources || []).length
	? '<nav class="hv-article-src" aria-label="Quellen"><small>Aus deinen Notizen</small>' +
		a.sources.map((s) => `<button class="hv-pin" data-page="${esc(s.id)}">${esc(s.title)}${s.archived ? " · Archiv" : ""}</button>`).join("") + "</nav>"
	: "";
const teaser = (body) => {
	// Erster Fließtext-Absatz, ohne Überschriften, Listen und Formeln
	const para = String(body || "").split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^(#|[-*+]\s|\d+\.\s|\$\$)/.test(p)) || "";
	const t = para.replace(/\$[^$]*\$/g, "…").replace(/[*_`>#~]/g, "").replace(/\s+/g, " ").trim();
	return t.length > 180 ? t.slice(0, 179) + "…" : t;
};

// Markup für die Startseite (home-view.js setzt es nur ein)
function homeHtml() {
	if (!enabled()) return "";
	const a = current(), count = load().length;
	const hist = count > 1 ? `<button class="hv-link" data-homeaction="article-history">Verlauf (${count})</button>` : "";
	if (a && a.readAt) return `<p class="hv-article-note">Tagesartikel „${esc(a.title)}“ gelesen. <button class="hv-link" data-homeaction="article-history">Nochmal lesen</button></p>`;
	if (a) {
		return `<details class="hv-article" data-key="article:${esc(a.id)}"><summary>` +
			`<small>Tagesartikel · ${esc((a.topics || []).join(" · "))}</small><b>${esc(a.title)}</b><span>${esc(teaser(a.body))}</span><em>Weiterlesen</em></summary>` +
			`<div class="hv-article-body md">${U.md(a.body)}</div>${sourcesHtml(a)}` +
			`<footer class="hv-article-foot"><button class="hv-btn" data-homeaction="article-read">Gelesen</button>${hist}</footer></details>`;
	}
	if (phase === "busy") return '<p class="hv-article-note">Dein Tagesartikel wird geschrieben …</p>';
	if (error) return `<p class="hv-article-note">Kein Tagesartikel: ${esc(error)} <button class="hv-link" data-homeaction="article-retry">Erneut versuchen</button> ${hist}</p>`;
	return "";
}

function openHistory() {
	const o = document.getElementById("overlay");
	if (!o) return;
	const items = load().map((a, i) =>
		`<details class="hv-article-past"${i === 0 ? " open" : ""}><summary><small>${esc(DATE_FMT.format(new Date(a.created)))} · ${esc((a.topics || []).join(" · "))}</small><b>${esc(a.title)}</b></summary>` +
		`<div class="md">${U.md(a.body)}</div>${sourcesHtml(a)}</details>`).join("");
	o.innerHTML = `<div class="modal hv-article-modal"><h3>Tagesartikel</h3><div class="hv-article-list">${items || '<p class="hint">Noch keine Artikel.</p>'}</div>` +
		'<div class="modal-actions"><button id="dlgArticleClose">Schließen</button></div></div>';
	o.hidden = false;
	U.renderMath(o);
	document.getElementById("dlgArticleClose").addEventListener("click", () => closeOverlay());
	// Quellen-Klick: Das Öffnen übernimmt der globale data-page-Handler, danach Overlay schließen
	o.querySelector(".hv-article-list").addEventListener("click", (e) => { if (e.target.closest("[data-page]")) setTimeout(closeOverlay, 0); });
}

export const HOME_ARTICLE = { ensure, retry, markRead, homeHtml, openHistory };
