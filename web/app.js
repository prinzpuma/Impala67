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
import { PDFS } from "./pdfs.js";
import { PLATFORM_NATIVE } from "./platform-native.js";
import { icon } from "./icons.js";
import { wireSidebarEvents } from "./app-sidebar-events.js";
import { closestOf, blurActive, closeTopMenu } from "./app-ui.js";
import { handleChatClick } from "./app-click-chat.js";
import { handleDeckMenuClick, handleAnkiClick } from "./app-click-anki.js";
import { handlePageClick } from "./app-click-pages.js";
import { handleButtonClick } from "./app-click-buttons.js";
import {
	closeOverlay,
	backupFromHome,
	mountFullChatVoiceButton,
	openPromptDialog,
	newPageFlow,
	setAnkiZen,
	openAnki,
	openDailyNote,
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
const openPage = (...a) => TABS.openPage(...a);
const closeTab = (...a) => TABS.closeTab(...a);
const openHomeOverview = (...a) => TABS.openHomeOverview(...a);
const saveCurrentChat = (...a) => CHAT_FULLSCREEN.saveCurrentChat(...a);
const sendChatMessage = (...a) => CHAT_FULLSCREEN.sendChatMessage(...a);
const renderModelBar = (...a) => RENDER.renderModelBar(...a);
const renderModelMenu = (...a) => RENDER.renderModelMenu(...a);
const renderSidebar = (...a) => RENDER.renderSidebar(...a);
const renderMain = (...a) => RENDER.renderMain(...a);
const openReview = (...a) => RENDER.openReview(...a);
const openCards = (...a) => RENDER.openCards(...a);
const openIconPicker = (...a) => RENDER.openIconPicker(...a);
const openCoverPicker = (...a) => RENDER.openCoverPicker(...a);
const localDayKey = (...a) => RENDER.localDayKey(...a);
const renderAnki = (...a) => RENDER_ANKI.renderAnki(...a);

// app.js v2 — Init + Event-Verkabelung. KISS/DRY-Refactor, funktionsgleich.
const $ = (id) => U.el(id);




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
				const alt = title.replace(/[[\]]/g, "");
				let mdContent = "";
				for (const uri of items) {
					const fileSrc = (window.Capacitor && typeof window.Capacitor.convertFileSrc === "function")
						? window.Capacitor.convertFileSrc(uri)
						: uri;
					const resp = await fetch(fileSrc);
					const blob = await resp.blob();
					// Gleiches Format wie Bildblöcke im Editor (img:<id>): nur das löst editor.js
					// hydrate() aus IndexedDB auf. „blob:<id>“ landete ungeprüft als <img src>.
					const blobId = "img:" + U.uid();
					await DB.putBlob(blobId, await U.readAsBuffer(blob), { name: "image.png", size: blob.size, type: blob.type || "image/png" });
					mdContent += `![${alt}](${blobId})\n\n`;
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
	// „＋ Neue Zeile“ in der Datenbank-Ansicht: neue Unterseite mit leeren Eigenschaften
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
		"[data-pagetemplate],[data-pagedb],[data-tplblank],[data-tplheft],[data-tpluse],[data-libsort],[data-histversion],[data-renamename],[data-deckrenamename]," +
		"[data-conflictopen],[data-conflictnav],[data-conflictresolve],[data-conflictpage],button";

	document.addEventListener("click", async (e) => {
		// Stapel-⋯ ZUERST, sonst zerstört closeOutside das Menü im selben Klick
		if (await handleDeckMenuClick(e)) return;

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

		if (await handleChatClick(t)) return;

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

		if (await handleAnkiClick(t, e)) return;

		// Workspace als Markdown-ZIP exportieren (Einstellungen → Backup)
		if (t.dataset.zipws) {
			try { await LIBRARY.exportWorkspaceZip(t.dataset.zipws); }
			catch (error) { U.toast("Workspace-Export fehlgeschlagen: " + (error?.message || error), "error"); }
			return;
		}

		if (await handlePageClick(t, e)) return;

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

		await handleButtonClick(t);
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
	openAnki,
	setAnkiZen,
	rateAndReviewCard,
	showStudyAnswer,
	gradeStudyCard,
	studySpaceOrEnter,
	checkIncomingShare,
};
