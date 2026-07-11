"use strict";

import { S, STATE } from "./state.js";
import { TOOLS } from "./tools.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { CHATS } from "./chats.js";

// ai.js — KI-Adapter (OpenAI-kompatibel: LM Studio, OpenAI, Google Gemini).
// Mit Streaming (SSE), Modellauswahl, Reasoning/Thinking-Erfassung, Verbindungs-
// Ping, Embeddings und automatischer Diff-Erfassung für Seiten-Bearbeitungen.
export const AI = (() => {
	// Kuratierte Modell-Presets für die Dropdown-Auswahl im Chat-Panel.
	// "Eigenes" Modelle (z.B. lokale LM-Studio-Namen) werden automatisch ergänzt.
	const MODEL_PRESETS = [
		{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
		{ value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
		{ value: "gemma-4-31b-it", label: "Gemma 4 31B", provider: "google" },
		{ value: "gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B", provider: "google" },
		{ value: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
		{ value: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai" },
		{ value: "local-model", label: "Lokales Modell", provider: "local" },
	];
	// Tools, die Seiteninhalte verändern — für diese wird automatisch ein
	// Vorher/Nachher-Snapshot als "edit"-Chat-Nachricht (mit Undo) erzeugt.
	const MUTATING_TOOLS = new Set(["create_page", "append_to_page", "replace_page_content"]);
	// Wartende Promise-Resolver für offene Rückfragen (ask_choice) — Schlüssel ist die
	// Chat-Nachrichten-ID der Frage-Karte. Lebt nur solange die Seite offen bleibt.
	const pendingChoices = {};

	// Mehrere Quellen möglich (Einstellungen → KI): jede hat eigene Server-URL + eigenen
	// API-Key. Die aktuell im Modell-Dropdown gewählte Quelle bestimmt, welche hier verwendet wird.
	function activeProvider() {
		const providers = S.settings.aiProviders || [];
		return providers.find((p) => p.id === S.settings.aiProviderId) || providers[0] || null;
	}

	function cfg() {
		const pr = activeProvider();
		return {
			base: String((pr && pr.base) || "").replace(/\/+$/, ""),
			key: (pr && pr.key) || "",
			model: S.settings.aiModel || "",
		};
	}

	async function request(path, body) {
		const { base, key } = cfg();
		if (!base) throw new Error("Kein KI-Server konfiguriert (Einstellungen → KI).");
		const res = await fetch(base + path, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(key ? { Authorization: "Bearer " + key } : {}),
			},
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			throw new Error("KI-Fehler " + res.status + ": " + (await res.text()).slice(0, 300));
		}
		return res;
	}

	// Tool-Schemas für Google bereinigen: der OpenAI-Kompat-Layer von Google übersetzt sie ziemlich
	// direkt in Gemini's natives Function-Calling-Schema (OpenAPI-3.0-Subset). Felder wie
	// minItems/maxItems (z.B. bei ask_choice) sind dort NICHT zulässig und lösen bei Gemma
	// häufig einen generischen "500 INTERNAL" aus — deshalb vor dem Senden entfernen.
	function sanitizeToolSchema(schema) {
		if (!schema || typeof schema !== "object") return schema;
		if (Array.isArray(schema)) return schema.map(sanitizeToolSchema);
		const drop = new Set(["minItems", "maxItems", "additionalProperties", "default", "$schema"]);
		const out = {};
		for (const k of Object.keys(schema)) {
			if (drop.has(k)) continue;
			const v = schema[k];
			out[k] = (v && typeof v === "object") ? sanitizeToolSchema(v) : v;
		}
		return out;
	}
	function toolsForRequest(tools) {
		if (!tools || !tools.length) return tools;
		if ((activeProvider() || {}).id !== "google") return tools;
		return tools.map((td) => ({
			type: td.type,
			function: { name: td.function.name, description: td.function.description, parameters: sanitizeToolSchema(td.function.parameters) },
		}));
	}

	// Verbindungstest: fragt die Modell-Liste ab (für die Statusanzeige).
	async function ping() {
		const { base, key } = cfg();
		if (!base) return false;
		try {
			// Kein zusätzliches "/v1" anhängen: die Basis-URL enthält bei Google bereits den
			// vollständigen Pfad (z.B. .../v1beta/openai) — genau wie bei /chat/completions weiter oben.
			const res = await fetch(base + "/models", {
				headers: key ? { Authorization: "Bearer " + key } : {},
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	// Fragt ALLE konfigurierten Quellen (Einstellungen → KI) parallel nach ihren Modellen ab
	// und markiert jedes Ergebnis mit der zugehörigen Quelle — das Modell-Dropdown zeigt so
	// automatisch alle verfügbaren Modelle aus jedem hinterlegten Server/API-Key gruppiert an.
	async function listModels() {
		const providers = (S.settings.aiProviders || []).filter((p) => p.base);
		const lists = await Promise.all(providers.map(async (pr) => {
			try {
				// Auch hier: kein extra "/v1", die Basis-URL ist bereits vollständig (siehe ping() oben).
				const url = pr.base.replace(/\/+$/, "");
				const res = await fetch(url + "/models", {
					headers: pr.key ? { Authorization: "Bearer " + pr.key } : {},
				});
				if (!res.ok) return [];
				const data = await res.json();
				return (data.data || []).map((m) => m.id).filter(Boolean).map((id) => ({ id, providerId: pr.id }));
			} catch {
				return []; // Quelle gerade nicht erreichbar — einfach überspringen
			}
		}));
		return lists.flat();
	}

	// Embeddings (optional — Modell in den Einstellungen setzen, z.B. gemini-embedding-001 bei Gemini;
	// das ältere text-embedding-004 wurde von Google mittlerweile abgeschaltet/nicht mehr unterstützt)
	async function embed(texts) {
		if (!S.settings.embedModel) throw new Error("Kein Embedding-Modell konfiguriert.");
		const res = await request("/embeddings", { model: S.settings.embedModel, input: texts });
		const data = await res.json();
		return data.data.map((d) => d.embedding);
	}

	// Ein Chat-Aufruf. Mit onDelta/onReasoning wird gestreamt (SSE), sonst normale Antwort.
	// Reasoning-Modelle (z.B. DeepSeek-R1-artige Endpunkte) senden ihren Denkprozess
	// meist als `delta.reasoning_content` oder `delta.reasoning` — beides wird erfasst.
	async function chatOnce(messages, tools, onDelta, onReasoning) {
		const { model } = cfg();
		const body = { model, messages, temperature: 0.4 };
		// reasoning_effort ist keine allgemeine OpenAI-kompatible Erweiterung.
		// Darum nur für die OpenAI-Quelle senden; andere Server bleiben kompatibel.
		const thinking = S.settings.thinkingLevel || "auto";
		if (thinking !== "auto" && (activeProvider() || {}).id === "openai") body.reasoning_effort = thinking;
		if (tools && tools.length) { body.tools = toolsForRequest(tools); body.tool_choice = "auto"; }
		if (!onDelta) {
			const res = await request("/chat/completions", body);
			const m = (await res.json()).choices[0].message;
			// Strukturiertes Reasoning-Feld auch im Nicht-Streaming-Pfad erfassen —
			// vorher wurde das hier verschluckt (Bug).
			if (m.reasoning_content && !m.reasoning) m.reasoning = m.reasoning_content;
			// splitThink IMMER anwenden (vorher nur bei wörtlichem "<think>" — dadurch wurden
			// <thinking>/<reasoning>-Tags und ungetaggt ausgeschriebenes Denken hier NICHT gefiltert).
			if (m.content) {
				const split = splitThink(m.content);
				m.content = split.content;
				if (split.reasoning) m.reasoning = (m.reasoning ? m.reasoning + "\n" : "") + split.reasoning;
			}
			return m;
		}
		body.stream = true;
		const res = await request("/chat/completions", body);
		const reader = res.body.getReader();
		const dec = new TextDecoder();
		const msg = { role: "assistant", content: "", reasoning: "", tool_calls: [] };
		let rawContent = "";
		let buf = "";
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += dec.decode(value, { stream: true });
			const lines = buf.split("\n");
			buf = lines.pop();
			for (const line of lines) {
				const s = line.trim();
				if (!s.startsWith("data:")) continue;
				const payload = s.slice(5).trim();
				if (payload === "[DONE]") continue;
				let delta;
				try { delta = JSON.parse(payload).choices[0].delta || {}; } catch { continue; }
				const reasoningPiece = delta.reasoning_content || delta.reasoning || "";
				if (reasoningPiece) { msg.reasoning += reasoningPiece; if (onReasoning) onReasoning(msg.reasoning); }
				if (delta.content) {
					rawContent += delta.content;
					const split = splitThink(rawContent, !!msg.reasoning);
					msg.content = split.content;
					if (split.reasoning) { msg.reasoning = split.reasoning; if (onReasoning) onReasoning(msg.reasoning); }
					onDelta(msg.content);
				}
				for (const tc of delta.tool_calls || []) {
					const i = tc.index || 0;
					msg.tool_calls[i] = msg.tool_calls[i]
						|| { id: "", type: "function", function: { name: "", arguments: "" } };
					if (tc.id) msg.tool_calls[i].id = tc.id;
					if (tc.function && tc.function.name) msg.tool_calls[i].function.name += tc.function.name;
					if (tc.function && tc.function.arguments) msg.tool_calls[i].function.arguments += tc.function.arguments;
				}
			}
		}
		if (!msg.tool_calls.length) delete msg.tool_calls;
		if (!msg.reasoning) delete msg.reasoning;
		return msg;
	}

	// Einfacher Einmal-Aufruf ohne Tools (z.B. für den PDF-Ingest)
	async function complete(prompt, system) {
		const messages = [];
		if (system) messages.push({ role: "system", content: system });
		messages.push({ role: "user", content: prompt });
		const msg = await chatOnce(messages);
		return msg.content || "";
	}

	function systemPrompt(type) {
		const cur = S.currentPageId ? S.pages[S.currentPageId] : null;
		const lines = [
			"Du bist der KI-Coach von Impala67, einer lokalen Notiz- und Lern-App.",
			"Antworte auf Deutsch, kompakt, in kleinen Schritten. Nutze LaTeX für Formeln (z.B. $I = U / R$ inline oder $$...$$ für eigene Zeilen) — das wird live gerendert.",
			"Beim Schreiben in Seiten kannst du neben Markdown auch die Impala67-Erweiterungen nutzen: {red}Text{/} bzw. {bg-yellow}Text{/} für Text-/Hintergrundfarbe (gray/red/orange/yellow/green/blue/purple/pink), '> [!blue] Hinweis' für farbige Callouts, ==Text== zum Hervorheben und ':::columns ... :::split ... :::end' für Spalten.",
			"Du hast Tools, um Seiten zu lesen/anzulegen/zu ändern/zu verschieben/zu löschen und Karteikarten zu erstellen. Nutze sie aktiv:",
			"- Merkt sich die Person etwas schlecht oder beantwortet etwas falsch: lege mit create_flashcard eine karte an (kurze Frage, kurze Antwort).",
			"- Soll Wissen gespeichert werden: create_page oder append_to_page.",
			"- Seite verschieben: move_page. Seite löschen: delete_page (landet im Papierkorb; die App fragt im Chat zwingend nach Bestätigung).",
			"- Karte löschen: delete_flashcard. Stapel löschen: delete_deck (inkl. Unterstapel und aller enthaltenen Karten). Beide landen im Papierkorb; die App fragt im Chat zwingend nach Bestätigung.",
			"- Für inhaltliche Fragen zu den Unterlagen: semantic_search (semantisch) oder search_notes (Stichwort), dann read_page.",
			"- Ist eine Anfrage mehrdeutig und eine Entscheidung nötig, bevor du fortfährst (z.B. mehrere passende Seiten): nutze ask_choice mit 2-5 kurzen Optionen, statt zu raten.",
			"- Sage nach Tool-Nutzung kurz, was du angelegt/geändert/verschoben/gelöscht hast.",
			"- WICHTIG: Schreibe NIEMALS Selbstgespräche/Meta-Kommentare in die sichtbare Antwort, z.B. NICHT 'The user said...', 'I should respond...', 'Ich sollte...', 'Der Nutzer möchte...'. Deine Antwort beginnt IMMER direkt mit dem eigentlichen Inhalt für die Person, ohne jede Erklärung deines Vorgehens.",
			"- Falls du dennoch vor der eigentlichen Antwort ausführlich laut nachdenken musst, packe das AUSSCHLIESSLICH in <think>...</think> VOR der Antwort, niemals ungetaggt in den sichtbaren Text. Beispiel: '<think>Nutzer fragt X, ich prüfe zuerst Y.</think>Hier ist die Antwort: ...'",
		];

		if (cur) {
			lines.push('Aktuell geöffnete Seite: "' + cur.title + '"');
			if (type === "side") {
				lines.push("Du wirst im kontextuellen Seitenpanel ausgeführt. Beziehe dich bei Fragen direkt auf den Inhalt der aktuellen Seite, falls relevant.");
				lines.push("Inhalt der aktuell geöffneten Seite:\n" + (cur.content || "(Leere Seite)"));
			}
		} else {
			lines.push("Aktuell ist keine Seite geöffnet.");
		}

		lines.push("Vorhandene Seiten: " + (STATE.pageTitles().slice(0, 80).join(" | ") || "(noch keine)"));
		// Nur was die Nutzerin/der Nutzer selbst explizit in den Einstellungen einträgt landet hier —
		// keine automatisch abgeleiteten Annahmen über die Person.
		if (S.settings.customInstructions && S.settings.customInstructions.trim()) {
			lines.push("Zusätzliche Anweisungen (von der Nutzerin/dem Nutzer in den Einstellungen hinterlegt):\n" + S.settings.customInstructions.trim());
		}
		return lines.join("\n");
	}

	// Manche lokalen Reasoning-Modelle (z.B. DeepSeek-R1-Distillate über LM Studio) schreiben
	// ihren Denkprozess NICHT in ein separates reasoning-Feld, sondern direkt als <think>...</think>
	// innerhalb von content. Das trennen wir heraus, damit es nicht ungefiltert im Chat auftaucht.
	// Deckt die gängigsten Tag-Namen ab, die lokale Reasoning-Modelle verwenden
	// (DeepSeek-R1-artige Modelle nutzen meist <think>, manche <thinking> oder <reasoning>).
	const THINK_TAGS = "think|thinking|reasoning";

	// Fallback für Modelle, die GAR KEINE Tags nutzen (z.B. Gemma über die Google-API) und
	// ihren Denkprozess einfach als normalen Fließtext VOR die eigentliche Antwort schreiben
	// — manchmal sogar ohne Leerzeichen dazwischen ("...flashcards.Hallo!"). Da es dabei keine
	// technische Kennzeichnung gibt, wird satzweise heuristisch erkannt: typische "laut denken"-
	// Einleitungen (Deutsch + Englisch, da manche Modelle auf Englisch "denken") werden von
	// vorne weg als Denkprozess abgetrennt, bis ein Satz übrig bleibt, der NICHT mehr danach aussieht.
	const THINK_LEADIN_RE = /^(the user|i should|i need|i will|i'll|i must|i think|i can|i am|i'm going|i'm|let me|my instructions|as per|based on|since the|however,|plan:|\d+[.)]|note:|first,|okay,|ok,|alright,|ich sollte|ich muss|ich werde|ich denke|ich kann|ich bin|der nutzer|die nutzerin|laut (meiner|den) anweisungen|zun[äa]chst|lass mich|okay,? der|gut,? der)\b/i;
	function stripLeakedReasoning(text) {
		if (!text) return { content: text, reasoning: "" };
		// In Sätze zerlegen: normale Satzenden (". ", "! ", "? ", Zeilenumbruch) UND der Sonderfall
		// "Satzende direkt gefolgt von Großbuchstabe ohne Leerzeichen" (typisches Leck-Artefakt).
		const parts = text.split(/(?<=[.!?])\s+|\n+|(?<=[.!?])(?=[A-ZÄÖÜ])/).filter(Boolean);
		if (!parts.length) return { content: text, reasoning: "" };
		if (!THINK_LEADIN_RE.test(parts[0].trim())) return { content: text, reasoning: "" };
		if (parts.length < 2) {
			// Noch nur der (unvollständige) erste Satz da, sieht aber schon nach Denkprozess
			// aus — komplett als Denkprozess werten (verhindert das kurze Aufblitzen von
			// Meta-Text als "Antwort" ganz am Anfang des Streamings).
			return { content: "", reasoning: text };
		}
		// FIX: nicht mehr beim ERSTEN nicht-passenden Satz abbrechen — das ließ z.B. einen
		// Satz wie "I am the AI Coach von Impala67." (matcht kein Einleitungs-Muster) als
		// sichtbaren Text durchrutschen, während der ganze Rest des Denkprozesses danach
		// ungefiltert im Chat landete. Bis zum LETZTEN noch meta aussehenden Satz weiterscannen.
		let lastMatch = 0;
		for (let i = 1; i < parts.length; i++) {
			if (THINK_LEADIN_RE.test(parts[i].trim())) lastMatch = i;
		}
		if (lastMatch >= parts.length - 1) return { content: "", reasoning: text };
		return { content: parts.slice(lastMatch + 1).join(" ").trim(), reasoning: parts.slice(0, lastMatch + 1).join(" ").trim() };
	}

	function splitThink(raw, skipHeuristic) {
		let reasoning = "";
		let content = "";
		const re = new RegExp("<(" + THINK_TAGS + ")>([\\s\\S]*?)<\\/\\1>", "g");
		let last = 0, m;
		while ((m = re.exec(raw))) { reasoning += m[2]; content += raw.slice(last, m.index); last = re.lastIndex; }
		content += raw.slice(last);
		// Noch offener Denkprozess-Block (Streaming noch nicht fertig) — Rest komplett als Denkprozess werten
		const openMatch = content.match(new RegExp("<(" + THINK_TAGS + ")>"));
		if (openMatch) { reasoning += content.slice(openMatch.index + openMatch[0].length); content = content.slice(0, openMatch.index); }
		// Kein Tag gefunden/verwendet — heuristisch nach ungetaggtem, ausgeschriebenem Denkprozess suchen.
		if (!reasoning && !skipHeuristic) {
			const leaked = stripLeakedReasoning(content);
			content = leaked.content;
			reasoning = leaked.reasoning;
		}
		return { content: content.trim(), reasoning: reasoning.trim() };
	}

	// Chat speichern ohne APP (app.js exportiert saveCurrentChat nicht — und Import
	// von chat-fullscreen.js hier wäre zyklisch: chat-fullscreen → ai → …).
	function persistChat(type) {
		const messages = type === "side" ? S.sideChat : S.chat;
		const idKey = type === "side" ? "sideChatId" : "currentChatId";
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

	// Agent-Loop mit Streaming: Text und Denkprozess erscheinen live, Tools laufen
	// dazwischen. Seiten-ändernde Tools erzeugen Edit-Karten — die werden am ENDE
	// dieses Turns (nach der finalen KI-Nachricht) angehängt, nicht mitten im Chat
	// und nicht ans absolute Chat-Ende aller Turns.
	async function agent(userText, type, onStep) {
		type = type || "side";
		const targetChat = type === "side" ? S.sideChat : S.chat;
		// Edit-Karten dieses Agent-Laufs — flush nach finaler Assistant-Nachricht
		const pendingEdits = [];
		function flushPendingEdits() {
			if (!pendingEdits.length) return;
			for (const ed of pendingEdits) targetChat.push(ed);
			pendingEdits.length = 0;
			if (type === "side") RENDER.renderChat(); else RENDER.renderMainChatLog();
		}

		// Ein Anhang gehört ausschließlich zu dem Chat, in dem er ausgewählt wurde.
		const useAttachment = S.pendingAttachmentTarget === type;
		const image = useAttachment ? S.pendingImage : null;
		const textFile = useAttachment ? S.pendingTextFile : null;
		const pdfFile = useAttachment ? S.pendingPdf : null;
		if (useAttachment) {
			S.pendingImage = null;
			S.pendingTextFile = null;
			S.pendingPdf = null;
			S.pendingAttachmentTarget = null;
		}
		targetChat.push({ mid: U.uid(), role: "user", content: userText, image, textFile, pdfFile });
		// Multimodal: angehängte Bilder werden als image_url mitgeschickt (Gemini/Gemma Vision).
		// Angehängte Textdateien werden dem Modell als Kontext mitgegeben, im Chat aber nur als Datei-Chip gezeigt.
		const history = targetChat.slice(-16)
			.filter((m) => m.role === "user" || m.role === "assistant")
			.map((m) => {
				let content = m.content || "";
				if (m.textFile) content = (content ? content + "\n\n" : "") + "[Angehängte Datei: " + m.textFile.name + "]\n" + m.textFile.content;
				if (m.pdfFile) content = (content ? content + "\n\n" : "") + "[Angehängtes PDF: " + m.pdfFile.name + "]\n" + m.pdfFile.content;
				if (m.image) return { role: m.role, content: [{ type: "text", text: content }, { type: "image_url", image_url: { url: m.image } }] };
				return { role: m.role, content };
			});
		const messages = [{ role: "system", content: systemPrompt(type) }, ...history];

		// Streaming-Renders bündeln (max. 1 pro Frame) statt bei JEDEM einzelnen Token das
		// komplette Chat-Log samt LaTeX/Code neu aufzubauen — das ließ besonders den Beginn
		// einer Antwort (viele winzige Denkprozess-Häppchen, meist VOR der sichtbaren Antwort)
		// spürbar ruckeln/laggen.
		let renderQueued = false;
		function scheduleRender() {
			if (renderQueued) return;
			renderQueued = true;
			requestAnimationFrame(() => {
				renderQueued = false;
				if (type === "side") RENDER.renderChat(); else RENDER.renderMainChatLog();
			});
		}

		for (let step = 0; step < 8; step++) {
			S.aiDraft = "";
			S.aiThinkingDraft = "";
			const msg = await chatOnce(
				messages, TOOLS.defs,
				(text) => { S.aiDraft = text; scheduleRender(); },
				(text) => { S.aiThinkingDraft = text; scheduleRender(); }
			);
			messages.push(msg);
			if (msg.tool_calls && msg.tool_calls.length) {
				for (const tc of msg.tool_calls) {
					let args = {};
					try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* ungültiges JSON — leere Argumente */ }

					// delete_page: IMMER Chat-Bestätigung erzwingen (wie ask_choice), bevor gelöscht wird.
					// Soft-Delete → Papierkorb inkl. Unterseiten. Abbruch = kein dispatch.
					if (tc.function.name === "delete_page") {
						const titleArg = String((args && args.page_title) || "").trim();
						const pg = titleArg ? STATE.findPage(titleArg) : null;
						if (!pg) {
							const err = { error: titleArg ? ("Seite nicht gefunden: " + titleArg) : "delete_page: page_title fehlt." };
							if (onStep) onStep("delete_page");
							targetChat.push({
								mid: U.uid(), role: "tool", name: "delete_page",
								detail: String(err.error).slice(0, 80), error: true,
							});
							scheduleRender();
							messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(err) });
							continue;
						}
						// Unterseiten zählen (nur aktive), für den Bestätigungstext
						const countKids = (id) => {
							let n = 0;
							for (const p of Object.values(S.pages)) {
								if (!p.trashed && p.parentId === id) n += 1 + countKids(p.id);
							}
							return n;
						};
						const subN = countKids(pg.id);
						const qText = subN
							? ('Seite „' + pg.title + '“ inkl. ' + subN + ' Unterseite(n) in den Papierkorb?')
							: ('Seite „' + pg.title + '“ in den Papierkorb?');
						const qMid = U.uid();
						if (type === "side") {
							document.body.classList.remove("panel-collapsed");
							if (typeof RENDER.renderTabs === "function") RENDER.renderTabs();
						}
						S.aiStatus = "Warte auf Bestätigung…";
						S.aiDraft = "";
						S.aiThinkingDraft = "";
						const answer = await new Promise((resolve) => {
							pendingChoices[qMid] = resolve;
							targetChat.push({
								mid: qMid,
								role: "question",
								question: qText,
								options: ["Ja, löschen", "Abbrechen"],
								answered: false,
							});
							if (type === "side") RENDER.renderChat(); else RENDER.renderMainChatLog();
						});
						const qMsg = targetChat.find((x) => x.mid === qMid);
						if (qMsg) {
							qMsg.answered = true;
							qMsg.answer = answer;
						}
						S.aiStatus = "…denkt nach…";
						const confirmed = String(answer || "").toLowerCase().startsWith("ja");
						let out;
						if (!confirmed) {
							out = { cancelled: true, title: pg.title, note: "Löschen abgebrochen — nichts geändert." };
						} else {
							try {
								out = await TOOLS.run("delete_page", { page_title: pg.title });
							} catch (e) {
								out = { error: String(e) };
							}
						}
						if (onStep) onStep("delete_page");
						// Tool-Chip nur bei Erfolg/Fehler — Abbruch bleibt an der beantworteten Frage-Karte
						if (!out.cancelled) {
							targetChat.push({
								mid: U.uid(), role: "tool", name: "delete_page",
								detail: String(pg.title).slice(0, 80),
								error: !!(out && out.error),
							});
						}
						if (type === "side") RENDER.renderChat(); else RENDER.renderMainChatLog();
						messages.push({
							role: "tool",
							tool_call_id: tc.id,
							content: JSON.stringify(out),
						});
						try { persistChat(type); } catch (e) { console.warn("Chat speichern nach delete_page:", e); }
						continue;
					}

					// delete_flashcard: IMMER Chat-Bestätigung erzwingen (wie delete_page/ask_choice).
					if (tc.function.name === "delete_flashcard") {
						const frontArg = String((args && args.front) || "").trim();
						const card = frontArg ? TOOLS.findCard(frontArg, args.deck) : null;
						if (!card) {
							const err = { error: frontArg ? ("Karte nicht gefunden: " + frontArg) : "delete_flashcard: front fehlt." };
							if (onStep) onStep("delete_flashcard");
							targetChat.push({
								mid: U.uid(), role: "tool", name: "delete_flashcard",
								detail: String(err.error).slice(0, 80), error: true,
							});
							scheduleRender();
							messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(err) });
							continue;
						}
						const shortFront = String(card.front || "").replace(/\s+/g, " ").trim();
						const qText = 'Karte „' + (shortFront.length > 60 ? shortFront.slice(0, 60) + "…" : shortFront) + '“ in den Papierkorb?';
						const qMid = U.uid();
						if (type === "side") {
							document.body.classList.remove("panel-collapsed");
							if (typeof RENDER.renderTabs === "function") RENDER.renderTabs();
						}
						S.aiStatus = "Warte auf Bestätigung…";
						S.aiDraft = "";
						S.aiThinkingDraft = "";
						const answer = await new Promise((resolve) => {
							pendingChoices[qMid] = resolve;
							targetChat.push({ mid: qMid, role: "question", question: qText, options: ["Ja, löschen", "Abbrechen"], answered: false });
							if (type === "side") RENDER.renderChat(); else RENDER.renderMainChatLog();
						});
						const qMsg = targetChat.find((x) => x.mid === qMid);
						if (qMsg) { qMsg.answered = true; qMsg.answer = answer; }
						S.aiStatus = "…denkt nach…";
						const confirmed = String(answer || "").toLowerCase().startsWith("ja");
						let out;
						if (!confirmed) {
							out = { cancelled: true, front: card.front, note: "Löschen abgebrochen — nichts geändert." };
						} else {
							try { out = await TOOLS.run("delete_flashcard", { front: card.front, deck: card.deck }); }
							catch (e) { out = { error: String(e) }; }
						}
						if (onStep) onStep("delete_flashcard");
						if (!out.cancelled) {
							targetChat.push({ mid: U.uid(), role: "tool", name: "delete_flashcard", detail: shortFront.slice(0, 80), error: !!(out && out.error) });
						}
						if (type === "side") RENDER.renderChat(); else RENDER.renderMainChatLog();
						messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
						try { persistChat(type); } catch (e) { console.warn("Chat speichern nach delete_flashcard:", e); }
						continue;
					}

					// delete_deck: IMMER Chat-Bestätigung erzwingen — inkl. Unterstapel + Kartenzahl im Text.
					if (tc.function.name === "delete_deck") {
						const nameArg = String((args && args.deck) || "").trim();
						const match = nameArg ? TOOLS.resolveDeckName(nameArg) : null;
						if (!match) {
							const err = { error: nameArg ? ("Stapel nicht gefunden: " + nameArg) : "delete_deck: deck fehlt." };
							if (onStep) onStep("delete_deck");
							targetChat.push({ mid: U.uid(), role: "tool", name: "delete_deck", detail: String(err.error).slice(0, 80), error: true });
							scheduleRender();
							messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(err) });
							continue;
						}
						const cardN = Object.values(S.cards).filter((c) => !c.trashed && ((c.deck || "Standard") === match || (c.deck || "Standard").startsWith(match + "::"))).length;
						const qText = cardN
							? ('Stapel „' + match + '“ inkl. ' + cardN + ' Karte(n) in den Papierkorb?')
							: ('Stapel „' + match + '“ in den Papierkorb?');
						const qMid = U.uid();
						if (type === "side") {
							document.body.classList.remove("panel-collapsed");
							if (typeof RENDER.renderTabs === "function") RENDER.renderTabs();
						}
						S.aiStatus = "Warte auf Bestätigung…";
						S.aiDraft = "";
						S.aiThinkingDraft = "";
						const answer = await new Promise((resolve) => {
							pendingChoices[qMid] = resolve;
							targetChat.push({ mid: qMid, role: "question", question: qText, options: ["Ja, löschen", "Abbrechen"], answered: false });
							if (type === "side") RENDER.renderChat(); else RENDER.renderMainChatLog();
						});
						const qMsg = targetChat.find((x) => x.mid === qMid);
						if (qMsg) { qMsg.answered = true; qMsg.answer = answer; }
						S.aiStatus = "…denkt nach…";
						const confirmed = String(answer || "").toLowerCase().startsWith("ja");
						let out;
						if (!confirmed) {
							out = { cancelled: true, deck: match, note: "Löschen abgebrochen — nichts geändert." };
						} else {
							try { out = await TOOLS.run("delete_deck", { deck: match }); }
							catch (e) { out = { error: String(e) }; }
						}
						if (onStep) onStep("delete_deck");
						if (!out.cancelled) {
							targetChat.push({ mid: U.uid(), role: "tool", name: "delete_deck", detail: String(match).slice(0, 80), error: !!(out && out.error) });
						}
						if (type === "side") RENDER.renderChat(); else RENDER.renderMainChatLog();
						messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
						try { persistChat(type); } catch (e) { console.warn("Chat speichern nach delete_deck:", e); }
						continue;
					}

					// Rückfrage (Notion-Style): pausiert bis Klick, nur die Frage-Karte in der UI
					// (kein extra Tool-Chip „Rückfrage gestellt“ — das wirkt wie Notion-Umfrage).
					if (tc.function.name === "ask_choice") {
						const norm = TOOLS.normalizeAskChoice(args);
						if (norm.error) {
							if (onStep) onStep("ask_choice");
							targetChat.push({
								mid: U.uid(), role: "tool", name: "ask_choice",
								detail: String(norm.error).slice(0, 80), error: true,
							});
							scheduleRender();
							messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(norm) });
							continue;
						}
						const qMid = U.uid();
						// Side-Chat: Panel sichtbar machen, sonst sieht man die Frage-Karte nicht.
						if (type === "side") {
							document.body.classList.remove("panel-collapsed");
							if (typeof RENDER.renderTabs === "function") RENDER.renderTabs();
						}
						S.aiStatus = "Warte auf deine Auswahl…";
						S.aiDraft = "";
						S.aiThinkingDraft = "";
						const answer = await new Promise((resolve) => {
							pendingChoices[qMid] = resolve;
							targetChat.push({
								mid: qMid,
								role: "question",
								question: norm.question,
								options: norm.options,
								answered: false,
							});
							if (type === "side") RENDER.renderChat(); else RENDER.renderMainChatLog();
						});
						const qMsg = targetChat.find((x) => x.mid === qMid);
						if (qMsg) {
							qMsg.answered = true;
							qMsg.answer = answer;
						}
						// Kein tool-Chip bei Erfolg — die beantwortete Karte reicht (Notion-Style).
						S.aiStatus = "…denkt nach…";
						if (onStep) onStep("ask_choice");
						if (type === "side") RENDER.renderChat(); else RENDER.renderMainChatLog();
						messages.push({
							role: "tool",
							tool_call_id: tc.id,
							content: JSON.stringify({ answer, question: norm.question }),
						});
						// Zwischenstand speichern (beide Chat-Typen) — ohne APP.*
						try { persistChat(type); } catch (e) { console.warn("Chat speichern nach ask_choice:", e); }
						continue;
					}

					const mutating = MUTATING_TOOLS.has(tc.function.name);
					let beforePageId = null;
					let before = { title: "", content: "" };
					if (mutating && tc.function.name !== "create_page") {
						const pg = STATE.findPage(args.page_title);
						if (pg) { beforePageId = pg.id; before = { title: pg.title, content: pg.content }; }
					}
					let out;
					try {
						out = await TOOLS.run(tc.function.name, args);
					} catch (e) {
						out = { error: String(e) };
					}
					if (onStep) onStep(tc.function.name);
					// Tool-Anzeige im Chat (wie in Notion): welche Aktion lief — bei der
					// semantischen Suche inklusive des verwendeten Embedding-Modells.
					let detail = args.page_title || args.title || args.query || "";
					if (tc.function.name === "semantic_search") detail = (detail ? detail + " · " : "") + "Embedding: " + (S.settings.embedModel || "—");
					targetChat.push({ mid: U.uid(), role: "tool", name: tc.function.name, detail: String(detail).slice(0, 80), error: !!(out && out.error) });
					scheduleRender();
					if (mutating && out && !out.error) {
						let pageId = beforePageId;
						let created = false;
						if (tc.function.name === "create_page") {
							const pg = STATE.findPage(args.title);
							if (pg) { pageId = pg.id; created = true; }
						}
						if (pageId && S.pages[pageId]) {
							const after = { title: S.pages[pageId].title, content: S.pages[pageId].content };
							// Noch nicht pushen — erst nach der finalen KI-Antwort dieses Turns
							// (Änderungsanzeige am Ende der Nachricht, nicht mitten im Turn / Chat-Ende).
							pendingEdits.push({
								mid: U.uid(), role: "edit", pageId, pageTitle: after.title,
								before, after, created, undone: false,
							});
						}
					}
					messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
				}
				continue;
			}
			const finalMsg = {
				mid: U.uid(), role: "assistant", content: msg.content || "",
				reasoning: msg.reasoning || null, reasoningExpanded: false,
			};
			S.aiDraft = "";
			S.aiThinkingDraft = "";
			targetChat.push(finalMsg);
			flushPendingEdits();
			return finalMsg.content;
		}
		S.aiDraft = "";
		S.aiThinkingDraft = "";
		const abort = "(Abgebrochen: zu viele Tool-Schritte.)";
		targetChat.push({ mid: U.uid(), role: "assistant", content: abort });
		flushPendingEdits();
		return abort;
	}

	// Wird vom Klick-Handler einer Rückfrage-Karte aufgerufen, um den wartenden agent()-Aufruf fortzusetzen.
	// Gibt true zurück, wenn eine offene Rückfrage aufgelöst wurde (Doppelklicks sonst harmlos).
	function resolveChoice(mid, answer) {
		if (!pendingChoices[mid]) return false;
		const resolve = pendingChoices[mid];
		delete pendingChoices[mid];
		resolve(answer);
		return true;
	}

	function hasPendingChoice() {
		return Object.keys(pendingChoices).length > 0;
	}

	// Formuliert eine bestehende Antwort länger/kürzer um (wie Notions "Antwort anpassen").
	// historyMessages ist der Gesprächsverlauf bis inkl. der anzupassenden Antwort.
	async function refine(historyMessages, instruction, onDelta) {
		const messages = [{ role: "system", content: systemPrompt() }, ...historyMessages, { role: "user", content: instruction }];
		const msg = await chatOnce(messages, null, onDelta);
		return msg.content || "";
	}

	return { chatOnce, complete, agent, resolveChoice, hasPendingChoice, refine, ping, embed, listModels, MODEL_PRESETS };
})();