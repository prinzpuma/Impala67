import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!doctype html><body>
	<aside id="sidebar"><div id="tree">
		<div class="row" data-page="moved">Verschieben</div>
		<div class="row" data-page="target">Ziel</div>
	</div></aside>
	<div id="tabbar"></div><main id="main"></main><div id="overlay" hidden></div>
</body>`, { url: "http://localhost/" });

for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator", "Event"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "cancelAnimationFrame", { value: clearTimeout, configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({
	matches: false, addEventListener() {}, removeEventListener() {},
}), configurable: true });

const { S, STATE } = await import("../web/state.js");
const { APP } = await import("../web/app.js");

const pointer = (type, target, fields) => {
	const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
	for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value });
	target.dispatchEvent(event);
};

test("Seiten-Drag in einen anderen Workspace zieht den ganzen Teilbaum mit", async () => {
	S.pages = {
		moved: { id: "moved", title: "Verschieben", parentId: null, workspaceId: "a", created: "2026-01-01T00:00:00.000Z" },
		child: { id: "child", title: "Kind", parentId: "moved", workspaceId: "a", created: "2026-01-01T00:00:01.000Z" },
		target: { id: "target", title: "Ziel", parentId: null, workspaceId: "b", created: "2026-01-01T00:00:02.000Z" },
	};
	S.workspaces = { a: { id: "a" }, b: { id: "b" } };
	S.currentWorkspaceId = "a";
	STATE.reduce({ type: "pageUpdate", payload: { id: "moved", patch: {} }, t: "2026-01-01T00:00:03.000Z" });

	const originalDispatch = STATE.dispatch;
	STATE.dispatch = async (type, payload) => {
		STATE.reduce({ type, payload, t: "2026-01-01T00:00:04.000Z" });
	};
	try {
		APP.wireEvents();
		const moved = document.querySelector('[data-page="moved"]');
		const target = document.querySelector('[data-page="target"]');
		target.getBoundingClientRect = () => ({ top: 0, height: 100 });
		document.elementFromPoint = () => target;

		pointer("pointerdown", moved, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 0 });
		pointer("pointermove", document, { pointerId: 1, pointerType: "mouse", clientX: 20, clientY: 50 });
		pointer("pointerup", document, { pointerId: 1, pointerType: "mouse", clientX: 20, clientY: 50 });
		await new Promise((resolve) => setTimeout(resolve, 0));

		assert.equal(S.pages.moved.parentId, "target");
		assert.equal(S.pages.moved.workspaceId, "b");
		assert.equal(S.pages.child.workspaceId, "b");
	} finally {
		STATE.dispatch = originalDispatch;
	}
});
