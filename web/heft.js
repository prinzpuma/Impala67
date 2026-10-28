"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { HANDSCHRIFT } from "./handschrift.js";
import { PDFS } from "./pdfs.js";
import { movePage, canDeletePages } from "./heft-pages-core.js";
import { documentShadow, diffDocument, applyOpsToShadow, emptyHeftPage, PAGE_W, PAGE_H } from "./heft-document-core.js";
import {
	KEY,
	INK_LEGACY,
	blobRef,
	persistReferencedBlobs,
	imgSrc,
	readLegacyDoc,
	purgeOrphanLegacyInk,
	pruneSnapshots,
	encodeDoc,
	writeSnapshot,
	maybeSnapshot,
	restoreSnapshot as runRestoreSnapshot
} from "./heft-storage.js";
import { hitBox, strokeBounds, translateStroke, strokeGeometry, applyStrokeGeometry, scaleStrokeFrom } from "./heft-geometry.js";
import {
	lassoBounds,
	lassoTouchAction,
	drawLassoSelection,
	updateLassoBarUI,
	duplicateLassoStrokes,
	deleteLassoStrokes,
	recognizeLassoText,
	trainLassoSample
} from "./heft-lasso.js";
import { loadToolPrefs, saveToolPrefs as persistToolPrefs } from "./heft-tools.js";
import { TRAY_DOCK_PX, trayCss, toolbarHtml as buildToolbarHtml, plusPopHtml as buildPlusPopHtml, imgPopHtml } from "./heft-toolbar-ui.js";
import { pagesGridHtml, pagesHistoryHtml, selectionSub, selectAllLabel } from "./heft-pages-ui.js";
import { exportName, pdfBlob as exportPdfBlob, imageFiles as exportImageFiles, exportPdf as runExportPdf, deliverExport, openExportDialog as renderExportDialog } from "./heft-export.js";
import {
	filePick,
	pickImage,
	transferOverlay,
	closeTransferOverlay,
	fileToImageData,
	imagePage as createImagePage,
	insertImageFile as runInsertImageFile,
	addImagePageFromFile as runAddImagePageFromFile,
	importPdf as runImportPdf,
	importFilesIntoHeft as runImportFilesIntoHeft,
	openImportDialog as renderImportDialog,
	importFiles as runImportFiles
} from "./heft-import.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { canGoBack, canGoForward } from "./nav-history.js";
import { lead } from "./icons.js";
import { BUS } from "./event-bus.js";
import { createHeftViewport } from "./heft-viewport.js";
import { createHeftInput } from "./heft-input.js";
import { PLATFORM } from "./platform.js";

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
// Seite hinzu, …), der Rust-Kern spielt sie ab und hält alle Hefte. Der Editor holt das
// geöffnete Heft als eigene Arbeitskopie, zeichnet darauf und schickt beim Speichern nur
// den Unterschied zum zuletzt veröffentlichten Stand als Operationsliste ab.
//
// Folge: keine Heft-Dateien in Drive, kein Müllsammler, keine Hash-Abgleiche, keine
// Konflikt-Kopien — und zwei Geräte, die gleichzeitig im selben Heft zeichnen,
// führen ihre Striche automatisch zusammen.
//
// Scanner: Oberfläche in heft-scanner-ui.js, Bildverarbeitung in heft-scan.js; Handschrift-OCR in handschrift.js.

export const HEFT = (() => {
	// Zuletzt angesehene Seite je Heft (Gerätewahl): Öffnen springt dorthin, die Startseite zeigt sie als Vorschau.
	const POS_KEY = "impala67HeftPos";
	const positions = () => { try { return JSON.parse(localStorage.getItem(POS_KEY)) || {}; } catch { return {}; } };
	const lastPage = (p) => positions()[p] || 0;
	function rememberPos() {
		if (!pid) return;
		const all = positions();
		if (all[pid] === idx) return;
		all[pid] = idx;
		try { localStorage.setItem(POS_KEY, JSON.stringify(all)); } catch { /* Speicher voll: Position ist verzichtbar */ }
	}

	const docs = {};
	const thumbs = {};
	const THUMB_MAX = 60; // Speicher-Limit: Data-URLs sammelten sich sonst unbegrenzt an
	const dropThumbs = (p) => Object.keys(thumbs).forEach((k) => { if (k.startsWith(p + ":")) delete thumbs[k]; });
	const thumbJobs = {};
	const imgCache = {};
	let host = null, pid = null, doc = null, idx = 0;
	let canvases = [];
	let detailCanvases = [];
	let wetCanvases = [];
	let pageSlots = [];

	const savedTools = loadToolPrefs();
	let tool = "pen", color = savedTools.color, size = savedTools.size, onlyPen = savedTools.onlyPen;
	let eraserSize = savedTools.eraserSize;
	// Lesemodus (Handy): Finger und Stift blättern und zoomen nur. Wann er gilt, entscheidet
	// die Handy-UI über setViewOnly(fn); abgefragt wird bei jeder Berührung neu.
	let viewOnlyFn = null;
	const isViewOnly = () => !!viewOnlyFn && !!pid && !!doc && viewOnlyFn(pid, doc);
	const pens = savedTools.pens;
	let penSlot = savedTools.penSlot;
	({ color, size } = pens[penSlot]);
	let inlineEd = null;
	// Textfeld, das gerade im Editor liegt: wird beim Zeichnen ausgelassen. Ansichtszustand
	// gehört nicht ins Dokument (vorher txt.hidden – das wurde mitgespeichert und synchronisiert).
	let editingTxtId = null;
	function saveToolPrefs() { persistToolPrefs({ color, size, onlyPen, eraserSize, pens, penSlot }); }
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
	// Zählt Ein-/Aushängen: Ein mount, dessen Laden überholt wurde (Heft öffnen, zurück, wieder
	// öffnen), bricht ab. Der Seiten-ID-Vergleich ließ beide Läufe weiterlaufen – Resize-Listener
	// und ResizeObserver des ersten blieben für immer hängen.
	let mountToken = 0;
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
	let insertPos = "after";
	let pop = null, popScrim = null, thumbIO = null;
	const thumbBitmaps = new Map(); // Seitenübersicht: verkleinerte Scans (siehe thumbBitmap)
	let exportSel = null; // Set<pageIndex> im Export-Auswahlmodus des Seiten-Menüs
	let pageSelectGesture = null, suppressPageClickUntil = 0, pageDragFrom = -1;


	const newPage = (paper) => emptyHeftPage(U.uid(), paper);

	// ---- Veröffentlichen: Unterschied zum letzten Stand als Operationsliste ----
	// published[pageId] ist bewusst KEINE Kopie des Dokuments, sondern ein
	// Schatten aus IDs und billigen Signaturen. Eine echte Kopie wäre bei Heften
	// mit eingebetteten Bildern teuer — zum Erkennen von "neu / geändert / weg"
	// reicht die Signatur völlig.
	// Der Schatten folgt dem LOG, nicht dem Dokument: Jedes heftOps-Event (eigenes wie
	// fremdes, egal ob per Cloudflare, Drive oder zweitem Tab) wird auf ihn angewandt.
	// Vorher wurde er nach jedem Fremd-Event aus dem Dokument neu berechnet — gerade
	// gezeichnete, noch nicht gespeicherte Striche galten dann als veröffentlicht und
	// landeten nie im Log (nach dem Neuladen waren sie weg).
	const published = {};
	// Events, die die Arbeitskopie selbst erzeugt hat (Speichern, Wiederherstellen, Anlegen): Die
	// Kopie hat sie schon, nur der Schatten rückt vor. Alles andere am geöffneten Heft (anderes
	// Gerät, zweiter Tab, Handschrift-Index, KI) ist fremd und wird in die Kopie übernommen.
	const EDITOR = "heft-editor";
	let foreignQueue = [];
	BUS.on("state:heft-changed", ({ pageId, event, origin }) => {
		if (!pageId || !event) return;
		if (origin === EDITOR) { if (published[pageId]) advanceShadow(pageId, event); return; }
		if (pageId !== pid) {
			// Nicht geöffnetes Heft: Kopie und Schatten verwerfen, der nächste load() holt den neuen Stand.
			delete docs[pageId]; delete published[pageId]; dropThumbs(pageId);
			return;
		}
		if (!published[pageId]) return;
		foreignQueue.push(event);
		scheduleAdopt();
	});
	function advanceShadow(pageId, event) {
		if (event.type === "heftOps") applyOpsToShadow(published[pageId], event.payload?.ops);
		else if (event.type === "heftSnap") { const shadow = STATE.heftShadow(pageId); if (shadow) published[pageId] = shadow; }
	}
	// Fremde Events übernehmen: Was hier noch nicht gespeichert ist (Unterschied Kopie ↔ Schatten
	// VOR den fremden Events), legt der Kern als Vorschau auf seinen neuen Stand – mit denselben
	// Regeln wie der Reducer. Fremde Striche gelten so nie als eigene Neuerung (kein Echo-Upload),
	// eigene, noch nicht gespeicherte bleiben Änderung für den nächsten Save. Während einer Geste
	// wartet die Übernahme, damit der laufende Strich nicht an einer verworfenen Kopie hängt.
	let adoptT = 0;
	function scheduleAdopt() {
		if (adoptT) return;
		adoptT = setTimeout(() => { adoptT = 0; adoptForeign(); }, 0);
	}
	function adoptForeign() {
		if (!foreignQueue.length) return;
		if (drawing) { adoptT = setTimeout(() => { adoptT = 0; adoptForeign(); }, 120); return; }
		const events = foreignQueue; foreignQueue = [];
		if (!pid || !doc || !published[pid]) return;
		PERF_PROFILER.measure("heft.remote-apply", () => {
			if (unsaved || saving) {
				const pending = diffDocument(published[pid], doc).ops;
				for (const event of events) if (event?.payload?.pageId === pid) advanceShadow(pid, event);
				const d = STATE.heftPreview(pid, pending);
				if (d) showDoc(d);
				return;
			}
			// Nichts Ungespeichertes: Die Kopie entspricht dem Log. Bleiben die Seiten dieselben, nur die
			// berührten Seiten neu holen (ein Strich vom anderen Gerät kostet dann eine Seite, nicht das Heft).
			for (const event of events) if (event?.payload?.pageId === pid) advanceShadow(pid, event);
			const ids = STATE.heftPageIds(pid);
			const sameLayout = !!ids && ids.length === doc.pages.length && ids.every((id, i) => id === doc.pages[i].id);
			if (sameLayout && events.every((event) => event?.type === "heftOps")) {
				const hit = new Set(events.flatMap((event) => (event.payload?.ops || []).map((op) => op?.p)).filter(Boolean));
				const pages = doc.pages.map((pg) => (hit.has(pg.id) ? STATE.heftPageById(pid, pg.id) || pg : pg));
				showDoc({ ...doc, pages }, hit);
				return;
			}
			const d = STATE.heftDoc(pid);
			if (d) showDoc(d);
		}, { events: events.length }, 16);
	}

	const page = () => (doc ? doc.pages[idx] : null);
	const imagesOf = (pg) => (pg.images || (pg.images = []));

	// Das Dokument kommt aus dem Kern: eine Arbeitskopie je geladenem Heft (docs[p]), samt Schatten
	// des Log-Stands (published[p]). Kopien anderer als des geöffneten Hefts verfallen beim nächsten
	// Heft-Event (siehe oben) bzw. beim Öffnen eines anderen Hefts.
	// create: false für reine Vorschauen (Export, Seitenbild für die KI). Nur wer das Heft öffnet oder
	// beschreibt, legt bei einem noch leeren Heft die erste Seite an.
	async function load(p, { create = true } = {}) {
		if (p === pid && doc) return doc;
		if (docs[p]) return docs[p];
		// Ein bekanntes Heft ohne Bilder braucht keine Bilddaten — nur ein noch unbekanntes lädt alle.
		const meta = STATE.heftMeta(p);
		const refs = meta ? STATE.heftImageRefs(p) : [];
		if (refs.length || !meta) {
			await PERF_PROFILER.run("heft.hydrate-images", () => STATE.hydrateHeftBlobs(refs.length ? refs : null), { images: refs.length }, 16);
		}
		let d = PERF_PROFILER.measure("heft.fetch", () => STATE.heftDoc(p), { pages: meta?.pages }, 16);
		if (!d || !d.pages.length) {
			const legacy = await readLegacyDoc(p);
			if (legacy) await STATE.dispatch("heftOps", { pageId: p, ops: diffDocument(null, legacy).ops }, { origin: EDITOR });
			// FIX: Eine Vorschau schrieb hier bisher selbst eine leere erste Seite ins Log. Kam ein
			// Heft per Sync an, bevor seine Seiten da waren (oder wurde es woanders gerade angelegt),
			// hatte es danach eine überzählige leere Seite VOR den echten — auf allen Geräten.
			else if (!create) return null;
			else await STATE.dispatch("heftOps", { pageId: p, ops: [{ t: "pg+", at: 0, page: { id: U.uid(), paper: "lined" } }] }, { origin: EDITOR });
			d = STATE.heftDoc(p);
			// Der Alt-Blob hat seine Schuldigkeit getan — der Inhalt steht jetzt im Log.
			if (legacy) DB.delBlob(KEY(p)).catch(() => {});
		}
		try { localStorage.removeItem(INK_LEGACY(p)); } catch {  }
		if (!d) return null;
		docs[p] = d;
		// Schatten des Log-Stands direkt im Kern (die frisch geholte Kopie ist genau dieser Stand).
		published[p] = PERF_PROFILER.measure("heft.shadow", () => STATE.heftShadow(p) || documentShadow(d), { pages: d?.pages?.length }, 16);
		return d;
	}

	// Neue Bilddaten (heftBlob) oder ein gelöschtes Heft: Ansicht nachziehen. Neue Striche kommen
	// über state:heft-changed und adoptForeign() in die Arbeitskopie.
	// Nur Heft-Events (und gelöschte Seiten) betreffen Hefte. Vorher zeichnete jede Fremd-
	// änderung – auch an einer getippten Notiz – das offene Heft neu und hob die Auswahl auf.
	function onRemoteApplied(types) {
		if (!types || !types.has("heftBlob")) return;
		for (const key of Object.keys(thumbs)) delete thumbs[key];
		if (pid && host && doc && !foreignQueue.length) showDoc(doc);
	}
	// Ein (neues) Dokument anzeigen: Auswahl und Lasso per ID auf die neuen Objekte umhängen,
	// sichtbare Seiten neu zeichnen. Undo-Einträge lösen ihre Seiten und Striche über IDs auf.
	// changed: IDs der neu geholten Seiten (sonst alle sichtbaren neu zeichnen).
	function showDoc(d, changed = null) {
		if (!d || !d.pages.length || !host) return;
		dropThumbs(pid);
		const structural = !doc || d.pages.length !== canvases.length || d.pages.some((pg, i) => pg.id !== doc.pages[i]?.id);
		doc = d; docs[pid] = d;
		idx = Math.max(0, Math.min(idx, d.pages.length - 1));
		// Auswahl nur aufheben, wenn ihr Bild/Textfeld weg ist (sie hält nur IDs).
		const selPage = sel && d.pages[sel.pageIdx];
		const selId = sel && (sel.imgId || sel.txtId);
		if (sel && !(selPage && [...(selPage.images || []), ...(selPage.texts || [])].some((o) => o.id === selId))) sel = null;
		relinkLasso(d);
		if (structural) rebuildScroll();
		else {
			// FIX (25. Juli, "Striche erscheinen erst nach dem Neuladen"): renderVisiblePages()
			// zeichnet eine Seite nur dann neu, wenn sich die CANVAS-GRÖSSE geändert hat. Nach einer
			// Übernahme bleibt die Größe gleich, der INHALT ist neu: alle sichtbaren Seiten neu zeichnen.
			renderVisiblePages(true);
			visiblePageIndices().filter((i) => !changed || changed.has(d.pages[i]?.id)).forEach(redrawPage);
		}
		updateChrome();
	}
	STATE.onRemoteApplied(onRemoteApplied);
	// Speichern und Sync legen geänderte Striche als KOPIEN ins Dokument (Events sind
	// unveränderlich). Auswahl und laufendes Ziehen hielten danach die alten Objekte:
	// das zweite Verschieben/Skalieren bewegte Striche, die gar nicht mehr auf der Seite
	// lagen. Darum hier per ID auf den aktuellen Stand umhängen.
	function relinkLasso(d) {
		const liveOf = (pi) => new Map((d.pages[pi]?.strokes || []).map((s) => [s.id, s]));
		if (lassoSel) {
			const live = liveOf(lassoSel.pageIdx);
			const strokes = lassoSel.strokes.map((s) => live.get(s.id)).filter(Boolean);
			lassoSel = strokes.length ? { pageIdx: lassoSel.pageIdx, strokes, bounds: lassoBounds(strokes) } : null;
		}
		if (drawing && (drawing.lassoMove || drawing.lassoResize)) {
			const live = liveOf(drawing.pageIdx);
			// Reihenfolge halten: originals[i] gehört zu strokes[i].
			drawing.strokes = drawing.strokes.map((s) => live.get(s.id) || s);
		}
	}
	// unsaved: die Arbeitskopie hat Änderungen, die noch nicht im Log stehen (jede Bearbeitung plant
	// ein Speichern ein); saving: ein Speichern läuft gerade. Beides entscheidet, wie Fremdänderungen
	// übernommen werden (adoptForeign).
	let unsaved = false, saving = false, editSeq = 0;
	function scheduleSave() { unsaved = true; editSeq++; clearTimeout(saveT); saveT = setTimeout(saveNow, 350); }
	const refresh = (i) => { scheduleSave(); redrawPage(i); renderThumb(i); updateChrome(); };

	// Speichern = Unterschied ermitteln und als Operationsliste ins Log schicken.
	// Kein Blob, kein Hash, keine Datei — der Sync trägt das Event wie jedes andere.
	// Messpunkte: Diff und Schatten laufen synchron über das ganze Heft — Verdacht für
	// die Hänger kurz nach dem Absetzen des Stifts (Trace: touchend bis 1,4 s).
	async function persistDoc(savePid, saveDoc) {
		const pages = saveDoc?.pages?.length;
		const { ops } = PERF_PROFILER.measure("heft.save-diff", () => diffDocument(published[savePid], saveDoc), { pages }, 16);
		if (!ops.length) return;
		await PERF_PROFILER.run("heft.save-blobs", () => persistReferencedBlobs(saveDoc), {}, 16);
		dropThumbs(savePid);
		// Der Reducer meldet das Event über state:heft-changed — damit rückt auch der Schatten vor.
		await PERF_PROFILER.run("heft.save-dispatch", () => STATE.dispatch("heftOps", { pageId: savePid, ops }, { origin: EDITOR }), { ops: ops.length }, 16);
		if (savePid === pid && saveDoc === doc) relinkLasso(doc);
		// Handschrift neu lesen, wo sich Striche geändert haben – EINE Stelle für Schreiben,
		// Radieren, Rückgängig und Lasso. Vorher nur nach Stiftstrichen: Wegradiertes blieb
		// in der Suche auffindbar.
		const strokePages = new Set(ops.filter((op) => op.t === "s+" || op.t === "s-" || op.t === "s=").map((op) => op.p));
		for (const page of saveDoc.pages) if (strokePages.has(page.id)) BUS.emit("heft:schedule-page", { pageId: savePid, page });
		await PERF_PROFILER.run("heft.snapshot", () => maybeSnapshot(savePid, saveDoc), {}, 30);
	}

	async function saveNow() {
		clearTimeout(saveT);
		if (!pid || !doc) return;

		const savePid = pid, saveDoc = doc, seq = editSeq;
		saving = true;
		try {
			await PERF_PROFILER.run("heft.save", () => persistDoc(savePid, saveDoc), { pages: saveDoc.pages?.length }, 30);
			if (savePid === pid && seq === editSeq) unsaved = false;
		} catch (e) { console.warn("Heft: Speichern fehlgeschlagen", e); }
		finally { saving = false; }
	}

	if (typeof document !== "undefined") {
		document.addEventListener("visibilitychange", () => {
			if (document.hidden) saveNow().catch(() => {});
		});
	}
	if (typeof window !== "undefined") {
		window.addEventListener("pagehide", () => { saveNow().catch(() => {}); });
		window.addEventListener("freeze", () => { saveNow().catch(() => {}); });
	}

	async function restoreSnapshot(p, key) {
		return runRestoreSnapshot(p, key, {
			getCurrentDoc: async (id) => (pid === id && doc ? doc : load(id)),
			restoreDoc,
			toast: U.toast,
		});
	}
	// Gemeinsamer Wiederherstellungspfad für Verlauf und KI-Undo. Er aktualisiert nicht
	// nur das Event-Log, sondern auch die laufenden Canvas-Referenzen des geöffneten Hefts.
	async function restoreDoc(p, restored) {
		// Erst ungespeicherte Änderungen ins Log: Der Diff läuft gegen das lebende Dokument. Eine
		// noch nicht gespeicherte Radierung fehlte darin schon, erzeugte also kein „s-“ – der
		// Strich blieb im Log und tauchte nach dem Neuladen wieder auf.
		if (pid === p) await saveNow();
		const target = { v: 2, rev: 0, pages: JSON.parse(JSON.stringify(restored?.pages || [])) };
		const current = STATE.heftDoc(p) || { v: 2, rev: 0, pages: [] };
		const { ops } = diffDocument(documentShadow(current), target);
		if (ops.length) await STATE.dispatch("heftOps", { pageId: p, ops }, { origin: EDITOR });
		const d = STATE.heftDoc(p) || target;
		docs[p] = d;
		published[p] = STATE.heftShadow(p) || documentShadow(d);
		if (pid === p) {
			doc = d; idx = Math.min(idx, d.pages.length - 1); sel = null; lassoSel = null; undoStack = []; redoStack = [];
			rebuildScroll(); updateChrome();
		}
		return { ok: true };
	}
	async function openVerlaufPop() {
		if (!pop || !pid || pop.dataset.kind === "verlauf") return;
		const owner = pop;
		owner.dataset.kind = "verlauf";
		setPagesView(pagesHistoryHtml(doc.pages.length, null));
		let snaps = [];
		try { snaps = await pruneSnapshots(pid); } catch (e) { console.warn("Heft: Verlauf laden fehlgeschlagen", e); }
		if (pop !== owner || owner.dataset.kind !== "verlauf") return; // Pop geschlossen oder zurück zum Raster
		owner.__verSnaps = snaps;
		setPagesView(pagesHistoryHtml(doc.pages.length, snaps));
		placePagesPop();
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
	// Seitenzahl: offenes Heft aus der Arbeitskopie (auch Ungespeichertes), sonst aus dem Kern.
	const pagesOf = (p) => (p === pid && doc ? doc.pages.length : STATE.heftMeta(p)?.pages) || 1;

	function paintPaper(x, w, h, kind) {
		x.fillStyle = "#fbfaf7";
		x.fillRect(0, 0, w, h);
		if (kind === "blank") return;
		// Linien, Raster und Punkte nehmen die Akzentfarbe (settings.js setzt --accent am body)
		const ink = getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#6b8cae";
		// PERF: Alle Punkte bzw. Linien in EINEM Pfad — vorher ein fill()/stroke() je Punkt
		// (Punktpapier: ~1.700 Zeichenaufrufe bei jedem Neuzeichnen und jeder Zoom-Kachel).
		x.save();
		x.beginPath();
		if (kind === "dots") {
			x.fillStyle = ink; x.globalAlpha = 0.35;
			for (let y = 40; y < h; y += 28) for (let gx = 40; gx < w; gx += 28) { x.moveTo(gx + 1.2, y); x.arc(gx, y, 1.2, 0, Math.PI * 2); }
			x.fill();
		} else {
			x.strokeStyle = ink; x.globalAlpha = 0.22;
			x.lineWidth = 1;
			const x0 = kind === "lined" ? 90 : 0, x1 = kind === "lined" ? w - 50 : w;
			for (let y = kind === "lined" ? 96 : 28; y < h - (kind === "lined" ? 40 : 0); y += 28) { x.moveTo(x0, y); x.lineTo(x1, y); }
			if (kind === "grid") for (let gx = 28; gx < w; gx += 28) { x.moveTo(gx, 0); x.lineTo(gx, h); }
			x.stroke();
			if (kind === "lined") { x.globalAlpha = 0.4; x.beginPath(); x.moveTo(90, 40); x.lineTo(90, h - 40); x.stroke(); }
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
			else if (a.type === "triangle") { x.beginPath(); x.moveTo(a.x1, a.y1); x.lineTo(a.x2, a.y2); x.lineTo(a.x3, a.y3); x.lineTo(a.x1, a.y1); x.stroke(); }
			else if (a.type === "arrow") { x.beginPath(); x.moveTo(a.x1, a.y1); x.lineTo(a.x2, a.y2); x.lineTo(a.h1x, a.h1y); x.moveTo(a.x2, a.y2); x.lineTo(a.h2x, a.h2y); x.stroke(); }
			else if (a.type === "rect") { x.strokeRect(Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1)); }
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

	// cache: imgCache gehört dem geöffneten Heft (unmount leert ihn). Vorschauen und Exporte
	// anderer Hefte bekommen einen eigenen, kurzlebigen Cache (scratchImages) — sonst sammelten
	// sich dort dekodierte Scans aller je angezeigten Hefte bis zum nächsten Schließen an.
	function imgEl(im, cache = imgCache) {
		let c = cache[im.id];
		if (!c) {
			const src = imgSrc(im);
			// Bilddaten noch nicht da (Fremd-Event vor seinem heftBlob): nicht merken — sonst bliebe
			// das leere Bild bis zum Schließen im Cache, obwohl die Daten kurz danach eintreffen.
			if (!src) return new Image();
			c = new Image();
			if (cache === imgCache) c.onload = () => {

				if (pid) dropThumbs(pid);

				if (host && doc) {
					const pageIndex = doc.pages.findIndex((pg) => (pg.images || []).some((item) => item.id === im.id));
					if (pageIndex !== -1) { redrawPage(pageIndex); renderThumb(pageIndex); }
				}
			};
			c.src = src;
			cache[im.id] = c;
		}
		return c;
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
	function renderPageTo(x, pg, pi, tileRect = null, imgOf = imgEl) {
		paintPaper(x, PAGE_W, PAGE_H, pg.paper);
		(pg.images || []).forEach((im) => {
			const el = imgOf(im);
			if (el instanceof ImageBitmap ? el.width : el.complete && el.naturalWidth) x.drawImage(el, im.x, im.y, im.w, im.h);
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
		(pg.texts || []).forEach((t) => { if (t.id !== editingTxtId) drawTextBox(x, t); });
		if (lassoSel && lassoSel.pageIdx === pi) drawLassoSelection(x, lassoSel.strokes, lassoSel.bounds);
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
		const cv = x.canvas, dpr = cv.__heftDpr || 1, s = cv.__heftScale || vp.scale();
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

	// Ansicht (Zoom, Verschieben, Kacheln, Finger-Gesten): heft-viewport.js.
	// Getter statt Werte, weil bindCanvas()/unmount() die Zeichenflächen neu zuweisen;
	// input (Stift-Eingabe, weiter unten angelegt) erst beim Aufruf auflösen.
	const vp = createHeftViewport({
		host: () => host, doc: () => doc, drawing: () => drawing,
		canvases: () => canvases, detailCanvases: () => detailCanvases, wetCanvases: () => wetCanvases, pageSlots: () => pageSlots,
		penRecently: () => input.penRecently(), touchNavigates: () => input.touchNavigates(),
		drawStroke, renderPageTo, applyTransform, redrawBasePage, viewChanged,
		// Zwei-/Drei-Finger-Tipp: im Lesemodus nichts zurücknehmen.
		undo: () => { if (!isViewOnly()) undo(); }, redo: () => { if (!isViewOnly()) redo(); },
	});
	const {
		view, viewport, contentSize, scrollEl, navReset, animateTo, layout,
		visiblePageIndices, pageRectForTile, renderDetailTile, renderVisiblePages, applyTouchAction,
		onPenBoundary, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onWheelZoom,
	} = vp;
	let scrollSettleTimer = 0;

	// Stift-Eingabe (heft-input.js). Gemeinsamer Zustand über Getter/Setter, damit die
	// Eingabe immer das aktuelle Dokument, Werkzeug und die aktuelle Auswahl sieht.
	const input = createHeftInput({
		vp,
		get doc() { return doc; },
		get host() { return host; },
		get pid() { return pid; },
		get idx() { return idx; }, set idx(v) { idx = v; },
		get tool() { return tool; }, set tool(v) { tool = v; },
		set expanded(v) { expanded = v; },
		get color() { return color; },
		get size() { return size; },
		get onlyPen() { return onlyPen; },
		get viewOnly() { return isViewOnly(); },
		get eraserSize() { return eraserSize; },
		get drawing() { return drawing; }, set drawing(v) { drawing = v; },
		get sel() { return sel; }, set sel(v) { sel = v; },
		get lassoSel() { return lassoSel; }, set lassoSel(v) { lassoSel = v; },
		imagesOf, textsOf, hitText, redrawPage, updateChrome, dropLasso, pushUndo, refresh,
		openTextEditor, setWriting, drawStroke, scheduleSave, renderThumb,
	});
	const { onDown, onMove, onUp } = input;

	function applyHistory(fromStack, toStack, isRedo) {
		PERF_PROFILER.measure("heft.undo-redo", () => {
			const a = fromStack.pop(); if (!a || !doc) return;
			// Seite über ID auflösen (Index driftet); Seite weg = Eintrag tot, nicht raten.
			const pi = a.pageId ? doc.pages.findIndex((p) => p.id === a.pageId) : (a.pageIdx != null ? a.pageIdx : idx);
			const pg = pi >= 0 ? doc.pages[pi] : null; if (!pg) return;
			// Lasso-Einträge ebenfalls über IDs auflösen: nach einem Sync-Import sind die
			// gemerkten Objekte nicht mehr die auf der Seite (Undo lief sonst ins Leere).
			const live = a.kind === "lassoMove" || a.kind === "lassoResize" ? new Map(pg.strokes.map((s) => [s.id, s])) : null;
			if (a.kind === "lassoMove") {
				const d = isRedo ? 1 : -1;
				a.strokes = a.strokes.map((s) => live.get(s.id) || s);
				a.strokes.forEach((s) => { if (live.has(s.id)) translateStroke(s, d * a.dx, d * a.dy); });
			}
			else if (a.kind === "lassoResize") {
				a.strokes = a.strokes.map((s) => live.get(s.id) || s);
				const current = a.strokes.map(strokeGeometry);
				a.strokes.forEach((stroke, i) => { if (live.has(stroke.id)) applyStrokeGeometry(stroke, a.prev[i]); });
				a.prev = current;
			}
			else if (a.kind === "imgMod") {
				// Bild ODER Textfeld (Verschieben nutzt denselben Eintrag), per ID aufgelöst.
				a.im = imagesOf(pg).find((o) => o.id === a.im.id) || textsOf(pg).find((o) => o.id === a.im.id) || a.im;
				const cur = { x: a.im.x, y: a.im.y, w: a.im.w, h: a.im.h }; Object.assign(a.im, a.prev); a.prev = cur;
			}
			else if (a.kind === "txtEdit") {
				a.txt = textsOf(pg).find((o) => o.id === a.txt.id) || a.txt;
				const cur = a.txt.text; a.txt.text = a.prev; a.prev = cur;
			}
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
			// Rahmen folgt den Strichen: sonst blieb er nach Undo von Verschieben/Skalieren
			// an der alten Stelle stehen und griff ins Leere.
			if (lassoSel) lassoSel.bounds = lassoBounds(lassoSel.strokes);
			toStack.push(a);
			refresh(pi);
		}, { isRedo }, 16);
	}
	function undo() { applyHistory(undoStack, redoStack, false); }
	function redo() { applyHistory(redoStack, undoStack, true); }

	let chromeMin = false;
	const toolbarHtml = () => buildToolbarHtml({
		tool,
		expanded,
		chromeMin,
		color,
		size,
		eraserSize,
		onlyPen,
		pens,
		penSlot,
		popKind: pop ? pop.dataset.kind : "",
		phone: document.body.classList.contains("mobile-ui"),
		canBack: canGoBack(),
		canForward: canGoForward(),
		trayPos,
		hostHeight: host ? host.clientHeight : 0,
	});
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
		trayDrag = { tray, grip, pid: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top };
		trayPos = { x: r.left - hr.left, y: r.top - hr.top, side: trayPos && trayPos.side || null };
		tray.style.cssText = trayCss(trayPos, host.clientHeight);
		tray.classList.add("is-dragging");
		try { grip.setPointerCapture(e.pointerId); } catch {  }
	}
	function onTrayPointerMove(e) {
		if (!trayDrag || !host || e.pointerId !== trayDrag.pid) return;
		e.preventDefault();
		const { tray, grip } = trayDrag;
		const hr = host.getBoundingClientRect();
		const px = e.clientX - hr.left;
		const side = px < TRAY_DOCK_PX ? "left" : px > hr.width - TRAY_DOCK_PX ? "right" : null;
		if (side !== trayPos.side) {
			// Ausrichtung wechselt → Griff bleibt unter dem Finger.
			tray.classList.toggle("is-vertical", !!side);
			const r = tray.getBoundingClientRect(), g = grip.getBoundingClientRect();
			trayDrag.ox = g.left - r.left + g.width / 2;
			trayDrag.oy = g.top - r.top + g.height / 2;
		}
		const tr = tray.getBoundingClientRect();
		const x = Math.min(Math.max(8, px - trayDrag.ox), Math.max(8, hr.width - tr.width - 8));
		const y = Math.min(Math.max(8, e.clientY - hr.top - trayDrag.oy), Math.max(8, hr.height - tr.height - 8));
		trayPos = { x, y, side };
		tray.style.cssText = trayCss(trayPos, host.clientHeight);
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
		if (thumbIO) { thumbIO.disconnect(); thumbIO = null; }
		dropThumbBitmaps();
		if (popScrim) { popScrim.remove(); popScrim = null; }
		exportSel = null;
	}
	function onDocPointerDown(e) {
		if (!pop) return;
		if (pop.contains(e.target)) return;
		// #overlay: Bestätigungsdialoge (U.confirm) liegen über dem Popup und gehören noch dazu.
		if (e.target.closest && e.target.closest("[data-hepagesmenu],[data-heplusmenu],[data-heimgmenu],#overlay")) return;
		closePop();
	}
	// Seitenübersicht und Verlauf mittig im Heft halten (nach jedem Inhaltswechsel neu messen).
	function placePagesPop() {
		if (!pop || !host) return;
		const hr = host.getBoundingClientRect();
		pop.style.top = Math.max(12, Math.round((hr.height - pop.offsetHeight) / 2)) + "px";
		pop.style.left = Math.max(8, Math.round((hr.width - pop.offsetWidth) / 2)) + "px";
	}
	function openPop(anchor, html, kind, cls) {
		closePop();
		pop = document.createElement("div");
		pop.className = "heft-pop" + (cls ? " " + cls : "");
		pop.dataset.kind = kind;
		pop.innerHTML = html;
		host.appendChild(pop);

		const hr = host.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
		if (kind === "pages") {
			// Seitenübersicht: mittig im Heft über abgedunkeltem Hintergrund, nicht an die Werkzeugleiste angedockt.
			popScrim = document.createElement("div");
			popScrim.className = "heft-pop-scrim";
			popScrim.addEventListener("pointerdown", closePop);
			host.appendChild(popScrim);
			placePagesPop();
			wirePagesPop();
		} else {
			pop.style.top = Math.round(ar.bottom - hr.top + 6) + "px";
			let left = Math.round(ar.left - hr.left);
			if (left + pop.offsetWidth > hr.width - 8) left = Math.round(hr.width - pop.offsetWidth - 8);
			pop.style.left = Math.max(8, left) + "px";
		}
		setTimeout(() => document.addEventListener("pointerdown", onDocPointerDown, true), 0);
	}
	function togglePop(kind, anchor) {
		if (pop && pop.dataset.kind === kind) { closePop(); return; }
		if (kind === "pages") { openPop(anchor, pagesPopHtml(), "pages", "heft-pop-pages"); paintPopThumbs(); }
		else if (kind === "plus") openPop(anchor, plusPopHtml(), "plus", "heft-pop-plus");
		else if (kind === "img") openPop(anchor, imgPopHtml(), "img", "heft-pop-img");
	}
	const pagesPopHtml = () => pagesGridHtml({ total: doc.pages.length, idx, exportSel });
	const plusPopHtml = () => buildPlusPopHtml({ insertPos, curPaper: page() ? page().paper : "lined" });

	// Miniaturen erst zeichnen, wenn sie in Sichtweite scrollen: alle auf einmal hielt bei
	// großen Heften (175 Seiten) den Hauptthread ~10 s fest, bevor die Übersicht reagierte.
	function paintPopThumbs() {
		if (thumbIO) { thumbIO.disconnect(); thumbIO = null; }
		const grid = pop && doc && pop.dataset.kind === "pages" && pop.querySelector(".heft-pop-grid");
		if (!grid) return;
		thumbIO = new IntersectionObserver((entries, io) => {
			for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); paintThumbEl(e.target); }
		}, { root: grid, rootMargin: "600px 0px" });
		grid.querySelectorAll("[data-hethumb]").forEach((t) => thumbIO.observe(t));
	}
	// Kopf und Umschalter bleiben stehen (nur angeglichen), Inhalt und Fußleiste werden getauscht.
	// Vorher wurde das ganze Fenster neu gebaut: Kopf verschwand kurz, Scroll sprang nach oben.
	function setPagesView(html) {
		const t = document.createElement("div"); t.innerHTML = html;
		const top = pop.querySelector(":scope > .heft-pages-top"), freshTop = t.querySelector(":scope > .heft-pages-top");
		if (!top || !freshTop) { pop.innerHTML = html; return; }
		U.morph(top, freshTop.innerHTML);
		top.className = freshTop.className;
		while (top.nextSibling) top.nextSibling.remove();
		freshTop.remove();
		pop.append(...t.childNodes);
	}
	function refreshPagesPop() {
		if (!pop || pop.dataset.kind !== "pages" || !doc) return;
		const scroll = pop.querySelector(".heft-pop-grid")?.scrollTop || 0;
		setPagesView(pagesPopHtml());
		lastPopSig = pagesPopSig();
		const grid = pop.querySelector(".heft-pop-grid"); if (grid) grid.scrollTop = scroll;
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
		const sub = pop.querySelector(".heft-pages-manager-head small"); if (sub) sub.textContent = selectionSub(n);
		const del = pop.querySelector("[data-hepagesdelete]"); if (del) { del.disabled = !canDeletePages(total, n); del.innerHTML = lead("trash") + "Löschen (" + n + ")"; }
		const exp = pop.querySelector("[data-heexportopen]"); if (exp) { exp.disabled = !n; exp.textContent = "Exportieren (" + n + ")"; }
		const all = pop.querySelector("[data-heselectall]"); if (all) all.textContent = selectAllLabel(n, total);
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

	function openTextEditor(pi, px, py, txt) {
		closeTextEditor(true);
		const slot = host && host.querySelectorAll(".heft-page-slot")[pi];
		const cvEl = slot && slot.querySelector("canvas");
		const pg = doc && doc.pages[pi];
		if (!cvEl || !pg) return;
		// Layout-Breite ohne Zoom: Das Feld liegt im Seiten-Slot, den .heft-pages schon skaliert.
		const k = cvEl.offsetWidth / PAGE_W;
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
		if (txt) { editingTxtId = txt.id; redrawPage(pi); }
		const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
		fit();
		ta.addEventListener("input", fit);
		ta.addEventListener("pointerdown", (ev) => ev.stopPropagation());
		ta.addEventListener("keydown", (ev) => {
			ev.stopPropagation();
			if (ev.key === "Escape") { ev.preventDefault(); closeTextEditor(false); }
			else if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); closeTextEditor(true); }
		});
		const openedAt = Date.now();
		ta.addEventListener("blur", () => {
			// Touch-Schutz: Viewport-Resize beim Hochfahren der Bildschirmtastatur (iPad/Android)
			// löst kurzfristig ein blur-Event aus; erst nach Initialisierungsphase schließen.
			if (Date.now() - openedAt < 350) return;
			closeTextEditor(true);
		});
		ta.focus();
	}
	function closeTextEditor(commit) {
		if (!inlineEd) return;
		const { ta, pi, txt, x: px, y: py } = inlineEd;
		inlineEd = null;
		const val = String(ta.value || "");
		ta.remove();
		const pg = doc && doc.pages[pi];
		editingTxtId = null;
		if (!pg) return;
		const body = val.replace(/\s+$/, "");
		// Per ID: Ein Import während des Tippens kann das Dokument neu aufgebaut haben.
		const cur = txt ? textsOf(pg).find((t2) => t2.id === txt.id) : null;
		if (commit && cur && body.trim() && body !== cur.text) {
			pushUndo({ kind: "txtEdit", txt: cur, prev: cur.text, pageIdx: pi });
			cur.text = body; scheduleSave();
		} else if (commit && cur && !body.trim()) {
			pg.texts = textsOf(pg).filter((t2) => t2.id !== cur.id);
			pushUndo({ kind: "txtDel", txt: cur, pageIdx: pi });
			if (sel && sel.txtId === cur.id) sel = null;
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
	const pagesPopSig = () => doc.pages.length + "|" + idx + "|" + (exportSel ? [...exportSel].sort((a, b) => a - b).join(",") : "-");
	function refreshPagesPopIfNeeded() {
		if (!pop || pop.dataset.kind !== "pages" || !doc) { lastPopSig = ""; return; }
		const sigNow = pagesPopSig();
		if (sigNow === lastPopSig) return;
		const [lastLen, , lastSel] = lastPopSig.split("|");
		lastPopSig = sigNow;
		// Nur die aktuelle Seite hat gewechselt: Markierung umsetzen statt neu bauen (kein Flackern, Scroll bleibt).
		if (!exportSel && lastSel === "-" && Number(lastLen) === doc.pages.length) {
			pop.querySelectorAll("[data-hethumb]").forEach((t) => t.classList.toggle("active", Number(t.dataset.hethumb) === idx));
			return;
		}
		refreshPagesPop();
	}
	let lastChromeHtml = "";
	function updateChrome() {
		if (!host || !doc) return;
		// EINE Stelle für alle Werkzeugwechsel (Stift-Knopf, Favoriten, Bild, Radierer halten):
		// Auswahl gehört nur zum Lasso. Vorher blieben Rahmen und Leiste beim Stift stehen.
		if (lassoSel && tool !== "lasso") dropLasso();
		const html = toolbarHtml();
		const chrome = host.querySelector(".heft-chrome");
		if (chrome && html === lastChromeHtml) { syncVolatileChrome(); updateLassoBar(); refreshPagesPopIfNeeded(); return; }
		lastChromeHtml = html;
		// 26. Juli: Leiste ANGLEICHEN statt austauschen (U.morph). Das Ersetzen war die
		// Ursache für das schlagartige Verschwinden: die neuen Knoten mussten ihren
		// backdrop-filter (Unschärfe) erst neu aufbauen und die Einblend-Animation der
		// Options-Leiste startete bei JEDER Kleinigkeit (Farbe, Werkzeug, Position) von
		// vorn — dazwischen war für einen Frame nichts zu sehen.
		// Die Options-Leiste trägt ein data-key: ohne ihn glich morph beim Ausklappen nach
		// Position ab und baute die Ecke oben rechts (KI-Chat, ＋) zur Leiste um.
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

	// Auswahl aufheben UND ihren Rahmen von der Seite nehmen (nur null setzen ließ ihn stehen).
	function dropLasso() {
		const lpi = lassoSel && lassoSel.pageIdx;
		lassoSel = null;
		if (lpi != null) redrawPage(lpi);
	}
	function updateLassoBar() {
		updateLassoBarUI(host, lassoSel, lead);
	}

	function recognizeLassoSelection() {
		recognizeLassoText(lassoSel, HANDSCHRIFT, U.toast, PERF_PROFILER);
	}

	function trainLassoSelection() {
		trainLassoSample(lassoSel, HANDSCHRIFT, U.toast);
	}

	function duplicateLassoSelection() {
		const next = duplicateLassoStrokes(lassoSel, doc, pushUndo);
		if (!next) return;
		lassoSel = next;
		scheduleSave(); redrawPage(lassoSel.pageIdx); renderThumb(lassoSel.pageIdx); updateChrome();
	}

	function deleteLassoSelection() {
		const lpi = deleteLassoStrokes(lassoSel, doc, pushUndo);
		if (lpi == null) { lassoSel = null; updateChrome(); return; }
		lassoSel = null;
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
	function paintInto(cv, pg, pi, imgOf) {
		const k = cv.width / PAGE_W;
		cv.height = Math.round(PAGE_H * k); // setzt die Höhe UND leert das Canvas
		const x = cv.getContext("2d");
		x.setTransform(k, 0, 0, k, 0, 0);
		renderPageTo(x, pg, pi, null, imgOf);
	}
	// Scans für Miniaturen verkleinert im Hintergrund dekodieren: drawImage des vollen JPEGs
	// dekodierte im Hauptthread (~30 ms pro Scan) — 20 sichtbare Scan-Seiten ≈ 1 s Ruckler.
	// Lebt nur, solange die Übersicht offen ist (closePop gibt die Bitmaps frei), höchstens THUMB_BITMAP_MAX Stück.
	const THUMB_BITMAP_MAX = 48;
	function thumbBitmap(im, width) {
		const key = (im.ref || im.id) + "@" + width;
		if (!thumbBitmaps.has(key)) {
			const src = imgSrc(im);
			if (!src) return Promise.resolve(null); // Blob noch nicht geladen: nicht merken, später erneut
			thumbBitmaps.set(key, fetch(src).then((r) => r.blob())
				.then((b) => createImageBitmap(b, { resizeWidth: width, resizeQuality: "medium" })).catch(() => null));
			if (thumbBitmaps.size > THUMB_BITMAP_MAX) {
				const [oldKey, old] = thumbBitmaps.entries().next().value;
				thumbBitmaps.delete(oldKey);
				old.then((b) => b && b.close());
			}
		}
		return thumbBitmaps.get(key);
	}
	function dropThumbBitmaps() {
		thumbBitmaps.forEach((p) => p.then((b) => b && b.close()));
		thumbBitmaps.clear();
	}
	async function paintThumbEl(t) {
		const i = Number(t.dataset.hethumb), cv = t.querySelector("canvas"), pg = doc && doc.pages[i];
		if (!cv || !pg) return;
		const ims = pg.images || [];
		const bmps = await Promise.all(ims.map((im) => thumbBitmap(im, Math.max(1, Math.ceil(im.w * cv.width / PAGE_W)))));
		if (!t.isConnected || !doc || doc.pages[i] !== pg) return; // Übersicht zu oder Seiten verschoben
		// Eine inzwischen verdrängte (geschlossene) Bitmap hat Breite 0 → volles Bild als Rückfall.
		paintInto(cv, pg, i, (im) => { const b = bmps[ims.indexOf(im)]; return b && b.width ? b : imgEl(im); });
		t.dataset.painted = "1";
	}
	// Nur schon gezeichnete Miniaturen auffrischen; die übrigen malt der Observer beim Hineinscrollen.
	function renderThumb(i) {
		if (!pop || pop.dataset.kind !== "pages" || !doc || !doc.pages[i]) return;
		const t = pop.querySelector('[data-hethumb="' + i + '"]');
		if (t && t.dataset.painted) paintThumbEl(t);
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
		rememberPos();
	}
	function addPageAt(paper, pageObj) {
		const at = insertIndex();
		doc.pages.splice(at, 0, pageObj || newPage(paper || (page() ? page().paper : "lined")));
		sel = null;
		scheduleSave(); rebuildScroll(); go(at);
	}
	// Bestätigung über den In-App-Dialog: natives confirm() kann Chrome lautlos mit false
	// beantworten (unterdrückte Dialoge, App-Fenster) — der Klick tat dann scheinbar nichts.
	const confirmDelete = (msg) => U.confirm(msg, { title: "Löschen", ok: "Löschen", danger: true });
	async function deletePageAt(i) {
		if (!doc || doc.pages.length <= 1 || !doc.pages[i]) return;
		const pg = doc.pages[i];
		const hasContent = (pg.strokes && pg.strokes.length) || (pg.images && pg.images.length) || (pg.texts && pg.texts.length);
		if (hasContent && !(await confirmDelete("Diese Heftseite wirklich löschen?"))) return;
		if (doc.pages[i] !== pg) return; // während des Dialogs geändert (z. B. Sync)
		doc.pages.splice(i, 1);
		sel = null; lassoSel = null; undoStack = []; redoStack = [];
		scheduleSave(); rebuildScroll(); go(Math.min(i, doc.pages.length - 1));
	}
	async function deleteSelectedPages() {
		if (!doc || !exportSel || !canDeletePages(doc.pages.length, exportSel.size)) return;
		const chosen = [...exportSel].sort((a, b) => b - a);
		const chosenIds = chosen.map((i) => doc.pages[i] && doc.pages[i].id);
		if (!(await confirmDelete(chosen.length + (chosen.length === 1 ? " ausgewählte Seite" : " ausgewählte Seiten") + " wirklich löschen?"))) return;
		// Während des Dialogs kann der Sync das Dokument ersetzt haben — dann nicht blind per Index löschen.
		if (!doc || chosen.some((i, k) => !doc.pages[i] || doc.pages[i].id !== chosenIds[k])) { if (U.toast) U.toast("Heft wurde inzwischen geändert — bitte Auswahl prüfen", "error"); return; }
		try { await writeSnapshot(pid, encodeDoc(doc), doc.pages.length); } catch (e) { console.warn("Heft: Sicherung vor Löschen fehlgeschlagen", e); }
		const currentId = page() && page().id;
		chosen.forEach((i) => doc.pages.splice(i, 1));
		idx = doc.pages.findIndex((pg) => pg.id === currentId);
		if (idx < 0) idx = Math.min(chosen[chosen.length - 1] || 0, doc.pages.length - 1);
		if (exportSel) exportSel = new Set(); // Popup kann während des Dialogs geschlossen worden sein
		sel = null; lassoSel = null; undoStack = []; redoStack = [];
		scheduleSave(); rebuildScroll(); refreshPagesPop(); go(idx);
		if (U.toast) U.toast(chosen.length + " Seite(n) gelöscht · über Verlauf wiederherstellbar", "success");
	}

	// Import-, Datei- und Bildverarbeitung (ausgelagert in heft-import.js)
	const imagePage = (im, paper, bleed) => createImagePage(im, paper, bleed, { blobRef, newPage });
	const importPdf = (f, at, targetDoc = doc) => runImportPdf(f, at, targetDoc, { blobRef, newPage, pdfs: PDFS, toast: U.toast });

	async function importFilesIntoHeft(targetId, files, position, onStatus) {
		return runImportFilesIntoHeft(targetId, files, position, onStatus, {
			getActiveDoc: () => doc,
			getActivePid: () => pid,
			getActiveIdx: () => idx,
			loadDoc: load,
			persistDoc,
			rebuildScroll,
			go,
			blobRef,
			newPage,
			pdfs: PDFS,
			toast: U.toast
		});
	}

	function openImportDialog(files, initialHeftId = pid) {
		return renderImportDialog(files, initialHeftId, {
			importFiles: (targetId, fls, pos, onStatus) => importFilesIntoHeft(targetId, fls, pos, onStatus),
			getActivePid: () => pid,
			pages: S.pages,
			pdfs: PDFS,
			toast: U.toast,
			transferOverlay,
			closeTransferOverlay
		});
	}

	async function insertImageFile(f) {
		return runInsertImageFile(f, {
			getPage: page,
			getIdx: () => idx,
			blobRef,
			pushUndo,
			onInserted: ({ img, pageIdx }) => {
				sel = { pageIdx, imgId: img.id };
				tool = "select";
				expanded = false;
				refresh(pageIdx);
			},
			toast: U.toast
		});
	}

	async function addImagePageFromFile(f) {
		return runAddImagePageFromFile(f, {
			getPage: page,
			addPageAt,
			blobRef,
			newPage
		});
	}

	function importFiles() {
		return runImportFiles({
			pickFiles: filePick,
			openDialog: openImportDialog,
			getPid: () => pid
		});
	}

	// Scanner-Oberfläche lebt in heft-scanner-ui.js; das Heft liefert nur das Einfügen.
	// PERF: Scanner samt Bildverarbeitung (~85 KB) erst beim ersten Öffnen laden, nicht bei jedem Start.
	let scanner = null;
	async function openScanner() {
		scanner ||= (await import("./heft-scanner-ui.js")).createScanner({ insertPages: insertScannedPages, pickFiles: filePick, fileToImageData });
		scanner.open();
	}
	function insertScannedPages(images) {
		if (!doc || !images.length) { if (U.toast) U.toast("Keine fertigen Scans zum Einfügen", "error"); return; }
		let at = insertIndex();
		images.forEach((im) => { doc.pages.splice(at, 0, imagePage(im, "blank", true)); at++; });
		scheduleSave(); rebuildScroll(); go(at - 1);
		if (U.toast) U.toast(images.length + " Scan(s) als Heftseiten eingefügt");
		BUS.emit("heft:start-background-scan");
	}

	// ---- Heft-Export (Seiten-Menü + Teilen-Menü): Seiten als PDF oder PNG ----
	// Bilder vorab dekodieren, sonst fehlen Scans und PDF-Seiten auf frisch erzeugten
	// Canvases (Export, Vorschauen auf Startseite/Einbettungen, Seitenbild für die KI).
	const scratchImages = () => { const cache = {}; return (im) => imgEl(im, cache); };
	const imagesFor = (pageId) => (pageId === pid ? imgEl : scratchImages());
	const decodeImages = (pages, imgOf) => Promise.all(pages.flatMap((pg) => (pg.images || []).map((im) => {
		const el = imgOf(im);
		return el.decode && el.src ? el.decode().catch(() => {}) : null;
	})));
	async function docWithImages(pageId, imgOf) {
		const d = pageId === pid && doc ? doc : await load(pageId, { create: false });
		if (!d) return null;
		await decodeImages(d.pages, imgOf);
		return d;
	}
	// Export: dieselben dekodierten Bilder fürs Laden und fürs Zeichnen.
	function exportDeps(pageId) {
		const imgOf = imagesFor(pageId);
		return { loadDoc: (id) => docWithImages(id, imgOf), renderCanvas: (pg, w) => renderPageCanvas(pg, w, -1, imgOf) };
	}
	async function pdfBlob(pageId, indices, onStatus) {
		return PERF_PROFILER.run("heft.export-pdf", () => exportPdfBlob(pageId, indices, onStatus, exportDeps(pageId)), { pages: indices?.length }, 100);
	}
	async function exportPdf(pageId, indices) {
		return runExportPdf(pageId, indices, exportDeps(pageId));
	}
	async function imageFiles(pageId, indices, baseName, onStatus) {
		return PERF_PROFILER.run("heft.export-images", () => exportImageFiles(pageId, indices, baseName, onStatus, exportDeps(pageId)), { pages: indices?.length }, 100);
	}
	function openExportDialog() {
		if (!pid || !exportSel || !exportSel.size) return;
		const pageId = pid, indices = [...exportSel].sort((a, b) => a - b);
		closePop();
		return renderExportDialog({
			pageId,
			indices,
			defaultName: exportName(pageId),
			title: (S.pages[pageId] && S.pages[pageId].title) || "Heft",
			createPdfBlob: (pId, idxs, onStatus) => pdfBlob(pId, idxs, onStatus),
			createImageFiles: (pId, idxs, name, onStatus) => imageFiles(pId, idxs, name, onStatus),
			deliver: deliverExport,
			transferOverlay,
			closeTransferOverlay,
			toast: U.toast,
		});
	}
	function onHostClick(e) {
		const b = e.target.closest("button, .heft-pop-thumb");
		if (!b || !doc) return;
		const d = b.dataset;
		if (d.hesidebar) {
			const mobile = PLATFORM.isPhone();
			if (mobile) document.body.classList.toggle("mnav-open");
			else {
				const on = document.body.classList.toggle("sidebar-collapsed");
				try { localStorage.setItem("impala67.sidebarCollapsed", on ? "1" : "0"); } catch { }
			}
			return;
		}
		if (d.henavback) { BUS.emit("tabs:nav-back"); return; }
		if (d.henavforward) { BUS.emit("tabs:nav-forward"); return; }
		if (d.helassotext) { recognizeLassoSelection(); return; }
		if (d.helassotrain) { trainLassoSelection(); return; }
		if (d.helassodup) { duplicateLassoSelection(); return; }
		if (d.helassodel) { deleteLassoSelection(); return; }
		if (d.helassoclear) { dropLasso(); updateChrome(); return; }
		if (suppressEraserClick && d.hetool === "eraser") return;
		if (d.hepagesmenu) { togglePop("pages", b); return; }
		if (d.heplusmenu) { togglePop("plus", b); return; }
		if (d.heimgmenu) { togglePop("img", b); return; }
		if (d.heexpstart) { exportSel = new Set(); refreshPagesPop(); return; }
		if (d.heselectall) { const all = exportSel && exportSel.size === doc.pages.length; exportSel = new Set(all ? [] : doc.pages.map((_, i) => i)); refreshPagesPop(); return; }
		if (d.heexpcancel) { exportSel = null; refreshPagesPop(); return; }
		if (d.hepagesclose) { closePop(); return; }
		if (d.hepagesdelete) { deleteSelectedPages().catch((e2) => U.toast && U.toast("Seiten konnten nicht gelöscht werden: " + ((e2 && e2.message) || e2), "error")); return; }
		if (d.heexportopen) { openExportDialog(); return; }
		if (d.heverlauf) { openVerlaufPop(); return; }
		if (d.hepagesback) { if (pop && pop.dataset.kind !== "pages") { pop.dataset.kind = "pages"; setPagesView(pagesPopHtml()); lastPopSig = pagesPopSig(); paintPopThumbs(); wirePagesPop(); } return; }
		if (d.heverrestore != null) {
			const s = pop && pop.__verSnaps && pop.__verSnaps[Number(d.heverrestore)];
			if (!s) return;
			const p = pid;
			U.confirm("Diesen Stand wiederherstellen? Der aktuelle Stand wird vorher im Verlauf gesichert.", { title: "Wiederherstellen", ok: "Wiederherstellen" }).then((ok) => {
				if (!ok) return;
				closePop();
				return restoreSnapshot(p, s.key);
			}).catch((e2) => {
				console.warn("Heft: Wiederherstellen fehlgeschlagen", e2);
				if (U.toast) U.toast("Wiederherstellen fehlgeschlagen: " + ((e2 && e2.message) || e2), "error");
			});
			return;
		}
		if (d.hedelpage != null) { e.stopPropagation(); deletePageAt(Number(d.hedelpage)).catch((e2) => U.toast && U.toast("Seite konnte nicht gelöscht werden: " + ((e2 && e2.message) || e2), "error")); return; }
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
		if (d.hepen != null) {
			// Stift-Favorit wählen; erneuter Tipp auf den aktiven öffnet Farbe und Dicke.
			const i = Number(d.hepen);
			if (tool === "pen" && penSlot === i) expanded = !expanded;
			else { tool = "pen"; penSlot = i; ({ color, size } = pens[i]); expanded = false; }
			if (sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
		}
		else if (d.hetool) {
			if (d.hetool === "eraser") {
				if (tool === "eraser") expanded = !expanded;
				else { tool = "eraser"; expanded = true; }
			} else if (d.hetool === "pen" || d.hetool === "marker") {
				// Wie die Stift-Favoriten – erster Tipp wählt, zweiter öffnet die Optionen.
				expanded = tool === d.hetool && !expanded;
				tool = d.hetool;
			} else {

				tool = d.hetool; expanded = false;
				if (d.hetool === "select") closePop();
			}
			if (tool !== "select" && sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
		}
		else if (d.hecolor) {
			color = d.hecolor;
			if (tool === "eraser" || tool === "select") { tool = "pen"; expanded = true; }
			if (tool === "pen") pens[penSlot] = { color, size };
		}
		else if (d.hesize) {
			size = parseFloat(d.hesize);
			if (tool === "pen") pens[penSlot] = { color, size };
		}
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
			BUS.emit("ui:render-tabs");
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
			if (scanner?.handleEscape()) e.preventDefault();
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
			const best = vp.centerPageIndex();
			if (best >= 0 && best !== idx) { idx = best; updateChrome(); rememberPos(); }
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
		scroll.addEventListener("touchend", onTouchEnd, { passive: true });
		scroll.addEventListener("touchcancel", onTouchCancel, { passive: true });
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
			if (atEnd() && dy > 70) { pull.armed = true; if (btn) { btn.classList.add("armed"); btn.innerHTML = lead("arrow-up") + "Loslassen: neue Seite"; } }
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
		// Seiten neu angeordnet (einfügen, importieren, Sync): pageIdx der Auswahl zeigte
		// sonst auf eine fremde Seite -> Duplizieren landete dort.
		lassoSel = null;
		scroll.innerHTML = pagesHtml();
		bindCanvas();
		view.x = keep.x; view.y = keep.y; view.k = keep.k;
		layout();
	}
	async function mount(container, pageId) {
		const finish = PERF_PROFILER.start("heft.mount", { pageId }, 30);
		let finishView = null;
		try {
			unmount();
			const token = mountToken;
			host = container;
			pid = pageId;
			if (getComputedStyle(host).position === "static") host.style.position = "relative";
			host.innerHTML = '<div class="heft-loading" role="status">Heft laden…</div>';
			// Arbeitskopien anderer Hefte freigeben: nur das geöffnete bleibt im Speicher.
			for (const key of Object.keys(docs)) if (key !== pageId) { delete docs[key]; delete published[key]; }
			foreignQueue = []; unsaved = false;
			doc = await PERF_PROFILER.run("heft.load", () => load(pageId), { pageId }, 30);
			if (token !== mountToken || pid !== pageId) return;
			// Speicher: Bilder zuvor geöffneter Hefte freigeben (Scans sind schnell Hunderte MB).
			STATE.releaseHeftBlobs(doc.pages.flatMap((pg) => (pg.images || []).map((im) => im.ref).filter(Boolean)));
			finishView = PERF_PROFILER.start("heft.mount-view", { pages: doc.pages.length }, 16);
			idx = Math.min(lastPage(pageId), doc.pages.length - 1); sel = null; undoStack = []; redoStack = []; insertPos = "after";
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
			resizeFn = () => layout(true);
			window.addEventListener("resize", resizeFn);

			if (window.ResizeObserver) {
				resizeObserver = new ResizeObserver(() => layout(true));
				resizeObserver.observe(host);
			}
			bindCanvas();
			bindScroll();
			bindTrayDrag();
			finishView();
			PERF_PROFILER.measure("heft.layout", () => layout(), { pages: doc.pages.length }, 16);
			if (idx) PERF_PROFILER.measure("heft.go", () => go(idx), { page: idx }, 16);

			if (doc && doc.pages && doc.pages[idx]) BUS.emit("heft:schedule-page", { pageId: pid, page: doc.pages[idx] });
			purgeOrphanLegacyInk();
			pruneSnapshots(pageId).catch(() => {}); // abgelaufene Verlauf-Snapshots beim Öffnen wegräumen
		} finally {
			finishView?.(); // idempotent: schließt die Messung auch nach einem Fehler
			finish();
		}
	}
	function unmount(discardPending = false) {
		mountToken++;
		rememberPos();
		closePop();
		scanner?.close();
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
		host = null; pid = null; doc = null; idx = 0; canvases = []; pageSlots = []; detailCanvases = []; wetCanvases = [];
		drawing = null; sel = null; lassoSel = null; undoStack = []; redoStack = [];
		input.reset();
		clearTimeout(holdTimer); holdTool = null; suppressEraserClick = false;

		vp.reset(); clearTimeout(scrollSettleTimer); scrollSettleTimer = 0;
		trayDrag = null; boundTray = null; // detached Knoten nicht festhalten
		clearTimeout(writingOffT); writingOffT = 0; writing = false;
		lastChromeHtml = ""; lastPopSig = "";
	}

	function renderPageCanvas(pg, w, pageIdx = -1, imgOf = imgEl) {
		const c = document.createElement("canvas");
		c.width = w;
		paintInto(c, pg, pageIdx, imgOf);
		return c;
	}
	async function thumbnail(pageId, pageIndex, width) {
		const i = pageIndex || 0, w = width || 220;
		const key = pageId + ":" + i + ":" + w;
		if (thumbs[key]) return thumbs[key];

		if (thumbJobs[key]) return thumbJobs[key];
		const job = (async () => {
			const pg = await previewPage(pageId, i);
			if (!pg) return null;
			const imgOf = imagesFor(pageId);
			await decodeImages([pg], imgOf);
			const c = renderPageCanvas(pg, w, -1, imgOf);
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
					'<span class="heft-embed-label">' + lead("notebook") + U.esc((S.pages[id] && S.pages[id].title) || "Heft") + " · " + pagesOf(id) + " Seite(n)</span>";
			} catch (e) {
				delete el.dataset.heftdone;
				el.innerHTML = '<span class="heft-embed-label">' + lead("notebook") + U.esc((S.pages[id] && S.pages[id].title) || "Heft") + " öffnen</span>";
				console.warn("Heft: Embed-Vorschau fehlgeschlagen", e);
			}
		}
	}

	// Eine Seite für Vorschau, Miniatur oder Seitenbild: aus der offenen Arbeitskopie (zeigt auch
	// Ungespeichertes), sonst nur diese eine Seite aus dem Kern samt ihrer Bilddaten.
	async function previewPage(pageId, pageIdx) {
		const i = Math.max(0, pageIdx | 0);
		if (pageId === pid && doc) return doc.pages[i] || null;
		const pg = STATE.heftPage(pageId, i);
		const refs = (pg?.images || []).map((im) => im.ref).filter(Boolean);
		if (refs.length) await STATE.hydrateHeftBlobs(refs);
		return pg;
	}

	async function pageAsDataUrl(pageId, pageIdx, w = 1200) {
		if (!pageId) return null;
		const pg = await previewPage(pageId, pageIdx || 0);
		if (!pg) return null;
		const imgOf = imagesFor(pageId);
		await decodeImages([pg], imgOf);
		return renderPageCanvas(pg, w, -1, imgOf).toDataURL("image/png");
	}


	return {
		// Arbeitskopie des geöffneten Hefts (sonst null): zeigt auch noch nicht Gespeichertes.
		openDoc: (p) => (p && p === pid && doc ? doc : null),
		mount, unmount, saveNow, addText, restoreDoc, pagesOf, lastPage, thumbnail, hydrateEmbeds, pageAsDataUrl, pdfBlob, exportPdf, openImportDialog,
		// Nur für test/heft.test.mjs nach außen gereicht:
		renderPageTo, pageRectForTile, strokeGeometry, scaleStrokeFrom, lassoTouchAction,
		get activeId() { return pid; },
		get activeDoc() { return doc; },
		setViewOnly(fn) { viewOnlyFn = typeof fn === "function" ? fn : null; },
		get activeIndex() { return idx; },
		isWriting: () => !!(pid && input.isWriting()),
		// Absturz-Spur im Profiler: dekodierte Bilder des offenen Hefts (liegen nicht im DOM)
		memoryStats() {
			let px = 0, n = 0;
			for (const im of Object.values(imgCache)) if (im.naturalWidth) { px += im.naturalWidth * im.naturalHeight; n++; }
			return { imageCount: n, imageMb: Math.round(px * 4 / 104857.6) / 10, heftPages: doc ? doc.pages.length : 0, heftPage: pid ? idx : -1 };
		},
	};
})();

BUS.provide("heft:is-writing", () => HEFT.isWriting());

