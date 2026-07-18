"use strict";

import { S, STATE } from "./state.js";
import { CHATS } from "./chats.js";
import { AI } from "./ai.js";
import { U } from "./util.js";
import { PDFS } from "./pdfs.js";
import { RENDER } from "./render.js";
import { POPOVERS } from "./popovers.js";
import { TABS } from "./tabs.js";
import { VOICE } from "./voice.js";

const render = (...args) => RENDER.render(...args);
const renderChat = (...args) => RENDER.renderChat(...args);
const renderMainChatLog = (...args) => RENDER.renderMainChatLog(...args);
const renderPendingChip = (...args) => RENDER.renderPendingChip(...args);
const renderModelMenu = (...args) => RENDER.renderModelMenu(...args);
const openPage = (...args) => TABS.openPage(...args);

function saveChat(messages, idKey) {
	if (!messages.length) return;
	const list = CHATS.load();
	let s = S[idKey] ? list.find((x) => x.id === S[idKey]) : null;
	if (!s) {
		s = { id: U.uid(), title: "", created: U.now(), messages: [] };
		S[idKey] = s.id;
		list.unshift(s);
	}
	s.messages = messages;
	s.updated = U.now();
	if (!s.title) {
		const first = messages.find((m) => m.role === "user");
		s.title = first ? String(first.content).slice(0, 60) : "Neuer Chat";
	}
	CHATS.save(list);
}

export function saveCurrentChat() {
	saveChat(S.chat, "currentChatId");
}

// Der kleine Seitenchat wird nach jeder Antwort als eigener Eintrag gesichert und
// erscheint dadurch automatisch links in der Chat-Liste.
export function saveSideChat() {
	saveChat(S.sideChat, "sideChatId");
}

// KI-Vollbildmodus (wie Notion AI)
export function toggleChatFull(force) {
	S.chatFull = force === undefined ? !S.chatFull : force;
	document.body.classList.toggle("chat-full", S.chatFull);
	if (S.chatFull) {
		document.body.classList.remove("panel-collapsed");
		if (typeof RENDER.renderTabs === "function") RENDER.renderTabs();
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
	if (isSide) saveSideChat();
	else saveCurrentChat();
	render();
}

// ---------- Gemeinsame Sende-Logik für Seitenpanel UND Vollbild-Chat-Tab ----------
export async function sendChatMessage(text, type) {
	type = type || "side";
	const hasAttachment = S.pendingAttachmentTarget === type && (S.pendingImage || S.pendingTextFile || S.pendingPdf);
	const hadImage = S.pendingAttachmentTarget === type && !!S.pendingImage;
	if ((!text && !hasAttachment) || S.aiBusy) return;
	S.aiBusy = true;
	S.aiActiveChatType = type;
	S.aiStatus = "…denkt nach…";
	S.aiDraft = "";
	S.aiThinkingDraft = "";
	S.thinkingLiveExpanded = false;
	if (type === "side") renderChat();
	else renderMainChatLog();
	try {
		const fallback = S.pendingAttachmentTarget === type && S.pendingPdf ? "Analysiere das angehängte PDF."
			: S.pendingAttachmentTarget === type && S.pendingTextFile ? "Fasse die angehängte Datei zusammen."
			: "Beschreibe das angehängte Bild.";
		const answer = await AI.agent(text || fallback, type, (tool) => {
			S.aiStatus = "⚙ " + tool + "…";
			if (type === "side") renderChat();
			else renderMainChatLog();
		});
		// Nur Antworten auf eine Spracheingabe vorlesen — getippte Chats bleiben still.
		if (VOICE.consumeReply()) VOICE.speak(answer);
	} catch (err) {
		// Ein fehlgeschlagener Voice-Turn darf nicht die nächste Text-Antwort vorlesen.
		VOICE.consumeReply();
		const targetList = type === "side" ? S.sideChat : S.chat;
		// 👁 Hinweis (18. Juli, spät): Scheitert eine Anfrage MIT Bild, liegt es
		// meist an einem nicht vision-fähigen Modell — das sagen wir klar dazu,
		// ohne an der Modell-Auswahl selbst irgendetwas zu ändern.
		const visionHint = hadImage ? "\n\nℹ️ Die Nachricht enthielt ein Bild. Das aktuell gewählte Modell scheint keine Bilder zu unterstützen (nicht vision-fähig). Wähle für Bild-Fragen ein Vision-Modell oder sende die Frage ohne Bild erneut." : "";
		targetList.push({ mid: U.uid(), role: "assistant", content: "⚠️ " + err.message + visionHint });
	}
	S.aiBusy = false;
	S.aiDraft = "";
	S.aiThinkingDraft = "";
	if (type === "side") saveSideChat();
	else saveCurrentChat();
	render();
}

// Event-Delegation-Hilfen aus app.js:
export function handleReasoningToggle(t) {
	if (t.id === "btnThinkLive") {
		S.thinkingLiveExpanded = !S.thinkingLiveExpanded;
		// Beide Chat-Flächen: Side-Panel und Vollbild (vorher blieb der große Chat stecken).
		renderChat();
		if (S.view === "chat" || S.aiActiveChatType === "full") renderMainChatLog();
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
	// Änderungen werden wie in Notion in einer eigenen Seiten-Vorschau geprüft,
	// ohne die aktuell geöffnete Seite oder den Chat-Kontext zu verlassen.
	if (m) RENDER.openChangePreview(m);
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
		if (S.sideChat.includes(m)) saveSideChat();
		else saveCurrentChat();
		renderChat();
		if (S.view === "chat") renderMainChatLog();
	}
}

export function handleFileDownload(t) {
	const m = S.chat.find((x) => x.mid === t.dataset.filedownload) || S.sideChat.find((x) => x.mid === t.dataset.filedownload);
	if (m && m.textFile) U.downloadText(m.textFile.name, m.textFile.content);
}

export async function handleModelMenuToggle(t) {
	const wasOpen = S.modelMenuOpen && S.modelMenuAnchor === (t.id === "btnModelChipFull" ? "full" : "panel");
	POPOVERS.closeAll("model");
	S.modelMenuAnchor = t.id === "btnModelChipFull" ? "full" : "panel";
	S.modelMenuOpen = !wasOpen;
	S.modelMenuSection = "root";
	S.customModelProviderPick = S.settings.aiProviderId;
	renderModelMenu();
	// Bei jedem Öffnen neu abfragen: besonders LM Studio meldet hier nur die
	// aktuell auf dem Server geladen(en) Modelle.
	if (S.modelMenuOpen) {
		S.modelMenuLoading = true;
		renderModelMenu();
		// FIX: schlug listModels() fehl (Server offline/Netzwerkfehler), blieb das Menü
		// für immer im Lade-Zustand hängen — Fehler abfangen und Laden sauber beenden.
		try {
			S.availableModels = await AI.listModels();
		} catch (e) {
			S.availableModels = [];
			U.toast("Modelle konnten nicht geladen werden: " + (e.message || e), "error");
		}
		S.modelMenuLoading = false;
		renderModelMenu();
		// Die Thinking-Stufen werden nicht aus einer Modellnamenliste geraten:
		// Direkt nach dem Öffnen prüft die App das aktuell gewählte Modell und
		// zeichnet das Menü nach Abschluss mit genau dessen Fähigkeiten neu.
		AI.detectThinkingCapabilities().then(renderModelMenu, renderModelMenu);
	}
}

export async function handleDeleteChat(t) {
	const id = t.dataset.chatdel;
	const s = CHATS.load().find((x) => x.id === id);
	const title = (s && s.title) || "Chat";
	const ok = await U.confirm('„' + title + '“ wirklich löschen? Das kann nicht rückgängig gemacht werden.', {
		title: "Chat löschen", ok: "Löschen", danger: true,
	});
	if (!ok) return;
	const list = CHATS.load().filter((x) => x.id !== id);
	CHATS.save(list);
	const tabId = "chat:" + id;
	if (S.tabs.includes(tabId)) { S.tabs = S.tabs.filter((tid) => tid !== tabId); }
	if (S.currentChatId === id) {
		S.chat = []; S.currentChatId = null;
		if (S.activeTabId === tabId) { S.view = "home"; S.activeTabId = null; }
	}
	render();
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
	const mid = t.dataset.answerq;
	if (!mid) return;
	const idx = Number(t.dataset.answeridx);
	const isSide = S.sideChat.some((x) => x.mid === mid);
	const list = isSide ? S.sideChat : S.chat;
	const msg = list.find((x) => x.mid === mid);
	if (!msg || msg.answered) return;
	const options = Array.isArray(msg.options) ? msg.options : [];
	if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) return;
	const answer = options[idx];
	// Sofort UI fixieren — verhindert Doppelklicks und leere Wartezustände.
	msg.answered = true;
	msg.answer = answer;
	if (isSide) renderChat();
	else renderMainChatLog();
	if (!AI.resolveChoice(mid, answer)) {
		// Kein wartender Agent (z.B. nach Reload): Karte bleibt beantwortet, kein Hang.
		U.toast("Antwort notiert — der vorherige KI-Lauf ist nicht mehr aktiv.", "error");
	}
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
	S.attachTarget = t.id === "btnAttachFull" ? "full" : "side";
	POPOVERS.toggleElement(m, t, { prefer: "above", gap: 4 });
}

export function handleRemoveAttachment() {
	S.pendingImage = null;
	S.pendingTextFile = null;
	S.pendingPdf = null;
	S.pendingAttachmentTarget = null;
	renderPendingChip("side");
	renderPendingChip("full");
}

export const handleRemoveImage = handleRemoveAttachment;
export const handleRemoveTextFile = handleRemoveAttachment;
export const handleRemovePdf = handleRemoveAttachment;

export async function handleFilePdfChange(e) {
	if (!e.target.files[0]) return;
	const file = e.target.files[0];
	e.target.value = "";
	try {
		// PDFs sind jetzt reine Chat-Anhänge: Text wird lokal extrahiert und erst mit
		// der nächsten Nachricht an die KI übergeben. Es wird keine Seite angelegt,
		// nichts automatisch sortiert und nichts im Chat-Verlauf gespeichert.
		const buf = await U.readAsBuffer(file);
		const out = await PDFS.extractText(buf);
		S.pendingPdf = { name: file.name, content: out.text, size: file.size, pages: out.numPages };
		S.pendingAttachmentTarget = S.attachTarget || "side";
		renderPendingChip(S.pendingAttachmentTarget);
	} catch (err) {
		U.toast("PDF konnte nicht gelesen werden: " + err.message, "error");
	}
}

export function handleFileImgChange(e) {
	if (e.target.files[0]) {
		const file = e.target.files[0];
		e.target.value = "";
		const r = new FileReader();
		r.onload = () => {
			S.pendingImage = r.result;
			S.pendingAttachmentTarget = S.attachTarget || "side";
			renderPendingChip(S.pendingAttachmentTarget);
		};
		r.readAsDataURL(file);
	}
}

export function handlePaste(e) {
	if (e.target.id !== "chatInput" && e.target.id !== "mainChatInput") return;
	// 🖼️ FIX (18. Juli, spät): Bilder aus der Zwischenablage (Screenshot,
	// kopiertes Foto) landen jetzt als Bild-Anhang im Chat — vorher funktionierte
	// Einfügen nur für Text.
	const items = e.clipboardData ? [...e.clipboardData.items] : [];
	const imgItem = items.find((it) => it.kind === "file" && it.type.startsWith("image/"));
	if (imgItem) {
		e.preventDefault();
		const file = imgItem.getAsFile();
		if (!file) return;
		const r = new FileReader();
		r.onload = () => {
			S.pendingImage = r.result;
			S.pendingTextFile = null;
			S.pendingPdf = null;
			S.pendingAttachmentTarget = e.target.id === "mainChatInput" ? "full" : "side";
			renderPendingChip(S.pendingAttachmentTarget);
		};
		r.readAsDataURL(file);
		return;
	}
	// FIX (Audit): window.clipboardData war ein toter IE-Fallback — entfernt.
	const text = e.clipboardData ? e.clipboardData.getData("text/plain") || "" : "";
	const lines = text.split("\n").length;
	if (text.length > 600 || lines > 15) {
		e.preventDefault();
		S.pendingTextFile = { name: "geklebter-text.txt", content: text, size: text.length };
		S.pendingAttachmentTarget = e.target.id === "mainChatInput" ? "full" : "side";
		renderPendingChip(S.pendingAttachmentTarget);
	}
}

export const CHAT_FULLSCREEN = {
	saveCurrentChat,
	saveSideChat,
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
	handleRemoveAttachment,
	handleRemoveImage,
	handleRemoveTextFile,
	handleRemovePdf,
	handleFilePdfChange,
	handleFileImgChange,
	handlePaste,
};