"use strict";

import { STATE } from "./state.js";
import { U } from "./util.js";
import { icon, lead } from "./icons.js";
import { ZS_STORE, ZS_CORE } from "./zeitstrahl-store.js";
import { openTimelineDialog, sendAi, skeletonPrompt } from "./zeitstrahl-dialogs.js";

// zeitstrahl-onboarding.js — Geführtes „Grill-Me“-Onboarding für neue Zeitstrahlen.
// 4 kurze Schritte (1 Frage pro Schritt mit anklickbaren Vorschlägen + Freitext) und
// direkter MCP-Pfad für externe Agenten mit Dateizugriff.

const esc = (s) => U.esc(String(s ?? ""));

const GOAL_CHIPS = ["Klausur sicher bestehen", "Sehr gute Note (1,x)", "Zusammenhänge verstehen", "Schnelle Wiederholung"];
const LEVEL_CHIPS = ["Komplett neu im Thema", "Vorlesung gehört", "Übungsblätter gerechnet", "Klausur-Feinschliff"];
const STYLE_CHIPS = ["Story + Praxisbeispiele", "Knapp & formelbasiert", "Visuell mit Skizzen", "Viele Rechenaufgaben"];

function topMaterials() {
	const out = [];
	function walk(parentId, depth) {
		const kids = STATE.childrenOf?.(parentId || null) || [];
		for (const pg of kids) {
			if (STATE.isPageArchived?.(pg)) continue;
			const hasSub = (STATE.childrenOf?.(pg.id) || []).some((c) => !STATE.isPageArchived?.(c));
			out.push({ id: pg.id, title: pg.title || "Ohne Titel", kind: pg.kind === "heft" ? "notebook" : hasSub ? "folder" : "note", depth });
			if (depth < 2) walk(pg.id, depth + 1);
		}
	}
	walk(null, 0);
	return out;
}

function mcpPrompt(tl) {
	const mat = (tl.brief?.material_pages || []).map((id) => {
		const p = STATE.findPage?.(id);
		return p ? `- ${p.title} (${p.id})` : `- ${id}`;
	}).join("\n");
	return [
		`Baue bitte per Impala67-MCP (impala_read_timeline, impala_edit_timeline) den KI-Zeitstrahl „${tl.title}“ (ID: ${tl.id}).`,
		tl.subject ? `Fach: ${tl.subject}` : "",
		`Aufbau: ${tl.kind === "path" ? "Lernpfad (path)" : "Geschichte mit echten Jahren (history)"}`,
		tl.exam ? `Klausurdatum: ${tl.exam}` : "",
		tl.brief?.goal ? `Lernziel: ${tl.brief.goal}` : "",
		tl.brief?.level ? `Vorwissen: ${tl.brief.level}` : "",
		tl.brief?.style ? `Stil: ${tl.brief.style}` : "",
		tl.brief?.notes ? `Absprachen: ${tl.brief.notes}` : "",
		mat ? `Verknüpfte Seiten in Impala67:\n${mat}` : "Lies passende Skripte aus meinem Projektordner oder Impala67.",
		"Lektionen als Story im Aufbau aus der impala_edit_timeline-Beschreibung (Rätsel → Prinzip → Klausur → offene Frage zur nächsten Lektion); kommt story_todo zurück, nachbessern. Nichts erfinden: alle Fakten, Jahre und Formeln nur aus meinem Material oder Wikipedia, belegt in sources; Unbelegtes weglassen. Kein Klausurdatum raten.",
		"Stelle mir gerne noch 1–2 gezielte Rückfragen (Grill-Me), bevor du das Gerüst mit impala_edit_timeline anlegst.",
	].filter(Boolean).join("\n");
}

function chipsHtml(name, list, current) {
	return `<div class="zs-chip-grid">${list.map((c) =>
		`<button type="button" class="zs-pick${current === c ? " is-on" : ""}" data-pick="${name}" data-val="${esc(c)}">${esc(c)}</button>`
	).join("")}</div>`;
}

export function openOnboarding({ onOpen } = {}) {
	const o = U.takeOverlay();
	if (!o) return;
	const state = {
		step: 0,
		title: "",
		subject: "",
		kind: "history",
		exam: "",
		pages: new Set(),
		wiki: true,
		goal: GOAL_CHIPS[0],
		level: LEVEL_CHIPS[1],
		style: STYLE_CHIPS[0],
		notes: "",
		filter: "",
	};
	const mats = topMaterials();
	const STEPS = ["Thema", "Material", "Ziel & Stand", "Stil & Start"];

	o.innerHTML = `<div class="modal zs-dialog zs-onb" role="dialog" aria-modal="true"></div>`;
	o.hidden = false;
	const box = o.firstElementChild;
	const onKey = (e) => { if (!box.isConnected) return close(); if (e.key === "Escape") { e.preventDefault(); close(); } };
	const close = () => {
		document.removeEventListener("keydown", onKey, true);
		if (o._close === close) delete o._close;
		if (box.isConnected) { o.hidden = true; o.innerHTML = ""; }
	};
	o._close = close;
	document.addEventListener("keydown", onKey, true);

	function readInputs() {
		const get = (n) => box.querySelector(`[name="${n}"]`);
		if (get("title")) state.title = get("title").value.trim();
		if (get("subject")) state.subject = get("subject").value.trim();
		if (get("exam")) state.exam = get("exam").value.trim();
		const k = box.querySelector('[name="kind"]:checked');
		if (k) state.kind = k.value;
		if (get("goal")) state.goal = get("goal").value.trim();
		if (get("level")) state.level = get("level").value.trim();
		if (get("style")) state.style = get("style").value.trim();
		if (get("notes")) state.notes = get("notes").value.trim();
		const w = get("wiki");
		if (w) state.wiki = !!w.checked;
	}

	async function createTimeline(mode) {
		readInputs();
		if (!state.title) {
			state.step = 0;
			render();
			U.toast?.("Gib dem Zeitstrahl zuerst einen Namen.", "error");
			return;
		}
		if (ZS_STORE.getSync(state.title)) {
			U.toast?.(`„${state.title}“ gibt es schon.`, "error");
			return;
		}
		const edit = {
			title: state.title,
			subject: state.subject,
			description: [state.goal, state.style].filter(Boolean).join(" · "),
			kind: state.kind,
			exam: state.exam,
			brief: {
				material_pages: [...state.pages],
				goal: state.goal,
				level: state.level,
				style: state.style,
				wiki: state.wiki,
				notes: state.notes,
			},
		};
		const out = ZS_CORE.applyEdit(null, edit);
		if (out.error) { U.toast?.(out.error, "error"); return; }
		await ZS_STORE.put(out.timeline);
		close();
		onOpen?.(out.timeline.id);
		if (mode === "ai") {
			const pages = [...state.pages].map((id) => STATE.findPage?.(id)).filter(Boolean);
			await sendAi(skeletonPrompt(out.timeline, { pages, wiki: state.wiki, focus: state.notes || state.goal }));
		} else if (mode === "mcp") {
			const txt = mcpPrompt(out.timeline);
			try {
				await navigator.clipboard.writeText(txt);
				U.toast?.("Zeitstrahl angelegt & MCP-Auftrag in die Zwischenablage kopiert!", "success");
			} catch {
				U.toast?.(`Zeitstrahl „${out.timeline.title}“ (ID: ${out.timeline.id}) angelegt – bereit für MCP.`, "success");
			}
		}
	}

	function stepBody() {
		if (state.step === 0) {
			return `<p class="zs-onb-q">Wofür bauen wir diesen Zeitstrahl?</p>` +
				`<div class="zs-dlg-grid">` +
				`<label>Name<input name="title" value="${esc(state.title)}" placeholder="z. B. Elektronik 1" autocomplete="off"></label>` +
				`<label>Fach<input name="subject" value="${esc(state.subject)}" placeholder="z. B. E-Technik" autocomplete="off"></label></div>` +
				`<div class="zs-dlg-field"><span class="zs-dlg-label">Aufbau</span><div class="zs-seg" role="radiogroup">` +
				`<label class="zs-seg-opt"><input type="radio" name="kind" value="history"${state.kind !== "path" ? " checked" : ""}><span>${icon("timeline")}<b>Geschichte</b><small>Entdeckungen auf einer Zeitachse</small></span></label>` +
				`<label class="zs-seg-opt"><input type="radio" name="kind" value="path"${state.kind === "path" ? " checked" : ""}><span>${icon("trending-up")}<b>Lernpfad</b><small>Kapitel und Voraussetzungen</small></span></label></div></div>` +
				`<label>Klausurtermin (optional)<input type="date" name="exam" value="${esc(state.exam)}"></label>`;
		}
		if (state.step === 1) {
			const q = state.filter.toLowerCase();
			const rows = mats.filter((m) => !q || m.title.toLowerCase().includes(q)).map((m) =>
				`<label class="zs-mat-row" style="--depth:${m.depth}"><input type="checkbox" data-mat="${esc(m.id)}"${state.pages.has(m.id) ? " checked" : ""}>${icon(m.kind)}<span>${esc(m.title)}</span></label>`
			).join("");
			return `<p class="zs-onb-q">Welche Skripte oder Hefte gehören dazu?</p>` +
				`<p class="hint">Die Auswahl bleibt fest am Zeitstrahl gespeichert – für App-KI und MCP-Agenten.</p>` +
				`<input class="zs-mat-filter" data-onb-filter="1" value="${esc(state.filter)}" placeholder="Seiten und Hefte filtern …" autocomplete="off">` +
				`<div class="zs-mat-list">${rows || `<p class="hint">Keine passenden Seiten gefunden.</p>`}</div>` +
				`<label class="zs-check"><input type="checkbox" name="wiki"${state.wiki ? " checked" : ""}> Wikipedia für historische Einordnung & Bilder erlauben</label>`;
		}
		if (state.step === 2) {
			return `<p class="zs-onb-q">Was ist dein Ziel und wo stehst du gerade?</p>` +
				`<div class="zs-dlg-field"><span class="zs-dlg-label">Lernziel</span>${chipsHtml("goal", GOAL_CHIPS, state.goal)}` +
				`<input name="goal" value="${esc(state.goal)}" placeholder="Oder eigenes Ziel eintippen …" autocomplete="off"></div>` +
				`<div class="zs-dlg-field"><span class="zs-dlg-label">Vorwissen</span>${chipsHtml("level", LEVEL_CHIPS, state.level)}` +
				`<input name="level" value="${esc(state.level)}" placeholder="Oder eigenes Vorwissen beschreiben …" autocomplete="off"></div>`;
		}
		return `<p class="zs-onb-q">Wie sollen die Lektionen aufgebaut sein?</p>` +
			`<div class="zs-dlg-field"><span class="zs-dlg-label">Erklär- und Lernstil</span>${chipsHtml("style", STYLE_CHIPS, state.style)}` +
			`<input name="style" value="${esc(state.style)}" placeholder="Oder eigenen Stil beschreiben …" autocomplete="off"></div>` +
			`<label>Besondere Schwerpunkte / Absprachen (optional)<textarea name="notes" rows="2" placeholder="z. B. Fokus auf Rechenaufgaben aus Altklausuren, keine Herleitungen …">${esc(state.notes)}</textarea></label>` +
			`<div class="zs-onb-summary"><b>${esc(state.title || "Ohne Name")}</b> · ${state.pages.size} verknüpfte Seiten${state.exam ? ` · Klausur ${esc(state.exam)}` : ""}</div>`;
	}

	function render() {
		const dots = STEPS.map((lbl, i) =>
			`<button type="button" class="zs-step${i === state.step ? " is-cur" : i < state.step ? " is-done" : ""}" data-step="${i}"><i>${i + 1}</i><span>${esc(lbl)}</span></button>`
		).join("");
		const last = state.step === STEPS.length - 1;
		box.innerHTML =
			`<div class="zs-dlg-head"><h3>${lead("sparkles")}Neuer Zeitstrahl</h3>` +
			`<button type="button" class="modal-x" data-onb="close" aria-label="Schließen">${icon("x")}</button></div>` +
			`<div class="zs-steps">${dots}</div>` +
			`<div class="zs-onb-body">${stepBody()}</div>` +
			`<div class="modal-actions">` +
			(state.step === 0
				? `<button type="button" class="zs-dlg-left quiet" data-onb="classic">Klassisches Formular</button>`
				: `<button type="button" class="zs-dlg-left" data-onb="prev">${lead("chevron-left")}Zurück</button>`) +
			(last
				? `<button type="button" data-onb="mcp" title="Speichert den Brief und kopiert den MCP-Auftrag">${lead("copy")}Für MCP-Agent kopieren</button>` +
					`<button type="button" class="primary" data-onb="ai">${lead("sparkles")}Mit App-KI starten</button>`
				: `<button type="button" class="primary" data-onb="next">Weiter${icon("chevron-right")}</button>`) +
			`</div>`;
		if (state.step === 0) box.querySelector('[name="title"]')?.focus();
	}

	box.addEventListener("click", (e) => {
		const pick = e.target.closest("[data-pick]");
		if (pick) {
			readInputs();
			state[pick.dataset.pick] = pick.dataset.val;
			render();
			return;
		}
		const st = e.target.closest("[data-step]");
		if (st) {
			readInputs();
			state.step = Number(st.dataset.step);
			render();
			return;
		}
		const act = e.target.closest("[data-onb]")?.dataset.onb;
		if (!act) return;
		if (act === "close") return close();
		if (act === "classic") { close(); openTimelineDialog(null, { onOpen }); return; }
		if (act === "prev") { readInputs(); state.step = Math.max(0, state.step - 1); render(); return; }
		if (act === "next") {
			readInputs();
			if (state.step === 0 && !state.title) { U.toast?.("Gib dem Zeitstrahl zuerst einen Namen.", "error"); box.querySelector('[name="title"]')?.focus(); return; }
			state.step = Math.min(STEPS.length - 1, state.step + 1);
			render();
			return;
		}
		if (act === "ai" || act === "mcp") void createTimeline(act);
	});

	box.addEventListener("change", (e) => {
		const cb = e.target.closest("[data-mat]");
		if (!cb) return;
		const id = cb.dataset.mat;
		if (cb.checked) state.pages.add(id); else state.pages.delete(id);
	});

	box.addEventListener("input", (e) => {
		if (!e.target.matches("[data-onb-filter]")) return;
		state.filter = e.target.value;
		const q = state.filter.trim().toLowerCase();
		for (const row of box.querySelectorAll(".zs-mat-row")) {
			row.hidden = !!q && !row.textContent.toLowerCase().includes(q);
		}
	});

	render();
}
