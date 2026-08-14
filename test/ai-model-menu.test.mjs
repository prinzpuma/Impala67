import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!doctype html><body>
	<form id="chatForm">
		<button type="submit">Senden</button>
		<div id="modelMenu"></div>
	</form>
	<form id="mainChatForm">
		<button type="submit">Senden</button>
		<div id="modelMenuFull"></div>
	</form>
</body>`, { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const { S } = await import("../web/state.js");
const { RENDER } = await import("../web/render.js");

function clickDoesNotSubmit(form, button) {
	let submits = 0;
	form.addEventListener("submit", (event) => { event.preventDefault(); submits++; }, { once: true });
	button.click();
	assert.equal(submits, 0, `${button.outerHTML} darf das Chat-Formular nicht absenden`);
}

test("jeder Klick im Modellmenü bleibt eine Auswahl und sendet keine Nachricht", () => {
	S.settings.aiProviders = [{ id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", key: "test" }];
	S.settings.aiProviderId = "openai";
	S.settings.aiModel = "gpt-5.6-sol";
	S.availableModels = [{ providerId: "openai", id: "gpt-5.6-sol" }];
	S.modelMenuOpen = true;

	for (const [anchor, formId, menuId] of [["panel", "chatForm", "modelMenu"], ["full", "mainChatForm", "modelMenuFull"]]) {
		S.modelMenuAnchor = anchor;
		for (const section of ["root", "models", "thinking"]) {
			S.modelMenuSection = section;
			RENDER.renderModelMenu();
			const form = document.getElementById(formId);
			for (const button of document.getElementById(menuId).querySelectorAll("button")) clickDoesNotSubmit(form, button);
		}
	}
});
