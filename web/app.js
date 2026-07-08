"use strict";
import { COLLAPSE } from "./collapse.js";
import { CHATS } from "./chats.js";
import { NOTION_MIGRATOR } from "./import-notion.js";
import { AI } from "./ai.js";
import { DB } from "./db.js";
import { RENDER } from "./render.js";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { SETTINGS } from "./settings.js";
import { LIBRARY } from "./library.js";

const render = (...args) => RENDER.render(...args);
const renderStatusDot = (...args) => RENDER.renderStatusDot(...args);
const renderTabs = (...args) => RENDER.renderTabs(...args);
const openTemplatePicker = (...args) => RENDER.openTemplatePicker(...args);

// app.js — Initialisierung und Event-Verkabelung.
const WELCOME_MD = [
	"Willkommen bei **Impala67** — deiner lokalen Lern-App: Notizen, PDFs und KI in einem. Diese Seite zeigt gleichzeitig alle Funktionen *und* alle Formatierungsmöglichkeiten, die es aktuell gibt.",
	"",
	"## 🗂 Seiten & Organisation",
	"- Workspaces mit einklappbarem Seitenbaum (Pfeil links neben jeder Seite), Zustand bleibt über Neustarts erhalten",
	"- Neue Seiten über das **+** je Workspace, Unterseiten per Hover-**+** oder per Drag & Drop verschieben",
	"- Notion-artiger Seitenkopf: großes Icon, Cover-Verlauf, Breadcrumb (Workspace › Elternseiten › aktuelle Seite)",
	"- Tab-Leiste oben mit Zurück/Vor wie im Browser — zeigt Seiten **und** Chats gemischt",
	"- Bibliothek (🗂-Symbol oben) mit Baum- **oder** Tabellen-Ansicht (Titel/Workspace/Tags/Geändert)",
	"- Schnellsuche mit **Strg+K**, durchsucht Seiten und (im Chat-Modus) auch gespeicherte KI-Chats",
	"",
	"## 🤖 KI-Coach",
	"- Modell frei wählbar aus mehreren gleichzeitig konfigurierten Quellen (Einstellungen → KI): das Dropdown fragt jede Quelle live nach ihren Modellen ab",
	"- Tool-Calling: Seiten lesen/anlegen/ändern/verschieben, Karteikarten erstellen, Volltext- **und** semantische Suche",
	"- **Rückfragen mit Buttons**: ist etwas mehrdeutig, fragt die KI mit anklickbaren Optionen nach, statt zu raten",
	"- Ausklappbarer Denkprozess bei Reasoning-Modellen (▸ Gedankengang anzeigen), standardmäßig eingeklappt",
	"- Edit-Karten mit Diff-Anzeige und **Undo** bei jeder KI-Seitenänderung",
	"- **✦ Anpassen**-Button an jeder Antwort: länger oder kürzer umformulieren lassen (wie bei Gemini)",
	"- Nachrichten lassen sich nachträglich bearbeiten (✎-Symbol beim Hover)",
	"- Chats als eigene Vollbild-Tabs oder schnell im Seitenpanel; Chats löschbar, mit Schließen-Warnung bei offenen Fragen",
	"- Lange geklebte Texte werden automatisch als .txt-Datei angehängt statt den Chat vollzuschreiben",
	"- Eigene Anweisungen an die KI unter Einstellungen → KI (nur was du dort einträgst, keine automatischen Annahmen)",
	"",
	"## 📄 PDFs, Bilder, Karteikarten",
	"- PDF hochladen → Text lokal extrahiert → KI vergibt Titel/Ablageort/Zusammenfassung/Tags automatisch",
	"- Bilder direkt an die KI (Vision-fähige Modelle)",
	"- Anki-ähnliche Karteikarten mit FSRS-lite-Wiederholung (Nochmal/Schwer/Gut/Einfach)",
	"",
	"## ☁️ Sync, Backup & Migration",
	"- Google-Drive-Sync: einmalig Client-ID hinterlegen, danach nur noch **Anmelden**-Klick (Einstellungen → Sync)",
	"- Manuelles Export/Import als JSON (Einstellungen → Backup), konfliktfrei zusammenführbar",
	"- Notion-Import per Integrationstoken (Einstellungen → Notion Import), mit Fortschrittsbalken",
	"",
	"## ✨ Formatierung — alles unten ist *live* nutzbar",
	"**Fett**, *kursiv*, ~~durchgestrichen~~, `Inline-Code`, ==markierter Text== und [Links](https://example.com).",
	"",
	"### Listen & Aufgaben",
	"- Aufzählung eins",
	"- Aufzählung zwei",
	"1. Nummeriert eins",
	"2. Nummeriert zwei",
	"- [x] Erledigte Aufgabe",
	"- [ ] Offene Aufgabe",
	"",
	"### Zitat",
	"> Wissen ist wie ein Garten: Wird er nicht gepflegt, kann man nichts ernten.",
	"",
	"### Aufklappbarer Toggle-Block (über das Slash-Menü „/“ einfügbar)",
	"<details><summary>Klick zum Aufklappen</summary>\nHier steht der versteckte Inhalt — super für Zusatzinfos, ohne die Seite vollzuschreiben.\n</details>",
	"",
	"### Code mit Syntax-Highlighting",
	"```javascript\nfunction gruss(name) {\n\treturn \"Hallo, \" + name + \"!\";\n}\n```",
	"",
	"### LaTeX — live gerendert, auch im Chat (das kann Notion nicht)",
	"Inline: die Kreisfläche ist $A = \\pi r^2$.",
	"",
	"Als eigene Zeile:",
	"$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$",
	"",
	"### Tabelle",
	"| Feature | Status |",
	"| --- | --- |",
	"| LaTeX live | ✅ |",
	"| Toggle-Blöcke | ✅ |",
	"| Datenbank-Ansicht | ✅ (einfache Tabellen-Ansicht) |",
	"",
	"---",
	"*(Der Strich darüber ist eine Trennlinie — auch das geht einfach per `---` in eigener Zeile.)*",
].join("\n");

async function seedIfEmpty() {
	if (Object.keys(S.pages).length) return;
	const id = U.uid();
	await STATE.dispatch("pageCreate", { id, title: "👋 Willkommen", content: WELCOME_MD, workspaceId: "default" });
	S.currentPageId = id;
}



function saveCurrentChat() {
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

function closeOverlay() {
	const o = U.el("overlay");
	o.hidden = true;
	o.innerHTML = "";
	S.reviewShowBack = false;
}

// KI-Vollbildmodus (wie Notion AI)
function toggleChatFull(force) {
	S.chatFull = force === undefined ? !S.chatFull : force;
	document.body.classList.toggle("chat-full", S.chatFull);
	if (S.chatFull) {
		document.body.classList.remove("panel-collapsed");
		U.el("btnShowPanel").hidden = true;
	}
}

// Eigener Eingabe-Dialog statt window.prompt() — nutzt das #overlay wie alle anderen Dialoge.
function openPromptDialog(title, onSubmit, initial) {
	const o = U.el("overlay");
	if (!o) return;
	o.innerHTML = '<div class="modal modal-sm">' +
		"<h3>" + U.esc(title) + "</h3>" +
		'<input id="dlgPromptInput" autocomplete="off" value="' + U.esc(initial || "") + '">' +
		'<div class="modal-actions"><button id="dlgPromptCancel">Abbrechen</button><button id="dlgPromptOk">OK</button></div>' +
		"</div>";
	o.hidden = false;
	const inp = U.el("dlgPromptInput");
	const submit = () => { const v = inp.value.trim(); closeOverlay(); if (v) onSubmit(v); };
	U.el("dlgPromptOk").addEventListener("click", submit);
	U.el("dlgPromptCancel").addEventListener("click", () => closeOverlay());
	inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
	inp.focus();
	inp.select();
}

// „Verschieben nach…“-Dialog: Ziel wählen (Workspace-Wurzel oder Seite, ohne eigene Nachfahren).
function openMoveDialog(pageId) {
	const o = U.el("overlay");
	const pg = S.pages[pageId];
	if (!o || !pg) return;
	const bad = new Set([pageId]);
	(function collect(pid) {
		for (const p of Object.values(S.pages)) if (p.parentId === pid && !bad.has(p.id)) { bad.add(p.id); collect(p.id); }
	})(pageId);
	let items = "";
	for (const ws of Object.values(S.workspaces)) {
		items += '<button class="menu-item" data-movetarget="ws:' + U.esc(ws.id) + '">📁 ' + U.esc(ws.name) + "</button>";
		const walk = (parentId, depth) => {
			for (const p of STATE.childrenOf(parentId, ws.id)) {
				if (bad.has(p.id) || p.trashed) continue;
				items += '<button class="menu-item" data-movetarget="pg:' + p.id + '" style="padding-left:' + (14 + depth * 16) + 'px">' +
					(p.icon ? U.esc(p.icon) + " " : "📝 ") + U.esc(p.title) + "</button>";
				walk(p.id, depth + 1);
			}
		};
		walk(null, 1);
	}
	o.innerHTML = '<div class="modal modal-sm"><h3>„' + U.esc(pg.title) + '“ verschieben nach…</h3>' +
		'<div class="move-list">' + items + "</div>" +
		'<div class="modal-actions"><button id="dlgMoveCancel">Abbrechen</button></div></div>';
	o.hidden = false;
	S.movePageId = pageId;
	U.el("dlgMoveCancel").addEventListener("click", () => closeOverlay());
}



function isDescendant(childId, ancestorId) {
	let cur = S.pages[childId];
	while (cur && cur.parentId) {
		if (cur.parentId === ancestorId) return true;
		cur = S.pages[cur.parentId];
	}
	return false;
}

// ---------- Zentrale Navigation: hält Tabs + Zurück/Vor-Verlauf synchron (Seiten UND Chats) ----------
function openPage(pageId, opts) {
	opts = opts || {};
	document.body.classList.remove("sidebar-open"); // Mobile: Off-Canvas-Sidebar schließen
	if (S.highlightedPageId && S.highlightedPageId !== pageId) {
		S.highlightedPageId = null;
		S.highlightedDiff = null;
	}
	const isChat = String(pageId).startsWith("chat:");
	if (isChat) {
		const chatId = pageId.slice(5);
		S.currentChatId = chatId;
		const s = CHATS.load().find((x) => x.id === chatId);
		S.chat = s ? s.messages || [] : [];
		S.view = "chat";
	} else {
		const pg = S.pages[pageId];
		if (!pg) return;
		S.currentPageId = pageId;
		S.currentWorkspaceId = pg.workspaceId || "default";
		S.view = "page";
	}
	if (!S.tabs.includes(pageId)) {
		S.tabs.push(pageId);
		if (S.tabs.length > 10) S.tabs.shift();
	}
	S.activeTabId = pageId;
	if (!opts.skipHistory) {
		S.navHistory = S.navHistory.slice(0, S.navIndex + 1);
		S.navHistory.push(pageId);
		S.navIndex = S.navHistory.length - 1;
	}
	if (document.activeElement) document.activeElement.blur();
	render();
}

function closeTab(pageId) {
	const idx = S.tabs.indexOf(pageId);
	if (idx === -1) return;
	if (pageId.startsWith("chat:")) {
		const chatId = pageId.slice(5);
		const isActiveChat = S.currentChatId === chatId;
		const messages = isActiveChat ? S.chat : ((CHATS.load().find((x) => x.id === chatId) || {}).messages || []);
		const busy = isActiveChat && S.aiBusy;
		const lastIsUser = messages.length && messages[messages.length - 1].role === "user";
		if (busy || lastIsUser) {
			const msg = busy ? "Die KI antwortet gerade noch — Chat trotzdem schließen?" : "Diese Frage wurde noch nicht beantwortet — Chat trotzdem schließen?";
			if (!confirm(msg)) return;
		}
	}
	S.tabs.splice(idx, 1);
	if (S.activeTabId === pageId) {
		const next = S.tabs[idx] || S.tabs[idx - 1] || null;
		if (next) {
			openPage(next, { skipHistory: true });
		} else {
			S.view = "home";
			S.currentPageId = null;
			S.activeTabId = null;
			render();
		}
	} else {
		renderTabs();
	}
}

function navBack() {
	if (S.navIndex <= 0) return;
	S.navIndex--;
	const id = S.navHistory[S.navIndex];
	if (id) openPage(id, { skipHistory: true });
}

function navForward() {
	if (S.navIndex >= S.navHistory.length - 1) return;
	S.navIndex++;
	const id = S.navHistory[S.navIndex];
	if (id) openPage(id, { skipHistory: true });
}

// Dupliziert eine Seite samt aller Unterseiten (wie in Notion), "(Kopie)" an den Titel angehängt.
async function duplicatePage(pageId, newParentId, newWsId) {
	const pg = S.pages[pageId];
	if (!pg) return null;
	const id = U.uid();
	const parentId = newParentId !== undefined ? newParentId : pg.parentId;
	const wsId = newWsId || pg.workspaceId;
	await STATE.dispatch("pageCreate", {
		id, title: pg.title + (newParentId === undefined ? " (Kopie)" : ""), parentId, content: pg.content,
		workspaceId: wsId, icon: pg.icon, cover: pg.cover, coverImg: pg.coverImg, tags: pg.tags,
	});
	const kids = STATE.childrenOf(pg.id, pg.workspaceId);
	await Promise.all(kids.map((kid) => duplicatePage(kid.id, id, wsId))); // parallel statt sequenziell
	return id;
}

// Neue Seite anlegen — optional mit Vorlage (tpl): übernimmt Titel/Inhalt/Icon/Tags der Vorlage.
async function createPageIn(wsId, parentId, tpl) {
	const id = U.uid();
	S.currentWorkspaceId = wsId || S.currentWorkspaceId;
	await STATE.dispatch("pageCreate", {
		id, title: tpl ? tpl.title : "Neue Seite", parentId: parentId || null,
		content: tpl ? tpl.content : "", icon: tpl ? tpl.icon : null, tags: tpl ? tpl.tags : [],
		workspaceId: S.currentWorkspaceId,
	});
	openPage(id);
	render();
	const ti = document.getElementById("pageTitle");
	if (ti) { ti.focus(); ti.select(); }
}

// Gibt es Vorlagen, zuerst die Auswahl zeigen (wie Notions Vorlagen-Picker); sonst direkt anlegen.
async function newPageFlow(wsId, parentId) {
	const tpls = STATE.activePages().filter((p) => p.isTemplate);
	if (tpls.length) {
		S.pendingNewPage = { wsId, parentId };
		openTemplatePicker();
	} else {
		await createPageIn(wsId, parentId);
	}
}

// Karteikarten-Bereich öffnen (🃏-Tab oben links): Stapel/Browser/Statistik/Lernen
function openAnki(tab, deck) {
	S.view = "anki";
	S.sidebarMode = "files"; // Sidebar zeigt wieder den Stapel-Baum, falls zuvor der Chat-Modus aktiv war
	S.ankiTab = tab || "decks";
	if (deck !== undefined) S.ankiDeck = deck;
	S.reviewShowBack = false;
	toggleChatFull(false);
	if (document.activeElement) document.activeElement.blur();
	render();
}

// Daily Note eines Tages öffnen — Seite (und der 📅-Sammelordner) werden bei Bedarf angelegt.
async function openDailyNote(key) {
	let pg = STATE.activePages().find((p) => p.daily === key);
	if (!pg) {
		let root = STATE.activePages().find((p) => p.dailyRoot);
		if (!root) {
			const rid = U.uid();
			await STATE.dispatch("pageCreate", { id: rid, title: "Daily Notes", icon: "📅", workspaceId: "default", dailyRoot: true });
			root = S.pages[rid];
		}
		const id = U.uid();
		const d = new Date(key + "T12:00:00");
		const title = d.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
		await STATE.dispatch("pageCreate", {
			id, title, parentId: root.id, workspaceId: root.workspaceId || "default",
			icon: "📅", daily: key, content: "",
		});
		pg = S.pages[id];
	}
	if (pg) openPage(pg.id);
}

// Ganzen Workspace als ZIP voller Markdown-Dateien exportieren (Ordnerstruktur = Seitenbaum)


// Öffnet den Seitenverlauf (Versionen aus dem Event-Log rekonstruiert).
async function openHistory(pageId) {
	const versions = await STATE.pageHistory(pageId);
	S.histVersions = versions;
	S.histIndex = versions.length - 1;
	S.histPageId = pageId;
	renderHistoryModal();
}

// Formuliert eine KI-Antwort länger oder kürzer um (wie Gemini) — ersetzt die
// Antwort an Ort und Stelle, ohne eine neue Chat-Nachricht anzuhängen.
async function refineMessage(mid, mode) {
	if (S.aiBusy) return;
	const idx = S.chat.findIndex((x) => x.mid === mid);
	if (idx === -1) return;
	const msg = S.chat[idx];
	S.aiBusy = true;
	const history = S.chat.slice(0, idx)
		.filter((m) => m.role === "user" || m.role === "assistant")
		.map((m) => ({ role: m.role, content: m.content || "" }));
	history.push({ role: "assistant", content: msg.content });
	const instruction = mode === "longer"
		? "Bitte formuliere deine letzte Antwort ausführlicher und länger, mit mehr Details."
		: "Bitte formuliere deine letzte Antwort kürzer und knapper, auf das Wesentliche reduziert.";
	let renderQueued = false;
	try {
		const newContent = await AI.refine(history, instruction, (text) => {
			msg.content = text;
			// Auch hier Renders bündeln statt bei jedem Token das ganze Log neu aufzubauen.
			if (renderQueued) return;
			renderQueued = true;
			requestAnimationFrame(() => {
				renderQueued = false;
				renderChat();
				if (S.view === "chat") renderMainChatLog();
			});
		});
		msg.content = newContent;
	} catch (err) {
		alert("Anpassen fehlgeschlagen: " + err.message);
	}
	S.aiBusy = false;
	saveCurrentChat();
	render();
}

// ---------- Gemeinsame Sende-Logik für Seitenpanel UND Vollbild-Chat-Tab ----------
async function sendChatMessage(text, type) {
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

// NOTION_MIGRATOR ist jetzt in import-notion.js ausgelagert.



function wireEvents() {
	// Datenbank-Tabellen: Zellwert speichern (props der Zeilen-Seite) — normales
	// pageUpdate-Event, damit Verlauf, Diff und Notion-Sync die Änderung mitbekommen.
	document.addEventListener("change", async (e) => {
		const cell = e.target.closest(".db-cell");
		if (!cell) return;
		const row = S.pages[cell.dataset.dbrow];
		if (!row) return;
		const props = { ...(row.props || {}) };
		props[cell.dataset.dbcol] = cell.value;
		await STATE.dispatch("pageUpdate", { id: row.id, patch: { props } });
	});
	// „＋ Neue Zeile“ in der Datenbank-Ansicht — wird beim nächsten Sync als echte Notion-Zeile angelegt
	document.addEventListener("click", async (e) => {
		const btn = e.target.closest("[data-dbnewrow]");
		if (!btn) return;
		const dbPg = S.pages[btn.dataset.dbnewrow];
		if (!dbPg) return;
		await STATE.dispatch("pageCreate", { id: U.uid(), title: "Neue Zeile", parentId: dbPg.id, workspaceId: dbPg.workspaceId || "default", props: {} });
	});

	// Intercept clicks on links pointing to local pages
	document.addEventListener("click", (e) => {
		const a = e.target.closest("a");
		if (!a) return;
		const href = a.getAttribute("href") || "";
		const id = href.replace(/^(#|\/)/, "").replace(/-/g, "");
		if (S.pages[id]) {
			e.preventDefault();
			openPage(id);
		}
	});

	// Klicks (Delegation) — alle interaktiven Elemente sind explizit gelistet,
	// damit sie unabhängig vom Tag (button/span) zuverlässig ausgelöst werden.
	const CLICKABLE = "[data-page],[data-grade],[data-set],[data-chat],[data-newchat],[data-newpage]," +
		"[data-collapse],[data-crumbws],[data-tabopen],[data-tabclose],[data-undo],[data-difftoggle]," +
		"[data-reasoningtoggle],[data-iconset],[data-coverset],[data-coverpick],[data-coverremove]," +
		"[data-iconpick],[data-filedownload],[data-modelset],[data-chatdel],[data-editmsg]," +
		"[data-answerq],[data-refinetoggle],[data-refine],[data-inserttoggle],[data-insertmark],[data-libview]," +
		"[data-libws],[data-libinto],[data-libroot]," +
		"[data-ankitab],[data-ankistudy],[data-ankigrade],[data-ankishowback],[data-ankisort],[data-ankimore],[data-ankideckfilter]," +
		"[data-ankisuspend],[data-ankidel],[data-ankiedit],[data-ankinewcard],[data-cardeditorsave]," +
		"[data-dailyday],[data-dailynav],[data-zipws]," +
		"[data-deckopen],[data-decknew],[data-decksub],[data-deckrename],[data-deckdel],[data-deckmenu],[data-deckduplicate],[data-libnew]," +
		"[data-pagemenu],[data-pagerename],[data-pageduplicate],[data-pagetrash],[data-pagerestore],[data-pagepurge]," +
		"[data-pagetemplate],[data-tplblank],[data-tpluse],[data-libsort],[data-histversion],[data-renamename],[data-deckrenamename],button";

	document.addEventListener("click", async (e) => {
		const t = e.target.closest(CLICKABLE);
		if (!t) {
			U.el("attachMenu").hidden = true;
			if (S.modelMenuOpen && !e.target.closest(".model-menu")) { S.modelMenuOpen = false; renderModelMenu(); }
			if (S.pageMenuOpenId && !e.target.closest(".page-menu")) { S.pageMenuOpenId = null; renderSidebar(); }
			if (S.deckMenuOpenName && !e.target.closest(".page-menu")) { S.deckMenuOpenName = null; renderSidebar(); }
			return;
		}
		if (t.id !== "btnModelMenu" && t.id !== "btnModelChipFull" && !t.closest(".model-menu") && S.modelMenuOpen) { S.modelMenuOpen = false; renderModelMenu(); }
		if (!t.dataset.pagemenu && !t.closest(".page-menu") && S.pageMenuOpenId && !t.dataset.renamename) { S.pageMenuOpenId = null; renderSidebar(); }
		if (!t.dataset.deckmenu && !t.closest(".page-menu") && S.deckMenuOpenName && !t.dataset.deckrenamename) { S.deckMenuOpenName = null; renderSidebar(); }

		// Ein-/Ausklappen (Workspace oder Seite mit Unterseiten)
		if (t.dataset.collapse) {
			COLLAPSE.toggle(t.dataset.collapse);
			if (S.view === "library") renderMain(); else renderSidebar();
			return;
		}

		// Icon-/Cover-Auswahl
		if (t.dataset.iconpick) { openIconPicker(); return; }
		if (t.dataset.coverpick) { openCoverPicker(); return; }
		if (t.dataset.coverremove) {
			if (S.currentPageId) await STATE.dispatch("pageUpdate", { id: S.currentPageId, patch: { cover: null, coverImg: null } });
			return;
		}
		if (t.hasAttribute("data-iconset")) {
			if (S.currentPageId) await STATE.dispatch("pageUpdate", { id: S.currentPageId, patch: { icon: t.dataset.iconset || null } });
			closeOverlay();
			render();
			return;
		}
		if (t.hasAttribute("data-coverset")) {
			if (S.currentPageId) await STATE.dispatch("pageUpdate", { id: S.currentPageId, patch: { cover: t.dataset.coverset || null, coverImg: null } });
			closeOverlay();
			render();
			return;
		}

		// Breadcrumb: Workspace-Segment öffnet Home für diesen Workspace
		if (t.dataset.crumbws) {
			const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
			if (pg) S.currentWorkspaceId = pg.workspaceId || "default";
			S.view = "home";
			render();
			return;
		}

		// Tab-Leiste: Tab öffnen / schließen
		if (t.dataset.tabopen) { openPage(t.dataset.tabopen); return; }
		if (t.dataset.tabclose) { closeTab(t.dataset.tabclose); return; }

		// Thinking-Prozess: live (während Streaming) oder finalisiert ausklappen
		if (t.id === "btnThinkLive") { S.thinkingLiveExpanded = !S.thinkingLiveExpanded; renderChat(); return; }
		if (t.dataset.reasoningtoggle) {
			// Wie beim Diff-Toggle: die Nachricht kann im Seitenpanel-Chat (S.sideChat) ODER im
			// Vollbild-Chat-Tab (S.chat) liegen — vorher wurde nur S.chat durchsucht, wodurch sich
			// der Gedankengang im Seitenpanel-Chat nie ausklappen ließ (Bug).
			const m = S.chat.find((x) => x.mid === t.dataset.reasoningtoggle) || S.sideChat.find((x) => x.mid === t.dataset.reasoningtoggle);
			if (m) {
				m.reasoningExpanded = !m.reasoningExpanded;
				renderChat();
				if (S.view === "chat") renderMainChatLog();
			}
			return;
		}

		// Edit-Karte: Diff ein-/ausblenden, Rückgängig machen
		if (t.dataset.difftoggle) {
			const m = S.chat.find((x) => x.mid === t.dataset.difftoggle) || S.sideChat.find((x) => x.mid === t.dataset.difftoggle);
			if (m) { m.diffExpanded = !m.diffExpanded;
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
				if (S.view === "chat") renderMainChatLog(); renderChat(); }
			return;
		}
		if (t.dataset.undo) {
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
			return;
		}

		// Datei-Chip im Chat: geklebten Text als .txt herunterladen
		if (t.dataset.filedownload) {
			const m = S.chat.find((x) => x.mid === t.dataset.filedownload) || S.sideChat.find((x) => x.mid === t.dataset.filedownload);
			if (m && m.textFile) U.downloadText(m.textFile.name, m.textFile.content);
			return;
		}

		// Modell aus der eigenen Dropdown-Liste wählen (Wert kodiert als "quelleId::modell")
		if (t.dataset.modelset) {
			const raw = t.dataset.modelset;
			const sep = raw.indexOf("::");
			const providerId = sep === -1 ? S.settings.aiProviderId : raw.slice(0, sep);
			const model = sep === -1 ? raw : raw.slice(sep + 2);
			await STATE.dispatch("settingsSet", { aiProviderId: providerId, aiModel: model });
			S.modelMenuOpen = false;
			renderModelBar();
			SETTINGS.checkAI();
			return;
		}

		// Quelle entfernen (Einstellungen → KI)
		if (t.dataset.provdel) {
			const providers = (S.settings.aiProviders || []).filter((p) => p.id !== t.dataset.provdel);
			await STATE.dispatch("settingsSet", { aiProviders: providers });
			SETTINGS.openSettings("ki");
			return;
		}

		// Quelle für ein eigenes Modell wählen (Chips im Modell-Dropdown) — Eingabe bleibt erhalten
		if (t.dataset.customprov) {
			const keep = (document.getElementById("customModelInput") || {}).value || "";
			S.customModelProviderPick = t.dataset.customprov;
			renderModelMenu();
			const inp2 = document.getElementById("customModelInput");
			if (inp2) { inp2.value = keep; inp2.focus(); }
			return;
		}

		// Eigenes Modell für die gewählte Quelle setzen (unten im Modell-Dropdown)
		if (t.dataset.modelcustomapply) {
			const inp = document.getElementById("customModelInput");
			const providerId = S.customModelProviderPick || S.settings.aiProviderId;
			const model = inp ? inp.value.trim() : "";
			if (model) {
				await STATE.dispatch("settingsSet", { aiProviderId: providerId, aiModel: model });
				S.modelMenuOpen = false;
				renderModelBar();
				SETTINGS.checkAI();
			}
			return;
		}

		// KI-Chat aus der Liste löschen
		if (t.dataset.chatdel) {
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
			return;
		}

		// Nutzer-Nachricht nachträglich bearbeiten: Nachricht + alles Folgende entfernen,
		// Text zurück ins Eingabefeld legen, damit man sie geändert erneut senden kann.
		// Wie in Notion: Solange nach dieser Nachricht noch nicht rückgängig gemachte
		// Seitenänderungen (edit-Karten) stehen, ist Bearbeiten gesperrt — erst über
		// "Rückgängig machen" bei diesen Karten auflösen, dann lässt sich die Nachricht bearbeiten.
		if (t.dataset.editmsg) {
			const isSide = S.sideChat.some((x) => x.mid === t.dataset.editmsg);
			const targetChat = isSide ? S.sideChat : S.chat;
			const idx = targetChat.findIndex((x) => x.mid === t.dataset.editmsg);
			if (idx !== -1) {
				const hasUnresolvedEdits = targetChat.slice(idx + 1).some((x) => x.role === "edit" && !x.undone);
				if (hasUnresolvedEdits) {
					alert("Diese Nachricht lässt sich erst bearbeiten, wenn die späteren Seitenänderungen rückgängig gemacht wurden — nutze „Rückgängig machen“ bei den Änderungs-Karten weiter unten.");
					return;
				}
				const old = targetChat[idx];
				if (isSide) S.sideChat = S.sideChat.slice(0, idx);
				else S.chat = S.chat.slice(0, idx);
				// Erst NACH dem Rendern greifen, da der Vollbild-Chat-Tab bei jedem Render
				// komplett neu aufgebaut wird (alte Eingabefeld-Referenz wäre sonst verwaist).
				render();
				const inp = S.view === "chat" ? U.el("mainChatInput") : U.el("chatInput");
				if (inp) { inp.value = old.content || ""; inp.focus(); }
			}
			return;
		}

		// Rückfrage-Karte: Option anklicken löst den wartenden Agent-Loop auf (siehe ai.js ask_choice)
		if (t.dataset.answerq) {
			AI.resolveChoice(t.dataset.answerq, t.dataset.answer);
			return;
		}

		// "✦ Anpassen"-Menü (länger/kürzer) an einer KI-Antwort ein-/ausblenden
		if (t.dataset.refinetoggle) {
			S.refineOpenMid = S.refineOpenMid === t.dataset.refinetoggle ? null : t.dataset.refinetoggle;
			renderChat();
			if (S.view === "chat") renderMainChatLog();
			return;
		}
		if (t.dataset.refine) {
			S.refineOpenMid = null;
			await refineMessage(t.dataset.refine, t.dataset.mode);
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
		if (t.dataset.ankitab) { S.ankiTab = t.dataset.ankitab; S.reviewShowBack = false; renderMain(); return; }
		if (t.hasAttribute("data-ankistudy")) {
			S.ankiDeck = t.dataset.ankistudy || null;
			S.ankiTab = "study";
			S.reviewShowBack = false;
			renderMain();
			return;
		}
		if (t.dataset.ankishowback) { S.reviewShowBack = true; renderMain(); return; }
		if (t.dataset.ankigrade) {
			const card = S.cards[t.dataset.card];
			if (card) {
				const srs = SRS.rate(card.srs, Number(t.dataset.ankigrade));
				S.reviewShowBack = false;
				await STATE.dispatch("cardReview", { id: card.id, srs, grade: Number(t.dataset.ankigrade) });
			}
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
			if (c) await STATE.dispatch("cardUpdate", { id: c.id, patch: { suspended: !c.suspended } });
			return;
		}
		if (t.dataset.ankidel) {
			if (confirm("Karte wirklich löschen?")) await STATE.dispatch("cardDelete", { id: t.dataset.ankidel });
			return;
		}
		if (t.dataset.ankiedit) { openCardEditor(t.dataset.ankiedit); return; }
		if (t.dataset.ankinewcard) { openCardEditor(null); return; }
		if (t.dataset.cardeditorsave) {
			const front = (U.el("cardFront") || {}).value || "";
			const back = (U.el("cardBack") || {}).value || "";
			const deck = ((U.el("cardDeck") || {}).value || "Standard").trim() || "Standard";
			if (!front.trim()) { alert("Die Vorderseite darf nicht leer sein."); return; }
			if (t.dataset.cardeditorsave === "new") {
				await STATE.dispatch("cardCreate", { id: U.uid(), front, back, deck });
			} else {
				await STATE.dispatch("cardUpdate", { id: t.dataset.cardeditorsave, patch: { front, back, deck } });
			}
			closeOverlay();
			render();
			return;
		}

		// ---------- Stapel-Baum (Sidebar + Stapel-Tab): öffnen, anlegen, umbenennen, löschen ----------
		if (t.hasAttribute("data-deckopen")) {
			S.ankiDeck = t.dataset.deckopen || null;
			if (S.ankiTab === "study") S.ankiTab = "decks";
			render();
			return;
		}
		// ⋯-Menü je Stapel (wie bei Seiten): öffnen/schließen, Umbenennen, Löschen.
		if (t.dataset.deckmenu) {
			const name = t.dataset.deckmenu;
			S.deckMenuOpenName = S.deckMenuOpenName === name ? null : name;
			renderSidebar();
			if (S.deckMenuOpenName) {
				const btn = document.querySelector('[data-deckmenu="' + name + '"]');
				const menu = document.querySelector(".page-menu");
				if (btn && menu) {
					const r = btn.getBoundingClientRect();
					menu.style.position = "fixed";
					menu.style.top = Math.round(r.bottom + 2) + "px";
					menu.style.left = Math.round(Math.min(r.left, window.innerWidth - 180)) + "px";
					menu.style.right = "auto";
				}
			}
			return;
		}
		if (t.dataset.decknew || t.dataset.decksub) {
			const parent = t.dataset.decksub || "";
			openPromptDialog(parent ? 'Name des Unterstapels von „' + parent.split("::").pop() + '“' : "Name des neuen Stapels", async (name) => {
				const full = (parent ? parent + "::" : "") + name.replace(/::/g, ":");
				await STATE.dispatch("deckCreate", { name: full });
				S.ankiDeck = full;
				render();
			});
			return;
		}
		if (t.dataset.deckrename) {
			// Inline-Umbenennen: statt prompt() ein Textfeld direkt in der Zeile zeigen.
			const from = t.dataset.deckrename;
			S.deckMenuOpenName = null;
			S.renamingDeck = from;
			renderSidebar();
			const inp = document.querySelector('[data-deckrenamename="' + CSS.escape(from) + '"]');
			if (inp) { inp.focus(); inp.select(); }
			return;
		}
		if (t.dataset.deckdel) {
			S.deckMenuOpenName = null;
			const name = t.dataset.deckdel;
			const n = ankiCardsOf(name).length;
			if (confirm('Stapel „' + name + '“ löschen?' + (n ? " " + n + ' Karte(n) wandern in „Standard“.' : ""))) {
				await STATE.dispatch("deckDelete", { name });
				if (S.ankiDeck && (S.ankiDeck === name || S.ankiDeck.startsWith(name + "::"))) S.ankiDeck = null;
			}
			render();
			return;
		}
		if (t.dataset.deckduplicate) {
			S.deckMenuOpenName = null;
			await STATE.dispatch("deckDuplicate", { name: t.dataset.deckduplicate });
			render();
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
		if (t.dataset.zipws) { LIBRARY.exportWorkspaceZip(t.dataset.zipws); return; }

		// ⋯-Menü: Seite als Vorlage markieren / Markierung entfernen
		if (t.dataset.pagetemplate) {
			S.pageMenuOpenId = null;
			const pg = S.pages[t.dataset.pagetemplate];
			if (pg) await STATE.dispatch("pageUpdate", { id: pg.id, patch: { isTemplate: !pg.isTemplate } });
			return;
		}

		// Vorlagen-Auswahl: leere Seite oder Vorlage als Startinhalt
		if (t.dataset.tplblank) {
			const p = S.pendingNewPage;
			S.pendingNewPage = null;
			closeOverlay();
			if (p) await createPageIn(p.wsId, p.parentId);
			return;
		}
		if (t.dataset.tpluse) {
			const p = S.pendingNewPage;
			const tpl = S.pages[t.dataset.tpluse];
			S.pendingNewPage = null;
			closeOverlay();
			if (p && tpl) await createPageIn(p.wsId, p.parentId, tpl);
			return;
		}

		// Seitenverlauf: Version in der Liste auswählen → Vorschau aktualisieren
		if (t.dataset.histversion) {
			S.histIndex = Number(t.dataset.histversion);
			renderHistoryModal();
			return;
		}

		if (t.dataset.set) { SETTINGS.openSettings(t.dataset.set); return; }

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
			if (S.pageMenuOpenId) {
				const btn = document.querySelector('[data-pagemenu="' + id + '"]');
				const menu = document.querySelector(".page-menu");
				if (btn && menu) {
					const r = btn.getBoundingClientRect();
					menu.style.position = "fixed";
					menu.style.top = Math.round(r.bottom + 2) + "px";
					menu.style.left = Math.round(Math.min(r.left, window.innerWidth - 180)) + "px";
					menu.style.right = "auto";
				}
			}
			return;
		}
		// ⋯-Menü: Seite umbenennen — wie bei Stapeln per Inline-Textfeld direkt in der Zeile.
		if (t.dataset.pagefav) {
			S.pageMenuOpenId = null;
			const pg = S.pages[t.dataset.pagefav];
			if (pg) await STATE.dispatch("pageUpdate", { id: pg.id, patch: { favorite: !pg.favorite } });
			render();
			return;
		}
		if (t.dataset.pagemove) {
			S.pageMenuOpenId = null;
			renderSidebar();
			openMoveDialog(t.dataset.pagemove);
			return;
		}
		if (t.dataset.movetarget && S.movePageId) {
			const moveId = S.movePageId;
			const val = t.dataset.movetarget;
			const parentId = val.startsWith("pg:") ? val.slice(3) : null;
			const wsId = val.startsWith("ws:") ? val.slice(3) : (S.pages[parentId] || {}).workspaceId;
			await STATE.dispatch("pageMove", { id: moveId, parentId });
			// Workspace-Zugehörigkeit für die ganze Unterstruktur mitziehen
			const setWs = async (pid) => {
				const p = S.pages[pid];
				if (!p) return;
				if (wsId && p.workspaceId !== wsId) await STATE.dispatch("pageUpdate", { id: pid, patch: { workspaceId: wsId } });
				for (const c of Object.values(S.pages)) if (c.parentId === pid) await setWs(c.id);
			};
			await setWs(moveId);
			S.movePageId = null;
			closeOverlay();
			render();
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
		if (t.dataset.pagerename) {
			const id = t.dataset.pagerename;
			S.pageMenuOpenId = null;
			S.renamingPageId = id;
			renderSidebar();
			const inp = document.querySelector('[data-renamename="' + CSS.escape(id) + '"]');
			if (inp) { inp.focus(); inp.select(); }
			return;
		}
		if (t.dataset.pageduplicate) {
			S.pageMenuOpenId = null;
			const newId = await duplicatePage(t.dataset.pageduplicate);
			if (newId) openPage(newId);
			else render();
			return;
		}
		if (t.dataset.pagetrash) {
			S.pageMenuOpenId = null;
			const id = t.dataset.pagetrash;
			const pg = S.pages[id];
			if (pg) {
				// Alle offenen Tabs der Seite (und ihrer Unterseiten) schließen, da sie in den Papierkorb wandern.
				S.tabs = S.tabs.filter((tid) => tid !== id);
				if (S.currentPageId === id) { S.currentPageId = null; S.view = "home"; }
				await STATE.dispatch("pageTrash", { id });
			}
			return;
		}
		if (t.dataset.pagerestore) {
			await STATE.dispatch("pageRestore", { id: t.dataset.pagerestore });
			return;
		}
		if (t.dataset.pagepurge) {
			const pg = S.pages[t.dataset.pagepurge];
			if (pg && confirm('"' + pg.title + '" endgültig löschen? Das kann nicht rückgängig gemacht werden.')) {
				await STATE.dispatch("pageDelete", { id: t.dataset.pagepurge });
				render();
			}
			return;
		}

		// Chat-Verlauf: neuer Chat / Chat auswählen
		if (t.dataset.newchat) {
			saveCurrentChat();
			const newId = U.uid();
			const list = CHATS.load();
			list.unshift({ id: newId, title: "", created: U.now(), updated: U.now(), messages: [] });
			CHATS.save(list);
			S.chat = [];
			S.currentChatId = newId;
			openPage("chat:" + newId);
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
			if (confirm("Karte wirklich löschen?")) {
				await STATE.dispatch("cardDelete", { id: t.dataset.carddel });
				openCards();
			}
			return;
		}

		// Seite öffnen (Sidebar, Home-Karte, Bibliothek oder Breadcrumb-Vorfahre)
		if (t.dataset.page) { openPage(t.dataset.page); return; }

		// Karten-Bewertung im Review
		if (t.dataset.grade) {
			const card = S.cards[t.dataset.card];
			if (card) {
				const srs = SRS.rate(card.srs, Number(t.dataset.grade));
				await STATE.dispatch("cardReview", { id: card.id, srs });
			}
			S.reviewShowBack = false;
			openReview();
			return;
		}

		switch (t.id) {
			// Home: wechselt NUR die Sidebar zur Datei-Übersicht (wie in Notion)
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
				renderSidebar();
				break;
			case "btnLibrary":
				S.view = "library";
				S.libFolder = null;
				toggleChatFull(false);
				if (document.activeElement) document.activeElement.blur();
				render();
				break;
			case "btnChatExpand":
				toggleChatFull();
				break;
			case "btnNavBack": navBack(); break;
			case "btnNavForward": navForward(); break;
			case "btnSearchToggle": {
				const s = U.el("search");
				s.hidden = !s.hidden;
				if (!s.hidden) {
					S.sidebarMode = "files";
					renderSidebar();
					s.focus();
				} else {
					s.value = "";
					renderSidebar();
				}
				break;
			}
			case "btnCreateWs":
				await LIBRARY.handleCreateWorkspace();
				break;
			case "btnAttach":
			case "btnAttachFull": {
				// Menü dynamisch über dem jeweils geklickten Anhang-Button positionieren,
				// da es sowohl im Seitenpanel als auch im Vollbild-Chat-Tab genutzt wird.
				const m = U.el("attachMenu");
				if (m.hidden) {
					const rect = t.getBoundingClientRect();
					m.style.position = "fixed";
					m.style.left = Math.round(rect.left) + "px";
					m.style.bottom = Math.round(window.innerHeight - rect.top + 8) + "px";
					m.style.top = "auto";
				}
				m.hidden = !m.hidden;
				break;
			}
			case "attachPdf":
				U.el("attachMenu").hidden = true;
				U.el("filePdf").click();
				break;
			case "attachImg":
				U.el("attachMenu").hidden = true;
				U.el("fileImg").click();
				break;
			case "btnRemoveImage":
				S.pendingImage = null;
				renderPendingChip();
				break;
			case "btnRemoveTextFile":
				S.pendingTextFile = null;
				renderPendingChip();
				break;
			case "btnTogglePanel":
				toggleChatFull(false);
				document.body.classList.add("panel-collapsed");
				U.el("btnShowPanel").hidden = false;
				break;
			case "btnShowPanel":
				document.body.classList.remove("panel-collapsed");
				t.hidden = true;
				break;
			case "btnSettings": SETTINGS.openSettings(); break;
			case "btnMigrateNotion":
			case "btnNotionSync":
				await SETTINGS.handleNotionSync(t);
				break;
			case "btnNotionCancel":
				SETTINGS.handleNotionCancel();
				break;
			case "btnDriveLogin":
				await SETTINGS.handleDriveLogin(t);
				break;
			case "btnDriveLogout":
				SETTINGS.handleDriveLogout();
				break;
			case "btnDriveSyncSettings":
				await SETTINGS.handleDriveSyncSettings(t);
				break;
			case "btnAddProvider":
				await SETTINGS.handleAddProvider();
				break;
			case "btnSaveSettings":
				await SETTINGS.handleSaveSettings();
				break;
			case "btnModelMenu":
			case "btnModelChipFull": {
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
				break;
			}
			case "btnPickBg": U.el("fileBg").click(); break;
			case "btnCoverUpload": {
				const pid = S.currentPageId;
				if (!pid) break;
				const inp = document.createElement("input");
				inp.type = "file";
				inp.accept = "image/*";
				inp.onchange = async () => {
					const file = inp.files && inp.files[0];
					if (!file) return;
					try {
						const buf = await U.readAsBuffer(file);
						const blobId = "cover:" + U.uid();
						await DB.putBlob(blobId, buf, { name: file.name, type: file.type });
						await STATE.dispatch("pageUpdate", { id: pid, patch: { coverImg: blobId, cover: null } });
						closeOverlay();
						render();
					} catch (err) {
						alert("Bild konnte nicht als Cover gesetzt werden: " + err.message);
					}
				};
				inp.click();
				break;
			}
			case "btnClearBg":
				await SETTINGS.handleClearBg();
				break;
			case "btnCloseOverlay": closeOverlay(); break;
			case "btnAnki": openAnki(); break;
			case "btnReview":
			case "btnReviewHome":
				openAnki("study", null);
				break;
			case "btnShowBack": S.reviewShowBack = true; openReview(); break;
			case "btnCards": openAnki("browser"); break;
			case "btnDaily":
				S.view = "daily";
				S.dailyMonth = null;
				toggleChatFull(false);
				if (document.activeElement) document.activeElement.blur();
				render();
				break;
			case "btnDailyToday": await openDailyNote(localDayKey(new Date())); break;
			case "btnHistory":
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
					render();
				}
				break;
			}
			case "btnDriveSync":
				await SETTINGS.handleDriveSync(t);
				break;
			case "btnBackupNow":
			case "btnExport":
				await SETTINGS.handleBackupNow();
				break;
			case "btnSidebarToggle": document.body.classList.toggle("sidebar-open"); break;
			case "btnThemeDark":
			case "btnThemeLight":
				SETTINGS.handleThemeSelect(t.id === "btnThemeLight" ? "light" : "dark");
				break;
			case "btnImport": U.el("fileImport").click(); break;
			case "btnOpenPdf":
				S.pdfOpen = !S.pdfOpen;
				if (document.activeElement) document.activeElement.blur();
				render();
				break;
			case "btnResetAll":
				await SETTINGS.handleResetAll(t);
				break;
			case "btnTrash":
				S.view = "trash";
				if (document.activeElement) document.activeElement.blur();
				render();
				break;
		}
	});

	// Eingaben (Delegation) — inkl. Live-Vorschau im Split-Modus
	document.addEventListener("input", (e) => {
		if (e.target.id === "search") renderSidebar();
		// Bibliotheks-Filter: live filtern, Fokus + Cursorposition nach dem Neuaufbau erhalten
		if (e.target.id === "libFilter") {
			LIBRARY.handleFilterInput(e);
		}
		// Karten-Browser: live suchen, Fokus + Cursorposition erhalten
		if (e.target.id === "ankiSearch") {
			S.ankiSearch = e.target.value;
			const pos = e.target.selectionStart;
			renderAnki(U.el("main"));
			const inp = U.el("ankiSearch");
			if (inp) { inp.focus(); inp.selectionStart = inp.selectionEnd = pos; }
		}
	});
	document.addEventListener("change", async (e) => {
		if (e.target.id === "pageTitle") {
			const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
			if (pg && e.target.value.trim()) {
				await STATE.dispatch("pageUpdate", { id: pg.id, patch: { title: e.target.value.trim() } });
				RAG.queuePage(pg.id);
			}
		}
		if (e.target.id === "modelSelect") {
			await STATE.dispatch("settingsSet", { aiModel: e.target.value });
			SETTINGS.checkAI();
		}
		if (e.target.id === "filePdf" && e.target.files[0]) {
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
		if (e.target.id === "fileImg" && e.target.files[0]) {
			const file = e.target.files[0];
			e.target.value = "";
			const r = new FileReader();
			r.onload = () => { S.pendingImage = r.result; renderPendingChip(); };
			r.readAsDataURL(file);
		}
		if (e.target.id === "fileBg" && e.target.files[0]) {
			await SETTINGS.handleFileBgChange(e);
		}
		if (e.target.id === "fileImport" && e.target.files[0]) {
			await SETTINGS.handleImportChange(e);
		}
	});

	// Drag & Drop: Seite auf Seite ziehen = Unterseite; auf freien Baum = oberste Ebene.
	// Gleiches gilt für Stapel: Stapel auf Stapel ziehen = Unterstapel; auf freien
	// Baum = Stammebene. dragId kann eine Seiten-ID oder ein Stapelname sein;
	// dragType unterscheidet beide ("page" vs "deck").
	let dragId = null, dragType = null, dropZone = null;
	document.addEventListener("dragstart", (e) => {
		const pageRow = e.target.closest("[data-page]");
		if (pageRow) { dragId = pageRow.dataset.page; dragType = "page"; e.dataTransfer.effectAllowed = "move"; return; }
		const deckRow = e.target.closest("[data-deck]");
		if (deckRow) { dragId = deckRow.dataset.deck; dragType = "deck"; e.dataTransfer.effectAllowed = "move"; return; }
	});
	const clearDropMarks = () => {
		document.querySelectorAll(".row.drop-target,.row.drop-before,.row.drop-after").forEach((r) => {
			r.classList.remove("drop-target", "drop-before", "drop-after");
			r.style.borderTop = "";
			r.style.borderBottom = "";
		});
	};
	document.addEventListener("dragover", (e) => {
		if (!dragId) return;
		const pageRow = e.target.closest("[data-page]");
		const deckRow = e.target.closest("[data-deck]");
		if (pageRow || deckRow || e.target.closest("#tree")) {
			e.preventDefault();
			clearDropMarks();
			// Drei Zonen beim Ziehen über eine Seiten-Zeile: oberes Viertel = DAVOR
			// einsortieren, unteres Viertel = DANACH, Mitte = als Unterseite (wie bisher).
			dropZone = "into";
			if (pageRow && dragType === "page") {
				const r = pageRow.getBoundingClientRect();
				const y = e.clientY - r.top;
				if (y < r.height * 0.25) dropZone = "before";
				else if (y > r.height * 0.75) dropZone = "after";
			}
			if (pageRow) {
				if (dropZone === "before") { pageRow.classList.add("drop-before"); pageRow.style.borderTop = "2px solid #4a9eff"; }
				else if (dropZone === "after") { pageRow.classList.add("drop-after"); pageRow.style.borderBottom = "2px solid #4a9eff"; }
				else pageRow.classList.add("drop-target");
			}
			else if (deckRow) deckRow.classList.add("drop-target");
		}
	});
	document.addEventListener("dragend", () => { dropZone = null; clearDropMarks(); });
	// Einsortieren VOR/NACH einer Seite (Sortier-Zonen) — läuft VOR dem allgemeinen
	// Drop-Handler und stoppt ihn, wenn eine Sortier-Zone getroffen wurde.
	document.addEventListener("drop", async (e) => {
		if (!dragId || dragType !== "page" || dropZone === "into" || dropZone == null) return;
		const pageRow = e.target.closest("[data-page]");
		if (!pageRow) return;
		const zone = dropZone;
		e.preventDefault();
		e.stopImmediatePropagation();
		clearDropMarks();
		const target = S.pages[pageRow.dataset.page];
		const moved = S.pages[dragId];
		dragId = null; dragType = null; dropZone = null;
		if (!target || !moved || target.id === moved.id || isDescendant(target.id, moved.id)) return;
		// Geschwister des Ziels in Anzeige-Reihenfolge; neue Position = Mittelwert
		// der Sortierschlüssel der künftigen Nachbarn (STATE.sortKeyOf).
		const sibs = STATE.childrenOf(target.parentId || null, target.workspaceId || "default").filter((p) => p.id !== moved.id);
		const idx = sibs.findIndex((p) => p.id === target.id);
		if (idx === -1) return;
		const pos = zone === "before" ? idx : idx + 1;
		const prev = sibs[pos - 1], next = sibs[pos];
		const kPrev = prev ? STATE.sortKeyOf(prev) : null;
		const kNext = next ? STATE.sortKeyOf(next) : null;
		let order;
		if (kPrev != null && kNext != null) order = (kPrev + kNext) / 2;
		else if (kPrev != null) order = kPrev + 60000;
		else if (kNext != null) order = kNext - 60000;
		else order = Date.now();
		await STATE.dispatch("pageMove", { id: moved.id, parentId: target.parentId || null, order });
		// Workspace angleichen, falls über Workspace-Grenzen einsortiert wurde
		if ((moved.workspaceId || "default") !== (target.workspaceId || "default")) {
			await STATE.dispatch("pageUpdate", { id: moved.id, patch: { workspaceId: target.workspaceId || "default" } });
		}
		render();
	});
	document.addEventListener("drop", async (e) => {
		if (!dragId) return;
		const pageRow = e.target.closest("[data-page]");
		const deckRow = e.target.closest("[data-deck]");
		const inTree = e.target.closest("#tree");
		document.querySelectorAll(".row.drop-target").forEach((r) => r.classList.remove("drop-target"));
		if (!pageRow && !deckRow && !inTree) { dragId = null; dragType = null; return; }
		e.preventDefault();
		if (dragType === "page") {
			const targetId = pageRow ? pageRow.dataset.page : null;
			if (targetId !== dragId && !(targetId && isDescendant(targetId, dragId))) {
				await STATE.dispatch("pageMove", { id: dragId, parentId: targetId });
			}
		} else if (dragType === "deck") {
			const targetDeck = deckRow ? deckRow.dataset.deck : "";
			// Verhindern: Stapel in sich selbst oder in eigenen Unterstapel ziehen (Zyklus).
			if (targetDeck !== dragId && targetDeck !== "Standard" && !targetDeck.startsWith(dragId + "::")) {
				await STATE.dispatch("deckMove", { from: dragId, target: targetDeck });
				if (S.ankiDeck && (S.ankiDeck === dragId || S.ankiDeck.startsWith(dragId + "::"))) {
					const label = dragId.split("::").pop();
					const newRoot = (targetDeck ? targetDeck + "::" : "") + label;
					S.ankiDeck = newRoot + S.ankiDeck.slice(dragId.length);
				}
			}
		}
		dragId = null;
		dragType = null;
	});
	document.addEventListener("dragend", () => {
		document.querySelectorAll(".row.drop-target").forEach((r) => r.classList.remove("drop-target"));
		dragId = null;
	});

	// Chat — sowohl das Seitenpanel-Formular als auch das Vollbild-Chat-Tab-Formular
	// (letzteres wird bei jedem Render neu erzeugt, daher über Delegation abgefangen).
	document.addEventListener("submit", async (e) => {
		if (e.target.id === "chatForm") {
			e.preventDefault();
			const inp = U.el("chatInput");
			const text = inp.value.trim();
			inp.value = "";
			await sendChatMessage(text, "side");
		} else if (e.target.id === "mainChatForm") {
			e.preventDefault();
			const inp = U.el("mainChatInput");
			const text = inp.value.trim();
			inp.value = "";
			await sendChatMessage(text, "full");
		}
	});
	// Enter sendet, Shift+Enter = Zeilenumbruch (Seitenpanel + Vollbild-Chat)
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" || e.shiftKey) return;
		if (e.target.id === "chatInput") { e.preventDefault(); U.el("chatForm").requestSubmit(); }
		else if (e.target.id === "mainChatInput") { e.preventDefault(); U.el("mainChatForm").requestSubmit(); }
	});

	// ---------- Inline-Umbenennen (Seiten + Stapel) — Enter bestätigt, Esc/Blur bricht ab ----------
	async function commitRename(input) {
		if (input.dataset.renamename) {
			const id = input.dataset.renamename;
			const newTitle = input.value.trim();
			const pg = S.pages[id];
			S.renamingPageId = null;
			if (newTitle && pg && newTitle !== pg.title) {
				await STATE.dispatch("pageUpdate", { id, patch: { title: newTitle } });
				RAG.queuePage(id);
			}
			render();
		} else if (input.dataset.deckrenamename) {
			const from = input.dataset.deckrenamename;
			const newLabel = input.value.trim().replace(/::/g, ":");
			const oldLabel = from.split("::").pop();
			S.renamingDeck = null;
			if (newLabel && newLabel !== oldLabel) {
				const prefix = from.includes("::") ? from.slice(0, from.lastIndexOf("::") + 2) : "";
				const to = prefix + newLabel;
				await STATE.dispatch("deckRename", { from, to });
				if (S.ankiDeck && (S.ankiDeck === from || S.ankiDeck.startsWith(from + "::"))) S.ankiDeck = to + S.ankiDeck.slice(from.length);
			}
			render();
		}
	}
	document.addEventListener("keydown", (e) => {
		if (!e.target.dataset.renamename && !e.target.dataset.deckrenamename) return;
		if (e.key === "Enter") { e.preventDefault(); commitRename(e.target); }
		else if (e.key === "Escape") {
			S.renamingPageId = null;
			S.renamingDeck = null;
			render();
		}
	});
	document.addEventListener("focusout", (e) => {
		if (e.target.dataset.renamename || e.target.dataset.deckrenamename) commitRename(e.target);
	});
	// Escape schließt Overlays (Einstellungen, Dialoge), das ⋯-Seitenmenü und die Schnellsuche
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Escape") return;
		if (e.target.dataset && (e.target.dataset.renamename || e.target.dataset.deckrenamename)) return;
		const o = U.el("overlay");
		if (o && !o.hidden) { closeOverlay(); return; }
		if (S.pageMenuOpenId) { S.pageMenuOpenId = null; renderSidebar(); if (S.view === "library") renderMain(); return; }
		const s = U.el("search");
		if (s && !s.hidden) { s.value = ""; s.hidden = true; s.blur(); renderSidebar(); }
	});
	// Strg/Cmd+K öffnet wie in Notion die Schnellsuche
	document.addEventListener("keydown", (e) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
			e.preventDefault();
			const s = U.el("search");
			if (s) {
				s.hidden = false;
				renderSidebar();
				s.focus();
				s.select();
			}
		}
	});
	// Langen geklebten Text automatisch als .txt-Anhang behandeln statt im Feld auszuschreiben
	document.addEventListener("paste", (e) => {
		if (e.target.id !== "chatInput" && e.target.id !== "mainChatInput") return;
		const text = (e.clipboardData || window.clipboardData).getData("text/plain") || "";
		const lines = text.split("\n").length;
		if (text.length > 600 || lines > 15) {
			e.preventDefault();
			S.pendingTextFile = { name: "geklebter-text.txt", content: text, size: text.length };
			renderPendingChip();
		}
	});
}

// Papierkorb automatisch leeren: Seiten, die länger als 30 Tage im Papierkorb
// liegen, werden beim Start endgültig gelöscht (wie in Notion).
async function purgeOldTrash() {
	const cutoff = Date.now() - 30 * 864e5;
	for (const pg of STATE.trashedPages()) {
		if (pg.trashedAt && new Date(pg.trashedAt).getTime() < cutoff) {
			await STATE.dispatch("pageDelete", { id: pg.id });
		}
	}
}

async function initApp() {
	await DB.open();
	// Speicher als persistent markieren — der Browser darf IndexedDB dann nicht still räumen.
	if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
	SETTINGS.applyTheme();
	await STATE.load();
	await purgeOldTrash();
	await seedIfEmpty();
	wireEvents();
	SETTINGS.applyBg();
	render();
	SETTINGS.checkAI();
	// Ping nur bei sichtbarem Tab (spart Akku); beim Zurückkehren sofort prüfen.
	setInterval(() => { if (!document.hidden) SETTINGS.checkAI(); }, 60000);
	document.addEventListener("visibilitychange", () => { if (!document.hidden) SETTINGS.checkAI(); });
	RAG.reindexStale();
}

if (document.readyState === "loading") {
	window.addEventListener("DOMContentLoaded", initApp);
} else {
	initApp();
}

export const APP = {
	COLLAPSE,
	CHATS,
	seedIfEmpty,
	wireEvents,
	purgeOldTrash,
	saveCurrentChat,
	closeOverlay,
	openPage
};