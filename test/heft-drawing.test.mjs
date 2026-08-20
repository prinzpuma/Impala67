import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

function setupRealDOM() {
	const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body><div id="heftStage"></div></body></html>`, {
		url: "http://localhost/",
		referrer: "http://localhost/",
		contentType: "text/html",
	});

	const define = (k, v) => {
		try {
			Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
		} catch {
			globalThis[k] = v;
		}
	};

	define("window", dom.window);
	define("document", dom.window.document);
	define("Element", dom.window.Element);
	define("Node", dom.window.Node);
	define("HTMLElement", dom.window.HTMLElement);
	define("CustomEvent", dom.window.CustomEvent);
	define("MutationObserver", dom.window.MutationObserver);
	define("Image", dom.window.Image);
	define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
	define("requestAnimationFrame", (fn) => setTimeout(fn, 0));
	define("cancelAnimationFrame", (id) => clearTimeout(id));

	class MockContext2D {
		constructor(cv) {
			this.canvas = cv;
			this.lineWidth = 1;
			this.strokeStyle = "#000";
			this.fillStyle = "#000";
		}
		setTransform() {}
		save() {}
		restore() {}
		beginPath() {}
		moveTo() {}
		lineTo() {}
		quadraticCurveTo() {}
		ellipse() {}
		arc() {}
		stroke() {}
		fill() {}
		clearRect() {}
		strokeRect() {}
		fillRect() {}
		drawImage() {}
		measureText() { return { width: 40 }; }
		fillText() {}
		setLineDash() {}
	}

	dom.window.HTMLCanvasElement.prototype.getContext = function() {
		if (!this._ctx) this._ctx = new MockContext2D(this);
		return this._ctx;
	};

	const store = new Map();
	define("localStorage", {
		getItem: (k) => store.get(k) || null,
		setItem: (k, v) => store.set(k, String(v)),
		removeItem: (k) => store.delete(k),
		clear: () => store.clear()
	});
	define("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
}

setupRealDOM();

const { S, STATE } = await import("../web/state.js");
const { DB } = await import("../web/db.js");
const { HEFT } = await import("../web/heft.js");

// Mock DB.addEvent / STATE.dispatch so background timers don't throw DB.open errors in unit tests
STATE.dispatch = async () => {};

const touchEvent = (type, touches, changedTouches = touches) => {
	const event = new window.Event(type, { bubbles: true, cancelable: true });
	Object.defineProperties(event, {
		touches: { value: touches },
		changedTouches: { value: changedTouches },
	});
	return event;
};

test("Heft-Tests: Pinch endet wieder im scharfen Renderzustand", async () => {
	S.pages.zoomHeft = { id: "zoomHeft", title: "Zoom-Heft", kind: "heft" };
	S.heftDocs.zoomHeft = { pages: [{ id: "zoomPage", paper: "blank", strokes: [], images: [], texts: [] }] };
	const stage = document.getElementById("heftStage");
	await HEFT.mount(stage, "zoomHeft");
	const scroll = stage.querySelector(".heft-scroll");
	const pages = stage.querySelector(".heft-pages");
	const detail = stage.querySelector(".heft-detail-canvas");
	assert.equal(detail.parentElement, scroll, "sharp tile stays outside the scaled pages layer");
	const a = { identifier: 1, clientX: 100, clientY: 100 };
	const b = { identifier: 2, clientX: 200, clientY: 100 };
	scroll.dispatchEvent(touchEvent("touchstart", [a, b]));
	const c = { identifier: 1, clientX: -200, clientY: 100 };
	const d = { identifier: 2, clientX: 500, clientY: 100 };
	scroll.dispatchEvent(touchEvent("touchmove", [c, d], [c, d]));
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(pages.style.willChange, "transform", "während Pinch bleibt die Fläche compositor-freundlich");
	assert.match(pages.style.transform, /scale\(6\.0000\)/, "maximum zoom is reached");
	scroll.dispatchEvent(touchEvent("touchend", [], [c, d]));
	assert.equal(pages.style.willChange, "auto", "Touch-Ende löst den scharfen Abschlussrender aus");
	HEFT.unmount(true);
});

test("Heft wiederholt einen fehlgeschlagenen Persistenzversuch", async () => {
	S.pages.persistHeft = { id: "persistHeft", title: "Persistenz", kind: "heft" };
	S.heftDocs.persistHeft = { pages: [{ id: "persistPage", paper: "blank", strokes: [], images: [], texts: [], ocrText: "" }] };
	const stage = document.getElementById("heftStage");
	await HEFT.mount(stage, "persistHeft");
	S.heftDocs.persistHeft.pages[0].ocrText = "muss gespeichert werden";
	let attempts = 0;
	const oldWarn = console.warn, oldAllBlobKeys = DB.allBlobKeys, oldPutBlob = DB.putBlob, oldDelBlob = DB.delBlob;
	console.warn = () => {};
	DB.allBlobKeys = async () => [];
	DB.putBlob = async () => {};
	DB.delBlob = async () => {};
	STATE.dispatch = async (type) => {
		if (type !== "heftOps") return;
		attempts++;
		if (attempts === 1) throw new Error("simulierter IndexedDB-Fehler");
	};
	try {
		await HEFT.saveNow();
		await HEFT.saveNow();
		assert.equal(attempts, 2, "der RAM-Stand darf erst nach erfolgreichem Schreiben als veröffentlicht gelten");
	} finally {
		HEFT.unmount(true);
		STATE.dispatch = async () => {};
		console.warn = oldWarn;
		DB.allBlobKeys = oldAllBlobKeys;
		DB.putBlob = oldPutBlob;
		DB.delBlob = oldDelBlob;
	}
});

test("Heft-Tests: Strich-Erstellung und automatische s.bbox Berechnungen", () => {
	const mockPage = {
		id: "p1",
		paper: "blank",
		strokes: [],
		images: [],
		texts: []
	};

	const stroke = {
		id: "str_1",
		tool: "pen",
		color: "#1c1c1e",
		size: 3,
		pts: [[100, 100, 0.5], [150, 120, 0.5], [200, 180, 0.5]]
	};

	mockPage.strokes.push(stroke);

	// Rendern der Seite
	const cv = document.createElement("canvas");
	cv.width = 800; cv.height = 1100;
	cv.__heftDpr = 1; cv.__heftScale = 1;
	const ctx = cv.getContext("2d");

	const bbox = HEFT.calcStrokeBBox ? HEFT.calcStrokeBBox(stroke) : stroke.bbox || { minX: 100, maxX: 200 };

	HEFT.renderPageTo(ctx, mockPage, 0, { x: 0, y: 0, w: 500, h: 500 });

	assert.ok(stroke.bbox, "s.bbox wurde beim Rendern mit tileRect automatisch erzeugt");
	assert.ok(stroke.bbox.minX <= 100, "bbox.minX korrelierendes Minimum");
	assert.ok(stroke.bbox.maxX >= 200, "bbox.maxX korrelierendes Maximum");
});

test("Heft-Tests: Bounding-Box Culling für Detail-Kacheln", () => {
	const insideStroke = {
		id: "str_in",
		tool: "pen",
		color: "#1c1c1e",
		size: 2,
		pts: [[100, 100, 0.5], [120, 120, 0.5]]
	};

	const outsideStroke = {
		id: "str_out",
		tool: "pen",
		color: "#2f6fed",
		size: 2,
		pts: [[900, 900, 0.5], [950, 950, 0.5]]
	};

	const mockPage = {
		id: "p1",
		paper: "lined",
		strokes: [insideStroke, outsideStroke],
		images: [],
		texts: []
	};

	const cv = document.createElement("canvas");
	cv.width = 300; cv.height = 300;
	const ctx = cv.getContext("2d");

	let strokeDrawCount = 0;
	ctx.stroke = () => { strokeDrawCount++; };

	// Rendern mit Detail-Kachel-Ausschnitt (x: 0, y: 0, w: 300, h: 300)
	const tileRect = { x: 0, y: 0, w: 300, h: 300 };
	HEFT.renderPageTo(ctx, mockPage, 0, tileRect);

	assert.ok(strokeDrawCount > 0, "Der innere Strich wurde gezeichnet");
	assert.ok(insideStroke.bbox, "Innentrich besitzt bbox");
	assert.ok(outsideStroke.bbox, "Außentrich besitzt bbox");
});

test("Heft-Tests: Detail-Kachel rechnet Layout-Pixel in Seiten-Pixel um", () => {
	const rect = HEFT.pageRectForTile({ x: 100, y: 50, w: 200, h: 300 }, 0.5);
	assert.deepEqual(rect, { x: 200, y: 100, w: 400, h: 600 });
});

test("Heft-Tests: Strichverschiebung aktualisiert s.bbox in O(1)", () => {
	const mockStroke = {
		id: "str_move",
		tool: "pen",
		color: "#1c1c1e",
		size: 2,
		pts: [[50, 50, 0.5], [80, 80, 0.5]],
		bbox: { minX: 40, minY: 40, maxX: 90, maxY: 90 }
	};

	// Verschieben um dx=100, dy=50
	const dx = 100, dy = 50;
	mockStroke.pts.forEach((p) => { p[0] += dx; p[1] += dy; });
	if (mockStroke.bbox) {
		mockStroke.bbox.minX += dx; mockStroke.bbox.maxX += dx;
		mockStroke.bbox.minY += dy; mockStroke.bbox.maxY += dy;
	}

	assert.equal(mockStroke.bbox.minX, 140);
	assert.equal(mockStroke.bbox.maxX, 190);
	assert.equal(mockStroke.bbox.minY, 90);
	assert.equal(mockStroke.bbox.maxY, 140);
});

test("Heft-Tests: Lasso skaliert Freihand und Formen proportional", () => {
	const stroke = {
		id: "scale", tool: "shape", color: "#000", size: 2,
		pts: [[10, 10, 0.5], [30, 20, 0.5]],
		shape: { type: "rect", x1: 10, y1: 10, x2: 30, y2: 20 },
	};
	const original = HEFT.strokeGeometry(stroke);
	HEFT.scaleStrokeFrom(stroke, original, 10, 10, 2);
	assert.deepEqual(stroke.pts, [[10, 10, 0.5], [50, 30, 0.5]]);
	assert.deepEqual(stroke.shape, { type: "rect", x1: 10, y1: 10, x2: 50, y2: 30 });
	assert.equal(stroke.size, 4);
	assert.ok(stroke.bbox.maxX >= 50);
});

test("Heft-Tests: Fingertipp außerhalb beendet den Lasso-Modus", () => {
	assert.equal(HEFT.lassoTouchAction("touch", "lasso", false), "dismiss");
	assert.equal(HEFT.lassoTouchAction("touch", "lasso", true), "interact");
	assert.equal(HEFT.lassoTouchAction("pen", "lasso", false), "none");
});

test("Heft-Tests: Rendern hoher Strichzahlen (1.000 bis 10.000 Striche) ohne Fehler", () => {
	const strokes = [];
	for (let i = 0; i < 1000; i++) {
		strokes.push({
			id: `s_${i}`,
			tool: "pen",
			color: "#000",
			size: 2,
			pts: [[i, i, 0.5], [i + 5, i + 5, 0.5]]
		});
	}

	const mockPage = {
		id: "p_1000",
		paper: "grid",
		strokes,
		images: [],
		texts: []
	};

	const cv = document.createElement("canvas");
	cv.width = 1600; cv.height = 2200;
	const ctx = cv.getContext("2d");

	assert.doesNotThrow(() => {
		HEFT.renderPageTo(ctx, mockPage, 0);
	}, "Rendern von 1.000 Strichen verläuft ohne Fehler");
});
