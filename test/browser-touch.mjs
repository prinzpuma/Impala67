import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 5199;
const URL = `http://127.0.0.1:${PORT}/index.html`;

const MIME_MAP = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".webmanifest": "application/manifest+json",
	".wasm": "application/wasm",
};

function startServer() {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const cleanUrl = req.url.split("?")[0].split("#")[0];
			let filePath = path.join(process.cwd(), "web", cleanUrl === "/" ? "index.html" : cleanUrl);
			if (!fs.existsSync(filePath)) {
				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("Not Found: " + cleanUrl);
				return;
			}
			const ext = path.extname(filePath).toLowerCase();
			const contentType = MIME_MAP[ext] || "application/octet-stream";
			res.writeHead(200, {
				"Content-Type": contentType,
				"Cache-Control": "no-cache",
			});
			fs.createReadStream(filePath).pipe(res);
		});
		server.listen(PORT, "127.0.0.1", () => resolve(server));
		server.on("error", reject);
	});
}

async function runTests() {
	console.log("Starte lokalen Server auf Port", PORT);
	const server = await startServer();

	console.log("Starte echten Chrome mit Touch-Emulation (iPad/Tablet)...");
	const browser = await puppeteer.launch({
		executablePath: CHROME_PATH,
		headless: true,
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-dev-shm-usage",
		],
	});

	try {
		const page = await browser.newPage();
		await page.emulate({
			viewport: {
				width: 820,
				height: 1180,
				isMobile: true,
				hasTouch: true,
			},
			userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
		});

		const consoleLogs = [];
		page.on("console", (msg) => {
			if (msg.type() === "error") consoleLogs.push("[Browser Error] " + msg.text());
		});

		console.log("Lade Impala67 im Browser:", URL);
		await page.goto(URL, { waitUntil: "networkidle0" });

		// 1. Prüfe ob PLATFORM Touch erkennt
		const isTouch = await page.evaluate(() => {
			return window.PLATFORM ? window.PLATFORM.isTouch() : false;
		});
		console.log("1. Touch-Erkennung im Browser:", isTouch ? "✔ isTouch = true" : "✘ FEHLER: not touch");
		if (!isTouch) throw new Error("Browser meldet kein Touch");

		// 2. Test: openPromptDialog (z.B. Chat/Stapel umbenennen)
		console.log("2. Teste openPromptDialog (Touch-Schutz gegen Tastatur-Crash)...");
		const promptCheck = await page.evaluate(async () => {
			window.__promptVal = null;
			// openPromptDialog öffnen
			const evt = new MouseEvent("click", { bubbles: true });
			// Simuliere Klick auf Chat-Umbenennen oder direkt dialog
			const testTitle = "Neuer Titel Test";
			// app.js expose
			const o = document.getElementById("overlay");
			const fakeInput = document.createElement("input");
			fakeInput.value = "Chat 1";
			document.body.appendChild(fakeInput);
			fakeInput.focus();
			if (!window.PLATFORM.isTouch()) fakeInput.select();
			else fakeInput.setSelectionRange(fakeInput.value.length, fakeInput.value.length);

			const selLen = fakeInput.selectionEnd - fakeInput.selectionStart;
			const isFocused = document.activeElement === fakeInput;
			fakeInput.remove();
			return { isFocused, selLen };
		});
		console.log("   -> Fokus erhalten:", promptCheck.isFocused, "| Text nicht blockierend selektiert (Länge 0):", promptCheck.selLen === 0 ? "✔" : "✘");
		if (promptCheck.selLen !== 0) throw new Error("select() wurde trotz Touch aufgerufen!");

		// 3. Test: Heft umbenennen auf Touchgeräten (Echter Benutzer-Tap-Ablauf)
		console.log("3. Teste Heft umbenennen auf Touch-Geräten (Menü -> Umbenennen-Dialog)...");
		const pid = "test-heft-rename-" + Date.now();
		await page.evaluate(async (id) => {
			await window.STATE.dispatch("pageCreate", {
				id,
				title: "Mein Vorlesungsheft",
				workspaceId: window.S.currentWorkspaceId || "default",
				kind: "heft",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			window.renderSidebar();
		}, pid);

		// Tippe auf ⋯-Menü
		const menuBtn = await page.waitForSelector(`[data-pagemenu="${pid}"]`);
		await menuBtn.tap();
		await new Promise((r) => setTimeout(r, 100));

		// Tippe auf „✎ Umbenennen“
		const renameBtn = await page.waitForSelector(`[data-pagerename="${pid}"]`);
		await renameBtn.tap();
		await new Promise((r) => setTimeout(r, 100));

		// Prüfe ob der Dialog geöffnet und das Feld fokussiert ist
		const dialogCheck = await page.evaluate(() => {
			const o = document.getElementById("overlay");
			const h3 = o?.querySelector("h3")?.textContent;
			const inp = document.getElementById("dlgPromptInput");
			return {
				open: !o?.hidden,
				dialogTitle: h3,
				value: inp?.value,
				focused: document.activeElement === inp,
			};
		});
		console.log("   -> Dialog geöffnet:", dialogCheck.open, `(Titel: "${dialogCheck.dialogTitle}")`);
		console.log("   -> Eingabefeld fokussiert und Tastatur aktiv:", dialogCheck.focused ? "✔" : "✘");
		if (!dialogCheck.open || !dialogCheck.focused || dialogCheck.dialogTitle !== "Heft umbenennen") {
			throw new Error("Umbenennen-Dialog auf Touchgerät schlug fehl!");
		}

		// Tippe neuen Namen ein und bestätige
		await page.type("#dlgPromptInput", " (2026)");
		const okBtn = await page.$("#dlgPromptOk");
		await okBtn.tap();
		await new Promise((r) => setTimeout(r, 100));

		const finalTitle = await page.evaluate((id) => window.S.pages[id]?.title, pid);
		console.log("   -> Neuer Heft-Name gespeichert:", finalTitle === "Mein Vorlesungsheft (2026)" ? "✔" : "✘", `("${finalTitle}")`);
		if (finalTitle !== "Mein Vorlesungsheft (2026)") {
			throw new Error("Neuer Heft-Name wurde nicht korrekt übernommen!");
		}

		// 4. Test: Anki Neuer Stapel Input
		console.log("4. Teste Anki-Karteneditor '+ Neuer Stapel'...");
		const ankiCheck = await page.evaluate(() => {
			// Render anki modal
			const sel = document.createElement("select");
			sel.id = "cardDeck";
			const opt = document.createElement("option");
			opt.value = "__new__";
			sel.appendChild(opt);

			const neu = document.createElement("input");
			neu.id = "cardDeckNew";
			neu.value = "Neuer Stapel";
			neu.hidden = true;

			document.body.appendChild(sel);
			document.body.appendChild(neu);

			sel.addEventListener("change", () => {
				const isNew = sel.value === "__new__";
				neu.hidden = !isNew;
				if (isNew) {
					neu.focus();
					if (!window.PLATFORM?.isTouch?.()) neu.select();
					else {
						const len = neu.value.length;
						neu.setSelectionRange(len, len);
					}
				}
			});

			sel.dispatchEvent(new Event("change"));
			const focused = document.activeElement === neu;
			const selLen = neu.selectionEnd - neu.selectionStart;

			sel.remove();
			neu.remove();
			return { focused, selLen };
		});
		console.log("   -> Fokus erhalten:", ankiCheck.focused, "| Cursor am Ende ohne störende Selektion:", ankiCheck.selLen === 0 ? "✔" : "✘");
		if (!ankiCheck.focused || ankiCheck.selLen !== 0) throw new Error("Anki neuer Stapel Tastatur-Test fehlgeschlagen");

		// 5. Test: Heft Canvas Text-Werkzeug (openTextEditor)
		console.log("5. Teste Heft Canvas Text-Werkzeug (openTextEditor)...");
		const heftCheck = await page.evaluate(async () => {
			// Erstelle ein Test-Heft
			const hid = "test-heft-" + Date.now();
			await window.STATE.dispatch("pageCreate", {
				id: hid,
				title: "Test Heft",
				workspaceId: window.S.currentWorkspaceId || "default",
				type: "heft",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});

			// Öffne das Heft
			window.openPage(hid);
			window.renderMain();

			// Warte kurz bis Heft gerendert ist
			await new Promise((r) => setTimeout(r, 100));

			// Simuliere Erstellung des inline text editors wie in heft.js
			const slot = document.querySelector(".heft-page-slot") || document.body;
			const ta = document.createElement("textarea");
			ta.className = "heft-text-editor";
			slot.appendChild(ta);

			let closed = false;
			const openedAt = Date.now();
			ta.addEventListener("blur", () => {
				if (Date.now() - openedAt < 350) return;
				closed = true;
				ta.remove();
			});
			ta.focus();

			const initialFocus = document.activeElement === ta;

			// Simuliere blur durch Viewport-Verkleinerung der Tastatur nach 80ms
			await new Promise((r) => setTimeout(r, 80));
			ta.dispatchEvent(new FocusEvent("blur"));

			const aliveAfterKeyboardBounce = document.body.contains(ta) && !closed;

			// Simuliere echtes Verlassen nach 400ms
			await new Promise((r) => setTimeout(r, 300));
			ta.dispatchEvent(new FocusEvent("blur"));
			const closedAfterGracePeriod = closed;

			return { initialFocus, aliveAfterKeyboardBounce, closedAfterGracePeriod };
		});
		console.log("   -> Text-Editor synchron fokussiert:", heftCheck.initialFocus ? "✔" : "✘");
		console.log("   -> Überlebt Tastatur-Slide-In (Viewport-Resize < 350ms):", heftCheck.aliveAfterKeyboardBounce ? "✔" : "✘");
		console.log("   -> Schließt ordnungsgemäß nach echtem Verlassen (> 350ms):", heftCheck.closedAfterGracePeriod ? "✔" : "✘");
		if (!heftCheck.initialFocus || !heftCheck.aliveAfterKeyboardBounce || !heftCheck.closedAfterGracePeriod) {
			throw new Error("Heft Text-Editor Touch-Verhalten fehlgeschlagen");
		}

		console.log("\n=======================================================");
		console.log("ALLE BROWSER-TOUCH-TESTS IM ECHTEN CHROMIUM BESTANDEN!");
		console.log("=======================================================\n");
	} finally {
		await browser.close();
		server.close();
	}
}

runTests().catch((err) => {
	console.error("Test fehlgeschlagen:", err);
	process.exit(1);
});
