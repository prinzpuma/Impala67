// DB.eventLogInfo() und DB.knownIds() im echten Chrome: Der Zähler (EVENT_LOG_COUNT_KEY) muss nach jedem
// Schreib- und Löschpfad genau dem vollen IndexedDB-count() entsprechen – er entscheidet, ob der
// Start-Checkpoint gilt. Der id-Schnappschuss (EVENT_KNOWN_IDS_KEY) muss nach einem Neustart alle ids
// kennen und mit jedem Löschpfad verschwinden.
//   node --test test/db-loginfo.e2e.mjs   (braucht Chrome; CHROME_BIN setzt den Pfad)
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const PORT = 8023;
const CHROME = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
	.find((p) => p && fs.existsSync(p));
let server, browser, page;

// Neu laden = frischer Modulzustand wie nach einem App-Neustart (gleiche Datenbank).
async function openPage() {
	await page.goto(`http://127.0.0.1:${PORT}/version.json`); // gleiche Herkunft, ohne die App zu starten
	await page.evaluate(async () => {
		const { DB } = await import("/db.js");
		const { compactEventStore } = await import("/compact-events.js");
		await DB.open();
		let n = 0;
		const ev = (type, payload) => ({ id: crypto.randomUUID(), t: new Date(Date.parse("2026-01-01T00:00:00Z") + n++ * 1000).toISOString(), type, payload });
		// Voller count() direkt aus IndexedDB als Vergleich.
		const raw = () => new Promise((res) => {
			const r = indexedDB.open("impala67");
			r.onsuccess = () => { const q = r.result.transaction("events").objectStore("events").count(); q.onsuccess = () => { r.result.close(); res(q.result); }; };
		});
		const mark = () => DB.getBlob("__impala67_state_checkpoint_logcount__");
		const idsMark = () => DB.getBlob("__impala67_state_checkpoint_knownids__");
		const compact = () => new Promise((res) => {
			const r = indexedDB.open("impala67");
			r.onsuccess = async () => { const out = await compactEventStore(r.result, 1); r.result.close(); res(out); };
		});
		const add = async (list) => { for (const e of list) await DB.addEvent(e); };
		Object.assign(window, { DB, ev, raw, mark, idsMark, compact, add });
	});
}

before(async () => {
	server = spawn(process.execPath, ["tools/serve.mjs", String(PORT)], { stdio: "ignore" });
	await new Promise((r) => setTimeout(r, 400));
	browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "impala67-dbtest-")) });
	page = await browser.newPage();
	await openPage();
});
after(async () => { await browser?.close(); server?.kill(); });

const check = (label) => page.evaluate(async () => {
	const info = await DB.eventLogInfo();
	return { info, raw: await raw(), mark: await mark() };
}).then((r) => { assert.equal(r.info.count, r.raw, `${label}: Zähler ${r.info.count} ≠ count() ${r.raw}`); return r; });

test("leerer Log", async () => {
	const r = await check("leer");
	assert.equal(r.info.count, 0);
	assert.equal(r.info.maxSeq, 0);
});

test("Hinzufügen schreibt den Zähler fort", async () => {
	await page.evaluate(() => add(Array.from({ length: 50 }, (_, i) => ev("teleEvent", { kind: "t", data: { i } }))));
	const r1 = await check("50 Events");
	assert.deepEqual({ count: r1.mark.count, maxSeq: r1.mark.maxSeq }, { count: 50, maxSeq: r1.info.maxSeq });
	await page.evaluate(() => add([ev("teleEvent", { kind: "t" }), ev("teleEvent", { kind: "t" })]));
	const r2 = await check("52 Events");
	assert.equal(r2.info.count, 52);
	assert.ok(r2.info.lastEventId, "lastEventId fehlt");
});

test("replaceHeftHistory löscht Events und baut den Zähler neu", async () => {
	await page.evaluate(() => add(Array.from({ length: 20 }, () => ev("heftOps", { pageId: "h1", ops: [] }))));
	await check("vor replaceHeftHistory");
	await page.evaluate(async () => {
		const info = await DB.eventLogInfo();
		await DB.replaceHeftHistory([ev("heftOps", { pageId: "h1", ops: [] })], info.maxSeq);
	});
	const r = await check("nach replaceHeftHistory");
	assert.equal(r.info.count, 52 + 1);
});

test("Kompaktierung (auch aus dem Worker) entfernt den Zähler in derselben Transaktion", async () => {
	await page.evaluate(() => add(Array.from({ length: 30 }, (_, i) => ev("uiTabsSet", { tabs: ["p" + i], active: "p" + i }))));
	await check("vor Kompaktierung");
	const out = await page.evaluate(() => compact());
	assert.ok(out.dropped > 0, "Testdaten müssen kompaktierbar sein");
	assert.equal(await page.evaluate(() => mark()), undefined, "Zähler muss nach dem Löschen weg sein");
	await check("nach Kompaktierung");
});

test("clearPages", async () => {
	await page.evaluate(() => add([ev("pageCreate", { id: "p1", title: "A", content: "", workspaceId: "default" })]));
	await check("vor clearPages");
	await page.evaluate(() => DB.clearPages());
	await check("nach clearPages");
});

test("Zähler über maxSeq (verlorene Events) wird verworfen", async () => {
	await page.evaluate(() => new Promise((res) => {
		const r = indexedDB.open("impala67");
		r.onsuccess = () => { const t = r.result.transaction("blobs", "readwrite"); t.objectStore("blobs").put({ count: 999, maxSeq: 1e9 }, "__impala67_state_checkpoint_logcount__"); t.oncomplete = () => { r.result.close(); res(); }; };
	}));
	await check("kaputter Zähler");
});

test("Zähler bleibt lokal: kein Export", async () => {
	const keys = await page.evaluate(async () => Object.keys(JSON.parse(await DB.exportAll()).blobs));
	assert.ok(!keys.includes("__impala67_state_checkpoint_logcount__"));
});

test("knownIds: Schnappschuss überlebt den Neustart, danach nur das Delta", async () => {
	const first = await page.evaluate(async () => {
		const evs = Array.from({ length: 5 }, () => ev("teleEvent", { kind: "t" }));
		await add(evs);
		return evs.map((e) => e.id);
	});
	assert.deepEqual(await page.evaluate((ids) => DB.knownIds([...ids, "fehlt"]), first), first);
	await new Promise((r) => setTimeout(r, 200)); // Speichern läuft im Hintergrund
	const snap = await page.evaluate(() => idsMark());
	assert.ok(snap && snap.ids.length > 0, "Schnappschuss fehlt");
	const info = await page.evaluate(() => DB.eventLogInfo());
	assert.equal(snap.maxSeq, info.maxSeq);
	await openPage(); // „Neustart“: leerer Modulzustand
	const later = await page.evaluate(async () => { const e = ev("teleEvent", { kind: "t" }); await add([e]); return e.id; });
	await openPage();
	assert.deepEqual(await page.evaluate((ids) => DB.knownIds(ids), [...first, later, "fehlt"]), [...first, later]);
});

test("knownIds: Kompaktierung und Seiten-Reset entfernen den Schnappschuss", async () => {
	await page.evaluate(() => DB.knownIds(["x"]));
	await new Promise((r) => setTimeout(r, 200));
	await page.evaluate(() => add(Array.from({ length: 10 }, (_, i) => ev("uiTabsSet", { tabs: ["q" + i], active: "q" + i }))));
	await openPage();
	await page.evaluate(() => DB.knownIds(["x"]));
	await new Promise((r) => setTimeout(r, 200));
	assert.ok(await page.evaluate(() => idsMark()), "Schnappschuss vor der Kompaktierung");
	assert.ok((await page.evaluate(() => compact())).dropped > 0);
	assert.equal(await page.evaluate(() => idsMark()), undefined, "Kompaktierung muss ihn entfernen");
	await openPage(); // wie nach compactLocal(): ids im Speicher verworfen
	const pageEv = await page.evaluate(async () => {
		const e = ev("pageCreate", { id: "p2", title: "B", content: "", workspaceId: "default" });
		await add([e]); await DB.knownIds(["x"]); return e.id;
	});
	await new Promise((r) => setTimeout(r, 200));
	assert.ok(await page.evaluate(() => idsMark()), "nach vollem Lesen neu gespeichert");
	await page.evaluate(() => DB.clearPages());
	assert.equal(await page.evaluate(() => idsMark()), undefined, "Seiten-Reset muss ihn entfernen");
	await openPage();
	assert.deepEqual(await page.evaluate((id) => DB.knownIds([id]), pageEv), [], "gelöschtes Seiten-Event darf nicht mehr bekannt sein");
});

test("knownIds-Schnappschuss bleibt lokal: kein Export", async () => {
	await page.evaluate(() => DB.knownIds(["x"]));
	await new Promise((r) => setTimeout(r, 200));
	const keys = await page.evaluate(async () => Object.keys(JSON.parse(await DB.exportAll()).blobs));
	assert.ok(!keys.includes("__impala67_state_checkpoint_knownids__"));
});
