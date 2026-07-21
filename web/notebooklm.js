"use strict";
import { U } from "./util.js";
import { S, STATE } from "./state.js";
import { TABS } from "./tabs.js";
// notebooklm.js — Gemini-Notebook-Anbindung v4. OHNE fremde APIs.
// Google hat NotebookLM am 16.07.2026 in „Gemini Notebook" umbenannt — gleiches
// Produkt, neuer Name. Alles Sichtbare heißt hier deshalb Gemini Notebook.
// Technische Bezeichner bleiben BEWUSST stabil (Dateiname, NLM-Export, "#nlm:"-Links,
// "nlm:main"-Tab, IndexedDB "impala67-nlm", localStorage-Schlüssel): bestehende
// Einbettungs-Links in Seiten und gespeicherte Tab-Sitzungen laufen unverändert weiter.
//
// v4 = Neuschrieb nach KISS/DRY:
// • Öffnen: IMMER eigenes Fenster (Tauri) bzw. Browser-Tab — openExternal(), EINE
//   Stelle (vorher doppelt in extras.js + hier). Das native Einbetten im Haupt-
//   fenster (nlm_webview + Positions-/Overlay-Observer, ~200 Zeilen) ist ersatzlos
//   entfernt: es hing an Rust-Kommandos, die nie zuverlässig existierten, und war
//   die Hauptquelle der Bugs (verdeckte Dialoge, hängen gebliebene Webviews).
// • Dateidownload geht jetzt WIRKLICH: Kein Browser darf Downloads einer fremden
//   Website automatisch abfangen — darauf zu bauen war der alte Fehler. Der
//   verlässliche Weg ist explizit: in Gemini Notebook normal herunterladen und im
//   📓-Tab importieren (Knopf oder Drag & Drop) → Inbox → Einordnen. Der Tauri-
//   Auto-Abgriff ("nlm-download"-Event) bleibt als Bonus — jetzt mit Warte-
//   Wiederholung, falls window.__TAURI__ erst nach dem Modul-Start bereitsteht.
// • Quellen: Seiten-Picker → Inhalte als EINE Quelle in die Zwischenablage
//   (in Gemini Notebook: „Quelle hinzufügen → Kopierter Text" → Einfügen).
// • Artefakte unverändert strukturiert: { id, name, blob, ts, kind, mime, size,
//   sourcePageIds, placedPageId } · Inbox-Prinzip: NIE automatisch in Seiten
//   schreiben · Einbettung als Markdown-Link [🎧 …](#nlm:<id>) · Blobs bleiben in
//   IndexedDB und wandern nicht durch den Drive-Sync · Bibliothek: library.js (📥).
export const NLM = (() => {
	const PRODUCT = "Gemini Notebook";
	const PRODUCT_URL = "https://notebooklm.google.com/"; // leitet seit der Umbenennung auf Gemini Notebook weiter

	// ---- Styles (eigenes <style>, wie extras.js/library.js) ----
	const style = document.createElement("style");
	style.textContent = [
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
		// Inbox-Toast (unten rechts, bewusst dunkel wie übliche Toasts)
		".nlm-inbox-toast{position:fixed;right:16px;bottom:16px;z-index:9999;background:#1e1f24;color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px 14px;box-shadow:0 8px 30px rgba(0,0,0,.35);max-width:320px;font-size:13px}",
		".nlm-inbox-toast .nlm-it-title{font-weight:650;margin-bottom:2px}",
		".nlm-inbox-toast .nlm-it-name{opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:290px}",
		".nlm-inbox-toast .nlm-it-src{opacity:.6;font-size:12px;margin-top:2px}",
		".nlm-inbox-toast .nlm-it-btns{display:flex;gap:6px;margin-top:8px}",
		".nlm-inbox-toast button{font-size:12.5px;padding:4px 10px;border-radius:8px;border:none;background:rgba(255,255,255,.14);color:#fff;cursor:pointer}",
		".nlm-inbox-toast button:hover{background:rgba(255,255,255,.25)}",
		".nlm-inbox-toast button.nlm-it-primary{background:#4c8dff}",
		// Einordnen-Dialog
		".nlm-place-list{display:flex;flex-direction:column;gap:6px;margin:10px 0}",
		".nlm-place-opt{text-align:left;padding:10px 12px;border-radius:9px;border:1px solid rgba(128,128,128,.25);background:rgba(128,128,128,.08);color:inherit;cursor:pointer;font-size:13.5px}",
		".nlm-place-opt:hover{background:rgba(76,141,255,.14);border-color:#4c8dff}",
		// v4: 📓-Tab (Hub) mit Import-Ablagefläche
		".nlm-hub{max-width:820px;margin:0 auto;padding:30px 24px;overflow:auto;height:100%;box-sizing:border-box}",
		".nlm-hub h1{margin:0 0 4px}",
		".nlm-hub-actions{margin:16px 0 10px}",
		".nlm-drop{border:2px dashed rgba(128,128,128,.4);border-radius:12px;padding:26px 18px;text-align:center;opacity:.75;font-size:13.5px;margin:6px 0 22px;transition:border-color .12s,background .12s,opacity .12s}",
		".nlm-drop.drag{border-color:#4c8dff;background:rgba(76,141,255,.08);opacity:1}",
		".nlm-hub-sub{margin:0 0 8px}",
	].join("\n");
	document.head.appendChild(style);

	// ---- Öffnen: eigenes Tauri-Fenster (zweiter Klick fokussiert nur) oder Browser-Tab.
	//      Google blockiert iframes (X-Frame-Options/CSP) — deshalb immer extern.
	//      Tauri v2 braucht die Capability "core:webview:allow-create-webview-window";
	//      fehlt sie, meldet das Fenster tauri://error und wir öffnen im System-Browser. ----
	const T = () => window.__TAURI__ || null;
	function openBrowserTab() {
		const t = T();
		if (t && t.shell && t.shell.open) t.shell.open(PRODUCT_URL);
		else window.open(PRODUCT_URL, "_blank", "noopener,noreferrer");
	}
	async function openExternal() {
		const t = T();
		if (t && t.webviewWindow && t.webviewWindow.WebviewWindow) {
			try {
				const existing = await t.webviewWindow.WebviewWindow.getByLabel("notebooklm");
				if (existing) { existing.setFocus().catch(() => {}); return; }
				const win = new t.webviewWindow.WebviewWindow("notebooklm", { url: PRODUCT_URL, title: PRODUCT, width: 1280, height: 860 });
				// Fehler meldet Tauri ASYNCHRON über tauri://error (nicht als Exception) → Fallback.
				win.once("tauri://error", (e) => { console.warn(PRODUCT + "-Fenster fehlgeschlagen, öffne im Browser:", e); openBrowserTab(); });
				return;
			} catch (e) { console.warn(PRODUCT + "-Fenster fehlgeschlagen, öffne im Browser:", e); }
		}
		openBrowserTab();
	}

	// ---- Artefakt-Arten: Anzeige-Icons/-Labels je kind --------------------------
	const KINDS = {
		audio: { icon: "🎧", label: "Podcast" },
		video: { icon: "🎬", label: "Video" },
		mindmap: { icon: "🧠", label: "Mind Map" },
		"slides-pdf": { icon: "📑", label: "Folien (PDF)" },
		"slides-pptx": { icon: "📑", label: "Folien (PPTX)" },
		text: { icon: "📄", label: "Text" },
		file: { icon: "📎", label: "Datei" },
	};
	const kindIcon = (k) => (KINDS[k] || KINDS.file).icon;
	const kindLabel = (k) => (KINDS[k] || KINDS.file).label;
	const EXT_KIND = {
		mp3: "audio", m4a: "audio", aac: "audio", wav: "audio", ogg: "audio", opus: "audio",
		mp4: "video", webm: "video", mov: "video", m4v: "video",
		png: "mindmap", jpg: "mindmap", jpeg: "mindmap", webp: "mindmap", svg: "mindmap",
		pdf: "slides-pdf", pptx: "slides-pptx",
		txt: "text", md: "text",
	};
	// kind-Erkennung: Endung → MIME → Magic Bytes. Gemini Notebook dokumentiert seine
	// Download-Formate nicht verbindlich — deshalb niemals nur auf .mp3 & Co. verlassen.
	function sniffKind(name, head, mime) {
		const ext = (String(name || "").split(".").pop() || "").toLowerCase();
		if (name && name.includes(".") && EXT_KIND[ext]) return EXT_KIND[ext];
		const m = String(mime || "").toLowerCase();
		if (m.startsWith("audio/")) return "audio";
		if (m.startsWith("video/")) return "video";
		if (m.startsWith("image/")) return "mindmap";
		if (m === "application/pdf") return "slides-pdf";
		if (m.includes("presentation")) return "slides-pptx";
		const b = head || new Uint8Array(0);
		if (b.length >= 4) {
			if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "slides-pdf"; // %PDF
			if (b[0] === 0x50 && b[1] === 0x4b) return "slides-pptx"; // PK → Office/ZIP (PPTX)
			if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "audio"; // ID3 → MP3
			if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "audio"; // nackter MPEG-Frame
			if (b[0] === 0x89 && b[1] === 0x50) return "mindmap"; // PNG
			if (b[0] === 0xff && b[1] === 0xd8) return "mindmap"; // JPEG
			if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video"; // WebM/Matroska
		}
		if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "video"; // ftyp → MP4/MOV
		return "file";
	}

	// ---- Herkunft (Provenance): welche Seiten wurden zuletzt als Quelle kopiert? ----
	// Der nächste Import/Download gehört mit hoher Wahrscheinlichkeit zu genau diesen
	// Seiten — 6 h gültig, danach lieber KEINE Vermutung als eine falsche.
	const PROV_KEY = "impala67.nlmSources";
	const PROV_TTL = 6 * 3600e3;
	function rememberSources(ids) {
		try { localStorage.setItem(PROV_KEY, JSON.stringify({ ids: ids || [], t: Date.now() })); } catch {}
	}
	function recentSources() {
		try {
			const v = JSON.parse(localStorage.getItem(PROV_KEY) || "null");
			if (!v || !Array.isArray(v.ids) || Date.now() - (v.t || 0) > PROV_TTL) return [];
			return v.ids.filter((id) => S.pages[id] && !S.pages[id].trashed);
		} catch { return []; }
	}

	// ---- Artefakt-Ablage (eigene IndexedDB — bewusst getrennt vom Event-Log,
	//      damit große Mediendateien nicht durch den Drive-Sync wandern) ----
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
		let head = new Uint8Array(0);
		try { head = new Uint8Array(await blob.slice(0, 12).arrayBuffer()); } catch {}
		const rec = {
			id: U.uid(), name, blob, ts: Date.now(),
			kind: sniffKind(name, head, blob.type),
			mime: blob.type || "", size: blob.size || 0,
			sourcePageIds: recentSources(), placedPageId: null,
		};
		const db = await dbOpen();
		await req(store(db, "readwrite").put(rec));
		return rec;
	}
	async function fileList() {
		const db = await dbOpen();
		const list = ((await req(store(db, "readonly").getAll())) || []).sort((a, b) => b.ts - a.ts);
		// Alt-Datensätze (v2: nur {id,name,blob,ts}) beim ersten Lesen einmalig nachrüsten
		for (const f of list) {
			if (f.kind) continue;
			f.kind = sniffKind(f.name, new Uint8Array(0), f.blob && f.blob.type);
			f.mime = (f.blob && f.blob.type) || "";
			f.size = (f.blob && f.blob.size) || 0;
			f.sourcePageIds = f.sourcePageIds || [];
			f.placedPageId = f.placedPageId || null;
			await req(store(db, "readwrite").put(f)).catch(() => {});
		}
		return list;
	}
	async function fileGet(id) {
		return (await fileList()).find((x) => x.id === id) || null;
	}
	async function fileUpdate(id, patch) {
		const db = await dbOpen();
		const f = await req(store(db, "readonly").get(id));
		if (!f) return null;
		Object.assign(f, patch);
		await req(store(db, "readwrite").put(f));
		return f;
	}
	async function fileDel(id) {
		const db = await dbOpen();
		await req(store(db, "readwrite").delete(id));
	}

	// ---- Seiten → Quelltext für Gemini Notebook ----
	const pageText = (pg) => "# " + (pg.title || "Ohne Titel") + "\n\n" + (pg.content || "");
	async function copyPages(ids) {
		const text = ids.map((id) => S.pages[id]).filter(Boolean).map(pageText).join("\n\n---\n\n");
		if (!text.trim()) { U.toast("Die gewählten Seiten sind leer.", "error"); return false; }
		rememberSources(ids); // Herkunft für den nächsten Import merken
		try { await navigator.clipboard.writeText(text); }
		catch (e) { prompt("Zwischenablage blockiert — Text mit Strg+C kopieren:", text); return true; }
		U.toast('📋 ' + ids.length + ' Seite(n) kopiert — in ' + PRODUCT + ': „Quelle hinzufügen → Kopierter Text" → Einfügen.', "success");
		return true;
	}

	// ---- Download-Import: DER verlässliche Weg (funktioniert in Browser UND Desktop) ----
	async function importFiles(list) {
		const files = [...(list || [])].filter((f) => f && typeof f.size === "number");
		if (!files.length) return 0;
		let last = null;
		for (const f of files) last = await fileAdd(f.name || "gemini-notebook-datei", f);
		if (files.length === 1) showInboxToast(last);
		else U.toast("📥 " + files.length + " Dateien in die Inbox übernommen (Bibliothek → 📥).", "success");
		refreshHubList();
		return files.length;
	}
	function pickImportFiles() {
		const inp = document.createElement("input");
		inp.type = "file";
		inp.multiple = true;
		inp.addEventListener("change", () => { importFiles(inp.files); });
		inp.click();
	}

	// ---- Einbettung in Seiten: Markdown-Link [🎧 …](#nlm:<id>) --------------------
	// Bewusst ein normaler Link statt eines eigenen Block-Typs: funktioniert sofort in
	// Editor, Suche und Sync; der Klick wird per Capture-Delegation abgefangen.
	// Das "#nlm:"-Präfix bleibt aus Kompatibilität zu bestehenden Links erhalten.
	const embedMd = (f) => "\n\n" + kindIcon(f.kind) + " [Gemini-Notebook-" + kindLabel(f.kind) + ": " +
		String(f.name || "Datei").replace(/[\[\]]/g, "") + "](#nlm:" + f.id + ")\n";
	document.addEventListener("click", (e) => {
		const a = e.target && e.target.closest && e.target.closest('a[href^="#nlm:"]');
		if (!a) return;
		e.preventDefault();
		e.stopPropagation();
		playById(decodeURIComponent(a.getAttribute("href").slice(5)));
	}, true);

	async function embedInto(pg, f) {
		await STATE.dispatch("pageUpdate", { id: pg.id, patch: { content: (pg.content || "").replace(/\s*$/, "") + embedMd(f) } });
		await fileUpdate(f.id, { placedPageId: pg.id });
		U.toast("✅ " + kindLabel(f.kind) + ' in „' + (pg.title || "Ohne Titel") + '" eingebettet.', "success");
		TABS.openPage(pg.id);
	}
	async function placeAsSubpage(f, parentPg) {
		const base = String(f.name || "Datei").replace(/\.[a-z0-9]+$/i, "");
		const id = U.uid();
		await STATE.dispatch("pageCreate", {
			id,
			title: kindLabel(f.kind) + ": " + base,
			icon: kindIcon(f.kind),
			parentId: parentPg ? parentPg.id : null,
			workspaceId: (parentPg && parentPg.workspaceId) || S.currentWorkspaceId || "default",
			content: "Gemini-Notebook-" + kindLabel(f.kind) + " vom " + new Date(f.ts).toLocaleDateString("de-DE") + embedMd(f),
			tags: ["notebooklm"], // Tag bleibt technisch stabil (bestehende Filter/Seiten)
		});
		await fileUpdate(f.id, { placedPageId: id });
		U.toast("✅ Unterseite angelegt.", "success");
		TABS.openPage(id);
	}

	// ---- Einordnen-Dialog: Quellseite / neue Unterseite / andere Seite / Mediathek ----
	async function openPlaceDialog(id) {
		const f = await fileGet(id);
		if (!f) { U.toast("Datei nicht gefunden.", "error"); return; }
		const sources = (f.sourcePageIds || []).map((pid) => S.pages[pid]).filter((p) => p && !p.trashed);
		const embedTargets = sources.filter((p) => p.kind !== "heft"); // Hefte rendern pg.content nicht
		const o = U.el("overlay");
		o.hidden = false;
		const srcRows = embedTargets.map((pg) => '<button class="nlm-place-opt" data-embed="' + pg.id + '">📄 In „' +
			U.esc((pg.title || "Ohne Titel").slice(0, 44)) + '" einbetten</button>').join("");
		o.innerHTML = '<div class="modal nlm-modal"><h3>📌 Einordnen: ' + kindIcon(f.kind) + " " + U.esc(f.name) + "</h3>" +
			(sources.length ? '<p class="hint">Herkunft erkannt: zuletzt wurden diese Seiten als Quelle kopiert.</p>' : '<p class="hint">Keine Herkunft bekannt — Ziel selbst wählen.</p>') +
			'<div class="nlm-place-list">' + srcRows +
				'<button class="nlm-place-opt" data-sub="1">🆕 Als neue Unterseite' + (sources.length ? ' unter „' + U.esc((sources[0].title || "Ohne Titel").slice(0, 30)) + '"' : "") + "</button>" +
				'<button class="nlm-place-opt" data-pickpage="1">🔎 Andere Seite wählen…</button>' +
				'<button class="nlm-place-opt" data-keep="1">📥 Nur in der Mediathek behalten</button>' +
			"</div>" +
			'<div class="modal-actions"><button id="btnCloseOverlay">Abbrechen</button></div></div>';
		o.querySelectorAll("[data-embed]").forEach((b) => b.addEventListener("click", async () => {
			const pg = S.pages[b.dataset.embed];
			o.hidden = true;
			if (pg) await embedInto(pg, f);
		}));
		const sub = o.querySelector("[data-sub]");
		if (sub) sub.addEventListener("click", async () => { o.hidden = true; await placeAsSubpage(f, sources[0] || null); });
		const pick = o.querySelector("[data-pickpage]");
		if (pick) pick.addEventListener("click", () => openPagePickDialog(f));
		const keep = o.querySelector("[data-keep]");
		if (keep) keep.addEventListener("click", () => {
			o.hidden = true;
			U.toast("📥 Bleibt in der Mediathek (Bibliothek → 📥).", "success");
		});
	}
	function openPagePickDialog(f) {
		const pages = STATE.activePages().filter((p) => p.kind !== "heft");
		const o = U.el("overlay");
		o.hidden = false;
		const rowsHtml = (term) => {
			const t = (term || "").trim().toLowerCase();
			const hits = pages.filter((pg) => !t || (pg.title || "").toLowerCase().includes(t)).slice(0, 40);
			return hits.map((pg) => '<div class="nlm-row"><div class="nlm-check" data-nlmembedto="' + pg.id + '"><span class="nlm-title">' +
				U.esc((pg.icon ? pg.icon + " " : "") + (pg.title || "Ohne Titel")) + "</span></div></div>").join("") ||
				'<div class="nlm-empty">Keine Seiten gefunden.</div>';
		};
		o.innerHTML = '<div class="modal nlm-modal"><h3>Seite wählen für ' + kindIcon(f.kind) + " " + U.esc(f.name) + "</h3>" +
			'<input type="search" class="nlm-search" id="nlmPlaceSearch" placeholder="Seiten durchsuchen…">' +
			'<div class="nlm-list" id="nlmPlaceList">' + rowsHtml("") + "</div>" +
			'<div class="modal-actions"><button id="btnCloseOverlay">Abbrechen</button></div></div>';
		const bind = () => {
			o.querySelectorAll("[data-nlmembedto]").forEach((r) => r.addEventListener("click", async () => {
				const pg = S.pages[r.dataset.nlmembedto];
				o.hidden = true;
				if (pg) await embedInto(pg, f);
			}));
		};
		bind();
		U.el("nlmPlaceSearch").addEventListener("input", (e) => { U.el("nlmPlaceList").innerHTML = rowsHtml(e.target.value); bind(); });
	}

	// ---- Inbox-Toast: nach jedem Import/Abgriff — NIE automatisch einbetten ----
	function showInboxToast(rec) {
		document.querySelectorAll(".nlm-inbox-toast").forEach((n) => n.remove());
		const el = document.createElement("div");
		el.className = "nlm-inbox-toast";
		const src = (rec.sourcePageIds || []).map((id) => S.pages[id]).filter((p) => p && !p.trashed);
		el.innerHTML = '<div class="nlm-it-title">' + kindIcon(rec.kind) + " " + U.esc(kindLabel(rec.kind)) + " übernommen</div>" +
			'<div class="nlm-it-name">' + U.esc(rec.name) + "</div>" +
			(src.length ? '<div class="nlm-it-src">Quelle: ' + U.esc(src.map((p) => p.title || "Ohne Titel").join(", ").slice(0, 60)) + "</div>" : "") +
			'<div class="nlm-it-btns"><button class="nlm-it-primary" data-a="place">📌 Einordnen</button><button data-a="play">▶ Öffnen</button><button data-a="later">Später</button></div>';
		document.body.appendChild(el);
		const close = () => el.remove();
		const timer = setTimeout(close, 15000);
		el.addEventListener("click", (e) => {
			const b = e.target.closest("button");
			if (!b) return;
			clearTimeout(timer);
			close();
			if (b.dataset.a === "place") openPlaceDialog(rec.id);
			else if (b.dataset.a === "play") play(rec);
			// "later": Datei bleibt in der Inbox (📓-Tab bzw. Bibliothek → 📥)
		});
	}

	// ---- Bonus: Tauri-Auto-Abgriff. Rust meldet "nlm-download" (String-Pfad, alt,
	//      oder Objekt { path, file_name, mime, size }); Datei lesen per nlm_read_file.
	//      Fehlen die Kommandos, passiert nichts — der Import oben ist der verlässliche
	//      Weg. NEU: Warte-Wiederholung, weil window.__TAURI__ je nach Plattform erst
	//      NACH diesem Modul initialisiert ist (daran scheiterte der alte Listener still). ----
	const invoke = (cmd, args) => {
		const t = T();
		return t && t.core && t.core.invoke ? t.core.invoke(cmd, args) : Promise.reject(new Error("kein Tauri"));
	};
	(function initAutoCapture(tries) {
		const t = T();
		if (!(t && t.event && t.event.listen)) {
			if (tries < 20) setTimeout(() => initAutoCapture(tries + 1), 500);
			return;
		}
		t.event.listen("nlm-download", async (m) => {
			const pay = (m && m.payload) || "";
			const structured = pay && typeof pay === "object";
			const path = structured ? String(pay.path || "") : String(pay);
			if (!path) return;
			try {
				const bytes = await invoke("nlm_read_file", { path });
				const name = (structured && pay.file_name) || path.split(/[\\/]/).pop() || "gemini-notebook-datei";
				const mime = (structured && pay.mime) || "";
				const rec = await fileAdd(name, mime ? new Blob([bytes], { type: mime }) : new Blob([bytes]));
				showInboxToast(rec);
				refreshHubList();
			} catch (e) { U.toast("Download-Übernahme fehlgeschlagen: " + (e.message || e), "error"); }
		}).catch(() => {});
	})(0);

	// ---- Seiten hierarchisch sortieren (Eltern vor Kindern, mit Tiefe + Kind-Info) ----
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

	// ---- Seiten-Picker: Suchfeld + eingerückte Baumliste + Schnellauswahl ----
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

		o.innerHTML = '<div class="modal nlm-modal"><h3>📚 Seiten für ' + PRODUCT + ' auswählen</h3>' +
			'<p class="hint">Kopiert die Inhalte als eine Quelle in die Zwischenablage — in ' + PRODUCT + ' dann „Quelle hinzufügen → Kopierter Text" wählen und einfügen.</p>' +
			'<input type="search" class="nlm-search" id="nlmSearch" placeholder="Seiten durchsuchen…">' +
			'<div class="nlm-quickrow"><button id="nlmAll">Alle</button><button id="nlmNone">Keine</button><button id="nlmCurOnly">Nur aktuelle Seite</button><span class="nlm-count" id="nlmCount"></span></div>' +
			'<div class="nlm-list" id="nlmList">' + listHtml("") + "</div>" +
			'<div class="modal-actions"><button id="btnNlmCopy">📋 Kopieren & ' + PRODUCT + ' öffnen</button><button id="btnCloseOverlay">Abbrechen</button></div></div>';

		function bindRows() {
			const list = U.el("nlmList");
			list.querySelectorAll("[data-nlmpick]").forEach((row) => row.addEventListener("click", () => {
				const id = row.dataset.nlmpick;
				if (picked.has(id)) picked.delete(id); else picked.add(id);
				row.classList.toggle("nlm-picked");
				updateCount();
			}));
			list.querySelectorAll("[data-nlmtoggle]").forEach((t2) => t2.addEventListener("click", () => {
				const id = t2.dataset.nlmtoggle;
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

	// ---- Abspiel-/Ansichts-Overlay: Player nach kind (Audio, Video, Bild, PDF) ----
	function play(f) {
		const url = URL.createObjectURL(f.blob); // bleibt bis zum Neuladen gültig — ok für Einzelabspielen
		const o = U.el("overlay");
		o.hidden = false;
		let body;
		if (f.kind === "video" || /\.(mp4|webm|mov|m4v)$/i.test(f.name)) body = '<video controls autoplay style="width:100%;max-height:70vh" src="' + url + '"></video>';
		else if (f.kind === "audio" || /\.(mp3|m4a|wav|ogg|opus|aac)$/i.test(f.name)) body = '<audio controls autoplay style="width:100%" src="' + url + '"></audio>';
		else if (f.kind === "mindmap") body = '<img style="max-width:100%;max-height:70vh;display:block;margin:0 auto;border-radius:8px" src="' + url + '" alt="">';
		else if (f.kind === "slides-pdf") body = '<iframe style="width:100%;height:70vh;border:none;border-radius:8px" src="' + url + '"></iframe>';
		else body = '<p class="hint">Für diese Datei gibt es keine Vorschau — mit ⬇ speichern und lokal öffnen.</p>';
		o.innerHTML = '<div class="modal" style="width:min(760px,94vw)"><h3>' + kindIcon(f.kind) + " " + U.esc(f.name) + "</h3>" + body +
			'<div class="modal-actions"><button data-nlmsavequick="' + f.id + '">⬇ Speichern</button><button id="btnCloseOverlay">Schließen</button></div></div>';
		const sv = o.querySelector("[data-nlmsavequick]");
		if (sv) sv.addEventListener("click", () => U.downloadBlob(f.name, f.blob));
	}
	async function playById(id) {
		const f = await fileGet(id);
		if (f) play(f);
		else U.toast("Datei nicht (mehr) in der Mediathek.", "error");
	}
	async function saveById(id) {
		const f = await fileGet(id);
		if (f) U.downloadBlob(f.name, f.blob);
	}
	async function deleteById(id) { await fileDel(id); }
	function placeById(id) { return openPlaceDialog(id); }
	const listArtifacts = () => fileList();

	// ---- 📓-Tab (Ansicht "notebooklm", Tab-ID "nlm:main"): Hub für alles ----
	// Zeilen nutzen dieselben data-nlmlib*-Attribute und -Styles wie die Bibliothek
	// (library.js delegiert dokumentweit) — keine doppelte Knopf-Logik (DRY).
	function hubRowHtml(f) {
		const src = (f.sourcePageIds || []).map((id) => S.pages[id]).filter((p) => p && !p.trashed);
		return '<div class="nlm-lib-row nlm-lib-inbox">' +
			'<span class="nlm-lib-icon">' + kindIcon(f.kind) + "</span>" +
			'<span class="nlm-lib-main"><span class="nlm-lib-name">' + U.esc(f.name) + "</span>" +
			'<span class="nlm-lib-sub">' + kindLabel(f.kind) + " · " + U.fmtDate(new Date(f.ts).toISOString()) +
			(src.length ? " · Quelle: " + U.esc(src.map((p) => p.title || "Ohne Titel").join(", ").slice(0, 50)) : "") + "</span></span>" +
			'<span class="nlm-lib-btns"><button data-nlmlibplay="' + f.id + '" title="Öffnen/Abspielen">▶</button>' +
			'<button data-nlmlibplace="' + f.id + '" title="Einordnen">📌</button>' +
			'<button data-nlmlibsave="' + f.id + '" title="Herunterladen">⬇</button>' +
			'<button data-nlmlibdel="' + f.id + '" title="Löschen">🗑</button></span></div>';
	}
	async function refreshHubList() {
		const box = U.el("nlmHubList");
		if (!box) return;
		const inbox = (await fileList().catch(() => [])).filter((f) => !f.placedPageId);
		box.innerHTML = inbox.map(hubRowHtml).join("") ||
			'<div class="empty small">Inbox ist leer. Importierte Downloads erscheinen hier — alle (auch eingeordnete) Dateien: Bibliothek → 📥.</div>';
	}
	function renderPane(main) {
		main.innerHTML = '<div class="nlm-hub">' +
			"<h1>📓 " + PRODUCT + "</h1>" +
			'<p class="hint">Google hat NotebookLM in ' + PRODUCT + ' umbenannt — gleiches Produkt, neuer Name. Einbetten in der App blockiert Google, deshalb öffnet es extern.</p>' +
			'<div class="row-btns nlm-hub-actions">' +
				'<button id="btnNlmHubCopy">📚 Seiten als Quelle kopieren…</button>' +
				'<button id="btnNlmHubOpen">↗ ' + PRODUCT + ' öffnen</button>' +
				'<button id="btnNlmHubImport">📥 Download importieren…</button></div>' +
			'<div class="nlm-drop" id="nlmDrop">Heruntergeladene Datei aus ' + PRODUCT + ' (Podcast, Video, Mind Map, Folien …) hier ablegen — sie landet in der Inbox und lässt sich in Seiten einordnen.</div>' +
			'<h4 class="nlm-hub-sub">📥 Inbox</h4><div id="nlmHubList"></div></div>';
		U.el("btnNlmHubCopy").addEventListener("click", () => openPicker(openExternal));
		U.el("btnNlmHubOpen").addEventListener("click", openExternal);
		U.el("btnNlmHubImport").addEventListener("click", pickImportFiles);
		const drop = U.el("nlmDrop");
		["dragover", "dragenter"].forEach((t2) => drop.addEventListener(t2, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
		drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
		drop.addEventListener("drop", (e) => {
			e.preventDefault();
			drop.classList.remove("drag");
			importFiles(e.dataTransfer && e.dataTransfer.files);
		});
		refreshHubList();
	}
	const open = () => TABS.openPage("nlm:main");

	// ---- 📓-Dialog (Sidebar-Knopf, via extras.js verdrahtet) ----
	async function openDialog() {
		const files = await fileList().catch(() => []);
		const o = U.el("overlay");
		o.hidden = false;
		const rows = files.map((f) => '<div style="display:flex;gap:8px;align-items:center;padding:3px 0">' +
			'<span style="flex:none">' + kindIcon(f.kind) + "</span>" +
			'<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' + U.esc(f.name) + (f.placedPageId ? "" : ' <span class="nlm-tag">Inbox</span>') + "</span>" +
			'<button data-nlmplay="' + f.id + '">▶</button><button data-nlmplace="' + f.id + '" title="Einordnen">📌</button><button data-nlmsave="' + f.id + '">⬇</button><button data-nlmdel="' + f.id + '">🗑</button></div>').join("");
		o.innerHTML = '<div class="modal"><h3>📓 ' + PRODUCT + '</h3>' +
			'<p class="hint">Ehemals NotebookLM — Google hat das Produkt umbenannt.</p>' +
			'<div class="row-btns"><button id="btnNlmPick">📚 Seiten als Quelle kopieren…</button><button id="btnNlmOpen">↗ ' + PRODUCT + ' öffnen</button><button id="btnNlmImport">📥 Download importieren…</button></div>' +
			(files.length ? "<h4>📥 Mediathek</h4>" + rows : '<p class="hint">Noch keine Dateien — in ' + PRODUCT + ' herunterladen und hier bzw. im 📓-Tab importieren (Knopf oder Drag & Drop).</p>') +
			'<div class="modal-actions"><button id="btnNlmTab">📓 Import-Tab öffnen</button><button id="btnCloseOverlay">Schließen</button></div></div>';
		U.el("btnNlmPick").addEventListener("click", () => openPicker(openExternal));
		U.el("btnNlmOpen").addEventListener("click", () => { o.hidden = true; openExternal(); });
		U.el("btnNlmImport").addEventListener("click", () => { o.hidden = true; pickImportFiles(); });
		U.el("btnNlmTab").addEventListener("click", () => { o.hidden = true; open(); });
		o.querySelectorAll("[data-nlmplay]").forEach((b) => b.addEventListener("click", () => playById(b.dataset.nlmplay)));
		o.querySelectorAll("[data-nlmplace]").forEach((b) => b.addEventListener("click", () => { o.hidden = true; openPlaceDialog(b.dataset.nlmplace); }));
		o.querySelectorAll("[data-nlmsave]").forEach((b) => b.addEventListener("click", () => saveById(b.dataset.nlmsave)));
		o.querySelectorAll("[data-nlmdel]").forEach((b) => b.addEventListener("click", async () => {
			await fileDel(b.dataset.nlmdel);
			openDialog(); // Liste neu aufbauen
		}));
	}

	// ---- KI-Tool (tools.js → send_to_notebooklm): Seiten kopieren + Gemini Notebook öffnen ----
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
		openExternal();
		return { ok: true, copied: pages.length, hint: 'Inhalte liegen in der Zwischenablage — in Gemini Notebook (ehemals NotebookLM) „Quelle hinzufügen → Kopierter Text" wählen und einfügen, dann z.B. Audio-Übersicht (Lernpodcast) erstellen. Heruntergeladene Ergebnisse anschließend im 📓-Tab der App importieren (Knopf oder Drag & Drop) — sie kennen diese Seiten als Herkunft.' };
	}

	return {
		openDialog, openExternal, sendPages, renderPane, importFiles,
		listArtifacts, playById, saveById, deleteById, placeById, kindIcon, kindLabel,
		hideEmbeddedIfActive: () => {}, // Kompatibilität: früherer Webview-Modus (v3) — bewusst No-Op
	};
})();