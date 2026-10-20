"use strict";
// Diagramm-Codeblöcke im Editor: ```mermaid und ```svg werden als Grafik angezeigt.
// Die Quelle bleibt ein normaler Codeblock (Markdown unverändert), nur die Anzeige wechselt.
import { U } from "./util.js";
import { PERF_PROFILER } from "./performance-profiler.js";

const LANGS = new Set(["mermaid", "svg"]);

// "mermaid" | "svg" | null — Groß-/Kleinschreibung egal.
export function diagramLang(language) {
	const l = String(language || "").trim().toLowerCase();
	return LANGS.has(l) ? l : null;
}

// SVG-Quelle → sicheres Markup. DOMPurify mit SVG-Profil entfernt Skripte, Event-
// Attribute und foreignObject. <style> fliegt zusätzlich raus: Inline-SVG-Styles gelten
// sonst für die ganze App. Ohne DOMPurify (offline, CDN-Fehler) als <img>: dort läuft
// nie Skript, nur currentColor folgt dann nicht dem Design.
export function safeSvgHtml(src) {
	const text = String(src || "").trim();
	if (window.DOMPurify) {
		const clean = DOMPurify.sanitize(text, {
			USE_PROFILES: { svg: true, svgFilters: true },
			FORBID_TAGS: ["style", "foreignObject"],
		});
		return /<svg[\s>]/i.test(clean) ? clean : "";
	}
	if (!/^<svg[\s>]/i.test(text)) return "";
	return '<img alt="" src="data:image/svg+xml;charset=utf-8,' + U.esc(encodeURIComponent(text)) + '">';
}

let seq = 0;

// Rendert die Quelle in el. Fehler erscheinen als kurze Meldung im Kasten, die Quelle
// bleibt unberührt (Klick öffnet den Code). Spätere Aufrufe gewinnen: ein langsamer
// Mermaid-Lauf überschreibt keine neuere Vorschau.
export async function renderDiagram(el, language, src) {
	if (!el) return;
	const lang = diagramLang(language);
	const text = String(src || "");
	const run = String(++seq);
	el.dataset.dgRun = run;
	const show = (html, error) => {
		if (el.dataset.dgRun !== run) return;
		el.classList.toggle("blk-diagram-error", !!error);
		el.innerHTML = html;
	};
	if (!text.trim()) { show('<span class="blk-diagram-msg">Leeres Diagramm</span>', false); return; }
	if (lang === "svg") {
		const html = safeSvgHtml(text);
		show(html || '<span class="blk-diagram-msg">Kein gültiges SVG (muss mit &lt;svg …&gt; beginnen)</span>', !html);
		return;
	}
	if (lang !== "mermaid") return;
	if (!window.mermaid) show('<span class="blk-diagram-msg">Diagramm wird geladen…</span>', false);
	if (!(await U.ensureMermaid())) {
		show('<span class="blk-diagram-msg">Internetverbindung nötig, um die Diagramm-Engine zum ersten Mal zu laden.</span>', true);
		return;
	}
	const id = "dg" + run + "x" + Date.now().toString(36);
	try {
		const { svg } = await PERF_PROFILER.run("mermaid.render", () => mermaid.render(id, text), { chars: text.length, where: "editor" }, 50);
		show(svg, false);
	} catch (err) {
		// Mermaid lässt bei Syntaxfehlern seinen Mess-Container im <body> stehen.
		document.getElementById("d" + id)?.remove();
		document.getElementById(id)?.remove();
		const msg = String(err && (err.message || err.str) || err || "").split("\n")[0].slice(0, 160);
		show('<span class="blk-diagram-msg">Diagramm-Fehler: ' + U.esc(msg) + "</span>", true);
	}
}
