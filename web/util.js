"use strict";
import { OPTIONAL_MODULE_URLS } from "./optional-modules.js";
// util.js — kleine Helfer
const OPTIONAL_LOAD_TIMEOUT_MS = 15000;
function withLoadTimeout(task, label) {
	let timer = 0;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`Zusatzmodul konnte nicht innerhalb von ${Math.round(OPTIONAL_LOAD_TIMEOUT_MS / 1000)} Sekunden geladen werden: ${label}`)), OPTIONAL_LOAD_TIMEOUT_MS);
	});
	return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
}
export const U = {
	uid: () => crypto.randomUUID(),

	// Dynamisches Nachladen von Skripten & Stylesheets für bedarfsgerechte Modulnutzung.
	// Wichtig: Speichern im versionsübergreifenden Cache (impala67-optional-modules) wird
	// abgewartet (await). Schlägt das Cachen fehl, schlägt das Laden fehl (strikte Offline-Garantie).
	_pendingLoads: new Map(),
	loadScript(src, testGlobal) {
		if (testGlobal && typeof window !== "undefined" && window[testGlobal]) {
			return Promise.resolve(true);
		}
		if (U._pendingLoads.has(src)) return U._pendingLoads.get(src);
		const p = withLoadTimeout((async () => {
			const existing = document.querySelector(`script[src="${src}"]`);
			if (!existing) {
				const s = document.createElement("script");
				s.src = src;
				s.crossOrigin = "anonymous";
				document.head.appendChild(s);
				await new Promise((resolve, reject) => {
					s.onload = () => { s.dataset.loaded = "1"; resolve(); };
					s.onerror = () => reject(new Error("Netzwerkfehler beim Laden von " + src));
				});
			} else if (existing.dataset.loaded !== "1" && !(testGlobal && window[testGlobal])) {
				await new Promise((resolve, reject) => {
					existing.addEventListener("load", () => resolve(), { once: true });
					existing.addEventListener("error", (e) => reject(e), { once: true });
				});
			}
			// Strikte Garantie: Speichern im versionsübergreifenden Offline-Cache MUSS erfolgreich sein
			if (typeof caches !== "undefined") {
				try {
					const cache = await caches.open("impala67-optional-modules");
					const match = await cache.match(src);
					if (!match) {
						await cache.add(src);
					}
				} catch (e) {
					throw new Error("Modul " + src + " geladen, aber Offline-Speicherung fehlgeschlagen: " + ((e && e.message) || e));
				}
			}
			return true;
		})(), src).catch((err) => {
			U._pendingLoads.delete(src);
			throw err;
		});
		U._pendingLoads.set(src, p);
		return p;
	},
	loadStyle(href) {
		const existing = document.querySelector(`link[href="${href}"]`);
		if (existing?.dataset.loaded === "1") return Promise.resolve(true);
		return withLoadTimeout((async () => {
			const l = existing || document.createElement("link");
			if (!existing) {
				l.rel = "stylesheet";
				l.href = href;
				l.crossOrigin = "anonymous";
				document.head.appendChild(l);
			}
			await new Promise((resolve, reject) => {
				l.onload = () => { l.dataset.loaded = "1"; resolve(); };
				l.onerror = () => reject(new Error("Netzwerkfehler beim Laden von " + href));
			});
			if (typeof caches !== "undefined") {
				try {
					const cache = await caches.open("impala67-optional-modules");
					const match = await cache.match(href);
					if (!match) {
						await cache.add(href);
					}
				} catch (e) {
					throw new Error("Stylesheet " + href + " geladen, aber Offline-Speicherung fehlgeschlagen: " + ((e && e.message) || e));
				}
			}
			return true;
		})(), href);
	},

	// Fehlertolerante Ablage für reine Geräte-Einstellungen.
	storage: {
		get(key, fallback = null) {
			try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
		},
		set(key, value) {
			try { localStorage.setItem(key, String(value)); return true; } catch { return false; }
		},
		remove(key) {
			try { localStorage.removeItem(key); return true; } catch { return false; }
		},
		getJson(key, fallback) {
			const raw = U.storage.get(key);
			if (raw == null) return fallback;
			try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
		},
		setJson(key, value) {
			try { return U.storage.set(key, JSON.stringify(value)); } catch { return false; }
		},
	},

	// Zeitquelle aller Event-Zeitstempel — eine HYBRIDE LOGISCHE UHR (HLC).
	// Der Log-Merge entscheidet Konflikte per Zeitstempel (LWW); eine falsch gehende
	// Geräteuhr würde sonst systematisch und still „gewinnen“. Drei Schichten:
	// 1. Physisch: drive.js misst den Versatz gegen den Date-Header der Drive-Antworten
	//    (NTP-artig über die kleinste Round-Trip-Zeit) und meldet ihn über setClockOffset().
	// 2. Monoton: now() liefert nie denselben oder einen früheren Wert als zuvor — die
	//    deterministische Replay-Reihenfolge kann lokal nie kippen.
	// 3. Logisch (Audit 25. Juli): observeTime() zieht die Uhr auf jeden GESEHENEN fremden
	//    Zeitstempel hoch. Wer ein Event aus der „Zukunft“ importiert, vergibt danach
	//    garantiert größere Zeitstempel — eine Bearbeitung, die nachweislich NACH einer
	//    fremden Änderung passiert ist, gewinnt damit auch dann, wenn die eigene Uhr
	//    nachgeht. Genau diese Happens-before-Garantie fehlt reinem Wall-Clock-LWW.
	// Der Wert bleibt ein normaler ISO-String: kein Schema-Wechsel, alte Events und
	// ältere App-Versionen bleiben vollständig kompatibel.
	_clockOffsetMs: 0,
	_lastNowMs: 0,
	// Fremde Zeitstempel, die weiter als das in der Zukunft liegen, gelten als kaputte Uhr
	// und werden NICHT übernommen — sonst zöge ein einziges Gerät mit falsch gestelltem
	// Jahr die logische Uhr aller anderen dauerhaft mit sich.
	_maxAdoptAheadMs: 864e5, // 24 h
	setClockOffset(ms) { U._clockOffsetMs = Number(ms) || 0; },
	now: () => {
		let t = Date.now() - U._clockOffsetMs;
		if (t <= U._lastNowMs) t = U._lastNowMs + 1;
		U._lastNowMs = t;
		return new Date(t).toISOString();
	},
	// Vor dem Verarbeiten importierter Events aufrufen. true = Zeitstempel übernommen.
	observeTime(iso) {
		const ms = Date.parse(iso);
		if (!Number.isFinite(ms)) return false;
		if (ms > Date.now() - U._clockOffsetMs + U._maxAdoptAheadMs) return false;
		if (ms > U._lastNowMs) U._lastNowMs = ms;
		return true;
	},
	observeTimes(list) {
		let n = 0;
		for (const ev of list || []) if (ev && ev.t && U.observeTime(ev.t)) n++;
		return n;
	},

	// PERF (Audit 21. Juli): esc() ist die heißeste Funktion der UI — jeder Render baut
	// damit jede Zeile/jeden Titel. Fast-Path: Strings ohne Sonderzeichen (der Normalfall)
	// unverändert zurückgeben; Ersetzungs-Map einmal anlegen statt pro Treffer ein neues
	// Objekt-Literal zu erzeugen.
	_escTest: /[&<>"']/,
	_escMap: { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" },
	esc: (s) => {
		s = String(s ?? "");
		return U._escTest.test(s) ? s.replace(/[&<>"']/g, (c) => U._escMap[c]) : s;
	},

	// ---- morph(): DOM angleichen statt wegwerfen (Audit 25. Juli) ----
	// PROBLEM: Die ganze App rendert mit `el.innerHTML = html`. Damit stirbt bei JEDEM
	// Render alles, was im DOM lebt: Fokus, Cursor-Position, Scroll-Stand, offene
	// <details>, laufende Videos, positionierte Menüs, gerenderte KaTeX-/hljs-Knoten,
	// erzeugte Blob-URLs. render.js und editor.js retten das anschließend mit ~17
	// Sonderfällen von Hand wieder ein (setHtmlIfChanged, isProtectedFocus,
	// _mainRenderPending, keepPageScroll, CHATLOG_CACHE, scrollReserve, …).
	//
	// LÖSUNG: Was nicht ersetzt wird, muss auch nicht gerettet werden. morph() vergleicht
	// das neue HTML kindweise mit dem bestehenden DOM und fasst nur an, was sich wirklich
	// geändert hat. Kein Virtual DOM, keine Abhängigkeit, ~120 Zeilen.
	//
	// REGELN:
	// - Gleicher Tag + gleiches data-key  → Knoten wiederverwenden, nur Attribute/Text angleichen.
	// - Kein data-key                     → Position entscheidet (gleicher Tag = wiederverwenden).
	// - Unterschiedlich                   → ersetzen (wie bisher).
	// - data-owned="1"                    → Teilbaum gehört einem Modul (Heft-Canvas,
	//                                       #blockEditor, <video>): NIE anfassen. Ersetzt
	//                                       sechs Sonderfälle durch ein Attribut.
	// - Fokussierte Eingabefelder behalten value/Cursor, solange der Knoten überlebt.
	//
	// Rückgabe: true, wenn irgendetwas geändert wurde (nützlich für Folgeschritte wie
	// hydrate() oder POPOVERS.position).
	// Attribute, die Module NACH dem Rendern selbst setzen (Hydrierung). Sie stehen nie
	// im frisch erzeugten HTML — morph dürfte sie deshalb nicht als „entfernt“ behandeln,
	// sonst liefe jede Hydrierung (Bild-Blob, KaTeX, Video) bei jedem Render erneut.
	// „src“ fehlt hier absichtlich: Module setzen es nur an Knoten, die sie beim
	// Hydrieren als solche markieren (Bild-Blobs, Cover) — genau die sind unten
	// ausgenommen. Pauschales Bewahren machte jedes src UNLÖSCHBAR: ein <iframe>
	// (#pdfFrame) behielt für immer die zuletzt gesetzte Datei.
	// „data-hl-len“ gehört dazu: highlightCode() merkt sich damit, welcher Codeblock schon
	// eingefärbt ist — würde morph die Marke entfernen, liefe die Einfärbung wieder bei jedem Frame.
	_morphKeepAttrs: new Set(["data-hydrated", "data-owned", "data-cover-hydrated", "data-mermaid-done", "data-hl-len"]),
	morph(el, html) {
		if (!el) return false;
		const tpl = document.createElement("template");
		tpl.innerHTML = String(html ?? "");
		return U._morphChildren(el, tpl.content);
	},
	_morphKey(node) {
		return node.nodeType === 1 ? (node.getAttribute("data-key") || null) : null;
	},
	_morphChildren(oldParent, newParent) {
		let changed = false;
		// Index der vorhandenen Kinder mit data-key — erlaubt Umsortieren ohne Neubau.
		const keyed = new Map();
		for (const child of oldParent.childNodes) {
			const k = U._morphKey(child);
			if (k != null && !keyed.has(k)) keyed.set(k, child);
		}
		let cursor = oldParent.firstChild;
		for (const wanted of [...newParent.childNodes]) {
			const key = U._morphKey(wanted);
			let match = null;
			if (key != null && keyed.has(key)) {
				const cand = keyed.get(key);
				if (cand.nodeName === wanted.nodeName) match = cand;
			} else if (cursor && cursor.nodeName === wanted.nodeName && U._morphKey(cursor) == null && key == null) {
				match = cursor;
			}
			if (match) {
				if (match !== cursor) { oldParent.insertBefore(match, cursor); changed = true; }
				if (U._morphNode(match, wanted)) changed = true;
				cursor = match.nextSibling;
				if (key != null) keyed.delete(key);
			} else {
				oldParent.insertBefore(wanted, cursor);
				changed = true;
			}
		}
		// Übrig gebliebene alte Kinder entfernen.
		while (cursor) {
			const next = cursor.nextSibling;
			cursor.remove();
			changed = true;
			cursor = next;
		}
		return changed;
	},
	_morphNode(oldNode, newNode) {
		if (oldNode.nodeType === 3 || oldNode.nodeType === 8) {
			if (oldNode.nodeValue !== newNode.nodeValue) { oldNode.nodeValue = newNode.nodeValue; return true; }
			return false;
		}
		if (oldNode.nodeType !== 1) return false;
		// Teilbaum gehört einem Modul — komplett in Ruhe lassen (Canvas, Editor, Video).
		if (oldNode.dataset && oldNode.dataset.owned) return false;
		let changed = false;
		// Attribute angleichen
		for (const a of [...newNode.attributes]) {
			if (oldNode.getAttribute(a.name) !== a.value) { oldNode.setAttribute(a.name, a.value); changed = true; }
		}
		for (const a of [...oldNode.attributes]) {
			if (newNode.hasAttribute(a.name) || U._morphKeepAttrs.has(a.name)) continue;
			// Hydrierte Blob-URLs überleben, fremde src-Reste nicht.
			if (a.name === "src" && (oldNode.dataset.hydrated || oldNode.dataset.coverHydrated)) continue;
			oldNode.removeAttribute(a.name);
			changed = true;
		}
		// Formularzustand nicht über Attribute zerstören (der Nutzer tippt evtl. gerade).
		if (oldNode === document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(oldNode.tagName)) return changed;
		// INPUT *und* TEXTAREA: sobald ein Feld einmal eine „dirty value“ hat, gewinnt sie
		// gegen den Textknoten. Der Seitentitel (#pageTitle) ist ein <textarea> und zeigte
		// nach einer Umbenennung von außen (Sync, KI-Tool) weiter den alten Namen.
		if (/^(INPUT|TEXTAREA)$/.test(oldNode.tagName) && oldNode.value !== newNode.value) { oldNode.value = newNode.value; changed = true; }
		// contenteditable-Inhalte gehören dem Editor, solange der Cursor drin steht.
		if (oldNode.isContentEditable && oldNode.contains(document.activeElement)) return changed;
		if (U._morphChildren(oldNode, newNode)) changed = true;
		return changed;
	},

	// Bequemer Ersatz für `el.innerHTML = html` an allen Render-Stellen.
	setHtml(el, html) { return U.morph(el, html); },

	debounce(fn, ms) {
		let timer;
		return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
	},

	el: (id) => document.getElementById(id),

	// Sicherer DOM-Bau statt innerHTML-String-Konkatenation (XSS-anfällig, sobald ein
	// U.esc() vergessen wird): U.h("button", { id: "x", class: "danger", onclick: fn }, "Label").
	// Strings werden Textknoten (automatisch escaped), Elemente werden angehängt,
	// on*-Funktionen werden als Event-Listener registriert, true/false/null steuern
	// Attribute. Für neue Dialoge bevorzugen — U.confirm() unten ist die Referenz.
	h(tag, attrs, ...children) {
		const node = document.createElement(tag);
		for (const [k, v] of Object.entries(attrs || {})) {
			if (v == null || v === false) continue;
			if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
			else if (v === true) node.setAttribute(k, "");
			else node.setAttribute(k, String(v));
		}
		for (const c of children.flat()) {
			if (c != null) node.append(c.nodeType ? c : String(c));
		}
		return node;
	},

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
			// Referenz-Umsetzung für U.h(): DOM-Bau statt innerHTML-Strings — Texte sind
			// automatisch escaped, kein vergessenes U.esc() mehr möglich.
			o.innerHTML = "";
			o.appendChild(U.h("div", { class: "modal modal-sm" },
				U.h("h3", null, title),
				U.h("p", { class: "hint", style: "white-space:pre-wrap" }, String(message ?? "")),
				U.h("div", { class: "modal-actions" },
					U.h("button", { type: "button", id: "dlgConfirmCancel" }, cancelLabel),
					U.h("button", { type: "button", id: "dlgConfirmOk", class: danger ? "danger" : null }, okLabel))));
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
				delete o._close;
				o.hidden = true;
				o.innerHTML = "";
				resolve(ok);
			};
			// VERTRAG mit dem Hintergrund-Klick in popovers.js: wer das #overlay belegt,
			// hinterlegt hier seinen EINEN Schließweg. Vorher riss der Backdrop-Handler den
			// Dialog aus dem DOM, ohne finish() zu erreichen (dieser Dialog hat kein
			// #btnCloseOverlay) — das Promise wurde nie erfüllt und jedes `await U.confirm(…)`
			// hing für immer: Löschen & Co. taten danach lautlos nichts mehr.
			o._close = () => finish(false);
			U.el("dlgConfirmOk").addEventListener("click", () => finish(true));
			U.el("dlgConfirmCancel").addEventListener("click", () => finish(false));
			document.addEventListener("keydown", onKey, true);
			// Bei destruktiven Dialogen (danger) startet der Fokus auf „Abbrechen“ —
			// ein reflexhaftes Enter bestätigt so nie versehentlich das Löschen.
			const focusBtn = U.el(danger ? "dlgConfirmCancel" : "dlgConfirmOk");
			if (focusBtn) focusBtn.focus();
		});
	},

	// PERF (Audit 21. Juli): toLocaleDateString baut bei jedem Aufruf intern einen neuen
	// Intl-Formatter (teuer, läuft in jedem Listen-Render pro Zeile). Einen Formatter
	// wiederverwenden — identisches Format, ungültige Daten liefern wie bisher "Invalid Date".
	_dateFmt: new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }),
	fmtDate: (iso) => { const d = new Date(iso); return isNaN(d) ? "Invalid Date" : U._dateFmt.format(d); },

	// Farb-Syntax: {red}Text{/} → farbiger Text, {bg-yellow}Text{/} → Hintergrundfarbe.
	// Bleibt reiner Text im Markdown — Diffs, Sync, Verlauf und KI-Tools funktionieren unverändert.
	// Übrig gebliebene {/} (z.B. bei Verschachtelung) werden am Ende entfernt.
	// FIX (Audit): Inhalt innerhalb der Farb-Marker escapen, bevor er als HTML-Span landet
	// (sonst XSS, falls marked/DOMPurify offline/fehlend sind). Klassennamen bleiben [a-z]+.
	colorize: (s) => {
		const str = String(s ?? "");
		if (!str || !str.includes("{")) return str;
		return str
			.replace(/\{bg-([a-z]+)\}([\s\S]+?)\{\/\}/g, (_, c, t) => '<span class="hl-' + c + '">' + U.esc(t) + '</span>')
			.replace(/\{([a-z]+)\}([\s\S]+?)\{\/\}/g, (_, c, t) => '<span class="c-' + c + '">' + U.esc(t) + '</span>')
			.replace(/\{\/\}/g, "");
	},

	// Gemeinsamer Helfer für md()/mdInline(): ==markiert== → escapetes <mark>…</mark>,
	// danach Farb-Syntax. Vorher in beiden Funktionen fast identisch kopiert.
	_markHighlights(text) {
		const str = String(text ?? "");
		if (!str) return "";
		if (!str.includes("==") && !str.includes("{")) return str;
		if (!str.includes("==")) return U.colorize(str);
		return U.colorize(str.replace(/==([^=\n]+)==/g, (_, t) => "<mark>" + U.esc(t) + "</mark>"));
	},

	// 🧮 FIX (18. Juli, spät v2): LaTeX bulletproof. Formeln ($…$, $$…$$, \(…\),
	// \[…\]) werden VOR dem Markdown-Parser durch Platzhalter ersetzt und nach dem
	// Parsen unverändert wieder eingesetzt. Vorher zerpflückte marked die Formeln:
	// & wurde zu "&amp;" (sichtbar als "amp;" in Matrizen), \\ und \{ verloren
	// Backslashes, mehrzeilige $$…$$-Blöcke wurden in <p>/<li> zerteilt — KaTeX
	// fand die Delimiter dann nicht mehr. Code-Blöcke und Inline-Code bleiben
	// unangetastet (erste Regex-Alternative, dort wird nicht maskiert).
	_mathMaskRe: /(```[\s\S]*?(?:```|$)|`[^`\n]*`)|(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g,
	// Platzhalter-Marker: bisher lagen die Private-Use-Zeichen UNSICHTBAR direkt im
	// Quelltext ("") — Editoren, Copy/Paste oder Formatierer können solche Zeichen
	// still verschlucken, und im Diff sieht man sie nicht. Jetzt als sichtbare
	// \u-Escapes in benannten Konstanten (DRY: eine Definition, unten mitbenutzt).
	_mathTokL: String.fromCharCode(0xe000),
	_mathTokR: String.fromCharCode(0xe001),
	_maskMath(src) {
		const stash = [];
		const text = String(src ?? "").replace(U._mathMaskRe, (m, code) => {
			if (code) return code;
			stash.push(m);
			return U._mathTokL + (stash.length - 1) + U._mathTokR;
		});
		return { text, stash };
	},
	// escape=false liefert die Formel als Rohtext zurück (für Text-Fallbacks),
	// sonst HTML-escaped — KaTeX liest den escapeten Text später korrekt als
	// Klartext aus dem DOM (&amp; → &).
	_unmaskMath(html, stash, escape) {
		// DRY: exakt dieselben Marker-Konstanten wie _maskMath — Regex einmal lazy aufgebaut.
		U._mathUnmaskRe = U._mathUnmaskRe || new RegExp(U._mathTokL + "([0-9]+)" + U._mathTokR, "g");
		return String(html).replace(U._mathUnmaskRe, (_, i) => (escape === false ? stash[+i] || "" : U.esc(stash[+i] || "")));
	},

	// HTML gegen XSS bereinigen: DOMPurify (per CDN, liegt im Service-Worker-Precache).
	// Offline-Fallback (Audit 21. Juli): DOM-basierte Allowlist statt Regex — Regex-Filter
	// sind gegen die Browser-„Reparatur“ von kaputtem Markup prinzipiell umgehbar. Derselbe
	// Parser, der das HTML später rendert, entscheidet hier: gefährliche Container fliegen
	// samt Inhalt, unbekannte Tags werden zu Text entpackt, Attribute nur per Allowlist +
	// URL-Schema-Prüfung (https/mailto/relativ/#, data: nur für Bilder in src).
	_dropTags: new Set(["script", "style", "iframe", "object", "embed", "form", "link", "meta", "base", "noscript", "template"]),
	_safeTags: new Set(["a", "abbr", "b", "blockquote", "br", "code", "del", "details", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "s", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"]),
	_safeAttrs: new Set(["alt", "class", "colspan", "href", "rowspan", "src", "title"]),
	sanitize(html) {
		if (window.DOMPurify) return DOMPurify.sanitize(html);
		const body = new DOMParser().parseFromString(String(html ?? ""), "text/html").body;
		for (const el of [...body.querySelectorAll("*")]) {
			if (U._dropTags.has(el.localName)) { el.remove(); continue; }
			if (!U._safeTags.has(el.localName)) { el.replaceWith(...el.childNodes); continue; }
			for (const a of [...el.attributes]) {
				const urlOk = !/^(href|src)$/.test(a.name) || /^(https?:|mailto:|#|\.{0,2}\/|data:image\/)/i.test(a.value.trim());
				if (!U._safeAttrs.has(a.name) || !urlOk) el.removeAttribute(a.name);
			}
		}
		return body.innerHTML;
	},

	// Markdown → HTML. marked kommt per CDN; offline gibt es einen sicheren Fallback.
	// Unterstützt zusätzlich ==markiert== → <mark> und die Farb-Syntax (colorize).
	_mdCache: new Map(),
	md(text) {
		const src = String(text ?? "");
		// PERF-WURZEL: Beim Streamen landet JEDER Zwischenstand einer Antwort als eigener
		// Eintrag im Cache und verdrängte der Reihe nach die fertig gerenderten Verlaufsblasen —
		// nach einer langen Antwort musste praktisch der ganze Verlauf neu geparst werden.
		// Ein Treffer rutscht jetzt ans Ende: dauerhaft gelesene Blasen bleiben drin,
		// Zwischenstände (einmal gelesen, nie wieder) fliegen zuerst raus.
		if (U._mdCache.has(src)) {
			const hit = U._mdCache.get(src);
			U._mdCache.delete(src);
			U._mdCache.set(src, hit);
			return hit;
		}
		// 🧮 Formeln maskieren → Markdown parsen → Formeln 1:1 wieder einsetzen.
		const masked = U._maskMath(src);
		const raw = U._markHighlights(masked.text);
		if (!window.marked) {
			// FIX: Offline-Fallback NICHT cachen — sonst blieb der rohe <pre>-Text für
			// immer im Cache, auch nachdem marked (CDN) später doch noch geladen wurde.
			return "<pre>" + U.esc(U._unmaskMath(raw, masked.stash, false)) + "</pre>";
		}
		// `breaks: true` erzeugt <br>-Knoten innerhalb mehrzeiliger $$…$$-Blöcke.
		// KaTeX Auto-Render kann Delimiter nicht über solche DOM-Grenzen hinweg
		// erkennen; ohne erzwungene Soft-Breaks bleibt der LaTeX-Block zusammen.
		const html = U._unmaskMath(U.sanitize(marked.parse(raw, { breaks: false })), masked.stash);
		// Kleiner Cache: erspart erneutes Parsen bei jedem Voll-Render derselben Inhalte.
		// PERF (Audit 21. Juli): nur den ältesten Eintrag verdrängen statt clear() — das
		// Komplett-Leeren erzwang periodisch ein Neu-Parsen ALLER sichtbaren Inhalte in
		// einem Frame (spürbarer Ruckler in langen Chats).
		if (U._mdCache.size > 300) U._mdCache.delete(U._mdCache.keys().next().value);
		U._mdCache.set(src, html);
		return html;
	},

	// Nur Inline-Markdown (einzelne Zeile, ohne <p>-Wrapper) — für Blockzeilen
	// im Block-Editor (Überschriften, Listenpunkte, To-dos).
	mdInline(text) {
		// 🧮 gleiche Formel-Maskierung wie in md() — auch einzeilige Blockzeilen
		// (Listenpunkte, Überschriften) enthalten oft $…$ mit _ ^ & \\.
		const masked = U._maskMath(text);
		const raw = U._markHighlights(masked.text);
		if (window.marked && marked.parseInline) {
			try { return U._unmaskMath(U.sanitize(marked.parseInline(raw, { breaks: true })), masked.stash); } catch { /* Fallback unten */ }
		}
		return U.esc(U._unmaskMath(raw, masked.stash, false));
	},

	hasMathDelimiters(el) {
		if (!el) return false;
		if (el.tagName === "CODE" || el.tagName === "PRE") return false;
		const txt = el.textContent || "";
		if (!txt.trim()) return false;
		// Präzise Formel-Erkennung: $$...$$, \(...\), \[...\] oder $...$ (vermeidet $10, 10$ & Code-Fehlauslösungen)
		const mathRegex = /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|(?:\$[^$\s\n][^$]*?[^$\s\n]\$)/;
		return mathRegex.test(txt);
	},

	// Eine race-sichere Ladequelle für alle KaTeX-Nutzer. Direkte Renderer
	// brauchen katex.render(), Markdown-Bereiche zusätzlich renderMathInElement().
	// Beides wird gemeinsam bereitgestellt, damit kein Bereich mehr vom zufälligen
	// Ladezeitpunkt eines anderen abhängt.
	_katexReady: null,
	async ensureKatex() {
		if (typeof window === "undefined") return false;
		if (!U._katexReady) {
			U._katexReady = (async () => {
				await U.loadStyle(OPTIONAL_MODULE_URLS.katexCss);
				await U.loadScript(OPTIONAL_MODULE_URLS.katex, "katex");
				await U.loadScript(OPTIONAL_MODULE_URLS.katexAutoRender, "renderMathInElement");
				return !!(window.katex && window.renderMathInElement);
			})();
		}
		try {
			return await U._katexReady;
		} catch (err) {
			// Nach einem vorübergehenden Netz-/Cachefehler darf ein späterer Render neu versuchen.
			U._katexReady = null;
			if (U.toast && !U._katexToastShown) {
				U._katexToastShown = true;
				U.toast("Formel-Engine (KaTeX) konnte nicht geladen werden.", "error");
			}
			return false;
		}
	},

	// LaTeX live rendern: $...$ / $$...$$ / \(...\) / \[...\] in einem DOM-Element.
	// throwOnError:false, damit unfertige Formeln während des Streamens nicht crashen.
	async renderMath(el) {
		if (!el) return;
		if (!U.hasMathDelimiters(el)) return;
		if (!(await U.ensureKatex())) return;
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
	async highlightCode(el) {
		if (!el) return;
		U.renderMermaid(el);
		// Kopier-Knopf an jedem Codeblock (idempotent; funktioniert auch ohne hljs)
		el.querySelectorAll("pre").forEach((pre) => {
			const code = pre.querySelector("code");
			if (!code || code.classList.contains("language-mermaid") || pre.querySelector(".code-copy")) return;
			const btn = document.createElement("button");
			btn.type = "button"; btn.className = "code-copy"; btn.dataset.codecopy = "1";
			btn.title = "Code kopieren";
			btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
			pre.appendChild(btn);
		});
		const hasCode = !!el.querySelector("pre code:not(.language-mermaid)");
		if (!hasCode) return;
		if (!window.hljs) {
			try {
				await U.loadStyle(OPTIONAL_MODULE_URLS.highlightCss);
				await U.loadScript(OPTIONAL_MODULE_URLS.highlight, "hljs");
			} catch (err) {
				if (U.toast && !U._hlToastShown) {
					U._hlToastShown = true;
					U.toast("Code-Highlighting (highlight.js) konnte nicht geladen werden.", "error");
				}
				return;
			}
		}
		if (!window.hljs) return;
		el.querySelectorAll("pre code").forEach((block) => {
			if (block.classList.contains("language-mermaid")) return;
			// PERF-WURZEL: Bisher wurde bei JEDEM Streaming-Frame JEDER Codeblock des gesamten
			// Verlaufs neu eingefärbt — in langen Chats der teuerste Einzelposten. Die Textlänge
			// dient als Marke: der wachsende letzte Block wird weiter aktualisiert, längst
			// abgeschlossene Blöcke bleiben unangetastet.
			const len = String((block.textContent || "").length);
			if (block.dataset.hlLen === len) return;
			block.dataset.hlLen = len;
			// hljs verweigert ein zweites Einfärben, solange diese Marke steht — beim wachsenden
			// Block wäre die Färbung sonst nach dem ersten Frame für immer eingefroren.
			delete block.dataset.highlighted;
			try { hljs.highlightElement(block); } catch { /* ignorieren */ }
		});
	},

	// Mermaid-Diagramme rendern: ```mermaid-Codeblöcke → SVG (dunkles Theme).
	// Fehlertolerant: während des KI-Streamens unvollständige Diagramme bleiben
	// als Codeblock stehen und werden erst gerendert, wenn die Syntax gültig ist.
	async renderMermaid(el) {
		if (!el) return;
		const blocks = el.querySelectorAll("pre code.language-mermaid");
		if (!blocks.length) return;
		if (!window.mermaid) {
			blocks.forEach((b) => {
				const pre = b.closest("pre");
				if (pre && !pre.querySelector(".mermaid-status")) {
					const status = document.createElement("div");
					status.className = "mermaid-status";
					status.style.cssText = "font-size:12px;opacity:0.7;padding:4px 0;";
					status.textContent = "⏳ Diagramm-Engine wird geladen…";
					pre.insertBefore(status, b);
				}
			});
			try {
				await U.loadScript(OPTIONAL_MODULE_URLS.mermaid, "mermaid");
			} catch {
				blocks.forEach((b) => {
					const pre = b.closest("pre");
					if (pre) {
						const st = pre.querySelector(".mermaid-status");
						if (st) st.textContent = "📶 Internetverbindung erforderlich, um Diagramm-Engine zum ersten Mal zu laden.";
					}
				});
				return;
			}
		}
		if (!window.mermaid) return;
		if (!U._mermaidInit) {
			U._mermaidInit = true;
			try { mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict", fontFamily: "inherit" }); } catch { /* ignorieren */ }
		}
		blocks.forEach(async (block) => {
			const pre = block.closest("pre");
			if (!pre || pre.dataset.mermaidDone) return;
			const src = block.textContent || "";
			if (!src.trim()) return;
			pre.dataset.mermaidDone = "1";
			const st = pre.querySelector(".mermaid-status");
			if (st) st.remove();
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

	// Bild-Dateiauswahl-Dialog (Cover-Upload kam vorher zweimal fast wortgleich vor:
	// app.js fürs Editor-Cover, library.js fürs Bibliotheks-Cover). Liefert die
	// gewählte Datei oder null, wenn der Dialog ohne Auswahl geschlossen wird.
	pickImageFile: () => new Promise((resolve) => {
		const inp = document.createElement("input");
		inp.type = "file";
		inp.accept = "image/*";
		inp.onchange = () => resolve((inp.files && inp.files[0]) || null);
		inp.click();
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

	// ── Scroll-Anker (26. Juli) ───────────────────────────────────────────────
	// EINE zentrale Stelle für das Problem "Ansicht springt beim Neu-Aufbauen nach
	// oben". Die Ursache war überall dieselbe: während eines Rebuilds schrumpft
	// scrollHeight kurz, der Browser klemmt scrollTop auf einen kleineren Wert und
	// stellt ihn danach nicht wieder her. Vorher wurde das in render.js (Home,
	// Chat-Log, Chat-Cache) und heft.js jeweils einzeln nachgebessert — jede neue
	// Ansicht brachte den Bug damit von Neuem mit.
	// REGEL für neuen Code: wer innerHTML / replaceChildren / U.morph auf einen
	// scrollbaren Bereich anwendet, klammert das in U.keepScroll(el, () => { … }).
	scrollHost(el) {
		for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
			const oy = getComputedStyle(n).overflowY;
			if ((oy === "auto" || oy === "scroll" || oy === "overlay") && n.scrollHeight > n.clientHeight + 1) return n;
		}
		return el && el.nodeType === 1 ? el : null;
	},
	// target: Element ODER Funktion, die das Element liefert. Die Funktionsform ist
	// wichtig, wenn der Container beim Rebuild ersetzt wird — dann wird er beim
	// Wiederherstellen neu gesucht statt auf einer Leiche zu scrollen.
	// bottomPad > 0: wer näher als so viele px am Ende stand, folgt dem NEUEN Ende
	// (Chat-Verhalten) statt an der alten Pixelposition zu kleben.
	scrollAnchor(target, { bottomPad = 0 } = {}) {
		const pick = typeof target === "function" ? target : () => target;
		const host0 = U.scrollHost(pick());
		const top = host0 ? host0.scrollTop : 0;
		const atBottom = !!host0 && bottomPad > 0 && host0.scrollHeight - top - host0.clientHeight < bottomPad;
		const apply = () => {
			const h = host0 && host0.isConnected ? host0 : U.scrollHost(pick());
			if (!h) return;
			if (atBottom) { if (h.scrollTop !== h.scrollHeight) h.scrollTop = h.scrollHeight; return; }
			if (top && h.scrollTop !== top) h.scrollTop = top;
		};
		const restore = () => {
			apply();
			// Bilder, Canvas und LaTeX liefern ihre Höhe erst in den nächsten Frames —
			// bis dahin würde der Browser die alte Position wieder wegklemmen.
			if (typeof requestAnimationFrame === "function")
				requestAnimationFrame(() => { apply(); requestAnimationFrame(apply); });
		};
		restore.top = top;
		restore.atBottom = atBottom;
		return restore;
	},
	// Bequeme Klammer: Position merken → DOM ändern → Position wiederherstellen.
	keepScroll(target, mutate, opts) {
		const restore = U.scrollAnchor(target, opts);
		try { return mutate(); } finally { restore(); }
	},

	// ── Gummi-Kurve (26. Juli) ─────────────────────────────────────────────
	// EINE Kurve für alles, was sich "wie GoodNotes" anfühlen soll: schnell los,
	// weich aus, KEIN Überschwingen: der Gummi-Effekt wurde am 26. Juli getestet und
	// wieder entfernt — er wirkte unruhig. Ruhig auslaufen + längere Dauer ist das,
	// was sich richtig anfühlt.
	easeOutCubic(t) {
		const p = 1 - t;
		return 1 - p * p * p;
	},
	// Läuft dur ms und ruft step(t, eased) je Frame. Rückgabe bricht ab.
	animate(dur, step, ease) {
		if (typeof requestAnimationFrame !== "function") { step(1, 1); return () => {}; }
		const f = ease || U.easeOutCubic;
		const t0 = performance.now();
		let raf = 0, stopped = false;
		const tick = (now) => {
			if (stopped) return;
			const t = Math.min(1, (now - t0) / Math.max(1, dur));
			step(t, t >= 1 ? 1 : f(t));
			if (t < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => { stopped = true; if (raf) cancelAnimationFrame(raf); };
	},
};
