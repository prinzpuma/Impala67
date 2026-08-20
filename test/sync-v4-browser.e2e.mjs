import test, { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const CHROME_PATHS = [
	process.env.CHROME_BIN,
	process.env.PUPPETEER_EXECUTABLE_PATH,
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe") : null,
	process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft\\Edge\\Application\\msedge.exe") : null,
	process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Google\\Chrome\\Application\\chrome.exe") : null,
	process.env["PROGRAMFILES(X86)"] ? path.join(process.env["PROGRAMFILES(X86)"], "Google\\Chrome\\Application\\chrome.exe") : null,
	process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Microsoft\\Edge\\Application\\msedge.exe") : null,
	process.env["PROGRAMFILES(X86)"] ? path.join(process.env["PROGRAMFILES(X86)"], "Microsoft\\Edge\\Application\\msedge.exe") : null,
	"/usr/bin/google-chrome",
	"/usr/bin/chromium-browser",
	"/usr/bin/chromium",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const MIME_MAP = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".pdf": "application/pdf",
	".webmanifest": "application/manifest+json",
	".wasm": "application/wasm",
};

const STATIC_PORT = 5188;
const WORKER_PORT = 8787;
const STATIC_URL = `http://127.0.0.1:${STATIC_PORT}/`;
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
function generateTestSyncKey() {
	const hex = () => Math.floor(0x10000 + Math.random() * 0x10000).toString(16).slice(1);
	return `impala-${hex()}-${hex()}-${hex()}-${hex()}-${hex()}-${hex()}-${hex()}-${hex()}`;
}
const TEST_SYNC_KEY = generateTestSyncKey();

let staticServer = null;
let wranglerProcess = null;
let browser = null;

let ctxA = null;
let ctxB = null;
let ctxC = null;

let pageA = null;
let pageB = null;
let pageC = null;

const consoleErrors = { A: [], B: [], C: [] };
const unhandledRejections = { A: [], B: [], C: [] };

function killLingering() {
	try {
		execSync("Stop-Process -Name workerd -Force -ErrorAction SilentlyContinue", { shell: "powershell", stdio: "ignore" });
	} catch {}
}

function attachMonitoring(page, label) {
	page.on("console", (msg) => {
		const txt = msg.text();
		const type = msg.type();
		if (type === "error") {
			const loc = msg.location();
			const url = loc?.url || "";
			if (url.includes("localhost:1234") || url.includes("config.local.js") || txt.includes("localhost:1234") || txt.includes("config.local.js")) {
				return;
			}
			const entry = url ? `${txt} (${url})` : txt;
			consoleErrors[label].push(entry);
		}
	});
	page.on("pageerror", (err) => {
		unhandledRejections[label].push(err.message || String(err));
	});
}

async function goOffline(page) {
	await page.setOfflineMode(true);
	await page.evaluate(() => {
		window.dispatchEvent(new Event("offline"));
	});
	await page.waitForFunction(() => !navigator.onLine);
}

async function goOnline(page) {
	await page.setOfflineMode(false);
	await page.evaluate(() => {
		window.dispatchEvent(new Event("online"));
	});
	await page.waitForFunction(() => navigator.onLine);
}

function startStaticServer() {
	return new Promise((resolve, reject) => {
		const webDir = path.join(process.cwd(), "web");
		staticServer = http.createServer((req, res) => {
			const urlPath = req.url.split("?")[0];
			if (urlPath === "/config.local.js") {
				res.writeHead(200, { "Content-Type": "application/javascript" });
				res.end("// local config\n");
				return;
			}
			let filePath = path.join(webDir, urlPath === "/" ? "index.html" : urlPath.replace(/^\//, ""));
			if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
				filePath = path.join(filePath, "index.html");
			}
			if (!fs.existsSync(filePath)) {
				res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
				res.end("Not Found: " + urlPath);
				return;
			}
			const ext = path.extname(filePath).toLowerCase();
			const contentType = MIME_MAP[ext] || "application/octet-stream";
			res.writeHead(200, {
				"Content-Type": contentType,
				"Service-Worker-Allowed": "/",
				"Cache-Control": "no-cache, no-store, must-revalidate",
			});
			fs.createReadStream(filePath).pipe(res);
		});
		staticServer.listen(STATIC_PORT, "127.0.0.1", () => resolve(staticServer));
		staticServer.on("error", reject);
	});
}

async function startWrangler() {
	killLingering();
	try { fs.rmSync(path.join(process.cwd(), ".wrangler", "state"), { recursive: true, force: true }); } catch {}
	wranglerProcess = spawn("npx", [
		"wrangler", "dev", "server/worker.js",
		"--config", "server/wrangler.toml",
		"--port", String(WORKER_PORT),
		"--ip", "127.0.0.1",
	], { shell: true });

	let startupLogs = "";
	wranglerProcess.stdout?.on("data", (d) => { startupLogs += d.toString(); });
	wranglerProcess.stderr?.on("data", (d) => { startupLogs += d.toString(); });

	for (let i = 0; i < 60; i++) {
		try {
			const res = await fetch(`${WORKER_URL}/api/health`);
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error("Wrangler dev server failed to start on port " + WORKER_PORT + "\nLogs: " + startupLogs);
}

async function waitReady(page) {
	await page.waitForFunction(() => window.BOOT && window.STATE && window.CLOUDFLARE_SYNC && window.DB && window.__IMPALA_PERF__?.totalBootMs);
	await page.waitForFunction(() => {
		const hasKey = !!localStorage.getItem("impala67_cf_sync_key") || !!window.S?.settings?.cfSyncKey;
		const st = window.CLOUDFLARE_SYNC.status();
		if (!hasKey) return true;
		return st.status === "connected" || st.label === "Synchronisiert";
	}, { timeout: 15000 });
}

async function setupPageInContext(ctx, label) {
	const page = await ctx.newPage();
	await page.evaluateOnNewDocument(() => {
		window.__DISABLE_BROADCAST__ = true;
	});
	attachMonitoring(page, label);
	await page.goto(STATIC_URL, { waitUntil: "domcontentloaded" });
	await waitReady(page);
	return page;
}

describe("Impala67 Sync v4 Browser E2E Test Suite", { concurrency: false }, () => {
	afterEach(async () => {
		try { if (pageA && !pageA.isClosed()) await pageA.setOfflineMode(false); } catch {}
		try { if (pageB && !pageB.isClosed()) await pageB.setOfflineMode(false); } catch {}
		try { if (pageC && !pageC.isClosed()) await pageC.setOfflineMode(false); } catch {}
	});
	before(async () => {
		const browserExe = CHROME_PATHS.find((p) => p && fs.existsSync(p));
		if (!browserExe) throw new Error("Chrome or Edge binary not found on this system.");

		await startStaticServer();
		await startWrangler();

		browser = await puppeteer.launch({
			executablePath: browserExe,
			headless: "new",
			args: [
				"--no-sandbox",
				"--disable-setuid-sandbox",
				"--disable-background-timer-throttling",
				"--disable-backgrounding-occluded-windows",
				"--disable-renderer-backgrounding",
			],
		});

		ctxA = await browser.createBrowserContext();
		pageA = await setupPageInContext(ctxA, "A");

		ctxB = await browser.createBrowserContext();
		pageB = await setupPageInContext(ctxB, "B");
	});

	after(async () => {
		try { if (browser) await browser.close(); } catch {}
		if (wranglerProcess) {
			try { execSync(`taskkill /pid ${wranglerProcess.pid} /T /F`, { stdio: "ignore" }); } catch {}
		}
		killLingering();
		try { if (staticServer) staticServer.close(); } catch {}
	});

	it("A. Grundsync: Device A erstellt Notiz -> Device B erhält sie -> Reload behält Daten", async () => {
		const configuredA = await pageA.evaluate(async (url, key) => {
			await window.STATE.dispatch("settingsSet", { cfUrl: url, cfSyncKey: key });
			return window.CLOUDFLARE_SYNC.configure(url, key);
		}, WORKER_URL, TEST_SYNC_KEY);
		assert.equal(configuredA, true);

		// Purge cloud partition at start to ensure clean baseline
		await pageA.evaluate(async () => {
			await window.CLOUDFLARE_SYNC.purgeCloudData();
		});

		const configuredB = await pageB.evaluate(async (url, key) => {
			await window.STATE.dispatch("settingsSet", { cfUrl: url, cfSyncKey: key });
			return window.CLOUDFLARE_SYNC.configure(url, key);
		}, WORKER_URL, TEST_SYNC_KEY);
		assert.equal(configuredB, true);

		// Device A: Create new note
		await pageA.evaluate(async () => {
			await window.STATE.dispatch("pageCreate", {
				id: "note-test-a1",
				title: "Notiz A1",
				content: "Dies ist der Inhalt von Notiz A1.",
				workspaceId: "default",
			});
			await window.CLOUDFLARE_SYNC.syncNow();
		});

		// Device B: Sync
		await pageB.evaluate(async () => {
			await window.CLOUDFLARE_SYNC.syncNow();
		});

		// Verify on Device B
		const noteOnB = await pageB.evaluate(() => window.S.pages["note-test-a1"]);
		assert.ok(noteOnB, "Note A1 should exist on Device B");
		assert.equal(noteOnB.title, "Notiz A1");
		assert.equal(noteOnB.content, "Dies ist der Inhalt von Notiz A1.");

		// Verify no duplicate note
		const pageKeysB = await pageB.evaluate(() => Object.keys(window.S.pages).filter((k) => k.startsWith("note-test-a1")));
		assert.equal(pageKeysB.length, 1);

		// Reload both devices and check persistence
		await pageA.reload({ waitUntil: "domcontentloaded" });
		await waitReady(pageA);

		await pageB.reload({ waitUntil: "domcontentloaded" });
		await waitReady(pageB);

		const reloadedNoteA = await pageA.evaluate(() => window.S.pages["note-test-a1"]);
		const reloadedNoteB = await pageB.evaluate(() => window.S.pages["note-test-a1"]);
		assert.equal(reloadedNoteA?.content, "Dies ist der Inhalt von Notiz A1.");
		assert.equal(reloadedNoteB?.content, "Dies ist der Inhalt von Notiz A1.");
	});

	it("B. B -> A: Device B ändert Notiz -> Device A erhält Änderung -> Reload identisch", async () => {
		// Device B edits note
		await pageB.evaluate(async () => {
			await window.STATE.dispatch("pageUpdate", {
				id: "note-test-a1",
				patch: { content: "Aktualisierter Inhalt von Device B." },
			});
			await window.CLOUDFLARE_SYNC.syncNow();
		});

		// Device A syncs
		await pageA.evaluate(async () => {
			await window.CLOUDFLARE_SYNC.syncNow();
		});

		const noteOnA = await pageA.evaluate(() => window.S.pages["note-test-a1"]);
		assert.equal(noteOnA?.content, "Aktualisierter Inhalt von Device B.");

		// Reload both
		await pageA.reload({ waitUntil: "domcontentloaded" });
		await waitReady(pageA);
		await pageB.reload({ waitUntil: "domcontentloaded" });
		await waitReady(pageB);

		const finalA = await pageA.evaluate(() => window.S.pages["note-test-a1"]?.content);
		const finalB = await pageB.evaluate(() => window.S.pages["note-test-a1"]?.content);
		assert.equal(finalA, "Aktualisierter Inhalt von Device B.");
		assert.equal(finalB, "Aktualisierter Inhalt von Device B.");
	});

	it("C. Offline-Konflikt ohne echten Feldkonflikt: A & B offline Notizen erstellen -> Sync konvergiert", async () => {
		// A and B actually go offline
		await goOffline(pageA);
		await goOffline(pageB);

		// Device A creates note offline
		await pageA.evaluate(async () => {
			await window.STATE.dispatch("pageCreate", {
				id: "note-offline-c-a",
				title: "Offline Notiz C-A",
				content: "Inhalt C-A",
				workspaceId: "default",
			});
		});

		// Device B creates note offline
		await pageB.evaluate(async () => {
			await window.STATE.dispatch("pageCreate", {
				id: "note-offline-c-b",
				title: "Offline Notiz C-B",
				content: "Inhalt C-B",
				workspaceId: "default",
			});
		});

		// Wait 150ms to ensure scheduled timer fires while offline
		await new Promise((r) => setTimeout(r, 150));

		// Check before going online that no device knows the other's offline note
		const preHasBOnA = await pageA.evaluate(() => !!window.S.pages["note-offline-c-b"]);
		const preHasAOnB = await pageB.evaluate(() => !!window.S.pages["note-offline-c-a"]);
		assert.equal(preHasBOnA, false, "Device A must not know B note while offline");
		assert.equal(preHasAOnB, false, "Device B must not know A note while offline");

		// Both back online
		await goOnline(pageA);
		await goOnline(pageB);

		// Both sync
		await pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });
		await pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		// Verify A and B have both notes
		const pagesA = await pageA.evaluate(() => ({
			hasA: !!window.S.pages["note-offline-c-a"],
			hasB: !!window.S.pages["note-offline-c-b"],
		}));
		const pagesB = await pageB.evaluate(() => ({
			hasA: !!window.S.pages["note-offline-c-a"],
			hasB: !!window.S.pages["note-offline-c-b"],
		}));

		assert.deepEqual(pagesA, { hasA: true, hasB: true });
		assert.deepEqual(pagesB, { hasA: true, hasB: true });

		// Reload and check again
		await pageA.reload({ waitUntil: "domcontentloaded" });
		await waitReady(pageA);
		await pageB.reload({ waitUntil: "domcontentloaded" });
		await waitReady(pageB);

		const reloadedPagesA = await pageA.evaluate(() => ({
			hasA: !!window.S.pages["note-offline-c-a"],
			hasB: !!window.S.pages["note-offline-c-b"],
		}));
		const reloadedPagesB = await pageB.evaluate(() => ({
			hasA: !!window.S.pages["note-offline-c-a"],
			hasB: !!window.S.pages["note-offline-c-b"],
		}));
		assert.deepEqual(reloadedPagesA, { hasA: true, hasB: true });
		assert.deepEqual(reloadedPagesB, { hasA: true, hasB: true });
	});

	it("D. Parallel unterschiedliche bestehende Notizen ändern -> Nahezu gleichzeitig syncen", async () => {
		// A edits note-offline-c-a
		await pageA.evaluate(async () => {
			await window.STATE.dispatch("pageUpdate", {
				id: "note-offline-c-a",
				patch: { content: "Inhalt C-A modifiziert von Gerät A" },
			});
		});

		// B edits note-offline-c-b
		await pageB.evaluate(async () => {
			await window.STATE.dispatch("pageUpdate", {
				id: "note-offline-c-b",
				patch: { content: "Inhalt C-B modifiziert von Gerät B" },
			});
		});

		// Sync simultaneously
		await Promise.all([
			pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); }),
			pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); }),
		]);

		// Settle sync
		await pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		const contentA_on_A = await pageA.evaluate(() => window.S.pages["note-offline-c-a"]?.content);
		const contentB_on_A = await pageA.evaluate(() => window.S.pages["note-offline-c-b"]?.content);
		const contentA_on_B = await pageB.evaluate(() => window.S.pages["note-offline-c-a"]?.content);
		const contentB_on_B = await pageB.evaluate(() => window.S.pages["note-offline-c-b"]?.content);

		assert.equal(contentA_on_A, "Inhalt C-A modifiziert von Gerät A");
		assert.equal(contentB_on_A, "Inhalt C-B modifiziert von Gerät B");
		assert.equal(contentA_on_B, "Inhalt C-A modifiziert von Gerät A");
		assert.equal(contentB_on_B, "Inhalt C-B modifiziert von Gerät B");
	});

	it("E. Gleiches Heft parallel: Beide zeichnen Strich im selben Heft -> Vereinigung beider Striche", async () => {
		const HEFT_ID = "heft-e-parallel";
		// A creates heft
		await pageA.evaluate(async (id) => {
			await window.STATE.dispatch("pageCreate", {
				id,
				title: "Gemeinsames Heft E",
				kind: "heft",
				workspaceId: "default",
			});
			await window.STATE.dispatch("heftOps", {
				pageId: id,
				ops: [{ t: "pg+", page: { id: "p1", paper: "lined" } }],
			});
			await window.CLOUDFLARE_SYNC.syncNow();
		}, HEFT_ID);

		// B syncs initial heft
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		// A adds stroke A
		await pageA.evaluate(async (id) => {
			await window.STATE.dispatch("heftOps", {
				pageId: id,
				ops: [{ t: "s+", p: "p1", o: { id: "stroke-e-a-1", color: "#f00", size: 2, pts: [10, 10, 20, 20] } }],
			});
		}, HEFT_ID);

		// B adds stroke B
		await pageB.evaluate(async (id) => {
			await window.STATE.dispatch("heftOps", {
				pageId: id,
				ops: [{ t: "s+", p: "p1", o: { id: "stroke-e-b-1", color: "#00f", size: 3, pts: [50, 50, 60, 60] } }],
			});
		}, HEFT_ID);

		// Sync simultaneously
		await Promise.all([
			pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); }),
			pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); }),
		]);
		await pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		// Verify strokes on both sides
		const strokesA = await pageA.evaluate((id) => window.S.heftDocs[id]?.pages?.[0]?.strokes?.map((s) => s.id), HEFT_ID);
		const strokesB = await pageB.evaluate((id) => window.S.heftDocs[id]?.pages?.[0]?.strokes?.map((s) => s.id), HEFT_ID);

		assert.ok(strokesA?.includes("stroke-e-a-1"), "Device A should have stroke-e-a-1");
		assert.ok(strokesA?.includes("stroke-e-b-1"), "Device A should have stroke-e-b-1");
		assert.ok(strokesB?.includes("stroke-e-a-1"), "Device B should have stroke-e-a-1");
		assert.ok(strokesB?.includes("stroke-e-b-1"), "Device B should have stroke-e-b-1");
		assert.equal(strokesA?.length, 2);
		assert.equal(strokesB?.length, 2);

		// Reload both and re-verify
		await pageA.reload({ waitUntil: "domcontentloaded" });
		await waitReady(pageA);
		await pageB.reload({ waitUntil: "domcontentloaded" });
		await waitReady(pageB);

		const reloadedStrokesA = await pageA.evaluate((id) => window.S.heftDocs[id]?.pages?.[0]?.strokes?.map((s) => s.id), HEFT_ID);
		const reloadedStrokesB = await pageB.evaluate((id) => window.S.heftDocs[id]?.pages?.[0]?.strokes?.map((s) => s.id), HEFT_ID);
		assert.equal(reloadedStrokesA?.length, 2);
		assert.equal(reloadedStrokesB?.length, 2);
	});

	it("F. Mehrere Heft-Operationen: A 10 Striche, B 10 Striche offline -> Konvergenz auf 20 Striche", async () => {
		const HEFT_ID = "heft-f-multi";

		// A creates heft
		await pageA.evaluate(async (id) => {
			await window.STATE.dispatch("pageCreate", {
				id,
				title: "Heft F",
				kind: "heft",
				workspaceId: "default",
			});
			await window.STATE.dispatch("heftOps", {
				pageId: id,
				ops: [{ t: "pg+", page: { id: "p1", paper: "lined" } }],
			});
			await window.CLOUDFLARE_SYNC.syncNow();
		}, HEFT_ID);
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		// A and B actually go offline
		await goOffline(pageA);
		await goOffline(pageB);

		// Device A offline adds 10 strokes
		await pageA.evaluate(async (id) => {
			const ops = [];
			for (let i = 1; i <= 10; i++) {
				ops.push({ t: "s+", p: "p1", o: { id: `stroke-f-a-${i}`, color: "#111", size: 1, pts: [i * 5, i * 5] } });
			}
			await window.STATE.dispatch("heftOps", { pageId: id, ops });
		}, HEFT_ID);

		// Device B offline adds 10 strokes
		await pageB.evaluate(async (id) => {
			const ops = [];
			for (let i = 1; i <= 10; i++) {
				ops.push({ t: "s+", p: "p1", o: { id: `stroke-f-b-${i}`, color: "#222", size: 2, pts: [i * 10, i * 10] } });
			}
			await window.STATE.dispatch("heftOps", { pageId: id, ops });
		}, HEFT_ID);

		// Wait 150ms to ensure scheduled timer fires while offline
		await new Promise((r) => setTimeout(r, 150));

		// Check before going online: A has 10 strokes, B has 10 strokes
		const preStrokesA = await pageA.evaluate((id) => window.S.heftDocs[id]?.pages?.[0]?.strokes?.length, HEFT_ID);
		const preStrokesB = await pageB.evaluate((id) => window.S.heftDocs[id]?.pages?.[0]?.strokes?.length, HEFT_ID);
		assert.equal(preStrokesA, 10);
		assert.equal(preStrokesB, 10);

		// Both online & sync
		await goOnline(pageA);
		await goOnline(pageB);

		await pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });
		await pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		const strokesA = await pageA.evaluate((id) => window.S.heftDocs[id]?.pages?.[0]?.strokes?.length, HEFT_ID);
		const strokesB = await pageB.evaluate((id) => window.S.heftDocs[id]?.pages?.[0]?.strokes?.length, HEFT_ID);

		assert.equal(strokesA, 20);
		assert.equal(strokesB, 20);

		// Reload both and re-verify persistence
		await pageA.reload({ waitUntil: "domcontentloaded" });
		await waitReady(pageA);
		await pageB.reload({ waitUntil: "domcontentloaded" });
		await waitReady(pageB);

		const reloadedStrokesA = await pageA.evaluate((id) => window.S.heftDocs[id]?.pages?.[0]?.strokes?.length, HEFT_ID);
		const reloadedStrokesB = await pageB.evaluate((id) => window.S.heftDocs[id]?.pages?.[0]?.strokes?.length, HEFT_ID);
		assert.equal(reloadedStrokesA, 20);
		assert.equal(reloadedStrokesB, 20);
	});

	it("G. Datei / Bild: A hängt Bild an -> B empfängt Bild byte-genau -> Nach Reload vorhanden", async () => {
		const BLOB_ID = "img:test-image-g-1";
		const IMG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

		// A puts blob in IndexedDB and references it in a note
		await pageA.evaluate(async (blobId, b64) => {
			const buf = window.U.b64ToBuf(b64);
			await window.DB.putBlob(blobId, buf, { mime: "image/png", name: "pixel.png", size: buf.byteLength });
			await window.STATE.dispatch("pageCreate", {
				id: "note-with-image-g",
				title: "Notiz mit Bild G",
				content: `Hier ist ein Bild: ![Pixel](${blobId})`,
				workspaceId: "default",
			});
			await window.CLOUDFLARE_SYNC.syncNow();
		}, BLOB_ID, IMG_B64);

		// B syncs
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		// Check blob on B
		const blobOnB = await pageB.evaluate(async (blobId) => {
			const rec = await window.DB.getBlob(blobId);
			if (!rec) return null;
			return {
				mime: rec.meta?.mime,
				name: rec.meta?.name,
				size: rec.buf ? rec.buf.byteLength : 0,
				b64: window.U.bufToB64(rec.buf),
			};
		}, BLOB_ID);

		assert.ok(blobOnB, "Blob should exist in Device B IndexedDB");
		assert.equal(blobOnB.mime, "image/png");
		assert.equal(blobOnB.b64, IMG_B64);

		// Reload B and re-verify
		await pageB.reload({ waitUntil: "domcontentloaded" });
		await waitReady(pageB);

		const reloadedBlobB = await pageB.evaluate(async (blobId) => {
			const rec = await window.DB.getBlob(blobId);
			return rec ? window.U.bufToB64(rec.buf) : null;
		}, BLOB_ID);
		assert.equal(reloadedBlobB, IMG_B64);
	});

	it("H. PDF: A speichert PDF-Blob -> B erhält PDF unbeschädigt -> Nach Reload vorhanden", async () => {
		const PDF_BLOB_ID = "file:test-doc-h-pdf";
		const PDF_DATA = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";
		const PDF_B64 = Buffer.from(PDF_DATA, "utf-8").toString("base64");

		// A puts PDF blob in IndexedDB and references it
		await pageA.evaluate(async (blobId, b64) => {
			const buf = window.U.b64ToBuf(b64);
			await window.DB.putBlob(blobId, buf, { mime: "application/pdf", name: "doc.pdf", size: buf.byteLength });
			await window.STATE.dispatch("pageCreate", {
				id: "note-with-pdf-h",
				title: "Notiz mit PDF H",
				content: `Dokument: [PDF Dokument](${blobId})`,
				workspaceId: "default",
			});
			await window.CLOUDFLARE_SYNC.syncNow();
		}, PDF_BLOB_ID, PDF_B64);

		// B syncs
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		const pdfOnB = await pageB.evaluate(async (blobId) => {
			const rec = await window.DB.getBlob(blobId);
			if (!rec) return null;
			return {
				mime: rec.meta?.mime,
				name: rec.meta?.name,
				text: new TextDecoder().decode(rec.buf),
			};
		}, PDF_BLOB_ID);

		assert.ok(pdfOnB, "PDF Blob should exist on Device B");
		assert.equal(pdfOnB.mime, "application/pdf");
		assert.equal(pdfOnB.text, PDF_DATA);
	});

	it("I. HTTP-Response verloren: Server speichert Event, Response wird abgebrochen -> Neuer Event -> Beide vorhanden ohne Duplikate", async () => {
		const ID1 = `note-lost-i-1-${Date.now()}`;
		const ID2 = `note-lost-i-2-${Date.now()}`;

		// Create new note on A
		await pageA.evaluate(async (id1) => {
			await window.STATE.dispatch("pageCreate", {
				id: id1,
				title: "Lost Response I-1",
				content: "Erste Notiz vor Verbindungsabbruch",
				workspaceId: "default",
			});
		}, ID1);

		// Enable request interception on page A to let POST reach server but abort response in browser
		await pageA.setRequestInterception(true);
		const interceptHandler = async (req) => {
			if (req.url().includes("/api/events") && req.method() === "POST") {
				try {
					await fetch(req.url(), {
						method: "POST",
						headers: req.headers(),
						body: req.postData(),
					});
				} catch {}
				req.abort("failed");
			} else {
				req.continue();
			}
		};
		pageA.on("request", interceptHandler);

		// Trigger sync on A (will fail client-side because of aborted response)
		const syncFailed = await pageA.evaluate(async () => {
			try {
				await window.CLOUDFLARE_SYNC.syncNow();
				return false;
			} catch {
				return true;
			}
		});
		assert.equal(syncFailed, true);

		// Remove interception and filter out only the expected abort error from this test
		pageA.off("request", interceptHandler);
		await pageA.setRequestInterception(false);
		consoleErrors.A = consoleErrors.A.filter((msg) => !(msg.includes("/api/events") && (msg.includes("ERR_FAILED") || msg.includes("Failed to load resource"))));

		// A creates second event
		await pageA.evaluate(async (id2) => {
			await window.STATE.dispatch("pageCreate", {
				id: id2,
				title: "Lost Response I-2",
				content: "Zweite Notiz nach Wiederherstellung",
				workspaceId: "default",
			});
		}, ID2);

		// A syncs normally
		await pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		// B syncs
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		// Check both notes on B
		const note1OnB = await pageB.evaluate((id1) => window.S.pages[id1]?.title, ID1);
		const note2OnB = await pageB.evaluate((id2) => window.S.pages[id2]?.title, ID2);
		assert.equal(note1OnB, "Lost Response I-1");
		assert.equal(note2OnB, "Lost Response I-2");

		// Check that no duplicate events exist in A or B
		const eventCountA = await pageA.evaluate(async (id1) => (await window.DB.allEvents()).filter((e) => e.type === "pageCreate" && e.payload?.id === id1).length, ID1);
		const eventCountB = await pageB.evaluate(async (id1) => (await window.DB.allEvents()).filter((e) => e.type === "pageCreate" && e.payload?.id === id1).length, ID1);
		assert.equal(eventCountA, 1);
		assert.equal(eventCountB, 1);
	});

	it("J. Pull unterbrechen: Server hat mehrere Pakete -> Pull bricht ab -> Erneuter Sync stellt lückenlosen Zustand her", async () => {
		// Device B creates 3 separate notes and pushes them
		await pageB.evaluate(async () => {
			await window.STATE.dispatch("pageCreate", { id: "note-pull-j-1", title: "Pull J 1", content: "P1", workspaceId: "default" });
			await window.CLOUDFLARE_SYNC.syncNow();
			await window.STATE.dispatch("pageCreate", { id: "note-pull-j-2", title: "Pull J 2", content: "P2", workspaceId: "default" });
			await window.CLOUDFLARE_SYNC.syncNow();
			await window.STATE.dispatch("pageCreate", { id: "note-pull-j-3", title: "Pull J 3", content: "P3", workspaceId: "default" });
			await window.CLOUDFLARE_SYNC.syncNow();
		});

		// On A, intercept /api/sync and abort
		await pageA.setRequestInterception(true);
		let abortedOnce = false;
		const pullHandler = (req) => {
			if (req.url().includes("/api/sync") && !abortedOnce) {
				abortedOnce = true;
				req.abort("failed");
			} else {
				req.continue();
			}
		};
		pageA.on("request", pullHandler);

		const pullFailed = await pageA.evaluate(async () => {
			try {
				await window.CLOUDFLARE_SYNC.syncNow();
				return false;
			} catch {
				return true;
			}
		});
		assert.equal(pullFailed, true);

		pageA.off("request", pullHandler);
		await pageA.setRequestInterception(false);
		consoleErrors.A = consoleErrors.A.filter((msg) => !(msg.includes("/api/sync") && (msg.includes("ERR_FAILED") || msg.includes("Failed to load resource"))));

		// Now sync cleanly
		await pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		const pagesOnA = await pageA.evaluate(() => ({
			p1: !!window.S.pages["note-pull-j-1"],
			p2: !!window.S.pages["note-pull-j-2"],
			p3: !!window.S.pages["note-pull-j-3"],
		}));
		assert.deepEqual(pagesOnA, { p1: true, p2: true, p3: true });
	});

	it("K. Browser-Neustart: Browser-Seiten schließen & neu öffnen -> IndexedDB-Zustand rekonstruiert -> Sync intakt", async () => {
		// Close pages A and B
		await pageA.close();
		await pageB.close();

		// Reopen fresh pages in the same browser contexts (re-opens IndexedDB from context storage)
		pageA = await setupPageInContext(ctxA, "A");
		pageB = await setupPageInContext(ctxB, "B");

		// Verify state reconstruction
		const countA = await pageA.evaluate(() => Object.keys(window.S.pages).length);
		const countB = await pageB.evaluate(() => Object.keys(window.S.pages).length);
		assert.ok(countA >= 5, "Pages should be reconstructed on Device A");
		assert.equal(countA, countB, "Device A and Device B page count should match after restart");

		// Test that sync still works after restart
		await pageA.evaluate(async () => {
			await window.STATE.dispatch("pageCreate", { id: "note-k-restart", title: "Post Restart", content: "Alive", workspaceId: "default" });
			await window.CLOUDFLARE_SYNC.syncNow();
		});
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		const postRestartOnB = await pageB.evaluate(() => window.S.pages["note-k-restart"]?.title);
		assert.equal(postRestartOnB, "Post Restart");
	});

	it("L. Service-Worker Update / Cache: SW aktiv, Cache = impala67-v222, sync-crypto.js enthält 16-KB-Kompression", async () => {
		const swStatus = await pageA.evaluate(async () => {
			const reg = await navigator.serviceWorker?.getRegistration();
			const cacheNames = await caches.keys();
			const cacheName = cacheNames.find((n) => n.startsWith("impala67-v"));
			let cryptoCode = "";
			if (cacheName) {
				const cache = await caches.open(cacheName);
				const reqs = await cache.keys();
				const cryptoReq = reqs.find((r) => r.url.includes("sync-crypto.js"));
				if (cryptoReq) {
					const res = await cache.match(cryptoReq);
					cryptoCode = await res.text();
				}
			}
			return {
				hasSW: !!navigator.serviceWorker,
				isActive: reg?.active?.state === "activated",
				cacheNames,
				hasV222: cacheNames.includes("impala67-v222"),
				hasLegacyV219: cacheNames.includes("impala67-v219"),
				has16KBCompression: cryptoCode.includes("16 * 1024") || cryptoCode.includes("16384"),
			};
		});

		assert.equal(swStatus.hasSW, true, "Service Worker should be available");
		assert.equal(swStatus.hasV222, true, "Cache impala67-v222 should exist");
		assert.equal(swStatus.hasLegacyV219, false, "No legacy v219 cache should be present");
		assert.equal(swStatus.has16KBCompression, true, "sync-crypto.js in cache must contain 16 KB compression threshold");
	});

	it("M. Offline-PWA: Offline schalten -> Reload -> App lädt & speichert -> Online -> Sync", async () => {
		// Set offline mode
		await goOffline(pageA);

		// Reload offline
		await pageA.reload({ waitUntil: "domcontentloaded" });
		await pageA.waitForFunction(() => window.BOOT && window.STATE && window.DB && window.__IMPALA_PERF__?.totalBootMs);

		// Check app booted and data available
		const hasPages = await pageA.evaluate(() => Object.keys(window.S.pages).length > 0);
		assert.equal(hasPages, true, "App should start offline and retain pages");

		// Create note offline
		await pageA.evaluate(async () => {
			await window.STATE.dispatch("pageCreate", {
				id: "note-m-offline",
				title: "PWA Offline Notiz M",
				content: "Erstellt ohne Internetverbindung",
				workspaceId: "default",
			});
		});

		// Go online
		await goOnline(pageA);
		await pageA.reload({ waitUntil: "domcontentloaded" });
		await waitReady(pageA);

		// Sync A and B
		await pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		const syncedToB = await pageB.evaluate(() => window.S.pages["note-m-offline"]?.title);
		assert.equal(syncedToB, "PWA Offline Notiz M");
	});

	it("N. Sync-Burst: 100 schnelle Änderungen auf Device A -> Keine Browserfehler -> Endzustand auf B konsistent", async () => {
		const burstErrors = await pageA.evaluate(async () => {
			const errors = [];
			for (let i = 0; i < 100; i++) {
				try {
					await window.STATE.dispatch("pageCreate", {
						id: `burst-note-${i}`,
						title: `Burst Note ${i}`,
						content: `Inhalt der Burst-Notiz Nummer ${i}`,
						workspaceId: "default",
					});
				} catch (err) {
					errors.push(err.message || String(err));
				}
			}
			await window.CLOUDFLARE_SYNC.syncNow();
			return errors;
		});

		assert.equal(burstErrors.length, 0, "Burst creation on A should have no errors");

		// Device B syncs
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		// Verify on B
		const burstCountB = await pageB.evaluate(() => Object.keys(window.S.pages).filter((k) => k.startsWith("burst-note-")).length);
		assert.equal(burstCountB, 100, "Device B should have all 100 burst notes");
	});

	it("O. 3 Geräte (A, B, C): Jeder erstellt 10 Notizen offline -> Nacheinander online -> Alle besitzen identische 30 Notizen", async () => {
		ctxC = await browser.createBrowserContext();
		pageC = await setupPageInContext(ctxC, "C");

		await pageC.evaluate(async (url, key) => {
			await window.STATE.dispatch("settingsSet", { cfUrl: url, cfSyncKey: key });
			return window.CLOUDFLARE_SYNC.configure(url, key);
		}, WORKER_URL, TEST_SYNC_KEY);

		// Sync C once to get current baseline
		await pageC.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		// All 3 devices actually go offline
		await goOffline(pageA);
		await goOffline(pageB);
		await goOffline(pageC);

		// Device A creates 10 notes offline
		await pageA.evaluate(async () => {
			for (let i = 1; i <= 10; i++) {
				await window.STATE.dispatch("pageCreate", { id: `dev-a-note-${i}`, title: `Device A Note ${i}`, content: `A ${i}`, workspaceId: "default" });
			}
		});

		// Device B creates 10 notes offline
		await pageB.evaluate(async () => {
			for (let i = 1; i <= 10; i++) {
				await window.STATE.dispatch("pageCreate", { id: `dev-b-note-${i}`, title: `Device B Note ${i}`, content: `B ${i}`, workspaceId: "default" });
			}
		});

		// Device C creates 10 notes offline
		await pageC.evaluate(async () => {
			for (let i = 1; i <= 10; i++) {
				await window.STATE.dispatch("pageCreate", { id: `dev-c-note-${i}`, title: `Device C Note ${i}`, content: `C ${i}`, workspaceId: "default" });
			}
		});

		// Wait 150ms to ensure scheduled timers fire while offline
		await new Promise((r) => setTimeout(r, 150));

		// Check before going online that no other device knows them
		for (let i = 1; i <= 10; i++) {
			const hasBOnA = await pageA.evaluate((id) => !!window.S.pages[id], `dev-b-note-${i}`);
			const hasCOnA = await pageA.evaluate((id) => !!window.S.pages[id], `dev-c-note-${i}`);
			const hasAOnB = await pageB.evaluate((id) => !!window.S.pages[id], `dev-a-note-${i}`);
			const hasCOnB = await pageB.evaluate((id) => !!window.S.pages[id], `dev-c-note-${i}`);
			const hasAOnC = await pageC.evaluate((id) => !!window.S.pages[id], `dev-a-note-${i}`);
			const hasBOnC = await pageC.evaluate((id) => !!window.S.pages[id], `dev-b-note-${i}`);

			assert.equal(hasBOnA, false, "Device A must not know B notes while offline");
			assert.equal(hasCOnA, false, "Device A must not know C notes while offline");
			assert.equal(hasAOnB, false, "Device B must not know A notes while offline");
			assert.equal(hasCOnB, false, "Device B must not know C notes while offline");
			assert.equal(hasAOnC, false, "Device C must not know A notes while offline");
			assert.equal(hasBOnC, false, "Device C must not know B notes while offline");
		}

		// Turn online and sync one by one
		await goOnline(pageA);
		await pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		await goOnline(pageB);
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		await goOnline(pageC);
		await pageC.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		// Settle remaining sync rounds
		await pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });
		await pageC.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		await pageA.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });
		await pageB.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });
		await pageC.evaluate(async () => { await window.CLOUDFLARE_SYNC.syncNow(); });

		const pagesA = await pageA.evaluate(() => window.S.pages);
		const pagesB = await pageB.evaluate(() => window.S.pages);
		const pagesC = await pageC.evaluate(() => window.S.pages);

		for (let i = 1; i <= 10; i++) {
			assert.ok(pagesA[`dev-a-note-${i}`], `Device A should have dev-a-note-${i}`);
			assert.ok(pagesA[`dev-b-note-${i}`], `Device A should have dev-b-note-${i}`);
			assert.ok(pagesA[`dev-c-note-${i}`], `Device A should have dev-c-note-${i}`);

			assert.ok(pagesB[`dev-a-note-${i}`], `Device B should have dev-a-note-${i}`);
			assert.ok(pagesB[`dev-b-note-${i}`], `Device B should have dev-b-note-${i}`);
			assert.ok(pagesB[`dev-c-note-${i}`], `Device B should have dev-c-note-${i}`);

			assert.ok(pagesC[`dev-a-note-${i}`], `Device C should have dev-a-note-${i}`);
			assert.ok(pagesC[`dev-b-note-${i}`], `Device C should have dev-b-note-${i}`);
			assert.ok(pagesC[`dev-c-note-${i}`], `Device C should have dev-c-note-${i}`);
		}

		// Verify monitoring stats across all devices
		const metricsA = await pageA.evaluate(async () => ({
			lastSyncedSeq: window.CLOUDFLARE_SYNC.status().lastSyncedSeq,
			lastUploadedLocalSeq: window.CLOUDFLARE_SYNC.status().lastUploadedLocalSeq,
			totalEvents: (await window.DB.allEvents()).length,
		}));
		const metricsB = await pageB.evaluate(async () => ({
			lastSyncedSeq: window.CLOUDFLARE_SYNC.status().lastSyncedSeq,
			lastUploadedLocalSeq: window.CLOUDFLARE_SYNC.status().lastUploadedLocalSeq,
			totalEvents: (await window.DB.allEvents()).length,
		}));
		const metricsC = await pageC.evaluate(async () => ({
			lastSyncedSeq: window.CLOUDFLARE_SYNC.status().lastSyncedSeq,
			lastUploadedLocalSeq: window.CLOUDFLARE_SYNC.status().lastUploadedLocalSeq,
			totalEvents: (await window.DB.allEvents()).length,
		}));

		assert.equal(metricsA.lastSyncedSeq, metricsB.lastSyncedSeq);
		assert.equal(metricsB.lastSyncedSeq, metricsC.lastSyncedSeq);
		assert.ok(metricsA.lastSyncedSeq > 0, "lastSyncedSeq must be greater than 0");
	});

	it("P. Abschlussprüfung: Keine unerwarteten Browser-Konsolenfehler oder unbehandelten Rejections", () => {
		assert.deepEqual(consoleErrors.A, [], "Device A should have no console errors");
		assert.deepEqual(consoleErrors.B, [], "Device B should have no console errors");
		if (ctxC) assert.deepEqual(consoleErrors.C, [], "Device C should have no console errors");

		assert.deepEqual(unhandledRejections.A, [], "Device A should have no unhandled rejections");
		assert.deepEqual(unhandledRejections.B, [], "Device B should have no unhandled rejections");
		if (ctxC) assert.deepEqual(unhandledRejections.C, [], "Device C should have no unhandled rejections");
	});
});
