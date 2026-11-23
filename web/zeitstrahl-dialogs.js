"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { icon, lead } from "./icons.js";
import { ZS_STORE, ZS_CORE } from "./zeitstrahl-store.js";
import { fmtYear } from "./zeitstrahl-graph.js";

// zeitstrahl-dialogs.js — Dialoge des KI-Zeitstrahls: Zeitstrahl anlegen/bearbeiten (mit
// Material-Auswahl und Gerüst-Auftrag an die KI) und Lektion anlegen/bearbeiten/löschen.
// Alles schreibt über ZS_CORE.applyEdit (Kern prüft Eltern, Zyklen, Felder).

const esc = (s) => U.esc(String(s ?? ""));

/** Schickt einen Auftrag an die Seiten-KI (Chat-Leiste öffnet sich). */
export async function sendAi(text) {
	if (S.aiBusy) { U.toast?.("Eine KI-Antwort läuft bereits.", "error"); return false; }
	document.body.classList.remove("panel-collapsed");
	const { CHAT_FULLSCREEN } = await import("./chat-fullscreen.js");
	await CHAT_FULLSCREEN.sendChatMessage(text, "side");
	return true;
}

// Ein Dialog im #overlay mit EINEM Schließweg (Vertrag aus U.confirm / popovers.js).
function openDialog(html, cls) {
	const o = U.takeOverlay();
	if (!o) return null;
	o.innerHTML = `<div class="modal zs-dialog ${cls || ""}" role="dialog" aria-modal="true">${html}</div>`;
	o.hidden = false;
	const box = o.firstElementChild;
	const onKey = (e) => {
		if (!box.isConnected) return close();
		if (e.key === "Escape") { e.preventDefault(); close(); }
	};
	const close = () => {
		document.removeEventListener("keydown", onKey, true);
		if (o._close === close) delete o._close;
		if (box.isConnected) { o.hidden = true; o.innerHTML = ""; }
	};
	o._close = close;
	document.addEventListener("keydown", onKey, true);
	box.addEventListener("click", (e) => { if (e.target.closest("[data-zsdlg-close]")) close(); });
	return { box, close };
}

const segHtml = (name, value, items) => `<div class="zs-seg" role="radiogroup">${items.map(([v, ic, label, hint]) =>
	`<label class="zs-seg-opt"><input type="radio" name="${name}" value="${v}"${v === value ? " checked" : ""}>` +
	`<span>${icon(ic)}<b>${esc(label)}</b><small>${esc(hint)}</small></span></label>`).join("")}</div>`;

// ---------- Material-Auswahl (Seiten und Hefte des aktuellen Bereichs) ----------
function materialRows(parentId, depth) {
	const kids = STATE.childrenOf?.(parentId || null) || [];
	return kids.filter((pg) => !STATE.isPageArchived?.(pg)).map((pg) => {
		const sub = depth < 2 ? materialRows(pg.id, depth + 1) : "";
		const kind = pg.kind === "heft" ? "notebook" : sub ? "folder" : "note";
		const row = `<label class="zs-mat-row" style="--depth:${depth}" data-title="${esc(String(pg.title || "").toLowerCase())}">` +
			`<input type="checkbox" value="${esc(pg.id)}">${icon(kind)}<span>${esc(pg.title || "Ohne Titel")}</span></label>`;
		return row + sub;
	}).join("");
}

function wireMaterial(box) {
	const list = box.querySelector(".zs-mat-list");
	const count = box.querySelector(".zs-mat-count");
	const update = () => { count.textContent = `${list.querySelectorAll("input:checked").length} gewählt`; };
	list.addEventListener("change", (e) => {
		// Ordner wählt seine Unterseiten mit.
		const row = e.target.closest(".zs-mat-row");
		const d = Number(row?.style.getPropertyValue("--depth") || 0);
		for (let n = row?.nextElementSibling; n && Number(n.style.getPropertyValue("--depth")) > d; n = n.nextElementSibling) {
			n.querySelector("input").checked = e.target.checked;
		}
		update();
	});
	box.querySelector(".zs-mat-filter").addEventListener("input", (e) => {
		const q = e.target.value.trim().toLowerCase();
		for (const r of list.children) r.hidden = !!q && !r.dataset.title.includes(q);
	});
	update();
}

function chosenPages(box) {
	return [...box.querySelectorAll(".zs-mat-list input:checked")].map((x) => STATE.findPage?.(x.value)).filter(Boolean);
}

// ---------- Gerüst-Auftrag ----------
export function skeletonPrompt(tl, { pages = [], wiki = true, focus = "" } = {}) {
	const history = tl.kind !== "path";
	const mat = pages.length
		? `Material (lies es mit read_pages, IDs in Klammern):\n${pages.slice(0, 60).map((p) => `- ${p.title} (${p.id})`).join("\n")}`
		: "Such dir das passende Material selbst (search, read_pages).";
	return [
		`Baue bitte das Gerüst für meinen KI-Zeitstrahl „${tl.title}“${tl.subject ? ` (Fach: ${tl.subject})` : ""}.`,
		mat,
		history && wiki ? "Nutze Wikipedia (wikipedia) für die historische Reihenfolge der Entdeckungen." : "",
		focus ? `Mein Schwerpunkt: ${focus}` : "",
		tl.exam ? `Klausur am ${tl.exam}: alle Wege sollen auf den Klausurstoff zulaufen.` : "",
		history
			? "Der Zeitstrahl ist eine Linie mit exakten Jahreszahlen: Jede Lektion ist ein echtes historisches Ereignis (Entdeckung, Erfindung, Veröffentlichung – mit Person im Titel, z. B. „1947: Bardeen, Brattain und Shockley bauen den Transistor“), das Jahr belegst du mit wikipedia. Keine erfundenen Jahre, nicht einfach die Kapitel des Skripts durchnummerieren; den Klausurstoff ordnest du dem passenden Ereignis zu."
			: "",
		`Lege mit edit_timeline (title „${tl.title}“) 8–20 Lektionen an, NUR als Gerüst: title, ${history ? "year (echtes Jahr), era (Epoche), " : ""}summary (ein Satz: welcher Klausurstoff hier gelernt wird) und parents (nur echte fachliche Voraussetzungen${history ? ", nie mit späterem Jahr" : ""}).`,
		"Noch KEINE body, quiz, images oder worksheet – ich prüfe das Gerüst zuerst und lasse die Lektionen dann ausarbeiten. Fasse am Ende kurz zusammen, wie der Zeitstrahl aufgebaut ist.",
	].filter(Boolean).join("\n\n");
}

export function fillPrompt(tl, nodes) {
	const list = nodes.slice(0, 4).map((n) => `„${n.title}“`).join(", ");
	return `Arbeite bitte im Zeitstrahl „${tl.title}“ diese Entwurfs-Lektionen aus: ${list}. ` +
		"Je Lektion mit edit_timeline: body (spannende Story als Einstieg, dann der Klausurstoff mit Formeln/Notation aus meinen Skripten), " +
		"images (Wikipedia-Bilder), sources (Skriptseiten und Wikipedia) und quiz (3–5 Kontrollfragen, gemischte Typen). " +
		"Titel, Jahr, Strang und Verbindungen bleiben, wie sie sind.";
}

// ---------- Zeitstrahl anlegen / bearbeiten ----------
export function openTimelineDialog(tl, { onOpen } = {}) {
	const isNew = !tl;
	const kind = tl?.kind === "path" ? "path" : "history";
	const html =
		`<div class="zs-dlg-head"><h3>${isNew ? "Neuer Zeitstrahl" : "Zeitstrahl bearbeiten"}</h3>` +
		`<button type="button" class="modal-x" data-zsdlg-close aria-label="Schließen">${icon("x")}</button></div>` +
		`<div class="zs-dlg-grid">` +
		`<label>Name<input name="title" value="${esc(tl?.title || "")}" placeholder="Elektronik 1" autocomplete="off"></label>` +
		`<label>Fach<input name="subject" value="${esc(tl?.subject || "")}" placeholder="E-Technik" autocomplete="off"></label></div>` +
		`<div class="zs-dlg-field"><span class="zs-dlg-label">Aufbau</span>` +
		segHtml("kind", kind, [["history", "timeline", "Geschichte", "Entdeckungen auf einer Zeitachse"], ["path", "trending-up", "Lernpfad", "Kapitel und Voraussetzungen"]]) + `</div>` +
		`<div class="zs-dlg-grid">` +
		`<label>Klausur am<input type="date" name="exam" value="${esc(tl?.exam || "")}"></label>` +
		`<label>Schwerpunkt<input name="description" value="${esc(tl?.description || "")}" placeholder="Netzwerkanalyse, Operationsverstärker" autocomplete="off"></label></div>` +
		(isNew
			? `<div class="zs-dlg-field"><span class="zs-dlg-label">Material <span class="zs-mat-count hint"></span></span>` +
				`<input class="zs-mat-filter" placeholder="Seiten und Hefte filtern" autocomplete="off">` +
				`<div class="zs-mat-list">${materialRows(null, 0) || `<p class="hint">Keine Seiten im aktuellen Bereich.</p>`}</div>` +
				`<label class="zs-check"><input type="checkbox" name="wiki" checked> Wikipedia für Geschichte und Bilder nutzen</label></div>`
			: "") +
		`<div class="modal-actions">` +
		(isNew
			? `<button type="button" data-zsdlg="empty">Leer anlegen</button><button type="button" class="primary" data-zsdlg="build">${lead("sparkles")}Gerüst bauen lassen</button>`
			: `<button type="button" class="danger zs-dlg-left" data-zsdlg="delete">${lead("trash")}Löschen</button><button type="button" data-zsdlg-close>Abbrechen</button><button type="button" class="primary" data-zsdlg="save">Speichern</button>`) +
		`</div>`;
	const dlg = openDialog(html, "zs-dlg-timeline");
	if (!dlg) return;
	const { box, close } = dlg;
	if (isNew) wireMaterial(box);
	box.querySelector('[name="title"]').focus();
	const val = (n) => String(box.querySelector(`[name="${n}"]`)?.value || "").trim();
	const fields = () => ({ subject: val("subject"), description: val("description"), exam: val("exam"), kind: box.querySelector('[name="kind"]:checked')?.value || "history" });

	box.addEventListener("click", async (e) => {
		const act = e.target.closest("[data-zsdlg]")?.dataset.zsdlg;
		if (!act) return;
		if (act === "delete") {
			const ok = await U.confirm(`„${tl.title}“ mit allen Lektionen und deinem Fortschritt löschen? Das lässt sich nicht rückgängig machen.`, { title: "Zeitstrahl löschen", ok: "Löschen", danger: true });
			if (!ok) return;
			await ZS_STORE.remove(tl.id);
			close();
			onOpen?.(null);
			return;
		}
		const title = val("title");
		if (!title) { U.toast?.("Gib dem Zeitstrahl einen Namen.", "error"); box.querySelector('[name="title"]').focus(); return; }
		if (isNew && ZS_STORE.getSync(title)) { U.toast?.(`„${title}“ gibt es schon.`, "error"); return; }
		const edit = isNew ? { title, ...fields() } : { title: tl.title, new_title: title, ...fields() };
		const out = ZS_CORE.applyEdit(isNew ? null : tl, edit);
		if (out.error) { U.toast?.(out.error, "error"); return; }
		if (isNew && ZS_STORE.getSync(out.timeline.id)) { U.toast?.(`„${title}“ gibt es schon.`, "error"); return; }
		const pages = isNew ? chosenPages(box) : [];
		const wiki = !!box.querySelector('[name="wiki"]')?.checked;
		await ZS_STORE.put(out.timeline);
		close();
		onOpen?.(out.timeline.id);
		if (act === "build") await sendAi(skeletonPrompt(out.timeline, { pages, wiki, focus: fields().description }));
	});
}

// ---------- Lektion anlegen / bearbeiten ----------
export function openNodeDialog(tl, node, { onSaved, view } = {}) {
	const isNew = !node;
	const history = tl.kind !== "path";
	const strands = [...new Set((tl.nodes || []).map((n) => String(n.strand || "").trim()).filter(Boolean))];
	const others = (view?.nodes || tl.nodes || []).filter((n) => n.id !== node?.id).slice().sort((a, b) => (a.col ?? 0) - (b.col ?? 0));
	const parents = new Set(node?.parents || []);
	const html =
		`<div class="zs-dlg-head"><h3>${isNew ? "Neue Lektion" : "Lektion bearbeiten"}</h3>` +
		`<button type="button" class="modal-x" data-zsdlg-close aria-label="Schließen">${icon("x")}</button></div>` +
		`<label>Titel<input name="title" value="${esc(node?.title || "")}" placeholder="Das ohmsche Gesetz" autocomplete="off"></label>` +
		`<div class="zs-dlg-grid three">` +
		(history ? `<label>Jahr<input name="year" inputmode="numeric" value="${esc(node?.year != null ? Math.round(node.year) : "")}" placeholder="1827" autocomplete="off"></label>` : "") +
		`<label>Epoche<input name="era" value="${esc(node?.era || "")}" placeholder="Frühe Elektrizität" autocomplete="off"></label>` +
		`<label>Strang<input name="strand" list="zsStrands" value="${esc(node?.strand || "")}" placeholder="Gleichstrom" autocomplete="off"></label>` +
		`<datalist id="zsStrands">${strands.map((s) => `<option value="${esc(s)}">`).join("")}</datalist></div>` +
		`<label>Kurzbeschreibung<textarea name="summary" rows="2" placeholder="Worum es in der Lektion geht">${esc(node?.summary || "")}</textarea></label>` +
		(others.length
			? `<div class="zs-dlg-field"><span class="zs-dlg-label">Baut auf auf</span><div class="zs-mat-list zs-parents">${others.map((n) =>
				`<label class="zs-mat-row"><input type="checkbox" value="${esc(n.id)}"${parents.has(n.id) ? " checked" : ""}><span>${esc(n.title)}</span>` +
				(n.year != null ? `<span class="hint">${esc(fmtYear(n.year))}</span>` : "") + `</label>`).join("")}</div></div>`
			: "") +
		`<div class="modal-actions">` +
		(isNew ? "" : `<button type="button" class="danger zs-dlg-left" data-zsdlg="delete">${lead("trash")}Löschen</button>`) +
		`<button type="button" data-zsdlg-close>Abbrechen</button><button type="button" class="primary" data-zsdlg="save">${isNew ? "Anlegen" : "Speichern"}</button></div>`;
	const dlg = openDialog(html, "zs-dlg-node");
	if (!dlg) return;
	const { box, close } = dlg;
	box.querySelector('[name="title"]').focus();
	const val = (n) => String(box.querySelector(`[name="${n}"]`)?.value ?? "").trim();

	box.addEventListener("click", async (e) => {
		const act = e.target.closest("[data-zsdlg]")?.dataset.zsdlg;
		if (!act) return;
		let edit;
		if (act === "delete") {
			const started = node.progress?.quiz || node.progress?.done || node.progress?.worksheet?.status && node.progress.worksheet.status !== "open";
			const ok = await U.confirm(`Lektion „${node.title}“ löschen?${started ? " Dein Fortschritt darin geht verloren." : ""}`, { title: "Lektion löschen", ok: "Löschen", danger: true });
			if (!ok) return;
			edit = { title: tl.title, remove_nodes: [node.id] };
		} else {
			const title = val("title");
			if (!title) { U.toast?.("Die Lektion braucht einen Titel.", "error"); return; }
			const patch = {
				title, era: val("era"), strand: val("strand"), summary: val("summary"),
				parents: [...box.querySelectorAll(".zs-parents input:checked")].map((x) => x.value),
			};
			if (history) patch.year = val("year") === "" ? null : val("year");
			if (!isNew) patch.id = node.id;
			edit = { title: tl.title, nodes: [patch] };
		}
		const out = ZS_CORE.applyEdit(tl, edit);
		if (out.error) { U.toast?.(out.error.replace(/^edit_timeline: /, ""), "error"); return; }
		await ZS_STORE.put(out.timeline);
		close();
		if (out.warnings?.length) U.toast?.(out.warnings[0]);
		onSaved?.(act === "delete" ? null : (out.added[0] || node?.id));
	});
}
