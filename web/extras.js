"use strict";
import { U } from "./util.js";
import { S, STATE } from "./state.js";
import { RENDER } from "./render.js";
import { SETTINGS } from "./settings.js";
import { NLM } from "./notebooklm.js";
import { POPOVERS } from "./popovers.js";
// extras.js — Ausbau-Modul, läuft bewusst NACH app.js:
// • Cloze-Karten (Lückentexte) + Karten aus ==Markierungen==
// • Review-Undo, Stapel-Optionen (Tageslimits, Leech), CSV/.apkg-Import & -Export
// • Seiten-PDF-Export (HTML-Knöpfe kommen aus render.js, Verhalten von hier)
// • Multi-Tab-Schutz: Events werden per BroadcastChannel live abgeglichen
// • Mobile: KI-Panel als Vollbild-Overlay statt komplett ausgeblendet
// Alle neuen Knöpfe laufen über eine EIGENE Event-Delegation (data-*-Attribute),
// damit bestehende Handler in app.js unangetastet bleiben.
const render = (...args) => RENDER.render(...args);
export const EXTRAS = (() => {
	// Cloze-Marker zusammengesetzt statt wörtlich, damit die doppelt geschweiften
	// Klammern nirgends mit Template-/Platzhalter-Systemen kollidieren.
	const CO = "{" + "{";
	const CC = "}" + "}";
	const clozeRe = () => /\{\{c(\d+)::([\s\S]*?)(?:::([^{}]*?))?\}\}/g;

	// ---- Zusätzliche Styles (Heatmap, Leech, Fußbereich, Mobile-Panel, Multi-Tab) ----
	const style = document.createElement("style");
	style.textContent = [
		".heatmap{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,10px);gap:2px;overflow-x:auto;padding:6px 0 14px;max-width:820px}",
		".heat-cell{width:10px;height:10px;border-radius:2px;background:rgba(128,128,128,.15)}",
		".heat-cell.l1{background:#1e4429}.heat-cell.l2{background:#2e6b39}.heat-cell.l3{background:#46a05c}.heat-cell.l4{background:#6ee07f}",
		".leech-badge{color:#e5534b;font-weight:600}",
		".retention-table{max-width:520px}",
		".page-footer{max-width:820px;margin:26px auto 60px;padding-top:10px;border-top:1px solid rgba(128,128,128,.25)}",
		".backlinks h4{margin:12px 0 6px}.backlinks .crumb{margin-right:14px;cursor:pointer}",
		".study-head button{margin-left:10px}",
		".study-counts b{font-weight:600}",
		".study-counts .cnt-learn{color:#6fc3ff}",
		".study-counts .cnt-due{color:#72bc8f}",
		".study-counts .cnt-new{color:#f2b02c}",
		".study-counts .cnt-wait{color:#e9a66b}",
		".study-keys{margin-left:10px;opacity:.65}",
		".study-wait{text-align:center;padding:28px 18px}",
		".study-countdown{font-size:1.35rem;margin:12px 0}",
		".grades button{position:relative}",
		".grade-key{display:block;font-size:11px;opacity:.55;margin-top:2px}",
		// Notion-artige Topbar (Teilen / ★ / ⋯) + Rückverweise-Chip + Tool-Chips im Chat
		".page-topbar{display:flex;align-items:center;gap:8px}.page-topbar .breadcrumb{flex:1;min-width:0}",
		".topbar-actions{display:flex;align-items:center;gap:2px}",
		".topbar-wrap{position:relative;display:inline-block}",
		".topbar-btn{background:none;border:none;padding:4px 9px;border-radius:6px;cursor:pointer;font-size:14px;color:inherit}.topbar-btn:hover{background:rgba(128,128,128,.15)}.topbar-btn.fav-active{color:#f2b02c}",
		".top-menu{position:absolute;right:0;top:110%;z-index:600;min-width:240px}",
		".backlinks-row{margin:2px 0 8px}.backlinks-chip{background:none;border:none;color:inherit;opacity:.65;cursor:pointer;padding:2px 4px;border-radius:4px;font-size:13px}.backlinks-chip:hover{background:rgba(128,128,128,.15);opacity:1}",
		".tool-chip{width:fit-content;font-size:12.5px;opacity:.75;background:rgba(128,128,128,.12);border-radius:8px;padding:4px 10px;margin:2px 0}.tool-chip.err{color:#e5534b}",
		".multitab-note{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;background:#3a2f14;color:#ffd66b;padding:10px 14px;border-radius:10px;z-index:1200;display:flex;gap:10px;align-items:center}",
		// Mobile: Panel nicht mehr verstecken, sondern als Vollbild-Overlay öffnen
		"@media (max-width:768px){body:not(.panel-collapsed) #panel{display:flex !important;position:fixed;inset:0;width:100vw;max-width:none;z-index:900}#btnShowPanel{display:block !important}}",
	].join("\n");
	document.head.appendChild(style);

	// ---- Multi-Tab: Events live zwischen Tabs abgleichen + einmalige Warnung ----
	const TAB_ID = U.uid();
	const bc = ("BroadcastChannel" in window) ? new BroadcastChannel("impala67") : null;
	let warned = false;
	function warnMultiTab() {
		if (warned) return;
		warned = true;
		const div = document.createElement("div");
		div.className = "multitab-note";
		div.innerHTML = "⚠️ Die App ist in einem weiteren Tab geöffnet. Änderungen werden live abgeglichen — trotzdem besser nur in einem Tab arbeiten. <button>OK</button>";
		div.querySelector("button").addEventListener("click", () => div.remove());
		document.body.appendChild(div);
	}
	if (bc) {
		bc.onmessage = (m) => {
			const d = m.data || {};
			if (d.from === TAB_ID) return;
			if (d.kind === "event") { STATE.reduce(d.ev); if (typeof render === "function") render(); }
			if (d.kind === "hello") { bc.postMessage({ kind: "here", from: TAB_ID }); warnMultiTab(); }
			if (d.kind === "here") warnMultiTab();
		};
		bc.postMessage({ kind: "hello", from: TAB_ID });
	}

	// ---- dispatch-Wrapper: Undo-Stapel füllen + Events an andere Tabs funken ----
	// (Das Event ist beim Eintreffen im anderen Tab bereits in IndexedDB gespeichert —
	// dort wird es nur noch auf den In-Memory-Zustand angewendet.)
	const origDispatch = STATE.dispatch;
	const undoStack = [];
	STATE.dispatch = async function (type, payload) {
		if (type === "cardReview" && payload && S.cards[payload.id]) {
			const c = S.cards[payload.id];
			undoStack.push({ id: payload.id, srs: JSON.parse(JSON.stringify(c.srs)), wasSuspended: !!c.suspended });
			if (undoStack.length > 50) undoStack.shift();
		}
		const ev = await origDispatch(type, payload);
		if (bc && ev) bc.postMessage({ kind: "event", ev, from: TAB_ID });
		return ev;
	};

	// ---- Review-Undo (Sitzung): letzte Bewertung rückgängig machen ----
	const canUndoReview = () => undoStack.length > 0;
	async function undoReview() {
		const u = undoStack.pop();
		if (!u || !S.cards[u.id]) return;
		await STATE.dispatch("cardReviewUndo", { id: u.id, srs: u.srs, unsuspend: !u.wasSuspended });
		S.reviewShowBack = false;
		if (typeof render === "function") render();
	}

	// ---- Cloze: pro Lücken-Nummer eine eigene Karte (wie Anki-Geschwisterkarten) ----
	function clozeIndexes(text) {
		const set = new Set();
		const re = clozeRe();
		let m;
		while ((m = re.exec(text))) set.add(Number(m[1]));
		return [...set].sort((a, b) => a - b);
	}
	const clozeFront = (text, idx) => text.replace(clozeRe(), (all, n, ans, hint) =>
		Number(n) === idx ? "**[" + (hint ? "…" + hint + "…" : "…") + "]**" : ans);
	const clozeBack = (text, idx) => text.replace(clozeRe(), (all, n, ans) =>
		Number(n) === idx ? "**==" + ans + "==**" : ans);
	async function createClozeCards(text, deck, pageId) {
		const idxs = clozeIndexes(text);
		for (const i of idxs) {
			await STATE.dispatch("cardCreate", {
				id: U.uid(), front: clozeFront(text, i), back: clozeBack(text, i),
				pageId: pageId || null, deck: deck || undefined,
				type: "cloze", cloze: { src: text, index: i },
			});
		}
		return idxs.length;
	}

	// ---- Karten aus ==Markierungen== und Cloze-Lücken einer Seite ----
	const hasClozeCard = (src) => Object.values(S.cards).some((c) => c.cloze && c.cloze.src === src);
	async function cardsFromHighlights(pageId) {
		const pg = S.pages[pageId];
		if (!pg) return 0;
		let n = 0;
		for (const line of (pg.content || "").split(/\n+/)) {
			const plain = line.replace(/^[\s>#*-]*(\[[ x]\]\s*)?/, "").trim();
			if (!plain) continue;
			if (clozeRe().test(plain)) {
				// Zeile enthält bereits explizite Cloze-Lücken
				if (!hasClozeCard(plain)) n += await createClozeCards(plain, S.ankiDeck || undefined, pageId);
				continue;
			}
			if (!/==[^=\n]+==/.test(plain)) continue;
			// ==Markierung== → Cloze-Lücke, der restliche Satz bleibt als Kontext stehen
			let i = 0;
			const src = plain.replace(/==([^=\n]+)==/g, (a, t) => CO + "c" + (++i) + "::" + t + CC);
			if (!hasClozeCard(src)) n += await createClozeCards(src, S.ankiDeck || undefined, pageId);
		}
		U.toast(n ? n + " Karteikarte(n) erstellt." : "Keine neuen Markierungen — für alle gibt es schon Karten.", n ? "success" : "info");
		return n;
	}

	// ---- CSV-Export/-Import (front;back;deck, "-Quotes wie üblich) ----
	const csvEscape = (s) => {
		s = String(s ?? "");
		return /[";\n\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	};
	function exportCsv() {
		const cards = Object.values(S.cards);
		const csv = "front;back;deck\n" + cards.map((c) => [c.front, c.back, c.deck || "Standard"].map(csvEscape).join(";")).join("\n");
		U.downloadText("impala67-karten.csv", csv);
	}
	function parseCsv(text) {
		const sep = text.includes("\t") ? "\t" : (text.split("\n")[0] || "").includes(";") ? ";" : ",";
		const rows = [];
		let row = [], cur = "", inQ = false;
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			if (inQ) {
				if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
				else cur += ch;
			} else if (ch === '"') inQ = true;
			else if (ch === sep) { row.push(cur); cur = ""; }
			else if (ch === "\n" || ch === "\r") {
				if (ch === "\r" && text[i + 1] === "\n") i++;
				row.push(cur); cur = "";
				if (row.some((x) => x !== "")) rows.push(row);
				row = [];
			} else cur += ch;
		}
		row.push(cur);
		if (row.some((x) => x !== "")) rows.push(row);
		return rows;
	}
	async function importCsvFile(file) {
		const text = await U.readAsText(file);
		let n = 0;
		for (const r of parseCsv(text)) {
			if (!r[0] || (r[0].toLowerCase() === "front" && (r[1] || "").toLowerCase() === "back")) continue;
			await STATE.dispatch("cardCreate", { id: U.uid(), front: r[0], back: r[1] || "", deck: (r[2] || S.ankiDeck || undefined) });
			n++;
		}
		U.toast(n + " Karten importiert.", "success");
	}

	// ---- sql.js bei Bedarf nachladen (nur für .apkg nötig, ~1 MB WASM) ----
	let sqlPromise = null;
	function loadSql() {
		if (!sqlPromise) {
			sqlPromise = new Promise((res, rej) => {
				const s2 = document.createElement("script");
				s2.src = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.min.js";
				s2.crossOrigin = "anonymous";
				s2.onload = () => res(initSqlJs({ locateFile: (f) => "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/" + f }));
				s2.onerror = () => rej(new Error("sql.js konnte nicht geladen werden (Internet nötig)."));
				document.head.appendChild(s2);
			});
		}
		return sqlPromise;
	}

	// ---- .apkg-Export: collection.anki2 (SQLite, Schema 11) + media-Manifest als ZIP ----
	const APKG_SCHEMA =
		"CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);" +
		"CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text);" +
		"CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text);" +
		"CREATE TABLE revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer);" +
		"CREATE TABLE graves (usn integer, oid integer, type integer);";
	async function exportApkg() {
		const SQL = await loadSql();
		const db = new SQL.Database();
		db.run(APKG_SCHEMA);
		const nowMs = Date.now();
		const nowSec = Math.floor(nowMs / 1000);
		const crt = nowSec - 400 * 86400; // Sammlungs-Start weit genug in der Vergangenheit
		const mid = 1600000000000;
		const model = {
			id: mid, name: "Impala67 Basic", type: 0, mod: nowSec, usn: -1, sortf: 0, did: 1,
			tmpls: [{ name: "Karte 1", ord: 0, qfmt: CO + "Front" + CC, afmt: CO + "FrontSide" + CC + "<hr id=answer>" + CO + "Back" + CC, bqfmt: "", bafmt: "", did: null }],
			flds: [{ name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20 }, { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 }],
			css: ".card{font-family:arial;font-size:20px;text-align:center;color:black;background-color:white}",
			latexPre: "", latexPost: "", req: [[0, "any", [0]]],
		};
		const baseDeck = { mod: nowSec, usn: -1, collapsed: false, desc: "", dyn: 0, conf: 1, extendNew: 10, extendRev: 50, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0] };
		const decks = { "1": { ...baseDeck, id: 1, name: "Default" } };
		const deckIds = {};
		[...new Set(Object.values(S.cards).map((c) => c.deck || "Standard"))].forEach((name, i) => {
			const id = 1000 + i;
			deckIds[name] = id;
			decks[String(id)] = { ...baseDeck, id, name };
		});
		const dconf = { "1": { id: 1, name: "Default", replayq: true, timer: 0, maxTaken: 60, autoplay: true, mod: 0, usn: -1, lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 }, rev: { perDay: 200, ease4: 1.3, ivlFct: 1, maxIvl: 36500, bury: false, minSpace: 1, fuzz: 0.05, hardFactor: 1.2 }, new: { delays: [1, 10], ints: [1, 4, 0], initialFactor: 2500, order: 1, perDay: 20, bury: false, separate: true } } };
		const conf = { nextPos: 1, estTimes: true, activeDecks: [1], sortType: "noteFld", timeLim: 0, sortBackwards: false, addToCur: true, curDeck: 1, newBury: true, newSpread: 0, dueCounts: true, curModel: String(mid), collapseTime: 1200 };
		db.run("INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)",
			[crt, nowSec, nowMs, JSON.stringify(conf), JSON.stringify({ [String(mid)]: model }), JSON.stringify(decks), JSON.stringify(dconf), "{}"]);
		const stmtN = db.prepare("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)");
		const stmtC = db.prepare("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
		let id = nowMs;
		let pos = 1;
		for (const c of Object.values(S.cards)) {
			id += 1;
			stmtN.run([id, U.uid().slice(0, 10), mid, nowSec, -1, "", (c.front || "") + "" + (c.back || ""), (c.front || "").slice(0, 80), 0, 0, ""]);
			const isNew = c.srs.state === "new";
			const dueDays = Math.max(0, Math.round((new Date(c.srs.due) - crt * 1000) / 864e5));
			stmtC.run([id, id, deckIds[c.deck || "Standard"] || 1, 0, nowSec, -1,
				isNew ? 0 : 2, c.suspended ? -1 : (isNew ? 0 : 2),
				isNew ? pos++ : dueDays, Math.max(1, Math.round(c.srs.stability || 0)), 2500,
				c.srs.reps || 0, c.srs.lapses || 0, 0, 0, 0, 0, ""]);
		}
		stmtN.free();
		stmtC.free();
		U.downloadBlob("impala67.apkg", U.zip([{ name: "collection.anki2", text: db.export() }, { name: "media", text: "{}" }]));
	}

	// ---- Minimaler ZIP-Reader (Gegenstück zu U.zip — das kann nur schreiben):
	// Central Directory lesen; Methode 0 = gespeichert, 8 = deflate via DecompressionStream. ----
	async function unzip(buf) {
		const u8 = new Uint8Array(buf);
		const dv = new DataView(buf);
		let eocd = -1;
		for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
			if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
		}
		if (eocd < 0) throw new Error("Kein gültiges ZIP-Archiv.");
		const count = dv.getUint16(eocd + 10, true);
		let off = dv.getUint32(eocd + 16, true);
		const out = {};
		for (let n = 0; n < count; n++) {
			if (dv.getUint32(off, true) !== 0x02014b50) break;
			const method = dv.getUint16(off + 10, true);
			const compSize = dv.getUint32(off + 20, true);
			const nameLen = dv.getUint16(off + 28, true);
			const extraLen = dv.getUint16(off + 30, true);
			const cmtLen = dv.getUint16(off + 32, true);
			const lho = dv.getUint32(off + 42, true);
			const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nameLen));
			// Lokaler Header hat EIGENE Name-/Extra-Längen (können vom Central Directory abweichen)
			const dataStart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
			const data = u8.slice(dataStart, dataStart + compSize);
			if (method === 0) out[name] = data;
			else if (method === 8) out[name] = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
			off += 46 + nameLen + extraLen + cmtLen;
		}
		return out;
	}

	// HTML aus Anki-Feldern in Klartext/Markdown-tauglichen Text umwandeln
	const stripHtml = (s) => {
		const d = document.createElement("div");
		d.innerHTML = String(s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/div>\s*<div>/gi, "\n");
		return (d.textContent || "").trim();
	};

	// ---- .apkg-Import: collection.anki2/anki21 lesen, Notizen → cardCreate-Events ----
	async function importApkgFile(file) {
		const SQL = await loadSql();
		const files = await unzip(await U.readAsBuffer(file));
		const colFile = files["collection.anki21"] || files["collection.anki2"];
		if (!colFile) {
			U.toast("Keine collection.anki2 im Archiv — das neue .apkg-Format (anki21b, zstd-komprimiert) wird nicht unterstützt. In Anki beim Export „Support older Anki versions“ anhaken.", "error");
			return;
		}
		const db = new SQL.Database(colFile);
		const deckMap = {};
		try {
			const d = JSON.parse(db.exec("SELECT decks FROM col")[0].values[0][0]);
			Object.values(d).forEach((x) => { deckMap[x.id] = String(x.name || "Import").replace(/\//g, "::"); });
		} catch (e) { console.warn("Stapel-Namen nicht lesbar:", e); }
		// Cloze-Notizen haben mehrere Karten je Notiz — ord 0 reicht für den Text
		const res = db.exec("SELECT n.flds, c.did FROM notes n JOIN cards c ON c.nid = n.id AND c.ord = 0");
		let n = 0;
		for (const rowv of ((res[0] && res[0].values) || [])) {
			const flds = String(rowv[0]).split("");
			const front = stripHtml(flds[0]);
			if (!front) continue;
			await STATE.dispatch("cardCreate", {
				id: U.uid(), front,
				back: stripHtml(flds.slice(1).join("\n\n")),
				deck: deckMap[rowv[1]] || "Import",
			});
			n++;
		}
		db.close();
		U.toast(n + " Karten importiert (Bilder/Audio werden nicht übernommen).", "success");
	}

	// ---- Stapel-Optionen-Dialog: Tageslimits + Leech-Verhalten (settingsSet-Event) ----
	function openDeckConf(deck) {
		const key = deck || "*";
		const conf = STATE.deckConfOf(key === "*" ? "" : key);
		const o = U.el("overlay");
		o.hidden = false;
		o.innerHTML = '<div class="modal"><h3>⚙️ Stapel-Optionen — ' + U.esc(key === "*" ? "Standardwerte (alle Stapel)" : key) + "</h3>" +
			'<div><label for="dcNew">Neue Karten pro Tag</label><input id="dcNew" type="number" min="0" value="' + conf.newPerDay + '"></div>' +
			'<div><label for="dcRev">Wiederholungen pro Tag</label><input id="dcRev" type="number" min="0" value="' + conf.revPerDay + '"></div>' +
			'<div><label for="dcLeech">Leech-Schwelle (Fehler bis zur Markierung)</label><input id="dcLeech" type="number" min="1" value="' + conf.leechThreshold + '"></div>' +
			'<div><label for="dcLeechAct">Leech-Aktion</label><select id="dcLeechAct">' +
				'<option value="suspend"' + (conf.leechAction === "suspend" ? " selected" : "") + ">Karte aussetzen</option>" +
				'<option value="mark"' + (conf.leechAction === "mark" ? " selected" : "") + ">Nur markieren</option></select></div>" +
			'<p class="hint">Unterstapel erben die Einstellungen ihres Eltern-Stapels; „*“ gilt für alle.</p>' +
			'<div class="modal-actions"><button id="btnDeckConfSave">Speichern</button><button id="btnCloseOverlay">Abbrechen</button></div></div>';
		U.el("btnDeckConfSave").addEventListener("click", async () => {
			const dc = { ...(S.settings.deckConf || {}) };
			dc[key] = {
				newPerDay: Math.max(0, Number(U.el("dcNew").value) || 0),
				revPerDay: Math.max(0, Number(U.el("dcRev").value) || 0),
				leechThreshold: Math.max(1, Number(U.el("dcLeech").value) || 8),
				leechAction: U.el("dcLeechAct").value,
			};
			await STATE.dispatch("settingsSet", { deckConf: dc });
			o.hidden = true;
		});
	}

	// ---- Import-/Export-Dialog (CSV + .apkg) ----
	function openAnkiIo(mode) {
		const o = U.el("overlay");
		o.hidden = false;
		if (mode === "export") {
			o.innerHTML = '<div class="modal"><h3>⬆ Karten exportieren</h3>' +
				'<p class="hint">.apkg lädt beim ersten Mal sql.js nach (einmalig Internet nötig, wird danach gecacht).</p>' +
				'<div class="row-btns"><button id="btnExpCsv">CSV (front;back;deck)</button><button id="btnExpApkg">Anki-Paket (.apkg)</button></div>' +
				'<div class="modal-actions"><button id="btnCloseOverlay">Schließen</button></div></div>';
			U.el("btnExpCsv").addEventListener("click", exportCsv);
			U.el("btnExpApkg").addEventListener("click", () => exportApkg().catch((e) => U.toast("Export fehlgeschlagen: " + (e.message || e), "error")));
		} else {
			o.innerHTML = '<div class="modal"><h3>⬇ Karten importieren</h3>' +
				'<p class="hint">CSV (front;back;deck — Trennzeichen ; , oder Tab) oder Anki-Paket (.apkg, Text der Felder ohne Medien).</p>' +
				'<div class="row-btns"><button id="btnPickImport">Datei wählen…</button></div>' +
				'<div class="modal-actions"><button id="btnCloseOverlay">Schließen</button></div></div>';
			U.el("btnPickImport").addEventListener("click", () => {
				const inp = document.createElement("input");
				inp.type = "file";
				inp.accept = ".csv,.tsv,.txt,.apkg";
				inp.addEventListener("change", async () => {
					const f = inp.files[0];
					if (!f) return;
					o.hidden = true;
					try {
						if (/\.apkg$/i.test(f.name)) await importApkgFile(f);
						else await importCsvFile(f);
						if (typeof render === "function") render();
					} catch (e) { U.toast("Import fehlgeschlagen: " + (e.message || e), "error"); }
				});
				inp.click();
			});
		}
	}

	// ---- Seite als PDF exportieren: Druckfenster mit gerendertem Markdown ----
	function exportPagePdf(pageId) {
		const pg = S.pages[pageId];
		if (!pg) return;
		const w = window.open("", "_blank");
		if (!w) { U.toast("Popup blockiert — bitte für diese Seite erlauben.", "error"); return; }
		w.document.write("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + U.esc(pg.title) + "</title>" +
			'<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">' +
			"<style>body{font:15px/1.6 -apple-system,'Segoe UI',Roboto,sans-serif;color:#111;max-width:760px;margin:40px auto;padding:0 24px}h1{margin-top:0}pre{background:#f5f5f5;padding:10px;border-radius:6px;overflow:auto}mark{background:#ffe58a}img{max-width:100%}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:12px;color:#555}</style>" +
			"</head><body><h1>" + U.esc((pg.icon ? pg.icon + " " : "") + pg.title) + "</h1>" + U.md(pg.content || "") + "</body></html>");
		w.document.close();
		setTimeout(() => { try { w.focus(); w.print(); } catch (e) { console.warn(e); } }, 600);
	}

	// ---- Cloze-Hilfen für den Karten-Editor (render.js openCardEditor) ----
	function clozeWrapSelection() {
		const ta = U.el("cardFront");
		if (!ta) return;
		const a = ta.selectionStart, b = ta.selectionEnd;
		const sel = ta.value.slice(a, b) || "Antwort";
		const next = (ta.value.match(/\{\{c(\d+)::/g) || []).length + 1;
		ta.value = ta.value.slice(0, a) + CO + "c" + next + "::" + sel + CC + ta.value.slice(b);
		ta.focus();
	}
	async function clozeSaveFromEditor() {
		const front = U.el("cardFront") ? U.el("cardFront").value : "";
		// Gleicher Stapel-Pfad wie der normale Karten-Editor (Select + optionaler neuer Name)
		let deck = "Standard";
		const reader = (typeof window !== "undefined" && (window.readCardEditorDeck || (window.RENDER_ANKI && window.RENDER_ANKI.readCardEditorDeck))) || null;
		if (reader) deck = reader();
		else if (U.el("cardDeck")) {
			const v = U.el("cardDeck").value;
			deck = v === "__new__" ? ((U.el("cardDeckNew") || {}).value || "").trim() || "Standard" : (v || "Standard");
		}
		const n = await createClozeCards(front, deck, S.currentPageId);
		if (!n) { U.toast("Keine Cloze-Lücken gefunden — erst Text markieren und „Lücke einfügen“ klicken.", "error"); return; }
		U.el("overlay").hidden = true;
		if (typeof render === "function") render();
	}

	// ---- Teilen-Menü: Markdown-Export & interner Link ----
	function exportPageMd(pageId) {
		const pg = S.pages[pageId];
		if (!pg) return;
		const safe = String(pg.title || "Seite").replace(/[\\/:*?"<>|#]/g, "_").trim().slice(0, 80) || "Seite";
		U.downloadText(safe + ".md", "# " + pg.title + "\n\n" + (pg.content || ""));
	}

	// ---- NotebookLM als „eigener Tab“ (aus index.html hierher verschoben — Modul statt Inline-Script) ----
	// Google blockiert das Einbetten per iframe (X-Frame-Options/CSP), daher eigenes Fenster:
	// in der Tauri-App ein natives App-Fenster, sonst System-Browser bzw. randarmes Popup.
	// Hinweis Tauri v2: das native Fenster braucht die Capability "core:webview:allow-create-webview-window"
	// (src-tauri/capabilities/default.json) — fehlt sie, greift automatisch der Fallback.
	async function openNotebookLM() {
		const url = "https://notebooklm.google.com/";
		const T = window.__TAURI__;
		// Browser: normaler Tab. popup=yes wirkte wie eine eigene Chrome-App-Fenster.
		// iframe ist unmöglich (X-Frame-Options/CSP von Google).
		const openExtern = () => {
			if (T && T.shell && T.shell.open) T.shell.open(url);
			else window.open(url, "_blank", "noopener,noreferrer");
		};
		if (T && T.webviewWindow && T.webviewWindow.WebviewWindow) {
			try {
				// Zweiter Klick: existiert das Fenster schon, nur in den Vordergrund holen.
				const existing = await T.webviewWindow.WebviewWindow.getByLabel("notebooklm");
				if (existing) { existing.setFocus().catch(() => {}); return; }
				const win = new T.webviewWindow.WebviewWindow("notebooklm", { url, title: "NotebookLM", width: 1280, height: 860 });
				// Fehler meldet Tauri ASYNCHRON über tauri://error (nicht als Exception) → Fallback.
				win.once("tauri://error", (e) => {
					console.warn("NotebookLM-Fenster fehlgeschlagen, öffne im System-Browser:", e);
					openExtern();
				});
				return;
			} catch (e) { console.warn("NotebookLM-Fenster fehlgeschlagen, öffne extern:", e); }
		}
		openExtern();
	}
	const btnNlm = document.getElementById("btnNotebookLM");
	// 📓-Dialog (notebooklm.js): Seiten als Quelle in die Zwischenablage, NotebookLM öffnen
	// (Desktop: eingebettet im Hauptfenster + Download-Abgriff, sonst Fenster-Fallback oben)
	// und übernommene Downloads abspielen/exportieren.
	if (btnNlm) btnNlm.addEventListener("click", () => NLM.openDialog(openNotebookLM));

	// ---- Eigene Event-Delegation für alle neuen Knöpfe (app.js bleibt unberührt) ----
	document.addEventListener("click", async (e) => {
		const q = (sel) => e.target.closest(sel);
		let el;
		// Topbar-Menüs (Teilen / ⋯): öffnen/schließen; Klick außerhalb oder auf einen Menüpunkt schließt
		if (q("[data-sharemenu]")) { const old = S.topMenu; POPOVERS.closeAll("top"); S.topMenu = old === "share" ? null : "share"; render(); return; }
		if (q("[data-morepagemenu]")) { const old = S.topMenu; POPOVERS.closeAll("top"); S.topMenu = old === "more" ? null : "more"; render(); return; }
		if (S.topMenu && (!q(".top-menu") || q(".top-menu .menu-item"))) {
			S.topMenu = null;
			setTimeout(() => { if (typeof render === "function") render(); }, 0); // erst app.js-Handler wirken lassen
		}
		if (q("[data-backlinks]")) { S.backlinksOpen = !S.backlinksOpen; render(); return; }
		if ((el = q("[data-exportmd]"))) { exportPageMd(el.dataset.exportmd); return; }
		if ((el = q("[data-copylink]"))) {
			const link = "#" + el.dataset.copylink;
			(navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
				() => U.toast("Interner Link kopiert: " + link + " — auf anderen Seiten als [Text](" + link + ") einfügen.", "success"),
				() => prompt("Interner Link (mit Strg+C kopieren):", link));
			return;
		}
		// Schnell-Buttons in Einstellungen → KI: fehlende Standard-Quelle (z.B. LM Studio) wieder
		// anlegen — ältere gespeicherte Einstellungen überschreiben sonst die Default-Liste aus state.js.
		if ((el = q("[data-provpreset]"))) {
			const PRESETS = {
				local: { id: "local", name: "Lokal (LM Studio)", base: "http://localhost:1234/v1" },
				google: { id: "google", name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai" },
				openai: { id: "openai", name: "OpenAI", base: "https://api.openai.com/v1" },
			};
			const p = PRESETS[el.dataset.provpreset];
			if (!p) return;
			const list = (S.settings.aiProviders || []).slice();
			if (list.some((x) => x.id === p.id)) { U.toast("Diese Quelle ist bereits eingerichtet: " + p.name); return; }
			list.push({ ...p, key: "" });
			// LM Studio direkt als aktive Quelle setzen, damit das Modell-Dropdown sie sofort zeigt
			await STATE.dispatch("settingsSet", { aiProviders: list, ...(p.id === "local" ? { aiProviderId: "local" } : {}) });
			SETTINGS.openSettings("ki");
			return;
		}
		if ((el = q("[data-ankiundo]"))) { if (!el.disabled) await undoReview(); return; }
		if ((el = q("[data-deckconf]"))) { openDeckConf(el.dataset.deckconf === "*" ? "" : el.dataset.deckconf); return; }
		if (q("[data-ankiexport]")) { openAnkiIo("export"); return; }
		if (q("[data-ankiimport]")) { openAnkiIo("import"); return; }
		if ((el = q("[data-exportpdf]"))) { exportPagePdf(el.dataset.exportpdf); return; }
		if ((el = q("[data-cardsfromhl]"))) { await cardsFromHighlights(el.dataset.cardsfromhl); if (typeof render === "function") render(); return; }
		if (q("[data-clozewrap]")) { clozeWrapSelection(); return; }
		if (q("[data-clozesave]")) { await clozeSaveFromEditor(); return; }
	});

	return { canUndoReview, undoReview, createClozeCards, cardsFromHighlights, exportCsv, exportApkg, importCsvFile, importApkgFile, exportPagePdf, exportPageMd, openNotebookLM };
})();