// Abschreib-Modus: Vollbild-Schreibfeld zum Sammeln eigener Handschrift.
// Der Text wird zeilenweise vorgegeben; „Weiter“ speichert Striche + Soll-Text
// über HANDSCHRIFT.saveTrainingSample (Export in den KI-Einstellungen).
// Jeder vierte Text ist eine Messzeile (split: "eval") und darf nie ins Training.

import { U } from "./util.js";
import { HANDSCHRIFT } from "./handschrift.js";
import { ABSCHREIB_TEXTE, abschreibSplit } from "./abschreiben-texte.js";

const POS_KEY = "impala67_abschreiben_pos";
const MAX_ZEILE = 34; // Zeichen pro Schreibzeile, passt bequem auf ein Tablet-Querformat

const CSS = `
#abschreiben { position: fixed; inset: 0; z-index: var(--z-palette, 1000); display: flex; flex-direction: column; gap: 12px; padding: max(12px, env(safe-area-inset-top)) 16px max(12px, env(safe-area-inset-bottom)); background: var(--bg1, #111); color: var(--text, #eee) }
#abschreiben .ab-kopf { display: flex; align-items: center; gap: 8px }
#abschreiben .ab-kopf b { flex: 1; font-size: 1.05rem }
#abschreiben .ab-info { color: var(--text2, #999); font-size: .85rem }
#abschreiben .ab-text { max-height: 30vh; overflow: auto; padding: 10px 12px; border-radius: 10px; background: var(--surface, #222); font-size: 1rem; line-height: 1.6; color: var(--text2, #999) }
#abschreiben .ab-text .ab-akt { color: var(--text, #eee); background: var(--accent-soft, #234); border-radius: 4px; padding: 1px 3px }
#abschreiben .ab-vorgabe { font-size: 1.6rem; font-weight: 600; text-align: center; letter-spacing: .01em }
#abschreiben canvas { flex: 1; min-height: 180px; width: 100%; border-radius: 12px; background: var(--panel-solid, #1a1a1a); border: 1px solid var(--edge, #444); touch-action: none; cursor: crosshair }
#abschreiben .ab-leiste { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end }
#abschreiben .ab-leiste button { min-height: 44px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--edge, #444); background: var(--surface, #222); color: inherit; font: inherit }
#abschreiben .ab-leiste .ab-weiter { background: var(--accent, #3a7bd5); border-color: transparent; color: var(--on-accent, #fff); font-weight: 600 }
`;

function zeilenVon(text) {
	const zeilen = [];
	let akt = "";
	for (const wort of text.split(/\s+/)) {
		if (akt && (akt + " " + wort).length > MAX_ZEILE) {
			zeilen.push(akt);
			akt = wort;
		} else {
			akt = akt ? akt + " " + wort : wort;
		}
	}
	if (akt) zeilen.push(akt);
	return zeilen;
}

function ladePos() {
	try {
		const p = JSON.parse(localStorage.getItem(POS_KEY) || "{}");
		if (Number.isInteger(p.t) && Number.isInteger(p.l) && ABSCHREIB_TEXTE[p.t]) return p;
	} catch {}
	return { t: 0, l: 0 };
}

function speicherePos(pos) {
	try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {}
}

function escapeHtml(s) {
	return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

export function open() {
	if (document.getElementById("abschreiben")) return;
	if (!document.getElementById("abschreibenCss")) {
		const style = document.createElement("style");
		style.id = "abschreibenCss";
		style.textContent = CSS;
		document.head.appendChild(style);
	}

	const root = document.createElement("div");
	root.id = "abschreiben";
	root.innerHTML =
		'<div class="ab-kopf"><b></b><span class="ab-info"></span>' +
		'<button type="button" data-ab="zu" aria-label="Schließen" style="min-height:44px;min-width:44px;border:0;background:none;color:inherit;font-size:1.4rem">✕</button></div>' +
		'<div class="ab-text"></div>' +
		'<div class="ab-vorgabe"></div>' +
		"<canvas></canvas>" +
		'<div class="ab-leiste">' +
		'<button type="button" data-ab="naechsterText">Anderer Text</button>' +
		'<button type="button" data-ab="ueberspringen">Überspringen</button>' +
		'<button type="button" data-ab="rueckgaengig">↶ Strich</button>' +
		'<button type="button" data-ab="loeschen">Löschen</button>' +
		'<button type="button" class="ab-weiter" data-ab="weiter">Weiter ✓</button>' +
		"</div>";
	document.body.appendChild(root);

	const canvas = root.querySelector("canvas");
	const ctx = canvas.getContext("2d");
	let pos = ladePos();
	let striche = [];
	let aktuell = null;
	let gespeichert = 0;

	function zeichne() {
		const w = canvas.clientWidth, h = canvas.clientHeight;
		ctx.clearRect(0, 0, w, h);
		// Hilfslinien: Grundlinie und Mittellinie für gleichmäßige Schriftgröße
		const grund = h * 0.68, mitte = h * 0.42;
		ctx.strokeStyle = "rgba(127,127,127,.35)";
		ctx.lineWidth = 1;
		ctx.setLineDash([]);
		ctx.beginPath(); ctx.moveTo(12, grund); ctx.lineTo(w - 12, grund); ctx.stroke();
		ctx.setLineDash([6, 6]);
		ctx.beginPath(); ctx.moveTo(12, mitte); ctx.lineTo(w - 12, mitte); ctx.stroke();
		ctx.setLineDash([]);
		ctx.strokeStyle = getComputedStyle(root).color;
		ctx.lineWidth = 2.6;
		ctx.lineCap = ctx.lineJoin = "round";
		for (const s of striche) {
			ctx.beginPath();
			ctx.moveTo(s[0][0], s[0][1]);
			if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
			for (const p of s) ctx.lineTo(p[0], p[1]);
			ctx.stroke();
		}
	}

	function groesse() {
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(canvas.clientWidth * dpr);
		canvas.height = Math.round(canvas.clientHeight * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		zeichne();
	}

	function zeige() {
		const t = ABSCHREIB_TEXTE[pos.t];
		const zeilen = zeilenVon(t.text);
		if (pos.l >= zeilen.length) pos.l = zeilen.length - 1;
		root.querySelector(".ab-kopf b").textContent = "✍️ " + t.titel;
		root.querySelector(".ab-info").textContent =
			"Zeile " + (pos.l + 1) + "/" + zeilen.length + " · Text " + (pos.t + 1) + "/" + ABSCHREIB_TEXTE.length +
			(gespeichert ? " · " + gespeichert + " gespeichert" : "");
		root.querySelector(".ab-text").innerHTML = zeilen
			.map((z, i) => (i === pos.l ? '<span class="ab-akt">' + escapeHtml(z) + "</span>" : escapeHtml(z)))
			.join(" ");
		root.querySelector(".ab-vorgabe").textContent = zeilen[pos.l];
		root.querySelector(".ab-akt")?.scrollIntoView({ block: "nearest" });
		striche = [];
		zeichne();
		return zeilen;
	}

	function naechsteZeile() {
		const zeilen = zeilenVon(ABSCHREIB_TEXTE[pos.t].text);
		if (pos.l + 1 < zeilen.length) pos = { t: pos.t, l: pos.l + 1 };
		else naechsterText();
		speicherePos(pos);
	}

	function naechsterText() {
		pos = { t: (pos.t + 1) % ABSCHREIB_TEXTE.length, l: 0 };
		speicherePos(pos);
	}

	function punkt(e) {
		const r = canvas.getBoundingClientRect();
		return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10];
	}

	canvas.addEventListener("pointerdown", (e) => {
		// Nur der Stift schreibt: Finger, Handballen und Maus werden ignoriert
		if (e.pointerType !== "pen") return;
		e.preventDefault();
		canvas.setPointerCapture(e.pointerId);
		aktuell = { id: e.pointerId, pts: [punkt(e)] };
		striche.push(aktuell.pts);
		zeichne();
	});
	canvas.addEventListener("pointermove", (e) => {
		if (!aktuell || e.pointerId !== aktuell.id) return;
		const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
		for (const ev of events.length ? events : [e]) aktuell.pts.push(punkt(ev));
		zeichne();
	});
	const ende = (e) => {
		if (aktuell && e.pointerId === aktuell.id) aktuell = null;
	};
	canvas.addEventListener("pointerup", ende);
	canvas.addEventListener("pointercancel", ende);

	function schliessen() {
		window.removeEventListener("resize", groesse);
		root.remove();
	}

	root.addEventListener("click", (e) => {
		const aktion = e.target.closest("[data-ab]")?.dataset.ab;
		if (!aktion) return;
		if (aktion === "zu") return schliessen();
		if (aktion === "loeschen") { striche = []; zeichne(); return; }
		if (aktion === "rueckgaengig") { striche.pop(); zeichne(); return; }
		if (aktion === "ueberspringen") { naechsteZeile(); zeige(); return; }
		if (aktion === "naechsterText") { naechsterText(); zeige(); return; }
		if (aktion === "weiter") {
			if (!striche.length) { U.toast("Erst die Zeile abschreiben."); return; }
			const zeilen = zeilenVon(ABSCHREIB_TEXTE[pos.t].text);
			const ok = HANDSCHRIFT.saveTrainingSample(
				striche.map((pts) => ({ pts })),
				zeilen[pos.l],
				{ split: abschreibSplit(pos.t), source: "abschreiben", text_id: pos.t, line: pos.l },
			);
			if (!ok) { U.toast("Speichern fehlgeschlagen – Speicher voll? Bitte in den Einstellungen exportieren.", "error"); return; }
			gespeichert++;
			naechsteZeile();
			zeige();
		}
	});

	window.addEventListener("resize", groesse);
	zeige();
	requestAnimationFrame(groesse);
}
