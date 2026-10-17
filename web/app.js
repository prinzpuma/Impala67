"use strict";
import { COLLAPSE } from "./collapse.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { CHATS } from "./chats.js";
import { DB } from "./db.js";
import { EDITOR } from "./editor.js";
import { RAG } from "./rag.js";
import { RENDER } from "./render.js";
import { HOME_ARTICLE } from "./home-article.js";
import { RENDER_ANKI } from "./render-anki.js";
import { S, STATE } from "./state.js";
import { SRS } from "./srs.js";
import { U } from "./util.js";
import { SETTINGS } from "./settings.js";
import { BACKUP } from "./backup-status.js";
import { LIBRARY } from "./library.js";
import { TABS } from "./tabs.js";
import { SEARCH } from "./search.js";
import { SHORTCUTS } from "./shortcuts.js";
import { CHAT_FULLSCREEN } from "./chat-fullscreen.js";
import { VOICE } from "./voice.js";
import { POPOVERS } from "./popovers.js";
import { AI } from "./ai.js";
import { HEFT } from "./heft.js";
import { PDFS } from "./pdfs.js";
import { PLATFORM_NATIVE } from "./platform-native.js";
import { icon } from "./icons.js";
import { wireSidebarEvents, focusRenameInput, movePageSubtreeToWorkspace } from "./app-sidebar-events.js";
import {
	closeOverlay,
	backupFromHome,
	mountFullChatVoiceButton,
	openPromptDialog,
	openMoveDialog,
	openSubjectDialog,
	duplicatePage,
	newPageFlow,
	setAnkiZen,
	resetStudyCard,
	openAnki,
	openDailyNote,
	openHistory,
	rateAndReviewCard,
	showStudyAnswer,
	gradeStudyCard,
	studySpaceOrEnter,
	startNewChat,
	createPageInNewTab,
	syncComposer,
} from "./app-dialogs.js";

export { closeOverlay };


// Kurz-Aliasse — bewusst spät gebunden ((...a) =>) wegen Modul-Zyklen.
// FIX: toter openNewTab-Alias entfernt (wurde nirgends aufgerufen)
const render = (...a) => RENDER.render(...a);
const openTemplatePicker = (...a) => RENDER.openTemplatePicker(...a);
const openPage = (...a) => TABS.openPage(...a);
const closeTab = (...a) => TABS.closeTab(...a);
const navBack = (...a) => TABS.navBack(...a);
const navForward = (...a) => TABS.navForward(...a);
const openHomeOverview = (...a) => TABS.openHomeOverview(...a);
const saveCurrentChat = (...a) => CHAT_FULLSCREEN.saveCurrentChat(...a);
const sendChatMessage = (...a) => CHAT_FULLSCREEN.sendChatMessage(...a);
const renderModelBar = (...a) => RENDER.renderModelBar(...a);
const renderModelMenu = (...a) => RENDER.renderModelMenu(...a);
const renderSidebar = (...a) => RENDER.renderSidebar(...a);
const renderMain = (...a) => RENDER.renderMain(...a);
const renderTabs = (...a) => RENDER.renderTabs(...a);
const openReview = (...a) => RENDER.openReview(...a);
const openCards = (...a) => RENDER.openCards(...a);
const openIconPicker = (...a) => RENDER.openIconPicker(...a);
const openCoverPicker = (...a) => RENDER.openCoverPicker(...a);
const localDayKey = (...a) => RENDER.localDayKey(...a);
const renderHistoryModal = (...a) => RENDER.renderHistoryModal(...a);
const ankiCardsOf = (...a) => RENDER_ANKI.ankiCardsOf(...a);
const openCardEditor = (...a) => RENDER_ANKI.openCardEditor(...a);
const renderAnki = (...a) => RENDER_ANKI.renderAnki(...a);

// app.js v2 — Init + Event-Verkabelung. KISS/DRY-Refactor, funktionsgleich.
const $ = (id) => U.el(id);
const esc = (s) => U.esc(s);
// FIX (Absturz "e.target.closest is not a function"): e.target ist NICHT immer ein
// Element. Bei Tastatur-, Fokus- und Drag-Ereignissen kann es das Dokument selbst
// oder ein Textknoten sein — dort gibt es weder closest() noch dataset. Statt 20
// Einzelabfragen gibt es genau zwei Helfer, die alle Delegations-Listener nutzen.
const closestOf = (e, sel) => { const t = e && e.target; return t && t.nodeType === 1 && t.closest ? t.closest(sel) : null; };
const dsOf = (e) => (e && e.target && e.target.dataset) || {};
const blurActive = () => document.activeElement?.blur();
const closeTopMenu = () => { if (S.topMenu) { S.topMenu = null; renderMain(); } };
const focusPageTitle = () => {
	if (PLATFORM.isTouch()) return;
	const ti = $("pageTitle");
	if (ti) {
		ti.focus();
		ti.select();
	}
};



// 🃏-Bereich öffnen — läuft seit 23. Juli als eigener Tab "anki:main" über TABS.openPage
// (gleiche Mechanik wie nlm:main): view/sidebarMode, Tab-Leiste, Verlauf und Render
// kommen von dort — die Sonderbehandlung hier entfällt (KISS).
// == 🖐️ EINE Definition von „Touch“ und „Handy“ (28. Juli) ==
// Vorher fragten vier Stellen unterschiedlich: max-width 700px, max-width 768px,
// (pointer: coarse), (hover: none). iPadOS meldet im Desktop-Modus hover:hover/pointer:fine —
// das iPad galt je nach Stelle mal als Handy, mal als Maus-Gerät. Quelle der Wahrheit sind
// jetzt diese zwei Abfragen; das CSS liest das Ergebnis als body.is-touch / body.is-phone.
const MQ_PHONE = matchMedia("(max-width: 700px), (pointer: coarse) and (max-height: 500px)");
const MQ_TOUCH = matchMedia("(pointer: coarse), (hover: none)");
const PLATFORM = {
	phoneQuery: MQ_PHONE,
	isPhone: () => MQ_PHONE.matches,
	isTouch: () => MQ_TOUCH.matches || navigator.maxTouchPoints > 1,
	isIOS: () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1),
	isStandalone: () => !!(window.navigator.standalone || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)),
	sync() {
		document.body.classList.toggle("is-touch", PLATFORM.isTouch());
		document.body.classList.toggle("is-phone", PLATFORM.isPhone());
		document.body.classList.toggle("is-ios", PLATFORM.isIOS());
		document.body.classList.toggle("is-standalone", PLATFORM.isStandalone());
		document.body.classList.toggle("is-native", PLATFORM_NATIVE.isNative);
	},
};
for (const q of [MQ_PHONE, MQ_TOUCH]) q.addEventListener("change", PLATFORM.sync);
PLATFORM.sync();
PLATFORM.native = PLATFORM_NATIVE;
window.PLATFORM = PLATFORM;

async function checkIncomingShare() {
	if (!PLATFORM_NATIVE.sendIntent.isAvailable) return;
	if (typeof DB === "undefined" || !DB.isOpen?.()) return;
	try {
		const shared = await PLATFORM_NATIVE.sendIntent.checkIncoming();
		if (!shared) return;

		const type = String(shared.type || "").toLowerCase();
		const items = [shared.url, ...(shared.additionalItems || [])].filter(Boolean);

		// 1. PDF-Dateien geteilt
		const isPdf = type.includes("pdf") || items.some((uri) => String(uri).toLowerCase().endsWith(".pdf"));
		if (isPdf && items.length > 0 && typeof PDFS !== "undefined" && typeof PDFS.ingest === "function") {
			try {
				const uri = items[0];
				const fileSrc = (window.Capacitor && typeof window.Capacitor.convertFileSrc === "function")
					? window.Capacitor.convertFileSrc(uri)
					: uri;
				const resp = await fetch(fileSrc);
				const blob = await resp.blob();
				const file = new File([blob], shared.title || "Geteiltes Dokument.pdf", { type: "application/pdf" });
				await PDFS.ingest(file, (msg) => U.toast(msg, "info"));
				U.toast("PDF erfolgreich geteilt & importiert!", "success");
				return;
			} catch (pdfErr) {
				console.warn("[app] Geteiltes PDF konnte nicht importiert werden:", pdfErr);
			}
		}

		// 2. Bilder geteilt
		const isImage = type.includes("image") || items.some((uri) => /\.(png|jpe?g|webp|gif)$/i.test(String(uri)));
		if (isImage && items.length > 0) {
			try {
				const id = U.uid();
				const title = shared.title || "Geteiltes Bild";
				let mdContent = "";
				for (const uri of items) {
					const fileSrc = (window.Capacitor && typeof window.Capacitor.convertFileSrc === "function")
						? window.Capacitor.convertFileSrc(uri)
						: uri;
					const resp = await fetch(fileSrc);
					const blob = await resp.blob();
					const blobId = U.uid();
					await DB.putBlob(blobId, await U.readAsBuffer(blob), { name: "image.png", size: blob.size, type: blob.type || "image/png" });
					mdContent += `![${title}](blob:${blobId})\n\n`;
				}
				if (shared.text && shared.text !== title) {
					mdContent += shared.text + "\n\n";
				}
				await STATE.dispatch("pageCreate", { id, title, content: mdContent, parentId: null });
				openPage(id);
				U.toast("Bild(er) mit Impala67 geteilt", "success");
				return;
			} catch (imgErr) {
				console.warn("[app] Geteilte Bilder konnten nicht importiert werden:", imgErr);
			}
		}

		// 3. Text oder Link geteilt
		let text = shared.text || "";
		const url = shared.url || "";
		if (url && !text.includes(url)) {
			text = text ? `${text}\n\n${url}` : url;
		}
		if (text || shared.title) {
			let title = shared.title;
			if (!title && url) {
				try { title = new URL(url).hostname; } catch { title = "Geteilter Link"; }
			}
			title = title || "Geteilte Notiz";
			const id = U.uid();
			await STATE.dispatch("pageCreate", { id, title, content: text, parentId: null });
			openPage(id);
			U.toast("Geteilt mit Impala67: " + title, "success");
		}
	} catch (err) {
		console.warn("[app] Geteilte Daten konnten nicht verarbeitet werden:", err);
	}
}

let lifecycleInited = false;
function initPlatformLifecycle() {
	if (lifecycleInited) return;
	lifecycleInited = true;

	PLATFORM_NATIVE.notifications.onActionPerformed?.(() => {
		try {
			if (typeof openAnki === "function") openAnki();
		} catch (err) {
			console.warn("[app] Fehler beim Öffnen des Lernmodus aus Benachrichtigung:", err);
		}
	});

	PLATFORM_NATIVE.lifecycle.init({
		onStateChange: (isActive) => {
			if (isActive) {
				checkIncomingShare();
			} else {
				document.activeElement?.blur?.();
				try {
					const snap = STATE.studySnapshot?.(null);
					const due = (snap?.counts?.neu || 0) + (snap?.counts?.learn || 0) + (snap?.counts?.review || 0);
					if (due > 0) PLATFORM_NATIVE.notifications.scheduleSRSReview(due);
				} catch (e) { PERF_PROFILER.error("srs-reminder-error", e); }
			}
		},
		onBackButton: () => {
			const scanClose = document.querySelector(".heft-scan [data-hescanclose]");
			if (scanClose) {
				scanClose.click();
				return;
			}
			const overlay = document.getElementById("overlay");
			if (overlay && !overlay.hidden) {
				closeOverlay();
				return;
			}
			const palette = document.getElementById("palette");
			if (palette && !palette.hidden) {
				palette.hidden = true;
				return;
			}
			if (document.body.classList.contains("mnav-open") || document.body.classList.contains("mmore-open")) {
				document.body.classList.remove("mnav-open", "mmore-open");
				return;
			}
			if (TABS.canGoBack()) {
				TABS.navBack();
				return;
			}
			try { window.Capacitor?.Plugins?.App?.minimizeApp?.(); } catch { /* ignore */ }
		},
	});
}



// Darstellungs-Buttons → handleAppearanceSelect(gruppe, wert) — statt 14 case-Zeilen
const APPEARANCE_BTN = {
	btnDensityComfortable: ["density", "comfortable"], btnDensityCompact: ["density", "compact"],
	btnTabsTop: ["tabspos", "top"], btnTabsSidebar: ["tabspos", "sidebar"],
	btnFontS: ["fontsize", "s"], btnFontM: ["fontsize", "m"], btnFontL: ["fontsize", "l"],
	btnLockOn: ["overlearn", "on"], btnLockOff: ["overlearn", "off"],
	btnConfOn: ["confidence", "on"], btnConfOff: ["confidence", "off"],
	btnTeleOn: ["telemetry", "on"], btnTeleOff: ["telemetry", "off"],
};

function wireEvents() {
	initPlatformLifecycle();
	// dispatch() rendert bereits rAF-gebündelt → nach dispatch kein extra render();
	// reine UI-Navigation ohne dispatch rendert sofort.
	// „＋ Neue Zeile“ in der Datenbank-Ansicht — wird beim nächsten Sync als echte Notion-Zeile angelegt
	document.addEventListener("click", async (e) => {
		const btn = closestOf(e, "[data-dbnewrow]");
		if (!btn) return;
		const dbPg = S.pages[btn.dataset.dbnewrow];
		if (!dbPg) return;
		await STATE.dispatch("pageCreate", { id: U.uid(), title: "Neue Zeile", parentId: dbPg.id, workspaceId: dbPg.workspaceId || "default", props: {} });
	});

	// Links auf lokale Seiten abfangen (importierte UUIDs mit ODER ohne Bindestriche).
	// FIX „Seite springt nach oben“ (Teil 1): tote/leere #-Anker (href="#" oder
	// unbekannte IDs) lösten bisher die Browser-Hash-Navigation aus — und die
	// scrollt das Dokument an den Anfang. Interne Anker ohne echtes Ziel werden
	// deshalb IMMER abgefangen, nicht nur bekannte Seiten-IDs.
	document.addEventListener("click", (e) => {
		const a = closestOf(e, "a");
		if (!a) return;
		const href = a.getAttribute("href") || "";
		const rawId = href.replace(/^(#|\/)/, "");
		const id = S.pages[rawId] ? rawId : rawId.replace(/-/g, "");
		if (S.pages[id]) {
			e.preventDefault();
			openPage(id);
		} else if (href.startsWith("#")) {
			e.preventDefault();
		}
	});

	// Home: Einzelklick = Dateibaum, Doppelklick = Home-Übersicht
	document.addEventListener("dblclick", (e) => {
		if (!closestOf(e, "#btnHome")) return;
		e.preventDefault();
		openHomeOverview();
	});

	// ＋ Neu-Menü der Karteikarten-Kopfzeile (render-anki.js, <details class="anki-new">):
	// Auf-/Zuklappen macht der Browser nativ — hier nur schließen bei Außenklick oder
	// nach einer gewählten Menü-Aktion (Neue Karte / Neuer Stapel / Import / Export).
	document.addEventListener("click", (e) => {
		if (!(e.target instanceof Element)) return;
		document.querySelectorAll("details.anki-new[open]").forEach((d) => {
			if (!d.contains(e.target) || e.target.closest(".anki-new-menu")) d.removeAttribute("open");
		});
	});

	// FIX: Live-„Denkt nach…“-Box auf pointerdown — Rebuilds zwischen Mousedown/-up
	// fraßen den click (render.js patcht zusätzlich in-place, das hier ist das Netz)
	document.addEventListener("pointerdown", (e) => {
		if (e.button !== undefined && e.button !== 0) return;
		const t = closestOf(e, "#btnThinkLive");
		if (!t) return;
		e.preventDefault();
		CHAT_FULLSCREEN.handleReasoningToggle(t);
	});

	// Mittelklick (auxclick mit e.button === 1): Seite in neuem Tab öffnen bzw. Tab schließen
	document.addEventListener("auxclick", (e) => {
		if (e.button !== 1) return;
		const row = closestOf(e, "[data-page]");
		if (row && row.dataset.page) {
			e.preventDefault();
			openPage(row.dataset.page, { newTab: true });
			return;
		}
		const tab = closestOf(e, "[data-tabopen]");
		if (tab && tab.dataset.tabopen) {
			e.preventDefault();
			closeTab(tab.dataset.tabopen);
			return;
		}
	});

	// Klicks (Delegation) — alle interaktiven Elemente sind explizit gelistet,
	// damit sie unabhängig vom Tag (button/span) zuverlässig ausgelöst werden.
	const CLICKABLE = "[data-page],[data-grade],[data-set],[data-chat],[data-sidechat],[data-newchat],[data-newpage]," +
		"[data-collapse],[data-crumbws],[data-tabopen],[data-tabclose],[data-tabnew],[data-undo],[data-difftoggle]," +
		"[data-reasoningtoggle],[data-iconset],[data-coverset],[data-coverpick],[data-coverremove]," +
		"[data-iconpick],[data-filedownload],[data-modelset],[data-chatdel],[data-chatsel],[data-chatselall],[data-chatselnone],[data-chatdelsel],[data-editmsg]," +
		"[data-answerq],[data-refinetoggle],[data-refine],[data-inserttoggle],[data-insertmark],[data-libview]," +
		"[data-libws],[data-libinto],[data-libroot]," +
		"[data-ankitab],[data-ankistudy],[data-ankigrade],[data-ankishowback],[data-ankiwaitrefresh],[data-ankisort],[data-ankimore],[data-ankideckfilter],[data-ankizen]," +
		"[data-ankisuspend],[data-ankiarchive],[data-ankiunarchive],[data-ankidel],[data-ankiedit],[data-ankinewcard],[data-cardeditorsave]," +
		"[data-dailyday],[data-dailynav],[data-zipws]," +
		"[data-deckopen],[data-decknew],[data-decksub],[data-deckrename],[data-deckdel],[data-deckarchive],[data-deckunarchive],[data-deckmenu],[data-deckduplicate],[data-libnew]," +
		"[data-pagemenu],[data-pageopennew],[data-pagerename],[data-pageduplicate],[data-pagearchive],[data-pageunarchive],[data-pagetrash],[data-pagerestore],[data-pagepurge],[data-cardrestore],[data-cardpurge],[data-deckrestore],[data-deckpurge]," +
		"[data-pagetemplate],[data-tplblank],[data-tplheft],[data-tpluse],[data-libsort],[data-histversion],[data-renamename],[data-deckrenamename]," +
		"[data-conflictopen],[data-conflictnav],[data-conflictresolve],[data-conflictpage],button";

	document.addEventListener("click", async (e) => {
		// Stapel-⋯ ZUERST, sonst zerstört closeOutside das Menü im selben Klick
		const deckMenuBtn = closestOf(e, "[data-deckmenu]");
		if (deckMenuBtn) {
			e.preventDefault();
			e.stopPropagation();
			const name = deckMenuBtn.dataset.deckmenu;
			const open = S.deckMenuOpenName !== name;
			S.pageMenuOpenId = null;
			S.topMenu = null;
			S.modelMenuOpen = false;
			S.deckMenuOpenName = open ? name : null;
			renderSidebar(); // positioniert offenes Menü in render.js
			if (S.view === "anki") renderMain();
			return;
		}
		const deckAction = closestOf(e, "[data-deckdel],[data-deckrename],[data-deckduplicate],[data-deckarchive]");
		if (deckAction) {
			e.preventDefault();
			e.stopPropagation();
			const name = deckAction.dataset.deckdel || deckAction.dataset.deckrename || deckAction.dataset.deckduplicate || deckAction.dataset.deckarchive;
			S.deckMenuOpenName = null;
			renderSidebar();
			if (S.view === "anki") renderMain();
			if (deckAction.hasAttribute("data-deckrename")) {
				if (PLATFORM.isTouch()) {
					openPromptDialog("Stapel umbenennen", async (newName) => {
						const trimmed = newName.trim();
						if (trimmed && trimmed !== name) {
							await STATE.dispatch("deckRename", { oldName: name, newName: trimmed });
						}
					}, name);
					return;
				}
				S.renamingDeck = name;
				renderSidebar();
				const inp = document.querySelector('[data-deckrenamename="' + CSS.escape(name) + '"]');
				if (inp) focusRenameInput(inp);
				return;
			}
			if (deckAction.hasAttribute("data-deckduplicate")) {
				await STATE.dispatch("deckDuplicate", { name });
				return;
			}
			if (deckAction.hasAttribute("data-deckarchive")) {
				await STATE.dispatch("deckArchive", { name });
				if (S.ankiDeck && STATE.deckInTree(S.ankiDeck, name)) S.ankiDeck = null;
				resetStudyCard();
				U.toast("Stapel archiviert.", "success");
				return;
			}
			// data-deckdel
			const n = ankiCardsOf(name).length;
			const msg = 'Stapel „' + name + '“ in den Papierkorb legen?' +
				(n ? " " + n + " Karte(n) (inkl. Unterstapel) wandern mit und sind wiederherstellbar." : "");
			if (await U.confirm(msg, { title: "Stapel löschen", ok: "In Papierkorb", danger: true })) {
				await STATE.dispatch("deckTrash", { name });
				if (S.ankiDeck && STATE.deckInTree(S.ankiDeck, name)) S.ankiDeck = null;
				U.toast("Stapel im Papierkorb.", "success");
			} else {
				render();
			}
			return;
		}

		// Topbar-Menüs (Teilen/⋯) VOR closeOutside; blurActive nötig, weil renderMain
		// bei geschütztem Fokus (Editor/Titel) sonst nie neu zeichnet
		const topMenuBtn = closestOf(e, "[data-sharemenu],[data-morepagemenu]");
		if (topMenuBtn) {
			e.preventDefault();
			e.stopPropagation();
			const which = topMenuBtn.hasAttribute("data-sharemenu") ? "share" : "more";
			const open = S.topMenu !== which;
			const changed = POPOVERS.closeAll("top");
			POPOVERS.blurActive();
			S.topMenu = open ? which : null;
			if (changed.sidebar) renderSidebar();
			renderMain();
			return;
		}

		const t = closestOf(e, CLICKABLE);
		// Eine Außenklick-Logik für alle Popovers (Anhang, Modell, Seite, Stapel, Topbar).
		const closedPopovers = POPOVERS.closeOutside(e.target);
		if (closedPopovers.model) renderModelMenu();
		if (closedPopovers.sidebar) renderSidebar();
		if (closedPopovers.main) renderMain();
		if (!t) return;

		// Darstellung: dieselben zentralen Optionen steuern alle Komponenten über CSS-Tokens.
		if (t.dataset.accent) { SETTINGS.handleAppearanceSelect("accent", t.dataset.accent); return; }
		if (t.dataset.removeattachment) { CHAT_FULLSCREEN.handleRemoveAttachment(); return; }
		// Seitenkontext abwählen — wie ein Anhang entfernen, gilt nur für die aktuelle Seite
		if (t.dataset.removecontext) { S.sideContextOff = S.currentPageId; RENDER.renderChat(); return; }
		if (t.id === "btnVoice") { VOICE.toggle("side"); return; }
		if (t.id === "btnVoiceFull") { VOICE.toggle("full"); return; }

		// Chat umbenennen (Sidebar-Chatliste) — gleicher Dialog wie bei Stapeln
		if (t.dataset.chatrename) {
			const list = CHATS.load();
			const s = list.find((x) => x.id === t.dataset.chatrename);
			if (!s) return;
			openPromptDialog("Chat umbenennen", (name) => {
				s.title = name;
				CHATS.save(list);
				render();
			}, s.title || "");
			return;
		}
		// Schnellstart-Chip im leeren Chat: Prompt-Anfang einsetzen, Cursor ans Ende
		if (t.dataset.chatsuggest) {
			const inp = $("mainChatInput") || $("chatInput");
			if (inp) { inp.value = t.dataset.chatsuggest; inp.focus(); inp.dispatchEvent(new Event("input", { bubbles: true })); }
			return;
		}
		// Codeblock kopieren (Knopf wird in U.highlightCode eingefügt)
		const copyBtn = t.dataset.codecopy ? t : t.closest("[data-codecopy]");
		if (copyBtn) {
			const pre = copyBtn.closest("pre");
			const code = pre && pre.querySelector("code");
			if (code) {
				const text = code.innerText.replace(/\s*$/, "\n");
				navigator.clipboard.writeText(text).then(() => {
					copyBtn.classList.add("copied");
					const prevHtml = copyBtn.innerHTML;
					copyBtn.innerHTML = icon("check", "i-strong");
					setTimeout(() => {
						copyBtn.classList.remove("copied");
						copyBtn.innerHTML = prevHtml;
					}, 1600);
					U.toast("Code kopiert.", "success");
				}, () => U.toast("Zwischenablage blockiert.", "error"));
			}
			return;
		}
		// KI-Antwort in die Zwischenablage kopieren
		if (t.dataset.copymsg) {
			const m = S.chat.find((x) => x.mid === t.dataset.copymsg) || S.sideChat.find((x) => x.mid === t.dataset.copymsg);
			if (m) navigator.clipboard.writeText(m.content || "").then(
				() => U.toast("Antwort kopiert.", "success"),
				() => U.toast("Zwischenablage blockiert.", "error"));
			return;
		}
		// Review-Overlay: Karte aussetzen und direkt mit der nächsten fälligen weitermachen
		if (t.dataset.reviewsuspend) {
			await STATE.dispatch("cardUpdate", { id: t.dataset.reviewsuspend, patch: { suspended: true } });
			S.reviewShowBack = false;
			openReview();
			return;
		}
		// Bibliothek: Smart-Sammlungen (Alle/Favoriten/PDFs/Vorlagen/ohne Tag)
		if (t.dataset.libsmart) {
			const v = t.dataset.libsmart;
			S.libSmart = v === "all" || S.libSmart === v ? null : v;
			renderMain();
			return;
		}

		// Sync-Konflikt-Dialog (Popup + Homescreen-Banner/Widget)
		if (t.dataset.conflictopen != null) {
			RENDER.openConflictResolver(t.dataset.conflictopen);
			return;
		}
		if (t.dataset.conflictnav) {
			const cur = S.conflictResolveIndex || 0;
			RENDER.openConflictResolver(cur + Number(t.dataset.conflictnav));
			return;
		}
		if (t.dataset.conflictresolve) {
			await RENDER.resolveConflict(t.dataset.conflictresolve);
			return;
		}
		if (t.dataset.conflictpage) {
			closeOverlay();
			openPage(t.dataset.conflictpage);
			return;
		}

		// Schnellaktionen des Home-Dashboards
		if (t.dataset.homeaction) {
			switch (t.dataset.homeaction) {
				case "search": SEARCH.openPalette(); break;
				case "newpage": await newPageFlow(S.currentWorkspaceId || Object.keys(S.workspaces)[0] || "default", null); break;
				case "newchat": startNewChat(); break;
				case "chats": S.sidebarMode = "chats"; render(); break;
				case "library": S.view = "library"; S.libFolder = null; render(); break;
				case "cards": openAnki("study", null); break;
				case "daily": await openDailyNote(localDayKey(new Date())); break;
				case "backup": await SETTINGS.handleBackupNow(); break;
				case "backup-now": await backupFromHome(t); break;
				case "backup-setup": SETTINGS.openSettings("sync"); break;
				case "backup-later": BACKUP.snooze(); break;
				case "conflicts": RENDER.openConflictResolver(0); break;
				case "article-read": HOME_ARTICLE.markRead(); break;
				case "article-history": HOME_ARTICLE.openHistory(); break;
				case "article-retry": HOME_ARTICLE.retry(); break;
			}
			return;
		}

		// Ein-/Ausklappen — erst nach Persistenz zeichnen (kein Aufblitzen des Defaults)
		if (t.dataset.collapse) {
			const key = t.dataset.collapse;
			await COLLAPSE.toggle(key);
			if (S.view === "library") renderMain();
			else if (S.view === "anki" && key.startsWith("deck:")) render();
			else renderSidebar();
			return;
		}

		// Icon-/Cover-Auswahl (auch aus dem Topbar-⋯-Menü erreichbar — Menü vorher schließen,
		// sonst bleibt es hinter dem Auswahl-Dialog offen)
		if (t.dataset.iconpick) { closeTopMenu(); openIconPicker(); return; }
		if (t.dataset.coverpick) { closeTopMenu(); openCoverPicker(); return; }
		if (t.dataset.coverremove) {
			if (S.currentPageId) await STATE.dispatch("pageUpdate", { id: S.currentPageId, patch: { cover: null, coverImg: null } });
			return;
		}
		if (t.hasAttribute("data-iconset")) {
			if (S.currentPageId) await STATE.dispatch("pageUpdate", { id: S.currentPageId, patch: { icon: t.dataset.iconset || null } });
			closeOverlay();
			return;
		}
		if (t.hasAttribute("data-coverset")) {
			if (S.currentPageId) await STATE.dispatch("pageUpdate", { id: S.currentPageId, patch: { cover: t.dataset.coverset || null, coverImg: null } });
			closeOverlay();
			return;
		}

		// Breadcrumb: Workspace-Segment öffnet Home für diesen Workspace
		if (t.dataset.crumbws) {
			const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
			if (pg) S.currentWorkspaceId = pg.workspaceId || "default";
			openHomeOverview();
			return;
		}

		// Tab-Leiste: Tab öffnen / schließen / neuer Tab (Notion-artig: + = neuer Tab)
		if (t.dataset.tabopen) { openPage(t.dataset.tabopen, { replaceHistory: true }); return; }
		if (t.dataset.tabclose) { closeTab(t.dataset.tabclose); return; }
		if (t.dataset.tabnew != null || t.id === "btnTabNew") {
			// Plus: Notion-artiges Menü „In neuem Tab öffnen…“ (Suche + Neue Seite / Chat)
			SEARCH.openNewTabMenu();
			return;
		}

		// Thinking-Prozess (finalisiert) ausklappen. Die LIVE-Box läuft über den
		// pointerdown-Listener oben — hier nur abfangen, damit nichts doppelt feuert.
		if (t.id === "btnThinkLive") return;
		if (t.dataset.reasoningtoggle) {
			CHAT_FULLSCREEN.handleReasoningToggle(t);
			return;
		}

		// Edit-Karte: Diff ein-/ausblenden, Rückgängig machen
		if (t.dataset.difftoggle) {
			CHAT_FULLSCREEN.handleDiffCardToggle(t);
			return;
		}
		if (t.dataset.undo) {
			await CHAT_FULLSCREEN.handleUndo(t);
			return;
		}

		// Datei-Chip im Chat: geklebten Text als .txt herunterladen
		if (t.dataset.filedownload) {
			CHAT_FULLSCREEN.handleFileDownload(t);
			return;
		}

		// Modell-Menü: Notion-artige Untermenüs für Modell und Thinking-Stufe.
		if (t.dataset.modelsubmenu) {
			S.modelMenuSection = t.dataset.modelsubmenu;
			renderModelMenu();
			if (S.modelMenuSection === "thinking") {
				AI.detectThinkingCapabilities().then(renderModelMenu, renderModelMenu);
			}
			return;
		}
		if (t.dataset.thinkingprobe) {
			const store = S.thinkingCapabilities || {};
			const pr = (S.settings.aiProviders || []).find((item) => item.id === S.settings.aiProviderId);
			const key = [S.settings.aiProviderId || "", String((pr && pr.base) || "").replace(/\/+$/, ""), S.settings.aiModel || ""].join("::");
			delete store[key];
			S.thinkingCapabilities = store;
			renderModelMenu();
			AI.detectThinkingCapabilities().then(renderModelMenu, renderModelMenu);
			return;
		}
		if (t.dataset.modelmenuback) {
			S.modelMenuSection = "root";
			renderModelMenu();
			return;
		}
		if (t.dataset.thinkingenabled !== undefined) {
			await STATE.dispatch("settingsSet", { thinkingEnabled: t.dataset.thinkingenabled === "1" });
			S.modelMenuSection = "root";
			renderModelMenu();
			return;
		}

		// Modell wählen (Chat-Dropdown ODER Einstellungen → KI) — Wert "quelleId::modell"
		if (t.dataset.modelset) {
			const raw = t.dataset.modelset;
			const sep = raw.indexOf("::");
			const providerId = sep === -1 ? S.settings.aiProviderId : raw.slice(0, sep);
			const model = sep === -1 ? raw : raw.slice(sep + 2);
			await STATE.dispatch("settingsSet", { aiProviderId: providerId, aiModel: model });
			S.modelMenuOpen = false;
			renderModelBar();
			// Auswahl in offenen KI-Einstellungen sofort als aktiv markieren
			if (typeof SETTINGS.paintSettingsModels === "function") SETTINGS.paintSettingsModels();
			// Jede Auswahl startet die modellbezogene Probe sofort. Das Thinking-
			// Menü zeigt später ausschließlich die bestätigten Stufen dieses Modells.
			AI.detectThinkingCapabilities().then(renderModelBar, renderModelBar);
			SETTINGS.checkAI();
			return;
		}

		// Verbindung EINER Quelle testen (Einstellungen → KI) — nutzt die aktuellen Feldwerte
		if (t.dataset.provtest) {
			await SETTINGS.handleProviderTest(t);
			return;
		}
		// Vorgeschlagene Server-URL übernehmen (z. B. fehlendes /v1) und direkt erneut testen
		if (t.dataset.provfixbase) {
			const row = document.querySelector('[data-provrow="' + t.dataset.provfixbase + '"]');
			const baseInput = row && row.querySelector("[data-provbase]");
			if (baseInput) baseInput.value = t.dataset.base || "";
			await SETTINGS.testProviderRow(t.dataset.provfixbase);
			return;
		}

		// Quelle entfernen (Einstellungen → KI)
		if (t.dataset.provdel) {
			// FIX: erst die aktuellen (ungespeicherten) Feldwerte ALLER Zeilen einsammeln —
			// vorher verwarf das Löschen einer Quelle die offenen Eingaben der anderen.
			const rows = Array.from(document.querySelectorAll("[data-provrow]"));
			const fromDom = rows.map((row) => {
				const val = (sel) => { const el = row.querySelector(sel); return el ? el.value.trim() : ""; };
				return { id: row.dataset.provrow, name: val("[data-provname]") || row.dataset.provrow, base: val("[data-provbase]"), key: val("[data-provkey]") };
			});
			const providers = (fromDom.length ? fromDom : (S.settings.aiProviders || [])).filter((p) => p.id !== t.dataset.provdel);
			const patch = { aiProviders: providers };
			// FIX: war die gelöschte Quelle im Chat aktiv, zeigten aiProviderId/aiModel ins Leere
			// (z. B. aktive Quelle „google" + Modell „local-model" → garantiert keine Verbindung).
			if (S.settings.aiProviderId === t.dataset.provdel) {
				patch.aiProviderId = providers[0] ? providers[0].id : "";
				patch.aiModel = "";
			}
			// FIX: dito für die Embedding-Quelle — zurück auf „automatisch".
			if (S.settings.embedProviderId === t.dataset.provdel) patch.embedProviderId = "";
			RENDER.removeProviderFavorites(t.dataset.provdel);
			await STATE.dispatch("settingsSet", patch);
			SETTINGS.openSettings("ai");
			return;
		}

		// Quelle für ein eigenes Modell wählen (Chips im Modell-Dropdown) — Eingabe bleibt erhalten
		if (t.dataset.customprov) {
			const keep = ($("customModelInput") || {}).value || "";
			S.customModelProviderPick = t.dataset.customprov;
			renderModelMenu();
			const inp2 = $("customModelInput");
			if (inp2) { inp2.value = keep; inp2.focus(); }
			return;
		}

		// Eigenes Modell für die gewählte Quelle setzen (unten im Modell-Dropdown)
		if (t.dataset.modelcustomapply) {
			const inp = $("customModelInput");
			const providerId = S.customModelProviderPick || S.settings.aiProviderId;
			const model = inp ? inp.value.trim() : "";
			if (model) {
				await STATE.dispatch("settingsSet", { aiProviderId: providerId, aiModel: model });
				S.modelMenuOpen = false;
				renderModelBar();
				AI.detectThinkingCapabilities().then(renderModelBar, renderModelBar);
				SETTINGS.checkAI();
			}
			return;
		}

		// Chat-Mehrfachauswahl (Kästchen je Zeile + Kopfzeile der Chat-Liste)
		if (t.dataset.chatsel) { CHAT_FULLSCREEN.handleChatSelectToggle(t); return; }
		if (t.dataset.chatselall) { CHAT_FULLSCREEN.handleChatSelectAll(); return; }
		if (t.dataset.chatselnone) { CHAT_FULLSCREEN.handleChatSelectNone(); return; }
		if (t.dataset.chatdelsel) { await CHAT_FULLSCREEN.handleDeleteSelectedChats(); return; }

		// KI-Chat aus der Liste löschen
		if (t.dataset.chatdel) {
			await CHAT_FULLSCREEN.handleDeleteChat(t);
			return;
		}

		// Nutzer-Nachricht nachträglich bearbeiten
		if (t.dataset.editmsg) {
			CHAT_FULLSCREEN.handleEditUserMessage(t);
			return;
		}

		// Rückfrage-Karte: Option anklicken löst den wartenden Agent-Loop auf
		if (t.dataset.answerq) {
			CHAT_FULLSCREEN.handleAnswerQuestion(t);
			return;
		}

		// KI-Status-Pille im Chat-Header / Settings: erneut pingen; Offline → Einstellungen
		if (t.dataset.aistatus || t.id === "btnRecheckAI") {
			SETTINGS.checkAI();
			if (t.dataset.aistatus && S.aiOnline === false) SETTINGS.openSettings("ki");
			return;
		}

		// "✦ Anpassen"-Menü (länger/kürzer) an einer KI-Antwort ein-/ausblenden
		if (t.dataset.refinetoggle) {
			CHAT_FULLSCREEN.handleRefineToggle(t);
			return;
		}
		if (t.dataset.refine) {
			await CHAT_FULLSCREEN.handleRefineSelect(t);
			return;
		}

		// Bibliothek: Kachel-/Tabellen-Ansicht umschalten
		if (t.dataset.libview) {
			LIBRARY.handleLibView(t.dataset.libview);
			return;
		}

		// Bibliothek (Kacheln): Ordner-Navigation (Wurzel, Workspace, in Unterseiten)
		if (t.dataset.libroot || t.dataset.libws || t.dataset.libinto) {
			LIBRARY.handleLibFolderNavigation(t);
			return;
		}

		// Bibliothek: „＋ Neue Seite“-Kachel legt die Seite direkt im aktuellen Ordner an
		if (t.dataset.libnew) {
			await LIBRARY.handleLibNewPage();
			return;
		}

		// Bibliothek: Spaltenüberschrift klicken = sortieren (erneut klicken = Richtung wechseln)
		if (t.dataset.libsort) {
			LIBRARY.handleLibSort(t.dataset.libsort);
			return;
		}

		// ---------- Anki-Bereich: Tabs, Lernen, Bewerten, Sortieren, Karten-Verwaltung ----------
		// ⛶ Vollbild (23. Juli): Body-Klasse blendet Seitenleiste + Tab-Leiste aus — rein per
		// CSS auf die sichtbare Anki-Ansicht begrenzt (styles.css, :has), erneut klicken = zurück.
		if (t.dataset.ankizen) { setAnkiZen(!S.ankiZen); return; }
		if (t.dataset.ankitab) { S.ankiTab = t.dataset.ankitab; resetStudyCard(); renderMain(); return; }
		if (t.hasAttribute("data-ankistudy")) {
			S.ankiDeck = t.dataset.ankistudy || null;
			// Interleaved Practice: nur der „Gemischt lernen“-Button aktiviert den Misch-Modus
			S.ankiMix = t.hasAttribute("data-ankimix");
			// 🧑‍🏫 Feynman-Modus als eigene Lern-Option aus der Stapel-Übersicht
			S.ankiFeyn = t.hasAttribute("data-ankifeyn");
			S.ankiTab = "study";
			resetStudyCard();
			// Home v4: der Stapel-Überblick startet das Lernen direkt von der Homeseite —
			// dafür ggf. in die Anki-Ansicht wechseln (seit 23. Juli als eigener Tab anki:main).
			if (S.view !== "anki") openPage("anki:main");
			else renderMain();
			return;
		}
		// DRY: Klick auf „Antwort zeigen“ nutzt denselben Aufdeck-Pfad wie die
		// Leertaste — inkl. Festpinnen der sichtbaren Karte (Bug-Fix, s. oben).
		if (t.dataset.ankishowback) { showStudyAnswer(t.dataset.card); return; }
		if (t.dataset.ankiwaitrefresh) { resetStudyCard(); renderMain(); return; }
		if (t.dataset.ankigrade) {
			PLATFORM_NATIVE.haptics.light();
			await rateAndReviewCard(t.dataset.card, Number(t.dataset.ankigrade), t.dataset.reviewId);
			resetStudyCard();
			return;
		}
		if (t.dataset.ankimore) {
			S.ankiBrowserLimit = (S.ankiBrowserLimit || 200) + 500;
			renderMain();
			return;
		}
		if (t.dataset.ankisort) {
			if (S.ankiSort === t.dataset.ankisort) S.ankiSortDir = -(S.ankiSortDir || 1);
			else { S.ankiSort = t.dataset.ankisort; S.ankiSortDir = 1; }
			renderMain();
			return;
		}
		if (t.hasAttribute("data-ankideckfilter")) {
			S.ankiDeck = t.dataset.ankideckfilter || null;
			S.ankiTab = "browser";
			renderMain();
			return;
		}
		if (t.dataset.ankisuspend) {
			const c = S.cards[t.dataset.ankisuspend];
			if (c && c.id === S.reviewCardId) resetStudyCard();
			if (c) await STATE.dispatch("cardUpdate", { id: c.id, patch: { suspended: !c.suspended } });
			return;
		}
		if (t.dataset.ankiarchive) {
			if (t.dataset.ankiarchive === S.reviewCardId) resetStudyCard();
			await STATE.dispatch("cardArchive", { id: t.dataset.ankiarchive });
			U.toast("Karte archiviert.", "success");
			return;
		}
		if (t.dataset.ankiunarchive) {
			await STATE.dispatch("cardUnarchive", { id: t.dataset.ankiunarchive });
			U.toast("Karte wiederhergestellt.", "success");
			return;
		}
		if (t.dataset.deckunarchive) {
			await STATE.dispatch("deckUnarchive", { name: t.dataset.deckunarchive });
			U.toast("Stapel wiederhergestellt.", "success");
			return;
		}
		if (t.dataset.ankidel) {
			// Soft-Delete → Papierkorb (wiederherstellbar)
			if (await U.confirm("Diese Karte in den Papierkorb legen?", { title: "Karte löschen", ok: "In Papierkorb", danger: true })) {
				await STATE.dispatch("cardTrash", { id: t.dataset.ankidel });
				U.toast("Karte im Papierkorb.", "success");
			}
			return;
		}
		if (t.dataset.ankiedit) { openCardEditor(t.dataset.ankiedit); return; }
		if (t.dataset.ankinewcard) { openCardEditor(null); return; }
		if (t.dataset.cardeditorsave) {
			const front = ($("cardFront") || {}).value || "";
			const back = ($("cardBack") || {}).value || "";
			// Stapel aus Select bzw. „Neuer Stapel“-Feld (kein freies datalist mehr)
			const deck = (RENDER_ANKI.readCardEditorDeck && RENDER_ANKI.readCardEditorDeck()) || "Standard";
			if (!front.trim()) { U.toast("Die Vorderseite darf nicht leer sein.", "error"); return; }
			if (deck === "__new__" || !String(deck).trim()) { U.toast("Bitte einen Stapel wählen oder einen neuen Namen eingeben.", "error"); return; }
			// Neuen Stapel-Namen im Baum anlegen, falls noch unbekannt
			if (deck !== "Standard" && !(S.decks || {})[deck] && !Object.values(S.cards).some((c) => (c.deck || "") === deck)) {
				await STATE.dispatch("deckCreate", { name: deck });
			}
			if (t.dataset.cardeditorsave === "new") {
				await STATE.dispatch("cardCreate", { id: U.uid(), front, back, deck });
			} else {
				await STATE.dispatch("cardUpdate", { id: t.dataset.cardeditorsave, patch: { front, back, deck } });
			}
			// Bug-Fix (Karteikarten): Nicht mitten im Lernen den aktiven Stapel
			// wechseln — ✎ Bearbeiten im Lernmodus kappte sonst die laufende
			// Session auf den Stapel der gerade bearbeiteten Karte.
			if (S.ankiTab !== "study") S.ankiDeck = deck === "Standard" ? null : deck;
			closeOverlay();
			return;
		}

		// ---------- Stapel-Baum: Stapel öffnen (nicht bei ⋯ / + / Menü) ----------
		if (t.hasAttribute("data-deckopen") && !closestOf(e, ".row-add, .page-menu, input, button")) {
			S.ankiDeck = t.dataset.deckopen || null;
			S.deckMenuOpenName = null;
			if (S.ankiTab === "study") S.ankiTab = "decks";
			render();
			return;
		}
		if (t.dataset.decknew || t.dataset.decksub) {
			const parent = t.dataset.decksub || "";
			openPromptDialog(parent ? 'Name des Unterstapels von „' + parent.split("::").pop() + '“' : "Name des neuen Stapels", async (name) => {
				const full = (parent ? parent + "::" : "") + name;
				await STATE.dispatch("deckCreate", { name: full });
				S.ankiDeck = full;
			});
			return;
		}

		// ---------- Daily Notes: Tag anklicken / Monat blättern ----------
		if (t.dataset.dailyday) { await openDailyNote(t.dataset.dailyday); return; }
		if (t.dataset.dailynav) {
			const base = S.dailyMonth ? new Date(S.dailyMonth + "-01T12:00:00") : new Date();
			const d = new Date(base.getFullYear(), base.getMonth() + Number(t.dataset.dailynav), 1);
			S.dailyMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
			renderMain();
			return;
		}

		// Workspace als Markdown-ZIP exportieren (Einstellungen → Backup)
		if (t.dataset.zipws) {
			try { await LIBRARY.exportWorkspaceZip(t.dataset.zipws); }
			catch (error) { U.toast("Workspace-Export fehlgeschlagen: " + (error?.message || error), "error"); }
			return;
		}

		// ⋯-Menü: Seite als Vorlage markieren / Markierung entfernen
		if (t.dataset.pagetemplate) {
			S.pageMenuOpenId = null;
			S.topMenu = null; // auch im Topbar-⋯-Menü — sonst bleibt es nach der Aktion offen
			const pg = S.pages[t.dataset.pagetemplate];
			if (pg) await STATE.dispatch("pageUpdate", { id: pg.id, patch: { isTemplate: !pg.isTemplate } });
			return;
		}

		// Anlege-Dialog: Notion-Seite, GoodNotes-Heft oder Vorlage als Startinhalt
		if (t.dataset.tplblank || t.dataset.tplheft) {
			const kind = t.dataset.tplheft ? "heft" : "notion";
			const p = S.pendingNewPage;
			S.pendingNewPage = null;
			closeOverlay();
			if (p) {
				const id = U.uid();
				await STATE.dispatch("pageCreate", {
					id, title: kind === "heft" ? "Neues Heft" : "Neue Seite", parentId: p.parentId || null, content: "",
					icon: null, tags: [], workspaceId: p.wsId || S.currentWorkspaceId, kind,
				});
				openPage(id, p.newTab ? { newTab: true } : undefined);
				focusPageTitle();
			}
			return;
		}
		if (t.dataset.tpluse) {
			const p = S.pendingNewPage;
			const tpl = S.pages[t.dataset.tpluse];
			S.pendingNewPage = null;
			closeOverlay();
			if (p && tpl) {
				const id = U.uid();
				await STATE.dispatch("pageCreate", {
					id, title: tpl.title, parentId: p.parentId || null, content: tpl.content || "",
					icon: tpl.icon || null, tags: tpl.tags || [], workspaceId: p.wsId || S.currentWorkspaceId,
					kind: tpl.kind || "notion",
				});
				openPage(id, p.newTab ? { newTab: true } : undefined);
			}
			return;
		}

		// Seitenverlauf: Version in der Liste auswählen → Vorschau aktualisieren
		if (t.dataset.histversion) {
			S.histIndex = Number(t.dataset.histversion);
			renderHistoryModal();
			return;
		}

		if (t.dataset.set) { await SETTINGS.navigateSettings(t.dataset.set); return; }

		// Neue Seite in einem Workspace (+ neben dem Workspace-Namen)
		if (t.dataset.newpage) { await newPageFlow(t.dataset.newpage, null); return; }

		// Unterseite anlegen (+ neben einer Seiten-Zeile)
		if (t.dataset.addchild) {
			const parent = S.pages[t.dataset.addchild];
			await newPageFlow(parent ? parent.workspaceId : S.currentWorkspaceId, t.dataset.addchild);
			return;
		}

		// ⋯-Menü je Seite (wie in Notion): öffnen/schließen, Duplizieren, Löschen (→ Papierkorb)
		if (t.dataset.pagemenu) {
			const id = t.dataset.pagemenu;
			S.pageMenuOpenId = S.pageMenuOpenId === id ? null : id;
			renderSidebar();
			if (S.view === "library") renderMain();
			// Menü fest (fixed) über dem Button positionieren, damit es nicht vom
			// Scroll-Container der Seitenleiste (#tree, overflow:auto) abgeschnitten wird.
			if (S.pageMenuOpenId) POPOVERS.position(
				document.querySelector('[data-pagemenu="' + id + '"]'),
				// :not(.top-menu): nie versehentlich das Topbar-⋯-Menü greifen
				document.querySelector(".page-menu:not(.top-menu)"), { align: "end", gap: 2 });
			return;
		}
		// ⋯-Menü: Seite umbenennen — wie bei Stapeln per Inline-Textfeld direkt in der Zeile.
		if (t.dataset.pagefav) {
			S.pageMenuOpenId = null;
			const pg = S.pages[t.dataset.pagefav];
			if (pg) await STATE.dispatch("pageUpdate", { id: pg.id, patch: { favorite: !pg.favorite } });
			return;
		}
		if (t.dataset.pagesubject) {
			S.pageMenuOpenId = null;
			closeTopMenu();
			renderSidebar();
			openSubjectDialog(t.dataset.pagesubject);
			return;
		}
		if (t.dataset.pagemove) {
			S.pageMenuOpenId = null;
			closeTopMenu(); // sonst bleibt das Topbar-⋯-Menü hinter dem Dialog offen
			renderSidebar();
			openMoveDialog(t.dataset.pagemove);
			return;
		}
		if (t.dataset.movetarget && S.movePageId) {
			const moveId = S.movePageId;
			const val = t.dataset.movetarget;
			const parentId = val.startsWith("pg:") ? val.slice(3) : null;
			const wsId = val.startsWith("ws:") ? val.slice(3) : ((S.pages[parentId] || {}).workspaceId || "default");
			await STATE.dispatch("pageMove", { id: moveId, parentId });
			await movePageSubtreeToWorkspace(moveId, wsId);
			S.movePageId = null;
			closeOverlay();
			return;
		}
		if (t.dataset.tagfilter) {
			S.libTag = S.libTag === t.dataset.tagfilter ? null : t.dataset.tagfilter;
			renderMain();
			return;
		}
		if (t.dataset.tagrename) {
			const oldTag = t.dataset.tagrename;
			openPromptDialog('Tag „' + oldTag + '“ umbenennen', async (newTag) => {
				for (const p of STATE.activePages()) {
					if ((p.tags || []).includes(oldTag)) {
						const tags = [...new Set(p.tags.map((x) => (x === oldTag ? newTag : x)))];
						await STATE.dispatch("pageUpdate", { id: p.id, patch: { tags } });
					}
				}
				if (S.libTag === oldTag) S.libTag = newTag;
				renderMain();
			}, oldTag);
			return;
		}
		if (t.dataset.pageopennew) {
			const id = t.dataset.pageopennew;
			S.pageMenuOpenId = null;
			openPage(id, { newTab: true });
			return;
		}
		if (t.dataset.pagerename) {
			e.preventDefault();
			e.stopPropagation();
			const id = t.dataset.pagerename;
			S.pageMenuOpenId = null;
			const pg = S.pages[id];
			if (!pg) { renderSidebar(); return; }
			if (PLATFORM.isTouch()) {
				renderSidebar();
				const isHeft = pg.kind === "heft";
				openPromptDialog(isHeft ? "Heft umbenennen" : "Seite umbenennen", async (newName) => {
					const title = newName.trim();
					if (title && title !== pg.title) {
						await STATE.dispatch("pageUpdate", { id, patch: { title } });
					}
				}, pg.title);
				return;
			}
			S.renamingPageId = id;
			renderSidebar();
			const inp = document.querySelector('[data-renamename="' + CSS.escape(id) + '"]');
			if (inp) focusRenameInput(inp);
			return;
		}
		if (t.dataset.pageduplicate) {
			S.pageMenuOpenId = null;
			S.topMenu = null; // FIX: Duplizieren aus dem Topbar-⋯-Menü ließ das Menü auf der neuen Seite offen
			const newId = await duplicatePage(t.dataset.pageduplicate);
			if (newId) openPage(newId);
			else render();
			return;
		}
		if (t.dataset.pagearchive) {
			S.pageMenuOpenId = null;
			S.topMenu = null;
			const id = t.dataset.pagearchive;
			const pg = S.pages[id];
			if (pg) {
				await STATE.dispatch("pageArchive", { id });
				const isHeft = pg.kind === "heft";
				U.toast((isHeft ? "Heft" : "Seite") + " archiviert.", "success");
			} else {
				render();
			}
			return;
		}
		if (t.dataset.pageunarchive) {
			const id = t.dataset.pageunarchive;
			const pg = S.pages[id];
			if (pg) {
				await STATE.dispatch("pageUnarchive", { id });
				const isHeft = pg.kind === "heft";
				U.toast((isHeft ? "Heft" : "Seite") + " wiederhergestellt.", "success");
			} else {
				render();
			}
			return;
		}
		if (t.dataset.pagetrash) {
			S.pageMenuOpenId = null;
			S.topMenu = null; // Löschen ist auch im Topbar-⋯-Menü — sonst bleibt es offen
			const id = t.dataset.pagetrash;
			const pg = S.pages[id];
			if (pg) {
				await STATE.dispatch("pageTrash", { id });
				U.toast("Seite im Papierkorb.", "success");
			} else {
				render(); // nur Menü-Zustand geändert, kein dispatch → sofort neu zeichnen
			}
			return;
		}
		if (t.dataset.pagerestore) {
			await STATE.dispatch("pageRestore", { id: t.dataset.pagerestore });
			return;
		}
		if (t.dataset.pagepurge) {
			const pg = S.pages[t.dataset.pagepurge];
			if (pg && await U.confirm('„' + pg.title + '“ endgültig löschen? Das kann nicht rückgängig gemacht werden.', {
				title: "Endgültig löschen", ok: "Löschen", danger: true,
			})) {
				await STATE.dispatch("pageDelete", { id: t.dataset.pagepurge });
			}
			return;
		}
		// Papierkorb vollständig und endgültig leeren. Die Reihenfolge ist wichtig:
		// erst Seiten, dann Stapel, danach verwaiste Karten; alles bleibt bis zur
		// Bestätigung unverändert und wird als einzelne, synchronisierbare Events gelöscht.
		if (t.dataset.trashclear) {
			const pageIds = STATE.trashedPages().map((p) => p.id);
			const deckRoots = STATE.trashedDeckRoots();
			const cardIds = STATE.orphanTrashedCards().map((c) => c.id);
			const total = pageIds.length + deckRoots.length + cardIds.length;
			if (!total) { U.toast("Der Papierkorb ist bereits leer.", "success"); return; }
			if (!await U.confirm("Alle " + total + " Elemente im Papierkorb endgültig löschen? Das kann nicht rückgängig gemacht werden.", {
				title: "Papierkorb leeren", ok: "Endgültig löschen", danger: true,
			})) return;
			for (const id of pageIds) await STATE.dispatch("pageDelete", { id });
			for (const name of deckRoots) await STATE.dispatch("deckDelete", { name });
			for (const id of cardIds) await STATE.dispatch("cardDelete", { id });
			U.toast("Papierkorb geleert.", "success");
			return;
		}

		if (t.dataset.trashfilter) {
			S.trashFilter = t.dataset.trashfilter;
			renderMain();
			return;
		}

		// Papierkorb: Karten & Stapel wiederherstellen / endgültig löschen
		if (t.dataset.cardrestore) {
			await STATE.dispatch("cardRestore", { id: t.dataset.cardrestore });
			U.toast("Karte wiederhergestellt.", "success");
			return;
		}
		if (t.dataset.cardpurge) {
			const c = S.cards[t.dataset.cardpurge];
			const label = c ? (c.front || "").slice(0, 40) : "Karte";
			if (await U.confirm('Karte „' + label + (label.length >= 40 ? "…" : "") + '“ endgültig löschen? Das kann nicht rückgängig gemacht werden.', {
				title: "Endgültig löschen", ok: "Löschen", danger: true,
			})) {
				await STATE.dispatch("cardDelete", { id: t.dataset.cardpurge });
			}
			return;
		}
		if (t.dataset.deckrestore) {
			await STATE.dispatch("deckRestore", { name: t.dataset.deckrestore });
			U.toast("Stapel wiederhergestellt.", "success");
			return;
		}
		if (t.dataset.deckpurge) {
			const name = t.dataset.deckpurge;
			const n = Object.values(S.cards).filter((c) => STATE.deckInTree(c.deck || "Standard", name)).length;
			if (await U.confirm('Stapel „' + name + '“ endgültig löschen?' +
				(n ? " " + n + " Karte(n) werden unwiderruflich entfernt." : "") +
				" Das kann nicht rückgängig gemacht werden.", {
				title: "Endgültig löschen", ok: "Löschen", danger: true,
			})) {
				await STATE.dispatch("deckDelete", { name });
			}
			return;
		}

		// Chat-Verlauf: laufende Antworten bleiben an ihrer Sitzung gebunden.
		if (t.dataset.newchat) { startNewChat(); return; }
		// Verlauf im Seitenchat: alte Unterhaltung direkt im Panel weiterführen
		// (kein Tab-Wechsel wie bei data-chat).
		if (t.dataset.sidechat) {
			CHAT_FULLSCREEN.saveSideChat();
			const s = CHATS.load().find((x) => x.id === t.dataset.sidechat);
			S.chatHistOpen = false;
			S.sideChat = s ? s.messages : [];
			S.sideChatId = s ? s.id : null;
			render();
			return;
		}
		if (t.dataset.chat) {
			saveCurrentChat();
			openPage("chat:" + t.dataset.chat);
			return;
		}

		// Kartenmanager: Speichern / Löschen
		if (t.dataset.cardsave) {
			const id = t.dataset.cardsave;
			const f = document.querySelector('[data-front="' + id + '"]');
			const b = document.querySelector('[data-back="' + id + '"]');
			if (f && b) await STATE.dispatch("cardUpdate", { id, patch: { front: f.value, back: b.value } });
			openCards();
			return;
		}
		if (t.dataset.carddel) {
			if (await U.confirm("Diese Karte in den Papierkorb legen?", { title: "Karte löschen", ok: "In Papierkorb", danger: true })) {
				await STATE.dispatch("cardTrash", { id: t.dataset.carddel });
				openCards();
			}
			return;
		}

		// Undo/Redo aus dem ⋯-Menü der Seite — nutzt dieselben Stapel wie Strg+Z / Strg+Y
		if (t.dataset.editundo || t.dataset.editredo) {
			const redo = !!t.dataset.editredo;
			S.topMenu = null;
			RENDER.renderMain();
			await EDITOR.undoRedo(redo);
			return;
		}

		// Seite öffnen (Sidebar, Home-Karte, Bibliothek oder Breadcrumb-Vorfahre)
		if (t.dataset.page) {
			const newTab = !!(e.ctrlKey || e.metaKey);
			openPage(t.dataset.page, { newTab });
			return;
		}

		// Karten-Bewertung im Review
		if (t.dataset.grade) {
			await rateAndReviewCard(t.dataset.card, Number(t.dataset.grade));
			S.reviewShowBack = false;
			openReview();
			return;
		}

		// Darstellungs-Umschalter über die Map statt 14 case-Zeilen
		const appearance = APPEARANCE_BTN[t.id];
		if (appearance) { SETTINGS.handleAppearanceSelect(...appearance); return; }

		switch (t.id) {
			case "btnAiFab":
				// Desktop-Schnellzugriff unten rechts: nur das Seitenpanel öffnen,
				// damit die aktuelle Seite sichtbar bleibt.
				document.body.classList.remove("panel-collapsed");
				renderTabs();
				break;
			case "btnHome":
				S.sidebarMode = "files";
				// Aus Anki/Daily/Bibliothek/Papierkorb führt Home auch inhaltlich zurück
				if (S.view === "anki" || S.view === "daily" || S.view === "library" || S.view === "trash") {
					S.view = S.currentPageId ? "page" : "home";
				}
				render();
				break;
			// Chat-Taste: zeigt den Chat-Verlauf in der Sidebar
			case "btnChatTab":
				S.sidebarMode = "chats";
				render();
				break;
			case "btnLibrary":
				S.view = "library";
				S.libFolder = null;
				blurActive();
				render();
				break;
			case "btnChatHist": // Verlauf-Dropdown; Liste baut render.js
				S.chatHistOpen = !S.chatHistOpen;
				render();
				break;
			case "btnChatNew": // alte Unterhaltung ist gesichert, bleibt in der Chat-Liste
				CHAT_FULLSCREEN.saveSideChat();
				S.sideChat = [];
				S.sideChatId = null;
				render();
				U.toast("Neuer Chat gestartet");
				break;
			case "btnChatExpand": {
				// Ersetzt den alten Vollbildmodus: Seitenchat als eigenen Tab öffnen.
				CHAT_FULLSCREEN.saveSideChat();
				const sideId = S.sideChatId;
				S.sideChat = [];
				S.sideChatId = null;
				document.body.classList.add("panel-collapsed");
				if (sideId) openPage("chat:" + sideId, { newTab: true });
				else startNewChat({ newTab: true });
				break;
			}
			case "btnNavBack":
			case "btnPageNavBack": navBack(); break;
			case "btnNavForward":
			case "btnPageNavForward": navForward(); break;
			case "btnSearchToggle":
				SEARCH.handleSearchToggle();
				break;
			case "btnCreateWs":
				await LIBRARY.handleCreateWorkspace();
				break;
			case "btnAttach":
			case "btnAttachFull":
				// 📓 Heft-Anhang nur anbieten, wenn gerade ein Heft geöffnet ist.
				if ($("attachHeft")) $("attachHeft").hidden = !HEFT.activeId;
				CHAT_FULLSCREEN.handleAttachMenuToggle(t);
				break;
			case "attachHeft":
				// 👁 Aktuelle Heft-Seite als Bild anhängen — die KI kann sie damit wie
				// ein Foto "lesen" (Vision). Die Modell-Auswahl bleibt unangetastet.
				$("attachMenu").hidden = true;
				try {
					const heftUrl = await HEFT.pageAsDataUrl(HEFT.activeId, HEFT.activeIndex);
					if (!heftUrl) { U.toast("Öffne zuerst ein Heft, um eine Seite anzuhängen.", "error"); break; }
					S.pendingImage = heftUrl;
					S.pendingTextFile = null;
					S.pendingPdf = null;
					S.pendingAttachmentTarget = S.attachTarget || "side";
					RENDER.renderPendingChip(S.pendingAttachmentTarget);
					U.toast("Heft-Seite angehängt — sie geht mit der nächsten Nachricht an die KI.", "success");
				} catch (err) {
					U.toast("Heft-Seite konnte nicht angehängt werden: " + err.message, "error");
				}
				break;
			case "attachFile":
				$("attachMenu").hidden = true;
				$("fileAttachment").click();
				break;
			case "attachMention":
				$("attachMenu").hidden = true;
				U.toast("Seiten- und Personen-Erwähnungen folgen als Nächstes.", "success");
				break;
			case "btnRemoveImage":
				CHAT_FULLSCREEN.handleRemoveImage();
				break;
			case "btnRemoveTextFile":
				CHAT_FULLSCREEN.handleRemoveTextFile();
				break;
			case "btnRemovePdf":
				CHAT_FULLSCREEN.handleRemovePdf();
				break;
			case "btnTogglePanel":
				document.body.classList.add("panel-collapsed");
				renderTabs();
				break;
			case "btnShowPanel":
				document.body.classList.remove("panel-collapsed");
				renderTabs();
				break;
			case "btnSettings": SETTINGS.openSettings(); break;
			case "btnDriveLogin":
				await SETTINGS.handleDriveLogin(t);
				break;
			case "btnDriveLogout":
				SETTINGS.handleDriveLogout();
				break;
			case "btnDriveSyncSettings":
				await SETTINGS.handleDriveSyncSettings(t);
				break;
			case "btnDrivePrimaryAction":
				await SETTINGS.handleDrivePrimaryAction(t);
				break;
			case "btnCfConnect":
				await SETTINGS.handleCfConnect(t);
				break;
			case "btnCfDisconnect":
				await SETTINGS.handleCfDisconnect();
				break;
			case "btnCfPairing":
				SETTINGS.handleCfPairing();
				break;
			case "btnCfScanPairing":
				await SETTINGS.handleCfScanPairing();
				break;
			case "btnCfSyncNow":
				await SETTINGS.handleCfSyncNow(t);
				break;
			case "btnCfPrimaryAction":
				await SETTINGS.handleCfPrimaryAction(t);
				break;
			case "btnCfGenKey":
				SETTINGS.handleCfGenKey();
				break;
			case "btnCfCopyKey":
				await SETTINGS.handleCfCopyKey();
				break;
			case "btnCfPurge":
				await SETTINGS.handleCfPurge();
				break;
			case "btnAddProvider":
				await SETTINGS.handleAddProvider();
				break;
			case "btnRefreshModels":
				await SETTINGS.refreshChatModels(true);
				break;
			case "btnApplyCustomModel":
				await SETTINGS.handleApplyCustomModel();
				break;
			case "btnRefreshEmbedding":
				await SETTINGS.refreshEmbeddingModels();
				break;
			case "btnDownloadLocalEmbedding":
				await SETTINGS.handleDownloadLocalEmbedding();
				break;
			case "btnEnableLocalEmbedding":
				await SETTINGS.handleEnableLocalEmbedding();
				break;
			case "btnDeleteLocalEmbedding":
				await SETTINGS.handleDeleteLocalEmbedding();
				break;
			case "btnOpenAbschreiben":
				(await import("./abschreiben.js")).open();
				break;
			case "btnExportHandwritingSamples":
				SETTINGS.handleExportHandwritingSamples();
				break;
			case "btnExportAllInk":
				await SETTINGS.handleExportAllInk();
				break;
			case "btnClearHandwritingSamples":
				SETTINGS.handleClearHandwritingSamples();
				break;
			case "btnPwaUpdateAction":
				await SETTINGS.handleUpdateAction(t);
				break;
			case "btnSaveSettings":
				await SETTINGS.handleSaveSettings();
				break;
			case "btnDiscardSettings":
				SETTINGS.discardSettingsDraft();
				break;
			case "btnModelMenu":
			case "btnModelChipFull":
				await CHAT_FULLSCREEN.handleModelMenuToggle(t);
				break;
			case "btnCoverUpload": {
				const pid = S.currentPageId;
				if (!pid) break;
				// U.pickImageFile: gemeinsamer Datei-Dialog (siehe auch library.js).
				const file = await U.pickImageFile();
				if (!file) break;
				try {
					const buf = await U.readAsBuffer(file);
					const blobId = "cover:" + U.uid();
					await DB.putBlob(blobId, buf, { name: file.name, type: file.type });
					await STATE.dispatch("pageUpdate", { id: pid, patch: { coverImg: blobId, cover: null } });
					closeOverlay();
				} catch (err) {
					alert("Bild konnte nicht als Cover gesetzt werden: " + err.message);
				}
				break;
			}
			case "btnResetChats":
				if (await CHAT_FULLSCREEN.handleDeleteAllChats()) SETTINGS.openSettings("app", "danger-zone");
				break;
			case "btnResetCards":
				if (await SETTINGS.handleDeleteAllCards(t)) SETTINGS.openSettings("app", "danger-zone");
				break;
			case "btnCloseSettings": await SETTINGS.requestCloseSettings(); break;
			case "btnCloseOverlay": closeOverlay(); break;
			case "btnAnki": openAnki(); break;
			case "btnReview":
			case "btnReviewHome":
				openAnki("study", null);
				break;
			case "btnShowBack": S.reviewShowBack = true; openReview(); break;
			case "btnReviewRefresh": openReview(); break;
			case "btnCards": openAnki("browser"); break;
			case "btnDaily":
				S.view = "daily";
				S.dailyMonth = null;
				blurActive();
				render();
				break;
			case "btnDailyToday": await openDailyNote(localDayKey(new Date())); break;
			case "btnHistory":
				closeTopMenu(); // sonst bleibt das ⋯-Menü hinter dem Verlauf-Dialog offen
				if (S.currentPageId) await openHistory(S.currentPageId);
				break;
			case "btnHistRestore": {
				const vs = S.histVersions || [];
				const v = vs[Math.max(0, Math.min(S.histIndex, vs.length - 1))];
				if (v && S.histPageId) {
					// Wiederherstellen = neues Event (der Verlauf bleibt vollständig erhalten)
					await STATE.dispatch("pageUpdate", { id: S.histPageId, patch: { title: v.title, content: v.content } });
					RAG.queuePage(S.histPageId);
					closeOverlay();
				}
				break;
			}
			case "btnDailyHome":
				await openDailyNote(localDayKey(new Date()));
				break;
			case "btnBackupNow":
			case "btnExport":
				await SETTINGS.handleBackupNow(t);
				break;
			case "btnSidebarToggle":
			case "btnPageSidebarToggle":
			case "btnHeftSidebarToggle": {
				// Mobile: Navigator-Sheet öffnen. Desktop: linke Spalte einklappen (☰ bleibt in der Tab-Leiste).
				const mobile = PLATFORM.isPhone(); // dieselbe Definition wie mobile.js und das CSS
				if (mobile) {
					document.body.classList.toggle("mnav-open");
				} else {
					const on = document.body.classList.toggle("sidebar-collapsed");
					try { localStorage.setItem("impala67.sidebarCollapsed", on ? "1" : "0"); } catch { /* ignore */ }
				}
				break;
			}
			case "btnThemeDark":
			case "btnThemeLight":
				SETTINGS.handleThemeSelect(t.id === "btnThemeLight" ? "light" : "dark");
				break;
			case "btnThemeSystem":
				SETTINGS.handleSystemThemeToggle(true);
				break;
			case "btnImport": $("fileImport").click(); break;
			case "btnOpenPdf":
				S.topMenu = null; // sonst zeichnet render() das offene ⋯-Menü sofort wieder
				S.pdfOpen = !S.pdfOpen;
				blurActive();
				render();
				break;
			case "btnOpenPdfTab": {
				S.topMenu = null;
				const pid = t.dataset.pdfid || S.pages[S.currentPageId]?.pdfId;
				if (pid) PDFS.openViewer(pid);
				break;
			}
			case "btnDownloadPdf": {
				S.topMenu = null;
				const pid = t.dataset.pdfid || S.pages[S.currentPageId]?.pdfId;
				const title = t.dataset.pdftitle || S.pages[S.currentPageId]?.title;
				if (pid) PDFS.download(pid, title);
				break;
			}
			case "btnResetAll":
				await SETTINGS.handleResetAll(t);
				break;
			case "btnTrash":
				S.view = "trash";
				blurActive();
				render();
				break;
		}
	});

	// Eingaben (Delegation) — inkl. Live-Vorschau im Split-Modus
	// PERF (10. Juli): Anki-Suche debounced — vorher Full-Render der Browser-Tabelle pro Tastendruck
	const debouncedAnkiSearch = U.debounce((value, pos) => {
		S.ankiSearch = value;
		renderAnki($("main"));
		const inp = $("ankiSearch");
		if (inp) { inp.focus(); inp.selectionStart = inp.selectionEnd = pos; }
	}, 150);
	document.addEventListener("input", (e) => {
		if (e.target.id === "chatInput" || e.target.id === "mainChatInput") syncComposer(e.target);
		// Bibliotheks-Filter: live filtern, Fokus + Cursorposition nach dem Neuaufbau erhalten
		if (e.target.id === "libFilter") {
			LIBRARY.handleFilterInput(e);
		}
		// KI-Einstellungen: Modelle live filtern. Nur die Liste wird neu gezeichnet,
		// das Suchfeld selbst nicht — Fokus und Cursor bleiben von allein.
		if (e.target.id === "inpModelSearch") {
			S.modelQuery = e.target.value;
			SETTINGS.paintSettingsModels();
		}
		if (e.target.id === "settingsSearch") SETTINGS.updateSettingsSearch(e.target.value);
		if (e.target.matches?.("[data-settings-explicit]")) SETTINGS.refreshSettingsDirtyState();
		// Karten-Browser: live suchen (debounced), Fokus + Cursorposition erhalten
		if (e.target.id === "ankiSearch") {
			const pos = e.target.selectionStart;
			debouncedAnkiSearch(e.target.value, pos);
		}
	});
	document.addEventListener("change", async (e) => {
		// DB-Tabellen: Zellwert als normales pageUpdate (Verlauf/Diff/Sync greifen).
		// Zusammengelegt: es gab zwei change-Listener am document (Zwillinge, die mit der
		// Zeit auseinanderlaufen) — jetzt EIN Einstiegspunkt für alle change-Ereignisse.
		const cell = closestOf(e, ".db-cell");
		if (cell) {
			const row = S.pages[cell.dataset.dbrow];
			if (!row) return;
			const props = { ...(row.props || {}) };
			props[cell.dataset.dbcol] = cell.value;
			await STATE.dispatch("pageUpdate", { id: row.id, patch: { props } });
			return;
		}
		if (e.target.id === "inpThemeFollowSystem") {
			SETTINGS.handleSystemThemeToggle(!!e.target.checked);
			return;
		}
		if (e.target.id === "inpSyncSecrets") {
			await SETTINGS.handleSyncSecretsToggle(!!e.target.checked);
			return;
		}
		if (e.target.id === "inpDriveAutoSyncMinutes") {
			await SETTINGS.handleDriveAutoSyncMinutes(e.target.value);
			return;
		}
		if (e.target.id === "inpDriveSyncAfterChange") {
			await SETTINGS.handleDriveSyncAfterChange(!!e.target.checked);
			return;
		}
		if (e.target.id === "inpBetaUi") {
			SETTINGS.handleAppearanceSelect("betaUi", e.target.checked ? "1" : "0");
			return;
		}
		if (e.target.id === "inpReduceMotion") {
			SETTINGS.handleAppearanceSelect("motion", e.target.checked ? "reduced" : "full");
			return;
		}
		if (e.target.id === "inpNativeFsBackup") {
			localStorage.setItem("impala67NativeFsBackup", e.target.checked ? "1" : "0");
			return;
		}
		if (e.target.id === "inpNativeHaptics") {
			localStorage.setItem("impala67NativeHaptics", e.target.checked ? "1" : "0");
			if (e.target.checked) PLATFORM_NATIVE.haptics.light();
			return;
		}
		if (e.target.id === "inpNativeScanner") {
			localStorage.setItem("impala67NativeScanner", e.target.value === "impala" ? "0" : "1");
			return;
		}
		if (e.target.id === "inpOverlearn") {
			SETTINGS.handleAppearanceSelect("overlearn", e.target.checked ? "on" : "off");
			return;
		}
		if (e.target.id === "inpConfidence") {
			SETTINGS.handleAppearanceSelect("confidence", e.target.checked ? "on" : "off");
			return;
		}
		if (e.target.id === "inpBreakReminder") {
			SETTINGS.handleAppearanceSelect("breakReminder", e.target.checked ? "1" : "0");
			return;
		}
		if (e.target.id === "inpTelemetry") {
			SETTINGS.handleAppearanceSelect("telemetry", e.target.checked ? "on" : "off");
			return;
		}
		if (e.target.id === "inpAlwaysTools") {
			await STATE.dispatch("settingsSet", { alwaysSendTools: !!e.target.checked });
			return;
		}
		if (e.target.id === "inpEmbed") {
			const [embedProviderId = "", ...modelParts] = e.target.value.split("::");
			await STATE.dispatch("settingsSet", { embedProviderId, embedModel: modelParts.join("::") });
			RAG.reindexStale();
			return;
		}
		if (e.target.id === "pageTitle") {
			const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
			if (pg && e.target.value.trim()) {
				await STATE.dispatch("pageUpdate", { id: pg.id, patch: { title: e.target.value.trim() } });
				RAG.queuePage(pg.id);
			}
		}
		if (e.target.id === "modelSelect") {
			await STATE.dispatch("settingsSet", { aiModel: e.target.value });
			AI.detectThinkingCapabilities().then(renderModelBar, renderModelBar);
			SETTINGS.checkAI();
		}
		if (e.target.id === "fileAttachment" && e.target.files[0]) {
			if (e.target.files[0].type === "application/pdf") await CHAT_FULLSCREEN.handleFilePdfChange(e);
			else if (e.target.files[0].type.startsWith("image/")) CHAT_FULLSCREEN.handleFileImgChange(e);
		}
		if (e.target.id === "filePdf" && e.target.files[0]) {
			await CHAT_FULLSCREEN.handleFilePdfChange(e);
		}
		if (e.target.id === "fileImg" && e.target.files[0]) {
			CHAT_FULLSCREEN.handleFileImgChange(e);
		}
		if (e.target.id === "fileImport" && e.target.files[0]) {
			await SETTINGS.handleImportChange(e);
		}
	});

	wireSidebarEvents();
	// Chat-Formulare (Panel + Vollbild) per Delegation — Vollbild-Form wird pro Render neu erzeugt
	const CHAT_FORMS = { chatForm: ["chatInput", "side"], mainChatForm: ["mainChatInput", "full"] };
	document.addEventListener("submit", async (e) => {
		const def = CHAT_FORMS[e.target.id];
		if (!def) return;
		e.preventDefault();
		// ⏹ Läuft gerade eine Antwort, bricht der Senden-Button sie ab statt zu senden
		const full = def[1] === "full", id = full ? S.currentChatId : S.sideChatId;
		if (S.aiBusy && S.aiActiveChatType === def[1] && S.aiActiveChatId === id) { AI.abortActive(); return; }
		if (S.aiBusy) { U.toast("Eine KI-Antwort läuft bereits im Hintergrund.", "error"); return; }
		const inp = $(def[0]);
		const text = inp.value.trim();
		inp.value = ""; syncComposer(inp);
		await sendChatMessage(text, def[1]);
	});
	// Enter sendet, Shift+Enter = Zeilenumbruch (Seitenpanel + Vollbild-Chat)
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" || e.shiftKey) return;
		if (e.target.id === "chatInput") { e.preventDefault(); $("chatForm").requestSubmit(); }
		else if (e.target.id === "mainChatInput") { e.preventDefault(); $("mainChatForm").requestSubmit(); }
	});

	// Debug-Button nach jedem Chat-Render nachrüsten (nur großer Chat, nie Seiten-Panel)
	// PERF: Während die KI streamt, ändert sich #main hunderte Mal pro Antwort — der
	// Observer suchte bei JEDER Änderung im DOM (und löste sich mit dem eingefügten Knopf
	// gleich selbst wieder aus). Jetzt wird pro Frame höchstens einmal nachgerüstet.
	const main = $("main");
	if (main) {
		let mountQueued = false;
		new MutationObserver(() => {
			if (mountQueued) return;
			mountQueued = true;
			requestAnimationFrame(() => { mountQueued = false; mountFullChatVoiceButton(); });
		}).observe(main, { childList: true, subtree: true });
	}
	mountFullChatVoiceButton();


	// Tastenkombinationen (Shortcuts) registrieren
	SHORTCUTS.wireShortcuts();
	// Langen geklebten Text automatisch als .txt-Anhang behandeln statt im Feld auszuschreiben
	document.addEventListener("paste", (e) => {
		CHAT_FULLSCREEN.handlePaste(e);
	});

	// 📱 FIX Tastatur & Chat-Verschiebung:
	// Wird die Bildschirmtastatur (Chat, Suche, Notiz) geschlossen, muss
	// die Verschiebung zuverlässig zurückgesetzt werden — sowohl am Window
	// als auch an #main, wo Chat und mobile Shell sonst oben hängen bleiben.
	const isEditing = () => {
		const a = document.activeElement;
		return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
	};
	const viewportDisplaced = () => {
		const main = document.getElementById("main");
		const mainScrolled = !!main && (S.view === "chat" || !!main.querySelector(".chat-full-wrap")) && main.scrollTop > 0;
		return window.scrollY > 0 || document.documentElement.scrollTop > 0 || document.body.scrollTop > 0 ||
			(window.visualViewport && window.visualViewport.offsetTop > 0) || mainScrolled;
	};
	const resetViewportScroll = () => {
		if (isEditing() || !viewportDisplaced()) return;
		window.scrollTo(0, 0);
		if (document.documentElement) document.documentElement.scrollTop = 0;
		if (document.body) document.body.scrollTop = 0;
		const main = document.getElementById("main");
		if (main && (S.view === "chat" || main.querySelector(".chat-full-wrap"))) {
			main.scrollTop = 0;
		}
	};
	const scheduleResetViewport = () => {
		setTimeout(resetViewportScroll, 50);
		setTimeout(resetViewportScroll, 180);
		setTimeout(resetViewportScroll, 360);
	};
	if (window.visualViewport) {
		let kbOpen = false;
		window.visualViewport.addEventListener("resize", () => {
			const open = window.visualViewport.height < window.innerHeight * 0.85;
			if (kbOpen && !open) scheduleResetViewport();
			kbOpen = open;
		});
	}
	document.addEventListener("focusout", (e) => {
		if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
			setTimeout(() => {
				if (!isEditing()) scheduleResetViewport();
			}, 60);
		}
	});
}

export const APP = {
	COLLAPSE,
	CHATS,
	wireEvents,
	closeOverlay,
	newPageFlow,
	openDailyNote,
	startNewChat,
	createPageInNewTab,
	// Für Strg+K-Aktionen (search.js) — „Karten verwalten“ & Co.
	PLATFORM,
	openAnki,
	setAnkiZen,
	rateAndReviewCard,
	showStudyAnswer,
	gradeStudyCard,
	studySpaceOrEnter,
	checkIncomingShare,
};
