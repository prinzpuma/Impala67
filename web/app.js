"use strict";
// app.js — Initialisierung und Event-Verkabelung.
const WELCOME_MD = [
	"Willkommen bei **Notion** — deiner lokalen Lern-App: Notizen, PDFs und KI in einem. Diese Seite zeigt gleichzeitig alle Funktionen *und* alle Formatierungsmöglichkeiten, die es aktuell gibt.",
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

// ---------- Ein-/Ausklapp-Zustand (Sidebar-Baum), überlebt einen Neustart ----------
const COLLAPSE = (() => {
	let set = new Set();
	try { set = new Set(JSON.parse(localStorage.getItem("notion.collapsed") || "[]")); } catch { /* leer starten */ }
	function persist() {
		try { localStorage.setItem("notion.collapsed", JSON.stringify([...set])); } catch (e) { console.warn(e); }
	}
	return {
		isCollapsed: (key) => set.has(key),
		toggle(key) { set.has(key) ? set.delete(key) : set.add(key); persist(); },
	};
})();

// ---------- Chat-Verlauf (lokal in localStorage, wie Notions Chat-Liste) ----------
const CHATS = {
	load() {
		try { return JSON.parse(localStorage.getItem("notion.chats") || "[]"); }
		catch { return []; }
	},
	save(list) {
		try { localStorage.setItem("notion.chats", JSON.stringify(list.slice(0, 100))); }
		catch (e) { console.warn("Chat-Verlauf konnte nicht gespeichert werden:", e); }
	},
};

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

// Verbindungsstatus automatisch prüfen (beim Start, nach Einstellungen, alle 60s)
async function checkAI() {
	S.aiOnline = null;
	renderStatusDot();
	S.aiOnline = await AI.ping();
	renderStatusDot();
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

// Eigenes Hintergrundbild anwenden (Blob aus IndexedDB, dunkel überblendet)
// Theme (dunkel/hell) — Gerätewahl in localStorage, Standard: dunkel.
function applyTheme() {
	document.body.classList.toggle("light", localStorage.getItem("notionTheme") === "light");
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

async function applyBg() {
	const bg = U.el("bg");
	if (!bg) return;
	try {
		const rec = await DB.getBlob("bgImage");
		if (rec && rec.buf && rec.buf.byteLength) {
			const url = URL.createObjectURL(new Blob([rec.buf], { type: (rec.meta && rec.meta.type) || "image/jpeg" }));
			bg.style.backgroundImage = "linear-gradient(rgba(6,8,12,0.84), rgba(6,8,12,0.93)), url('" + url + "')";
			bg.style.backgroundSize = "cover";
			bg.style.backgroundPosition = "center";
		} else {
			bg.style.backgroundImage = "";
			bg.style.backgroundSize = "";
			bg.style.backgroundPosition = "";
		}
	} catch (e) {
		console.warn("Hintergrund konnte nicht geladen werden:", e);
	}
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
function exportWorkspaceZip(wsId) {
	const ws = S.workspaces[wsId];
	const safe = (s) => String(s || "Ohne Titel").replace(/[\\/:*?"<>|#]/g, "_").trim().slice(0, 80) || "Seite";
	const files = [];
	const used = new Set();
	const walk = (parentId, path) => {
		STATE.childrenOf(parentId, wsId).forEach((pg) => {
			let base = path + safe(pg.title), n = 2;
			while (used.has(base)) base = path + safe(pg.title) + " (" + (n++) + ")";
			used.add(base);
			files.push({ name: base + ".md", text: "# " + pg.title + "\n\n" + (pg.content || "") });
			walk(pg.id, base + "/");
		});
	};
	walk(null, "");
	if (!files.length) { alert("Dieser Workspace hat keine Seiten."); return; }
	U.downloadBlob(safe(ws ? ws.name : "Workspace") + ".zip", U.zip(files));
}

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

// ---------- Notion-API Migration ----------
const NOTION_MIGRATOR = (() => {
	// Abbrechen-Unterstützung: cancel() setzt das Flag, checkCancelled() wirft an
	// den nächsten Kontrollpunkten (Seiten-/Block-Schleifen) eine markierte Ausnahme.
	let cancelled = false;
	function cancel() { cancelled = true; }
	function checkCancelled() {
		if (cancelled) {
			const e = new Error("Abgebrochen");
			e.cancelled = true;
			throw e;
		}
	}

	async function req(token, path, opts) {
		// Drosselung: kurze Pause, um Notion API-Limits (3 Req/s) zu respektieren
		await new Promise((resolve) => setTimeout(resolve, 250));

		const url = (S.settings.corsProxy || "https://corsproxy.io/?") + encodeURIComponent("https://api.notion.com/v1" + path);

		for (let attempt = 0; attempt < 5; attempt++) {
			const res = await fetch(url, {
				method: (opts && opts.method) || "GET",
				headers: {
					"Authorization": "Bearer " + token,
					"Notion-Version": "2022-06-28",
					"Content-Type": "application/json",
				},
				body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
			});

			if (res.status === 429) {
				const retryAfter = Number(res.headers.get("Retry-After")) || 2;
				await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
				continue;
			}

			if (!res.ok) throw new Error("Notion-API Fehler " + res.status + ": " + (await res.text()).slice(0, 200));
			return res.json();
		}
		throw new Error("Notion-API Fehler: Zu viele Versuche nach Rate-Limit (429)");
	}

	// Rich-Text → Markdown: behält Fett/Kursiv/Code/Durchgestrichen/Links UND
	// Notion-Farben ({red}…{/} bzw. {bg-red}…{/} — die Syntax des Block-Editors)
	// sowie Inline-Formeln ($…$) bei.
	const NOTION_COLOR_MAP = { gray: "gray", brown: "orange", orange: "orange", yellow: "yellow", green: "green", blue: "blue", purple: "purple", pink: "pink", red: "red" };
	const plainText = (arr) => (arr || []).map((x) => (x.text ? x.text.content : x.plain_text || "")).join("");
	const parseRichText = (arr) => {
		if (!arr || !arr.length) return "";
		return arr.map((x) => {
			if (x.type === "equation" && x.equation) return "$" + (x.equation.expression || "") + "$";
			let text = x.text ? x.text.content : (x.plain_text || "");
			if (!text) return "";
			const ann = x.annotations || {};
			if (ann.code) text = "`" + text + "`";
			if (ann.bold) text = "**" + text + "**";
			if (ann.italic) text = "*" + text + "*";
			if (ann.strikethrough) text = "~~" + text + "~~";
			if (ann.underline) text = "<u>" + text + "</u>";
			const col = ann.color || "default";
			if (col !== "default") {
				const base = NOTION_COLOR_MAP[col.replace("_background", "")];
				if (base) text = "{" + (col.endsWith("_background") ? "bg-" : "") + base + "}" + text + "{/}";
			}
			if (x.href) {
				// Erwähnungen/Links auf importierte Notion-Seiten → lokaler Link (#seitenId)
				const nm = String(x.href).match(/notion\.so\/(?:[^/?#]*-)?([0-9a-f]{32})/);
				const loc = nm ? localIdForRemote(nm[1]) : null;
				text = "[" + text + "](" + (loc ? "#" + loc : x.href) + ")";
			}
			return text;
		}).join("");
	};

	async function loadAllChildren(token, blockId) {
		let results = [];
		let cursor;
		for (let i = 0; i < 50; i++) {
			const qs = cursor ? "?start_cursor=" + cursor + "&page_size=100" : "?page_size=100";
			const data = await req(token, "/blocks/" + blockId + "/children" + qs);
			results = results.concat(data.results || []);
			if (!data.has_more) break;
			cursor = data.next_cursor;
		}
		return results;
	}

	// ---------- Gemeinsame Helfer: IDs, Zuordnung, Duplikat-Erkennung ----------
	const normId = (id) => String(id || "").replace(/-/g, "");
	const normText = (s) => String(s || "").replace(/\r/g, "").trim();

	// Rückwärts-Zuordnung Notion-ID → lokale ID (aus settings.notionMap), einmal je Lauf aufgebaut.
	function reverseMap() {
		const rev = {};
		const map = S.settings.notionMap || {};
		for (const localId in map) rev[map[localId]] = localId;
		return rev;
	}

	// Ermittelt, ob eine Notion-Seite bereits lokal existiert — entweder direkt importiert
	// (lokale ID = Notion-ID ohne Bindestriche) oder als lokal erstellte Seite, die per Sync
	// bereits einmal nach Notion gepusht wurde (settings.notionMap). Ohne diese Rückwärtssuche
	// entsteht beim nächsten Sync ein Duplikat der lokal erstellten Seite!
	function localIdForRemote(nid, rev) {
		if (S.pages[nid]) return nid;
		return (rev || reverseMap())[nid] || null;
	}

	// Ist eine lokale Seite bereits einer Notion-Seite zugeordnet? (U.uid() erzeugt UUIDs
	// MIT Bindestrichen — nur importierte Seiten haben 32 Hex-Zeichen ohne Bindestriche.)
	const isLinked = (pg) => /^[0-9a-f]{32}$/.test(pg.id) || !!(S.settings.notionMap || {})[pg.id];

	// Zusammenführen statt duplizieren: existiert lokal eine noch NICHT zugeordnete Seite,
	// die exakt der Notion-Seite entspricht (gleicher Titel + exakt gleicher Inhalt — oder
	// gleicher Titel und eine der beiden Seiten ist noch leer)? Dann wird sie als Gegenstück
	// übernommen und an den richtigen Ort verschoben, statt eine Kopie anzulegen.
	function findMergeCandidate(title, content) {
		const t = normText(title).toLowerCase();
		if (!t) return null;
		const cands = STATE.activePages().filter((pg) => !isLinked(pg) && normText(pg.title).toLowerCase() === t);
		if (!cands.length) return null;
		const c = normText(content);
		const exact = cands.filter((pg) => normText(pg.content) === c);
		if (exact.length) return exact[0];
		const nearly = cands.filter((pg) => !normText(pg.content) || !c);
		return nearly.length === 1 ? nearly[0] : null; // mehrere unklare Kandidaten → lieber nicht raten
	}

	// Alle für die Integration freigegebenen Notion-Seiten (mit Pagination, ohne Archivierte) —
	// vorher wurde nur die erste Suchseite (100 Treffer) gelesen.
	async function listRemotePages(token, onPage) {
		let results = [];
		let cursor;
		for (let i = 0; i < 100; i++) {
			checkCancelled();
			const body = { filter: { property: "object", value: "page" }, page_size: 100 };
			if (cursor) body.start_cursor = cursor;
			const data = await req(token, "/search", { method: "POST", body });
			results = results.concat(data.results || []);
			if (onPage) onPage(results.length);
			if (!data.has_more) break;
			cursor = data.next_cursor;
		}
		return results.filter((r) => !r.archived && !r.in_trash);
	}

	// Eltern-Notion-ID einer Notion-Seite: page_id direkt; database_id wird über die Seite
	// aufgelöst, in der die Datenbank liegt (gecacht); workspace-Ebene → null (oberste Ebene).
	const dbParentCache = {};
	async function remoteParentId(token, pgData) {
		const par = pgData.parent || {};
		if (par.type === "page_id") return normId(par.page_id);
		if (par.type === "database_id") {
			const dbid = normId(par.database_id);
			if (!(dbid in dbParentCache)) {
				try {
					const db = await req(token, "/databases/" + par.database_id);
					dbParentCache[dbid] = (db.parent && db.parent.type === "page_id") ? normId(db.parent.page_id) : null;
				} catch { dbParentCache[dbid] = null; }
			}
			return dbParentCache[dbid];
		}
		return null;
	}

	function titleAndIconOf(pgData) {
		let title = "Importierte Seite";
		let icon = null;
		if (pgData.properties) {
			const tProp = Object.values(pgData.properties).find((p) => p.type === "title");
			if (tProp && tProp.title && tProp.title.length) title = parseRichText(tProp.title);
		}
		if (pgData.icon && pgData.icon.type === "emoji") icon = pgData.icon.emoji;
		return { title, icon };
	}

	// Datenbank-Eigenschaften lesbar abflachen (für die Tabellen-Darstellung).
	function propToText(p) {
		if (!p) return "";
		const t = p.type;
		if (t === "title") return parseRichText(p.title);
		if (t === "rich_text") return parseRichText(p.rich_text);
		if (t === "select") return p.select ? p.select.name : "";
		if (t === "multi_select") return (p.multi_select || []).map((o) => o.name).join(", ");
		if (t === "status") return p.status ? p.status.name : "";
		if (t === "date") return p.date ? p.date.start + (p.date.end ? " → " + p.date.end : "") : "";
		if (t === "number") return p.number == null ? "" : String(p.number);
		if (t === "checkbox") return p.checkbox ? "✅" : "◻";
		if (t === "url") return p.url || "";
		if (t === "email") return p.email || "";
		if (t === "phone_number") return p.phone_number || "";
		if (t === "people") return (p.people || []).map((u) => u.name || "?").join(", ");
		if (t === "formula") {
			const f = p.formula || {};
			return f.type === "string" ? (f.string || "") : f.type === "number" ? (f.number == null ? "" : String(f.number)) : f.type === "boolean" ? (f.boolean ? "✅" : "◻") : (f.date ? f.date.start : "");
		}
		if (t === "created_time") return U.fmtDate(p.created_time);
		if (t === "last_edited_time") return U.fmtDate(p.last_edited_time);
		return "";
	}

	// Notion-Datenbank → Markdown-Tabelle (Titel-Spalte zuerst); die Zeilen-Seiten
	// werden zusätzlich als Unterseiten importiert (siehe pullRemotePage).
	function dbToMdTable(title, rows) {
		const head = title ? "**🗃 " + title + "**\n\n" : "";
		if (!rows.length) return head;
		const cols = [];
		rows.forEach((r) => Object.keys(r.properties || {}).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
		cols.sort((a, b) => ((((rows[0].properties || {})[a] || {}).type === "title") ? -1 : 0) - ((((rows[0].properties || {})[b] || {}).type === "title") ? -1 : 0));
		const esc = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
		let md = head + "| " + cols.map(esc).join(" | ") + " |\n| " + cols.map(() => "---").join(" | ") + " |\n";
		rows.forEach((r) => { md += "| " + cols.map((c) => esc(propToText((r.properties || {})[c]))).join(" | ") + " |\n"; });
		return md + "\n";
	}

	// Notion-Blöcke → Markdown mit hoher Wiedergabetreue: verschachtelte Listen,
	// Toggles MIT Inhalt, Callout-Farben (> [!farbe]), Spalten (:::columns), echte
	// Tabellen, Bilder, Formeln, Lesezeichen/Embeds als Links. Unterseiten und
	// Datenbanken werden über die ctx-Callbacks eingesammelt statt inline importiert.
	async function blocksToMd(token, children, ctx) {
		ctx = ctx || {};
		const depth = ctx.depth || 0;
		if (depth > 12) return "";
		const ind = ctx.indent || 0;
		const pad = "  ".repeat(ind);
		const inner = async (b, addIndent) => {
			if (!b.has_children) return "";
			const kids = await loadAllChildren(token, b.id);
			return blocksToMd(token, kids, { ...ctx, depth: depth + 1, indent: ind + (addIndent ? 1 : 0) });
		};
		let md = "";
		for (const b of children) {
			checkCancelled();
			const type = b.type;
			const d = b[type] || {};
			if (type === "paragraph") {
				md += pad + parseRichText(d.rich_text) + "\n\n";
				if (b.has_children) md += await inner(b, true);
			} else if (type === "heading_1" || type === "heading_2" || type === "heading_3") {
				md += pad + "#".repeat(Number(type.slice(-1))) + " " + parseRichText(d.rich_text) + "\n\n";
				if (b.has_children) md += await inner(b, false); // Toggle-Überschrift: Inhalt darunter
			} else if (type === "bulleted_list_item") {
				md += pad + "- " + parseRichText(d.rich_text) + "\n" + (await inner(b, true));
			} else if (type === "numbered_list_item") {
				md += pad + "1. " + parseRichText(d.rich_text) + "\n" + (await inner(b, true));
			} else if (type === "to_do") {
				md += pad + "- [" + (d.checked ? "x" : " ") + "] " + parseRichText(d.rich_text) + "\n" + (await inner(b, true));
			} else if (type === "code") {
				md += pad + "```" + (d.language === "plain text" ? "" : d.language || "") + "\n" + plainText(d.rich_text) + "\n```\n\n";
			} else if (type === "equation") {
				md += pad + "$$" + (d.expression || "") + "$$\n\n";
			} else if (type === "quote") {
				let q = parseRichText(d.rich_text);
				if (b.has_children) {
					const body = (await blocksToMd(token, await loadAllChildren(token, b.id), { ...ctx, depth: depth + 1, indent: 0 })).trim();
					if (body) q += "\n" + body;
				}
				md += q.split("\n").map((l) => pad + "> " + l).join("\n") + "\n\n";
			} else if (type === "divider") {
				md += pad + "---\n\n";
			} else if (type === "callout") {
				const col = NOTION_COLOR_MAP[(d.color || "default").replace("_background", "")] || "blue";
				const icon = d.icon && d.icon.type === "emoji" ? d.icon.emoji + " " : "";
				// Der Inhalt gehört MIT in die Box: alle Zeilen mit "> " fortsetzen — der
				// Editor rendert das als EINE mehrzeilige Callout-Box (wie in Notion).
				let body = icon + parseRichText(d.rich_text);
				if (b.has_children) {
					const kids = (await blocksToMd(token, await loadAllChildren(token, b.id), { ...ctx, depth: depth + 1, indent: 0 })).trim();
					if (kids) body += "\n" + kids;
				}
				const cl = body.split("\n");
				md += pad + "> [!" + col + "] " + cl[0] + "\n" + cl.slice(1).map((l) => pad + "> " + l).join("\n") + (cl.length > 1 ? "\n" : "") + "\n";
			} else if (type === "toggle") {
				const body = b.has_children ? (await inner(b, false)).trim() : "";
				md += pad + "<details><summary>" + parseRichText(d.rich_text) + "</summary>\n" + (body ? body + "\n" : "") + "</details>\n\n";
			} else if (type === "column_list") {
				const cols = (await loadAllChildren(token, b.id)).filter((c) => c.type === "column");
				const parts = [];
				for (const col of cols) {
					parts.push(col.has_children ? (await blocksToMd(token, await loadAllChildren(token, col.id), { ...ctx, depth: depth + 1, indent: 0 })).trim() : "");
				}
				md += ":::columns\n" + parts.join("\n:::split\n") + "\n:::end\n\n";
			} else if (type === "table") {
				const rows = (await loadAllChildren(token, b.id)).filter((r) => r.type === "table_row");
				if (rows.length) {
					const cells = rows.map((r) => (r.table_row.cells || []).map((c) => parseRichText(c).replace(/\|/g, "\\|").replace(/\n/g, " ")));
					const width = Math.max(...cells.map((r) => r.length), 1);
					const line = (r) => "| " + Array.from({ length: width }, (_, i) => r[i] || "").join(" | ") + " |";
					md += line(cells[0]) + "\n| " + Array.from({ length: width }, () => "---").join(" | ") + " |\n" + (cells.length > 1 ? cells.slice(1).map(line).join("\n") + "\n" : "") + "\n";
				}
			} else if (type === "image") {
				const src = d.type === "external" ? (d.external || {}).url : (d.file || {}).url;
				if (src) md += pad + "![" + (plainText(d.caption) || "Bild").replace(/[\[\]]/g, "") + "](" + src + ")\n\n";
			} else if (type === "bookmark" || type === "embed" || type === "video" || type === "file" || type === "pdf" || type === "link_preview") {
				const url = d.url || (d.external || {}).url || (d.file || {}).url || "";
				if (url) md += pad + "[" + (plainText(d.caption) || d.name || url) + "](" + url + ")\n\n";
			} else if (type === "child_page") {
				if (ctx.onChildPage) await ctx.onChildPage(b.id);
			} else if (type === "child_database") {
				if (ctx.onChildDb) {
					const tbl = await ctx.onChildDb(b.id, d.title || "");
					if (tbl) md += tbl;
				}
			} else if (type === "synced_block" || type === "template") {
				if (b.has_children) md += await inner(b, false);
			} else if (type === "table_of_contents" || type === "breadcrumb") {
				// rein visuelle Blöcke — bewusst überspringen
			} else if (b.has_children) {
				md += await inner(b, false); // unbekannter Container: Inhalt trotzdem retten
			}
		}
		return depth === 0 ? md.trim() : md;
	}

	// Importiert/aktualisiert GENAU EINE Notion-Seite lokal: Titel, Icon, Inhalt und den
	// exakt richtigen Ort (Elternseite wie in Notion). Existiert lokal bereits eine exakt
	// gleiche, noch nicht zugeordnete Seite, wird sie zusammengeführt statt dupliziert —
	// und dabei an den richtigen Ort verschoben. ctx.parentLocal === undefined bedeutet:
	// Ablageort aus den Notion-Daten der Seite selbst auflösen.
	async function pullRemotePage(token, pgData, ctx) {
		checkCancelled();
		ctx = ctx || {};
		const rev = ctx.rev || reverseMap();
		const nid = normId(pgData.id);
		const { title, icon } = titleAndIconOf(pgData);

		// Ablageort exakt wie in Notion bestimmen
		let parentLocal = ctx.parentLocal;
		if (parentLocal === undefined) {
			const pnid = await remoteParentId(token, pgData);
			parentLocal = pnid ? localIdForRemote(pnid, rev) : null;
		}
		if (parentLocal && (!S.pages[parentLocal] || S.pages[parentLocal].trashed)) parentLocal = null;

		// Inhalt lesen; Unterseiten nur einsammeln (kommen einzeln dran). Datenbanken
		// landen als Markdown-Tabelle direkt in der Seite, und ihre Zeilen-Seiten
		// werden zusätzlich als Unterseiten importiert (über childPageIds).
		const children = await loadAllChildren(token, nid);
		const childPageIds = [];
		const childDbIds = [];
		const md = await blocksToMd(token, children, {
			onChildPage: async (childId) => { childPageIds.push(normId(childId)); },
			// Echte Datenbanken statt eingefrorener Markdown-Tabellen: eigene lokale
			// Datenbank-Seite (Schema in pg.db), jede Zeile eine Unterseite mit props.
			onChildDb: async (dbId, dbTitle) => {
				try {
					const dbn = normId(dbId);
					const db = await req(token, "/databases/" + dbId);
					const schema = Object.entries(db.properties || {}).map(([name, p]) => ({ name, type: p.type }));
					schema.sort((a, b) => (a.type === "title" ? -1 : 0) - (b.type === "title" ? -1 : 0));
					const dTitle = dbTitle || plainText(db.title) || "Datenbank";
					const dIcon = db.icon && db.icon.type === "emoji" ? db.icon.emoji : "🗃";
					dbParentCache[dbn] = dbn; // Zeilen gehören lokal UNTER die Datenbank-Seite
					childDbIds.push(dbn);
					if (!S.pages[dbn]) {
						await STATE.dispatch("pageCreate", { id: dbn, title: dTitle, content: "", workspaceId: S.currentWorkspaceId || "default", icon: dIcon, db: { schema } });
					} else {
						await STATE.dispatch("pageUpdate", { id: dbn, patch: { title: dTitle, icon: dIcon, db: { schema } } });
						if (S.pages[dbn].trashed) await STATE.dispatch("pageRestore", { id: dbn });
					}
					let cursor;
					for (let i = 0; i < 20; i++) {
						const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
						const q = await req(token, "/databases/" + dbId + "/query", { method: "POST", body });
						for (const row of q.results || []) {
							checkCancelled();
							const rres = await pullRemotePage(token, row, { rev, merged: ctx.merged, parentLocal: dbn, restoreTrashed: true });
							for (const cid of rres.childPageIds) await importPageAndChildren(token, cid, rres.id, 0, { rev, visited: new Set([cid]) });
						}
						if (!q.has_more) break;
						cursor = q.next_cursor;
					}
					return "[🗃 " + dTitle + "](#" + dbn + ")\n\n";
				} catch (err) { console.warn("Datenbank " + dbId + " konnte nicht gelesen werden", err); return ""; }
			},
		});

		// Lokales Gegenstück: importiert (ID = Notion-UUID), gemappt — oder zusammenführen
		let id = localIdForRemote(nid, rev);
		if (!id) {
			const dupe = findMergeCandidate(title, md);
			if (dupe) {
				id = dupe.id;
				rev[nid] = id;
				const map = { ...(S.settings.notionMap || {}) };
				map[id] = nid;
				await STATE.dispatch("settingsSet", { notionMap: map });
				if (ctx.merged) ctx.merged.n++;
			}
		}
		if (id && S.pages[id] && S.pages[id].trashed && ctx.restoreTrashed) await STATE.dispatch("pageRestore", { id });

		// Workspace: vom Elternteil erben; Wurzelseiten behalten ihren bisherigen Workspace
		let wsId;
		if (parentLocal && S.pages[parentLocal]) wsId = S.pages[parentLocal].workspaceId || "default";
		else if (id && S.pages[id]) wsId = S.pages[id].workspaceId || "default";
		else wsId = S.currentWorkspaceId || "default";

		// Datenbank-Zeile? Dann alle Eigenschaften lesbar in props übernehmen —
		// sie füllen die editierbare Tabellen-Ansicht der lokalen Datenbank-Seite.
		let props = null;
		if ((pgData.parent || {}).type === "database_id") {
			props = {};
			for (const k of Object.keys(pgData.properties || {})) {
				if ((pgData.properties[k] || {}).type === "title") continue;
				props[k] = propToText(pgData.properties[k]);
			}
		}

		if (!id || !S.pages[id]) {
			id = nid;
			await STATE.dispatch("pageCreate", { id, title, parentId: parentLocal, content: md, workspaceId: wsId, icon, props });
		} else {
			const patch = { title, icon, content: md, workspaceId: wsId };
			if (props) patch.props = props;
			await STATE.dispatch("pageUpdate", { id, patch });
			// Verschieben separat über pageMove — dort greift der Zyklus-Schutz
			if ((S.pages[id].parentId || null) !== (parentLocal || null)) await STATE.dispatch("pageMove", { id, parentId: parentLocal });
		}
		// Datenbank-Seiten aus dem Inhalt unter diese Seite hängen (Ort wie in Notion)
		for (const dbLocal of childDbIds) {
			if (S.pages[dbLocal] && dbLocal !== id && (S.pages[dbLocal].parentId || null) !== id) await STATE.dispatch("pageMove", { id: dbLocal, parentId: id });
		}
		return { id, childPageIds };
	}

	// Rekursiver Einzelseiten-Import — für den „nur diese Seite“-Import und als
	// Sicherheitsnetz für Unterseiten, die die Notion-Suche nicht geliefert hat.
	// parentLocal === undefined → Ablageort aus den Notion-Daten auflösen.
	async function importPageAndChildren(token, blockId, parentLocal, depth, opts) {
		checkCancelled();
		opts = opts || {};
		if ((depth || 0) > 20) return null;
		const pgData = await req(token, "/pages/" + blockId);
		const res = await pullRemotePage(token, pgData, {
			rev: opts.rev, merged: opts.merged, parentLocal, restoreTrashed: true,
		});
		if (opts.counter) {
			opts.counter.n++;
			if (opts.onStatus) opts.onStatus(opts.counter.n, (S.pages[res.id] || {}).title || "");
		}
		for (const cid of res.childPageIds) {
			if (opts.visited) {
				if (opts.visited.has(cid)) continue;
				opts.visited.add(cid);
			}
			await importPageAndChildren(token, cid, res.id, (depth || 0) + 1, opts);
		}
		return res.id;
	}

	// Aufräum-Lauf nach Import/Sync: exakt gleiche, noch nicht zugeordnete lokale Kopien
	// (gleicher Titel UND gleicher Inhalt) werden mit ihrem Notion-Gegenstück zusammengeführt —
	// Unterseiten wandern zum Original, die Kopie in den Papierkorb (30 Tage wiederherstellbar).
	async function mergeDuplicates() {
		let merged = 0;
		const groups = {};
		for (const pg of STATE.activePages()) {
			const t = normText(pg.title);
			if (!t) continue;
			const key = t.toLowerCase() + "" + normText(pg.content);
			(groups[key] = groups[key] || []).push(pg);
		}
		for (const key in groups) {
			const keeper = groups[key].find((pg) => isLinked(pg));
			if (!keeper) continue;
			for (const dupe of groups[key]) {
				if (dupe.id === keeper.id || isLinked(dupe)) continue;
				for (const child of Object.values(S.pages)) {
					if (child.parentId === dupe.id) await STATE.dispatch("pageMove", { id: child.id, parentId: keeper.id });
				}
				await STATE.dispatch("pageTrash", { id: dupe.id });
				merged++;
			}
		}
		return merged;
	}

	// Workspace-Zugehörigkeit an die Struktur angleichen: Unterseiten erben den
	// Workspace ihrer Elternseite (wichtig nach Verschiebungen durch den Import).
	async function alignWorkspaces() {
		const visited = new Set();
		async function walk(pid, wsId) {
			for (const pg of Object.values(S.pages)) {
				if (pg.parentId !== pid || visited.has(pg.id)) continue;
				visited.add(pg.id);
				if ((pg.workspaceId || "default") !== wsId) await STATE.dispatch("pageUpdate", { id: pg.id, patch: { workspaceId: wsId } });
				await walk(pg.id, wsId);
			}
		}
		for (const pg of Object.values(S.pages)) {
			if (pg.parentId && S.pages[pg.parentId]) continue;
			visited.add(pg.id);
			await walk(pg.id, pg.workspaceId || "default");
		}
	}

	// ---------- Push: lokales Markdown → Notion-Blöcke ----------
	// Lange Texte in mehrere Rich-Text-Stücke teilen (Notion-Limit: 2000 Zeichen je Stück) —
	// vorher wurde alles nach 1900 Zeichen einfach abgeschnitten.
	const rt = (text) => {
		const s = String(text == null ? "" : text);
		const out = [];
		for (let i = 0; i < s.length && out.length < 90; i += 1900) out.push({ type: "text", text: { content: s.slice(i, i + 1900) } });
		return out.length ? out : [{ type: "text", text: { content: "" } }];
	};

	// ---------- Markdown-Inline → Notion rich_text mit echten Annotationen ----------
	const REV_COLOR = { gray: "gray", brown: "brown", orange: "orange", yellow: "yellow", green: "green", blue: "blue", purple: "purple", pink: "pink", red: "red" };
	function mdRichText(text) {
		const out = [];
		const push = (content, ann, href) => {
			if (!content) return;
			for (let i = 0; i < content.length && out.length < 95; i += 1900) {
				const seg = { type: "text", text: { content: content.slice(i, i + 1900) } };
				if (href) seg.text.link = { url: href };
				if (ann && Object.keys(ann).length) seg.annotations = { ...ann };
				out.push(seg);
			}
		};
		const RE = /(\*\*([\s\S]+?)\*\*)|(~~([\s\S]+?)~~)|(`([^`]+)`)|(==([^=\n]+)==)|(\{(bg-)?([a-z]+)\}([\s\S]*?)\{\/\})|(\$([^$\n]+)\$)|(!?\[([^\]]*)\]\(([^)\s]+)\))|(\*([^*\n]+)\*)|(<u>([\s\S]+?)<\/u>)/;
		const walk = (s, ann) => {
			let m;
			while (s && (m = RE.exec(s))) {
				if (m.index > 0) push(s.slice(0, m.index), ann);
				if (m[1]) walk(m[2], { ...ann, bold: true });
				else if (m[3]) walk(m[4], { ...ann, strikethrough: true });
				else if (m[5]) push(m[6], { ...ann, code: true });
				else if (m[7]) push(m[8], { ...ann, color: "yellow_background" });
				else if (m[9]) {
					const base = REV_COLOR[m[11]];
					walk(m[12], base ? { ...ann, color: m[10] ? base + "_background" : base } : { ...ann });
				} else if (m[13] && out.length < 95) out.push({ type: "equation", equation: { expression: m[14] } });
				else if (m[15]) {
					// Lokale Links (#seitenId) → notion.so-Link des Gegenstücks; Nicht-URLs
					// (z.B. img:…) als Klartext — Notion lehnt ungültige Link-URLs ab.
					let href = /^(https?:|mailto:)/.test(m[17]) ? m[17] : null;
					const loc = m[17].match(/^#([0-9a-fA-F-]{32,36})$/);
					const lnid = loc ? (notionIdOf(loc[1]) || notionIdOf(loc[1].replace(/-/g, ""))) : null;
					if (lnid) href = "https://www.notion.so/" + lnid;
					push(m[16] || m[17], ann, href);
				}
				else if (m[18]) walk(m[19], { ...ann, italic: true });
				else if (m[20]) walk(m[21], { ...ann, underline: true });
				s = s.slice(m.index + m[0].length);
			}
			if (s) push(s, ann);
		};
		walk(String(text == null ? "" : text), {});
		return out.length ? out : [{ type: "text", text: { content: "" } }];
	}

	// Code-Sprachen, die Notion akzeptiert (sonst lehnt die API den Block ab).
	const LANG_ALIAS = { js: "javascript", ts: "typescript", py: "python", sh: "bash", yml: "yaml", text: "plain text", txt: "plain text", plaintext: "plain text", cpp: "c++", cs: "c#", md: "markdown" };
	const NOTION_LANGS = new Set(["abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++", "c#", "css", "dart", "diff", "docker", "elixir", "elm", "erlang", "flow", "fortran", "f#", "gherkin", "glsl", "go", "graphql", "groovy", "haskell", "html", "java", "javascript", "json", "julia", "kotlin", "latex", "less", "lisp", "livescript", "lua", "makefile", "markdown", "markup", "matlab", "mermaid", "nix", "objective-c", "ocaml", "pascal", "perl", "php", "plain text", "powershell", "prolog", "protobuf", "python", "r", "reason", "ruby", "rust", "sass", "scala", "scheme", "scss", "shell", "sql", "swift", "typescript", "vb.net", "verilog", "vhdl", "visual basic", "webassembly", "xml", "yaml"]);
	const notionLang = (lang) => {
		const l = (lang || "").toLowerCase();
		return NOTION_LANGS.has(l) ? l : LANG_ALIAS[l] || "plain text";
	};

	// Eine Listen-Sequenz (2 Leerzeichen Einrückung = eine Ebene, wie im Editor)
	// in verschachtelte Notion-Listen-Blöcke umwandeln; gibt den Folgeindex zurück.
	const LIST_RE = /^(\s*)(- \[( |x)\] |- |\d+\. )(.*)$/;
	function listRun(lines, start, blocks) {
		let i = start;
		const stack = [{ children: blocks, depth: -1 }];
		while (i < lines.length) {
			const m = lines[i].match(LIST_RE);
			if (!m) break;
			const depth = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
			const blk = m[2].startsWith("- [")
				? { type: "to_do", to_do: { checked: m[3] === "x", rich_text: mdRichText(m[4]) } }
				: m[2] === "- "
					? { type: "bulleted_list_item", bulleted_list_item: { rich_text: mdRichText(m[4]) } }
					: { type: "numbered_list_item", numbered_list_item: { rich_text: mdRichText(m[4]) } };
			while (stack.length > 1 && depth <= stack[stack.length - 1].depth) stack.pop();
			const top = stack[stack.length - 1];
			if (top.blk) (top.blk[top.blk.type].children = top.blk[top.blk.type].children || []).push(blk);
			else top.children.push(blk);
			stack.push({ blk, depth });
			i++;
		}
		return i;
	}

	// ---------- Zeilen → Notion-Blöcke (mit Tabellen, Spalten, Toggles, Formeln) ----------
	function linesToBlocks(lines) {
		const blocks = [];
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			const t = line.trim();
			// Code-Zaun
			if (t.startsWith("```")) {
				const lang = t.slice(3).trim();
				const body = [];
				i++;
				while (i < lines.length && !lines[i].trim().startsWith("```")) { body.push(lines[i]); i++; }
				i++;
				blocks.push({ type: "code", code: { language: notionLang(lang), rich_text: [{ type: "text", text: { content: body.join("\n").slice(0, 1900) } }] } });
				continue;
			}
			// Formel-Block $$…$$ (ein- oder mehrzeilig)
			if (t.startsWith("$$")) {
				let expr = t.slice(2);
				if (expr.endsWith("$$")) expr = expr.slice(0, -2);
				else { i++; while (i < lines.length && !lines[i].trim().endsWith("$$")) { expr += "\n" + lines[i]; i++; } if (i < lines.length) expr += "\n" + lines[i].trim().slice(0, -2); }
				blocks.push({ type: "equation", equation: { expression: expr.trim() } });
				i++;
				continue;
			}
			// Spalten :::columns … :::split … :::end
			if (t === ":::columns") {
				const cols = [[]];
				i++;
				let nest = 0;
				while (i < lines.length) {
					const c = lines[i].trim();
					if (c === ":::columns") nest++;
					if (c === ":::end" && nest === 0) break;
					if (c === ":::end") nest--;
					if (c === ":::split" && nest === 0) cols.push([]);
					else cols[cols.length - 1].push(lines[i]);
					i++;
				}
				i++;
				blocks.push({ type: "column_list", column_list: { children: cols.map((c) => ({ type: "column", column: { children: linesToBlocks(c) } })) } });
				continue;
			}
			// Toggle <details><summary>…</summary> … </details>
			if (t.startsWith("<details>")) {
				const sm = t.match(/<summary>([\s\S]*?)<\/summary>/);
				const body = [];
				i++;
				while (i < lines.length && !lines[i].trim().startsWith("</details>")) { body.push(lines[i]); i++; }
				i++;
				blocks.push({ type: "toggle", toggle: { rich_text: mdRichText(sm ? sm[1] : "Toggle"), children: linesToBlocks(body) } });
				continue;
			}
			// Tabelle (GitHub-Stil)
			if (t.startsWith("|") && t.endsWith("|")) {
				const rows = [];
				while (i < lines.length) {
					const r = lines[i].trim();
					if (!(r.startsWith("|") && r.endsWith("|"))) break;
					const cells = r.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
					if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells);
					i++;
				}
				const width = Math.max(1, ...rows.map((r) => r.length));
				blocks.push({ type: "table", table: { table_width: width, has_column_header: rows.length > 1, has_row_header: false, children: rows.map((r) => ({ type: "table_row", table_row: { cells: Array.from({ length: width }, (_, ci) => mdRichText(r[ci] || "")) } })) } });
				continue;
			}
			// Listen (verschachtelt)
			if (LIST_RE.test(line) && t) { i = listRun(lines, i, blocks); continue; }
			if (!t) { i++; continue; }
			// Bild
			const img = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
			if (img) {
				if (/^https?:\/\//.test(img[2])) blocks.push({ type: "image", image: { type: "external", external: { url: img[2] } } });
				else blocks.push({ type: "paragraph", paragraph: { rich_text: mdRichText("\ud83d\uddbc *" + (img[1] || "Bild") + "* (lokales Bild — Notions API erlaubt keinen Datei-Upload)") } });
				i++;
				continue;
			}
			// Callout > [!farbe] 💡 Text — ">"-Folgezeilen gehören mit IN die Box
			const co = t.match(/^> \[!([a-z]+)\] ?([\s\S]*)$/);
			if (co) {
				const cont = [];
				i++;
				while (i < lines.length && /^>(\s|$)/.test(lines[i].trim()) && !/^> \[!/.test(lines[i].trim())) {
					cont.push(lines[i].trim().replace(/^>\s?/, ""));
					i++;
				}
				let txt = co[2];
				let icon = "\ud83d\udca1";
				const em = txt.match(/^(\p{Extended_Pictographic}️?)\s+/u);
				if (em) { icon = em[1]; txt = txt.slice(em[0].length); }
				const base = REV_COLOR[co[1]] || "blue";
				const cob = { type: "callout", callout: { icon: { type: "emoji", emoji: icon }, color: base + "_background", rich_text: mdRichText(txt) } };
				if (cont.filter((l) => l.trim()).length) cob.callout.children = linesToBlocks(cont);
				blocks.push(cob);
				continue;
			}
			// Mehrzeiliges Zitat: ">"-Folgezeilen werden Kinder des Zitat-Blocks
			if (t.startsWith(">")) {
				const cont = [];
				i++;
				while (i < lines.length && /^>(\s|$)/.test(lines[i].trim()) && !/^> \[!/.test(lines[i].trim())) {
					cont.push(lines[i].trim().replace(/^>\s?/, ""));
					i++;
				}
				const qb = { type: "quote", quote: { rich_text: mdRichText(t.replace(/^>\s?/, "")) } };
				if (cont.filter((l) => l.trim()).length) qb.quote.children = linesToBlocks(cont);
				blocks.push(qb);
				continue;
			}
			if (t.startsWith("### ")) blocks.push({ type: "heading_3", heading_3: { rich_text: mdRichText(t.slice(4)) } });
			else if (t.startsWith("## ")) blocks.push({ type: "heading_2", heading_2: { rich_text: mdRichText(t.slice(3)) } });
			else if (t.startsWith("# ")) blocks.push({ type: "heading_1", heading_1: { rich_text: mdRichText(t.slice(2)) } });
			else if (/^(-{3,}|\*{3,})$/.test(t)) blocks.push({ type: "divider", divider: {} });
			else blocks.push({ type: "paragraph", paragraph: { rich_text: mdRichText(t) } });
			i++;
		}
		return blocks;
	}

	// Notion erlaubt beim Anhängen nur 2 Ebenen verschachtelter Kinder pro Anfrage —
	// tiefere Ebenen werden zu Geschwistern hochgezogen (Tabellenzeilen bleiben unberührt).
	function clampChildren(blocks, level) {
		const out = [];
		for (const b of blocks) {
			out.push(b);
			const body = b[b.type];
			if (!body || !Array.isArray(body.children) || b.type === "table" || b.type === "column_list") continue;
			if (level >= 1) { out.push(...clampChildren(body.children, level)); delete body.children; }
			else body.children = clampChildren(body.children, level + 1);
		}
		return out;
	}

	function mdToBlocks(md) {
		return linesToBlocks(String(md || "").replace(/\r/g, "").split("\n"));
	}

	// Blöcke in 90er-Paketen anhängen (Notion-Limit: max. 100 Blöcke je Anfrage) —
	// vorher wurde alles nach Block 90 einfach abgeschnitten.
	async function appendBlocks(token, notionId, blocks) {
		blocks = clampChildren(blocks, 0);
		for (let i = 0; i < blocks.length; i += 90) {
			checkCancelled();
			await req(token, "/blocks/" + notionId + "/children", { method: "PATCH", body: { children: blocks.slice(i, i + 90) } });
		}
	}

	// Notion-Gegenstück einer lokalen Seite: importierte Seiten nutzen die Notion-UUID
	// als lokale ID, lokal erstellte Seiten stehen in der Zuordnungstabelle (settings.notionMap).
	function notionIdOf(localId) {
		if (/^[0-9a-f]{32}$/.test(localId)) return localId;
		return (S.settings.notionMap || {})[localId] || null;
	}

	// props (Text) → Notion-Eigenschaftswerte anhand des Datenbank-Schemas der Elternseite.
	// Nur beschreibbare Typen — Formeln, Rollups, Personen & Co. bleiben unangetastet.
	function propsToNotion(pg) {
		const parent = pg.parentId ? S.pages[pg.parentId] : null;
		const schema = parent && parent.db && parent.db.schema;
		if (!schema || !pg.props) return null;
		const out = {};
		for (const col of schema) {
			if (col.type === "title" || !(col.name in pg.props)) continue;
			const v = String(pg.props[col.name] == null ? "" : pg.props[col.name]).trim();
			const t = col.type;
			if (t === "rich_text") out[col.name] = { rich_text: v ? mdRichText(v) : [] };
			else if (t === "number") { const n = parseFloat(v.replace(",", ".")); out[col.name] = { number: isNaN(n) ? null : n }; }
			else if (t === "select") out[col.name] = { select: v ? { name: v } : null };
			else if (t === "status") { if (v) out[col.name] = { status: { name: v } }; }
			else if (t === "multi_select") out[col.name] = { multi_select: v ? v.split(",").map((s) => ({ name: s.trim() })).filter((o) => o.name) : [] };
			else if (t === "checkbox") out[col.name] = { checkbox: /^(✅|✔|x|ja|true|1)$/i.test(v) };
			else if (t === "url") out[col.name] = { url: v || null };
			else if (t === "email") out[col.name] = { email: v || null };
			else if (t === "phone_number") out[col.name] = { phone_number: v || null };
			else if (t === "date") {
				const parts = v.split("→").map((s) => s.trim()).filter(Boolean);
				out[col.name] = { date: parts.length ? { start: parts[0], end: parts[1] || null } : null };
			}
		}
		return Object.keys(out).length ? out : null;
	}

	// Bestehende Notion-Seite aktualisieren: Titel/Icon/Eigenschaften setzen, alte Blöcke entfernen, Inhalt neu anhängen.
	async function pushPage(token, pg, notionId) {
		await req(token, "/pages/" + notionId, { method: "PATCH", body: {
			properties: { title: { title: rt(pg.title) }, ...(propsToNotion(pg) || {}) },
			icon: pg.icon ? { type: "emoji", emoji: pg.icon } : undefined,
		} });
		const children = await loadAllChildren(token, notionId);
		for (const b of children) {
			if (b.type === "child_page" || b.type === "child_database") continue; // Unterseiten niemals löschen
			await req(token, "/blocks/" + b.id, { method: "DELETE" });
		}
		await appendBlocks(token, notionId, mdToBlocks(pg.content));
	}

	// Lokal neue Seite in Notion anlegen (unter dem Gegenstück der Eltern- bzw. der Wurzelseite).
	async function createRemote(token, pg, parentNotionId) {
		const blocks = clampChildren(mdToBlocks(pg.content), 0);
		// Unterseite einer Datenbank-Seite? Dann als ECHTE neue Datenbank-Zeile anlegen.
		const parentPg = pg.parentId ? S.pages[pg.parentId] : null;
		const isDbRow = !!(parentPg && parentPg.db);
		const data = await req(token, "/pages", { method: "POST", body: {
			parent: isDbRow ? { database_id: parentNotionId } : { page_id: parentNotionId },
			icon: pg.icon ? { type: "emoji", emoji: pg.icon } : undefined,
			properties: { title: { title: rt(pg.title) }, ...(propsToNotion(pg) || {}) },
			children: blocks.slice(0, 90),
		} });
		const newId = (data.id || "").replace(/-/g, "");
		if (newId && blocks.length > 90) await appendBlocks(token, newId, blocks.slice(90));
		return newId;
	}

	return {
		cancel,

		// onStatus(text, fraction) — fraction ist 0..1, wenn die Gesamtmenge bekannt ist,
		// sonst null (unbestimmter Fortschritt). Der Import spiegelt die Notion-Struktur
		// EXAKT: Eltern werden zuerst angelegt, jede Seite landet unter ihrem echten
		// Notion-Elternteil (Datenbank-Zeilen unter der Seite mit der Datenbank), und
		// exakt gleiche lokale Seiten werden zusammengeführt statt dupliziert.
		async migrate(token, pageId, onStatus) {
			cancelled = false;
			const rev = reverseMap();
			const merged = { n: 0 };
			const counter = { n: 0 };
			const reportProgress = (n, title) => { if (onStatus) onStatus("Importiere (" + n + " Seiten bisher) — zuletzt „" + title + "“…", null); };
			if (pageId) {
				if (onStatus) onStatus("Lese Notion-Seite…", null);
				const rootId = await importPageAndChildren(token, pageId, undefined, 0, {
					rev, merged, counter, visited: new Set([normId(pageId)]), onStatus: reportProgress,
				});
				await alignWorkspaces();
				await mergeDuplicates();
				return rootId;
			}
			if (onStatus) onStatus("Suche freigegebene Notion-Seiten…", null);
			const remote = await listRemotePages(token, (n) => { if (onStatus) onStatus("Suche freigegebene Notion-Seiten… (" + n + ")", null); });
			if (!remote.length) throw new Error("Keine freigegebenen Seiten gefunden. Teile Seiten in Notion zuerst mit deiner Integration.");
			// Eltern vor Kindern importieren — so entsteht jede Seite direkt am richtigen Ort.
			const byId = {};
			remote.forEach((r) => { byId[normId(r.id)] = r; });
			const order = [];
			const seen = new Set();
			async function addInOrder(r) {
				const nid = normId(r.id);
				if (seen.has(nid)) return;
				seen.add(nid);
				const pnid = await remoteParentId(token, r);
				if (pnid && byId[pnid]) await addInOrder(byId[pnid]);
				order.push(r);
			}
			for (const r of remote) await addInOrder(r);
			let lastId = null;
			const visited = new Set(order.map((r) => normId(r.id)));
			for (let i = 0; i < order.length; i++) {
				checkCancelled();
				const { title } = titleAndIconOf(order[i]);
				if (onStatus) onStatus("Importiere " + (i + 1) + "/" + order.length + " — „" + title + "“…", (i + 1) / order.length);
				const res = await pullRemotePage(token, order[i], { rev, merged, restoreTrashed: true });
				lastId = res.id;
				// Sicherheitsnetz: Unterseiten, die die Notion-Suche nicht geliefert hat
				for (const cid of res.childPageIds) {
					if (visited.has(cid)) continue;
					visited.add(cid);
					await importPageAndChildren(token, cid, res.id, 0, { rev, merged, counter, visited, onStatus: reportProgress });
				}
			}
			await alignWorkspaces();
			await mergeDuplicates();
			return lastId;
		},

		// Zwei-Wege-Sync mit Sync-Gedächtnis (settings.notionMeta): für jede Seite wird der
		// zuletzt abgeglichene Stand (remote r + lokal l) gemerkt. Dadurch wird nur echt
		// Geändertes übertragen (kein Ping-Pong durch den Import-Zeitstempel mehr), bei
		// beidseitiger Änderung gewinnt die neuere Version, und die Struktur folgt exakt
		// Notion (Notion ist die Referenz für den Ablageort). Lokal NEUE Seiten entstehen
		// in Notion unter dem Gegenstück ihrer Elternseite (sonst unter der Wurzelseite),
		// exakt gleiche lokale Seiten werden zusammengeführt statt dupliziert.
		async sync(token, rootPageId, onStatus) {
			cancelled = false;
			const say = (s, f) => { if (onStatus) onStatus(s, f); };
			const rev = reverseMap();
			const mergedCounter = { n: 0 };
			const meta = { ...(S.settings.notionMeta || {}) };
			say("Lese Notion-Seiten…", null);
			const remote = await listRemotePages(token, (n) => say("Lese Notion-Seiten… (" + n + ")", null));
			const remoteById = {};
			remote.forEach((r) => { remoteById[normId(r.id)] = r; });
			let pulled = 0, pushed = 0, created = 0;

			// 1) Pull — Eltern zuerst, damit jede Seite direkt am exakt richtigen Ort landet.
			const order = [];
			const seen = new Set();
			async function addInOrder(r) {
				const nid = normId(r.id);
				if (seen.has(nid)) return;
				seen.add(nid);
				const pnid = await remoteParentId(token, r);
				if (pnid && remoteById[pnid]) await addInOrder(remoteById[pnid]);
				order.push(r);
			}
			for (const r of remote) await addInOrder(r);

			for (let i = 0; i < order.length; i++) {
				checkCancelled();
				const r = order[i];
				const nid = normId(r.id);
				const redit = r.last_edited_time || "";
				const localId = localIdForRemote(nid, rev);
				const localPg = localId ? S.pages[localId] : null;
				if (localPg && localPg.trashed) continue; // lokal in den Papierkorb gelegt → nicht wiederbeleben
				const m = meta[nid];
				if (!localPg && localId && m) continue; // lokal endgültig gelöscht → nicht wiederbeleben
				const remoteChanged = !m || redit > (m.r || "");
				const localChanged = !!localPg && (!m || (localPg.updated || "") > (m.l || ""));
				// Übernehmen, wenn die Seite lokal fehlt oder Notion Neues hat.
				// Bei beidseitiger Änderung entscheidet der Zeitstempel (die neuere Version gewinnt).
				if (!localPg || (remoteChanged && (!localChanged || redit >= (localPg.updated || "")))) {
					say("⬇ Übernehme " + (i + 1) + "/" + order.length + "…", (i + 1) / (order.length + 1) * 0.5);
					const res = await pullRemotePage(token, r, { rev, merged: mergedCounter });
					meta[nid] = { r: redit, l: (S.pages[res.id] || {}).updated || "" };
					pulled++;
					// Sicherheitsnetz: Unterseiten, die die Notion-Suche nicht geliefert hat
					for (const cid of res.childPageIds) {
						if (remoteById[cid] || localIdForRemote(cid, rev)) continue;
						await importPageAndChildren(token, cid, res.id, 0, { rev, merged: mergedCounter, visited: new Set([cid]) });
					}
				}
			}
			await alignWorkspaces();

			// 2) Push — lokal Geändertes nach Notion, lokal Neues dort anlegen (Eltern zuerst,
			// damit neue Unterbäume in Notion mit derselben Struktur entstehen).
			const activeById = {};
			STATE.activePages().forEach((pg) => { activeById[pg.id] = pg; });
			const localOrder = [];
			const lseen = new Set();
			const addLocal = (pg) => {
				if (lseen.has(pg.id)) return;
				lseen.add(pg.id);
				if (pg.parentId && activeById[pg.parentId]) addLocal(activeById[pg.parentId]);
				localOrder.push(pg);
			};
			Object.values(activeById).forEach(addLocal);
			const mapPatch = { ...(S.settings.notionMap || {}) };
			const nidOf = (localId) => (/^[0-9a-f]{32}$/.test(localId) ? localId : mapPatch[localId] || null);
			for (let i = 0; i < localOrder.length; i++) {
				checkCancelled();
				const pg = localOrder[i];
				say("⬆ Prüfe " + (i + 1) + "/" + localOrder.length + "…", 0.5 + (i + 1) / (localOrder.length + 1) * 0.5);
				const nid = nidOf(pg.id);
				if (nid && remoteById[nid]) {
					const m = meta[nid];
					const redit = remoteById[nid].last_edited_time || "";
					const localChanged = !m || (pg.updated || "") > (m.l || "");
					const remoteNewer = redit > (pg.updated || "");
					if (localChanged && !remoteNewer) {
						await pushPage(token, pg, nid);
						const fresh = await req(token, "/pages/" + nid);
						meta[nid] = { r: fresh.last_edited_time || redit, l: pg.updated || "" };
						pushed++;
					} else if (!m) {
						meta[nid] = { r: redit, l: pg.updated || "" }; // Stand als abgeglichen merken
					}
				} else if (!nid) {
					const parentNid = pg.parentId ? nidOf(pg.parentId) : null;
					const target = parentNid || (rootPageId ? normId(rootPageId) : "");
					if (!target) continue; // ohne Wurzelseite gibt es kein Ziel in Notion
					const newId = await createRemote(token, pg, target);
					if (newId) {
						mapPatch[pg.id] = newId;
						rev[newId] = pg.id;
						const fresh = await req(token, "/pages/" + newId);
						meta[newId] = { r: fresh.last_edited_time || "", l: pg.updated || "" };
						created++;
					}
				}
			}

			await STATE.dispatch("settingsSet", { notionMap: mapPatch, notionMeta: meta });
			const mergedTrash = await mergeDuplicates();
			await STATE.dispatch("settingsSet", { notionLastSync: U.now() });
			return { pulled, pushed, created, merged: mergedCounter.n + mergedTrash };
		},
	};
})();

// Zeichnet den Notion-Fortschritt in die Einstellungen — falls sie offen sind.
// Der Zustand lebt in S.notionJob und überlebt so das Schließen des Dialogs:
// beim Wiederöffnen (render.js → openSettings) wird er einfach neu gezeichnet.
function renderNotionJob() {
	const bar = U.el("notionProgress");
	if (!bar) return; // Einstellungen (Notion-Tab) sind gerade nicht offen
	const job = S.notionJob;
	const fill = bar.querySelector(".progress-fill");
	const status = U.el("notionStatus");
	const cancelBtn = U.el("btnNotionCancel");
	const btnImp = U.el("btnMigrateNotion");
	const btnSync = U.el("btnNotionSync");
	const running = !!(job && job.running);
	bar.hidden = !job || (!running && job.fraction == null);
	if (fill) {
		if (job && job.fraction != null) { bar.classList.remove("indeterminate"); fill.style.width = Math.round(job.fraction * 100) + "%"; }
		else { bar.classList.toggle("indeterminate", running); fill.style.width = ""; }
	}
	if (status) status.textContent = job ? job.status || "" : "";
	if (cancelBtn) {
		cancelBtn.hidden = !running;
		cancelBtn.disabled = !!(job && job.cancelling);
		cancelBtn.textContent = job && job.cancelling ? "Wird abgebrochen…" : "⏹ Abbrechen";
	}
	if (btnImp) { btnImp.disabled = running; btnImp.textContent = running && job.kind === "import" ? "Importiere…" : "⬇ Import"; }
	if (btnSync) { btnSync.disabled = running; btnSync.textContent = running && job.kind === "sync" ? "Synchronisiere…" : "⇅ Zwei-Wege-Sync"; }
}

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
			checkAI();
			return;
		}

		// Quelle entfernen (Einstellungen → KI)
		if (t.dataset.provdel) {
			const providers = (S.settings.aiProviders || []).filter((p) => p.id !== t.dataset.provdel);
			await STATE.dispatch("settingsSet", { aiProviders: providers });
			openSettings("ki");
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
				checkAI();
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
			S.libView = t.dataset.libview;
			renderMain();
			return;
		}

		// Bibliothek (Kacheln): Ordner-Navigation (Wurzel, Workspace, in Unterseiten)
		if (t.dataset.libroot) { S.libFolder = null; renderMain(); return; }
		if (t.dataset.libws) { S.libFolder = { wsId: t.dataset.libws, pageId: null }; renderMain(); return; }
		if (t.dataset.libinto) {
			const pg = S.pages[t.dataset.libinto];
			if (pg) S.libFolder = { wsId: pg.workspaceId || "default", pageId: pg.id };
			renderMain();
			return;
		}

		// Bibliothek: „＋ Neue Seite“-Kachel legt die Seite direkt im aktuellen Ordner an
		if (t.dataset.libnew) {
			const f = S.libFolder || { wsId: Object.keys(S.workspaces)[0] || "default", pageId: null };
			await newPageFlow(f.wsId, f.pageId);
			return;
		}

		// Bibliothek: Spaltenüberschrift klicken = sortieren (erneut klicken = Richtung wechseln)
		if (t.dataset.libsort) {
			if (S.libSort === t.dataset.libsort) S.libSortDir = -(S.libSortDir || -1);
			else { S.libSort = t.dataset.libsort; S.libSortDir = 1; }
			renderMain();
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
		if (t.dataset.zipws) { exportWorkspaceZip(t.dataset.zipws); return; }

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

		if (t.dataset.set) { openSettings(t.dataset.set); return; }

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
			case "btnCreateWs": {
				const inp = document.getElementById("inpWsName");
				const name = inp ? inp.value.trim() : "";
				if (name) {
					await STATE.dispatch("workspaceCreate", { id: U.uid(), name });
					render();
				}
				break;
			}
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
			case "btnSettings": openSettings(); break;
			case "btnMigrateNotion":
			case "btnNotionSync": {
				if (S.notionJob && S.notionJob.running) break;
				const isSync = t.id === "btnNotionSync";
				const tok = U.el("inpNotionToken").value.trim();
				const pid = U.el("inpNotionPage").value.trim();
				const prox = U.el("inpCorsProxy") ? U.el("inpCorsProxy").value.trim() : (S.settings.corsProxy || "");
				S.notionToken = tok;
				S.notionPageId = pid;
				await STATE.dispatch("settingsSet", { notionToken: tok, notionPageId: pid, corsProxy: prox });
				if (!tok) { alert("Token ist erforderlich."); break; }
				// Fortschritt lebt in S.notionJob (nicht in lokalen DOM-Referenzen) — so
				// überlebt er das Schließen der Einstellungen und wird beim Wiederöffnen
				// von openSettings() über renderNotionJob() einfach neu gezeichnet.
				S.notionJob = { running: true, cancelling: false, kind: isSync ? "sync" : "import", status: isSync ? "Starte Sync…" : "Starte Import…", fraction: null };
				renderNotionJob();
				const onStatus = (st, fraction) => {
					S.notionJob.status = st;
					S.notionJob.fraction = fraction == null ? null : fraction;
					renderNotionJob();
				};
				try {
					if (isSync) {
						const r = await NOTION_MIGRATOR.sync(tok, pid || null, onStatus);
						S.notionJob.status = "✅ Sync fertig — " + r.pulled + " übernommen, " + r.pushed + " nach Notion übertragen, " + r.created + " in Notion angelegt" + (r.merged ? ", " + r.merged + " Duplikat(e) zusammengeführt" : "") + ".";
					} else {
						const newId = await NOTION_MIGRATOR.migrate(tok, pid || null, onStatus);
						S.notionJob.status = "✅ Import fertig!";
						if (newId) setTimeout(() => { closeOverlay(); openPage(newId); }, 600);
					}
					S.notionJob.fraction = 1;
				} catch (err) {
					S.notionJob.status = err.cancelled ? "⏹ Abgebrochen." : "⚠️ " + err.message;
					S.notionJob.fraction = null;
				}
				S.notionJob.running = false;
				S.notionJob.cancelling = false;
				renderNotionJob();
				render();
				break;
			}
			case "btnNotionCancel": {
				NOTION_MIGRATOR.cancel();
				if (S.notionJob) { S.notionJob.cancelling = true; S.notionJob.status = "Wird abgebrochen…"; }
				renderNotionJob();
				break;
			}
			case "btnDriveLogin": {
				t.disabled = true;
				const old = t.textContent;
				t.textContent = "Verbinde…";
				try {
					const info = await DRIVE.login();
					S.driveUserEmail = (info && info.email) ? info.email : "Google-Konto";
					openSettings("sync");
				} catch (err) {
					alert("Anmeldung fehlgeschlagen: " + err.message);
					t.disabled = false;
					t.textContent = old;
				}
				break;
			}
			case "btnDriveLogout":
				DRIVE.logout();
				S.driveUserEmail = null;
				openSettings("sync");
				break;
			case "btnDriveSyncSettings": {
				t.disabled = true;
				const old = t.textContent;
				try {
					const imported = await DRIVE.sync((st) => { t.textContent = st; });
					if (imported > 0) { alert("Sync fertig — " + imported + " Änderungen übernommen. Die App lädt neu."); location.reload(); }
					else alert("Sync abgeschlossen — keine neuen Änderungen.");
				} catch (err) {
					alert("Sync fehlgeschlagen: " + err.message);
				}
				t.disabled = false;
				t.textContent = old;
				break;
			}
			case "btnAddProvider": {
				const providers = (S.settings.aiProviders || []).slice();
				providers.push({ id: U.uid(), name: "Neue Quelle", base: "", key: "" });
				await STATE.dispatch("settingsSet", { aiProviders: providers });
				openSettings("ki");
				break;
			}
			case "btnSaveSettings": {
				const patch = {};
				const g = (id) => document.getElementById(id);
				const provRows = document.querySelectorAll("[data-provrow]");
				if (provRows.length) {
					patch.aiProviders = Array.from(provRows).map((row) => {
						const id = row.dataset.provrow;
						const nameEl = row.querySelector("[data-provname]");
						const baseEl = row.querySelector("[data-provbase]");
						const keyEl = row.querySelector("[data-provkey]");
						return {
							id,
							name: nameEl && nameEl.value.trim() ? nameEl.value.trim() : id,
							base: baseEl ? baseEl.value.trim() : "",
							key: keyEl ? keyEl.value.trim() : "",
						};
					});
				}
				if (g("inpEmbed")) patch.embedModel = g("inpEmbed").value.trim();
				if (g("inpDrive")) patch.driveClientId = g("inpDrive").value.trim();
				if (g("inpCustomInstructions")) patch.customInstructions = g("inpCustomInstructions").value;
				await STATE.dispatch("settingsSet", patch);
				closeOverlay();
				checkAI();
				RAG.reindexStale();
				S.availableModels = [];
				break;
			}
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
				await DB.putBlob("bgImage", new ArrayBuffer(0), {});
				applyBg();
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
			case "btnDriveSync": {
				if (!S.settings.driveClientId) {
					alert("Für den Drive-Sync brauchst du einmalig eine Google OAuth Client-ID:\n" +
						"Google Cloud Console → Drive-API aktivieren → OAuth-Client (Webanwendung) → " +
						"Client-ID in Einstellungen → Sync eintragen. Danach reicht ein Klick.");
					break;
				}
				t.disabled = true;
				try {
					const imported = await DRIVE.sync((st) => { t.textContent = "☁️ " + st; });
					if (imported > 0) {
						alert("Sync fertig — " + imported + " Änderungen übernommen. Die App lädt neu.");
						location.reload();
					}
				} catch (err) {
					alert("Sync fehlgeschlagen: " + err.message);
				}
				t.disabled = false;
				t.textContent = "☁️ Sync";
				break;
			}
			case "btnBackupNow":
			case "btnExport":
				U.download("notion-export-" + new Date().toISOString().slice(0, 10) + ".json", await DB.exportAll());
				// Backup-Zeitpunkt merken — steuert die Erinnerung auf der Startseite
				localStorage.setItem("notionLastBackup", new Date().toISOString());
				if (S.view === "home") renderMain();
				break;
			case "btnSidebarToggle": document.body.classList.toggle("sidebar-open"); break;
			case "btnThemeDark":
			case "btnThemeLight":
				localStorage.setItem("notionTheme", t.id === "btnThemeLight" ? "light" : "dark");
				applyTheme();
				break;
			case "btnImport": U.el("fileImport").click(); break;
			case "btnOpenPdf":
				S.pdfOpen = !S.pdfOpen;
				if (document.activeElement) document.activeElement.blur();
				render();
				break;
			case "btnResetAll": {
				if (confirm("⚠️ ACHTUNG: Möchtest du wirklich alle lokalen Seiten unwiderruflich löschen?\n\nDeine Einstellungen, API-Keys, Karteikarten und Stapel bleiben erhalten!")) {
					t.disabled = true;
					t.textContent = "Lösche Seiten...";
					try {
						await DB.clearPages();
						alert("Alle Seiten wurden erfolgreich gelöscht. Aura lädt sich nun neu.");
						location.reload();
					} catch (err) {
						alert("Fehler beim Löschen der Seiten: " + err.message);
						t.disabled = false;
						t.textContent = "Alle Seiten löschen";
					}
				}
				break;
			}
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
			S.libFilter = e.target.value;
			const pos = e.target.selectionStart;
			renderLibrary(U.el("main"));
			const inp = U.el("libFilter");
			if (inp) { inp.focus(); inp.selectionStart = inp.selectionEnd = pos; }
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
			checkAI();
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
			const file = e.target.files[0];
			e.target.value = "";
			const buf = await U.readAsBuffer(file);
			await DB.putBlob("bgImage", buf, { name: file.name, type: file.type });
			applyBg();
		}
		if (e.target.id === "fileImport" && e.target.files[0]) {
			const file = e.target.files[0];
			e.target.value = "";
			try {
				const added = await DB.importAll(await U.readAsText(file));
				alert(added + " Änderungen importiert. Die App lädt neu.");
				location.reload();
			} catch (err) {
				alert("Import fehlgeschlagen: " + err.message);
			}
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

window.addEventListener("DOMContentLoaded", async () => {
	await DB.open();
	// Speicher als persistent markieren — der Browser darf IndexedDB dann nicht still räumen.
	if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
	applyTheme();
	await STATE.load();
	await purgeOldTrash();
	await seedIfEmpty();
	wireEvents();
	applyBg();
	render();
	checkAI();
	// Ping nur bei sichtbarem Tab (spart Akku); beim Zurückkehren sofort prüfen.
	setInterval(() => { if (!document.hidden) checkAI(); }, 60000);
	document.addEventListener("visibilitychange", () => { if (!document.hidden) checkAI(); });
	RAG.reindexStale();
});