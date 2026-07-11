"use strict";
// util.js — kleine Helfer, keine Abhängigkeiten
export const U = {
	uid: () => crypto.randomUUID(),
	now: () => new Date().toISOString(),

	esc: (s) => String(s ?? "").replace(/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),

	debounce(fn, ms) {
		let timer;
		return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
	},

	el: (id) => document.getElementById(id),

	// In-App-Toast statt alert(): kleine Meldung unten mittig, verschwindet von selbst.
	// type: "info" (Standard), "success", "error" — Fehler bleiben etwas länger stehen.
	// Styles: styles.css (#toasts/.toast). Blockiert nichts — anders als alert().
	toast(msg, type) {
		let wrap = document.getElementById("toasts");
		if (!wrap) {
			wrap = document.createElement("div");
			wrap.id = "toasts";
			document.body.appendChild(wrap);
		}
		const t = document.createElement("div");
		t.className = "toast" + (type ? " " + type : "");
		t.textContent = String(msg ?? "");
		wrap.appendChild(t);
		setTimeout(() => {
			t.classList.add("hide");
			setTimeout(() => t.remove(), 350);
		}, type === "error" ? 7000 : 4000);
		return t;
	},

	// In-App-Bestätigung statt window.confirm() — gleiches #overlay wie alle Dialoge.
	// opts: { title?, ok?, cancel?, danger? } — danger färbt den OK-Button rot (Löschen).
	confirm(message, opts) {
		opts = opts || {};
		const o = document.getElementById("overlay");
		if (!o) return Promise.resolve(window.confirm(String(message ?? "")));
		return new Promise((resolve) => {
			const title = opts.title || "Bestätigen";
			const okLabel = opts.ok || "OK";
			const cancelLabel = opts.cancel || "Abbrechen";
			const danger = !!opts.danger;
			o.innerHTML = '<div class="modal modal-sm">' +
				"<h3>" + U.esc(title) + "</h3>" +
				'<p class="hint" style="white-space:pre-wrap">' + U.esc(String(message ?? "")) + "</p>" +
				'<div class="modal-actions">' +
					'<button type="button" id="dlgConfirmCancel">' + U.esc(cancelLabel) + "</button>" +
					'<button type="button" id="dlgConfirmOk"' + (danger ? ' class="danger"' : "") + '>' +
						U.esc(okLabel) + "</button>" +
				"</div></div>";
			o.hidden = false;
			let done = false;
			const onKey = (e) => {
				if (e.key === "Escape") { e.preventDefault(); finish(false); }
				// FIX: Enter bestätigte bisher IMMER — auch wenn „Abbrechen“ (per Tab) fokussiert
				// war. Bei destruktiven Dialogen fatal. Jetzt entscheidet der fokussierte Button.
				else if (e.key === "Enter") {
					e.preventDefault();
					finish(document.activeElement !== U.el("dlgConfirmCancel"));
				}
			};
			const finish = (ok) => {
				if (done) return;
				done = true;
				document.removeEventListener("keydown", onKey, true);
				o.hidden = true;
				o.innerHTML = "";
				resolve(ok);
			};
			U.el("dlgConfirmOk").addEventListener("click", () => finish(true));
			U.el("dlgConfirmCancel").addEventListener("click", () => finish(false));
			document.addEventListener("keydown", onKey, true);
			const okBtn = U.el("dlgConfirmOk");
			if (okBtn) okBtn.focus();
		});
	},

	fmtDate: (iso) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }),

	// Farb-Syntax: {red}Text{/} → farbiger Text, {bg-yellow}Text{/} → Hintergrundfarbe.
	// Bleibt reiner Text im Markdown — Diffs, Sync, Verlauf und KI-Tools funktionieren unverändert.
	// Übrig gebliebene {/} (z.B. bei Verschachtelung) werden am Ende entfernt.
	// FIX (Audit): Inhalt innerhalb der Farb-Marker escapen, bevor er als HTML-Span landet
	// (sonst XSS, falls marked/DOMPurify offline/fehlend sind). Klassennamen bleiben [a-z]+.
	colorize: (s) => String(s ?? "")
		.replace(/\{bg-([a-z]+)\}([\s\S]+?)\{\/\}/g, (_, c, t) => '<span class="hl-' + c + '">' + U.esc(t) + '</span>')
		.replace(/\{([a-z]+)\}([\s\S]+?)\{\/\}/g, (_, c, t) => '<span class="c-' + c + '">' + U.esc(t) + '</span>')
		.replace(/\{\/\}/g, ""),

	// Gemeinsamer Helfer für md()/mdInline(): ==markiert== → escapetes <mark>…</mark>,
	// danach Farb-Syntax. Vorher in beiden Funktionen fast identisch kopiert.
	_markHighlights(text) {
		return U.colorize(String(text ?? "").replace(/==([^=\n]+)==/g, (_, t) => "<mark>" + U.esc(t) + "</mark>"));
	},

	// HTML gegen XSS bereinigen: DOMPurify (per CDN), sonst konservativer Basis-Filter.
	sanitize(html) {
		if (window.DOMPurify) return DOMPurify.sanitize(html);
		return String(html)
			.replace(/<script[\s\S]*?(<\/script\s*>|$)/gi, "")
			.replace(/<\/?(iframe|object|embed|form|meta|link|base)\b[^>]*>/gi, "")
			.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
			.replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*/gi, "$1=$2#");
	},

	// Markdown → HTML. marked kommt per CDN; offline gibt es einen sicheren Fallback.
	// Unterstützt zusätzlich ==markiert== → <mark> und die Farb-Syntax (colorize).
	_mdCache: new Map(),
	md(text) {
		const src = String(text ?? "");
		if (U._mdCache.has(src)) return U._mdCache.get(src);
		const raw = U._markHighlights(src);
		if (!window.marked) {
			// FIX: Offline-Fallback NICHT cachen — sonst blieb der rohe <pre>-Text für
			// immer im Cache, auch nachdem marked (CDN) später doch noch geladen wurde.
			return "<pre>" + U.esc(raw) + "</pre>";
		}
		const html = U.sanitize(marked.parse(raw, { breaks: true }));
		// Kleiner Cache: erspart erneutes Parsen bei jedem Voll-Render derselben Inhalte.
		if (U._mdCache.size > 300) U._mdCache.clear();
		U._mdCache.set(src, html);
		return html;
	},

	// Nur Inline-Markdown (einzelne Zeile, ohne <p>-Wrapper) — für Blockzeilen
	// im Block-Editor (Überschriften, Listenpunkte, To-dos).
	mdInline(text) {
		const raw = U._markHighlights(text);
		if (window.marked && marked.parseInline) {
			try { return U.sanitize(marked.parseInline(raw, { breaks: true })); } catch { /* Fallback unten */ }
		}
		return U.esc(raw);
	},

	// LaTeX live rendern: $...$ / $$...$$ / \(...\) / \[...\] in einem DOM-Element.
	// throwOnError:false, damit unfertige Formeln während des Streamens nicht crashen.
	renderMath(el) {
		if (!el || !window.renderMathInElement) return;
		try {
			renderMathInElement(el, {
				delimiters: [
					{ left: "$$", right: "$$", display: true },
					{ left: "\\[", right: "\\]", display: true },
					{ left: "$", right: "$", display: false },
					{ left: "\\(", right: "\\)", display: false },
				],
				throwOnError: false,
			});
		} catch { /* unvollständige Formel während des Streamens — ignorieren */ }
	},

	// Code-Blöcke einfärben (highlight.js per CDN) — Mermaid-Blöcke werden übersprungen
	highlightCode(el) {
		if (!el) return;
		U.renderMermaid(el);
		if (!window.hljs) return;
		el.querySelectorAll("pre code").forEach((block) => {
			if (block.classList.contains("language-mermaid")) return;
			try { hljs.highlightElement(block); } catch { /* ignorieren */ }
		});
	},

	// Mermaid-Diagramme rendern: ```mermaid-Codeblöcke → SVG (dunkles Theme).
	// Fehlertolerant: während des KI-Streamens unvollständige Diagramme bleiben
	// als Codeblock stehen und werden erst gerendert, wenn die Syntax gültig ist.
	renderMermaid(el) {
		if (!el || !window.mermaid) return;
		if (!U._mermaidInit) {
			U._mermaidInit = true;
			try { mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict", fontFamily: "inherit" }); } catch { /* ignorieren */ }
		}
		el.querySelectorAll("pre code.language-mermaid").forEach(async (block) => {
			const pre = block.closest("pre");
			if (!pre || pre.dataset.mermaidDone) return;
			const src = block.textContent || "";
			if (!src.trim()) return;
			pre.dataset.mermaidDone = "1";
			try {
				const id = "mmd" + Math.random().toString(36).slice(2, 10);
				if (!(await mermaid.parse(src, { suppressErrors: true }))) { delete pre.dataset.mermaidDone; return; }
				const { svg } = await mermaid.render(id, src);
				const wrap = document.createElement("div");
				wrap.className = "mermaid-diagram";
				wrap.innerHTML = svg;
				pre.replaceWith(wrap);
			} catch {
				// Ungültige/unfertige Syntax — Codeblock unverändert lassen, später erneut versuchen
				delete pre.dataset.mermaidDone;
			}
		});
	},

	// Letzte n nicht-leere Zeilen eines Texts (für die Thinking-Mini-Ansicht)
	lastLines(text, n) {
		const lines = String(text ?? "").split("\n").filter((l) => l.trim() !== "");
		return lines.slice(-n).join("\n");
	},

	// Einfacher zeilenbasierter Diff (LCS). Fällt bei sehr langen Texten auf
	// einen groben Block-Vergleich zurück, damit die O(n*m)-Matrix nicht explodiert.
	diffLines(a, b) {
		const A = String(a ?? "").split("\n");
		const B = String(b ?? "").split("\n");
		if (A.length > 400 || B.length > 400) {
			const out = [];
			if (a) out.push({ type: "del", text: "(bisheriger Inhalt, " + A.length + " Zeilen)" });
			if (b) out.push({ type: "add", text: "(neuer Inhalt, " + B.length + " Zeilen)" });
			return out;
		}
		const n = A.length, m = B.length;
		const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
		for (let i = n - 1; i >= 0; i--) {
			for (let j = m - 1; j >= 0; j--) {
				dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
			}
		}
		const out = [];
		let i = 0, j = 0;
		while (i < n && j < m) {
			if (A[i] === B[j]) { out.push({ type: "same", text: A[i] }); i++; j++; }
			else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: A[i] }); i++; }
			else { out.push({ type: "add", text: B[j] }); j++; }
		}
		while (i < n) { out.push({ type: "del", text: A[i] }); i++; }
		while (j < m) { out.push({ type: "add", text: B[j] }); j++; }
		return out;
	},

	// Gemeinsamer Download-Helfer (dedupliziert download/downloadText/downloadBlob)
	_dl(name, blob) {
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 5000);
	},
	download: (name, text) => U._dl(name, new Blob([text], { type: "application/json" })),

	// Generischer Text-Download (z.B. für angehängte lange Texte aus dem Chat)
	downloadText: (name, text) => U._dl(name, new Blob([text], { type: "text/plain" })),
	downloadBlob: (name, blob) => U._dl(name, blob),

	// ---- Minimaler ZIP-Writer (Methode "Store", ohne Kompression, ohne Bibliothek) ----
	// Für Workspace-Exporte: files = [{ name, text }] → ZIP-Blob.
	crc32(bytes) {
		let table = U._crcTable;
		if (!table) {
			table = U._crcTable = new Int32Array(256);
			for (let n = 0; n < 256; n++) {
				let c = n;
				for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
				table[n] = c;
			}
		}
		let crc = -1;
		for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
		return (crc ^ -1) >>> 0;
	},
	zip(files) {
		// FIX: defensiv gegen ungültige Eingaben (z.B. undefined) statt hartem Crash.
		const list = Array.isArray(files) ? files : [];
		const enc = new TextEncoder();
		const num = (n, len) => { const a = new Uint8Array(len); for (let i = 0; i < len; i++) a[i] = (n >>> (8 * i)) & 0xff; return a; };
		const chunks = [];
		const central = [];
		let offset = 0;
		for (const f of list) {
			const nameB = enc.encode(f.name);
			const data = typeof f.text === "string" ? enc.encode(f.text) : new Uint8Array(f.text);
			const crc = U.crc32(data);
			// FIX: Bit 11 (0x0800) im General-Purpose-Flag setzen — Dateinamen sind UTF-8-kodiert.
			// Ohne das Flag interpretieren Entpacker die Namen als CP437: Umlaute (Seiten-/
			// Stapel-Namen wie "Prüfung.md") kamen als Zeichensalat an.
			chunks.push(num(0x04034b50, 4), num(20, 2), num(0x0800, 2), num(0, 2), num(0, 2), num(0, 2),
				num(crc, 4), num(data.length, 4), num(data.length, 4), num(nameB.length, 2), num(0, 2), nameB, data);
			central.push({ nameB, size: data.length, crc, offset });
			offset += 30 + nameB.length + data.length;
		}
		let cdSize = 0;
		for (const c of central) {
			chunks.push(num(0x02014b50, 4), num(20, 2), num(20, 2), num(0x0800, 2), num(0, 2), num(0, 2), num(0, 2),
				num(c.crc, 4), num(c.size, 4), num(c.size, 4), num(c.nameB.length, 2), num(0, 2), num(0, 2),
				num(0, 2), num(0, 2), num(0, 4), num(c.offset, 4), c.nameB);
			cdSize += 46 + c.nameB.length;
		}
		chunks.push(num(0x06054b50, 4), num(0, 2), num(0, 2), num(central.length, 2), num(central.length, 2),
			num(cdSize, 4), num(offset, 4), num(0, 2));
		return new Blob(chunks, { type: "application/zip" });
	},

	// FileReader-Helfer (Promise statt Callback). Lehnen jetzt mit r.error statt dem
	// rohen ProgressEvent ab — konsistent mit den anderen Promise-Helfern hier.
	readAsText: (f) => new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(r.result);
		r.onerror = () => reject(r.error);
		r.readAsText(f);
	}),
	readAsBuffer: (f) => new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(r.result);
		r.onerror = () => reject(r.error);
		r.readAsArrayBuffer(f);
	}),

	// ArrayBuffer ⇄ Base64 (für Export/Import der PDFs)
	bufToB64(buf) {
		const bytes = new Uint8Array(buf);
		let bin = "";
		const CHUNK = 0x8000;
		for (let i = 0; i < bytes.length; i += CHUNK) {
			bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
		}
		return btoa(bin);
	},
	b64ToBuf(b64) {
		const bin = atob(b64);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		return bytes.buffer;
	},
};