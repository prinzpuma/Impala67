"use strict";
import { U } from "./util.js";
import { S, STATE } from "./state.js";
import { TABS } from "./tabs.js";
// notebooklm.js — NotebookLM-Anbindung v2, OHNE fremde APIs (Wrapper-Ansatz verworfen):
// • Überall (Web, Desktop, Mobil): Seiten-Picker → Inhalte als EINE Quelle in die
//   Zwischenablage (in NotebookLM: „Quelle hinzufügen → Kopierter Text" → Strg+V)
// • Desktop (Tauri): NotebookLM EINGEBETTET im Hauptfenster (wirkt wie ein Tab) +
//   Downloads (Podcast-MP3s …) werden abgefangen und landen in Impala.
//   Braucht die Rust-Kommandos nlm_webview/nlm_read_file (siehe Doku-Seite) —
//   fehlen sie, greift automatisch der Fenster-Fallback (openNotebookLM aus extras.js).
// • KI-Tool send_to_notebooklm (tools.js) nutzt sendPages().
export const NLM = (() => {
	// ---- Picker-Styles (eigenes <style>, wie in extras.js — Zeilen statt fetter Checkbox-Labels) ----
	const pickStyle = document.createElement("style");
	pickStyle.textContent = [
		".nlm-modal{width:min(480px,92vw)}",
		".nlm-search{width:100%;box-sizing:border-box;padding:7px 10px;margin:6px 0 8px;border-radius:8px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:13.5px}",
		".nlm-quickrow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center}",
		".nlm-quickrow button{font-size:12px;padding:3px 9px;border-radius:20px;background:rgba(128,128,128,.15);border:none;color:inherit;cursor:pointer}",
		".nlm-quickrow button:hover{background:rgba(128,128,128,.28)}",
		".nlm-list{max-height:44vh;overflow:auto;border:1px solid rgba(128,128,128,.2);border-radius:8px;padding:3px 0}",
		".nlm-row{display:flex;align-items:center;gap:2px;padding:1px 6px}",
		".nlm-toggle{flex:none;width:18px;height:26px;display:flex;align-items:center;justify-content:center;font-size:10px;opacity:.55;cursor:pointer;border-radius:5px;user-select:none}",
		".nlm-toggle:hover{opacity:1;background:rgba(128,128,128,.18)}",
		".nlm-toggle-empty{cursor:default;visibility:hidden}",
		".nlm-check{display:flex;align-items:center;gap:10px;flex:1;min-width:0;padding:7px 9px;border-radius:7px;cursor:pointer;user-select:none}",
		".nlm-check:hover{background:rgba(128,128,128,.13)}",
		".nlm-check.nlm-picked{background:rgba(76,141,255,.16)}",
		".nlm-check .nlm-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;text-align:left}",
		".nlm-checkmark{flex:none;width:18px;height:18px;min-width:18px;border-radius:5px;border:1.5px solid rgba(128,128,128,.45);display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;color:transparent;transition:background .12s,border-color .12s,color .12s}",
		".nlm-check.nlm-picked .nlm-checkmark{background:#4c8dff;border-color:#4c8dff;color:#fff}",
		".nlm-row.nlm-cur .nlm-title{font-weight:600}",
		".nlm-tag{display:inline-block;font-size:10px;opacity:.9;background:rgba(76,141,255,.18);color:#4c8dff;padding:1px 7px;border-radius:20px;margin-left:7px;vertical-align:middle}",
		".nlm-empty{padding:14px;text-align:center;opacity:.6;font-size:13px}",
		".nlm-count{opacity:.65;font-size:12.5px;margin-left:auto}",
		".nlm-pane{display:flex;flex-direction:column;height:100%}",
		".nlm-pane-hint{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid rgba(128,128,128,.3);flex:none}",
		".nlm-host{flex:1;position:relative}",
	].join("\n");
	document.head.appendChild(pickStyle);

	const NLM_URL = "https://notebooklm.google.com/";
	const T = () => window.__TAURI__ || null;
	const invoke = (cmd, args) => {
		const t = T();
		return t && t.core && t.core.invoke ? t.core.invoke(cmd, args) : Promise.reject(new Error("kein Tauri"));
	};
	const openFallbackDefault = () => {
		const t = T();
		if (t && t.shell && t.shell.open) t.shell.open(NLM_URL);
		else window.open(NLM_URL, "impala67-notebooklm", "popup=yes,width=1280,height=860");
	};

	// ---- Mini-Ablage für übernommene Downloads (eigene IndexedDB — bewusst getrennt
	//      vom Event-Log, damit große Mediendateien nicht durch den Sync wandern) ----
	function dbOpen() {
		return new Promise((res, rej) => {
			const r = indexedDB.open("impala67-nlm", 1);
			r.onupgradeneeded = () => r.result.createObjectStore("files", { keyPath: "id" });
			r.onsuccess = () => res(r.result);
			r.onerror = () => rej(r.error);
		});
	}
	const store = (db, mode) => db.transaction("files", mode).objectStore("files");
	const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
	async function fileAdd(name, blob) {
		const db = await dbOpen();
		await req(store(db, "readwrite").put({ id: U.uid(), name, blob, ts: Date.now() }));
	}
	async function fileList() {
		const db = await dbOpen();
		return ((await req(store(db, "readonly").getAll())) || []).sort((a, b) => b.ts - a.ts);
	}
	async function fileDel(id) {
		const db = await dbOpen();
		await req(store(db, "readwrite").delete(id));
	}

	// ---- Seiten → Quelltext für NotebookLM ----
	const pageText = (pg) => "# " + (pg.title || "Ohne Titel") + "\n\n" + (pg.content || "");
	async function copyPages(ids) {
		const text = ids.map((id) => S.pages[id]).filter(Boolean).map(pageText).join("\n\n---\n\n");
		if (!text.trim()) { U.toast("Die gewählten Seiten sind leer.", "error"); return false; }
		try { await navigator.clipboard.writeText(text); }
		catch (e) { prompt("Zwischenablage blockiert — Text mit Strg+C kopieren:", text); return true; }
		U.toast('📋 ' + ids.length + ' Seite(n) kopiert — in NotebookLM: „Quelle hinzufügen → Kopierter Text" → Einfügen.', "success");
		return true;
	}

	// ---- NotebookLM eingebettet im Hauptfenster (nur Desktop). Das Webview liegt ÜBER der
	//      App-UI — eigene schmale Leiste oben zum Zurückwechseln. Größen in CSS-Pixeln
	//      (Tauri LogicalPosition/LogicalSize rechnen selbst mit dem Display-Scaling). ----
	let embedded = false;
	let pendingFallback = null;
	let resizeObserverNlm = null;
	function hostRect() {
		const host = document.getElementById("nlmHost");
		return host ? host.getBoundingClientRect() : null;
	}
	async function positionEmbedded(closeTabOnFail) {
		if (S.view !== "notebooklm") return;
		const r = hostRect();
		if (!r) return;
		try {
			await invoke("nlm_webview", { show: true, x: r.left, y: r.top, w: r.width, h: r.height });
			embedded = true;
		} catch (e) {
			embedded = false;
			if (closeTabOnFail) {
				TABS.closeTab("nlm:main");
				(pendingFallback || openFallbackDefault)();
			}
		}
	}
	function hideEmbeddedIfActive() {
		if (!embedded) return;
		embedded = false;
		invoke("nlm_webview", { show: false, x: 0, y: 0, w: 0, h: 0 }).catch(() => {});
	}
	window.addEventListener("resize", () => positionEmbedded(false));
	function renderPane(main) {
		main.innerHTML = '<div class="nlm-pane"><div class="nlm-pane-hint"><strong>📓 NotebookLM</strong><span class="hint">Downloads landen automatisch in Impala</span></div><div id="nlmHost" class="nlm-host"></div></div>';
		const host = document.getElementById("nlmHost");
		if (resizeObserverNlm) resizeObserverNlm.disconnect();
		if (host && "ResizeObserver" in window) {
			resizeObserverNlm = new ResizeObserver(() => positionEmbedded(false));
			resizeObserverNlm.observe(host);
		}
		positionEmbedded(true);
	}
	function open(openFallback) {
		pendingFallback = openFallback || null;
		TABS.openPage("nlm:main");
	}


	// ---- Downloads aus dem NotebookLM-Webview übernehmen (Rust meldet "nlm-download") ----
	(function initDownloadListener() {
		const t = T();
		if (!(t && t.event && t.event.listen)) return;
		t.event.listen("nlm-download", async (m) => {
			const path = String((m && m.payload) || "");
			if (!path) return;
			try {
				const bytes = await invoke("nlm_read_file", { path });
				const name = path.split(/[\\/]/).pop() || "notebooklm-datei";
				await fileAdd(name, new Blob([bytes]));
				U.toast('🎧 „' + name + '" aus NotebookLM übernommen — im 📓-Dialog abspielbar.', "success");
			} catch (e) { U.toast("Download-Übernahme fehlgeschlagen: " + (e.message || e), "error"); }
		}).catch(() => {});
	})();

	// ---- Seiten hierarchisch sortieren (Eltern vor Kindern, mit Tiefe + Kind-Info fürs Einklappen) ----
	function pageTree(pages) {
		const byParent = new Map();
		pages.forEach((pg) => {
			const k = pg.parentId || null;
			if (!byParent.has(k)) byParent.set(k, []);
			byParent.get(k).push(pg);
		});
		const seen = new Set();
		const out = [];
		function walk(parentId, depth) {
			(byParent.get(parentId) || []).forEach((pg) => {
				if (seen.has(pg.id)) return;
				seen.add(pg.id);
				const kids = byParent.get(pg.id) || [];
				out.push({ pg, depth, hasChildren: kids.length > 0 });
				walk(pg.id, depth + 1);
			});
		}
		walk(null, 0);
		// Falls eine Elternseite selbst nicht in der Liste ist (z.B. archiviert), Rest trotzdem anzeigen
		pages.forEach((pg) => { if (!seen.has(pg.id)) { seen.add(pg.id); out.push({ pg, depth: 0, hasChildren: false }); } });
		return out;
	}

	// ---- Seiten-Picker: Suchfeld + eingerueckte Baumliste + Schnellauswahl ----
	function openPicker(onDone) {
		const pages = STATE.activePages();
		if (!pages.length) { U.toast("Keine Seiten vorhanden.", "error"); return; }
		const tree = pageTree(pages);
		const picked = new Set(S.currentPageId ? [S.currentPageId] : []);
		const expanded = new Set(); // standardmäßig alles eingeklappt — nur per Pfeil links aufklappbar
		const o = U.el("overlay");
		o.hidden = false;

		function isVisible(pg) {
			let cur = pg;
			while (cur && cur.parentId) {
				if (!expanded.has(cur.parentId)) return false;
				cur = S.pages[cur.parentId];
			}
			return true;
		}
		function rowHtml(pg, depth, hasChildren) {
			const isCur = pg.id === S.currentPageId;
			const isPicked = picked.has(pg.id);
			const toggle = hasChildren
				? '<span class="nlm-toggle" data-nlmtoggle="' + pg.id + '">' + (expanded.has(pg.id) ? "▾" : "▸") + "</span>"
				: '<span class="nlm-toggle nlm-toggle-empty">▸</span>';
			return '<div class="nlm-row' + (isCur ? " nlm-cur" : "") + '" style="padding-left:' + (depth * 18) + 'px" data-nlmrow="' + pg.id + '">' + toggle +
				'<div class="nlm-check' + (isPicked ? " nlm-picked" : "") + '" data-nlmpick="' + pg.id + '"><span class="nlm-title">' + U.esc((pg.icon ? pg.icon + " " : "") + (pg.title || "Ohne Titel")) + (isCur ? ' <span class="nlm-tag">aktuell</span>' : "") + "</span>" +
				'<span class="nlm-checkmark">✓</span></div></div>';
		}
		function listHtml(filter) {
			const term = (filter || "").trim().toLowerCase();
			const rows = term
				? pages.filter((pg) => (pg.title || "").toLowerCase().includes(term)).map((pg) => rowHtml(pg, 0, false))
				: tree.filter((e) => isVisible(e.pg)).map((e) => rowHtml(e.pg, e.depth, e.hasChildren));
			return rows.length ? rows.join("") : '<div class="nlm-empty">Keine Seiten gefunden.</div>';
		}
		function updateCount() { const c = U.el("nlmCount"); if (c) c.textContent = picked.size + " ausgewählt"; }

		o.innerHTML = '<div class="modal nlm-modal"><h3>📚 Seiten für NotebookLM auswählen</h3>' +
			'<p class="hint">Kopiert die Inhalte als eine Quelle in die Zwischenablage — in NotebookLM dann „Quelle hinzufügen → Kopierter Text" wählen und einfügen.</p>' +
			'<input type="search" class="nlm-search" id="nlmSearch" placeholder="Seiten durchsuchen…">' +
			'<div class="nlm-quickrow"><button id="nlmAll">Alle</button><button id="nlmNone">Keine</button><button id="nlmCurOnly">Nur aktuelle Seite</button><span class="nlm-count" id="nlmCount"></span></div>' +
			'<div class="nlm-list" id="nlmList">' + listHtml("") + "</div>" +
			'<div class="modal-actions"><button id="btnNlmCopy">📋 Kopieren & NotebookLM öffnen</button><button id="btnCloseOverlay">Abbrechen</button></div></div>';

		function bindRows() {
			const list = U.el("nlmList");
			list.querySelectorAll("[data-nlmpick]").forEach((row) => row.addEventListener("click", () => {
				const id = row.dataset.nlmpick;
				if (picked.has(id)) picked.delete(id); else picked.add(id);
				row.classList.toggle("nlm-picked");
				updateCount();
			}));
			list.querySelectorAll("[data-nlmtoggle]").forEach((t) => t.addEventListener("click", () => {
				const id = t.dataset.nlmtoggle;
				if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
				U.el("nlmList").innerHTML = listHtml(U.el("nlmSearch").value);
				bindRows();
			}));
		}
		bindRows();
		updateCount();

		U.el("nlmSearch").addEventListener("input", (e) => {
			U.el("nlmList").innerHTML = listHtml(e.target.value);
			bindRows();
		});
		U.el("nlmAll").addEventListener("click", () => {
			pages.forEach((pg) => picked.add(pg.id));
			U.el("nlmList").querySelectorAll("[data-nlmpick]").forEach((row) => row.classList.add("nlm-picked"));
			updateCount();
		});
		U.el("nlmNone").addEventListener("click", () => {
			picked.clear();
			U.el("nlmList").querySelectorAll("[data-nlmpick]").forEach((row) => row.classList.remove("nlm-picked"));
			updateCount();
		});
		U.el("nlmCurOnly").addEventListener("click", () => {
			picked.clear();
			if (S.currentPageId) picked.add(S.currentPageId);
			U.el("nlmSearch").value = "";
			U.el("nlmList").innerHTML = listHtml("");
			bindRows();
			updateCount();
		});
		U.el("btnNlmCopy").addEventListener("click", async () => {
			if (!picked.size) { U.toast("Mindestens eine Seite anhaken.", "error"); return; }
			if (await copyPages([...picked])) { o.hidden = true; onDone(); }
		});
	}

	// ---- Abspiel-Overlay für übernommene Downloads ----
	function play(f) {
		const url = URL.createObjectURL(f.blob); // bleibt bis zum Neuladen gültig — ok für Einzelabspielen
		const isVideo = /\.(mp4|webm|mov)$/i.test(f.name);
		const o = U.el("overlay");
		o.hidden = false;
		o.innerHTML = '<div class="modal"><h3>' + U.esc(f.name) + "</h3>" +
			(isVideo ? '<video controls autoplay style="width:100%" src="' + url + '"></video>'
				: '<audio controls autoplay style="width:100%" src="' + url + '"></audio>') +
			'<div class="modal-actions"><button id="btnCloseOverlay">Schließen</button></div></div>';
	}

	// ---- 📓-Dialog (Topbar-Knopf, aus extras.js aufgerufen) ----
	async function openDialog(openFallback) {
		const files = await fileList().catch(() => []);
		const o = U.el("overlay");
		o.hidden = false;
		const rows = files.map((f) => '<div style="display:flex;gap:8px;align-items:center;padding:3px 0">' +
			'<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' + U.esc(f.name) + "</span>" +
			'<button data-nlmplay="' + f.id + '">▶</button><button data-nlmsave="' + f.id + '">⬇</button><button data-nlmdel="' + f.id + '">🗑</button></div>').join("");
		o.innerHTML = '<div class="modal"><h3>📓 NotebookLM</h3>' +
			'<div class="row-btns"><button id="btnNlmPick">📚 Seiten als Quelle kopieren…</button><button id="btnNlmOpen">📓 NotebookLM öffnen</button></div>' +
			(files.length ? "<h4>🎧 Übernommene Downloads</h4>" + rows : '<p class="hint">Downloads aus dem NotebookLM-Tab (Desktop) landen automatisch hier.</p>') +
			'<div class="modal-actions"><button id="btnCloseOverlay">Schließen</button></div></div>';
		U.el("btnNlmPick").addEventListener("click", () => openPicker(() => open(openFallback)));
		U.el("btnNlmOpen").addEventListener("click", () => { o.hidden = true; open(openFallback); });
		o.querySelectorAll("[data-nlmplay]").forEach((b) => b.addEventListener("click", async () => {
			const f = (await fileList()).find((x) => x.id === b.dataset.nlmplay);
			if (f) play(f);
		}));
		o.querySelectorAll("[data-nlmsave]").forEach((b) => b.addEventListener("click", async () => {
			const f = (await fileList()).find((x) => x.id === b.dataset.nlmsave);
			if (f) U.downloadBlob(f.name, f.blob);
		}));
		o.querySelectorAll("[data-nlmdel]").forEach((b) => b.addEventListener("click", async () => {
			await fileDel(b.dataset.nlmdel);
			openDialog(openFallback); // Liste neu aufbauen
		}));
	}

	// ---- KI-Tool (tools.js → send_to_notebooklm): Seiten kopieren + NotebookLM öffnen ----
	async function sendPages(titles) {
		let pages;
		if (titles && titles.length) {
			pages = [];
			for (const title of titles) {
				const pg = STATE.findPage(title);
				if (!pg) return { error: "Seite nicht gefunden: " + title };
				pages.push(pg);
			}
		} else {
			const cur = S.currentPageId ? S.pages[S.currentPageId] : null;
			if (!cur) return { error: "Keine aktuelle Seite offen — bitte Seitentitel angeben." };
			pages = [cur];
		}
		if (!(await copyPages(pages.map((p) => p.id)))) return { error: "Die Seiten sind leer." };
		open(openFallbackDefault);
		return { ok: true, copied: pages.length, hint: 'Inhalte liegen in der Zwischenablage — in NotebookLM „Quelle hinzufügen → Kopierter Text" wählen und einfügen, dann z.B. Audio-Übersicht (Lernpodcast) erstellen.' };
	}

	return { openDialog, sendPages, renderPane, hideEmbeddedIfActive };
})();