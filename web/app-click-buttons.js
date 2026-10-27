"use strict";

// Feste Knöpfe mit id (Topbar, Seitenleiste, Einstellungen, Anhänge, Lernen, PDF …).
// Letzte Stufe des zentralen Klick-Handlers in app.js.

import { DB } from "./db.js";
import { RAG } from "./rag.js";
import { RENDER } from "./render.js";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { SETTINGS } from "./settings.js";
import { LIBRARY } from "./library.js";
import { TABS } from "./tabs.js";
import { SEARCH } from "./search.js";
import { CHAT_FULLSCREEN } from "./chat-fullscreen.js";
import { HEFT } from "./heft.js";
import { PDFS } from "./pdfs.js";
import { PLATFORM } from "./platform.js";
import { blurActive, closeTopMenu } from "./app-ui.js";
import { closeOverlay, openAnki, openDailyNote, openHistory, startNewChat } from "./app-dialogs.js";

// Spät gebunden ((...a) =>) wegen Modul-Zyklen — wie in app.js.
const render = (...a) => RENDER.render(...a);
const openPage = (...a) => TABS.openPage(...a);
const navBack = (...a) => TABS.navBack(...a);
const navForward = (...a) => TABS.navForward(...a);
const renderTabs = (...a) => RENDER.renderTabs(...a);
const openReview = (...a) => RENDER.openReview(...a);
const localDayKey = (...a) => RENDER.localDayKey(...a);
const $ = (id) => U.el(id);


export async function handleButtonClick(t) {
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
			await SETTINGS.handleCfGenKey();
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
				U.toast("Bild konnte nicht als Cover gesetzt werden: " + err.message, "error");
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
}
