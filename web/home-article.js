"use strict";

// Tagesartikel auf der Startseite: Die KI fasst deine Notizen zu ausgewählten Themen als
// kurzen Artikel zusammen und ergänzt Hintergrund (eigener Abschnitt). Höchstens einer pro
// Tag; ein ungelesener bleibt stehen, bis er als gelesen markiert ist. Ältere Artikel
// bleiben als Verlauf. Nur lokal auf diesem Gerät (localStorage), kein Sync.
// Themen: Einstellung homeArticleTopics (kommagetrennt, rotieren täglich), sonst automatisch ein
// Fach (fach.js) aus den aktiven Notizen: das zuletzt bearbeitete, das nicht schon im letzten
// Artikel dran war. Archivierte Notizen sind nie Hauptthema (render.js reicht nur aktive Seiten
// herein), dürfen aber als kurzer Verweis vorkommen: nach den aktiven und mit weniger Text.
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { AI } from "./ai.js";
import { RAG } from "./rag.js";
import { BUS } from "./event-bus.js";
import { closeOverlay } from "./app-dialogs.js";
import { FACH } from "./fach.js";

const KEY = "impala67.homeArticles";
const KEEP = 30;
const PER_DAY = 2; // eigene Themen pro Artikel (automatisch: ein Fach)
const NOTE_CHARS = 1800, ARCHIVED_CHARS = 500, NOTES_TOTAL = 9000;
const esc = (s) => U.esc(s);
const DATE_FMT = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" });

let tried = false, busy = false, error = "", activePages = () => [];

const pad = (n) => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const load = () => { const l = U.storage.getJson(KEY, []); return Array.isArray(l) ? l : []; };
const save = (list) => U.storage.setJson(KEY, list.slice(0, KEEP));
const enabled = () => (S.settings || {}).homeArticle !== false;
const refresh = () => { if (S.view === "home") BUS.emit("ui:render-main"); };

// Der Artikel für die Startseite: der neueste, solange er ungelesen oder von heute ist
function current() {
	const a = load()[0];
	return a && (!a.readAt || a.day === today()) ? a : null;
}
const due = () => { const a = load()[0]; return !a || (!!a.readAt && a.day !== today()); };

// Eigene Themen rotieren täglich; ohne Einstellung ein Fach, abwechselnd zum letzten Artikel
function pickTopics(pages) {
	const own = String((S.settings || {}).homeArticleTopics || "").split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
	if (own.length) {
		const start = Math.floor(Date.now() / 864e5) % own.length;
		return [...new Set(Array.from({ length: Math.min(PER_DAY, own.length) }, (_, i) => own[(start + i) % own.length]))];
	}
	const subjects = FACH.subjectsOf(pages), last = (load()[0] || {}).topics || [];
	return [subjects.find((s) => !last.includes(s)) || subjects[0]].filter(Boolean);
}

const asSubject = (topic) => FACH.KNOWN_SUBJECTS.find((s) => s.toLowerCase() === topic.toLowerCase());

// Ein Fach als Thema: dessen neueste aktive Notizen, dazu wenige archivierte. Sonst Suche.
async function notesFor(topic, pages) {
	const subject = asSubject(topic);
	if (subject) {
		const of = (list) => list.filter((p) => FACH.page(p).name === subject).sort(U.byNewest);
		return [...of(pages).slice(0, 4), ...of(STATE.archivedPages()).slice(0, 2)].map((p) => ({ id: p.id, snippet: "" }));
	}
	let hits = null;
	try { hits = await RAG.search(topic, 6); } catch { /* Stichwortsuche reicht */ }
	const list = hits
		? hits.map((h) => ({ id: h.pageId, snippet: h.snippet }))
		: (STATE.searchNotes(topic, { includeArchived: true }) || []).slice(0, 4).map((r) => ({ id: r.page.id, snippet: r.snippet }));
	return list.filter((x) => S.pages[x.id] && !S.pages[x.id].trashed);
}

async function write(pages) {
	const topics = pickTopics(pages);
	if (!topics.length) throw new Error("Noch kein Fach erkannt — trag Themen in den Einstellungen ein.");
	const seen = new Map();
	for (const t of topics) for (const n of await notesFor(t, pages)) if (!seen.has(n.id)) seen.set(n.id, n.snippet);
	let budget = NOTES_TOTAL;
	const ranked = [...seen].map(([id, snippet]) => ({ id, snippet, archived: STATE.isPageArchived(id) }))
		.sort((a, b) => a.archived - b.archived);
	const notes = ranked.slice(0, 6).map(({ id, snippet, archived }) => {
		const pg = S.pages[id];
		const text = (String(pg.content || "").trim() || String(snippet || "")).slice(0, Math.min(archived ? ARCHIVED_CHARS : NOTE_CHARS, Math.max(0, budget)));
		budget -= text.length;
		return { id, title: pg.title || "Ohne Titel", text, archived };
	}).filter((n) => n.text);
	const prompt = `Schreibe einen kurzen Artikel (250–400 Wörter) über: ${topics.join(", ")}.\n` +
		(notes.length
			? "Grundlage sind meine Notizen unten: Fasse ihre Kernaussagen verständlich zusammen und verknüpfe sie. " +
			"Was nicht aus den Notizen stammt (Hintergrund, Beispiele, Zusammenhänge), schreibst du in einen eigenen Abschnitt „## Hintergrund“ am Ende. " +
			"Widerspricht eine Notiz gesichertem Wissen, weise im Hintergrund kurz darauf hin. " +
			"Archivierte Notizen sind älterer Stoff: höchstens am Rand als Verweis oder Zusammenhang erwähnen, nie zum Hauptthema machen.\n"
			: "Zu diesen Themen gibt es noch keine Notizen — schreibe aus allgemeinem Wissen.\n") +
		"Format: Erste Zeile „# Überschrift“, danach Markdown-Fließtext. Keine Einleitung wie „Hier ist dein Artikel“." +
		notes.map((n) => `\n\n--- ${n.archived ? "Archivierte Notiz" : "Notiz"}: ${n.title} ---\n${n.text}`).join("");
	const raw = String(await AI.complete(prompt, "Du schreibst kurze, gut lesbare Wissensartikel auf Deutsch für Lernende. Sachlich, anschaulich, ohne Floskeln.") || "").trim();
	if (!raw) throw new Error("Die KI hat keinen Text geliefert.");
	const m = raw.match(/^\s*#\s+(.+)\n?/);
	return {
		id: U.uid(), day: today(), created: U.now(), readAt: null, topics,
		title: m ? m[1].trim() : topics.join(" · "),
		body: (m ? raw.slice(m[0].length) : raw).trim(),
		sources: notes.map((n) => ({ id: n.id, title: n.title, ...(n.archived ? { archived: true } : {}) })),
	};
}

// Startet höchstens einen Versuch pro App-Start — leicht verzögert, damit der Start flüssig bleibt.
// getPages: liefert die aktiven Notizen ohne Konflikt-Kopien (render.js filtert), erst bei Bedarf.
function ensure(getPages) {
	if (getPages) activePages = getPages;
	if (tried || !enabled() || !due()) return;
	tried = true;
	setTimeout(() => {
		busy = true; error = ""; refresh();
		write(activePages())
			.then((a) => save([a, ...load()]))
			.catch((err) => { error = (err && err.message) || "KI nicht erreichbar."; })
			.finally(() => { busy = false; refresh(); });
	}, 1500);
}

function retry() { tried = false; ensure(); }

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
			`<small>Tagesartikel · ${esc((a.topics || []).join(", "))}</small><b>${esc(a.title)}</b><span>${esc(teaser(a.body))}</span><em>Weiterlesen</em></summary>` +
			`<div class="hv-article-body md">${U.md(a.body)}</div>${sourcesHtml(a)}` +
			`<footer class="hv-article-foot"><button class="hv-btn" data-homeaction="article-read">Gelesen</button>${hist}</footer></details>`;
	}
	if (busy) return '<p class="hv-article-note">Dein Tagesartikel wird geschrieben …</p>';
	if (error) return `<p class="hv-article-note">Kein Tagesartikel: ${esc(error)} <button class="hv-link" data-homeaction="article-retry">Erneut versuchen</button> ${hist}</p>`;
	return "";
}

function openHistory() {
	const o = document.getElementById("overlay");
	if (!o) return;
	const items = load().map((a, i) =>
		`<details class="hv-article-past"${i === 0 ? " open" : ""}><summary><small>${esc(DATE_FMT.format(new Date(a.created)))} · ${esc((a.topics || []).join(", "))}</small><b>${esc(a.title)}</b></summary>` +
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
