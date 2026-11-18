// MCP-Modus des KI-Benchmarks: Das lokale Modell arbeitet wie ein externer Assistent
// (Antigravity, Claude Code) mit den Impala-MCP-Werkzeugen – eigene Agent-Schleife gegen
// LM Studio (OpenAI-kompatibel), Werkzeuge über die Relay-Verbindung zur offenen App.
// Werkzeuge = dieselben wie mcp/server.mjs (mcp/content-tools.mjs). Lesende laufen echt;
// schreibende laufen als Trockenlauf (dry_run: echte Prüfung, nichts gespeichert).
// impala_eval wird nie angeboten.
import { CONTENT_TOOLS, CONTENT_WRITE } from "../../mcp/content-tools.mjs";

const MAX_STEPS = 12;
const RESULT_LIMIT = 12000;

// Heftbild wie in mcp/server.mjs (dort nicht exportierbar, weil der Server beim Import startet).
const HEFT_IMAGE = { name: "impala_heft_page_image", description: "Zeigt eine Handschrift-Heftseite als Bild (1000×1414, Raster alle 100 Einheiten) plus 'appReading' = was das lokale Handschrift-Modell darauf liest. pageCount nennt die Anzahl der Heftseiten.",
	inputSchema: { type: "object", properties: { page_id: { type: "string", description: "ID oder Titel des Hefts" }, page_index: { type: "number", description: "Heftseite, 0-basiert (Standard 0)" } }, required: ["page_id"] } };
const OFFERED = [...CONTENT_TOOLS, HEFT_IMAGE];
const NAMES = new Set(OFFERED.map((t) => t.name));
const DEFS = OFFERED.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
function systemPrompt(workspacePage) {
	const d = new Date();
	return [
		"Du bist ein Lern- und Notiz-Assistent. Über Werkzeuge hast du Zugriff auf die Notiz-App Impala67 des Nutzers (Notizseiten, handschriftliche Hefte, Karteikarten).",
		"Lies nach, statt zu raten: Suche passende Seiten, lies sie, und schau dir bei Fragen zu Heften die Heftseiten als Bild an. Antworte auf Deutsch, kurz und verständlich.",
		`Heute ist ${WEEKDAYS[d.getDay()]}, der ${d.toLocaleDateString("de-DE")}.`,
		workspacePage ? `Der Nutzer hat gerade die Seite „${workspacePage}“ geöffnet.` : "",
	].filter(Boolean).join("\n");
}

function clip(s, n) { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + `… [gekürzt, ${s.length - n} Zeichen ausgelassen]` : s; }

// Ein gestreamter Chat-Aufruf; liefert Nachricht + Messwerte wie der Harness.
async function chat(lms, body, rec, limitMs) {
	const r = { path: "/v1/chat/completions", model: body.model, messages: body.messages.length, tools: body.tools.length, stream: true,
		promptChars: JSON.stringify(body.messages).length, images: 0, t0: Date.now() - rec.t0, tHead: 0, tFirst: 0, tEnd: 0, status: 0,
		chunks: { content: 0, reasoning: 0, tool: 0 }, usage: null, error: null };
	rec.requests.push(r);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), limitMs);
	const msg = { content: "", reasoning: "", calls: [] };
	try {
		const res = await fetch(`${lms}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }), signal: controller.signal });
		r.tHead = Date.now() - rec.t0; r.status = res.status;
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
		const dec = new TextDecoder();
		let buf = "";
		for await (const part of res.body) {
			buf += dec.decode(part, { stream: true });
			const lines = buf.split("\n");
			buf = lines.pop();
			for (const line of lines) {
				const m = /^data:\s*(.*)$/.exec(line.trim());
				if (!m || m[1] === "[DONE]") continue;
				let j; try { j = JSON.parse(m[1]); } catch { continue; }
				if (j.usage) r.usage = j.usage;
				const d = j.choices?.[0]?.delta;
				if (!d) continue;
				const first = () => { if (!r.tFirst) r.tFirst = Date.now() - rec.t0; };
				if (d.content) { msg.content += d.content; r.chunks.content++; first(); }
				const rs = d.reasoning_content || d.reasoning;
				if (rs) { msg.reasoning += rs; r.chunks.reasoning++; first(); }
				for (const tc of d.tool_calls || []) {
					r.chunks.tool++; first();
					const c = (msg.calls[tc.index ?? msg.calls.length] ||= { id: tc.id || `call_${msg.calls.length}`, name: "", args: "" });
					if (tc.id) c.id = tc.id;
					if (tc.function?.name) c.name += tc.function.name;
					if (tc.function?.arguments) c.args += tc.function.arguments;
				}
			}
		}
	} catch (e) { r.error = String(e?.message || e); throw e; }
	finally { clearTimeout(timer); r.tEnd = Date.now() - rec.t0; }
	msg.calls = msg.calls.filter(Boolean);
	return msg;
}

export async function runMcpTurn({ app, lms, model, conv, spec, limitMs = 900000 }) {
	const rec = { t0: Date.now(), state: "done", requests: [], tools: [], changes: [], asks: [], items: [], text: "", error: null, rag: null, summary: null };
	conv.messages ||= [{ role: "system", content: systemPrompt(spec.workspacePage) }];
	const attach = spec.pdfFile ? `\n\n[Angehängtes PDF: ${spec.pdfFile.name}]\n${spec.pdfFile.content}` : "";
	conv.messages.push({ role: "user", content: spec.text + attach });
	try {
		for (let step = 0; step < MAX_STEPS; step++) {
			// Nur das letzte Bild mitschicken (wie die App), ältere durch Hinweis ersetzen.
			const lastImg = conv.messages.findLastIndex((m) => Array.isArray(m.content));
			conv.messages.forEach((m, i) => { if (Array.isArray(m.content) && i !== lastImg) m.content = "[Heftseite als Bild – aus Platzgründen entfernt]"; });
			const msg = await chat(lms, { model, messages: conv.messages, tools: DEFS }, rec, limitMs);
			rec.requests.at(-1).images = conv.messages.filter((m) => Array.isArray(m.content)).length;
			if (msg.reasoning.trim()) rec.items.push({ kind: "thought", text: clip(msg.reasoning, 4000) });
			const assistant = { role: "assistant", content: msg.content || "" };
			if (msg.calls.length) assistant.tool_calls = msg.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } }));
			conv.messages.push(assistant);
			if (!msg.calls.length) { rec.text = msg.content.trim() || "(Keine Antwort vom Modell erhalten.)"; rec.items.push({ kind: "assistant", text: clip(rec.text, 4000) }); return rec; }
			if (msg.content.trim()) rec.items.push({ kind: "assistant", text: clip(msg.content, 4000) });
			const images = [];
			for (const c of msg.calls) {
				const t = Date.now();
				let args = {}, out;
				try { args = c.args ? JSON.parse(c.args) : {}; } catch { out = { error: `Die Argumente von ${c.name} sind kein gültiges JSON.` }; }
				if (!out) {
					if (NAMES.has(c.name)) {
						const write = CONTENT_WRITE.has(c.name);
						out = await app.call(c.name, write ? { ...args, dry_run: true } : args, 60000);
						if (out == null) out = { error: "Keine App verbunden." };
						if (write && out?.ok) {
							rec.changes.push(...(out.ops || []));
							const { ops, dryRun, ...shown } = out;
							out = shown;
						}
					} else out = { error: `Unbekanntes Werkzeug „${c.name}“.` };
				}
				const { image, ...rest } = out || {};
				if (typeof image === "string" && image.startsWith("data:image")) images.push(image);
				const json = JSON.stringify(rest);
				rec.tools.push({ name: c.name, args: clip(JSON.stringify(args), 800), ms: Date.now() - t, error: !!out?.error, resultChars: json.length, detail: out?.error ? clip(out.error, 300) : undefined });
				conv.messages.push({ role: "tool", tool_call_id: c.id, content: clip(json, RESULT_LIMIT) });
			}
			for (const url of images) conv.messages.push({ role: "user", content: [{ type: "text", text: "Hier die angeforderte Heftseite als Bild:" }, { type: "image_url", image_url: { url } }] });
		}
		rec.text = "(Abgebrochen: zu viele Tool-Schritte.)";
	} catch (e) {
		rec.state = "error"; rec.error = String(e?.message || e);
	} finally {
		rec.wallMs = Date.now() - rec.t0;
	}
	return rec;
}
