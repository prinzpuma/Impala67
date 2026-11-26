"use strict";

import { STATE } from "./state.js";
import { U } from "./util.js";
import { icon, lead } from "./icons.js";
import { ZS_STORE, ZS_CORE } from "./zeitstrahl-store.js";

// zeitstrahl-edit.js — Lektions-UX-Bausteine: Bilder-Lightbox, schnelles Skript-Quellen-Overlay
// ohne Kontextverlust und Inline-Bearbeitungsmodus für Text (Markdown) & Quizfragen.

const esc = (s) => U.esc(String(s ?? ""));

function overlay(html, cls) {
	const o = U.takeOverlay();
	if (!o) return null;
	o.innerHTML = `<div class="${cls}" role="dialog" aria-modal="true">${html}</div>`;
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
	box.addEventListener("click", (e) => { if (e.target.closest("[data-zso-close]") || e.target === box) close(); });
	return { box, close };
}

/** Öffnet ein Bild oder eine SVG-Skizze groß in einer Lightbox. */
export function openLightbox(src, caption = "") {
	if (!src) return;
	const ov = overlay(
		`<div class="zs-lb-inner">` +
		`<button type="button" class="zs-lb-close" data-zso-close aria-label="Schließen">${icon("x")}</button>` +
		`<img class="zs-lb-img" src="${esc(src)}" alt="${esc(caption)}" referrerpolicy="no-referrer">` +
		(caption ? `<p class="zs-lb-cap">${esc(caption)}</p>` : "") +
		`</div>`,
		"zs-lightbox",
	);
	if (!ov) return;
	const img = ov.box.querySelector(".zs-lb-img");
	img?.addEventListener("click", () => img.classList.toggle("is-zoomed"));
}

/** Zeigt eine verknüpfte Skript-/Notizseite als schnelles Lese-Overlay über der Lektion. */
export function openSourcePreview(pageId) {
	const pg = STATE.findPage?.(String(pageId || ""));
	if (!pg) { U.toast?.("Quelle nicht gefunden.", "error"); return; }
	const body = pg.kind === "heft"
		? `<p class="hint">Dies ist ein Handschrift-Heft. Öffne es direkt im Editor, um darin zu blättern oder zu schreiben.</p>`
		: (pg.content ? `<div class="zs-src-md md">${U.md(pg.content)}</div>` : `<p class="hint">Diese Seite ist leer.</p>`);
	const ov = overlay(
		`<div class="zs-dlg-head"><h3>${lead(pg.kind === "heft" ? "notebook" : "note")}${esc(pg.title || "Ohne Titel")}</h3>` +
		`<div class="zs-src-actions"><button type="button" class="zs-btn quiet" data-src-tab="1">${lead("external")}Im Tab öffnen</button>` +
		`<button type="button" class="modal-x" data-zso-close aria-label="Schließen">${icon("x")}</button></div></div>` +
		`<div class="zs-src-body">${body}</div>`,
		"modal zs-dialog zs-src-modal",
	);
	if (!ov) return;
	U.renderMath?.(ov.box.querySelector(".zs-src-body"));
	ov.box.querySelector("[data-src-tab]")?.addEventListener("click", () => {
		ov.close();
		import("./tabs.js").then(({ TABS }) => TABS.openPage(pg.id));
	});
}

// ---------- Inline-Editor für Lektionstext & Quizfragen ----------
function quizEditorRow(q, i) {
	const type = q.type || "choice";
	const opts = type === "choice" ? (q.options || []).join("\n") : "";
	const corr = type === "choice" ? (q.correct || [0]).join(", ") : "";
	let fields = "";
	if (type === "choice") {
		fields = `<label>Frage<input data-qf="q" value="${esc(q.q || "")}" placeholder="Fragetext …"></label>` +
			`<label>Antworten (eine pro Zeile)<textarea data-qf="options" rows="3">${esc(opts)}</textarea></label>` +
			`<label>Richtige Position(en), ab 0 (z. B. 0 oder 0, 2)<input data-qf="correct" value="${esc(corr)}"></label>`;
	} else if (type === "number") {
		fields = `<label>Frage<input data-qf="q" value="${esc(q.q || "")}" placeholder="Rechenaufgabe …"></label>` +
			`<div class="zs-dlg-grid three"><label>Ergebnis<input data-qf="answer" value="${esc(q.answer ?? "")}"></label>` +
			`<label>Toleranz (abs.)<input data-qf="tol" value="${esc(q.tol ?? "")}" placeholder="optional"></label>` +
			`<label>Einheit<input data-qf="unit" value="${esc(q.unit || "")}" placeholder="z. B. V, Ω"></label></div>`;
	} else if (type === "cloze") {
		fields = `<label>Lückentext (Lücken in {{Antwort|Alternative}})<textarea data-qf="text" rows="2">${esc(q.text || "")}</textarea></label>`;
	} else {
		fields = `<label>Frage<input data-qf="q" value="${esc(q.q || "")}" placeholder="Offene Verständnisfrage …"></label>` +
			`<label>Musterlösung (für KI-Bewertung)<textarea data-qf="solution" rows="2">${esc(q.solution || "")}</textarea></label>`;
	}
	return `<li class="zs-qe-item" data-qe="${i}" data-qtype="${esc(type)}">` +
		`<div class="zs-qe-head"><span class="zs-q-no">${i + 1}</span>` +
		`<select data-qf="type"><option value="choice"${type === "choice" ? " selected" : ""}>Auswahl</option><option value="number"${type === "number" ? " selected" : ""}>Zahl</option><option value="cloze"${type === "cloze" ? " selected" : ""}>Lückentext</option><option value="text"${type === "text" ? " selected" : ""}>Freitext</option></select>` +
		`<button type="button" class="zs-iconbtn" data-qe-del="${i}" aria-label="Frage entfernen">${icon("trash")}</button></div>` +
		fields +
		`<label>Erklärung (optional)<input data-qf="explain" value="${esc(q.explain || "")}" placeholder="Warum ist das richtig?"></label></li>`;
}

export function lessonEditorHtml(node) {
	const qs = node.quiz || [];
	return `<div class="zs-editor" data-zseditor="1">` +
		`<div class="zs-ed-bar"><b>Inhalt bearbeiten</b>` +
		`<div class="zs-actions"><button type="button" class="zs-btn quiet" data-zsed="cancel">Abbrechen</button>` +
		`<button type="button" class="zs-btn primary" data-zsed="save">${lead("check")}Änderungen speichern</button></div></div>` +
		`<label class="zs-ed-field"><span>Kurzbeschreibung</span><textarea name="ed-summary" rows="2">${esc(node.summary || "")}</textarea></label>` +
		`<div class="zs-ed-field"><div class="zs-ed-head"><span>Lektionstext (Markdown &amp; LaTeX)</span><button type="button" class="zs-link" data-zsed="preview">Vorschau umschalten</button></div>` +
		`<textarea class="zs-ed-body" name="ed-body" rows="14" placeholder="Story, Kernkonzept, Formeln …">${esc(node.body || "")}</textarea>` +
		`<div class="zs-ed-preview md" hidden></div></div>` +
		`<div class="zs-ed-field"><div class="zs-ed-head"><span>Kontrollfragen (${qs.length})</span>` +
		`<button type="button" class="zs-btn quiet" data-zsed="addq">${lead("plus")}Frage hinzufügen</button></div>` +
		`<ol class="zs-qe-list">${qs.map(quizEditorRow).join("")}</ol></div></div>`;
}

function readQuizFromDom(ed) {
	const out = [];
	for (const li of ed.querySelectorAll(".zs-qe-item")) {
		const type = li.querySelector('[data-qf="type"]')?.value || li.dataset.qtype || "choice";
		const val = (k) => String(li.querySelector(`[data-qf="${k}"]`)?.value ?? "").trim();
		const explain = val("explain");
		if (type === "choice") {
			const options = String(li.querySelector('[data-qf="options"]')?.value ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
			const correct = val("correct").split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0);
			out.push({ type, q: val("q"), options, correct: correct.length ? correct : [0], explain });
		} else if (type === "number") {
			const q = { type, q: val("q"), answer: val("answer"), unit: val("unit"), explain };
			if (val("tol") !== "") q.tol = val("tol");
			out.push(q);
		} else if (type === "cloze") {
			out.push({ type, text: val("text"), explain });
		} else {
			out.push({ type: "text", q: val("q"), solution: val("solution"), explain });
		}
	}
	return out;
}

export function wireLessonEditor(root, tl, node, { onDone }) {
	const ed = root.querySelector("[data-zseditor]");
	if (!ed) return;
	const list = ed.querySelector(".zs-qe-list");
	const bodyTa = ed.querySelector('[name="ed-body"]');
	const preview = ed.querySelector(".zs-ed-preview");

	ed.addEventListener("click", async (e) => {
		const del = e.target.closest("[data-qe-del]");
		if (del) {
			del.closest(".zs-qe-item")?.remove();
			ed.querySelectorAll(".zs-qe-item .zs-q-no").forEach((el, idx) => { el.textContent = String(idx + 1); });
			return;
		}
		const act = e.target.closest("[data-zsed]")?.dataset.zsed;
		if (!act) return;
		if (act === "cancel") { onDone?.(false); return; }
		if (act === "preview") {
			const show = preview.hidden;
			preview.hidden = !show;
			bodyTa.hidden = show;
			if (show) {
				preview.innerHTML = U.md(bodyTa.value || "");
				U.renderMath?.(preview);
			}
			return;
		}
		if (act === "addq") {
			const idx = list.children.length;
			list.insertAdjacentHTML("beforeend", quizEditorRow({ type: "choice", q: "", options: ["Option A", "Option B"], correct: [0] }, idx));
			list.lastElementChild?.querySelector("input")?.focus();
			return;
		}
		if (act === "save") {
			const patch = {
				id: node.id,
				summary: ed.querySelector('[name="ed-summary"]')?.value.trim() ?? "",
				body: bodyTa.value,
				quiz: readQuizFromDom(ed),
			};
			const out = ZS_CORE.applyEdit(tl, { title: tl.title, nodes: [patch] });
			if (out.error) { U.toast?.(out.error.replace(/^edit_timeline: /, ""), "error"); return; }
			await ZS_STORE.put(out.timeline);
			U.toast?.("Lektion gespeichert.", "success");
			onDone?.(true);
		}
	});

	ed.addEventListener("change", (e) => {
		const sel = e.target.closest('select[data-qf="type"]');
		if (!sel) return;
		const li = sel.closest(".zs-qe-item");
		const idx = [...list.children].indexOf(li);
		const qText = li.querySelector('[data-qf="q"]')?.value || "";
		const explain = li.querySelector('[data-qf="explain"]')?.value || "";
		const tpl = { type: sel.value, q: qText, options: ["Option A", "Option B"], correct: [0], answer: "", text: "", solution: "", explain };
		li.outerHTML = quizEditorRow(tpl, idx);
	});
}
