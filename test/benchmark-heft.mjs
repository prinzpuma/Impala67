import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

function setupDOM() {
	const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body><div id="heftStage"></div></body></html>`, {
		url: "http://localhost/",
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
	define("requestAnimationFrame", (fn) => setTimeout(fn, 0));
	define("cancelAnimationFrame", (id) => clearTimeout(id));

	// Canvas 2D Context Mock with operation counters for benchmarking
	class MockCanvasRenderingContext2D {
		constructor(canvas) {
			this.canvas = canvas;
			this.lineWidth = 1;
			this.lineCap = "butt";
			this.lineJoin = "miter";
			this.strokeStyle = "#000000";
			this.fillStyle = "#000000";
			this.globalAlpha = 1.0;
			this.imageSmoothingEnabled = true;
			this.imageSmoothingQuality = "high";
			this.drawCalls = 0;
			this.pathOps = 0;
		}
		setTransform() {}
		save() {}
		restore() {}
		beginPath() { this.pathOps++; }
		moveTo() { this.pathOps++; }
		lineTo() { this.pathOps++; }
		quadraticCurveTo() { this.pathOps++; }
		ellipse() { this.pathOps++; }
		arc() { this.pathOps++; }
		stroke() { this.drawCalls++; }
		fill() { this.drawCalls++; }
		clearRect() {}
		strokeRect() { this.drawCalls++; }
		fillRect() { this.drawCalls++; }
		drawImage() { this.drawCalls++; }
		measureText() { return { width: 50 }; }
		fillText() { this.drawCalls++; }
		setLineDash() {}
	}

	dom.window.HTMLCanvasElement.prototype.getContext = function(type) {
		if (!this._mockCtx) this._mockCtx = new MockCanvasRenderingContext2D(this);
		return this._mockCtx;
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

setupDOM();

const { S, STATE } = await import("../web/state.js");
const { HEFT } = await import("../web/heft.js");

// Mock DB & STATE to prevent pending timer issues
STATE.dispatch = async () => {};

function generateStrokes(count) {
	const strokes = [];
	for (let i = 0; i < count; i++) {
		const pts = [];
		const pointCount = 10 + (i % 20); // 10 bis 30 Punkte pro Strich
		const startX = (i * 17) % 800;
		const startY = (i * 23) % 1100;
		for (let p = 0; p < pointCount; p++) {
			pts.push([startX + p * 2, startY + (p % 3) * 4, 0.5]);
		}
		strokes.push({
			id: `str_${i}`,
			tool: i % 10 === 0 ? "marker" : "pen",
			color: i % 2 === 0 ? "#1c1c1e" : "#2f6fed",
			size: 2,
			pts
		});
	}
	return strokes;
}

test("HEFT Performance Benchmark: Rendern & Zeichnen nach Strichanzahl", async () => {
	console.log("\n=== HEFT PERFORMANCE MESSUNG (DOM-MODELL & CANVAS) ===");
	console.log("Kategorie            | Striche | Render-Zeit (ms) | Canvas Draw-Calls | Path-Ops");
	console.log("-------------------------------------------------------------------------------");

	const categories = [
		{ name: "Einfache Seite", count: 10 },
		{ name: "Mittelgroß", count: 1000 },
		{ name: "Groß", count: 5000 },
		{ name: "Sehr groß (10k)", count: 10000 },
	];

	for (const cat of categories) {
		const strokes = generateStrokes(cat.count);
		const mockPage = {
			id: "p1",
			paper: "lined",
			strokes,
			images: [],
			texts: []
		};

		// Fake Canvas
		const cv = document.createElement("canvas");
		cv.width = 1600; cv.height = 2200;
		cv.__heftDpr = 2; cv.__heftScale = 1;
		const ctx = cv.getContext("2d");
		ctx.drawCalls = 0; ctx.pathOps = 0;

		const iterations = 5;
		const t0 = performance.now();
		for (let it = 0; it < iterations; it++) {
			ctx.drawCalls = 0; ctx.pathOps = 0;
			HEFT.renderPageTo(ctx, mockPage, 0);
		}
		const t1 = performance.now();
		const avgMs = (t1 - t0) / iterations;

		console.log(
			`${cat.name.padEnd(20)} | ${String(cat.count).padStart(7)} | ${avgMs.toFixed(3).padStart(16)} | ${String(ctx.drawCalls).padStart(17)} | ${String(ctx.pathOps).padStart(8)}`
		);
	}

	// Seite mit großen Bildern
	const imgPage = {
		id: "p_img",
		paper: "grid",
		strokes: generateStrokes(500),
		images: [
			{ id: "img1", x: 50, y: 50, w: 600, h: 400, data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" },
			{ id: "img2", x: 100, y: 500, w: 700, h: 500, data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }
		],
		texts: []
	};
	const cvImg = document.createElement("canvas");
	cvImg.width = 1600; cvImg.height = 2200;
	cvImg.__heftDpr = 2; cvImg.__heftScale = 1;
	const ctxImg = cvImg.getContext("2d");
	const t0Img = performance.now();
	for (let it = 0; it < 5; it++) {
		HEFT.renderPageTo(ctxImg, imgPage, 0);
	}
	const avgImgMs = (performance.now() - t0Img) / 5;
	console.log(
		`${"Bilder + 500 Striche".padEnd(20)} | ${String(500).padStart(7)} | ${avgImgMs.toFixed(3).padStart(16)} | ${String(ctxImg.drawCalls).padStart(17)} | ${String(ctxImg.pathOps).padStart(8)}`
	);

	console.log("-------------------------------------------------------------------------------\n");
});
