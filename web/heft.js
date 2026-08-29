"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { HANDSCHRIFT } from "./handschrift.js";
import { SCANCORE } from "./heft-scan.js";
import { PDFS } from "./pdfs.js";
import { movePage, insertAt, canDeletePages } from "./heft-pages-core.js";
import { documentShadow, diffDocument, blobId } from "./heft-document-core.js";
import { hitBox, lassoBounds, strokeBounds, translateStroke, strokeGeometry, applyStrokeGeometry, scaleStrokeFrom, nearPoint, pointInPolygon, strokeOutline, strokeHitAt } from "./heft-geometry.js";

// heft.js — GoodNotes-Kern für Impala67 (v13, 25. Juli 2026).
//
// PERSISTENZ-UMBAU: Hefte hatten bisher einen EIGENEN Transportweg — ein Blob je
// Heft in IndexedDB, als Datei nach Drive gespiegelt, im Log stand nur ein Zeiger
// ("heftUpdated" + blobHash). Das war die Ursache für sämtliche Heft-Sync-Fehler:
// zwei Transportwege mit getrennter Reihenfolge, ein Müllsammler, der raten musste,
// welche Datei noch gebraucht wird, Zeiger die ins Leere liefen, und pro Heft nur
// Last-Write-Wins — gleichzeitiges Zeichnen auf zwei Geräten konnte nur EINEN
// Stand überleben lassen.
//
// Jetzt gilt für Hefte dasselbe wie für Seiten und Karten: der Inhalt IST das Log.
// Jede Änderung wird als "heftOps"-Event gespeichert (Strich hinzu, Striche weg,
// Seite hinzu, …), state.js spielt sie zu S.heftDocs ab. Hier drin wird auf dem
// abgespielten Dokument gezeichnet und beim Speichern nur noch der Unterschied
// zum zuletzt veröffentlichten Stand als Operationsliste abgeschickt.
//
// Folge: keine Heft-Dateien in Drive, kein Müllsammler, keine Hash-Abgleiche, keine
// Konflikt-Kopien — und zwei Geräte, die gleichzeitig im selben Heft zeichnen,
// führen ihre Striche automatisch zusammen.
//
// Scanner-Bildverarbeitung lebt in heft-scan.js (SCANCORE), Handschrift-OCR in handschrift.js.

export const HEFT = (() => {
	const PAGE_W = 1000, PAGE_H = 1414;
	const KEY = (p) => "heft:" + p;
	const INK_LEGACY = (p) => "impala67.ink." + p;
	const COLORS = ["#1c1c1e", "#2f6fed", "#e0483e", "#1f9d55", "#f5b800", "#8b7cc8"];
	const SIZES = [["F", 1.6], ["M", 3], ["B", 5.5]];
	const PAPERS = [["lined", "☰", "Liniert"], ["grid", "▦", "Kariert"], ["dots", "⣿", "Punkte"], ["blank", "▢", "Blanko"]];

	const docs = {};
	const thumbs = {};
	const THUMB_MAX = 60; // Speicher-Limit: Data-URLs sammelten sich sonst unbegrenzt an
	const dropThumbs = (p) => Object.keys(thumbs).forEach((k) => { if (k.startsWith(p + ":")) delete thumbs[k]; });
	const thumbJobs = {};
	const imgCache = {};
	let host = null, pid = null, doc = null, idx = 0, scale = 1, fitScale = 1;
	let canvases = [];
	let detailCanvases = [];
	let wetCanvases = [];
	let pageSlots = [];
	let detailVisible = new Set();

	const savedTools = (() => { try { return JSON.parse(localStorage.getItem("impala67HeftTools") || "{}"); } catch (err) { return {}; } })();
	let tool = "pen", color = savedTools.color || COLORS[0], size = savedTools.size || 3, onlyPen = savedTools.onlyPen !== false;
	let eraserSize = savedTools.eraserSize || 16;
	let inlineEd = null;
	let lastEmptyTap = null;
	function saveToolPrefs() { try { localStorage.setItem("impala67HeftTools", JSON.stringify({ color, size, onlyPen, eraserSize })); } catch (err) {  } }
	const activePenPointers = new Set();
	let lastPenUpAt = 0;
	const PEN_GRACE_MS = 400;
	let expanded = false;
	let trayPos = null;
	let trayDrag = null;
	// Rückzug der Werkzeugleiste beim Schreiben — EINE Wahrheit.
	// FIX (26. Juli, "Toolbar wird immer schlagartig transparent"): Die Klasse
	// "heft-writing" wurde direkt an zwei Stellen ans DOM gehängt (onDown/onUp),
	// während updateChrome() die className aus dem frisch gerenderten HTML
	// überschreibt — dort steht sie nie drin. Jeder Render mitten im Strich (Seiten-
	// zähler, Werkzeug-Hold, Thumbnail) riss die Leiste also auf volle Deckkraft und
	// der nächste Strich riss sie wieder weg: das schlagartige Flackern. Jetzt hält ein
	// Flag den Zustand, applyWriting() ist die einzige Stelle, die ihn ans DOM bringt,
	// und das Zurückkommen ist kurz verzögert, damit Strich-für-Strich-Schreiben nicht
	// dauernd blinkt.
	let writing = false, writingOffT = 0;
	function applyWriting() {
		const el = host && host.querySelector(".heft-chrome");
		if (el) el.classList.toggle("heft-writing", writing);
	}
	function setWriting(on) {
		clearTimeout(writingOffT); writingOffT = 0;
		if (on) { if (!writing) { writing = true; applyWriting(); } return; }
		if (!writing) return;
		writingOffT = setTimeout(() => { writingOffT = 0; writing = false; applyWriting(); }, 700);
	}
	let drawing = null, saveT = 0, resizeFn = null, resizeObserver = null;
	let undoStack = [], redoStack = [];
	const UNDO_MAX = 100; // Speicher-Limit: stundenlanges Schreiben ließ den Stack unbegrenzt wachsen
	// pageId mitschreiben: pageIdx driftet, sobald Seiten eingefügt/gelöscht/importiert
	// werden -> Undo traf danach die falsche Seite. ID ist der stabile Anker.
	const pushUndo = (a) => {
		if (a.pageIdx != null && doc && doc.pages[a.pageIdx]) a.pageId = doc.pages[a.pageIdx].id;
		undoStack.push(a); if (undoStack.length > UNDO_MAX) undoStack.shift(); redoStack = [];
	};
	let sel = null;
	let lassoSel = null;
	let holdTool = null, holdTimer = 0, suppressEraserClick = false;
	const laserTimers = new Set();
	let insertPos = "after";
	let pop = null;
	let exportSel = null; // Set<pageIndex> im Export-Auswahlmodus des Seiten-Menüs
	let pageSelectGesture = null, suppressPageClickUntil = 0, pageDragFrom = -1;
	let scanUI = null;

	const ocrQueueV2 = new Set();
	const ocrLastRun = new Map();
	let ocrTimerV2 = 0, ocrBusyV2 = false;
	// OCR nur im Leerlauf starten: das 1100px-Canvas-Rendern blockierte sonst kurz das
	// Scrollen/Schreiben (Mikroruckler). requestIdleCallback wartet auf eine ruhige Phase
	// (max. +10 s); Safari ohne die API verhält sich exakt wie bisher.
	const runOcrWhenIdle = () => (window.requestIdleCallback ? window.requestIdleCallback(() => runHandwritingIndexV2(), { timeout: 10000 }) : runHandwritingIndexV2());
	function scheduleHandwritingIndexV2(pi) {
		if (!HANDSCHRIFT.available()) return;
		ocrQueueV2.add(pi);
		clearTimeout(ocrTimerV2);
		ocrTimerV2 = setTimeout(runOcrWhenIdle, 4000);
	}
	async function runHandwritingIndexV2() {
		// Nach unmount NICHT neu einplanen — sonst tickte der 4-s-Timer ewig weiter (Akku).
		if (ocrBusyV2 || !doc || !pid) { clearTimeout(ocrTimerV2); if (doc && pid) ocrTimerV2 = setTimeout(runOcrWhenIdle, 4000); return; }
		const jobPid = pid, jobDoc = doc;
		const indices = [...ocrQueueV2];
		ocrQueueV2.clear();
		ocrBusyV2 = true;
		try {
			for (const pi of indices) {
				const key = jobPid + ":" + pi;
				if (Date.now() - (ocrLastRun.get(key) || 0) < 45000) { ocrQueueV2.add(pi); continue; }
				const pg = jobDoc.pages[pi];
				if (!pg || !(pg.strokes && pg.strokes.length)) continue;

				const cv = renderPageCanvas(pg, 1100);
				ocrLastRun.set(key, Date.now());
				const text = await HANDSCHRIFT.recognize(cv);

				if (pid !== jobPid || doc !== jobDoc || text == null) continue;
				if (String(text).trim() !== String(pg.ocrText || "").trim()) {
					pg.ocrText = String(text).trim();
					scheduleSave();
				}
			}
		} catch (e) { console.warn("Heft: Handschrift-Erkennung v2 fehlgeschlagen", e); }
		ocrBusyV2 = false;

		if (ocrQueueV2.size) { clearTimeout(ocrTimerV2); ocrTimerV2 = setTimeout(runOcrWhenIdle, 45000); }
	}

	const enc = new TextEncoder(), dec = new TextDecoder();

	const newPage = (paper) => ({ id: U.uid(), paper: paper || "lined", strokes: [], images: [], texts: [], ocrText: "" });

	// ---- Veröffentlichen: Unterschied zum letzten Stand als Operationsliste ----
	// published[pageId] ist bewusst KEINE Kopie des Dokuments, sondern ein
	// Schatten aus IDs und billigen Signaturen. Eine echte Kopie wäre bei Heften
	// mit eingebetteten Bildern teuer — zum Erkennen von "neu / geändert / weg"
	// reicht die Signatur völlig.
	const published = {};

	// ---- Bilder, Scans und PDF-Seiten als eigene, unveränderliche Blob-Events ----
	// Ein Foto oder Scan ist schnell 1–3 MB groß. Bisher steckte die komplette dataURL
	// IM Bild-Objekt des Hefts. Folge: jedes Verschieben und jedes Skalieren schickte das
	// ganze Bild erneut durchs Log (die Signatur änderte sich, also ging ein "i=" mit
	// voller Nutzlast raus), und jeder Verdichtungs-Snapshot trug sämtliche Bilder noch
	// einmal mit sich. Bei ein paar gescannten Seiten wuchs das Log dadurch in Minuten
	// um zweistellige Megabyte — genau die Datenmenge, die der Sync danach hin- und
	// hertragen musste.
	// Jetzt wird der Bildinhalt GENAU EINMAL als "heftBlob" geschrieben; das Heft merkt
	// sich nur noch den Inhalts-Hash ({ id, ref, x, y, w, h }, ca. 80 Byte). Verschieben
	// kostet damit ein paar Byte statt ein paar Megabyte, und zwei Geräte, die dasselbe
	// Bild einfügen, teilen sich automatisch einen Eintrag (gleicher Inhalt = gleicher Hash).
	const pendingBlobData = new Map();
	const blobWrites = new Map();
	function ensureBlobPersisted(hash, dataUrl) {
		if (blobWrites.has(hash)) return blobWrites.get(hash);
		const write = STATE.dispatch("heftBlob", { hash, data: dataUrl }).then(() => {
			pendingBlobData.delete(hash);
		}).finally(() => {
			if (blobWrites.get(hash) === write) blobWrites.delete(hash);
		});
		blobWrites.set(hash, write);
		return write;
	}
	function blobRef(dataUrl) {
		const hash = blobId(dataUrl);
		if (!S.heftBlobs[hash]) {
			// Sofort im Speicher hinterlegen, damit das Bild ohne Wartezeit gezeichnet werden
			// kann; das Event ist nur die Persistenz (der Reducer überschreibt nichts).
			S.heftBlobs[hash] = dataUrl;
			pendingBlobData.set(hash, dataUrl);
			void ensureBlobPersisted(hash, dataUrl).catch((e) => console.warn("Heft: Bilddaten speichern fehlgeschlagen", e));
		}
		return hash;
	}
	async function persistReferencedBlobs(saveDoc) {
		const refs = new Set((saveDoc?.pages || []).flatMap((pg) => (pg.images || []).map((im) => im.ref).filter(Boolean)));
		for (const ref of refs) {
			const data = pendingBlobData.get(ref);
			if (data) await ensureBlobPersisted(ref, data);
		}
	}
	// Bildquelle auflösen: neue Bilder tragen ref, Alt-Bestände noch src.
	const imgSrc = (im) => (im && im.ref ? (S.heftBlobs[im.ref] || "") : (im && im.src) || "");
	// Alt-Bild (dataURL inline) beim ersten Anfassen in eine Referenz umschreiben.
	function toRefImage(im) {
		if (!im || !im.src || im.ref) return im;
		const { src, ...rest } = im;
		return { ...rest, ref: blobRef(src) };
	}

	// Alt-Bestände (Blob je Heft bzw. localStorage-Ink) werden beim ersten Öffnen
	// EINMAL in ein heftSnap-Event überführt. Danach lebt das Heft nur noch im Log.
	function normalizeDoc(d) {
		const withId = (o) => (o && o.id ? o : { ...o, id: U.uid() });
		const pages = (d && Array.isArray(d.pages) ? d.pages : []).map((pg) => ({
			id: pg.id || U.uid(),
			paper: pg.paper || "lined",
			strokes: (pg.strokes || []).map(withId),
			images: (pg.images || []).map((im) => toRefImage(withId(im))),
			texts: (pg.texts || []).map(withId),
			ocrText: pg.ocrText || "",
		}));
		return pages.length ? { v: 2, rev: 0, pages } : null;
	}
	async function readLegacyDoc(p) {
		try {
			const rec = await DB.getBlob(KEY(p));
			if (rec && rec.buf && rec.buf.byteLength) {
				const parsed = JSON.parse(dec.decode(rec.buf));
				const norm = normalizeDoc(parsed);
				if (norm) return norm;
			}
		} catch (e) { console.warn("Heft: Alt-Blob lesen fehlgeschlagen", e); }
		const legacy = takeLegacyInk(p);
		if (legacy) return normalizeDoc({ pages: [{ paper: "lined", strokes: legacy }] });
		return null;
	}
	const page = () => (doc ? doc.pages[idx] : null);
	const imagesOf = (pg) => (pg.images || (pg.images = []));

	function takeLegacyInk(p) {
		try {
			const raw = localStorage.getItem(INK_LEGACY(p));
			if (!raw) return null;
			const d = JSON.parse(raw);
			localStorage.removeItem(INK_LEGACY(p));
			if (d && Array.isArray(d.strokes) && d.strokes.length) return d.strokes;
		} catch (e) { console.warn("Heft: Legacy-Ink lesen fehlgeschlagen", e); }
		return null;
	}
	function purgeOrphanLegacyInk() {
		try {
			const doomed = [];
			for (let i = 0; i < localStorage.length; i++) {
				const k = localStorage.key(i);
				if (k && k.startsWith("impala67.ink.")) doomed.push(k);
			}
			doomed.forEach((k) => {
				const id = k.slice("impala67.ink.".length);
				const pg = S.pages && S.pages[id];
				if (pg && pg.kind === "heft") return;
				localStorage.removeItem(k);
			});
		} catch {  }
	}

	// Das Dokument kommt jetzt aus dem abgespielten Log. docs[p] IST S.heftDocs[p] —
	// dieselbe Objektreferenz. Trifft während des Zeichnens ein Fremd-Event ein,
	// fügt der Reducer die Striche direkt in die Arrays ein, auf denen hier gezeichnet
	// wird. Der alte Cache-Invalidierungs-Tanz über meta.rev entfällt ersatzlos.
	async function load(p) {
		// Der Start-Checkpoint hält große Bilddaten absichtlich außerhalb des sofort
		// geladenen Kernzustands. Alle produktiven Heft-Einstiege laufen durch load(),
		// daher genügt hier eine zentrale Schranke für Öffnen, Vorschau, KI und Export.
		await STATE.hydrateHeftBlobs();
		let d = S.heftDocs[p];
		if (!d || !d.pages.length) {
			const legacy = await readLegacyDoc(p);
			if (legacy) await STATE.dispatch("heftOps", { pageId: p, ops: diffDocument(null, legacy) });
			else await STATE.dispatch("heftOps", { pageId: p, ops: [{ t: "pg+", at: 0, page: { id: U.uid(), paper: "lined" } }] });
			d = S.heftDocs[p];
			// Der Alt-Blob hat seine Schuldigkeit getan — der Inhalt steht jetzt im Log.
			if (legacy) DB.delBlob(KEY(p)).catch(() => {});
		}
		try { localStorage.removeItem(INK_LEGACY(p)); } catch {  }
		docs[p] = d;
		if (!published[p]) published[p] = documentShadow(d);
		return d;
	}

	// Fremdänderungen sind eingetroffen (drive.js → STATE.emitRemoteApplied).
	// FIX (26. Juli, „der sync hat immer noch bugs beim heft sync“): Hier stand ein
	// saveNow()-Flush — gedacht als Schutz für eigene, noch nicht veröffentlichte Striche.
	// Er lief aber ZU SPÄT: drive.js spielt die fremden Events erst in S.heftDocs ein und
	// meldet sich DANACH. Der Diff verglich also das bereits ergänzte Dokument mit dem
	// alten Schatten — jeder empfangene fremde Strich sah wie eine eigene Neuerung aus und
	// ging als „s+“-Operation sofort wieder hoch. Ergebnis: jedes Gerät schickte jeden
	// fremden Strich zurück, das Log wuchs bei jedem Sync, und beim Hin- und Herspielen
	// konnten Striche doppelt erscheinen. Der Flush passiert jetzt VOR dem Abspielen
	// (drive.js → replayImported); hier wird nur noch der Schatten nachgezogen.
	async function onRemoteApplied() {
		for (const key of Object.keys(published)) {
			const d = S.heftDocs[key];
			dropThumbs(key); // Vorschauen anderer Hefte zeigten sonst den Stand vor dem Import
			if (d) { published[key] = documentShadow(d); docs[key] = d; }
			else delete published[key];
		}
		if (!pid || !host) return;
		const d = S.heftDocs[pid];
		if (!d || !d.pages.length) return;
		dropThumbs(pid);
		const structural = doc !== d || d.pages.length !== canvases.length;
		// Dokument komplett ersetzt (Snapshot-Import): Undo-Einträge zeigen auf Objekte des
		// verworfenen Dokuments -> verwerfen statt blind anwenden.
		if (doc && doc !== d) { undoStack = []; redoStack = []; }
		doc = d; docs[pid] = d;
		idx = Math.max(0, Math.min(idx, d.pages.length - 1));
		sel = null; lassoSel = null;
		if (structural) rebuildScroll();
		else {
			// FIX (25. Juli, "Striche erscheinen erst nach dem Neuladen"): renderVisiblePages()
			// zeichnet eine Seite nur dann neu, wenn sich die CANVAS-GRÖSSE geändert hat — das
			// ist beim Scrollen und Zoomen richtig, nach einem Import aber genau falsch: die
			// Größe bleibt gleich, der INHALT ist neu. Die fremden Striche standen dadurch zwar
			// im Dokument, wurden aber nie auf den Bildschirm gebracht. Jetzt werden alle
			// sichtbaren Seiten nach einem Import ausdrücklich neu gezeichnet.
			renderVisiblePages(true);
			visiblePageIndices().forEach(redrawPage);
		}
		updateChrome();
	}
	STATE.onRemoteApplied(onRemoteApplied);
	function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(saveNow, 350); }
	const refresh = (i) => { scheduleSave(); redrawPage(i); renderThumb(i); updateChrome(); };

	// Speichern = Unterschied ermitteln und als Operationsliste ins Log schicken.
	// Kein Blob, kein Hash, keine Datei — der Sync trägt das Event wie jedes andere.
	async function persistDoc(savePid, saveDoc) {
		const ops = diffDocument(published[savePid], saveDoc);
		if (!ops.length) return;
		const nextPublished = documentShadow(saveDoc);
		await persistReferencedBlobs(saveDoc);
		dropThumbs(savePid);
		await STATE.dispatch("heftOps", { pageId: savePid, ops });
		published[savePid] = nextPublished;
		await maybeSnapshot(savePid, saveDoc);
	}

	async function saveNow() {
		clearTimeout(saveT);
		if (!pid || !doc) return;

		const savePid = pid, saveDoc = doc;
		try { await persistDoc(savePid, saveDoc); }
		catch (e) { console.warn("Heft: Speichern fehlgeschlagen", e); }
	}

	// ---- Verlauf: lokale Snapshots je Heft (siehe "kommt noch") ----
	// Zeitstempel + rev stecken im Blob-Key ("heftver:<pid>:<t>:<rev>") — Auflisten und
	// Aufräumen brauchen so nur allBlobKeys(), keine Meta-Reads. Bewusst NICHT über Drive
	// gesynct: Snapshots erzeugen keine heftUpdated-Events, der Sync sieht sie nie.
	const VER_PREFIX = (p) => "heftver:" + p + ":";
	const VER_TTL = 24 * 60 * 60 * 1000, VER_GAP = 10 * 60 * 1000, VER_MAX = 20;
	const verLast = {}; // letzter Snapshot-Zeitpunkt je Heft (spart Key-Scan bei jedem Save)
	async function listSnapshots(p) {
		const pre = VER_PREFIX(p);
		return (await DB.allBlobKeys())
			.filter((k) => k.startsWith(pre))
			.map((k) => { const [t, rev] = k.slice(pre.length).split(":"); return { key: k, t: Number(t) || 0, rev: Number(rev) || 0 }; })
			.sort((a, b) => b.t - a.t);
	}
	async function pruneSnapshots(p) {
		const cutoff = Date.now() - VER_TTL;
		const all = await listSnapshots(p);
		const keep = all.filter((s, i) => i < VER_MAX && s.t >= cutoff);
		for (const s of all) if (!keep.includes(s)) await DB.delBlob(s.key);
		return keep;
	}
	const encodeDoc = (d) => { const b = enc.encode(JSON.stringify({ v: 2, pages: d.pages })); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
	async function writeSnapshot(p, buf, rev) {
		const t = Date.now();
		await DB.putBlob(VER_PREFIX(p) + t + ":" + rev, buf, { type: "application/json", kind: "heftver" });
		verLast[p] = t;
	}
	async function maybeSnapshot(p, d) {
		try {
			if (!verLast[p]) { const s = await listSnapshots(p); verLast[p] = s.length ? s[0].t : 0; }
			if (Date.now() - verLast[p] < VER_GAP) return; // gedrosselt: max. alle 10 Min.
			await writeSnapshot(p, encodeDoc(d), ((d && d.pages) || []).length);
			await pruneSnapshots(p);
		} catch (e) { console.warn("Heft: Verlauf-Snapshot fehlgeschlagen", e); }
	}
	async function restoreSnapshot(p, key) {
		const rec = await DB.getBlob(key);
		if (!rec || !rec.buf) { if (U.toast) U.toast("Snapshot nicht mehr vorhanden", "error"); return; }
		const cur = pid === p && doc ? doc : await load(p);
		// Sicherheitsnetz: aktuellen Stand IMMER sichern — Wiederherstellen ist damit selbst umkehrbar.
		await writeSnapshot(p, encodeDoc(cur), ((cur && cur.pages) || []).length);
		const restored = normalizeDoc(JSON.parse(dec.decode(rec.buf)));
		if (!restored) { if (U.toast) U.toast("Snapshot ist leer", "error"); return; }
		// Wiederherstellen ist ein normales Event — es synchronisiert damit von allein.
		await restoreDoc(p, restored);
		if (U.toast) U.toast("Heft-Stand wiederhergestellt");
	}
	// Gemeinsamer Wiederherstellungspfad für Verlauf und KI-Undo. Er aktualisiert nicht
	// nur das Event-Log, sondern auch die laufenden Canvas-Referenzen des geöffneten Hefts.
	async function restoreDoc(p, restored) {
		const target = { v: 2, rev: 0, pages: JSON.parse(JSON.stringify(restored?.pages || [])) };
		const current = S.heftDocs[p] || { v: 2, rev: 0, pages: [] };
		const ops = diffDocument(documentShadow(current), target);
		if (ops.length) await STATE.dispatch("heftOps", { pageId: p, ops });
		const d = S.heftDocs[p];
		docs[p] = d;
		published[p] = documentShadow(d);
		if (pid === p) {
			doc = d; idx = Math.min(idx, d.pages.length - 1); sel = null; lassoSel = null; undoStack = []; redoStack = [];
			rebuildScroll(); updateChrome();
		}
		return { ok: true };
	}
	async function openVerlaufPop() {
		if (!pop || !pid) return;
		const owner = pop;
		owner.dataset.kind = "verlauf";
		owner.innerHTML = '<div class="heft-pop-head">Verlauf wird geladen…</div>';
		let snaps = [];
		try { snaps = await pruneSnapshots(pid); } catch (e) { console.warn("Heft: Verlauf laden fehlgeschlagen", e); }
		if (pop !== owner) return; // Pop wurde inzwischen geschlossen/ersetzt
		const fmt = (t) => new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
		owner.__verSnaps = snaps;
		owner.innerHTML = '<div class="heft-pop-head">Verlauf (letzte 24 h)</div>' +
			(snaps.length
				? '<div class="heft-pop-grid">' + snaps.map((s, i) =>
					'<div class="heft-pop-thumb" data-heverrestore="' + i + '" role="button" tabindex="0" title="Stand ' + fmt(s.t) + ' wiederherstellen">' +
						'<canvas width="92" height="130"></canvas><span>' + fmt(s.t) + '</span></div>').join("") + '</div>' +
					'<div class="heft-pop-sub">Antippen stellt den Stand wieder her — der aktuelle Stand wird vorher im Verlauf gesichert. Snapshots entstehen automatisch (max. alle 10 Min.), bleiben 24 h und nur auf diesem Gerät.</div>'
				: '<div class="heft-pop-sub">Noch keine Snapshots — sie entstehen automatisch beim Schreiben (max. alle 10 Min., 24 h aufbewahrt, nur auf diesem Gerät).</div>') +
			'<button type="button" class="heft-pop-row" data-hepagesback="1">← Zurück</button>';
		const cvs = owner.querySelectorAll(".heft-pop-thumb canvas");
		snaps.forEach((s, i) => { if (cvs[i]) renderBlobPreview(s.key, cvs[i]); });
	}

	function contentBottom(pg) {
		let y = 40;
		(pg.strokes || []).forEach((s) => (s.pts || []).forEach((p) => { if (p[1] > y) y = p[1]; }));
		(pg.images || []).forEach((im) => { if (im.y + im.h > y) y = im.y + im.h; });
		(pg.texts || []).forEach((t) => { if (t.y + (t.h || 60) > y) y = t.y + (t.h || 60); });
		return y;
	}
	async function addText(p, text, opts = {}) {
		const body = String(text || "").trim();
		if (!p || !body) return { ok: false, error: "Kein Text" };
		const d = await load(p);
		let pi = opts.pageIndex != null ? Math.max(0, Math.min(d.pages.length - 1, Number(opts.pageIndex) || 0)) : d.pages.length - 1;
		let pg = d.pages[pi], addedPage = false;
		const size = Math.max(16, Math.min(60, Number(opts.size) || 30));
		const w = Math.max(240, Math.min(PAGE_W - 120, Number(opts.w) || PAGE_W - 160));

		const probe = document.createElement("canvas").getContext("2d");
		const t = { id: U.uid(), text: body, x: 80, y: 0, w, h: 60, size, color: String(opts.color || "#1c1c1e") };
		t.h = Math.round(wrapTextLines(probe, t).length * size * TEXT_LH + TEXT_PAD * 2);
		let y = contentBottom(pg) + 30;
		if (opts.pageIndex == null && y > 80 && y + Math.min(t.h, 220) > PAGE_H - 50) {
			pg = newPage(pg.paper); d.pages.push(pg); pi = d.pages.length - 1; addedPage = true; y = 60;
		}
		t.y = Math.min(y, PAGE_H - 80);
		textsOf(pg).push(t);
		if (pid === p && doc === d) {

			pushUndo({ kind: "txtAdd", txt: t, pageIdx: pi });
			if (addedPage) rebuildScroll(); else redrawPage(pi);
			renderThumb(pi); updateChrome();
			scheduleSave();
		} else {
			await persistDoc(p, d);
		}
		return { ok: true, pageIndex: pi, addedPage };
	}
	// v8: das abgespielte Dokument ist die einzige Wahrheit. S.heftMeta war der
	// abgeleitete Rest aus der Blob-Ära und konnte nach einem Import veraltete
	// Seitenzahlen liefern (oder gar nicht mehr existieren).
	const docOf = (p) => S.heftDocs[p] || docs[p] || null;
	const hasHeft = (p) => { const d = docOf(p); return !!(d && d.pages && d.pages.length); };
	const pagesOf = (p) => { const d = docOf(p); return d && d.pages && d.pages.length ? d.pages.length : 1; };

	function paintPaper(x, w, h, kind) {
		x.fillStyle = "#fbfaf7";
		x.fillRect(0, 0, w, h);
		if (kind === "blank") return;
		x.save();
		if (kind === "dots") {
			x.fillStyle = "rgba(60,80,120,0.20)";
			for (let y = 40; y < h; y += 28) for (let gx = 40; gx < w; gx += 28) { x.beginPath(); x.arc(gx, y, 1.2, 0, Math.PI * 2); x.fill(); }
		} else {
			x.strokeStyle = "rgba(70,110,180,0.15)";
			x.lineWidth = 1;
			const x0 = kind === "lined" ? 90 : 0, x1 = kind === "lined" ? w - 50 : w;
			for (let y = kind === "lined" ? 96 : 28; y < h - (kind === "lined" ? 40 : 0); y += 28) { x.beginPath(); x.moveTo(x0, y); x.lineTo(x1, y); x.stroke(); }
			if (kind === "grid") for (let gx = 28; gx < w; gx += 28) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, h); x.stroke(); }
			if (kind === "lined") { x.strokeStyle = "rgba(224,72,62,0.22)"; x.beginPath(); x.moveTo(90, 40); x.lineTo(90, h - 40); x.stroke(); }
		}
		x.restore();
	}
	const segW = (b, p) => Math.max(0.5, b * (0.4 + (p == null ? 0.5 : p) * 1.2));
	function drawStroke(x, s) {
		const pts = s.pts;
		if (!pts || !pts.length) return;
		x.save();
		x.lineCap = "round"; x.lineJoin = "round"; x.strokeStyle = s.color;
		if (s.tool === "shape" && s.shape) {
			x.lineWidth = s.size || 3;
			const a = s.shape;
			if (a.type === "line") { x.beginPath(); x.moveTo(a.x1, a.y1); x.lineTo(a.x2, a.y2); x.stroke(); }
			else if (a.type === "ellipse") { x.beginPath(); x.ellipse(a.cx, a.cy, Math.abs(a.rx), Math.abs(a.ry), 0, 0, Math.PI * 2); x.stroke(); }
			else { x.strokeRect(Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1)); }
		} else if (s.tool === "marker") {
			x.globalAlpha = 0.32; x.lineWidth = s.size * 3;
			x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
			for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
			x.stroke();
		} else if (pts.length === 1) {
			x.beginPath(); x.fillStyle = s.color;
			x.arc(pts[0][0], pts[0][1], segW(s.size, pts[0][2]) / 2, 0, Math.PI * 2); x.fill();
		} else {
			let from = pts[0];
			for (let i = 1; i < pts.length; i++) {
				const cur = pts[i];
				const to = i < pts.length - 1 ? [(cur[0] + pts[i + 1][0]) / 2, (cur[1] + pts[i + 1][1]) / 2] : cur;
				x.beginPath(); x.lineWidth = segW(s.size, ((pts[i - 1][2] || 0.5) + (cur[2] || 0.5)) / 2);
				x.moveTo(from[0], from[1]);
				x.quadraticCurveTo(cur[0], cur[1], to[0], to[1]);
				x.stroke();
				from = to;
			}
		}
		x.restore();
	}

	const textsOf = (pg) => (pg.texts || (pg.texts = []));
	const TEXT_LH = 1.4, TEXT_PAD = 10;
	function wrapTextLines(x, t) {
		x.font = "500 " + (t.size || 30) + "px ui-rounded, 'Segoe Print', sans-serif";
		const maxW = Math.max(60, (t.w || 400) - TEXT_PAD * 2);
		const lines = [];
		for (const raw of String(t.text || "").split("\n")) {
			let line = "";
			for (const word of raw.split(/\s+/)) {
				const probe = line ? line + " " + word : word;
				if (line && x.measureText(probe).width > maxW) { lines.push(line); line = word; }
				else line = probe;
			}
			lines.push(line);
		}
		return lines;
	}
	function drawTextBox(x, t) {
		x.save();
		const lines = wrapTextLines(x, t);
		const lh = (t.size || 30) * TEXT_LH;
		t.h = Math.round(lines.length * lh + TEXT_PAD * 2);
		x.fillStyle = t.color || "#1c1c1e";
		x.textBaseline = "top";
		lines.forEach((line, i) => x.fillText(line, t.x + TEXT_PAD, t.y + TEXT_PAD + i * lh));
		x.restore();
	}

	const hitText = (pg, p) => hitBox(textsOf(pg), p);

	function imgEl(im) {
		let c = imgCache[im.id];
		if (!c) {
			c = new Image();
			c.onload = () => {

				if (pid) dropThumbs(pid);

				if (host && doc) {
					const pageIndex = doc.pages.findIndex((pg) => (pg.images || []).some((item) => item.id === im.id));
					if (pageIndex !== -1) { redrawPage(pageIndex); renderThumb(pageIndex); }
				}
			};
			c.src = imgSrc(im);
			imgCache[im.id] = c;
		}
		return c;
	}
	function drawLassoSelection(x, strokes) {
		const bb = lassoBounds(strokes || []);
		if (!bb) return;
		x.save(); x.setLineDash([8, 5]); x.strokeStyle = "#2f6fed"; x.lineWidth = 2;
		x.strokeRect(bb.minX - 9, bb.minY - 9, bb.maxX - bb.minX + 18, bb.maxY - bb.minY + 18);
		x.setLineDash([]); x.fillStyle = "#2f6fed"; x.beginPath(); x.arc(bb.maxX + 9, bb.maxY + 9, 8, 0, Math.PI * 2); x.fill(); x.restore();
	}

	function drawSelection(x, im) {
		x.save();
		x.strokeStyle = "#2f6fed"; x.lineWidth = 1.5; x.setLineDash([6, 4]);
		x.strokeRect(im.x, im.y, im.w, im.h);
		x.setLineDash([]);

		x.fillStyle = "#2f6fed";
		x.beginPath(); x.arc(im.x + im.w, im.y + im.h, 7, 0, Math.PI * 2); x.fill();

		x.fillStyle = "#e0483e";
		x.beginPath(); x.arc(im.x + im.w, im.y, 9, 0, Math.PI * 2); x.fill();
		x.strokeStyle = "#fff"; x.lineWidth = 2;
		x.beginPath();
		x.moveTo(im.x + im.w - 4, im.y - 4); x.lineTo(im.x + im.w + 4, im.y + 4);
		x.moveTo(im.x + im.w + 4, im.y - 4); x.lineTo(im.x + im.w - 4, im.y + 4);
		x.stroke();
		x.restore();
	}
	function renderPageTo(x, pg, pi, tileRect = null) {
		paintPaper(x, PAGE_W, PAGE_H, pg.paper);
		(pg.images || []).forEach((im) => {
			const el = imgEl(im);
			if (el.complete && el.naturalWidth) x.drawImage(el, im.x, im.y, im.w, im.h);
		});
		(pg.strokes || []).forEach((s) => {
			if (tileRect) {
				const b = s.bbox || strokeBounds(s);
				if (b && (b.maxX < tileRect.x || b.minX > tileRect.x + tileRect.w || b.maxY < tileRect.y || b.minY > tileRect.y + tileRect.h)) {
					return;
				}
			}
			drawStroke(x, s);
		});
		(pg.texts || []).forEach((t) => { if (!t.hidden) drawTextBox(x, t); });
		if (lassoSel && lassoSel.pageIdx === pi) drawLassoSelection(x, lassoSel.strokes);
		if (sel && doc && sel.pageIdx === pi && doc.pages[pi] === pg) {
			const im = sel.imgId ? imagesOf(pg).find((i2) => i2.id === sel.imgId) : null;
			if (im) drawSelection(x, im);
			const tx = sel.txtId ? textsOf(pg).find((t2) => t2.id === sel.txtId) : null;
			if (tx) drawSelection(x, tx);
		}
	}

	// pageIndex: welche Seite gezeigt wird (Default 0). Rückgabe null bei Fehler,
	// sonst { pageIndex, pageCount } — vorher fix Seite 0, ohne Rückmeldung welche
	// Seite es war (Konflikt-Popup zeigte dadurch bei Hefts immer "Seite 1").
	async function renderBlobPreview(blobKey, cv, pageIndex = 0) {
		try {
			const rec = await DB.getBlob(blobKey);
			if (!rec || !rec.buf) return null;
			const d = JSON.parse(new TextDecoder().decode(rec.buf));
			if (!d || !Array.isArray(d.pages) || !d.pages.length) return null;
			const pi = Math.max(0, Math.min(d.pages.length - 1, pageIndex));
			const pg = d.pages[pi];
			if (!Array.isArray(pg.strokes)) pg.strokes = [];
			paintInto(cv, pg, -1);
			return { pageIndex: pi, pageCount: d.pages.length };
		} catch (e) {
			console.warn("Heft-Konflikt-Vorschau fehlgeschlagen:", e);
			return null;
		}
	}

	// (findDivergentPage ist mit v8 entfallen: Heft-Konflikte kann es nicht mehr
	// geben, weil zwei Geräte ihre Striche zusammenführen statt sich zu überschreiben.)

	// Jede Zeichenflaeche merkt sich, mit welchem Massstab sie gefuellt wurde: die
	// Basis-Seite immer mit fit (unabhaengig vom Zoom), die Detail-Kachel mit fit * k.
	function applyTransform(x) {
		const cv = x.canvas, dpr = cv.__heftDpr || 1, s = cv.__heftScale || scale;
		x.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
	}
	function redrawPage(i) {
		if (!doc || !doc.pages[i]) return;
		redrawBasePage(i);
		renderDetailTile(i);
	}
	function redrawBasePage(i) {
		if (!doc || !doc.pages[i]) return;
		const cv = canvases[i];
		if (cv && cv.width >= 2 && cv.height >= 2) {
			const x = cv.getContext('2d');
			x.setTransform(1, 0, 0, 1, 0, 0);
			x.clearRect(0, 0, cv.width, cv.height);
			applyTransform(x);
			renderPageTo(x, doc.pages[i], i);
		}
	}

	// --- Ansicht: EINE Wahrheit (26. Juli, Neubau) ---------------------------
	// view = { x, y, k }: x/y ist die linke obere Ecke des sichtbaren Bereichs in
	// BASIS-Pixeln (Layout ohne Zoom), k der Zoomfaktor. Angewendet wird
	// ausschliesslich ein CSS-transform auf .heft-pages. Kein natives Scrollen, kein
	// Umlayouten beim Zoomen, keine Nachkorrektur: der Punkt unter den Fingern bleibt
	// per Konstruktion stehen. Dadurch sind keepAnchor, flipGlide, setZoom/queueZoom,
	// das Grid-Zentrieren und das Wachsen der Zeichenflaechen beim Zoomen entfallen.
	const ZOOM_MIN = 0.4, ZOOM_MAX = 6;
	const view = { x: 0, y: 0, k: 1 };
	const PAD_X = 18, PAD_BOTTOM = 56;
	const padTop = () => (window.innerWidth < 640 ? 36 : 46);

	// Die Basis-Seite hat jetzt eine FESTE Groesse (fit, unabhaengig vom Zoom),
	// deshalb darf sie in voller Geraeteauflaesung gefuellt werden. Die alte Grenze
	// von 1.5 stammte aus der Zeit, als die Zeichenflaeche mit dem Zoom mitwuchs -
	// auf einem 2x/3x-Bildschirm war dadurch jede Schrift dauerhaft weich.
	const MAX_RENDER_DPR = 3, MAX_RENDER_PIXELS = 6_000_000, MAX_CANVAS_DIM = 4096;
	let zoomSettleTimer = 0, scrollSettleTimer = 0, gesturePrefetchTimer = 0;
	const gesture = {
		pts: new Map(), pinch: null, last: null, maxCount: 0, moved: false, startedAt: 0, restore: null,
		raf: 0, fling: 0, anim: null, paintZoom: false, vx: 0, vy: 0, lastT: 0,
		lastTap: 0, tapX: 0, tapY: 0, lastTwoTap: 0,
	};
	const scrollEl = () => (host ? host.querySelector(".heft-scroll") : null);
	const pagesEl = () => (host ? host.querySelector(".heft-pages") : null);
	const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
	// Geometrie aendert sich nur bei layout()/DOM-Neuaufbau. Die alten Getter
	// erzwangen dagegen in jedem Scroll-Frame mehrere synchrone Layout-Messungen.
	let geometry = { viewport: null, content: { w: 1, h: 1 }, pages: [] };
	const viewport = () => geometry.viewport;
	const contentSize = () => geometry.content;
	function refreshGeometry(vp) {
		const scroll = scrollEl(), pgs = pagesEl();
		if (!scroll || !pgs) { geometry = { viewport: null, content: { w: 1, h: 1 }, pages: [] }; return; }
		const rect = vp || scroll.getBoundingClientRect();
		geometry = {
			viewport: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
			content: { w: pgs.offsetWidth, h: pgs.offsetHeight },
			pages: pageSlots.map((slot, i) => {
				const base = canvases[i];
				return slot && base ? {
					top: slot.offsetTop, height: slot.offsetHeight,
					x: slot.offsetLeft + base.offsetLeft, y: slot.offsetTop + base.offsetTop,
					w: base.offsetWidth, h: base.offsetHeight,
					baseLeft: base.offsetLeft, baseTop: base.offsetTop,
				} : null;
			}),
		};
	}

	function stopAnim() {
		if (gesture.raf) cancelAnimationFrame(gesture.raf);
		if (gesture.fling) cancelAnimationFrame(gesture.fling);
		gesture.raf = gesture.fling = 0; gesture.paintZoom = false;
		if (gesturePrefetchTimer) { clearTimeout(gesturePrefetchTimer); gesturePrefetchTimer = 0; }
		if (gesture.anim) { gesture.anim(); gesture.anim = null; }
	}
	function navReset() {
		stopAnim(); gesture.pts.clear();
		gesture.pinch = null; gesture.last = null; gesture.maxCount = 0; gesture.moved = false;
		gesture.vx = gesture.vy = 0; gesture.lastTap = 0; gesture.lastTwoTap = 0; gesture.restore = null;
	}
	// Grenzen an EINER Stelle: passt der Inhalt in die Ansicht, wird zentriert,
	// sonst am Rand gestoppt.
	function clampView(v) {
		const vp = viewport(); if (!vp) return v;
		const c = contentSize();
		v.k = clamp(v.k, ZOOM_MIN, ZOOM_MAX);
		const vw = vp.width / v.k, vh = vp.height / v.k;
		v.x = c.w <= vw ? (c.w - vw) / 2 : clamp(v.x, 0, c.w - vw);
		v.y = c.h <= vh ? (c.h - vh) / 2 : clamp(v.y, 0, c.h - vh);
		return v;
	}
	// Die EINZIGE Stelle, die die Ansicht auf den Bildschirm bringt.
	// Waehrend einer Geste wird NUR das transform gesetzt (billig, deshalb
	// fluessig) und der Layer per will-change fixiert. Beim Abschluss bzw. nach
	// einer kurzen Pause wird der Layer wieder FREIGEGEBEN und alles in echter
	// Aufloesung gezeichnet. Genau das fehlte: ein dauerhaftes
	// will-change: transform friert die Rasterung des Layers auf einer Zoomstufe
	// ein, der Browser skaliert danach nur noch ein altes Bild hoch - alles wirkte
	// unscharf.
	function paintView(commit, zooming = false) {
		const pgs = pagesEl(); if (!pgs) return;
		clampView(view);
		scale = fitScale * view.k;
		// Vor dem Transform-Schreibzugriff promoten. Vorher kam will-change erst
		// DANACH; Safari musste den riesigen Seiten-Layer im ersten Bewegungsframe
		// synchron neu zusammensetzen — der sichtbare Ruck direkt beim Losscrollen.
		if (!commit && pgs.style.willChange !== "transform") pgs.style.willChange = "transform";
		// Auf GANZE Geraetepixel einrasten. Eine gebrochene Verschiebung laesst den
		// Browser den ganzen Layer neu abtasten (bilinear) - Striche, Schrift und
		// importierte PDF-Seiten werden dadurch weich, obwohl die Aufloesung stimmt.
		const dprSnap = window.devicePixelRatio || 1;
		const snap = (v) => Math.round(v * dprSnap) / dprSnap;
		pgs.style.transform = "translate(" + snap(-view.x * view.k) + "px, " + snap(-view.y * view.k) + "px) scale(" + view.k.toFixed(4) + ")";
		positionDetailLayers();
		if (!commit) {
			// Während der Geste nur die bereits gerasterte Fläche verschieben. Eine
			// vollständige Seitenprüfung pro Frame blockierte Safari beim Scrollen.
			if (zooming) scheduleZoomSettleRender();
			else scheduleGesturePrefetch();
			return;
		}
		if (gesturePrefetchTimer) { clearTimeout(gesturePrefetchTimer); gesturePrefetchTimer = 0; }
		clearTimeout(zoomSettleTimer); zoomSettleTimer = 0;
		sharpen();
	}
	// Scharf machen: Layer freigeben, damit der Browser neu rastert, dann Seiten
	// und Detail-Kacheln fuer die aktuelle Zoomstufe fuellen.
	function sharpen() {
		const pgs = pagesEl(); if (!pgs) return;
		pgs.style.willChange = "auto";
		// Ein abgeschlossener Zoom oder ein Layoutwechsel (z. B. Seitenleiste)
		// braucht immer eine Kachel fuer die EXAKT aktuelle Fit-/Zoomstufe.
		// Eine nur geometrisch noch abdeckende alte Kachel darf hier nicht bleiben:
		// WebKit skaliert sie sonst hoch und das Heft wirkt dauerhaft unscharf.
		renderVisiblePages(false, true);
		viewChanged();
	}
	function schedulePaint(zooming = false) {
		gesture.paintZoom = gesture.paintZoom || zooming;
		const pgs = pagesEl();
		if (pgs && pgs.style.willChange !== "transform") pgs.style.willChange = "transform";
		if (gesture.raf) return;
		gesture.raf = requestAnimationFrame(() => {
			const isZoom = !!gesture.paintZoom;
			gesture.raf = 0; gesture.paintZoom = false;
			paintView(false, isZoom);
		});
	}
	function renderVisibleBasePages() {
		if (!doc) return;
		const nativeDpr = Math.min(MAX_RENDER_DPR, (window.devicePixelRatio || 1) * 1.5);
		const pageW = PAGE_W * fitScale, pageH = PAGE_H * fitScale;
		const pixelBudgetDpr = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, pageW * pageH));
		const edgeBudgetDpr = MAX_CANVAS_DIM / Math.max(pageW, pageH);
		const safeDpr = Math.max(0.5, Math.min(nativeDpr, pixelBudgetDpr, edgeBudgetDpr));
		for (const i of visiblePageIndices()) {
			const cv = canvases[i];
			if (!cv) continue;
			cv.__heftDpr = safeDpr; cv.__heftScale = fitScale;
			const w = Math.max(1, Math.round(pageW * safeDpr));
			const h = Math.max(1, Math.round(pageH * safeDpr));
			const needsRender = cv.width !== w || cv.height !== h;
			if (cv.width !== w) cv.width = w;
			if (cv.height !== h) cv.height = h;
			if (needsRender) redrawBasePage(i);
		}
	}
	function scheduleGesturePrefetch() {
		// Debounce statt Throttle: kontinuierliches Scrollen darf nie mitten in der
		// Bewegung Canvas-Seiten rasterisieren. Ein Touch-Ende rendert ohnehin sofort.
		if (gesturePrefetchTimer) clearTimeout(gesturePrefetchTimer);
		gesturePrefetchTimer = setTimeout(() => {
			gesturePrefetchTimer = 0;
			if (host && doc) renderVisibleBasePages();
		}, 80);
	}
	// Punkt unter (clientX, clientY) festhalten: ein Schritt, keine Korrektur.
	function zoomAt(nextK, clientX, clientY, commit) {
		const vp = viewport(); if (!vp) return;
		const k = clamp(nextK, ZOOM_MIN, ZOOM_MAX);
		const bx = view.x + (clientX - vp.left) / view.k, by = view.y + (clientY - vp.top) / view.k;
		view.k = k; view.x = bx - (clientX - vp.left) / k; view.y = by - (clientY - vp.top) / k;
		if (commit) paintView(true); else schedulePaint(true);
	}
	function animateTo(nx, ny, nk, dur = 300) {
		stopAnim();
		const pgs = pagesEl();
		if (pgs && pgs.style.willChange !== "transform") pgs.style.willChange = "transform";
		const from = { x: view.x, y: view.y, k: view.k };
		const to = clampView({ x: nx, y: ny, k: nk });
		const zooming = Math.abs(to.k - from.k) > 0.0001;
		gesture.anim = U.animate(dur, (t, e) => {
			view.x = from.x + (to.x - from.x) * e;
			view.y = from.y + (to.y - from.y) * e;
			view.k = from.k + (to.k - from.k) * e;
			paintView(t >= 1, zooming);
			if (t >= 1) gesture.anim = null;
		});
	}
	// Alle Seiten, die hoechstens pad Basis-Pixel vom sichtbaren Bereich entfernt sind.
	function pageIndicesWithin(pad) {
		const vp = viewport(); if (!vp) return [];
		const vh = vp.height / view.k;
		const top = view.y - pad, bot = view.y + vh + pad, out = [];
		geometry.pages.forEach((page, i) => {
			if (!page) return;
			if (page.top + page.height >= top && page.top <= bot) out.push(i);
		});
		return out;
	}
	// Gezeichnet wird eine ganze Bildschirmhoehe im Voraus, damit eine Seite schon
	// fertig ist, bevor sie ins Bild kommt.
	function visiblePageIndices() {
		const vp = viewport(); if (!vp) return [];
		return pageIndicesWithin(Math.max(400, (vp.height / view.k) * 1.2));
	}
	// Detail-Kachel: deckt den sichtbaren Teil einer Seite scharf ab. Alles in
	// BASIS-Pixeln aus view gerechnet (nicht aus getBoundingClientRect) — deshalb
	// stimmt die Kachel auch mitten in einer Geste, und ihre Kosten haengen an der
	// Bildschirmgroesse statt am Zoomfaktor.
	function tileDpr(r) {
		// Die Kachel ist die EINZIGE Quelle der Schärfe (die Basis-Seite bleibt bei fit) — sie darf
		// deshalb die volle Geräteauflösung nutzen. Die alte 2er-Grenze machte 3x-Bildschirme
		// dauerhaft weich, obwohl das Pixel-Budget noch Luft hatte.
		// Überabtastung: bei Bildschirm-Zoom (k≈1) ist die Schrift sonst nur so fein wie ein
		// Gerätepixel — 1,5× rendern und vom Browser herunterskalieren lassen macht dünne
		// Striche deutlich glatter. Beim Hineinzoomen schneidet das Pixel-Budget unten das
		// von selbst wieder weg.
		const native = Math.min(MAX_RENDER_DPR, (window.devicePixelRatio || 1) * 1.5);
		const w = Math.max(1, r.w * view.k), h = Math.max(1, r.h * view.k);
		return Math.max(0.5, Math.min(native, Math.sqrt(MAX_RENDER_PIXELS / (w * h)), MAX_CANVAS_DIM / Math.max(w, h)));
	}
	function tileTransform(x, t) {
		const f = t.dpr * t.k;
		x.setTransform(t.dpr * t.scale, 0, 0, t.dpr * t.scale, -t.x * f, -t.y * f);
	}
	// layerRectFor arbeitet in Layout-Pixeln: diese Werte bestimmen Position und
	// Größe des CSS-Canvas. Striche und Bilder liegen dagegen in den festen
	// Seiten-Pixeln (PAGE_W/PAGE_H). Culling muss deshalb zurück in Seiten-Pixel
	// umgerechnet werden. Ohne diese Umrechnung verschwanden auf iPadOS je nach
	// fitScale ganze Strichbereiche beim Zoom.
	function pageRectForTile(r, f = fitScale) {
		const scaleForPage = Math.max(0.0001, f || 1);
		return { x: r.x / scaleForPage, y: r.y / scaleForPage, w: r.w / scaleForPage, h: r.h / scaleForPage };
	}
	function pageOrigin(i) {
		return geometry.pages[i] || null;
	}
	function layerRectFor(i, over = 64) {
		const vp = viewport(), o = pageOrigin(i);
		if (!vp || !o) return null;
		const vw = vp.width / view.k, vh = vp.height / view.k;
		// Auf ganze Basis-Pixel runden: eine gebrochene Kachelkante wird sonst beim
		// Anzeigen weich gerechnet.
		// Der Rand zählt in BILDSCHIRM-Pixeln, nicht in Basis-Pixeln. Vorher wuchs er mit dem Zoom
		// (bei k=5 über 700 Basis-Pixel je Seite): die Kachelfläche sprengte MAX_RENDER_PIXELS,
		// tileDpr fiel unter 1 und die Kachel wurde HOCHSKALIERT — ausgerechnet beim Hineinzoomen.
		// Kleinerer Rand (64 statt 140): Schärfe schlägt Vorausrendern.
		const pad = over / view.k;
		const x0 = Math.floor(clamp(view.x - o.x - pad, 0, o.w)), y0 = Math.floor(clamp(view.y - o.y - pad, 0, o.h));
		const x1 = Math.ceil(clamp(view.x + vw - o.x + pad, 0, o.w)), y1 = Math.ceil(clamp(view.y + vh - o.y + pad, 0, o.h));
		if (x1 - x0 < 2 || y1 - y0 < 2) return null;
		return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
	}
	function positionDetailLayer(cv) {
		const t = cv && cv.__heftTile, page = t && pageOrigin(t.pageIndex);
		if (!t || !page || cv.style.display === "none") return;
		const dprSnap = window.devicePixelRatio || 1;
		const snap = (v) => Math.round(v * dprSnap) / dprSnap;
		// Die Detailkachel ist absichtlich ein DIREKTES Kind der unskalierten
		// .heft-scroll. So kann WebKit sie weder mit .heft-pages zusammenrasterisieren
		// noch bei hohem Zoom ein altes Bild der Kachel hochskalieren.
		cv.style.left = snap((page.x + t.x - view.x) * view.k) + "px";
		cv.style.top = snap((page.y + t.y - view.y) * view.k) + "px";
		cv.style.width = (t.w * view.k) + "px";
		cv.style.height = (t.h * view.k) + "px";
	}
	function positionDetailLayers() {
		detailCanvases.forEach(positionDetailLayer);
		wetCanvases.forEach(positionDetailLayer);
	}
	function placeLayer(cv, i, r, dpr) {
		const page = geometry.pages[i], k = view.k;
		if (!page) return;
		cv.style.transformOrigin = "0 0";
		cv.style.transform = "none";
		const pw = Math.max(1, Math.round(r.w * dpr * k)), ph = Math.max(1, Math.round(r.h * dpr * k));
		if (cv.width !== pw) cv.width = pw;
		if (cv.height !== ph) cv.height = ph;
		cv.__heftDpr = dpr; cv.__heftScale = fitScale * k;
		cv.__heftTile = { pageIndex: i, x: r.x, y: r.y, w: r.w, h: r.h, dpr, k, scale: fitScale * k };
		cv.style.display = "block";
		positionDetailLayer(cv);
	}
	function hideLayer(cv) { if (cv) { cv.style.display = "none"; cv.__heftTile = null; } }
	function hideDetailCanvases() {
		detailCanvases.forEach(hideLayer);
		wetCanvases.forEach(hideLayer);
		detailVisible.clear();
	}

	function renderDetailTile(i) {
		const tile = detailCanvases[i], wet = wetCanvases[i];
		if (!tile || !doc || !doc.pages[i]) return;

		if (drawing && drawing.pageIdx === i && drawing.ctx && !drawing.erasing) return;
		const r = layerRectFor(i);
		if (!r) { hideLayer(tile); hideLayer(wet); return; }
		const dpr = tileDpr(r);
		placeLayer(tile, i, r, dpr);
		const x = tile.getContext("2d");
		x.setTransform(1, 0, 0, 1, 0, 0);
		x.clearRect(0, 0, tile.width, tile.height);
		x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
		tileTransform(x, tile.__heftTile);
		renderPageTo(x, doc.pages[i], i, pageRectForTile(r));
		if (wet) {
			placeLayer(wet, i, r, dpr);
			const wx = wet.getContext("2d");
			wx.setTransform(1, 0, 0, 1, 0, 0);
			wx.clearRect(0, 0, wet.width, wet.height);
		}
	}
	function tileCovers(i) {
		const tile = detailCanvases[i], t = tile && tile.__heftTile;
		// Eine Kachel mit HÖHERER Zoomstufe hat mehr Gerätepixel als nötig — sie ist scharf und
		// darf bleiben. Der alte Exakt-Vergleich verwarf sie bei der kleinsten Bewegung, dadurch
		// wurde bei jedem Frame neu gerendert (bzw. während der Geste gar nicht).
		if (!t || tile.style.display === "none" || t.k < view.k - 0.0001) return false;
		// Beim Ein-/Ausklappen der Seitenleiste aendert sich fitScale, view.k aber
		// nicht. Ohne diesen Vergleich galt die Kachel der alten Seitenbreite weiter
		// als scharf und wurde vom Browser auf die neue Breite skaliert.
		if (Math.abs(t.scale - fitScale * t.k) > 0.0001) return false;
		const need = layerRectFor(i, 0);
		if (!need) return false;
		return t.x <= need.x + 0.5 && t.y <= need.y + 0.5 &&
			t.x + t.w >= need.x + need.w - 0.5 && t.y + t.h >= need.y + need.h - 0.5;
	}

	function renderDetailTiles(force = false) {
		if (!doc) return;
		const next = new Set(pageIndicesWithin(Math.max(4, 64 / view.k)));
		for (const i of detailVisible) {
			if (!next.has(i)) { hideLayer(detailCanvases[i]); hideLayer(wetCanvases[i]); }
		}
		for (const i of next) {
			if (!layerRectFor(i)) { hideLayer(detailCanvases[i]); hideLayer(wetCanvases[i]); continue; }
			if (!force && tileCovers(i)) continue;
			renderDetailTile(i);
		}
		detailVisible = next;
	}

	function liveInkCtx(i) {
		const wet = wetCanvases[i];
		if (wet) {
			let r = wet.__heftTile;
			if (!r || wet.style.display === "none") {
				r = layerRectFor(i);
				if (r) {
					const dpr = tileDpr(r);
					placeLayer(wet, i, r, dpr);
				}
			}
			if (wet.__heftTile && wet.style.display !== "none") {
				const x = wet.getContext("2d");
				x.setTransform(1, 0, 0, 1, 0, 0);
				tileTransform(x, wet.__heftTile);
				return x;
			}
		}

		const x = canvases[i].getContext("2d");
		applyTransform(x);
		return x;
	}
	function clearLiveInk(i) {
		const wet = wetCanvases[i];
		if (!wet || !wet.__heftTile || wet.style.display === "none") return false;
		const x = wet.getContext("2d");
		x.setTransform(1, 0, 0, 1, 0, 0);
		x.clearRect(0, 0, wet.width, wet.height);
		tileTransform(x, wet.__heftTile);
		return true;
	}

	function commitStrokeRender(i, stroke) {
		const cv = canvases[i];
		if (cv && cv.width > 1) { const x = cv.getContext("2d"); applyTransform(x); drawStroke(x, stroke); }
		const tile = detailCanvases[i];
		if (tile && tile.__heftTile && tile.style.display !== "none") {
			const x = tile.getContext("2d"); tileTransform(x, tile.__heftTile); drawStroke(x, stroke);
		}
		clearLiveInk(i);
	}
	function renderVisiblePages(skipTiles = false, forceTiles = false) {
		if (!doc) return;
		const visible = new Set(visiblePageIndices());
		// Weiter aussen liegende Seiten behalten ihr Bild noch (Speicher gegen Ruckeln):
		// beim Hin- und Herscrollen muss dieselbe Seite sonst dauernd neu gezeichnet
		// werden, und genau das fuehlte sich wie "laedt ewig" an.
		const vpKeep = viewport();
		const keep = new Set(pageIndicesWithin(vpKeep ? (vpKeep.height / view.k) * 3.5 : 1200));

		// Die Basis-Seite wird IMMER in Basis-Aufloesung gefuellt, unabhaengig vom Zoom:
		// beim Zoomen muss dadurch keine Zeichenflaeche wachsen und nichts neu gezeichnet
		// werden. Die Schaerfe liefert die Detail-Kachel darueber.
		const nativeDpr = Math.min(MAX_RENDER_DPR, (window.devicePixelRatio || 1) * 1.5);
		const pageW = PAGE_W * fitScale, pageH = PAGE_H * fitScale;
		const pixelBudgetDpr = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, pageW * pageH));
		const edgeBudgetDpr = MAX_CANVAS_DIM / Math.max(pageW, pageH);

		const safeDpr = Math.max(0.5, Math.min(nativeDpr, pixelBudgetDpr, edgeBudgetDpr));
		canvases.forEach((cv, i) => {
			if (!visible.has(i)) {
				if (!keep.has(i) && (cv.width !== 1 || cv.height !== 1)) { cv.width = 1; cv.height = 1; }
				hideLayer(detailCanvases[i]); hideLayer(wetCanvases[i]);
				return;
			}
			cv.__heftDpr = safeDpr; cv.__heftScale = fitScale;
			const w = Math.max(1, Math.round(pageW * safeDpr));
			const h = Math.max(1, Math.round(pageH * safeDpr));

			const needsRender = cv.width !== w || cv.height !== h;
			if (cv.width !== w) cv.width = w;
			if (cv.height !== h) cv.height = h;
			if (needsRender) redrawBasePage(i);
		});

		if (!skipTiles) renderDetailTiles(forceTiles);
	}
	function scheduleZoomSettleRender() {
		clearTimeout(zoomSettleTimer);
		zoomSettleTimer = setTimeout(() => { zoomSettleTimer = 0; sharpen(); }, 110);
	}

	// Nur bei Groessenaenderung oder Neuaufbau: fit neu bestimmen und den Mittelpunkt
	// der Ansicht halten. Beim Zoomen wird das NIE aufgerufen.
	function layout() {
		const scroll = scrollEl(), pgs = pagesEl();
		if (!scroll) return;
		const vp = scroll.getBoundingClientRect();
		const padT = padTop();
		const availW = Math.max(1, vp.width - 2 * PAD_X), availH = Math.max(1, vp.height - padT - PAD_BOTTOM);
		const prev = fitScale || 1;
		const cx = view.x + (vp.width / view.k) / 2, cy = view.y + (vp.height / view.k) / 2;
		fitScale = Math.max(0.05, Math.min(availW / PAGE_W, availH / PAGE_H, 1));
		if (pgs) {
			pgs.style.setProperty("--heft-page-w", (PAGE_W * fitScale) + "px");
			pgs.style.setProperty("--heft-page-h", (PAGE_H * fitScale) + "px");
			// Der Rand ist Teil des Inhalts und zoomt mit. JS ist die einzige Quelle dafuer,
			// damit CSS und Rechnung nie auseinanderlaufen.
			pgs.style.padding = padT + "px " + PAD_X + "px " + PAD_BOTTOM + "px";
			pgs.style.transformOrigin = "0 0";
		}
		const f = fitScale / prev;
		view.x = cx * f - (vp.width / view.k) / 2;
		view.y = cy * f - (vp.height / view.k) / 2;
		// Ein Layout-Read nach den Groessen-Aenderungen; Gesten arbeiten danach
		// ausschliesslich mit stabilen Zahlen aus dem Cache.
		refreshGeometry(vp);
		paintView(true);
	}
	function animateZoom(target, clientX, clientY, dur = 280) {
		const vp = viewport(); if (!vp) return;
		const k = clamp(target, ZOOM_MIN, ZOOM_MAX);
		const bx = view.x + (clientX - vp.left) / view.k, by = view.y + (clientY - vp.top) / view.k;
		animateTo(bx - (clientX - vp.left) / k, by - (clientY - vp.top) / k, k, dur);
	}

	// Alle Gesten macht heft.js selbst, es gibt kein natives Scrollen mehr.
	function applyTouchAction() {
		const scroll = scrollEl();
		if (scroll) scroll.style.touchAction = "none";
		canvases.forEach((cv) => { if (cv) cv.style.touchAction = "none"; });
	}

	function onPenBoundary(e) {
		if (e.pointerType !== "pen") return;
		if (e.type === "pointerover") e.currentTarget.style.touchAction = "none";
	}

	// Handballen: KEINE Erkennung ueber die Kontaktflaeche (ein Daumen meldet die
	// gleiche Flaeche). Setzt der Stift innerhalb von PALM_UNDO_MS nach einer
	// Beruehrung auf, war es die Hand und die Verschiebung wird zurueckgenommen
	// (siehe onDown).
	const PALM_UNDO_MS = 350;
	const fingersOf = (list) => [...list].filter((t) => t.touchType !== "stylus");
	const touchMid = (t) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
	const touchDist = (t) => Math.max(1, Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY));
	// EIN Finger verschiebt nur im Stift-Modus (sonst zeichnet er), ZWEI Finger
	// verschieben und zoomen immer.
	const panWithOneFinger = () => touchNavigates();
	function startGesture(fingers) {
		if (fingers.length >= 2) {
			gesture.pinch = { d0: touchDist(fingers), mid0: touchMid(fingers), k0: view.k, x0: view.x, y0: view.y };
			gesture.last = null;
		} else {
			gesture.pinch = null;
			gesture.last = fingers.length === 1 ? [fingers[0].clientX, fingers[0].clientY] : null;
		}
		gesture.lastT = performance.now();
		gesture.vx = gesture.vy = 0;
	}
	function onTouchStart(e) {
		const fingers = fingersOf(e.touches);
		if (!fingers.length) return;
		for (const t of fingersOf(e.changedTouches)) gesture.pts.set(t.identifier, { x: t.clientX, y: t.clientY });
		gesture.maxCount = Math.max(gesture.maxCount, fingers.length);
		if (gesture.pts.size === 1) {
			gesture.moved = false; gesture.startedAt = Date.now();
			// Ansicht VOR der Beruehrung merken (Handballen-Nachsorge in onDown).
			const before = { x: view.x, y: view.y, k: view.k };
			gesture.restore = () => { view.x = before.x; view.y = before.y; view.k = before.k; paintView(true); };
		}
		if (fingers.length < 2 && !panWithOneFinger()) return;
		e.preventDefault(); stopAnim();
		startGesture(fingers);
	}
	function onTouchMove(e) {
		if (penRecently()) { navReset(); return; }
		for (const t of e.changedTouches) {
			const s = gesture.pts.get(t.identifier);
			if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 6) gesture.moved = true;
		}
		const fingers = fingersOf(e.touches);
		if (!fingers.length) return;
		if (fingers.length >= 2) {
			e.preventDefault();
			if (!gesture.pinch) startGesture(fingers);
			const g = gesture.pinch, vp = viewport();
			if (!g || !vp) return;
			const k = clamp(g.k0 * (touchDist(fingers) / g.d0), ZOOM_MIN, ZOOM_MAX);
			const mid = touchMid(fingers);
			// Der Basis-Punkt, der beim Gestenstart unter dem Fingermittelpunkt lag, liegt
			// danach unter dem AKTUELLEN Mittelpunkt: Zoomen und Verschieben in EINER
			// Rechnung, ohne Zwischenschritt und ohne Nachkorrektur.
			const bx = g.x0 + (g.mid0[0] - vp.left) / g.k0, by = g.y0 + (g.mid0[1] - vp.top) / g.k0;
			view.k = k;
			view.x = bx - (mid[0] - vp.left) / k;
			view.y = by - (mid[1] - vp.top) / k;
			schedulePaint(true);
			return;
		}
		if (!gesture.last || !panWithOneFinger()) return;
		e.preventDefault();
		const t = fingers[0], now = performance.now();
		const dx = t.clientX - gesture.last[0], dy = t.clientY - gesture.last[1];
		const dt = Math.max(8, now - gesture.lastT);
		gesture.vx = dx / dt; gesture.vy = dy / dt; gesture.lastT = now;
		gesture.last = [t.clientX, t.clientY];
		view.x -= dx / view.k; view.y -= dy / view.k;
		schedulePaint();
	}
	// Schwung nach dem Loslassen (das leistete vorher der native Scroller).
	function startFling() {
		let vx = gesture.vx, vy = gesture.vy, last = performance.now();
		const step = (now) => {
			const dt = Math.min(32, now - last); last = now;
			const decay = Math.pow(0.996, dt);
			vx *= decay; vy *= decay;
			const px = view.x, py = view.y;
			view.x -= vx * dt / view.k; view.y -= vy * dt / view.k;
			paintView(false);
			const still = Math.abs(view.x - px) < 0.15 && Math.abs(view.y - py) < 0.15;
			if (Math.hypot(vx, vy) < 0.03 || still) { gesture.fling = 0; paintView(true); return; }
			gesture.fling = requestAnimationFrame(step);
		};
		gesture.fling = requestAnimationFrame(step);
	}
	// true = es sind noch Finger unten, die Geste laeuft weiter.
	function endGesture(e) {
		for (const t of e.changedTouches) gesture.pts.delete(t.identifier);
		const fingers = fingersOf(e.touches);
		if (fingers.length) { startGesture(fingers); return true; }
		gesture.pinch = null; gesture.last = null;
		return false;
	}
	function onTouchEnd(e) {
		if (endGesture(e)) return;
		const quick = Date.now() - gesture.startedAt < 300 && !gesture.moved;
		const count = gesture.maxCount; gesture.maxCount = 0;
		if (quick && count === 2) {
			// Undo erst beim DOPPEL-Tipp mit zwei Fingern (vorher reichte EIN Zwei-Finger-Tipp —
			// zu viele versehentliche Rückgängig beim Umgreifen/Abstützen).
			const now2f = Date.now();
			if (now2f - gesture.lastTwoTap < 500) { gesture.lastTwoTap = 0; undo(); }
			else gesture.lastTwoTap = now2f;
			return;
		}
		if (quick && count >= 3) { redo(); return; }
		if (quick && count === 1 && e.changedTouches.length) {
			const t = e.changedTouches[0], now = Date.now();
			if (now - gesture.lastTap < 330 && Math.hypot(t.clientX - gesture.tapX, t.clientY - gesture.tapY) < 64) {

				gesture.lastTap = 0;
				animateZoom(view.k >= 1.9 ? 1 : Math.max(2.2, Math.min(ZOOM_MAX, view.k * 1.8)), t.clientX, t.clientY);
				return;
			}
			gesture.lastTap = now; gesture.tapX = t.clientX; gesture.tapY = t.clientY;
			return;
		}
		if (gesture.moved && count === 1 && performance.now() - gesture.lastT < 90 && Math.hypot(gesture.vx, gesture.vy) > 0.25) startFling();
		else paintView(true);
	}
	function onTouchCancel(e) {
		gesture.moved = true;
		if (endGesture(e)) return;
		paintView(true);
	}
	let wheelCommitT = 0;
	function onWheelZoom(e) {
		e.preventDefault(); stopAnim();
		if (e.ctrlKey || e.metaKey) zoomAt(view.k * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY, false);
		else { view.x += e.deltaX / view.k; view.y += e.deltaY / view.k; schedulePaint(); }
		clearTimeout(wheelCommitT);
		wheelCommitT = setTimeout(() => paintView(true), 160);
	}

	const pos = (e, cv) => {
		const r = cv.getBoundingClientRect();
		return [
			Math.round((e.clientX - r.left) / scale * 10) / 10,
			Math.round((e.clientY - r.top) / scale * 10) / 10,
			Math.round((e.pressure || 0.5) * 100) / 100,
		];
	};

	const penRecently = () => activePenPointers.size > 0 || Date.now() - lastPenUpAt < PEN_GRACE_MS;
	const rejected = (e) => e.pointerType === "touch" && (onlyPen || penRecently());
	const touchNavigates = () => onlyPen && !penRecently();
	const lassoTouchAction = (pointerType, currentTool, onLasso) => pointerType === "touch" && currentTool === "lasso" ? (onLasso ? "interact" : "dismiss") : "none";
	const hitImage = (pg, p) => hitBox(imagesOf(pg), p);
	let eraseFrame = 0; // PERF: gedrosselter Redraw für Radierer & Lasso-Verschieben
	const redrawNextFrame = (pi) => { if (!eraseFrame) eraseFrame = requestAnimationFrame(() => { eraseFrame = 0; redrawPage(pi); }); };
	// Radierer-Feedback ("wo wirkt er?"): ein Ring in echter Radierer-Größe als DOM-Element
	// im Host. Bewusst KEIN Canvas-Zeichnen — das hinterlässt Schlieren auf der Seite oder
	// erzwingt zusätzliche Redraws; dieses Element folgt einfach dem Zeiger.
	function showEraserRing(e) {
		if (!host) return;
		let ring = host.querySelector(".heft-eraser-ring");
		if (!ring) { ring = document.createElement("div"); ring.className = "heft-eraser-ring"; host.appendChild(ring); }
		// GRÖSSE: eraserSize sind Seiten-Einheiten, der Ring lebt im unskalierten Host —
		// maßgeblich ist deshalb scale (= fitScale * view.k). Vorher fehlte fitScale, der
		// Ring war dadurch deutlich größer als die Fläche, die wirklich radiert.
		const box = host.getBoundingClientRect(), d = eraserSize * 2 * scale;
		ring.style.width = ring.style.height = d + "px";
		ring.style.left = (e.clientX - box.left) + "px";
		ring.style.top = (e.clientY - box.top) + "px";
		ring.hidden = false;
	}
	function hideEraserRing() {
		const ring = host && host.querySelector(".heft-eraser-ring");
		if (ring) ring.hidden = true;
	}
	// Strichradierer: ein berührter Strich geht GANZ weg. Das Auftrennen an der
	// Radierer-Fläche ist wieder raus — es kostete pro Pointer-Event neue Strich-Objekte
	// (samt neuen IDs, Sync-Ereignissen und Voll-Redraws) und war deshalb zäh.
	function eraseAt(e) {
		showEraserRing(e);
		const p0 = pos(e, drawing.cv), r = eraserSize, pg = doc.pages[drawing.pageIdx];
		// PERF: Pointer-Events feuern viel dichter, als der Radierer breit ist —
		// Mini-Schritte müssen nicht jedes Mal alle Striche der Seite prüfen.
		const lp = drawing.lastErase;
		if (lp && Math.hypot(p0[0] - lp[0], p0[1] - lp[1]) < r * 0.35) return;
		drawing.lastErase = p0;
		const keep = [], removed = [];
		for (const s of pg.strokes) {
			if (strokeHitAt(s, p0[0], p0[1], r)) removed.push(s); else keep.push(s);
		}
		if (removed.length) {
			pg.strokes = keep; drawing.removed.push(...removed);
			// PERF: höchstens EIN Redraw pro Frame — der Bildschirm zeichnet seltener,
			// als Pointer-Events eintreffen.
			redrawNextFrame(drawing.pageIdx);
		}
	}
	function onDown(e) {

		if (e.pointerType === "pen") {
			activePenPointers.add(e.pointerId); stopAnim(); applyTouchAction();
			// Handballen-Nachsorge: hat eine Berührung Millisekunden vorher die Seite
			// verschoben, war das die Hand — zurück auf die alte Position.
			if (gesture.restore && Date.now() - gesture.startedAt < PALM_UNDO_MS) gesture.restore();
			gesture.restore = null;
		}
		// Handballen: eine bereits bestehende blaue Markierung wegräumen (CSS verhindert
		// neue, das hier löst die alte auf — sonst blieb sie sichtbar hängen).
		// nicht 'sel' benennen: verdeckte die Heft-Auswahl im ganzen Block
		if (e.pointerType !== "mouse") { const domSel = window.getSelection?.(); if (domSel && !domSel.isCollapsed) domSel.removeAllRanges(); }
		if (!doc) return;
		const cv = e.currentTarget;
		const slot = cv.closest('.heft-page-slot');
		const pi = slot ? Number(slot.dataset.hepage) : idx;
		const pg = doc.pages[pi];
		if (!pg) return;
		const p = pos(e, cv);
		const activeLassoBox = lassoSel && lassoSel.pageIdx === pi ? lassoBounds(lassoSel.strokes) : null;
		const onLasso = !!activeLassoBox && p[0] >= activeLassoBox.minX - 18 && p[0] <= activeLassoBox.maxX + 22 && p[1] >= activeLassoBox.minY - 18 && p[1] <= activeLassoBox.maxY + 22;
		// Ein Fingertipp außerhalb beendet Auswahl UND Lasso-Modus. Der Nur-Stift-
		// Schalter darf dagegen Verschieben/Skalieren einer Auswahl per Finger zulassen.
		const touchLasso = lassoTouchAction(e.pointerType, tool, onLasso);
		if (touchLasso === "dismiss") {
			const oldPage = lassoSel?.pageIdx;
			lassoSel = null; tool = "pen"; expanded = true;
			if (oldPage != null) redrawPage(oldPage);
			updateChrome();
			return;
		}
		if (rejected(e) && touchLasso !== "interact") return;
		idx = pi;
		e.preventDefault();
		try { cv.setPointerCapture(e.pointerId); } catch {  }

		const x = liveInkCtx(pi);
		if (tool === "lasso") {

			if (lassoSel && lassoSel.pageIdx === pi && lassoSel.strokes.length) {
				const bb = lassoBounds(lassoSel.strokes);
				if (bb && nearPoint(p, bb.maxX + 9, bb.maxY + 9, 22)) {
					const w = Math.max(1, bb.maxX - bb.minX), h = Math.max(1, bb.maxY - bb.minY);
					drawing = { lassoResize: true, strokes: lassoSel.strokes, originals: lassoSel.strokes.map(strokeGeometry), cv, pageIdx: pi, anchor: [bb.minX, bb.minY], base: [w, h], factor: 1 };
					return;
				}
				if (bb && p[0] >= bb.minX - 12 && p[0] <= bb.maxX + 12 && p[1] >= bb.minY - 12 && p[1] <= bb.maxY + 12) {
					drawing = { lassoMove: true, strokes: lassoSel.strokes, cv, pageIdx: pi, last: p, dx: 0, dy: 0 };
					return;
				}
			}

			drawing = { lasso: true, pts: [p], cv, ctx: x, pageIdx: pi };
			return;
		}
		if (tool === "laser") {

			drawing = { laser: true, tool: "pen", color: "#ef4444", size: 7, pts: [p], cv, ctx: x, pageIdx: pi };
			return;
		}
		if (tool === "select") {

			const st = sel && sel.pageIdx === pi && sel.txtId ? textsOf(pg).find((t2) => t2.id === sel.txtId) : null;
			if (st && nearPoint(p, st.x + st.w, st.y, 16)) {

				pg.texts = textsOf(pg).filter((t2) => t2 !== st);
				pushUndo({ kind: "txtDel", txt: st, pageIdx: pi });
				sel = null;
				refresh(pi);
				return;
			}
			if (st && nearPoint(p, st.x + st.w, st.y + (st.h || 60), 16)) {

				drawing = { imgResize: true, isText: true, im: st, cv, pageIdx: pi, start: p, orig: { x: st.x, y: st.y, w: st.w, h: st.h } };
				return;
			}
			const ht = hitText(pg, p);
			if (ht) {
				const now = Date.now();
				if (sel && sel.txtId === ht.id && now - (sel.tapAt || 0) < 400) {

					sel = { pageIdx: pi, txtId: ht.id, tapAt: 0 };
					openTextEditor(pi, ht.x, ht.y, ht);
					return;
				}
				sel = { pageIdx: pi, txtId: ht.id, tapAt: now };
				drawing = { imgMove: true, isText: true, im: ht, cv, pageIdx: pi, start: p, orig: { x: ht.x, y: ht.y, w: ht.w, h: ht.h } };
				redrawPage(pi);
				return;
			}

			const im = sel && sel.pageIdx === pi ? imagesOf(pg).find((i2) => i2.id === sel.imgId) : null;
			if (im && nearPoint(p, im.x + im.w, im.y, 16)) {

				pg.images = imagesOf(pg).filter((i2) => i2 !== im);
				pushUndo({ kind: "imgDel", img: im, pageIdx: pi });
				sel = null;
				refresh(pi);
				return;
			}
			if (im && nearPoint(p, im.x + im.w, im.y + im.h, 16)) {

				drawing = { imgResize: true, im, cv, pageIdx: pi, start: p, orig: { x: im.x, y: im.y, w: im.w, h: im.h } };
				return;
			}
			const hit = hitImage(pg, p);
			if (hit) {
				sel = { pageIdx: pi, imgId: hit.id };
				drawing = { imgMove: true, im: hit, cv, pageIdx: pi, start: p, orig: { x: hit.x, y: hit.y, w: hit.w, h: hit.h } };
				redrawPage(pi);
				lastEmptyTap = null;
			} else {

				const now2 = Date.now();
				if (lastEmptyTap && lastEmptyTap.pi === pi && now2 - lastEmptyTap.t < 450 && Math.hypot(p[0] - lastEmptyTap.p[0], p[1] - lastEmptyTap.p[1]) < 40) {
					lastEmptyTap = null;
					openTextEditor(pi, Math.max(20, p[0] - 10), Math.max(20, p[1] - 20), null);
					return;
				}
				lastEmptyTap = { pi, t: now2, p };
				if (sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
			}
			return;
		}
		if (sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
		if (tool === "eraser") { drawing = { erasing: true, removed: [], cv, ctx: x, pageIdx: pi }; eraseAt(e); }
		else { drawing = { tool, color, size, pts: [p], cv, ctx: x, pageIdx: pi }; armHoldSnap(p); }

		setWriting(true);
	}

	let snapTimer = null;
	function armHoldSnap(p) {
		if (snapTimer) clearTimeout(snapTimer);
		snapTimer = null;
		if (!drawing || drawing.snapped || drawing.laser || !(drawing.tool === "pen" || drawing.tool === "marker")) return;
		drawing.holdAnchor = p;
		snapTimer = setTimeout(trySnapShape, 550);
	}
	function trySnapShape() {
		snapTimer = null;
		if (!drawing || drawing.snapped || !drawing.pts || drawing.pts.length < 8) return;
		const shape = fitShape(drawing.pts);
		if (!shape) return;
		drawing.snapped = shape;
		if (!clearLiveInk(drawing.pageIdx)) redrawPage(drawing.pageIdx);
		drawStroke(drawing.ctx, { tool: "shape", color: drawing.color, size: drawing.size, pts: [drawing.pts[0]], shape });
		if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {  } }
	}

	function fitShape(pts) {
		const a = pts[0], b = pts[pts.length - 1];
		const w = b[0] - a[0], h = b[1] - a[1], len = Math.hypot(w, h);
		let pathLen = 0;
		for (let i = 1; i < pts.length; i++) pathLen += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
		if (pathLen < 30) return null;
		let maxDev = 0;
		for (const p of pts) maxDev = Math.max(maxDev, Math.abs(h * (p[0] - a[0]) - w * (p[1] - a[1])) / Math.max(1, len));
		const closed = pts.length > 10 && Math.hypot(b[0] - a[0], b[1] - a[1]) < Math.max(18, pathLen * 0.2);
		if (closed) {
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			pts.forEach((p) => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); });
			const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = (maxX - minX) / 2, ry = (maxY - minY) / 2;
			if (rx < 10 || ry < 10) return null;
			let errRect = 0, errEllipse = 0;
			pts.forEach((p) => {
				const dxRect = Math.min(Math.abs(p[0] - minX), Math.abs(p[0] - maxX));
				const dyRect = Math.min(Math.abs(p[1] - minY), Math.abs(p[1] - maxY));
				errRect += Math.min(dxRect, dyRect);
				const nx = rx ? (p[0] - cx) / rx : 0, ny = ry ? (p[1] - cy) / ry : 0;
				errEllipse += Math.abs(Math.hypot(nx, ny) - 1) * Math.max(rx, ry);
			});
			if (errRect < errEllipse * 0.85) return { type: "rect", x1: minX, y1: minY, x2: maxX, y2: maxY };
			return { type: "ellipse", cx, cy, rx, ry };
		}
		if (maxDev < Math.max(10, len * 0.1)) return { type: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
		return null;
	}
	function onMove(e) {
		if (!drawing || rejected(e)) return;
		e.preventDefault();
		if (drawing.lasso) {
			drawing.pts.push(pos(e, drawing.cv));

			if (!clearLiveInk(drawing.pageIdx)) redrawPage(drawing.pageIdx);
			const x = drawing.ctx;
			x.save(); x.setLineDash([7, 4]); x.strokeStyle = "#2f6fed"; x.lineWidth = 1.7;
			x.beginPath(); x.moveTo(drawing.pts[0][0], drawing.pts[0][1]);
			for (let i = 1; i < drawing.pts.length; i++) x.lineTo(drawing.pts[i][0], drawing.pts[i][1]);
			x.stroke(); x.restore();
			return;
		}
		if (drawing.lassoMove) {

			const pm = pos(e, drawing.cv);
			const dx = pm[0] - drawing.last[0], dy = pm[1] - drawing.last[1];
			if (dx || dy) {
				drawing.strokes.forEach((s) => translateStroke(s, dx, dy));
				drawing.dx += dx; drawing.dy += dy; drawing.last = pm;
				redrawNextFrame(drawing.pageIdx); // PERF: pro Frame statt pro Pointer-Event
			}
			return;
		}
		if (drawing.lassoResize) {
			const p = pos(e, drawing.cv), [ax, ay] = drawing.anchor, [w, h] = drawing.base;
			const projected = ((p[0] - ax) * w + (p[1] - ay) * h) / (w * w + h * h);
			const maxFactor = Math.max(0.15, Math.min(6, (PAGE_W - ax) / w, (PAGE_H - ay) / h));
			const factor = Math.max(0.15, Math.min(maxFactor, projected));
			drawing.strokes.forEach((stroke, i) => scaleStrokeFrom(stroke, drawing.originals[i], ax, ay, factor));
			drawing.factor = factor;
			redrawNextFrame(drawing.pageIdx);
			return;
		}
		if (drawing.snapped) {

			const pSnap = pos(e, drawing.cv);
			drawing.pts.push(pSnap);
			if (drawing.snapped.type === "line") { drawing.snapped.x2 = pSnap[0]; drawing.snapped.y2 = pSnap[1]; }
			if (!clearLiveInk(drawing.pageIdx)) redrawPage(drawing.pageIdx);
			drawStroke(drawing.ctx, { tool: "shape", color: drawing.color, size: drawing.size, pts: [drawing.pts[0]], shape: drawing.snapped });
			return;
		}
		if (drawing.imgMove || drawing.imgResize) {
			const p = pos(e, drawing.cv);
			const dx = p[0] - drawing.start[0], dy = p[1] - drawing.start[1];
			const im = drawing.im, o = drawing.orig;
			if (drawing.imgMove) {
				im.x = Math.min(PAGE_W - 20, Math.max(20 - im.w, o.x + dx));
				im.y = Math.min(PAGE_H - 20, Math.max(20 - im.h, o.y + dy));
			} else if (drawing.isText) {
				im.w = Math.max(120, o.w + dx);
			} else {
				const w = Math.max(40, o.w + dx);
				im.w = w; im.h = w * (o.h / o.w);
			}
			drawing.moved = true;
			redrawPage(drawing.pageIdx);
			return;
		}
		if (drawing.erasing) { eraseAt(e); return; }

		let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
		if (!evs || !evs.length) evs = [e];
		for (const ce of evs) {
			drawing.pts.push(pos(ce, drawing.cv));
			const n = drawing.pts.length;

			const tail = drawing.tool === "marker" ? 2 : 3;
			drawStroke(drawing.ctx, { tool: drawing.tool, color: drawing.color, size: drawing.size, pts: drawing.pts.slice(Math.max(0, n - tail)) });
		}

		const lastP = drawing.pts[drawing.pts.length - 1];
		if (!drawing.holdAnchor || Math.hypot(lastP[0] - drawing.holdAnchor[0], lastP[1] - drawing.holdAnchor[1]) > 6) armHoldSnap(lastP);
	}
	function onUp(e) {
		if (e && e.pointerType === "pen") {
			activePenPointers.delete(e.pointerId);
			lastPenUpAt = Date.now();
			if (!activePenPointers.size) {

				applyTouchAction();
				setTimeout(applyTouchAction, PEN_GRACE_MS + 30);
			}
		}
		if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
		setWriting(false);
		hideEraserRing();
		if (!drawing) return;
		const pi = drawing.pageIdx;
		const pg = doc.pages[pi];
		if (!pg) { drawing = null; return; }
		if (drawing.lasso) {
			const poly = drawing.pts;

			const hits = poly.length >= 3 ? pg.strokes.filter((s) => strokeOutline(s).some((p) => pointInPolygon(p, poly))) : [];
			lassoSel = hits.length ? { pageIdx: pi, strokes: hits } : null;
			drawing = null; redrawPage(pi); updateChrome(); return;
		}
		if (drawing.lassoMove) {
			if (drawing.dx || drawing.dy) {
				pushUndo({ kind: "lassoMove", strokes: drawing.strokes, dx: drawing.dx, dy: drawing.dy, pageIdx: pi });
				scheduleSave(); renderThumb(pi);
			}
			drawing = null; redrawPage(pi); updateChrome(); return;
		}
		if (drawing.lassoResize) {
			if (Math.abs(drawing.factor - 1) > 0.001) {
				pushUndo({ kind: "lassoResize", strokes: drawing.strokes, prev: drawing.originals, pageIdx: pi });
				scheduleSave(); renderThumb(pi); scheduleHandwritingIndexV2(pi);
			}
			drawing = null; redrawPage(pi); updateChrome(); return;
		}
		if (drawing.laser) {
			const laserPage = pi;
			const timer = setTimeout(() => { laserTimers.delete(timer); redrawPage(laserPage); }, 900);
			laserTimers.add(timer); drawing = null; return;
		}
		if (drawing.imgMove || drawing.imgResize) {
			const { im, orig, moved } = drawing;
			if (moved && (im.x !== orig.x || im.y !== orig.y || im.w !== orig.w)) {
				pushUndo({ kind: "imgMod", im, pageIdx: pi, prev: orig });
				scheduleSave(); renderThumb(pi);
			}
			drawing = null;
			updateChrome();
			return;
		}
		if (drawing.erasing) {
			if (drawing.removed.length) {
				pushUndo({ kind: "erase", removed: drawing.removed, pageIdx: pi });
				scheduleSave();
				renderThumb(pi);
			}
		} else {

			// Jeder Strich bekommt eine stabile ID — sie ist der Schlüssel dafür, dass
			// zwei Geräte dieselben Striche als dieselben erkennen und nicht doppeln.
			const stroke = drawing.snapped
				? { id: U.uid(), tool: "shape", color: drawing.color, size: drawing.size, pts: [drawing.pts[0], drawing.pts[drawing.pts.length - 1]], shape: drawing.snapped }
				: { id: U.uid(), tool: drawing.tool, color: drawing.color, size: drawing.size, pts: drawing.pts };
			strokeBounds(stroke);
			pg.strokes.push(stroke);
			pushUndo({ kind: "add", stroke, pageIdx: pi });
			scheduleSave();

			commitStrokeRender(pi, stroke);
			renderThumb(pi);
			if (drawing.tool === "pen" || drawing.tool === "marker") scheduleHandwritingIndexV2(pi);
		}
		drawing = null;
		updateChrome();
	}

	function applyHistory(fromStack, toStack, isRedo) {
		const a = fromStack.pop(); if (!a || !doc) return;
		// Seite über ID auflösen (Index driftet); Seite weg = Eintrag tot, nicht raten.
		const pi = a.pageId ? doc.pages.findIndex((p) => p.id === a.pageId) : (a.pageIdx != null ? a.pageIdx : idx);
		const pg = pi >= 0 ? doc.pages[pi] : null; if (!pg) return;
		if (a.kind === "lassoMove") { const d = isRedo ? 1 : -1; a.strokes.forEach((s) => translateStroke(s, d * a.dx, d * a.dy)); }
		else if (a.kind === "lassoResize") {
			const current = a.strokes.map(strokeGeometry);
			a.strokes.forEach((stroke, i) => applyStrokeGeometry(stroke, a.prev[i]));
			a.prev = current;
		}
		else if (a.kind === "imgMod") { const cur = { x: a.im.x, y: a.im.y, w: a.im.w, h: a.im.h }; Object.assign(a.im, a.prev); a.prev = cur; }
		else if (a.kind === "txtEdit") { const cur = a.txt.text; a.txt.text = a.prev; a.prev = cur; }
		else {

			const spec = {
				add: ["strokes", [a.stroke], true], erase: ["strokes", a.removed, false],
				lassoDel: ["strokes", a.strokes, false],
				lassoDup: ["strokes", a.strokes, true],
				imgAdd: ["images", [a.img], true], imgDel: ["images", [a.img], false],
				txtAdd: ["texts", [a.txt], true], txtDel: ["texts", [a.txt], false],
			}[a.kind];
			if (!spec) return;
			const [key, items, addsOnRedo] = spec;
			// Abgleich über IDs statt Objekt-Identität: nach Sync-Import/Snapshot ist das
			// Dokument ein NEUES Objekt mit gleichen IDs -> includes() traf nie (Undo wirkungslos)
			// und push() legte Dubletten an.
			const arr = pg[key] || (pg[key] = []);
			const ids = new Set(items.map((o) => o.id));
			if (isRedo === addsOnRedo) {
				const have = new Set(arr.map((o) => o.id));
				items.forEach((o) => { if (!have.has(o.id)) arr.push(o); });
			} else {
				pg[key] = arr.filter((o) => !ids.has(o.id));
				if (sel && (ids.has(sel.imgId) || ids.has(sel.txtId))) sel = null;
				if (lassoSel && lassoSel.strokes.some((s) => ids.has(s.id))) lassoSel = null;
			}
		}
		toStack.push(a);
		refresh(pi);
	}
	function undo() { applyHistory(undoStack, redoStack, false); }
	function redo() { applyHistory(redoStack, undoStack, true); }

	function sizeLine(sz) {
		const h = sz[1] <= 2 ? 1.5 : sz[1] <= 4 ? 3 : 5;
		return '<button type="button" class="heft-size' + (size === sz[1] ? " active" : "") +
			'" data-hesize="' + sz[1] + '" title="Strich: ' + sz[0] + '">' +
			'<i style="height:' + h + 'px"></i></button>';
	}
	function trayStyle() {
		if (!trayPos) return "";
		return ' style="left:' + Math.round(trayPos.x) + 'px;top:' + Math.round(trayPos.y) + 'px;transform:none"';
	}

	let chromeMin = false;
	const icon = (p) => '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
	function toolbarHtml() {
		const writeOn = tool === "pen" || tool === "marker";
		const showWrite = expanded && writeOn;
		const showEraser = expanded && tool === "eraser";

		const svgPen = icon('<path d="M17 3.5a2.6 2.6 0 0 1 3.7 3.7L7.7 20.2 2.5 21.5l1.3-5.2z"/><path d="M14.5 6l3.5 3.5"/>');
		const svgMarker = icon('<path d="M14.5 5.5l4 4L9.5 18.5h-4v-4z"/><path d="M4 21.5h16"/>');
		const svgEraser = icon('<path d="M20 20H9l-4.3-4.3a2 2 0 0 1 0-2.8l8.6-8.6a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L13.5 18"/><path d="M8.5 9.5l6 6"/>');
		const svgLasso = icon('<ellipse cx="12" cy="9.5" rx="7.5" ry="5.5" stroke-dasharray="3.2 3"/><path d="M7.5 14.5c-2.2 1.8-.6 4.3 1.5 4.1 2-.2 1.2 2-.8 2.9"/>');
		const svgLaser = icon('<circle cx="12" cy="12" r="2.4"/><path d="M12 4.2v2.2M12 17.6v2.2M4.2 12h2.2M17.6 12h2.2M6.5 6.5l1.6 1.6M15.9 15.9l1.6 1.6M17.5 6.5l-1.6 1.6M8.1 15.9l-1.6 1.6"/>');
		const svgImage = icon('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17.5l5-5 3.5 3.5 2.5-2.5 4 4"/>');
		const svgUndo = icon('<path d="M8.5 5L4 9.5 8.5 14"/><path d="M4 9.5h10.5a5 5 0 0 1 0 10H11"/>');
		const svgRedo = icon('<path d="M15.5 5L20 9.5 15.5 14"/><path d="M20 9.5H9.5a5 5 0 0 0 0 10H13"/>');
		const svgHand = icon('<path d="M8.5 11.5V5.2a1.3 1.3 0 0 1 2.6 0V10m0-5.5a1.3 1.3 0 0 1 2.6 0V10m0-3.8a1.3 1.3 0 0 1 2.6 0v6.6c0 3.9-2.5 6.4-5.9 6.4-2.6 0-4.1-1.2-5.3-3.3l-2-3.6c-.5-.9-.2-1.9.7-2.3.8-.4 1.7-.1 2.2.7l1.5 2.3z"/>');
		const svgPages = icon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M4 15h16"/>');
		const svgPlus = icon('<path d="M12 5v14M5 12h14"/>');
		const svgSpark = icon('<path d="M12 3.5l1.9 4.9 4.9 1.9-4.9 1.9L12 17.1l-1.9-4.9-4.9-1.9 4.9-1.9z"/>');
		const svgChevDown = icon('<path d="M6 9.5l6 6 6-6"/>');
		const writeIcon = tool === "marker" ? svgMarker : svgPen;

		if (chromeMin) {
			return '<div class="heft-chrome heft-chrome-min" aria-hidden="false">' +
				'<div class="heft-float" role="toolbar" aria-label="Werkzeuge">' +
					'<div class="heft-pill heft-pill-min">' +
						'<button type="button" data-heexpand="1" class="heft-main" title="Werkzeugleiste ausklappen">' +
							writeIcon + '<span class="heft-color-dot" style="background:' + color + '"></span>' +
							'<span class="heft-chev">▾</span></button>' +
					'</div>' +
				'</div>' +
			'</div>';
		}

		let tray = "";
		if (showWrite) {
			tray =
				'<div class="heft-tray" data-hetray="1" role="group" aria-label="Schreib-Optionen"' + trayStyle() + '>' +
					'<button type="button" class="heft-tray-drag" data-hetraydrag="1" title="Optionen verschieben" aria-label="Optionen verschieben">⠿</button>' +
					'<button type="button" data-hetool="pen" class="heft-opt' + (tool === "pen" ? " active" : "") +
						'" title="Stift">' + svgPen + '</button>' +
					'<button type="button" data-hetool="marker" class="heft-opt' + (tool === "marker" ? " active" : "") +
						'" title="Marker">' + svgMarker + '</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					SIZES.map(sizeLine).join("") +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					COLORS.map((c) => '<button type="button" class="heft-swatch' + (color === c ? " active" : "") +
						'" data-hecolor="' + c + '" style="--sw:' + c + ';background:' + c + '" title="Farbe"></button>').join("") +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-heonlypen="1" class="heft-opt' + (onlyPen ? " active" : "") +
						'" title="' + (onlyPen ? "Nur Stift zeichnet" : "Finger dürfen zeichnen") + '">' +
						(onlyPen ? svgPen : svgHand) + '</button>' +
				'</div>';
		} else if (showEraser) {

			tray =
				'<div class="heft-tray" data-hetray="1" role="group" aria-label="Radierer-Optionen"' + trayStyle() + '>' +
					'<button type="button" class="heft-tray-drag" data-hetraydrag="1" title="Optionen verschieben" aria-label="Optionen verschieben">⠿</button>' +
					[["Klein", 10], ["Mittel", 16], ["Groß", 30]].map((z) => '<button type="button" class="heft-size' + (eraserSize === z[1] ? " active" : "") +
						'" data-heerasersize="' + z[1] + '" title="Radierer: ' + z[0] + '"><i style="height:' + Math.max(2, Math.round(z[1] / 5)) + 'px"></i></button>').join("") +
				'</div>';
		}

		return '<div class="heft-chrome" aria-hidden="false">' +
			'<button type="button" class="heft-corner heft-corner-l' + (pop && pop.dataset.kind === "pages" ? " active" : "") +
				'" data-hepagesmenu="1" title="Seiten">' + svgPages +
				'<span class="heft-pageno-inline"></span></button>' +
			'<div class="heft-float" role="toolbar" aria-label="Werkzeuge">' +
				'<div class="heft-pill">' +
					'<button type="button" data-hewrite="1" class="heft-main' + (writeOn ? " active" : "") +
						(showWrite ? " open" : "") + '" title="Schreiben">' +
						writeIcon + '<span class="heft-color-dot" style="background:' + color + '"></span><span class="heft-chev">▾</span></button>' +
					'<button type="button" data-hetool="eraser" class="heft-main' + (tool === "eraser" ? " active" : "") +
						(showEraser ? " open" : "") + '" title="Radierer">' + svgEraser + '</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-hetool="lasso" class="heft-main' + (tool === "lasso" ? " active" : "") +
						'" title="Lasso — Striche auswählen">' + svgLasso + '</button>' +

					'<button type="button" data-hetool="laser" class="heft-main heft-laser' + (tool === "laser" ? " active" : "") +
						'" title="Laserpointer — nicht speichern">' + svgLaser + '</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-heimgmenu="1" class="heft-main' +
						((pop && pop.dataset.kind === "img") || tool === "select" ? " active" : "") + '" title="Bilder einfügen oder bearbeiten">' + svgImage + '</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-heundo="1" class="heft-main" title="Rückgängig">' + svgUndo + '</button>' +
					'<button type="button" data-heredo="1" class="heft-main" title="Wiederholen">' + svgRedo + '</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-hecollapse="1" class="heft-main heft-min-btn" title="Leiste einklappen — mehr Platz zum Schreiben">' + svgChevDown + '</button>' +
				'</div>' +
			'</div>' +
			tray +
			'<div class="heft-corner-r">' +
				'<button type="button" class="heft-corner heft-chat" data-hechat="1" title="KI-Chat">' + svgSpark + '</button>' +
				'<button type="button" class="heft-corner heft-plus' + (pop && pop.dataset.kind === "plus" ? " active" : "") +
					'" data-heplusmenu="1" title="Seite hinzufügen">' + svgPlus + '</button>' +
			'</div>' +
		'</div>';
	}
	const pagesHtml = () => '<div class="heft-pages">' + doc.pages.map((_, i) =>
		'<div class="heft-page-slot" data-hepage="' + i + '">' +
			'<canvas class="heft-canvas"></canvas>' +
			'<span class="heft-page-label">Seite ' + (i + 1) + '</span>' +
		'</div>').join('') + addPageGhostHtml() + '</div>';
	const viewHtml = () => '<div class="heft-scroll">' + pagesHtml() + '</div>' + toolbarHtml();

	function onTrayPointerDown(e) {
		const grip = e.target.closest("[data-hetraydrag]");
		const tray = e.target.closest("[data-hetray]");
		if (!grip || !tray || !host) return;
		e.preventDefault(); e.stopPropagation();
		const r = tray.getBoundingClientRect(), hr = host.getBoundingClientRect();
		trayDrag = { tray, pid: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top };
		trayPos = { x: r.left - hr.left, y: r.top - hr.top };
		tray.style.left = Math.round(trayPos.x) + "px";
		tray.style.top = Math.round(trayPos.y) + "px";
		tray.style.transform = "none";
		tray.classList.add("is-dragging");
		try { grip.setPointerCapture(e.pointerId); } catch {  }
	}
	function onTrayPointerMove(e) {
		if (!trayDrag || !host || e.pointerId !== trayDrag.pid) return;
		e.preventDefault();
		const hr = host.getBoundingClientRect(), tr = trayDrag.tray.getBoundingClientRect();
		const x = Math.min(Math.max(8, e.clientX - hr.left - trayDrag.ox), Math.max(8, hr.width - tr.width - 8));
		const y = Math.min(Math.max(8, e.clientY - hr.top - trayDrag.oy), Math.max(8, hr.height - tr.height - 8));
		trayPos = { x, y };
		trayDrag.tray.style.left = Math.round(x) + "px";
		trayDrag.tray.style.top = Math.round(y) + "px";
	}
	function onTrayPointerUp(e) {
		if (!trayDrag || e.pointerId !== trayDrag.pid) return;
		try { e.target.releasePointerCapture(e.pointerId); } catch {  }
		trayDrag.tray.classList.remove("is-dragging");
		trayDrag = null;
	}

	function closePop() {
		document.removeEventListener("pointerdown", onDocPointerDown, true);
		if (pop) { pop.remove(); pop = null; }
		exportSel = null;
	}
	function onDocPointerDown(e) {
		if (!pop) return;
		if (pop.contains(e.target)) return;
		if (e.target.closest && e.target.closest("[data-hepagesmenu],[data-heplusmenu],[data-heimgmenu]")) return;
		closePop();
	}
	function openPop(anchor, html, kind, cls) {
		closePop();
		pop = document.createElement("div");
		pop.className = "heft-pop" + (cls ? " " + cls : "");
		pop.dataset.kind = kind;
		pop.innerHTML = html;
		host.appendChild(pop);

		const hr = host.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
		pop.style.top = Math.round(ar.bottom - hr.top + 6) + "px";
		let left = kind === "pages" ? Math.round((hr.width - pop.offsetWidth) / 2) : Math.round(ar.left - hr.left);
		if (left + pop.offsetWidth > hr.width - 8) left = Math.round(hr.width - pop.offsetWidth - 8);
		pop.style.left = Math.max(8, left) + "px";
		if (kind === "pages") wirePagesPop();
		setTimeout(() => document.addEventListener("pointerdown", onDocPointerDown, true), 0);
	}
	function togglePop(kind, anchor) {
		if (pop && pop.dataset.kind === kind) { closePop(); return; }
		if (kind === "pages") { openPop(anchor, pagesPopHtml(), "pages", "heft-pop-pages"); paintPopThumbs(); }
		else if (kind === "plus") openPop(anchor, plusPopHtml(), "plus", "heft-pop-plus");
		else if (kind === "img") openPop(anchor, imgPopHtml(), "img", "heft-pop-img");
	}
	function pagesPopHtml() {
		const picking = !!exportSel;
		const n = picking ? exportSel.size : 0;
		const deletable = canDeletePages(doc.pages.length, n);
		return '<div class="heft-pages-manager-head"><div><b>Seiten</b><small>' + (picking ? n + ' ausgewählt · über Seiten wischen für Schnellauswahl' : 'Ziehen zum Sortieren · antippen zum Öffnen') + '</small></div>' +
			(picking ? '<button type="button" class="heft-pop-row compact" data-heselectall="1">' + (n === doc.pages.length ? 'Auswahl aufheben' : 'Alle auswählen') + '</button>' : '<button type="button" class="heft-pop-row compact" data-heexpstart="1">Auswählen</button>') + '</div>' +
			'<div class="heft-pop-grid">' + doc.pages.map((_, i) =>
				'<div class="heft-pop-thumb' + ((picking ? exportSel.has(i) : i === idx) ? ' active' : '') + '" data-hethumb="' + i + '" role="option" aria-selected="' + (picking && exportSel.has(i) ? 'true' : 'false') + '" tabindex="0" draggable="' + (!picking) + '" title="Seite ' + (i + 1) + '">' +
					'<canvas width="132" height="187"></canvas>' +
					'<span>' + (i + 1) + (picking && exportSel.has(i) ? ' ✓' : '') + '</span>' +
					(!picking ? '<button type="button" class="heft-page-drag" data-hepagedrag="' + i + '" aria-label="Seite verschieben" title="Ziehen zum Verschieben">⠿</button>' : '<i class="heft-page-check">✓</i>') +
				'</div>').join('') + '</div>' +
			'<div class="heft-pages-manager-actions">' + (picking
				? '<button type="button" class="danger" data-hepagesdelete="1"' + (deletable ? '' : ' disabled') + '>🗑 Löschen (' + n + ')</button>' +
					'<button type="button" data-heexpcancel="1">Fertig</button><button type="button" class="primary" data-heexportopen="1"' + (n ? '' : ' disabled') + '>Exportieren (' + n + ')</button>'
				: '<button type="button" data-heverlauf="1">🕘 Verlauf</button><button type="button" class="primary" data-heimport="1">＋ PDF oder Bilder importieren</button>') + '</div>';
	}

	function paintPopThumbs() {
		if (doc) doc.pages.forEach((_, i) => renderThumb(i));
	}
	function refreshPagesPop() {
		if (!pop || pop.dataset.kind !== "pages" || !doc) return;
		pop.innerHTML = pagesPopHtml();
		paintPopThumbs();
		wirePagesPop();
	}
	function paintPageSelection(i, on) {
		if (!exportSel || !pop) return;
		on ? exportSel.add(i) : exportSel.delete(i);
		const thumb = pop.querySelector('[data-hethumb="' + i + '"]');
		if (thumb) {
			thumb.classList.toggle("active", on);
			thumb.setAttribute("aria-selected", on ? "true" : "false");
			const label = thumb.querySelector(":scope > span"); if (label) label.textContent = (i + 1) + (on ? " ✓" : "");
		}
		const n = exportSel.size, total = doc.pages.length;
		const sub = pop.querySelector(".heft-pages-manager-head small"); if (sub) sub.textContent = n + " ausgewählt · über Seiten wischen für Schnellauswahl";
		const del = pop.querySelector("[data-hepagesdelete]"); if (del) { del.disabled = !canDeletePages(total, n); del.textContent = "🗑 Löschen (" + n + ")"; }
		const exp = pop.querySelector("[data-heexportopen]"); if (exp) { exp.disabled = !n; exp.textContent = "Exportieren (" + n + ")"; }
		const all = pop.querySelector("[data-heselectall]"); if (all) all.textContent = n === total ? "Auswahl aufheben" : "Alle auswählen";
	}
	function movePageAt(from, to) {
		if (!doc) return;
		const currentId = page() && page().id;
		if (!movePage(doc.pages, from, to)) return;
		idx = Math.max(0, doc.pages.findIndex((pg) => pg.id === currentId));
		sel = null; lassoSel = null; undoStack = []; redoStack = [];
		scheduleSave(); rebuildScroll(); refreshPagesPop();
	}
	function wirePagesPop() {
		if (!pop || pop.dataset.kind !== "pages") return;
		const grid = pop.querySelector(".heft-pop-grid"); if (!grid) return;
		if (exportSel) {
			grid.classList.add("is-selecting");
			grid.addEventListener("pointerdown", (e) => {
				const thumb = e.target.closest("[data-hethumb]"); if (!thumb) return;
				e.preventDefault(); const i = Number(thumb.dataset.hethumb);
				pageSelectGesture = { id: e.pointerId, on: !exportSel.has(i), seen: new Set() };
				try { grid.setPointerCapture(e.pointerId); } catch {  }
				pageSelectGesture.seen.add(i); paintPageSelection(i, pageSelectGesture.on);
			});
			grid.addEventListener("pointermove", (e) => {
				if (!pageSelectGesture || e.pointerId !== pageSelectGesture.id) return;
				e.preventDefault(); const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-hethumb]");
				if (hit && grid.contains(hit)) { const i = Number(hit.dataset.hethumb); if (!pageSelectGesture.seen.has(i)) { pageSelectGesture.seen.add(i); paintPageSelection(i, pageSelectGesture.on); } }
				const r = grid.getBoundingClientRect(); if (e.clientY < r.top + 28) grid.scrollTop -= 18; else if (e.clientY > r.bottom - 28) grid.scrollTop += 18;
			});
			const end = (e) => { if (!pageSelectGesture || e.pointerId !== pageSelectGesture.id) return; pageSelectGesture = null; suppressPageClickUntil = Date.now() + 450; };
			grid.addEventListener("pointerup", end); grid.addEventListener("pointercancel", end);
			return;
		}
		grid.addEventListener("dragstart", (e) => { const t = e.target.closest("[data-hethumb]"); if (!t) return; pageDragFrom = Number(t.dataset.hethumb); t.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
		grid.addEventListener("dragover", (e) => { const t = e.target.closest("[data-hethumb]"); if (!t || pageDragFrom < 0) return; e.preventDefault(); grid.querySelectorAll(".drag-target").forEach((x) => x.classList.remove("drag-target")); t.classList.add("drag-target"); });
		grid.addEventListener("drop", (e) => { const t = e.target.closest("[data-hethumb]"); if (!t || pageDragFrom < 0) return; e.preventDefault(); const from = pageDragFrom, to = Number(t.dataset.hethumb); pageDragFrom = -1; suppressPageClickUntil = Date.now() + 450; movePageAt(from, to); });
		grid.addEventListener("dragend", () => { pageDragFrom = -1; grid.querySelectorAll(".dragging,.drag-target").forEach((x) => x.classList.remove("dragging", "drag-target")); });
		grid.querySelectorAll("[data-hepagedrag]").forEach((handle) => {
			handle.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); pageDragFrom = Number(handle.dataset.hepagedrag); try { handle.setPointerCapture(e.pointerId); } catch {  } });
			handle.addEventListener("pointermove", (e) => { if (pageDragFrom < 0) return; const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-hethumb]"); grid.querySelectorAll(".drag-target").forEach((x) => x.classList.remove("drag-target")); if (hit && grid.contains(hit)) hit.classList.add("drag-target"); });
		handle.addEventListener("pointerup", (e) => { if (pageDragFrom < 0) return; const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-hethumb]"); const from = pageDragFrom; pageDragFrom = -1; grid.querySelectorAll(".drag-target").forEach((x) => x.classList.remove("drag-target")); suppressPageClickUntil = Date.now() + 450; if (hit && grid.contains(hit)) movePageAt(from, Number(hit.dataset.hethumb)); });
		handle.addEventListener("pointercancel", () => { pageDragFrom = -1; grid.querySelectorAll(".drag-target").forEach((x) => x.classList.remove("drag-target")); });
		});
	}
	function imgPopHtml() {
		return '<div class="heft-pop-head">Bilder</div>' +
			'<button type="button" class="heft-pop-row" data-hetool="select">⬚ Bilder & Texte auswählen & bearbeiten</button>' +
			'<div class="heft-pop-sep"></div>' +
			'<button type="button" class="heft-pop-row" data-hetextadd="1">✍️ Text schreiben</button>' +
			'<button type="button" class="heft-pop-row" data-heimgadd="1">🖼 Bild hinzufügen</button>' +
			'<button type="button" class="heft-pop-row" data-heimgcam="1">📷 Bild aufnehmen</button>' +
			'<div class="heft-pop-sub">Ausgewähltes lässt sich verschieben, skalieren oder löschen. Doppeltipp auf eine Text-Box bearbeitet den Text.</div>';
	}
	function plusPopHtml() {
		const seg = (k, lbl) => '<button type="button" class="heft-seg' + (insertPos === k ? ' active' : '') + '" data-hepos="' + k + '">' + lbl + '</button>';
		const curPaper = page() ? page().paper : "lined";
		const tpl = (p, lbl, sub) =>
			'<button type="button" class="heft-tpl" data-headdtpl="' + p + '">' +
				'<i class="heft-tpl-paper heft-tpl-' + p + '"></i><span>' + lbl + '</span>' + (sub ? '<small>' + sub + '</small>' : '') +
			'</button>';
		return '<div class="heft-pop-head">Seite hinzufügen</div>' +
			'<div class="heft-seg-row">' + seg("before", "Vor dieser") + seg("after", "Nach dieser") + seg("last", "Letzte Seite") + '</div>' +
			'<div class="heft-pop-head">Neue Vorlagen</div>' +
			'<div class="heft-pop-sub">Die hier gezeigten Vorlagen übernehmen wenn möglich die Eigenschaften der aktuellen Seite.</div>' +
			'<div class="heft-tpl-row">' +
				tpl(curPaper, "Aktuelle Vorlage", "A4") +
				PAPERS.filter((p) => p[0] !== curPaper).map((p) => tpl(p[0], p[2], "")).join("") +
			'</div>' +
			'<div class="heft-pop-head">Vorlage dieser Seite ändern</div>' +
			'<div class="heft-tpl-row">' +
				PAPERS.map((p) => '<button type="button" class="heft-tpl' + (p[0] === curPaper ? ' active' : '') + '" data-hesetpaper="' + p[0] + '">' +
					'<i class="heft-tpl-paper heft-tpl-' + p[0] + '"></i><span>' + p[2] + '</span></button>').join("") +
			'</div>' +
			'<div class="heft-pop-sep"></div>' +
			'<button type="button" class="heft-pop-row" data-headdimg="1">🖼 Bild</button>' +
			'<button type="button" class="heft-pop-row" data-heimport="1">⬳ Importieren</button>' +
			'<button type="button" class="heft-pop-row" data-hescan="1">📷 Dateien scannen</button>';
	}

	function openTextEditor(pi, px, py, txt) {
		closeTextEditor(true);
		const slot = host && host.querySelectorAll(".heft-page-slot")[pi];
		const cvEl = slot && slot.querySelector("canvas");
		const pg = doc && doc.pages[pi];
		if (!cvEl || !pg) return;
		const k = cvEl.getBoundingClientRect().width / PAGE_W;
		const fs = txt && txt.size ? txt.size : 30;
		const w = txt ? txt.w : Math.max(240, Math.min(420, PAGE_W - px - 40));
		const ta = document.createElement("textarea");
		ta.className = "heft-text-editor";
		ta.value = txt ? txt.text : "";
		ta.style.left = ((txt ? txt.x : px) * k + cvEl.offsetLeft) + "px";
		ta.style.top = ((txt ? txt.y : py) * k + cvEl.offsetTop) + "px";
		ta.style.width = Math.max(80, w * k) + "px";
		ta.style.font = "500 " + (fs * k) + "px ui-rounded, 'Segoe Print', sans-serif";
		ta.style.lineHeight = String(TEXT_LH);
		ta.style.color = txt ? (txt.color || "#1c1c1e") : color;
		slot.appendChild(ta);
		inlineEd = { ta, pi, txt, x: px, y: py };
		if (txt) { txt.hidden = true; redrawPage(pi); }
		const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
		fit();
		ta.addEventListener("input", fit);
		ta.addEventListener("pointerdown", (ev) => ev.stopPropagation());
		ta.addEventListener("keydown", (ev) => {
			ev.stopPropagation();
			if (ev.key === "Escape") { ev.preventDefault(); closeTextEditor(false); }
			else if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); closeTextEditor(true); }
		});
		ta.addEventListener("blur", () => closeTextEditor(true));
		setTimeout(() => ta.focus(), 40);
	}
	function closeTextEditor(commit) {
		if (!inlineEd) return;
		const { ta, pi, txt, x: px, y: py } = inlineEd;
		inlineEd = null;
		const val = String(ta.value || "");
		ta.remove();
		const pg = doc && doc.pages[pi];
		if (txt) delete txt.hidden;
		if (!pg) return;
		const body = val.replace(/\s+$/, "");
		if (commit && txt && body.trim() && body !== txt.text) {
			pushUndo({ kind: "txtEdit", txt, prev: txt.text, pageIdx: pi });
			txt.text = body; scheduleSave();
		} else if (commit && txt && !body.trim()) {
			pg.texts = textsOf(pg).filter((t2) => t2 !== txt);
			pushUndo({ kind: "txtDel", txt, pageIdx: pi });
			if (sel && sel.txtId === txt.id) sel = null;
			scheduleSave();
		} else if (commit && !txt && body.trim()) {
			const t = { id: U.uid(), text: body, x: px, y: py, w: Math.max(240, Math.min(420, PAGE_W - px - 40)), h: 60, size: 30, color };
			textsOf(pg).push(t);
			pushUndo({ kind: "txtAdd", txt: t, pageIdx: pi });
			sel = { pageIdx: pi, txtId: t.id, tapAt: 0 };
			scheduleSave();
		}
		redrawPage(pi); renderThumb(pi); updateChrome();
	}
	// FIX (25. Juli, "Werkzeugleiste springt manchmal in Heften"):
	// Zwei Angaben in der Leiste ändern sich ständig — der Seitenzähler (bei JEDEM
	// Scrollen) und die Aktiv/Inaktiv-Zustände von Rückgängig/Wiederholen (bei JEDEM
	// Strich). Solange beide im gerenderten HTML standen, war lastChromeHtml praktisch
	// immer verschieden und die komplette Leiste wurde durch einen NEUEN DOM-Knoten
	// ersetzt. Folge: die frei verschiebbare Optionen-Palette sprang an ihre
	// Ausgangsposition zurück, ein offenes Menü verlor seinen Anker und die Leiste
	// flackerte kurz. Beide Angaben werden deshalb nicht mehr gerendert, sondern
	// direkt am lebenden Knoten nachgezogen — die Leiste bleibt dieselbe.
	function syncVolatileChrome() {
		if (!host || !doc) return;
		const no = host.querySelector(".heft-pageno-inline");
		if (no) {
			const label = (idx + 1) + "/" + doc.pages.length;
			if (no.textContent !== label) no.textContent = label;
		}
		const u = host.querySelector("[data-heundo]");
		if (u) u.disabled = !undoStack.length;
		const r = host.querySelector("[data-heredo]");
		if (r) r.disabled = !redoStack.length;
	}
	// Die Seiten-Vorschau nur neu aufbauen, wenn sich wirklich etwas an ihr ändert —
	// sonst wurden bei jedem Strich alle Miniaturen neu gezeichnet (Flackern).
	let lastPopSig = "";
	function refreshPagesPopIfNeeded() {
		if (!pop || pop.dataset.kind !== "pages" || !doc) { lastPopSig = ""; return; }
		const sigNow = doc.pages.length + "|" + idx + "|" + (exportSel ? [...exportSel].sort((a, b) => a - b).join(",") : "-");
		if (sigNow === lastPopSig) return;
		lastPopSig = sigNow;
		refreshPagesPop();
	}
	let lastChromeHtml = "";
	function updateChrome() {
		if (!host || !doc) return;
		const html = toolbarHtml();
		const chrome = host.querySelector(".heft-chrome");
		if (chrome && html === lastChromeHtml) { syncVolatileChrome(); updateLassoBar(); refreshPagesPopIfNeeded(); return; }
		lastChromeHtml = html;
		// 26. Juli: Leiste ANGLEICHEN statt austauschen (U.morph). Das Ersetzen war die
		// Ursache für das schlagartige Verschwinden: die neuen Knoten mussten ihren
		// backdrop-filter (Unschärfe) erst neu aufbauen und die Einblend-Animation der
		// Options-Leiste startete bei JEDER Kleinigkeit (Farbe, Werkzeug, Position) von
		// vorn — dazwischen war für einen Frame nichts zu sehen.
		if (chrome) {
			const t = document.createElement("div"); t.innerHTML = html;
			const fresh = t.firstElementChild;
			if (fresh) {
				if (chrome.className !== fresh.className) { chrome.className = fresh.className; applyWriting(); }
				U.morph(chrome, fresh.innerHTML);
			}
		}
		else host.insertAdjacentHTML("beforeend", html);
		bindTrayDrag();
		syncVolatileChrome();
		updateLassoBar();
		refreshPagesPopIfNeeded();
	}

	function updateLassoBar() {
		if (!host) return;
		let bar = host.querySelector(".heft-lasso-bar");
		if (!lassoSel || !lassoSel.strokes.length) { if (bar) bar.remove(); return; }
		if (!bar) { bar = document.createElement("div"); bar.className = "heft-lasso-bar"; host.appendChild(bar); }
		const n = lassoSel.strokes.length;
		bar.innerHTML = "<span>🪢 " + n + (n === 1 ? " Strich" : " Striche") + " · ziehen verschiebt · blauer Punkt skaliert</span>" +
			'<button type="button" data-helassodup="1">⧉ Duplizieren</button>' +
			'<button type="button" data-helassodel="1">🗑 Löschen</button>' +
			'<button type="button" data-helassoclear="1">Aufheben</button>';
	}
	function duplicateLassoSelection() {
		if (!lassoSel || !doc) return;
		const pg = doc.pages[lassoSel.pageIdx];
		if (!pg) return;

		const copies = lassoSel.strokes.map((s) => {
			const c = JSON.parse(JSON.stringify(s));
			c.id = U.uid(); // Kopie ist ein eigener Strich, nicht derselbe an neuer Stelle
			translateStroke(c, 28, 28);
			return c;
		});
		pg.strokes.push(...copies);
		pushUndo({ kind: "lassoDup", strokes: copies, pageIdx: lassoSel.pageIdx });
		lassoSel = { pageIdx: lassoSel.pageIdx, strokes: copies };
		scheduleSave(); redrawPage(lassoSel.pageIdx); renderThumb(lassoSel.pageIdx); updateChrome();
	}
	function deleteLassoSelection() {
		if (!lassoSel || !doc) return;
		const pg = doc.pages[lassoSel.pageIdx];
		if (!pg) { lassoSel = null; updateChrome(); return; }
		const strokes = lassoSel.strokes.slice();
		pg.strokes = pg.strokes.filter((s) => !strokes.includes(s));
		pushUndo({ kind: "lassoDel", strokes, pageIdx: lassoSel.pageIdx });
		const lpi = lassoSel.pageIdx; lassoSel = null;
		refresh(lpi);
	}
	let boundTray = null;
	function bindTrayDrag() {
		const tray = host && host.querySelector("[data-hetray]");
		// Knoten-Identität statt Attribut prüfen: U.morph gleicht Attribute an das frische
		// HTML an und würde eine Markierung wie data-hebound wieder entfernen — die
		// Listener hängen dann mehrfach am selben Element.
		if (!tray || boundTray === tray) return;
		boundTray = tray;
		tray.dataset.hebound = "1";
		tray.addEventListener("pointerdown", onTrayPointerDown);
		tray.addEventListener("pointermove", onTrayPointerMove);
		tray.addEventListener("pointerup", onTrayPointerUp);
		tray.addEventListener("pointercancel", onTrayPointerUp);
	}

	// Seite in ein vorhandenes Canvas einpassen (Breite vorgegeben, Höhe folgt A4)
	function paintInto(cv, pg, pi) {
		const k = cv.width / PAGE_W;
		cv.height = Math.round(PAGE_H * k); // setzt die Höhe UND leert das Canvas
		const x = cv.getContext("2d");
		x.setTransform(k, 0, 0, k, 0, 0);
		renderPageTo(x, pg, pi);
	}
	function renderThumb(i) {
		if (!pop || pop.dataset.kind !== "pages" || !doc || !doc.pages[i]) return;
		const cv = pop.querySelectorAll(".heft-pop-thumb canvas")[i];
		if (cv) paintInto(cv, doc.pages[i], i);
	}

	function insertIndex() {
		if (!doc) return 0;
		return insertPos === "before" ? idx : insertPos === "last" ? doc.pages.length : idx + 1;
	}
	function go(i) {
		if (!doc) return;
		idx = Math.max(0, Math.min(doc.pages.length - 1, i));

		drawing = null;
		const slot = host && host.querySelectorAll(".heft-page-slot")[idx];
		const vpGo = viewport();
		if (slot && vpGo) animateTo(view.x, slot.offsetTop + slot.offsetHeight / 2 - (vpGo.height / view.k) / 2, view.k, 320);
		updateChrome();
	}
	function addPageAt(paper, pageObj) {
		const at = insertIndex();
		doc.pages.splice(at, 0, pageObj || newPage(paper || (page() ? page().paper : "lined")));
		sel = null;
		scheduleSave(); rebuildScroll(); go(at);
	}
	function deletePageAt(i) {
		if (!doc || doc.pages.length <= 1 || !doc.pages[i]) return;
		const pg = doc.pages[i];
		const hasContent = (pg.strokes && pg.strokes.length) || (pg.images && pg.images.length) || (pg.texts && pg.texts.length);
		if (hasContent && !confirm("Diese Heftseite wirklich löschen?")) return;
		doc.pages.splice(i, 1);
		sel = null; lassoSel = null; undoStack = []; redoStack = [];
		scheduleSave(); rebuildScroll(); go(Math.min(i, doc.pages.length - 1));
	}
	async function deleteSelectedPages() {
		if (!doc || !exportSel || !canDeletePages(doc.pages.length, exportSel.size)) return;
		const chosen = [...exportSel].sort((a, b) => b - a);
		if (!confirm(chosen.length + (chosen.length === 1 ? " ausgewählte Seite" : " ausgewählte Seiten") + " wirklich löschen?")) return;
		try { await writeSnapshot(pid, encodeDoc(doc), doc.pages.length); } catch (e) { console.warn("Heft: Sicherung vor Löschen fehlgeschlagen", e); }
		const currentId = page() && page().id;
		chosen.forEach((i) => doc.pages.splice(i, 1));
		idx = doc.pages.findIndex((pg) => pg.id === currentId);
		if (idx < 0) idx = Math.min(chosen[chosen.length - 1] || 0, doc.pages.length - 1);
		exportSel = new Set(); sel = null; lassoSel = null; undoStack = []; redoStack = [];
		scheduleSave(); rebuildScroll(); refreshPagesPop(); go(idx);
		if (U.toast) U.toast(chosen.length + " Seite(n) gelöscht · über Verlauf wiederherstellbar", "success");
	}

	// EIN Datei-Dialog für Bilder, Import und Scanner (vorher 3x fast identisch)
	function filePick({ accept = "image/*", multiple = false, capture = false } = {}, cb) {
		const inp = Object.assign(document.createElement("input"), { type: "file", accept, multiple });
		if (capture) inp.setAttribute("capture", "environment"); // öffnet auf Tablets/Handys direkt die Kamera
		inp.onchange = () => { const files = Array.from(inp.files || []); if (files.length) cb(multiple ? files : files[0]); };
		inp.click();
	}
	const niceBytes = (bytes) => bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " MB";
	function transferOverlay(title, subtitle, body, actions) {
		const o = U.el("overlay");
		o.hidden = false;
		o.innerHTML = '<section class="heft-transfer" role="dialog" aria-modal="true"><header><div><h2>' + U.esc(title) + '</h2><p>' + U.esc(subtitle) + '</p></div><button type="button" id="btnCloseOverlay" aria-label="Schließen">×</button></header><div class="heft-transfer-body">' + body + '</div><footer>' + actions + '</footer></section>';
		return o;
	}
	function closeTransferOverlay() { const o = U.el("overlay"); if (o) o.hidden = true; }
	async function importFilesIntoHeft(targetId, files, position, onStatus) {
		const targetDoc = targetId === pid && doc ? doc : await load(targetId);
		if (!targetDoc) throw new Error("Ziel-Heft konnte nicht geöffnet werden.");
		const current = targetId === pid ? idx : Math.max(0, targetDoc.pages.length - 1);
		let at = insertAt(position, current, targetDoc.pages.length);
		for (const f of files) {
			if (onStatus) onStatus("Importiere " + f.name + " …");
			const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
			if (isPdf) at = await importPdf(f, at, targetDoc);
			else if (f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name)) {
				const im = await fileToImageData(f, 1600);
				targetDoc.pages.splice(at, 0, imagePage(im, "blank", false)); at++;
			}
		}
		await persistDoc(targetId, targetDoc);
		if (targetId === pid && doc === targetDoc) { rebuildScroll(); go(Math.max(0, at - 1)); }
		return at;
	}
	function openImportDialog(files, initialHeftId = pid) {
		files = Array.from(files || []).filter(Boolean);
		if (!files.length) return;
		const onlyPdfs = files.every((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
		const hefts = Object.values(S.pages).filter((pg) => pg && !pg.trashed && pg.kind === "heft");
		const destinations = (onlyPdfs ? '<option value="notes">Als neue Notiz-Seite(n)</option>' : "") + hefts.map((pg) => '<option value="heft:' + U.esc(pg.id) + '"' + (pg.id === initialHeftId ? ' selected' : '') + '>' + U.esc(pg.title || "Heft") + '</option>').join("");
		const rows = files.map((f) => '<div class="heft-transfer-file"><span>' + (f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "PDF" : "IMG") + '</span><div><b>' + U.esc(f.name) + '</b><small>' + niceBytes(f.size || 0) + '</small></div></div>').join("");
		const body = '<div class="heft-transfer-files">' + rows + '</div><div class="heft-transfer-field"><label for="heftImportTarget">Ort</label><select id="heftImportTarget">' + destinations + '</select></div>' +
			'<div class="heft-transfer-field" id="heftImportPositionWrap"><label for="heftImportPosition">Einfügen</label><select id="heftImportPosition"><option value="after">Nach der aktuellen Seite</option><option value="before">Vor der aktuellen Seite</option><option value="start">Am Anfang</option><option value="end">Am Ende</option></select></div>' +
			'<p class="heft-transfer-hint">PDF-Seiten werden als unveränderliche Heftseiten eingefügt. Als Notiz entsteht pro PDF eine eigene Seite mit durchsuchbarem Inhalt.</p>';
		const o = transferOverlay("In Impala67 importieren", files.length + (files.length === 1 ? " Datei" : " Dateien") + " ausgewählt", body, '<button type="button" data-hetransfercancel="1">Abbrechen</button><button type="button" class="primary" data-hetransferimport="1">Importieren</button>');
		const target = o.querySelector("#heftImportTarget"), positionWrap = o.querySelector("#heftImportPositionWrap");
		const syncTarget = () => { if (positionWrap) positionWrap.hidden = target.value === "notes"; };
		target.addEventListener("change", syncTarget); syncTarget();
		o.querySelector("[data-hetransfercancel]").addEventListener("click", closeTransferOverlay);
		o.querySelector("[data-hetransferimport]").addEventListener("click", async (e) => {
			const button = e.currentTarget, label = button.textContent; button.disabled = true; button.textContent = "Importiere …";
			try {
				if (target.value === "notes") {
					for (const file of files) await PDFS.ingest(file, (message) => { button.textContent = message; });
				} else {
					const targetId = target.value.replace(/^heft:/, "");
					await importFilesIntoHeft(targetId, files, o.querySelector("#heftImportPosition").value, (message) => { button.textContent = message; });
				}
				closeTransferOverlay(); if (U.toast) U.toast("Import abgeschlossen", "success");
			} catch (error) { button.disabled = false; button.textContent = label; if (U.toast) U.toast("Import fehlgeschlagen: " + ((error && error.message) || error), "error"); }
		});
	}
	const pickImage = (capture, cb) => filePick({ capture }, cb);
	function fileToImageData(f, maxDim, mime = "image/jpeg", quality = 0.86) {

		return new Promise((resolve, reject) => {
			const r = new FileReader();
			r.onerror = () => reject(new Error("Datei lesen fehlgeschlagen"));
			r.onload = () => {
				const img = new Image();
				img.onload = () => {
					let w = img.naturalWidth, h = img.naturalHeight;
					const k = Math.min(1, maxDim / Math.max(w, h));
					w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
					const c = document.createElement("canvas");
					c.width = w; c.height = h;
					const x = c.getContext("2d");
					x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
					x.drawImage(img, 0, 0, w, h);
					resolve({ src: mime === "image/png" ? c.toDataURL("image/png") : c.toDataURL(mime, quality), w, h });
				};
				img.onerror = () => reject(new Error("Bild dekodieren fehlgeschlagen"));
				img.src = r.result;
			};
			r.readAsDataURL(f);
		});
	}
	async function insertImageFile(f) {
		try {
			const pg = page(); if (!pg) return;
			const im = await fileToImageData(f, 1400);
			const k = Math.min((PAGE_W * 0.7) / im.w, (PAGE_H * 0.7) / im.h, 1);
			const img = { id: U.uid(), ref: blobRef(im.src), x: (PAGE_W - im.w * k) / 2, y: (PAGE_H - im.h * k) / 2, w: im.w * k, h: im.h * k };
			imagesOf(pg).push(img);
			pushUndo({ kind: "imgAdd", img, pageIdx: idx });
			sel = { pageIdx: idx, imgId: img.id };
			tool = "select";
			expanded = false;
			refresh(idx);
		} catch (e) {
			console.warn("Heft: Bild einfügen fehlgeschlagen", e);
			if (U.toast) U.toast("Bild konnte nicht eingefügt werden", "error");
		}
	}
	function imagePage(im, paper, bleed) {

		const pg = newPage(paper || "blank");
		const pad = bleed ? 0 : 40;
		const k = Math.min((PAGE_W - pad * 2) / im.w, (PAGE_H - pad * 2) / im.h);
		pg.images.push({ id: U.uid(), ref: blobRef(im.src), x: (PAGE_W - im.w * k) / 2, y: (PAGE_H - im.h * k) / 2, w: im.w * k, h: im.h * k });
		return pg;
	}
	async function addImagePageFromFile(f) {
		try {
			const im = await fileToImageData(f, 1600);
			addPageAt(null, imagePage(im, page() ? page().paper : "blank", false));
		} catch (e) { console.warn("Heft: Bild-Seite fehlgeschlagen", e); }
	}

	function importFiles() {
		filePick({ accept: "image/*,application/pdf", multiple: true }, (files) => openImportDialog(files, pid));
	}
	async function importPdf(f, at, targetDoc = doc) {
		try {
			await PDFS.ensureLoaded();
		} catch (e) {
			if (U.toast) U.toast("PDF-Engine konnte nicht geladen werden: " + ((e && e.message) || e), "error");
			return at;
		}
		const lib = window.pdfjsLib;
		if (!lib) return at;
		const buf = await f.arrayBuffer();
		const pdf = await lib.getDocument({ data: buf }).promise;
		for (let i = 1; i <= pdf.numPages; i++) {
			const p = await pdf.getPage(i);

			const vp = p.getViewport({ scale: 3 });
			const c = document.createElement("canvas");
			c.width = Math.round(vp.width); c.height = Math.round(vp.height);
			await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;

			targetDoc.pages.splice(at, 0, imagePage({ src: c.toDataURL("image/jpeg", 0.92), w: c.width, h: c.height }, "blank", true));
			at++;
		}
		return at;
	}

	const { SCAN_MODES, loadImg, quadArea, isConvex, detectQuad, processShot, lumStats } = SCANCORE;

	async function openScanner() {
		if (scanUI) return;
		const wrap = document.createElement("div");
		wrap.className = "heft-scan";
		wrap.innerHTML =
			'<div class="heft-scan-top"><b>Dateien scannen</b><button type="button" data-hescanclose="1" title="Schließen">✕</button></div>' +
			'<div class="heft-scan-stage"><video autoplay playsinline muted></video>' +
				'<svg class="heft-scan-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="7,7 93,7 93,93 7,93"></polygon></svg>' +
				'<div class="heft-scan-quality" data-hescanquality="1">Kamera wird geprüft…</div>' +
				'<div class="heft-scan-hint">Blatt vollständig ins Bild legen. Grün = bereit; der Rahmen zeigt exakt den späteren Zuschnitt.</div></div>' +
			'<div class="heft-scan-shots"></div>' +
			'<div class="heft-scan-bar">' +
				'<button type="button" class="heft-scan-shutter" data-hescanshot="1" title="Seite aufnehmen"></button>' +
				'<div class="heft-scan-actions">' +
					'<button type="button" data-hescanautocap="1" title="Auto-Scan aktivieren">⚡ Auto aus</button>' +
					'<button type="button" data-hescanpdf="1" disabled>📄 Als PDF speichern</button>' +
					'<button type="button" data-hescanheft="1" disabled>📓 In Heft einfügen</button>' +
				'</div>' +
			'</div>' +
			'<div class="heft-scan-busy" hidden><span>Scan wird aufbereitet…</span></div>';
		document.body.appendChild(wrap);
		scanUI = { wrap, stream: null, shots: [], edit: null, busy: false, liveTimer: 0, liveStable: 0, liveMissing: 0, liveHistory: [], autoCapture: false, autoArmed: false, autoCooldown: 0 };
		const ui = scanUI;
		wrap.addEventListener("click", onScanClick);
		try {
			if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("getUserMedia fehlt");

			let stream = null;
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
					audio: false,
				});
			} catch (cameraError) {

				const name = cameraError && cameraError.name;
				if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError" && name !== "NotFoundError") throw cameraError;
				stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
			}

			if (scanUI !== ui || !wrap.isConnected) { try { stream.getTracks().forEach((t) => t.stop()); } catch {  } return; }
			ui.stream = stream;
			const video = wrap.querySelector("video");
			video.srcObject = stream;
			video.muted = true;
			video.setAttribute("playsinline", "");

			try { await video.play(); } catch (e2) { console.warn("Heft: Video-play blockiert", e2); }
			startLiveQuality(video, ui);
			const track = stream.getVideoTracks && stream.getVideoTracks()[0];
			if (track) {

				try {
					const caps = track.getCapabilities ? track.getCapabilities() : null;
					const advanced = {};
					if (caps && Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) advanced.focusMode = "continuous";
					if (caps && Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) advanced.exposureMode = "continuous";
					if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] });
				} catch (constraintError) { console.info("Heft: Kamera-Automatik bleibt auf Gerätestandard", constraintError); }
				track.addEventListener("ended", () => showCameraStopped(ui), { once: true });
			}
			video.addEventListener("error", () => showCameraStopped(ui), { once: true });
		} catch (e) {

			console.warn("Heft: Kamera nicht verfügbar", e);
			if (scanUI === ui) {
				wrap.querySelector(".heft-scan-stage").innerHTML =
					'<div class="heft-scan-nocam"><p>Keine Kamera verfügbar oder Zugriff abgelehnt.</p>' +
					'<button type="button" data-hescanpick="1">Fotos auswählen…</button></div>';
				const shut = wrap.querySelector(".heft-scan-shutter");
				if (shut) shut.disabled = true;
			}
		}
	}
	function showCameraStopped(owner) {
		if (!owner || scanUI !== owner || !owner.wrap.isConnected) return;
		stopLiveQuality();
		try { if (owner.stream) owner.stream.getTracks().forEach((t) => t.stop()); } catch {  }
		owner.stream = null;
		const stage = owner.wrap.querySelector(".heft-scan-stage");
		if (stage) stage.innerHTML = '<div class="heft-scan-nocam"><p>Kameraverbindung wurde unterbrochen.</p><button type="button" data-hescanpick="1">Fotos auswählen…</button><small>Bereits aufgenommene Scans bleiben erhalten.</small></div>';
		const shut = owner.wrap.querySelector(".heft-scan-shutter");
		if (shut) shut.disabled = true;
		if (U.toast) U.toast("Kamera wurde beendet — du kannst Fotos auswählen.", "error");
	}
	function closeScanner() {
		if (!scanUI) return;
		stopLiveQuality();
		try { if (scanUI.stream) scanUI.stream.getTracks().forEach((t) => t.stop()); } catch {  }
		try { scanUI.wrap.remove(); } catch {  }
		scanUI = null;
	}

	function quadDelta(a, b) {
		if (!a || !b || a.length !== 4 || b.length !== 4) return Infinity;
		let sum = 0;
		for (let i = 0; i < 4; i++) sum += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
		return sum / 4;
	}
	function stabilizeLiveInfo(info, owner) {
		if (!info.found) { owner.liveHistory = []; return info; }
		const last = owner.liveHistory && owner.liveHistory[owner.liveHistory.length - 1];
		const jump = last ? quadDelta(info.quad, last.quad) : 0;

		if (jump > Math.max(info.sw, info.sh) * 0.14) owner.liveHistory = [];
		const entry = { quad: info.quad.map((p) => p.slice()), mean: info.mean, sharp: info.sharp, contrast: info.contrast };
		(owner.liveHistory || (owner.liveHistory = [])).push(entry);
		if (owner.liveHistory.length > 5) owner.liveHistory.shift();
		const hist = owner.liveHistory;
		const median = (values) => { const s = values.slice().sort((a, b) => a - b); return s[(s.length / 2) | 0]; };

		const quad = info.quad.map((_, i) => [median(hist.map((f) => f.quad[i][0])), median(hist.map((f) => f.quad[i][1]))]);
		let spread = 0;
		for (const frame of hist) spread = Math.max(spread, quadDelta(frame.quad, quad));
		return { ...info, quad, jitter: spread, stable: hist.length >= 3 && spread < Math.max(info.sw, info.sh) * 0.035 };
	}
	function liveQualityFrame(video) {
		const sw = 300, sh = Math.max(150, Math.round(video.videoHeight / Math.max(1, video.videoWidth) * sw));
		const c = document.createElement("canvas"); c.width = sw; c.height = sh;
		c.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, sw, sh);
		// Kennzahlen aus SCANCORE.lumStats — genau die Formel, mit der danach auch der
		// fertige Scan bewertet wird. Die Rechnung stand hier vorher ein zweites Mal.
		// step 2: jedes zweite Pixel reicht dem 340-ms-Takt der Live-Prüfung.
		const { mean, contrast, sharp } = lumStats(c, 2);
		const quad = detectQuad(c, sw, sh);
		const found = quadArea(quad) < sw * sh * 0.96;
		const area = quadArea(quad) / Math.max(1, sw * sh);
		const margin = found ? Math.min(...quad.map((p) => Math.min(p[0], p[1], sw - 1 - p[0], sh - 1 - p[1]))) : 0;
		return { quad, found, mean, contrast, sharp, area, margin, sw, sh };
	}
	function setLiveGuide(info, video) {
		if (!scanUI) return;
		const stage = scanUI.wrap.querySelector(".heft-scan-stage");
		const guide = scanUI.wrap.querySelector(".heft-scan-guide polygon");
		const label = scanUI.wrap.querySelector("[data-hescanquality]");
		if (!stage || !guide || !label || !video) return;

		const sr = stage.getBoundingClientRect(), vr = video.getBoundingClientRect();
		const left = (vr.left - sr.left) / Math.max(1, sr.width) * 100;
		const top = (vr.top - sr.top) / Math.max(1, sr.height) * 100;
		const width = vr.width / Math.max(1, sr.width) * 100;
		const height = vr.height / Math.max(1, sr.height) * 100;
		const toPct = (p) => (left + p[0] / info.sw * width).toFixed(1) + "," + (top + p[1] / info.sh * height).toFixed(1);
		guide.setAttribute("points", info.quad.map(toPct).join(" "));
		const lightOK = info.mean >= 62 && info.mean <= 235;
		const sharpOK = info.sharp >= 8;
		const contrastOK = info.contrast >= 16;
		const framingOK = info.area >= 0.12 && info.area <= 0.90 && info.margin >= 2;
		const ready = info.found && lightOK && sharpOK && contrastOK && framingOK;
		const stableReady = ready && info.stable;
		guide.parentElement.classList.toggle("ready", stableReady);
		guide.parentElement.classList.toggle("warn", !stableReady);
		if (stableReady) label.textContent = "✓ Dokument stabil erkannt · bereit";
		else if (!info.found) label.textContent = "Blatt vollständig ins Bild legen";
		else if (!framingOK) label.textContent = "Blattrand vollständig sichtbar halten";
		else if (!sharpOK) label.textContent = "Kamera ruhiger halten";
		else if (!lightOK) label.textContent = info.mean < 62 ? "Mehr Licht nötig" : "Zu hell / Spiegelung vermeiden";
		else if (!contrastOK) label.textContent = "Kontrast zu gering";
		else label.textContent = "Dokument wird stabilisiert…";
		return stableReady;
	}
	function startLiveQuality(video, owner) {
		if (!owner || scanUI !== owner) return;
		stopLiveQuality();
		const check = () => {
			if (scanUI !== owner || owner.busy || !video.videoWidth || !video.isConnected) return;
			try {
				const info = stabilizeLiveInfo(liveQualityFrame(video), owner);
				const ready = setLiveGuide(info, video);
				if (!ready) {
					owner.liveStable = 0;

					owner.liveMissing = info.found ? 0 : owner.liveMissing + 1;
					if (owner.liveMissing >= 3) owner.autoArmed = true;
					return;
				}
				owner.liveMissing = 0;
				owner.liveStable++;

				if (owner.autoCapture && owner.autoArmed && owner.liveStable >= 5 && Date.now() > owner.autoCooldown) {
					owner.autoArmed = false;
					owner.liveStable = 0;
					owner.autoCooldown = Date.now() + 1800;
					scanCapture(true);
				}
			} catch (e) { console.warn("Heft: Live-Scan-Prüfung fehlgeschlagen", e); }
		};
		check();
		owner.liveTimer = setInterval(check, 340);
	}
	function stopLiveQuality() {
		if (scanUI && scanUI.liveTimer) { clearInterval(scanUI.liveTimer); scanUI.liveTimer = 0; }
	}
	function setScanBusy(on, label) {
		if (!scanUI) return;
		scanUI.busy = !!on;
		const el = scanUI.wrap.querySelector(".heft-scan-busy");
		if (el) {
			el.hidden = !on;
			const sp = el.querySelector("span");
			if (sp && label) sp.textContent = label;
		}
		const shut = scanUI.wrap.querySelector(".heft-scan-shutter");
		if (shut) shut.disabled = !!on;
	}
	function onScanClick(e) {
		const b = e.target.closest("button");
		if (!b || !scanUI) return;
		const d = b.dataset;
		if (d.hescanclose) closeScanner();
		else if (d.hescanshot) scanCapture();
		else if (d.hescanpdf) { if (scanUI.shots.length) scanFinishPdf(); }
		else if (d.hescanheft) { if (scanUI.shots.length) scanFinishHeft(); }
		else if (d.hescanautocap) {
			scanUI.autoCapture = !scanUI.autoCapture;
			if (scanUI.autoCapture) { scanUI.autoArmed = true; scanUI.liveStable = 0; }
			else { scanUI.autoArmed = false; }
			b.classList.toggle("active", scanUI.autoCapture);
			b.textContent = scanUI.autoCapture ? "⚡ Auto an" : "⚡ Auto aus";
		}
		else if (d.hescanpick) scanPickFiles();
		else if (d.hescancompare) {
			const ed = scanUI.edit;
			if (ed) {
				ed.compare = !ed.compare;
				b.textContent = ed.compare ? "◐ Nur Scan" : "◑ Vorher/Nachher";
				const sh = scanUI.shots[ed.i];
				if (sh && sh.out) drawEditResult(sh);
			}
		}
		else if (d.hescancorners) {
			const ed = scanUI.edit;
			if (ed && ed.img) { ed.cornerMode = true; layoutEdit(); }
			else if (U.toast) U.toast("Rohbild wird geladen…");
		}
		else if (d.hescanedit != null) openEdit(Number(d.hescanedit));
		else if (d.hescaneditback) closeEdit();
		else if (d.hescanmode) {

			if (scanUI.edit) {
				scanUI.edit.mode = d.hescanmode;
				scanUI.edit.dirty = true;
				scanUI.edit.el.querySelectorAll("[data-hescanmode]").forEach((m) => m.classList.toggle("active", m.dataset.hescanmode === scanUI.edit.mode));
				liveReprocessEdit();
			}
		}
		else if (d.hescanrot) {
			if (scanUI.edit) {
				scanUI.edit.rot = (scanUI.edit.rot + 1) % 4;
				scanUI.edit.dirty = true;
				const rb = scanUI.edit.el.querySelector("[data-hescanrot]");
				if (rb) rb.textContent = "⟳ Drehen" + (scanUI.edit.rot ? " (" + (scanUI.edit.rot * 90) + "°)" : "");
				liveReprocessEdit();
			}
		}
		else if (d.hescandel) {
			if (scanUI.edit) { const i = scanUI.edit.i; closeEdit(); scanUI.shots.splice(i, 1); renderShots(); }
		}
		else if (d.hescandone) finishEdit();
	}
	async function scanCapture(isAuto = false) {
		const owner = scanUI;
		if (!owner || owner.busy) return;

		if (!isAuto) { owner.autoArmed = false; owner.liveStable = 0; owner.autoCooldown = Date.now() + 1800; }
		const video = owner.wrap.querySelector("video");
		if (!video) return;

		setScanBusy(true, "Kamera wird vorbereitet…");

		if (!video.videoWidth || !video.videoHeight) {
			try { await video.play(); } catch {  }
			if (scanUI !== owner) return;
			if (!video.videoWidth) {
				setScanBusy(false);
				if (U.toast) U.toast("Kamera startet noch — kurz warten und erneut tippen", "error");
				return;
			}
		}
		setScanBusy(true, "Aufnahme wird aufbereitet…");
		try {

			const cap = 2600, k = Math.min(1, cap / Math.max(video.videoWidth, video.videoHeight));
			const c = document.createElement("canvas");
			c.width = Math.max(2, Math.round(video.videoWidth * k)); c.height = Math.max(2, Math.round(video.videoHeight * k));
			const captureCtx = c.getContext("2d");
			captureCtx.imageSmoothingEnabled = true; captureCtx.imageSmoothingQuality = "high";
			captureCtx.drawImage(video, 0, 0, c.width, c.height);

			await addRawScan(c.toDataURL("image/png"), c.width, c.height, owner);
		} catch (e) {
			console.warn("Heft: Scan fehlgeschlagen", e);
			if (U.toast) U.toast("Scan fehlgeschlagen", "error");
		}
		if (scanUI === owner) setScanBusy(false);
	}

	async function addRawScan(src, w, h, owner) {
		const img = await loadImg(src);

		const iw = img.naturalWidth || w, ih = img.naturalHeight || h;

		const quad = detectQuad(img, iw, ih);
		const sh = { src, w: iw, h: ih, quad, autoCrop: quadArea(quad) < iw * ih * 0.96, mode: "color", rot: 0, out: null, img };
		await processShot(sh);
		if (scanUI !== owner || !sh.out) return;
		owner.shots.push(sh);
		renderShots();
	}
	function renderShots() {
		if (!scanUI) return;
		const strip = scanUI.wrap.querySelector(".heft-scan-shots");
		if (!strip) return;

		strip.innerHTML = scanUI.shots.map((sh, i) => {
			const src = (sh.out && sh.out.dataUrl) || sh.src;
			const quality = sh.out && sh.out.quality;
			const note = !sh.autoCrop ? "Vollbild" : (quality && quality.soft ? "Weich" : (quality && quality.tooDark ? "Dunkel" : (quality && quality.glare ? "Spiegelung" : (quality && quality.flat ? "Kontrast" : ""))));
			return '<button type="button" class="heft-scan-shot" data-hescanedit="' + i + '" title="Scan ' + (i + 1) + ' nachbearbeiten">' +
				'<img src="' + src + '" alt="Scan ' + (i + 1) + '"><span>' + (i + 1) + '</span>' +
				(note ? '<small>' + note + '</small>' : "") + '</button>';
		}).join("");
		strip.scrollLeft = strip.scrollWidth;
		const ready = scanUI.shots.filter((sh) => sh.out && sh.out.dataUrl);
		const n = ready.length;
		const pdfBtn = scanUI.wrap.querySelector("[data-hescanpdf]");
		const heftBtn = scanUI.wrap.querySelector("[data-hescanheft]");
		if (pdfBtn) { pdfBtn.disabled = !n; pdfBtn.textContent = "📄 Als PDF speichern" + (n ? " (" + n + ")" : ""); }
		if (heftBtn) { heftBtn.disabled = !n; heftBtn.textContent = "📓 In Heft einfügen" + (n ? " (" + n + ")" : ""); }
	}
	function scanPickFiles() {
		filePick({ multiple: true, capture: true }, async (files) => {
			const owner = scanUI;
			if (!owner) return;
			setScanBusy(true, "Fotos werden aufbereitet…");
			for (const f of files) {
				try {
					const im = await fileToImageData(f, 2400, "image/png");
					if (scanUI !== owner) return;
					await addRawScan(im.src, im.w, im.h, owner);
				} catch (e) {
					console.warn("Heft: Scan-Foto fehlgeschlagen", e);
					if (U.toast) U.toast("Foto konnte nicht gelesen werden", "error");
				}
			}
			if (scanUI === owner) setScanBusy(false);
		});
	}

	let liveSeq = 0, editCommitT = 0;

	function queueCornerReprocess() {
		clearTimeout(editCommitT);
		editCommitT = setTimeout(() => { editCommitT = 0; liveReprocessEdit(true); }, 160);
	}

	function syncShotWithEdit(sh, ed) {
		sh.quad = ed.quad.map((p) => p.slice());
		sh.mode = ed.mode;
		sh.rot = ed.rot;
		sh.autoCrop = quadArea(sh.quad) < sh.w * sh.h * 0.96;
		return { quad: sh.quad.map((p) => p.slice()), mode: sh.mode, rot: sh.rot, commit: false };
	}
	async function liveReprocessEdit(quiet = false) {
		const owner = scanUI;
		const ed = owner && owner.edit;
		if (!ed || !owner) return;
		const sh = owner.shots[ed.i];
		if (!sh) return;

		const snapshot = syncShotWithEdit(sh, ed);
		const seq = ++liveSeq;
		if (!quiet) setScanBusy(true, "Filter wird angewendet…");
		try {
			const out = await processShot(sh, snapshot);

			if (scanUI !== owner || seq !== liveSeq) return;
			sh.out = out;
			renderShots();
			if (owner.edit && owner.edit.el === ed.el) {
				ed.dirty = false;
				if (!ed.cornerMode && sh.out) drawEditResult(sh);
			}
		} catch (e) {
			console.warn("Heft: Live-Aufbereitung fehlgeschlagen", e);
			if (scanUI === owner && U.toast) U.toast("Scan-Aufbereitung fehlgeschlagen", "error");
		} finally {
			if (!quiet && scanUI === owner && seq === liveSeq) setScanBusy(false);
		}
	}

	function fitStageScale(el, contentW, contentH) {
		const stageW = el.clientWidth || window.innerWidth;
		const stageH = el.clientHeight || Math.max(180, window.innerHeight - 170);
		return Math.max(0.02, Math.min((stageW - 24) / contentW, (stageH - 24) / contentH));
	}

	function drawEditResult(sh) {
		const ed = scanUI && scanUI.edit;
		if (!ed || !sh.out) return;
		const stage = ed.el.querySelector(".heft-scan-editstage");
		const cv = ed.el.querySelector("canvas");
		if (!stage || !cv) return;
		const img = new Image();
		img.onload = () => {
			if (!scanUI || !scanUI.edit || scanUI.edit.el !== ed.el) return;

			const k = fitStageScale(stage, img.naturalWidth, img.naturalHeight);
			cv.width = Math.max(1, Math.round(img.naturalWidth * k));
			cv.height = Math.max(1, Math.round(img.naturalHeight * k));
			const x = cv.getContext("2d");
			x.clearRect(0, 0, cv.width, cv.height);
			if (ed.compare && ed.img) {
				const half = cv.width / 2;

				x.drawImage(ed.img, 0, 0, half, cv.height);
				x.drawImage(img, half, 0, half, cv.height);
				x.fillStyle = "rgba(3,5,10,.7)";
				x.fillRect(0, 0, half, 21); x.fillRect(half, 0, half, 21);
				x.strokeStyle = "rgba(255,255,255,.8)"; x.lineWidth = 2;
				x.beginPath(); x.moveTo(half, 0); x.lineTo(half, cv.height); x.stroke();
				x.fillStyle = "#fff"; x.font = "600 11px -apple-system,sans-serif"; x.textAlign = "center";
				x.fillText("VORHER", half / 2, 14); x.fillText("AUFBEREITET", half + half / 2, 14);
			} else {
				x.drawImage(img, 0, 0, cv.width, cv.height);
			}
			x.fillStyle = "rgba(3,5,10,0.55)";
			x.fillRect(0, cv.height - 22, cv.width, 22);
			x.fillStyle = "rgba(255,255,255,0.88)";
			x.font = "11px -apple-system,sans-serif";
			x.textAlign = "center";
			x.fillText(ed.compare ? "Links Rohfoto · rechts entzerrter und aufbereiteter Scan" : "Aufbereitet · Ecken anpassen für manuellen Zuschnitt", cv.width / 2, cv.height - 7);
		};
		img.src = sh.out.dataUrl;
	}
	function openEdit(i) {
		const sh = scanUI.shots[i];
		if (!sh) return;
		closeEdit();
		const ed = document.createElement("div");
		ed.className = "heft-scan-edit";
		ed.innerHTML =
			'<div class="heft-scan-top"><b>Scan ' + (i + 1) + ' bearbeiten</b><button type="button" data-hescaneditback="1" title="Zurück">✕</button></div>' +
			'<div class="heft-scan-editstage"><canvas></canvas></div>' +
			'<div class="heft-scan-modes">' + SCAN_MODES.map((m) =>
				'<button type="button" data-hescanmode="' + m[0] + '" class="' + (sh.mode === m[0] ? "active" : "") + '">' + m[1] + '</button>').join("") + '</div>' +
			'<div class="heft-scan-editbar">' +
				'<button type="button" data-hescancompare="1">◑ Vorher/Nachher</button>' +
				'<button type="button" data-hescancorners="1">⌜ Ecken anpassen</button>' +
				'<button type="button" data-hescanrot="1">⟳ Drehen' + (sh.rot ? " (" + (sh.rot * 90) + "°)" : "") + '</button>' +
				'<button type="button" data-hescandel="1">🗑 Löschen</button>' +
				'<button type="button" class="heft-scan-apply" data-hescandone="1">✓ Fertig</button>' +
			'</div>';
		scanUI.wrap.appendChild(ed);

		scanUI.edit = { i, el: ed, quad: (sh.quad || []).map((p) => p.slice()), mode: sh.mode || "color", rot: sh.rot || 0, img: null, drag: -1, k: 1, cornerMode: false, compare: false, dirty: false };
		const cv = ed.querySelector("canvas");
		cv.addEventListener("pointerdown", onEditDown);
		cv.addEventListener("pointermove", onEditMove);
		cv.addEventListener("pointerup", onEditUp);
		cv.addEventListener("pointercancel", onEditUp);

		if (sh.out) drawEditResult(sh);
		const setRaw = (img) => {
			if (scanUI && scanUI.edit && scanUI.edit.el === ed) {
				scanUI.edit.img = img;
				if (!sh.out) layoutEdit();
			}
		};
		if (sh.img) setRaw(sh.img);
		else loadImg(sh.src).then((img) => { sh.img = img; setRaw(img); }).catch((e) => console.warn("Heft: Rohbild laden fehlgeschlagen", e));
	}
	function closeEdit() {
		clearTimeout(editCommitT); editCommitT = 0;
		if (scanUI && scanUI.edit) { scanUI.edit.el.remove(); scanUI.edit = null; }
	}
	function layoutEdit() {
		const ed = scanUI && scanUI.edit;
		if (!ed || !ed.img) return;
		const stage = ed.el.querySelector(".heft-scan-editstage");
		const cv = ed.el.querySelector("canvas");
		const sh = scanUI.shots[ed.i];
		ed.k = fitStageScale(stage, sh.w, sh.h);
		cv.width = Math.max(1, Math.round(sh.w * ed.k));
		cv.height = Math.max(1, Math.round(sh.h * ed.k));
		drawEdit();
	}
	function drawEdit() {
		const ed = scanUI && scanUI.edit;
		if (!ed || !ed.img) return;
		const cv = ed.el.querySelector("canvas");
		const x = cv.getContext("2d");
		const k = ed.k, q = ed.quad;
		x.clearRect(0, 0, cv.width, cv.height);
		x.drawImage(ed.img, 0, 0, cv.width, cv.height);

		x.save();
		x.fillStyle = "rgba(3,5,10,0.55)";
		x.beginPath();
		x.rect(0, 0, cv.width, cv.height);
		x.moveTo(q[0][0] * k, q[0][1] * k);
		for (let i = 3; i >= 1; i--) x.lineTo(q[i][0] * k, q[i][1] * k);
		x.closePath();
		x.fill("evenodd");
		x.restore();

		x.strokeStyle = "#6fc3ff"; x.lineWidth = 2;
		x.beginPath();
		x.moveTo(q[0][0] * k, q[0][1] * k);
		for (let i = 1; i < 4; i++) x.lineTo(q[i][0] * k, q[i][1] * k);
		x.closePath();
		x.stroke();
		q.forEach((p) => {
			x.beginPath(); x.arc(p[0] * k, p[1] * k, 10, 0, Math.PI * 2);
			x.fillStyle = "rgba(111,195,255,0.25)"; x.fill();
			x.beginPath(); x.arc(p[0] * k, p[1] * k, 5, 0, Math.PI * 2);
			x.fillStyle = "#6fc3ff"; x.fill();
		});
	}
	function editPos(e, cv) {
		const r = cv.getBoundingClientRect();

		const sx = cv.width / Math.max(1, r.width);
		const sy = cv.height / Math.max(1, r.height);
		const k = (scanUI.edit && scanUI.edit.k) || 1;
		return [((e.clientX - r.left) * sx) / k, ((e.clientY - r.top) * sy) / k];
	}
	function onEditDown(e) {
		const ed = scanUI && scanUI.edit;
		if (!ed || !ed.img) return;

		if (!ed.cornerMode) {
			ed.cornerMode = true;
			layoutEdit();
			return;
		}
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		const p = editPos(e, e.currentTarget);
		const rr = 34 / ed.k;
		let best = -1, bd = rr * rr;
		ed.quad.forEach((q, i) => {
			const dx = q[0] - p[0], dy = q[1] - p[1];
			if (dx * dx + dy * dy <= bd) { bd = dx * dx + dy * dy; best = i; }
		});
		ed.drag = best;
	}
	function onEditMove(e) {
		const ed = scanUI && scanUI.edit;
		if (!ed || ed.drag < 0) return;
		e.preventDefault();
		const sh = scanUI.shots[ed.i];
		const p = editPos(e, e.currentTarget);
		ed.quad[ed.drag] = [Math.min(sh.w, Math.max(0, p[0])), Math.min(sh.h, Math.max(0, p[1]))];
		drawEdit();
	}
	function onEditUp() {
		const ed = scanUI && scanUI.edit;
		if (!ed) return;
		const was = ed.drag;
		ed.drag = -1;
		if (was < 0) return;
		const sh = scanUI.shots[ed.i];

		if (!sh || quadArea(ed.quad) < sh.w * sh.h * 0.015 || !isConvex(ed.quad)) {
			ed.quad = sh && sh.quad ? sh.quad.map((p) => p.slice()) : ed.quad;
			drawEdit();
			if (U.toast) U.toast("Ecken dürfen sich nicht kreuzen und müssen ausreichend Abstand haben.", "error");
			return;
		}

		ed.dirty = true;
		queueCornerReprocess();
	}
	async function finishEdit() {

		const owner = scanUI;
		const ed = owner && owner.edit;
		if (!ed || !owner) return;
		const sh = owner.shots[ed.i];
		if (sh) {
			const snapshot = syncShotWithEdit(sh, ed);

			clearTimeout(editCommitT); editCommitT = 0;
			if (!sh.out || ed.dirty) {

				const seq = ++liveSeq;
				setScanBusy(true, "Scan wird aufbereitet…");
				try {
					const out = await processShot(sh, snapshot);
					if (scanUI === owner && seq === liveSeq) { sh.out = out; ed.dirty = false; }
				} catch (e2) { console.warn("Heft: Scan aufbereiten fehlgeschlagen", e2); }
				if (scanUI === owner) setScanBusy(false);
			}
		}
		if (scanUI !== owner) return;
		closeEdit();
		renderShots();
	}

	function buildPdf(shots) {
		const tenc = new TextEncoder();
		const parts = [];
		const offsets = [];
		let len = 0;
		const push = (u8) => { parts.push(u8); len += u8.length; };
		const pushStr = (s) => push(tenc.encode(s));
		const A4W = "595.28", A4H = "841.89";
		pushStr("%PDF-1.4\n");
		const n = shots.length;
		const pageObj = (i) => 3 + i * 3, imgObj = (i) => 4 + i * 3, cntObj = (i) => 5 + i * 3;
		const obj = (num, body) => { offsets[num] = len; pushStr(num + " 0 obj\n" + body + "\nendobj\n"); };
		obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
		obj(2, "<< /Type /Pages /Kids [" + shots.map((_, i) => pageObj(i) + " 0 R").join(" ") + "] /Count " + n + " >>");
		shots.forEach((sh, i) => {
			const k = Math.min(595.28 / sh.w, 841.89 / sh.h);
			const w = sh.w * k, h = sh.h * k, ox = (595.28 - w) / 2, oy = (841.89 - h) / 2;
			obj(pageObj(i), "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + A4W + " " + A4H + "] " +
				"/Resources << /XObject << /Im" + i + " " + imgObj(i) + " 0 R >> >> /Contents " + cntObj(i) + " 0 R >>");
			const jpg = dataUrlBytes(sh.dataUrl);
			offsets[imgObj(i)] = len;
			pushStr(imgObj(i) + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + sh.w + " /Height " + sh.h +
				" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpg.length + " >>\nstream\n");
			push(jpg);
			pushStr("\nendstream\nendobj\n");
			const cs = "q " + w.toFixed(2) + " 0 0 " + h.toFixed(2) + " " + ox.toFixed(2) + " " + oy.toFixed(2) + " cm /Im" + i + " Do Q";
			obj(cntObj(i), "<< /Length " + cs.length + " >>\nstream\n" + cs + "\nendstream");
		});
		const xrefAt = len;
		const count = 3 + n * 3;
		let xref = "xref\n0 " + count + "\n0000000000 65535 f \n";
		for (let i = 1; i < count; i++) xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
		pushStr(xref + "trailer\n<< /Size " + count + " /Root 1 0 R >>\nstartxref\n" + xrefAt + "\n%%EOF");
		const out = new Uint8Array(len);
		let o = 0;
		parts.forEach((p) => { out.set(p, o); o += p.length; });
		return out;
	}
	function dataUrlBytes(du) {
		const bin = atob(du.slice(du.indexOf(",") + 1));
		const u = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
		return u;
	}

	// ---- Heft-Export (Seiten-Menü + Teilen-Menü): Seiten als PDF oder PNG ----
	// DRY: nutzt renderPageCanvas fürs Zeichnen und buildPdf aus dem Scanner.
	async function loadDocFor(pageId) {
		const d = pageId === pid && doc ? doc : await load(pageId);
		if (!d) return null;
		// Bilder vorab dekodieren, sonst fehlen sie auf frisch geladenen Canvases
		const jobs = [];
		d.pages.forEach((pg) => (pg.images || []).forEach((im) => { const el = imgEl(im); if (el.decode) jobs.push(el.decode().catch(() => {})); }));
		await Promise.all(jobs);
		return d;
	}
	const exportName = (pageId) => (String((S.pages[pageId] && S.pages[pageId].title) || "Heft").replace(/[\\/:*?"<>|#]/g, "_").trim().slice(0, 80) || "Heft");
	const exportIdxs = (d, indices) => (indices && indices.length ? indices : d.pages.map((_, i) => i));
	// FIX unscharfe Exporte: vorher 1600px Breite (~190 dpi auf A4) — jetzt 300 dpi.
	const EXPORT_W = 2480;
	const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
	async function pdfBlob(pageId, indices, onStatus) {
		const d = await loadDocFor(pageId);
		if (!d) return null;
		const idxs = exportIdxs(d, indices);
		const shots = [];
		for (let n = 0; n < idxs.length; n++) {
			const i = idxs[n]; if (onStatus) onStatus("Erzeuge Seite " + (n + 1) + " von " + idxs.length + " …");
			const c = renderPageCanvas(d.pages[i], EXPORT_W);
			shots.push({ dataUrl: c.toDataURL("image/jpeg", 0.95), w: c.width, h: c.height });
			await nextFrame(); // 300-dpi-Seiten sind teuer — UI zwischen den Seiten atmen lassen
		}
		return new Blob([buildPdf(shots)], { type: "application/pdf" });
	}
	async function exportPdf(pageId, indices) {
		const blob = await pdfBlob(pageId, indices);
		if (!blob) return;
		U.downloadBlob(exportName(pageId) + ".pdf", blob);
		const d = await loadDocFor(pageId), idxs = d ? exportIdxs(d, indices) : [];
		if (U.toast) U.toast("PDF mit " + idxs.length + " Seite(n) gespeichert");
	}
	async function imageFiles(pageId, indices, baseName, onStatus) {
		const d = await loadDocFor(pageId);
		if (!d) return [];
		const idxs = exportIdxs(d, indices);
		const files = [];
		for (let n = 0; n < idxs.length; n++) {
			const i = idxs[n];
			if (onStatus) onStatus("Erzeuge Bild " + (n + 1) + " von " + idxs.length + " …");
			const c = renderPageCanvas(d.pages[i], EXPORT_W);
			files.push(new File([dataUrlBytes(c.toDataURL("image/png"))], baseName + "-seite-" + (i + 1) + ".png", { type: "image/png" }));
			await nextFrame();
		}
		return files;
	}
	async function exportImages(pageId, indices) {
		const files = await imageFiles(pageId, indices, exportName(pageId));
		for (let n = 0; n < files.length; n++) { U.downloadBlob(files[n].name, files[n]); if (n < files.length - 1) await new Promise((r) => setTimeout(r, 350)); }
		const idxs = files;
		if (U.toast) U.toast(idxs.length + " Bild(er) gespeichert");
	}
	async function deliverExport(files) {
		let canShare = false;
		try { canShare = !!(navigator.share && navigator.canShare?.({ files })); } catch { /* Download-Fallback */ }
		if (canShare) {
			try { await navigator.share({ title: "Impala67 Heft", files }); return "shared"; }
			catch (error) { if (error && error.name === "AbortError") return "cancelled"; }
		}
		for (let i = 0; i < files.length; i++) { U.downloadBlob(files[i].name, files[i]); if (i < files.length - 1) await new Promise((r) => setTimeout(r, 350)); }
		return "saved";
	}
	function openExportDialog() {
		if (!pid || !exportSel || !exportSel.size) return;
		const pageId = pid, indices = [...exportSel].sort((a, b) => a - b), defaultName = exportName(pageId);
		closePop();
		const body = '<div class="heft-transfer-summary"><span>↗</span><div><small>Auswahl</small><b>' + indices.length + (indices.length === 1 ? ' Seite' : ' Seiten') + '</b><em>' + U.esc((S.pages[pageId] && S.pages[pageId].title) || "Heft") + '</em></div></div>' +
			'<div class="heft-transfer-field"><label for="heftExportName">Dateiname</label><input id="heftExportName" value="' + U.esc(defaultName) + '"></div><h3>Format</h3><div class="heft-transfer-formats">' +
			'<label><input type="radio" name="heftExportFormat" value="pdf" checked><span><b>PDF-Dokument</b><small>Alle ausgewählten Seiten in einer Datei</small></span><i>✓</i></label>' +
			'<label><input type="radio" name="heftExportFormat" value="images"><span><b>Einzelne Bilder</b><small>Eine PNG-Datei pro ausgewählter Seite</small></span><i>✓</i></label></div>';
		const o = transferOverlay("Heft exportieren", "Format prüfen und anschließend teilen", body, '<button type="button" data-hetransfercancel="1">Abbrechen</button><button type="button" class="primary" data-hetransferexport="1">Exportieren</button>');
		o.querySelector("[data-hetransfercancel]").addEventListener("click", closeTransferOverlay);
		o.querySelector("[data-hetransferexport]").addEventListener("click", async (e) => {
			const button = e.currentTarget, label = button.textContent, format = o.querySelector('input[name="heftExportFormat"]:checked').value;
			const name = (o.querySelector("#heftExportName").value || defaultName).replace(/[\\/:*?"<>|#]/g, "_").trim().slice(0, 80) || defaultName;
			button.disabled = true; button.textContent = "Wird erstellt …";
			try {
				let files;
				if (format === "pdf") { const blob = await pdfBlob(pageId, indices, (s) => { button.textContent = s; }); files = [new File([blob], name + ".pdf", { type: "application/pdf" })]; }
				else files = await imageFiles(pageId, indices, name, (s) => { button.textContent = s; });
				const result = await deliverExport(files); if (result !== "cancelled") { closeTransferOverlay(); if (U.toast) U.toast(result === "shared" ? "Export geteilt" : "Export gespeichert", "success"); }
				else { button.disabled = false; button.textContent = label; }
			} catch (error) { button.disabled = false; button.textContent = label; if (U.toast) U.toast("Export fehlgeschlagen: " + ((error && error.message) || error), "error"); }
		});
	}
	const readyScanOuts = () => scanUI.shots.map((sh) => sh.out).filter((o) => o && o.dataUrl && o.w && o.h);
	function scanFinishPdf() {
		try {
			const outs = readyScanOuts();
			if (!outs.length) { if (U.toast) U.toast("Keine fertigen Scans zum Export", "error"); return; }
			const bytes = buildPdf(outs);
			U.downloadBlob("scan-" + new Date().toISOString().slice(0, 10) + ".pdf", new Blob([bytes], { type: "application/pdf" }));
			if (U.toast) U.toast("PDF mit " + outs.length + " Seite(n) gespeichert");
		} catch (e) {
			console.warn("Heft: PDF erzeugen fehlgeschlagen", e);
			if (U.toast) U.toast("PDF konnte nicht erzeugt werden", "error");
		}
	}
	function scanFinishHeft() {
		const outs = readyScanOuts();
		closeScanner();
		if (!doc || !outs.length) {
			if (U.toast) U.toast("Keine fertigen Scans zum Einfügen", "error");
			return;
		}
		let at = insertIndex();
		outs.forEach((o) => { doc.pages.splice(at, 0, imagePage({ src: o.dataUrl, w: o.w, h: o.h }, "blank", true)); at++; });
		scheduleSave(); rebuildScroll(); go(at - 1);
		if (U.toast) U.toast(outs.length + " Scan(s) als Heftseiten eingefügt");
	}

	function onHostClick(e) {
		const b = e.target.closest("button, .heft-pop-thumb");
		if (!b || !doc) return;
		const d = b.dataset;
		if (d.helassodup) { duplicateLassoSelection(); return; }
		if (d.helassodel) { deleteLassoSelection(); return; }
		if (d.helassoclear) { const lpi = lassoSel && lassoSel.pageIdx; lassoSel = null; if (lpi != null) redrawPage(lpi); updateChrome(); return; }
		if (suppressEraserClick && d.hetool === "eraser") return;
		if (d.hepagesmenu) { togglePop("pages", b); return; }
		if (d.heplusmenu) { togglePop("plus", b); return; }
		if (d.heimgmenu) { togglePop("img", b); return; }
		if (d.heexpstart) { exportSel = new Set(); refreshPagesPop(); return; }
		if (d.heselectall) { const all = exportSel && exportSel.size === doc.pages.length; exportSel = new Set(all ? [] : doc.pages.map((_, i) => i)); refreshPagesPop(); return; }
		if (d.heexpcancel) { exportSel = null; refreshPagesPop(); return; }
		if (d.hepagesdelete) { deleteSelectedPages().catch((e2) => U.toast && U.toast("Seiten konnten nicht gelöscht werden: " + ((e2 && e2.message) || e2), "error")); return; }
		if (d.heexportopen) { openExportDialog(); return; }
		if (d.heverlauf) { openVerlaufPop(); return; }
		if (d.hepagesback) { if (pop) { pop.dataset.kind = "pages"; pop.innerHTML = pagesPopHtml(); paintPopThumbs(); } return; }
		if (d.heverrestore != null) {
			const s = pop && pop.__verSnaps && pop.__verSnaps[Number(d.heverrestore)];
			if (!s) return;
			if (!confirm("Diesen Stand wiederherstellen? Der aktuelle Stand wird vorher im Verlauf gesichert.")) return;
			closePop();
			restoreSnapshot(pid, s.key).catch((e2) => {
				console.warn("Heft: Wiederherstellen fehlgeschlagen", e2);
				if (U.toast) U.toast("Wiederherstellen fehlgeschlagen: " + ((e2 && e2.message) || e2), "error");
			});
			return;
		}
		if (d.hedelpage != null) { e.stopPropagation(); deletePageAt(Number(d.hedelpage)); return; }
		if (d.hepagedrag != null) return;
		if (d.hethumb != null) {
			const ti = Number(d.hethumb);
			if (Date.now() < suppressPageClickUntil) return;
			if (exportSel) { exportSel.has(ti) ? exportSel.delete(ti) : exportSel.add(ti); refreshPagesPop(); }
			else go(ti);
			return;
		}
		if (d.hepos) {
			insertPos = d.hepos;
			if (pop) pop.querySelectorAll(".heft-seg").forEach((s) => s.classList.toggle("active", s.dataset.hepos === insertPos));
			return;
		}
		if (d.headdtpl) { closePop(); addPageAt(d.headdtpl); return; }
		if (d.headdend) { addPageAtEnd(); return; }
		if (d.headdimg) { closePop(); pickImage(false, addImagePageFromFile); return; }
		if (d.heimport) { closePop(); importFiles(); return; }
		if (d.hescan) { closePop(); openScanner(); return; }
		if (d.hetextadd) { closePop(); tool = "select"; expanded = false; openTextEditor(idx, 80, Math.min(contentBottom(page()) + 30, PAGE_H - 160), null); return; }
		if (d.heimgadd) { closePop(); pickImage(false, insertImageFile); return; }
		if (d.heimgcam) { closePop(); pickImage(true, insertImageFile); return; }
		if (d.hewrite) {

			if (tool === "pen" || tool === "marker") expanded = !expanded;
			else { tool = "pen"; expanded = true; }
			if (sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
		}
		else if (d.hetool) {
			if (d.hetool === "eraser") {
				if (tool === "eraser") expanded = !expanded;
				else { tool = "eraser"; expanded = true; }
			} else if (d.hetool === "pen" || d.hetool === "marker") {

				tool = d.hetool; expanded = true;
			} else {

				tool = d.hetool; expanded = false;
				if (d.hetool === "select") closePop();
			}
			if (tool !== "lasso") lassoSel = null;
			if (tool !== "select" && sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
		}
		else if (d.hecolor) {
			color = d.hecolor;
			if (tool === "eraser" || tool === "select") { tool = "pen"; expanded = true; }
		}
		else if (d.hesize) size = parseFloat(d.hesize);
		else if (d.heerasersize) eraserSize = parseFloat(d.heerasersize);
		else if (d.heundo) { undo(); return; }
		else if (d.heredo) { redo(); return; }
		else if (d.hecollapse) { chromeMin = true; updateChrome(); return; }
		else if (d.heexpand) { chromeMin = false; updateChrome(); return; }
		else if (d.heonlypen) { onlyPen = !onlyPen; applyTouchAction(); }
		else if (d.hesetpaper) {
			const pg = page(); if (!pg) return;
			pg.paper = d.hesetpaper;
			closePop();
			redrawPage(idx); scheduleSave(); renderThumb(idx);
		}
		else if (d.hechat) {

			document.body.classList.remove("panel-collapsed");
			try { if (window.RENDER && window.RENDER.renderTabs) window.RENDER.renderTabs(); } catch {  }
			return;
		}
		else return;
		saveToolPrefs();
		updateChrome();
	}
	function onKey(e) {
		const t = e.target;
		if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

		if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z" || e.key === "y")) {
			e.preventDefault();
			if (e.key === "y" || e.shiftKey) redo(); else undo();
			return;
		}
		if (e.key === "Escape") {
			if (scanUI && scanUI.edit) { e.preventDefault(); closeEdit(); }
			else if (scanUI) { e.preventDefault(); closeScanner(); }
			else if (pop) { e.preventDefault(); closePop(); }
			return;
		}
		if ((e.key === "Delete" || e.key === "Backspace") && lassoSel && doc) {
			e.preventDefault();
			deleteLassoSelection();
			return;
		}
		if ((e.key === "Delete" || e.key === "Backspace") && sel && doc) {

			const pg = doc.pages[sel.pageIdx];
			const im = pg && sel.imgId ? imagesOf(pg).find((i2) => i2.id === sel.imgId) : null;
			const tx = pg && sel.txtId ? textsOf(pg).find((t2) => t2.id === sel.txtId) : null;
			if (im || tx) {
				e.preventDefault();
				// pushUndo statt direktem push: Limit greift, redoStack wird zentral geleert
				if (im) { pg.images = pg.images.filter((i2) => i2 !== im); pushUndo({ kind: "imgDel", img: im, pageIdx: sel.pageIdx }); }
				else { pg.texts = textsOf(pg).filter((t2) => t2 !== tx); pushUndo({ kind: "txtDel", txt: tx, pageIdx: sel.pageIdx }); }
				const spi = sel.pageIdx; sel = null;
				refresh(spi);
			}
			return;
		}
	}

	// Nach jeder Ansichtsaenderung: welche Seite ist gerade die aktuelle?
	function viewChanged() {
		if (!host || !doc) return;
		clearTimeout(scrollSettleTimer);
		scrollSettleTimer = setTimeout(() => {
			scrollSettleTimer = 0;
			if (!host || !doc) return;
			const vp = viewport(); if (!vp) return;
			const mid = view.y + (vp.height / view.k) / 2;
			let best = 0, bestD = Infinity;
			geometry.pages.forEach((page, i) => {
				if (!page) return;
				const d2 = Math.abs(page.top + page.height / 2 - mid);
				if (d2 < bestD) { bestD = d2; best = i; }
			});
			if (best !== idx) { idx = best; updateChrome(); }
		}, 80);
	}

	function onHostPointerDown(e) {
		const eraser = e.target.closest && e.target.closest('[data-hetool="eraser"]');
		if (!eraser || e.button > 0) return;
		clearTimeout(holdTimer);
		holdTimer = setTimeout(() => {
			holdTool = tool; tool = "eraser"; expanded = false; suppressEraserClick = true; updateChrome();
		}, 380);
	}
	function onHostPointerUp() {
		clearTimeout(holdTimer);
		if (!holdTool) return;
		tool = holdTool; holdTool = null; updateChrome();
		setTimeout(() => { suppressEraserClick = false; }, 0);
	}
	function bindCanvas() {

		canvases = host ? [...host.querySelectorAll(".heft-canvas")] : [];
		pageSlots = canvases.map((cv) => cv.closest(".heft-page-slot"));
		const scroll = scrollEl();

		detailCanvases = pageSlots.map((slot) => {
			if (!slot || !scroll) return null;
			const d = document.createElement("canvas");
			d.className = "heft-detail-canvas";
			Object.assign(d.style, { position: "absolute", pointerEvents: "none", zIndex: "2", display: "none" });
			scroll.appendChild(d);
			return d;
		});

		wetCanvases = pageSlots.map((slot) => {
			if (!slot || !scroll) return null;
			const d = document.createElement("canvas");
			d.className = "heft-wet-canvas";
			Object.assign(d.style, { position: "absolute", pointerEvents: "none", zIndex: "3", display: "none" });
			scroll.appendChild(d);
			return d;
		});
		canvases.forEach((cv) => {
			cv.addEventListener("pointerdown", onDown);
			cv.addEventListener("pointermove", onMove);
			cv.addEventListener("pointerup", onUp);
			cv.addEventListener("pointercancel", onUp);

			cv.addEventListener("pointerover", onPenBoundary);
			cv.addEventListener("pointerout", onPenBoundary);
		});

		applyTouchAction();
	}
	function bindScroll() {
		const scroll = host.querySelector(".heft-scroll");
		if (!scroll) return;
		scroll.addEventListener("wheel", onWheelZoom, { passive: false });
		scroll.addEventListener("touchstart", onTouchStart, { passive: false });
		scroll.addEventListener("touchmove", onTouchMove, { passive: false });
		scroll.addEventListener("touchend", onTouchEnd);
		scroll.addEventListener("touchcancel", onTouchCancel);
		scroll.style.touchAction = "none";
		scroll.style.overflow = "hidden";
	}

	const addPageGhostHtml = () => '<button type="button" class="heft-addpage" data-headdend="1">＋ Neue Seite</button>';
	let pull = null;
	function addPageAtEnd() {
		const prevPos = insertPos;
		insertPos = "last";
		addPageAt(doc && doc.pages.length ? doc.pages[doc.pages.length - 1].paper : "lined");
		insertPos = prevPos;
	}
	function bindPullToAdd() {
		const scroll = scrollEl();
		if (!scroll || scroll.dataset.hepull) return;
		scroll.dataset.hepull = "1";
		const atEnd = () => { const vp = viewport(); return !!vp && view.y + vp.height / view.k >= contentSize().h - 6; };
		scroll.addEventListener("touchstart", (ev) => { pull = { y0: ev.touches[0].clientY, startAtEnd: atEnd(), armed: false }; }, { passive: true });
		scroll.addEventListener("touchmove", (ev) => {
			if (!pull || !pull.startAtEnd) return;
			const dy = pull.y0 - ev.touches[0].clientY;
			const btn = scroll.querySelector(".heft-addpage");
			// Der Geist-Knopf stand vorher IMMER unter der letzten Seite. Jetzt holt erst das
			// Hochziehen ihn hervor (ab 12px), ab 70px löst Loslassen aus.
			if (btn) btn.classList.toggle("pulling", atEnd() && dy > 12);
			if (atEnd() && dy > 70) { pull.armed = true; if (btn) { btn.classList.add("armed"); btn.textContent = "⬆ Loslassen: neue Seite"; } }
			else if (pull.armed) { pull.armed = false; if (btn) { btn.classList.remove("armed"); btn.textContent = "＋ Neue Seite"; } }
		}, { passive: true });
		scroll.addEventListener("touchend", () => {
			const btn = scroll.querySelector(".heft-addpage");
			if (btn) { btn.classList.remove("pulling", "armed"); btn.textContent = "＋ Neue Seite"; }
			if (pull && pull.armed) addPageAtEnd();
			pull = null;
		});
	}
	function rebuildScroll() {
		if (!host || !doc) return;
		const scroll = host.querySelector(".heft-scroll");
		if (!scroll) return;
		// Die Ansicht haengt nur an view, nicht am DOM: merken, neu aufbauen,
		// zurueckschreiben. Kein Scroll-Anker und kein Nachziehen ueber Frames mehr.
		const keep = { x: view.x, y: view.y, k: view.k };
		scroll.innerHTML = pagesHtml();
		bindCanvas();
		view.x = keep.x; view.y = keep.y; view.k = keep.k;
		layout();
	}
	async function mount(container, pageId) {
		unmount();
		host = container;
		pid = pageId;
		if (getComputedStyle(host).position === "static") host.style.position = "relative";
		host.innerHTML = '<div class="heft-loading" role="status">Heft laden…</div>';
		doc = await load(pageId);
		if (pid !== pageId) return;
		idx = 0; sel = null; undoStack = []; redoStack = []; insertPos = "after";
		view.x = 0; view.y = 0; view.k = 1; navReset();
		expanded = false;

		trayPos = null; trayDrag = null;
		host.innerHTML = viewHtml();
		bindPullToAdd();
		host.addEventListener("click", onHostClick);
		host.addEventListener("pointerdown", onHostPointerDown);
		host.addEventListener("pointerup", onHostPointerUp);
		host.addEventListener("pointercancel", onHostPointerUp);
		document.addEventListener("keydown", onKey);
		resizeFn = () => layout();
		window.addEventListener("resize", resizeFn);

		if (window.ResizeObserver) {
			resizeObserver = new ResizeObserver(() => layout());
			resizeObserver.observe(host);
		}
		bindCanvas();
		bindScroll();
		bindTrayDrag();
		layout();

		scheduleHandwritingIndexV2(idx);
		purgeOrphanLegacyInk();
		pruneSnapshots(pageId).catch(() => {}); // abgelaufene Verlauf-Snapshots beim Öffnen wegräumen
	}
	function unmount(discardPending = false) {
		closePop();
		closeScanner();
		// Offener Text-Editor MUSS vor dem Flush zu: inlineEd überlebte unmount, das nächste
		// openTextEditor committete den alten Text ins dann geladene Heft.
		closeTextEditor(true);

		if (saveT) {
			if (discardPending) { clearTimeout(saveT); saveT = 0; }
			else saveNow();
		}
		if (host) {
			host.removeEventListener("click", onHostClick);
			host.removeEventListener("pointerdown", onHostPointerDown);
			host.removeEventListener("pointerup", onHostPointerUp);
			host.removeEventListener("pointercancel", onHostPointerUp);
			host.innerHTML = "";
		}
		document.removeEventListener("keydown", onKey);
		if (resizeFn) { window.removeEventListener("resize", resizeFn); resizeFn = null; }
		if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
		if (pid) dropThumbs(pid); // war eine wortgleiche Kopie von dropThumbs
		Object.keys(imgCache).forEach((k) => { imgCache[k].src = ""; delete imgCache[k]; });
		host = null; pid = null; doc = null; idx = 0; canvases = []; pageSlots = []; detailCanvases = []; wetCanvases = []; detailVisible = new Set();
		geometry = { viewport: null, content: { w: 1, h: 1 }, pages: [] };
		drawing = null; sel = null; lassoSel = null; undoStack = []; redoStack = [];
		laserTimers.forEach(clearTimeout); laserTimers.clear();
		clearTimeout(holdTimer); ocrQueueV2.clear(); clearTimeout(ocrTimerV2); ocrTimerV2 = 0; holdTool = null; suppressEraserClick = false;

		navReset(); activePenPointers.clear(); clearTimeout(wheelCommitT); clearTimeout(zoomSettleTimer); zoomSettleTimer = 0; clearTimeout(scrollSettleTimer); scrollSettleTimer = 0;
		if (eraseFrame) { cancelAnimationFrame(eraseFrame); eraseFrame = 0; }
		trayDrag = null; boundTray = null; // detached Knoten nicht festhalten
		clearTimeout(writingOffT); writingOffT = 0; writing = false;
		lastChromeHtml = ""; lastPopSig = "";
	}

	function renderPageCanvas(pg, w, pageIdx = -1) {
		const c = document.createElement("canvas");
		c.width = w;
		paintInto(c, pg, pageIdx);
		return c;
	}
	async function thumbnail(pageId, pageIndex, width) {
		const i = pageIndex || 0, w = width || 220;
		const key = pageId + ":" + i + ":" + w;
		if (thumbs[key]) return thumbs[key];

		if (thumbJobs[key]) return thumbJobs[key];
		const job = (async () => {
			const d = await load(pageId);
			const pg = d.pages[i];
			if (!pg) return null;
			const c = renderPageCanvas(pg, w);
			const url = c.toDataURL("image/png");
			thumbs[key] = url;
			// Speicher-Limit (FIFO): Thumbnails vieler Hefte (Embeds/Bibliothek) wuchsen
			// unbegrenzt — älteste Einträge fliegen raus und werden bei Bedarf neu gerendert.
			const keys = Object.keys(thumbs);
			for (let i = 0; i < keys.length - THUMB_MAX; i++) delete thumbs[keys[i]];
			return url;
		})();
		thumbJobs[key] = job;
		try { return await job; }
		finally { delete thumbJobs[key]; }
	}
	async function hydrateEmbeds(root) {
		const nodes = (root || document).querySelectorAll("[data-heftembed]");
		for (const el of nodes) {
			const id = el.dataset.heftembed;
			if (!id || el.dataset.heftdone) continue;
			el.dataset.heftdone = "1";
			try {
				const url = await thumbnail(id, 0, 320);
				el.innerHTML = (url ? '<img class="heft-embed-img" src="' + url + '" alt="Heft-Vorschau">' : "") +
					'<span class="heft-embed-label">📓 ' + U.esc((S.pages[id] && S.pages[id].title) || "Heft") + " · " + pagesOf(id) + " Seite(n)</span>";
			} catch (e) {
				delete el.dataset.heftdone;
				el.innerHTML = '<span class="heft-embed-label">📓 ' + U.esc((S.pages[id] && S.pages[id].title) || "Heft") + " öffnen</span>";
				console.warn("Heft: Embed-Vorschau fehlgeschlagen", e);
			}
		}
	}

	async function pageAsDataUrl(pageId, pageIdx, w = 1200) {
		if (!pageId) return null;
		const d = pageId === pid && doc ? doc : await load(pageId);
		const pg = d && d.pages && d.pages[pageIdx || 0];
		if (!pg) return null;
		return renderPageCanvas(pg, w).toDataURL("image/png");
	}

	return {
		mount, unmount, saveNow, addText, restoreDoc, hasHeft, pagesOf, thumbnail, hydrateEmbeds, renderBlobPreview, renderPageTo, pageRectForTile, pageAsDataUrl, strokeGeometry, scaleStrokeFrom, lassoTouchAction, pdfBlob, exportPdf, exportImages, openImportDialog,
		get activeId() { return pid; },
		get activeIndex() { return idx; },
	};
})();
