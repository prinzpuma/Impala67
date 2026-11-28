// Start-Benchmark der PWA mit realistisch großem Event-Log (eigenes Chrome-Profil, keine Nutzerdaten).
//   node tools/bench-start.mjs [--runs 5] [--events 67000] [--out datei.json] [--compare vorher.json]
//   node tools/bench-start.mjs --sync [--runs 5]   (Sync mit Upload gegen lokalen Wrangler-Server)
// Legt beim ersten Lauf ein Log an (kleine Events + große Bild-Events wie im echten Bestand),
// lässt die App einen Checkpoint schreiben und misst danach jeden Kaltstart in einem neuen
// Browser-Prozess. Ausgabe: Median/Min/Max je Profiler-Messpunkt (ms).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : def; };
const RUNS = Number(arg("runs", 5));
const EVENTS = Number(arg("events", 67000));
const OUT = arg("out", "");
const COMPARE = arg("compare", "");
const PORT = Number(arg("port", 8019));
const PROFILE = arg("profile", path.join(os.tmpdir(), `impala67-bench-${EVENTS}`));
const URL = `http://127.0.0.1:${PORT}/index.html`;
const CHROME = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
	.find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("Chrome nicht gefunden (CHROME_BIN setzen).");

// Messpunkte, die verglichen werden (Name im Profiler → Anzeige).
const POINTS = ["boot-ready", "db.open", "state.load", "state.event-info", "state.checkpoint-read", "state.checkpoint-tail", "state.core-load", "ui.render",
	"heft.mount", "heft.load", "heft.hydrate-images", "state.checkpoint-heft-read", "heft.fetch", "heft.mount-view", "heft-ready"];

const SYNC = process.argv.includes("--sync");
const server = spawn(process.execPath, [path.join(ROOT, "tools/serve.mjs"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 400));

const launch = () => puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: PROFILE, args: ["--no-first-run", "--window-size=1400,900"] });

// Seitenkontext: Log direkt in IndexedDB schreiben (gleiches Schema wie db.js).
async function seed(page, total) {
	return page.evaluate(async (total) => {
		const db = await new Promise((res, rej) => {
			const r = indexedDB.open("impala67", 2);
			r.onupgradeneeded = () => {
				const d = r.result;
				if (!d.objectStoreNames.contains("events")) d.createObjectStore("events", { keyPath: "seq", autoIncrement: true });
				for (const s of ["blobs", "vecs"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
			};
			r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
		});
		// Zufallstext, damit LevelDB ihn nicht wegkomprimiert.
		const noise = (n) => { const a = new Uint8Array(Math.ceil(n * 0.75)); for (let o = 0; o < a.length; o += 65536) crypto.getRandomValues(a.subarray(o, o + 65536)); let s = ""; for (const b of a) s += String.fromCharCode(b); return btoa(s).slice(0, n); };
		const big = noise(200_000), small = noise(4000);
		const base = Date.parse("2026-01-01T00:00:00Z");
		let n = 0;
		const ev = (type, payload) => ({ id: crypto.randomUUID(), t: new Date(base + n++ * 1000).toISOString(), type, payload });
		for (let done = 0; done < total;) {
			await new Promise((res, rej) => {
				const t = db.transaction("events", "readwrite"), s = t.objectStore("events");
				for (let i = 0; i < 1000 && done < total; i++, done++) {
					if (done % 200 === 0) s.put(ev("pageCreate", { id: "bench-" + done, title: "Bench " + done, content: "# Bench\n\n" + small.slice(0, 3000), workspaceId: "default" }));
					else if (done % 130 === 0) s.put(ev("teleEvent", { pad: big.slice(done % 1000) })); // ohne kind: vom Modell ignoriert
					else s.put(ev("teleEvent", { pad: small.slice(0, 600 + (done % 1400)) }));
				}
				t.oncomplete = res; t.onerror = () => rej(t.error);
			});
		}
		db.close();
		return total;
	}, total);
}

async function waitBoot(page) {
	await page.waitForFunction(() => performance.getEntriesByName("impala67:boot-ready").length > 0, { timeout: 180_000 });
}

async function prepare() {
	if (fs.existsSync(path.join(PROFILE, ".bench-ready"))) return;
	fs.rmSync(PROFILE, { recursive: true, force: true });
	const browser = await launch();
	const page = await browser.newPage();
	await page.goto(URL + "?bench-seed", { waitUntil: "domcontentloaded" });
	await page.evaluate(() => { localStorage.setItem("impala67PerformanceProfiler", "1"); localStorage.setItem("impala67PerformanceProfilerMode", "all"); });
	await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("impala67"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
	console.log(`Lege ${EVENTS} Events an …`);
	await seed(page, EVENTS);
	await page.goto(URL, { waitUntil: "domcontentloaded" });
	await waitBoot(page);
	console.log("Lege Heft mit 3 Hintergrundbildern an und öffne es …");
	await page.evaluate(async () => {
		// Wie ein importiertes Arbeitsblatt: 3 Seiten mit je einem JPEG (~300–600 KB) als Vorlage.
		const id = "bench-heft";
		await window.STATE.dispatch("pageCreate", { id, title: "Bench-Heft", parentId: null, content: "", tags: [], workspaceId: "default", kind: "heft" });
		const files = [];
		for (let i = 0; i < 3; i++) {
			const c = new OffscreenCanvas(1240, 1754), g = c.getContext("2d");
			const img = g.createImageData(1240, 1754);
			for (let k = 0; k < img.data.length; k += 4) { const v = 200 + ((k * 7 + i * 13) % 55) + (Math.random() * 30 | 0); img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255; }
			g.putImageData(img, 0, 0);
			files.push(new File([await c.convertToBlob({ type: "image/jpeg", quality: 0.8 })], "blatt" + i + ".jpg", { type: "image/jpeg" }));
		}
		const { HEFT } = await import("./heft.js");
		await HEFT.importFiles(id, files, "end");
		window.TABS.openPage(id);
		await new Promise((r) => setTimeout(r, 2000));
	});
	console.log("Schreibe Checkpoint …");
	await page.evaluate(() => window.STATE.checkpointNow());
	await browser.close();
	fs.writeFileSync(path.join(PROFILE, ".bench-ready"), new Date().toISOString());
}

async function measureOnce() {
	const browser = await launch();
	try {
		const page = await browser.newPage();
		await page.goto(URL, { waitUntil: "domcontentloaded" });
		await waitBoot(page);
		await new Promise((r) => setTimeout(r, 1500));
		return await page.evaluate((points) => {
			const marks = performance.getEntriesByName("impala67:boot-ready");
			const out = { "boot-ready": Math.round(marks[0].startTime) };
			let report = window.PERF_PROFILER.report();
			if (typeof report === "string") report = JSON.parse(report);
			const since = Date.now() - performance.now();
			for (const r of report.records || []) {
				if (Date.parse(r.at) < since || !points.includes(r.name)) continue;
				if (out[r.name] != null) continue; // erste Messung = Start
				out[r.name] = Math.round(r.durationMs);
				if (r.name === "heft.mount") out["heft-ready"] = Math.round(Date.parse(r.at) - since); // Heft fertig ab Navigation
			}
			return out;
		}, POINTS);
	} finally { await browser.close(); }
}

// ---- Sync mit Upload ------------------------------------------------------------------------
const SYNC_POINTS = ["sync-total", "longtask-max", "longtask-sum", "cloudflare.sync", "cloudflare.import", "db.compact-local"];
const WRANGLER_JS = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const WORKER_PORT = Number(arg("worker-port", 8797));
const SYNC_STATE = path.join(ROOT, ".wrangler", "bench-state");
let wrangler = null;
function stopWrangler() {
	if (!wrangler || wrangler.exitCode !== null) return;
	try { if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(wrangler.pid), "/T", "/F"], { stdio: "ignore" }); else process.kill(-wrangler.pid, "SIGTERM"); }
	catch { try { wrangler.kill("SIGTERM"); } catch { /* schon beendet */ } }
}
async function startWrangler() {
	fs.rmSync(SYNC_STATE, { recursive: true, force: true });
	execFileSync(process.execPath, [WRANGLER_JS, "d1", "execute", "impala67-db", "--local", "--persist-to", SYNC_STATE, "--config", "server/wrangler.toml", "--file", "server/schema.sql"], { cwd: ROOT, stdio: "pipe" });
	wrangler = spawn(process.execPath, [WRANGLER_JS, "dev", "server/worker.js", "--config", "server/wrangler.toml", "--persist-to", SYNC_STATE, "--port", String(WORKER_PORT), "--ip", "127.0.0.1"],
		{ cwd: ROOT, detached: process.platform !== "win32", stdio: "ignore" });
	for (let i = 0; i < 120; i++) {
		try { if ((await fetch(`http://127.0.0.1:${WORKER_PORT}/api/health`)).ok) return; } catch { /* startet noch */ }
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error("Wrangler startet nicht");
}
// CPU-Profil (CDP) nach Eigenzeit je Funktion zusammenfassen: zeigt, WO der lange Task rechnet.
function topFunctions(profile, n = 12) {
	const self = new Map(), byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
	const dt = profile.timeDeltas;
	profile.samples.forEach((id, i) => {
		const f = byId.get(id).callFrame;
		const key = `${f.functionName || "(anonym)"} ${(f.url || "").split("/").pop()}:${f.lineNumber + 1}`;
		self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
	});
	return [...self].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, ms]) => `${ms.toFixed(0).padStart(5)} ms  ${k}`);
}
async function measureSync() {
	await startWrangler();
	const profile = PROFILE + "-sync";
	fs.rmSync(profile, { recursive: true, force: true });
	fs.cpSync(PROFILE, profile, { recursive: true });
	const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, args: ["--no-first-run", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
	const runs = [];
	try {
		const page = await browser.newPage();
		await page.goto(URL, { waitUntil: "domcontentloaded" });
		await waitBoot(page);
		const key = await page.evaluate(() => window.CLOUDFLARE_SYNC.generateSyncKey());
		console.log("Erst-Upload zum lokalen Server …");
		const t0 = Date.now();
		await page.evaluate(async (url, key) => {
			await window.STATE.dispatch("settingsSet", { cfUrl: url, cfSyncKey: key });
			if (!(await window.CLOUDFLARE_SYNC.configure(url, key))) throw new Error("Sync nicht eingerichtet");
			await window.CLOUDFLARE_SYNC.syncNow();
		}, `http://127.0.0.1:${WORKER_PORT}`, key);
		console.log(`Erst-Upload: ${Date.now() - t0} ms`);
		await new Promise((r) => setTimeout(r, 3000));
		const cdp = await page.createCDPSession();
		await cdp.send("Profiler.enable");
		await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
		let lastProfile = null;
		for (let i = 0; i < RUNS; i++) {
			await cdp.send("Profiler.start");
			const r = await page.evaluate(async (i) => {
				const tasks = [];
				const obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => tasks.push(e.duration)));
				obs.observe({ type: "longtask", buffered: false });
				const since = Date.now();
				// Kleine Änderung wie beim Tippen: eine Seite bearbeiten, dann synchronisieren.
				await window.STATE.dispatch("pageUpdate", { id: "bench-0", patch: { content: "# Bench\n\nÄnderung " + i + " " + Date.now() } });
				const t = performance.now();
				await window.CLOUDFLARE_SYNC.syncNow();
				const total = performance.now() - t;
				await new Promise((res) => setTimeout(res, 300));
				obs.disconnect();
				let report = window.PERF_PROFILER.report();
				if (typeof report === "string") report = JSON.parse(report);
				const out = { "sync-total": Math.round(total), "longtask-max": Math.round(Math.max(0, ...tasks)), "longtask-sum": Math.round(tasks.reduce((a, b) => a + b, 0)) };
				for (const rec of report.records || []) {
					if (Date.parse(rec.at) < since || !rec.name || out[rec.name] != null) continue;
					out[rec.name] = Math.round(rec.durationMs);
				}
				return out;
			}, i);
			lastProfile = (await cdp.send("Profiler.stop")).profile;
			runs.push(r);
			console.log(`Lauf ${i + 1}:`, JSON.stringify(r));
		}
		console.log("\nCPU (letzter Lauf, Eigenzeit):\n" + topFunctions(lastProfile).join("\n"));
	} finally { await browser.close(); }
	// Kaltstart MIT eingerichtetem Sync: Was rechnet in den ersten 10 s (erster Sync, Aufräumen, …)?
	for (let i = 0; i < 2; i++) {
		const b2 = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, args: ["--no-first-run", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
		try {
			const page = await b2.newPage();
			await page.evaluateOnNewDocument(() => {
				window.__benchTasks = [];
				new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__benchTasks.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: "longtask", buffered: true });
			});
			const cdp = await page.createCDPSession();
			await cdp.send("Profiler.enable");
			await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
			await cdp.send("Profiler.start");
			await page.goto(URL, { waitUntil: "domcontentloaded" });
			await waitBoot(page);
			await new Promise((r) => setTimeout(r, 10_000));
			const { profile: prof } = await cdp.send("Profiler.stop");
			const info = await page.evaluate(() => {
				let report = window.PERF_PROFILER.report();
				if (typeof report === "string") report = JSON.parse(report);
				const since = Date.now() - performance.now();
				const ops = (report.records || []).filter((r) => Date.parse(r.at) >= since && r.kind === "operation" && r.durationMs >= 30)
					.map((r) => `${r.name} ${Math.round(r.durationMs)} ms`);
				return { boot: Math.round(performance.getEntriesByName("impala67:boot-ready")[0].startTime), tasks: window.__benchTasks, ops };
			});
			console.log(`\nKaltstart mit Sync ${i + 1}: boot ${info.boot} ms, Long Tasks [Start, Dauer]: ${JSON.stringify(info.tasks.filter((t) => t[1] >= 100))}`);
			console.log("Langsame Operationen: " + info.ops.join(", "));
			console.log("CPU nach Eigenzeit:\n" + topFunctions(prof, 15).join("\n"));
		} finally { await b2.close(); }
	}
	return runs;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
try {
	await prepare();
	const runs = SYNC ? await measureSync() : [];
	if (!SYNC) for (let i = 0; i < RUNS; i++) { const r = await measureOnce(); runs.push(r); console.log(`Lauf ${i + 1}:`, JSON.stringify(r)); }
	const points = SYNC ? SYNC_POINTS : POINTS;
	const summary = Object.fromEntries(points.map((p) => { const v = runs.map((r) => r[p]).filter((x) => x != null); return [p, { median: median(v), min: Math.min(...v), max: Math.max(...v) }]; }).filter(([, v]) => v.median != null));
	const result = { at: new Date().toISOString(), events: EVENTS, runs: RUNS, summary };
	if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
	const before = COMPARE ? JSON.parse(fs.readFileSync(COMPARE, "utf8")).summary : null;
	console.log("\nMesspunkt                 Median   (min–max)" + (before ? "   vorher   Änderung" : ""));
	for (const [p, v] of Object.entries(summary)) {
		const b = before?.[p]?.median;
		const diff = b != null ? `   ${String(b).padStart(6)}   ${((v.median - b) / b * 100).toFixed(0).padStart(5)} %` : "";
		console.log(`${p.padEnd(24)} ${String(v.median).padStart(7)}   (${v.min}–${v.max})${diff}`);
	}
} finally { server.kill(); stopWrangler(); }
