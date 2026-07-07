"use strict";
// ai.js — KI-Adapter (OpenAI-kompatibel: LM Studio, OpenAI, Google Gemini).
// Mit Streaming (SSE), Modellauswahl, Reasoning/Thinking-Erfassung, Verbindungs-
// Ping, Embeddings und automatischer Diff-Erfassung für Seiten-Bearbeitungen.
const AI = (() => {
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
		if (tools && tools.length) { body.tools = tools; body.tool_choice = "auto"; }
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
			"Du bist der KI-Agent von Notion, einer lokalen Notiz- und Lern-App.",
			"Antworte auf Deutsch, kompakt, in kleinen Schritten. Nutze LaTeX für Formeln (z.B. $I = U / R$ inline oder $$...$$ für eigene Zeilen) — das wird live gerendert.",
			"Beim Schreiben in Seiten kannst du neben Markdown auch Auras Erweiterungen nutzen: {red}Text{/} bzw. {bg-yellow}Text{/} für Text-/Hintergrundfarbe (gray/red/orange/yellow/green/blue/purple/pink), '> [!blue] Hinweis' für farbige Callouts, ==Text== zum Hervorheben und ':::columns ... :::split ... :::end' für Spalten.",
			"Du hast Tools, um Seiten zu lesen/anzulegen/zu ändern und Karteikarten zu erstellen. Nutze sie aktiv:",
			"- Merkt sich die Person etwas schlecht oder beantwortet etwas falsch: lege mit create_flashcard eine karte an (kurze Frage, kurze Antwort).",
			"- Soll Wissen gespeichert werden: create_page oder append_to_page.",
			"- Für inhaltliche Fragen zu den Unterlagen: semantic_search (semantisch) oder search_notes (Stichwort), dann read_page.",
			"- Ist eine Anfrage mehrdeutig und eine Entscheidung nötig, bevor du fortfährst (z.B. mehrere passende Seiten): nutze ask_choice mit 2-5 kurzen Optionen, statt zu raten.",
			"- Sage nach Tool-Nutzung kurz, was du angelegt/geändert hast.",
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
	const THINK_LEADIN_RE = /^(the user|i should|i need|i will|i'll|i must|i think|i can|i'm going|let me|my instructions|as per|based on|since the|note:|first,|okay,|ok,|alright,|ich sollte|ich muss|ich werde|ich denke|ich kann|der nutzer|die nutzerin|laut (meiner|den) anweisungen|zun[äa]chst|lass mich|okay,? der|gut,? der)\b/i;
	function stripLeakedReasoning(text) {
		if (!text) return { content: text, reasoning: "" };
		// In Sätze zerlegen: normale Satzenden (". ", "! ", "? ", Zeilenumbruch) UND der Sonderfall
		// "Satzende direkt gefolgt von Großbuchstabe ohne Leerzeichen" (typisches Leck-Artefakt).
		const parts = text.split(/(?<=[.!?])\s+|\n+|(?<=[.!?])(?=[A-ZÄÖÜ])/).filter(Boolean);
		if (parts.length < 2) return { content: text, reasoning: "" };
		let i = 0;
		while (i < parts.length - 1 && THINK_LEADIN_RE.test(parts[i].trim())) i++;
		if (i === 0) return { content: text, reasoning: "" };
		return { content: parts.slice(i).join(" ").trim(), reasoning: parts.slice(0, i).join(" ").trim() };
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

	// Agent-Loop mit Streaming: Text und Denkprozess erscheinen live, Tools laufen
	// dazwischen. Seiten-ändernde Tools erzeugen automatisch eine Edit-Karte mit Undo.
	async function agent(userText, type, onStep) {
		type = type || "side";
		const targetChat = type === "side" ? S.sideChat : S.chat;

		const image = S.pendingImage;
		const textFile = S.pendingTextFile;
		S.pendingImage = null;
		S.pendingTextFile = null;
		targetChat.push({ mid: U.uid(), role: "user", content: userText, image, textFile });
		// Multimodal: angehängte Bilder werden als image_url mitgeschickt (Gemini/Gemma Vision).
		// Angehängte Textdateien werden dem Modell als Kontext mitgegeben, im Chat aber nur als Datei-Chip gezeigt.
		const history = targetChat.slice(-16)
			.filter((m) => m.role === "user" || m.role === "assistant")
			.map((m) => {
				let content = m.content || "";
				if (m.textFile) content = (content ? content + "\n\n" : "") + "[Angehängte Datei: " + m.textFile.name + "]\n" + m.textFile.content;
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
				if (type === "side") renderChat(); else renderMainChatLog();
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

					// Rückfrage mit anklickbaren Optionen: pausiert hier, bis der Klick-Handler die
					// Promise auflöst (siehe resolveChoice). Kein Server-Roundtrip nötig, rein lokal.
					if (tc.function.name === "ask_choice") {
						const qMid = U.uid();
						const options = Array.isArray(args.options) ? args.options.slice(0, 5) : [];
						const answer = await new Promise((resolve) => {
							pendingChoices[qMid] = resolve;
							targetChat.push({ mid: qMid, role: "question", question: args.question || "", options, answered: false });
							if (type === "side") renderChat(); else renderMainChatLog();
						});
						const qMsg = targetChat.find((x) => x.mid === qMid);
						if (qMsg) { qMsg.answered = true; qMsg.answer = answer; }
						if (onStep) onStep("ask_choice");
						messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ answer }) });
						if (type === "full") saveCurrentChat();
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
					if (mutating && out && !out.error) {
						let pageId = beforePageId;
						let created = false;
						if (tc.function.name === "create_page") {
							const pg = STATE.findPage(args.title);
							if (pg) { pageId = pg.id; created = true; }
						}
						if (pageId && S.pages[pageId]) {
							const after = { title: S.pages[pageId].title, content: S.pages[pageId].content };
							targetChat.push({
								mid: U.uid(), role: "edit", pageId, pageTitle: after.title,
								before, after, created, undone: false, diffExpanded: false,
							});
							if (type === "side") renderChat(); else renderMainChatLog();
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
			return finalMsg.content;
		}
		S.aiDraft = "";
		S.aiThinkingDraft = "";
		const abort = "(Abgebrochen: zu viele Tool-Schritte.)";
		targetChat.push({ mid: U.uid(), role: "assistant", content: abort });
		return abort;
	}

	// Wird vom Klick-Handler einer Rückfrage-Karte aufgerufen, um den wartenden agent()-Aufruf fortzusetzen.
	function resolveChoice(mid, answer) {
		if (pendingChoices[mid]) {
			pendingChoices[mid](answer);
			delete pendingChoices[mid];
		}
	}

	// Formuliert eine bestehende Antwort länger/kürzer um (wie Notions "Antwort anpassen").
	// historyMessages ist der Gesprächsverlauf bis inkl. der anzupassenden Antwort.
	async function refine(historyMessages, instruction, onDelta) {
		const messages = [{ role: "system", content: systemPrompt() }, ...historyMessages, { role: "user", content: instruction }];
		const msg = await chatOnce(messages, null, onDelta);
		return msg.content || "";
	}

	return { chatOnce, complete, agent, resolveChoice, refine, ping, embed, listModels, MODEL_PRESETS };
})();