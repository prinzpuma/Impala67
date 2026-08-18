import { JSDOM } from "jsdom";
const { PNG } = await import("pngjs");

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const { S, STATE } = await import("../web/state.js");
const { AI } = await import("../web/ai.js");
const { TOOLS } = await import("../web/tools.js");
const { CHATS } = await import("../web/chats.js");
CHATS.persist = () => {};
STATE.onChange = () => {};
STATE.dispatch = async (type, payload) => STATE.reduce({ id: crypto.randomUUID(), t: new Date().toISOString(), type, payload });

S.settings.aiProviders = [{ id: "local", name: "LM Studio", base: "http://127.0.0.1:1234/v1", key: "" }];
S.settings.aiProviderId = "local";
S.settings.aiModel = "google/gemma-4-12b-qat";
S.settings.thinkingEnabled = false;
S.settings.thinkingLevel = "none";
S.settings.alwaysSendTools = true;
S.view = "home";

const nativeFetch = globalThis.fetch;
let bodies = [];
globalThis.fetch = async (url, init) => {
	if (init?.body) bodies.push(JSON.parse(init.body));
	return nativeFetch(url, init);
};

async function reset(id) {
	S.pages = {};
	S.cards = {};
	S.decks = {};
	S.heftDocs = {};
	S.heftMeta = {};
	S.sideChat = [];
	S.sideChatId = id;
	bodies = [];
}

async function run(name, prompt, setup) {
	await reset("live-audit-" + name);
	await setup?.();
	const started = Date.now();
	let result = "", error = null;
	try { result = await AI.agent(prompt, "side", () => {}, { id: S.sideChatId, target: S.sideChat }); }
	catch (e) { error = { name: e.name, message: e.message }; }
	const trace = bodies.map((body) => {
		const message = body.messages.filter((item) => item.role === "assistant" && item.tool_calls).at(-1);
		return message?.tool_calls?.map((call) => ({ name: call.function.name, arguments: call.function.arguments })) || [];
	});
	console.log(JSON.stringify({ name, ms: Date.now() - started, result, error, trace, pages: Object.values(S.pages).map((p) => ({ title: p.title, length: p.content.length, head: p.content.slice(0, 160), tail: p.content.slice(-160) })) }));
}

const specialTitle = "Formeln & Maße — α/β [v2] €";
const specialContent = "Zeichen: ä ö ü Ä Ö Ü ß € £ ¥ ± × ÷ ∑ √ → ≤ ≥ 你好 «» „“ … —\nLaTeX: $F = m \\cdot a$ und \\[x^2+y^2=z^2\\].\nJSON: {\\\"key\\\":\\\"Wert\\\"} \\ Pfad";
await run("special", `Erstelle eine neue Seite mit exakt dem Titel „${specialTitle}“ und genau diesem Inhalt. Übernimm die Zeichen unverändert:\n${specialContent}`, null);

const longContent = Array.from({ length: 70 }, (_, i) => `Abschnitt ${i + 1}: Dieser Satz beschreibt einen langen Lerntext mit Details, Beispielen und dem Sonderzeichen Δ.`).join("\n\n") + "\nTAILMARKER_Ω_987";
if (false) await run("long-write", `Erstelle eine Seite „Langer Testtext“ und schreibe den folgenden Inhalt vollständig und unverändert hinein. Nichts zusammenfassen, nichts auslassen, keine zusätzlichen Überschriften. BEGINN\n${longContent}\nENDE`, null);

await reset("live-audit-search");
const tailContent = "Anfang.\n" + "x".repeat(14500) + "\nTAIL_SUCHMARKE_ΔΩ_987";
await STATE.dispatch("pageCreate", { id: "tail-page", title: "Sehr lange Physiknotiz", parentId: null, content: tailContent });
const directRead = await TOOLS.run("inspect", { kind: "page", titles: ["Sehr lange Physiknotiz"] });
console.log(JSON.stringify({ name: "long-read-limit", returnedContentLength: directRead.pages?.[0]?.content?.length, directReadHasTail: JSON.stringify(directRead).includes("TAIL_SUCHMARKE") }));
await run("search-tail", "Suche in meinen Notizen nach der exakten Suchmarke TAIL_SUCHMARKE_ΔΩ_987 und sage mir, auf welcher Seite sie steht.", async () => {
	await STATE.dispatch("pageCreate", { id: "tail-page-2", title: "Sehr lange Physiknotiz", parentId: null, content: tailContent });
});

function solidPng(color) {
	const png = new PNG({ width: 320, height: 220 });
	for (let i = 0; i < png.data.length; i += 4) {
		png.data[i] = color[0]; png.data[i + 1] = color[1]; png.data[i + 2] = color[2]; png.data[i + 3] = 255;
	}
	return "data:image/png;base64," + PNG.sync.write(png).toString("base64");
}
const heftImages = [[220, 50, 50], [40, 90, 220], [40, 160, 70], [220, 170, 30]].map(solidPng);
await reset("live-audit-heft-many-pages");
await STATE.dispatch("pageCreate", { id: "heft-live", title: "Mehrseitiges Physikheft", kind: "heft", parentId: null, content: "" });
window.HEFT = { activeId: "heft-live", activeIndex: 0, pageAsDataUrl: async (_id, index) => heftImages[Math.max(0, Math.min(3, index))] };
const heftStarted = Date.now();
let heftResult = "", heftError = null;
try {
	heftResult = await AI.agent("Öffne im Heft „Mehrseitiges Physikheft“ nacheinander die Seiten 1, 2, 3 und 4 mit dem Bildwerkzeug. Nenne mir danach die erkannte Farbe jeder Seite in dieser Reihenfolge.", "side", () => {}, { id: S.sideChatId, target: S.sideChat });
} catch (e) { heftError = { name: e.name, message: e.message }; }
const heftTrace = bodies.map((body) => {
	const message = body.messages.filter((item) => item.role === "assistant" && item.tool_calls).at(-1);
	return message?.tool_calls?.map((call) => ({ name: call.function.name, arguments: call.function.arguments })) || [];
});
console.log(JSON.stringify({ name: "heft-four-pages", ms: Date.now() - heftStarted, result: heftResult, error: heftError, requests: bodies.length, trace: heftTrace }));
