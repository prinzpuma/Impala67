"use strict";

import { S, STATE } from "./state.js";
import { CHATS } from "./chats.js";
import { AI } from "./ai.js";
import { U } from "./util.js";
import { PDFS } from "./pdfs.js";
import { RENDER } from "./render.js";
import { TABS } from "./tabs.js";

const render = (...args) => RENDER.render(...args);
const renderChat = (...args) => RENDER.renderChat(...args);
const renderMainChatLog = (...args) => RENDER.renderMainChatLog(...args);
const renderPendingChip = (...args) => RENDER.renderPendingChip(...args);
const renderModelMenu = (...args) => RENDER.renderModelMenu(...args);
const openPage = (...args) => TABS.openPage(...args);

export function saveCurrentChat() {
	if (!S.chat.length) return;
	const list = CHATS.load();
	let s = S.currentChatId ? list.find((x) => x.id === S.currentChatId) : null;
	if (!s) {
		s = { id: U.uid(), title: "", created: U.now(), messages: [] };
		S.currentChatId = s.id;
		list.unshift(s);
	}
	s.messages = S.chat;
	s.updated = U.now();
	if (!s.title) {
		const first = S.chat.find((m) => m.role === "user");
		s.title = first ? String(first.content).slice(0, 60) : "Neuer Chat";
	}
	CHATS.save(list);
}

// KI-Vollbildmodus (wie Notion AI)
export function toggleChatFull(force) {
	S.chatFull = force === undefined ? !S.chatFull : force;
	document.body.classList.toggle("chat-full", S.chatFull);
	if (S.chatFull) {
		document.body.classList.remove("panel-collapsed");
		const btn = U.el("btnShowPanel");
		if (btn) btn.hidden = true;
	}
}

// Formuliert eine KI-Antwort länger, kürzer oder in gleicher Länge um (wie Gemini).
// FIX: sucht jetzt sowohl in S.chat (Vollbild) als auch S.sideChat (Seitenpanel).
// FIX: komplett überarbeitete UX — die alte Antwort verschwindet SOFORT aus der Liste
// (nicht nur ausgegraut), und die neue Antwort wird über denselben S.aiDraft/S.aiBusy-
// Mechanismus wie eine ganz normale neue Nachricht (sendChatMessage) eingeblendet —
// sieht also exakt so aus, als würde gerade frisch geantwortet, inklusive dem bekannten
// wachsenden Text-Bubble, statt eines separaten Patch-/Status-Zustands.
export async function refineMessage(mid, mode) {
	if (S.aiBusy) return;
	const isSide = S.sideChat.some((x) => x.mid === mid);
	const list = isSide ? S.sideChat : S.chat;
	const idx = list.findIndex((x) => x.mid === mid);
	if (idx === -1) return;
	const msg = list[idx];
	const history = list.slice(0, idx)
		.filter((m) => m.role === "user" || m.role === "assistant")
		.map((m) => ({ role: m.role, content: m.content || "" }));
	history.push({ role: "assistant", content: msg.content });
	const instruction = mode === "longer"
		? "Bitte formuliere deine letzte Antwort ausführlicher und länger, mit mehr Details."
		: mode === "shorter"
		? "Bitte formuliere deine letzte Antwort kürzer und knapper, auf das Wesentliche reduziert."
		: "Bitte formuliere deine letzte Antwort in etwa gleicher Länge neu — anderer Wortlaut, gleicher Inhalt und Umfang.";
	// Alte Antwort sofort entfernen — sie verschwindet augenblicklich aus dem Log.
	list.splice(idx, 1);
	S.aiBusy = true;
	S.aiActiveChatType = isSide ? "side" : "full";
	S.aiStatus = "…denkt nach…";
	S.aiDraft = "";
	S.aiThinkingDraft = "";
	if (isSide) renderChat(); else renderMainChatLog();
	let renderQueued = false;
	function scheduleRender() {
		if (renderQueued) return;
		renderQueued = true;
		requestAnimationFrame(() => {
			renderQueued = false;
			if (isSide) renderChat(); else renderMainChatLog();
		});
	}
	let newContent = msg.content;
	try {
		newContent = await AI.refine(history, instruction, (text) => {
			S.aiDraft = text;
			scheduleRender();
		});
	} catch (err) {
		U.toast("Anpassen fehlgeschlagen: " + err.message, "error");
	}
	S.aiBusy = false;
	S.aiDraft = "";
	S.aiThinkingDraft = "";
	// Neue Antwort an derselben Stelle wieder einsetzen (gleiche mid, damit z.B. spätere
	// Bearbeitungsprüfungen weiter konsistent bleiben).
	list.splice(idx, 0, { mid, role: "assistant", content: newContent, reasoning: msg.reasoning || null, reasoningExpanded: false });
	saveCurrentChat();
	render();
}

// ---------- Gemeinsame Sende-Logik für Seitenpanel UND Vollbild-Chat-Tab ----------
export async function sendChatMessage(text, type) {
	type = type || "side";
	if ((!text && !S.pendingImage && !S.pendingTextFile) || S.aiBusy) return;
	S.aiBusy = true;
	S.aiActiveChatType = type;
	S.aiStatus = "…denkt nach…";
	S.aiDraft = "";
	S.aiThinkingDraft = "";
	S.thinkingLiveExpanded = false;
	if (type === "side") renderChat();
	else renderMainChatLog();
	try {
		const fallback = S.pendingTextFile ? "Fasse die angehängte Datei zusammen." : "Beschreibe das angehängte Bild.";
		await AI.agent(text || fallback, type, (tool) => {
			S.aiStatus = "⚙ " + tool + "…";
			if (type === "side") renderChat();
			else renderMainChatLog();
		});
	} catch (err) {
		const targetList = type === "side" ? S.sideChat : S.chat;
		targetList.push({ mid: U.uid(), role: "assistant", content: "⚠️ " + err.message });
	}
	S.aiBusy = false;
	S.aiDraft = "";
	S.aiThinkingDraft = "";
	if (type === "full") saveCurrentChat();
	render();
}

// Event-Delegation-Hilfen aus app.js:
export function handleReasoningToggle(t) {
	if (t.id === "btnThinkLive") {
		S.thinkingLiveExpanded = !S.thinkingLiveExpanded;
		renderChat();
		return;
	}
	const m = S.chat.find((x) => x.mid === t.dataset.reasoningtoggle) || S.sideChat.find((x) => x.mid === t.dataset.reasoningtoggle);
	if (m) {
		m.reasoningExpanded = !m.reasoningExpanded;
		renderChat();
		if (S.view === "chat") renderMainChatLog();
	}
}

export function handleDiffCardToggle(t) {
	const m = S.chat.find((x) => x.mid === t.dataset.difftoggle) || S.sideChat.find((x) => x.mid === t.dataset.difftoggle);
	if (m) {
		m.diffExpanded = !m.diffExpanded;
		if (m.diffExpanded && m.pageId) {
			S.highlightedPageId = m.pageId;
			S.highlightedDiff = U.diffLines(m.before.content, m.after.content);
			openPage(m.pageId);
			setTimeout(() => {
				const el = document.querySelector(".blk.highlight-add");
				if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
			}, 100);
		} else {
			S.highlightedPageId = null;
			S.highlightedDiff = null;
		}
		if (S.view === "chat") renderMainChatLog();
		renderChat();
	}
}

export async function handleUndo(t) {
	const m = S.chat.find((x) => x.mid === t.dataset.undo) || S.sideChat.find((x) => x.mid === t.dataset.undo);
	if (m && !m.undone) {
		if (m.created) {
			await STATE.dispatch("pageDelete", { id: m.pageId });
		} else {
			await STATE.dispatch("pageUpdate", { id: m.pageId, patch: { title: m.before.title, content: m.before.content } });
		}
		m.undone = true;
		saveCurrentChat();
		renderChat();
		if (S.view === "chat") renderMainChatLog();
	}
}

export function handleFileDownload(t) {
	const m = S.chat.find((x) => x.mid === t.dataset.filedownload) || S.sideChat.find((x) => x.mid === t.dataset.filedownload);
	if (m && m.textFile) U.downloadText(m.textFile.name, m.textFile.content);
}

export async function handleModelMenuToggle(t) {
	S.modelMenuAnchor = t.id === "btnModelChipFull" ? "full" : "panel";
	S.modelMenuOpen = !S.modelMenuOpen;
	S.customModelProviderPick = S.settings.aiProviderId;
	renderModelMenu();
	if (S.modelMenuOpen && !S.availableModels.length) {
		S.modelMenuLoading = true;
		renderModelMenu();
		const models = await AI.listModels();
		S.modelMenuLoading = false;
		S.availableModels = models;
		renderModelMenu();
	}
}

export function handleDeleteChat(t) {
	if (confirm("Diesen Chat wirklich löschen?")) {
		const list = CHATS.load().filter((x) => x.id !== t.dataset.chatdel);
		CHATS.save(list);
		const tabId = "chat:" + t.dataset.chatdel;
		if (S.tabs.includes(tabId)) { S.tabs = S.tabs.filter((id) => id !== tabId); }
		if (S.currentChatId === t.dataset.chatdel) {
			S.chat = []; S.currentChatId = null;
			if (S.activeTabId === tabId) { S.view = "home"; S.activeTabId = null; }
		}
		render();
	}
}

export function handleEditUserMessage(t) {
	const isSide = S.sideChat.some((x) => x.mid === t.dataset.editmsg);
	const targetChat = isSide ? S.sideChat : S.chat;
	const idx = targetChat.findIndex((x) => x.mid === t.dataset.editmsg);
	if (idx !== -1) {
		const hasUnresolvedEdits = targetChat.slice(idx + 1).some((x) => x.role === "edit" && !x.undone);
		if (hasUnresolvedEdits) {
			U.toast("Diese Nachricht lässt sich erst bearbeiten, wenn die späteren Seitenänderungen rückgängig gemacht wurden — nutze „Rückgängig machen“ bei den Änderungs-Karten weiter unten.", "error");
			return;
		}
		const old = targetChat[idx];
		if (isSide) S.sideChat = S.sideChat.slice(0, idx);
		else S.chat = S.chat.slice(0, idx);
		render();
		const inp = S.view === "chat" ? U.el("mainChatInput") : U.el("chatInput");
		if (inp) { inp.value = old.content || ""; inp.focus(); }
	}
}

export function handleAnswerQuestion(t) {
	AI.resolveChoice(t.dataset.answerq, t.dataset.answer);
}

export function handleRefineToggle(t) {
	S.refineOpenMid = S.refineOpenMid === t.dataset.refinetoggle ? null : t.dataset.refinetoggle;
	renderChat();
	if (S.view === "chat") renderMainChatLog();
}

export async function handleRefineSelect(t) {
	// FIX: Menü jetzt SOFORT schließen + rendern, bevor auf die KI-Antwort gewartet wird
	// (vorher blieb es sichtbar, bis der erste Streaming-Chunk ankam).
	S.refineOpenMid = null;
	renderChat();
	if (S.view === "chat") renderMainChatLog();
	await refineMessage(t.dataset.refine, t.dataset.mode);
}

// FIX: Menü unsichtbar vermessen, dann je nach Platz ÜBER oder unter dem Button
// positionieren (vorher: immer unterhalb + window.scrollY -> bei position:fixed
// falsch berechnet, Menü landete oft außerhalb des sichtbaren Bereichs).
export function handleAttachMenuToggle(t) {
	const m = U.el("attachMenu");
	if (!m) return;
	if (m.hidden) {
		const rect = t.getBoundingClientRect();
		m.style.position = "fixed";
		m.style.visibility = "hidden";
		m.hidden = false;
		let top = rect.top - m.offsetHeight - 4;
		if (top < 8) top = rect.bottom + 4;
		let left = Math.min(rect.left, window.innerWidth - m.offsetWidth - 8);
		if (left < 8) left = 8;
		m.style.top = Math.round(top) + "px";
		m.style.left = Math.round(left) + "px";
		m.style.visibility = "visible";
	} else {
		m.hidden = true;
	}
}

export function handleRemoveImage() {
	S.pendingImage = null;
	renderPendingChip();
}

export function handleRemoveTextFile() {
	S.pendingTextFile = null;
	renderPendingChip();
}

export async function handleFilePdfChange(e) {
	if (e.target.files[0]) {
		const file = e.target.files[0];
		e.target.value = "";
		S.aiBusy = true;
		try {
			await PDFS.ingest(file, (st) => { S.aiStatus = st; renderChat(); });
			S.chat.push({ mid: U.uid(), role: "assistant", content: "📄 **" + file.name + "** wurde einsortiert und zusammengefasst." });
		} catch (err) {
			S.chat.push({ mid: U.uid(), role: "assistant", content: "⚠️ PDF-Import fehlgeschlagen: " + err.message });
		}
		S.aiBusy = false;
		saveCurrentChat();
		render();
	}
}

export function handleFileImgChange(e) {
	if (e.target.files[0]) {
		const file = e.target.files[0];
		e.target.value = "";
		const r = new FileReader();
		r.onload = () => { S.pendingImage = r.result; renderPendingChip(); };
		r.readAsDataURL(file);
	}
}

export function handlePaste(e) {
	if (e.target.id !== "chatInput" && e.target.id !== "mainChatInput") return;
	// FIX (Audit): window.clipboardData war ein toter IE-Fallback — entfernt.
	const text = e.clipboardData ? e.clipboardData.getData("text/plain") || "" : "";
	const lines = text.split("\n").length;
	if (text.length > 600 || lines > 15) {
		e.preventDefault();
		S.pendingTextFile = { name: "geklebter-text.txt", content: text, size: text.length };
		renderPendingChip();
	}
}

export const CHAT_FULLSCREEN = {
	saveCurrentChat,
	toggleChatFull,
	refineMessage,
	sendChatMessage,
	handleReasoningToggle,
	handleDiffCardToggle,
	handleUndo,
	handleFileDownload,
	handleModelMenuToggle,
	handleDeleteChat,
	handleEditUserMessage,
	handleAnswerQuestion,
	handleRefineToggle,
	handleRefineSelect,
	handleAttachMenuToggle,
	handleRemoveImage,
	handleRemoveTextFile,
	handleFilePdfChange,
	handleFileImgChange,
	handlePaste,
};