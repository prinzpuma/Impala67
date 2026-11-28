// Start-Benchmark der PWA mit realistisch großem Event-Log (eigenes Chrome-Profil, keine Nutzerdaten).
//   node tools/bench-start.mjs [--runs 5] [--events 67000] [--out datei.json] [--compare vorher.json]
// Legt beim ersten Lauf ein Log an (kleine Events + große Bild-Events wie im echten Bestand),
// lässt die App einen Checkpoint schreiben und misst danach jeden Kaltstart in einem neuen
// Browser-Prozess. Ausgabe: Median/Min/Max je Profiler-Messpunkt (ms).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
try {
	await prepare();
	const runs = [];
	for (let i = 0; i < RUNS; i++) { const r = await measureOnce(); runs.push(r); console.log(`Lauf ${i + 1}:`, JSON.stringify(r)); }
	const summary = Object.fromEntries(POINTS.map((p) => { const v = runs.map((r) => r[p]).filter((x) => x != null); return [p, { median: median(v), min: Math.min(...v), max: Math.max(...v) }]; }).filter(([, v]) => v.median != null));
	const result = { at: new Date().toISOString(), events: EVENTS, runs: RUNS, summary };
	if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
	const before = COMPARE ? JSON.parse(fs.readFileSync(COMPARE, "utf8")).summary : null;
	console.log("\nMesspunkt                 Median   (min–max)" + (before ? "   vorher   Änderung" : ""));
	for (const [p, v] of Object.entries(summary)) {
		const b = before?.[p]?.median;
		const diff = b != null ? `   ${String(b).padStart(6)}   ${((v.median - b) / b * 100).toFixed(0).padStart(5)} %` : "";
		console.log(`${p.padEnd(24)} ${String(v.median).padStart(7)}   (${v.min}–${v.max})${diff}`);
	}
} finally { server.kill(); }
