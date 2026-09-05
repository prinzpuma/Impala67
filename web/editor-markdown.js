"use strict";
import { U } from "./util.js";

// Diese Datei wird als Markdown-Codeblock gespiegelt — deshalb nie ein
// literales Dreifach-Backtick im Quelltext:
export const FENCE = "``" + "`";

export const COLOR_META_RE = /^<!--@c:([a-z]+)?(?:;bg:([a-z]+))?-->$/;
export const IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
export const HEFT_RE = /^:::heft\s+(\S+)/;
// Datei-/Medienblock: ":::file <src> <Anzeigename>" — src ist "file:<id>" (IndexedDB)
// oder eine externe URL. EIN Blocktyp für ALLE Formate (KISS) — was er anzeigt,
// entscheidet der MIME-Typ erst beim Hydrieren (Video/Audio/PDF/Bild/Download).
export const FILE_RE = /^:::file\s+(\S+)(?:\s+(.*))?$/;

// MIME-Typ aus der Dateiendung raten — für externe URLs und Dateien ohne file.type.
export const MIME_EXT = {
	mp4: "video/mp4",
	m4v: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	mkv: "video/x-matroska",
	mp3: "audio/mpeg",
	m4a: "audio/mp4",
	wav: "audio/wav",
	ogg: "audio/ogg",
	oga: "audio/ogg",
	opus: "audio/ogg",
	flac: "audio/flac",
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	avif: "image/avif",
};

export const mimeFromName = (name) => {
	const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
	return (m && MIME_EXT[m[1]]) || "";
};

export const LISTY = { bullet: 1, number: 1, todo: 1 };

const defaultUid = () => (typeof U !== "undefined" && U && typeof U.uid === "function"
	? U.uid()
	: (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2)));

// ---------- parse(): Markdown (pg.content) → Blockobjekte ----------
export function parse(md, uidGenerator) {
	const uid = typeof uidGenerator === "function" ? uidGenerator : defaultUid;
	const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
	const out = [];
	let pendingColor = null; // <!--@c:...--> gilt für den nächsten Block
	let i = 0;

	const applyColor = (b) => {
		if (pendingColor) {
			if (pendingColor.c) b.textColor = pendingColor.c;
			if (pendingColor.bg) b.bgColor = pendingColor.bg;
			pendingColor = null;
		}
		return b;
	};

	while (i < lines.length) {
		const line = lines[i];

		if (!line.trim()) { i++; continue; }

		const colorMeta = line.trim().match(COLOR_META_RE);
		if (colorMeta) { pendingColor = { c: colorMeta[1], bg: colorMeta[2] }; i++; continue; }

		// Code-Zaun
		if (line.startsWith(FENCE)) {
			const language = line.slice(3).trim() || "text";
			const buf = [];
			i++;
			while (i < lines.length && !lines[i].startsWith(FENCE)) buf.push(lines[i++]);
			i++;
			out.push(applyColor({ id: uid(), type: "code", language, text: buf.join("\n") }));
			continue;
		}

		// Formel-Block: $$…$$ und \\[…\\] dürfen einzeilig sein, aber auch direkt
		// nach dem öffnenden Delimiter beginnen (z. B. $$\\begin{pmatrix} …).
		const mathStart = line.trim().match(/^(\$\$|\\\[)(.*)$/);
		if (mathStart) {
			const buf = [];
			const endToken = mathStart[1] === "$$" ? "$$" : "\\]";
			const first = mathStart[2];
			const firstEnd = first.indexOf(endToken);
			if (firstEnd >= 0) {
				buf.push(first.slice(0, firstEnd));
				i++;
			} else {
				buf.push(first);
				i++;
				while (i < lines.length) {
					const end = lines[i].indexOf(endToken);
					if (end >= 0) {
						buf.push(lines[i].slice(0, end));
						i++;
						break;
					}
					buf.push(lines[i++]);
				}
			}
			out.push(applyColor({ id: uid(), type: "math", text: buf.join("\n").trim() }));
			continue;
		}

		// Heft-Einbettung
		const heft = line.match(HEFT_RE);
		if (heft) { out.push(applyColor({ id: uid(), type: "heft", heftId: heft[1] })); i++; continue; }

		// Datei-/Medien-Einbettung
		const fil = line.match(FILE_RE);
		if (fil) { out.push(applyColor({ id: uid(), type: "file", src: fil[1], name: fil[2] || "" })); i++; continue; }

		// Spalten (rekursiv geparst)
		if (/^:::columns\b/.test(line)) {
			const cols = [[]];
			let depth = 1;
			const buf = [];
			i++;
			while (i < lines.length && depth > 0) {
				const l = lines[i];
				if (/^:::columns\b/.test(l)) depth++;
				if (/^:::end\b/.test(l)) { depth--; if (!depth) { i++; break; } }
				if (depth === 1 && /^:::split\b/.test(l)) {
					cols[cols.length - 1] = parse(buf.join("\n"), uid);
					buf.length = 0; cols.push([]); i++; continue;
				}
				buf.push(l); i++;
			}
			cols[cols.length - 1] = parse(buf.join("\n"), uid);
			cols.forEach((c) => { if (!c.length) c.push({ id: uid(), type: "p", text: "" }); });
			out.push(applyColor({ id: uid(), type: "columns", columns: cols }));
			continue;
		}

		// Toggle <details> (mit Verschachtelungstiefe depth)
		if (/^<details\b/i.test(line.trim())) {
			const open = /\bopen\b/i.test(line);
			const buf = [];
			let summary = "";
			let depth = 1;
			// <summary> darf auch direkt in der <details>-Zeile stehen (Altbestand/Import)
			const sm0 = line.match(/<summary>([\s\S]*?)<\/summary>/i);
			if (sm0) summary = sm0[1];
			i++;
			while (i < lines.length && depth > 0) {
				const l = lines[i];
				const trimmed = l.trim();
				if (/^<details\b/i.test(trimmed)) depth++;
				if (/^<\/details>/i.test(trimmed)) {
					depth--;
					if (depth === 0) { i++; break; }
				}
				if (depth === 1) {
					const sm = l.match(/^\s*<summary>([\s\S]*?)<\/summary>/i);
					if (sm) { summary = sm[1]; i++; continue; }
				}
				buf.push(l); i++;
			}
			const children = parse(buf.join("\n"), uid);
			if (!children.length) children.push({ id: uid(), type: "p", text: "" });
			out.push(applyColor({ id: uid(), type: "toggle", summary, open, children }));
			continue;
		}

		// Callout `> [!farbe]` (Kinder = eingerückte >-Zeilen, rekursiv)
		const co = line.match(/^>\s*\[!([a-z]+)\]\s*(.*)$/i);
		if (co) {
			const buf = co[2] ? [co[2]] : [];
			i++;
			while (i < lines.length && /^>/.test(lines[i]) && !/^>\s*\[!([a-z]+)\]/i.test(lines[i])) {
				buf.push(lines[i].replace(/^>\s?/, "")); i++;
			}
			const children = parse(buf.join("\n"), uid);
			if (!children.length) children.push({ id: uid(), type: "p", text: "" });
			out.push(applyColor({ id: uid(), type: "callout", color: co[1].toLowerCase(), children }));
			continue;
		}

		// Zitat (mehrzeilig)
		if (/^>\s?/.test(line)) {
			const buf = [];
			while (i < lines.length && /^>\s?/.test(lines[i]) && !/^>\s*\[!([a-z]+)\]/i.test(lines[i])) {
				buf.push(lines[i++].replace(/^>\s?/, ""));
			}
			out.push(applyColor({ id: uid(), type: "quote", text: buf.join("\n") }));
			continue;
		}

		// GFM-Tabelle
		if (/^\s*\|.*\|\s*$/.test(line)) {
			const rows = [];
			while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
				const raw = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "");
				if (!/^[\s:|-]+$/.test(raw)) {
					rows.push(raw.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim()));
				}
				i++;
			}
			const width = Math.max(2, ...rows.map((r) => r.length));
			rows.forEach((r) => { while (r.length < width) r.push(""); });
			if (!rows.length) rows.push(["", ""], ["", ""]);
			out.push(applyColor({ id: uid(), type: "table", rows }));
			continue;
		}

		// Trennlinie
		if (/^\s*---+\s*$/.test(line)) { out.push(applyColor({ id: uid(), type: "divider" })); i++; continue; }

		// Bild — ![…](video.mp4)/(…mp3)/(…pdf) ist KEIN Bild: als Medienblock einhängen.
		// FIX: genau so entstand der „MP4 lässt sich nicht abspielen“-Bug — die Datei
		// landete als kaputtes <img> statt als abspielbares <video>.
		const img = line.match(IMAGE_RE);
		if (img) {
			const mm = mimeFromName(img[2]);
			if (/^(video|audio)\//.test(mm) || mm === "application/pdf") {
				out.push(applyColor({ id: uid(), type: "file", src: img[2], name: img[1] }));
			} else {
				out.push(applyColor({ id: uid(), type: "image", alt: img[1], src: img[2] }));
			}
			i++; continue;
		}

		// Überschriften
		const h = line.match(/^(#{1,3})\s+(.*)$/);
		if (h) {
			out.push(applyColor({ id: uid(), type: "h" + h[1].length, text: h[2] }));
			i++; continue;
		}

		// Listen (Einrückung = 2 Leerzeichen oder 1 Tab pro Ebene)
		const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
		if (li) {
			const indent = Math.floor(li[1].replace(/\t/g, "  ").length / 2);
			const rest = li[3];
			const todo = rest.match(/^\[( |x|X)\]\s?(.*)$/);
			if (todo && /^[-*+]$/.test(li[2])) {
				out.push(applyColor({ id: uid(), type: "todo", checked: todo[1].toLowerCase() === "x", indent, text: todo[2] }));
			} else if (/^[-*+]$/.test(li[2])) {
				out.push(applyColor({ id: uid(), type: "bullet", indent, text: rest }));
			} else {
				out.push(applyColor({ id: uid(), type: "number", indent, text: rest }));
			}
			i++; continue;
		}

		// Absatz (Folgezeilen bis Leerzeile gehören dazu, außer neue Blockstarts)
		const buf = [line];
		i++;
		while (i < lines.length && lines[i].trim() &&
			!/^(#{1,3}\s|>|\s*([-*+]|\d+[.)])\s|\s*\||\s*---+\s*$|:::|<details\b|<\/details\b|\$\$|\\\[)/.test(lines[i]) &&
			!lines[i].startsWith(FENCE) && !COLOR_META_RE.test(lines[i].trim()) && !IMAGE_RE.test(lines[i])) {
			buf.push(lines[i]); i++;
		}
		out.push(applyColor({ id: uid(), type: "p", text: buf.join("\n") }));
	}
	return out;
}

// ---------- serialize(): Blockobjekte → Markdown (nur im Hintergrund) ----------
export function serializeBlock(b) {
	if (!b) return "";
	const colorMeta = (b.textColor || b.bgColor)
		? "<!--@c:" + (b.textColor || "") + (b.bgColor ? ";bg:" + b.bgColor : "") + "-->\n"
		: "";
	const ind = "  ".repeat(b.indent || 0);
	switch (b.type) {
		case "h1": return colorMeta + "# " + (b.text || "");
		case "h2": return colorMeta + "## " + (b.text || "");
		case "h3": return colorMeta + "### " + (b.text || "");
		case "bullet": return colorMeta + ind + "- " + (b.text || "");
		case "number": return colorMeta + ind + "1. " + (b.text || "");
		case "todo": return colorMeta + ind + "- [" + (b.checked ? "x" : " ") + "] " + (b.text || "");
		case "quote": return colorMeta + String(b.text || "").split("\n").map((l) => "> " + l).join("\n");
		case "divider": return "---";
		case "image": return "![" + (b.alt || "") + "](" + (b.src || "") + ")";
		case "heft": return ":::heft " + (b.heftId || "");
		case "file": return ":::file " + (b.src || "") + (b.name ? " " + b.name : "");
		case "code": return FENCE + (b.language || "text") + "\n" + (b.text || "") + "\n" + FENCE;
		case "math": return "$$\n" + (b.text || "") + "\n$$";
		case "table":
			return (b.rows || []).map((row, ri) => {
				const cells = row.map((c) => String(c || "").replace(/\|/g, "\\|").replace(/\n/g, " "));
				const line = "| " + cells.join(" | ") + " |";
				return ri === 0 ? line + "\n|" + row.map(() => " --- ").join("|") + "|" : line;
			}).join("\n");
		case "callout":
			return colorMeta + "> [!" + (b.color || "blue") + "]\n" +
				serialize(b.children || []).split("\n").map((l) => "> " + l).join("\n");
		case "toggle":
			return "<details" + (b.open ? " open" : "") + ">\n<summary>" + (b.summary || "") + "</summary>\n\n" +
				serialize(b.children || []) + "\n</details>";
		case "columns":
			return ":::columns\n" + (b.columns || []).map((col) => serialize(col)).join("\n:::split\n") + "\n:::end";
		default: return colorMeta + String(b.text || "");
	}
}

export function serialize(blocks = []) {
	const list = Array.isArray(blocks) ? blocks : [];
	const parts = [];
	for (let k = 0; k < list.length; k++) {
		const cur = list[k];
		const prev = list[k - 1];
		// Listen gleicher Art bleiben zusammenhängend (keine Leerzeile),
		// alles andere wird durch Leerzeilen getrennt — wie bisher gespeichert.
		const glue = prev && LISTY[prev.type] && LISTY[cur.type] ? "\n" : "\n\n";
		parts.push((k ? glue : "") + serializeBlock(cur));
	}
	return parts.join("");
}
