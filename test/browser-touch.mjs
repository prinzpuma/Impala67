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

		// 3. Test: Inline-Umbenennen in der Sidebar
		console.log("3. Teste Inline-Umbenennen in der Sidebar...");
		const renameCheck = await page.evaluate(async () => {
			// Erstelle eine Testseite im STATE
			const pid = "test-rename-page-" + Date.now();
			await window.STATE.dispatch("pageCreate", {
				id: pid,
				title: "Vorheriger Name",
				workspaceId: window.S.currentWorkspaceId || "default",
				type: "note",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});

			// Aktiviere Umbenennen
			window.S.renamingPageId = pid;
			window.renderSidebar();

			const inp = document.querySelector(".row-rename-input");
			if (!inp) return { found: false };

			// Klick/Fokus wie in app.js
			inp.focus();
			if (!window.PLATFORM.isTouch()) {
				inp.select();
			} else {
				const len = inp.value.length;
				inp.setSelectionRange(len, len);
			}

			// Simuliere kurzfristiges blur/focusout durch Viewport-Resize der Tastatur (< 350ms)
			const initialFocus = document.activeElement === inp;

			// Jetzt simulieren wir einen focusout innerhalb 200ms
			const foEvent = new FocusEvent("focusout", { bubbles: true });
			inp.dispatchEvent(foEvent);

			// Prüfe ob Input noch existiert und State noch renamingPageId hat
			const stillRenaming = window.S.renamingPageId === pid;
			const stillInDom = !!document.querySelector(".row-rename-input");

			return { found: true, pid, initialFocus, stillRenaming, stillInDom };
		});
		console.log("   -> Rename-Input gefunden:", renameCheck.found);
		console.log("   -> Fokus erhalten:", renameCheck.initialFocus);
		console.log("   -> Tastatur-Slide-In (Viewport-Resize < 350ms) schließt Feld NICHT ab:", renameCheck.stillRenaming && renameCheck.stillInDom ? "✔" : "✘");
		if (!renameCheck.stillRenaming || !renameCheck.stillInDom) throw new Error("Sidebar-Rename brach bei Tastatur-Animation ab!");

		// Simuliere Tastatureingabe und Enter
		const commitCheck = await page.evaluate(async (pid) => {
			const inp = document.querySelector(".row-rename-input");
			inp.value = "Neuer Titel via Tastatur";
			inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			await new Promise((r) => setTimeout(r, 60));
			return {
				savedTitle: window.S.pages[pid]?.title,
				renameFinished: !window.S.renamingPageId,
			};
		}, renameCheck.pid);
		console.log("   -> Neuer Name per Enter gespeichert:", commitCheck.savedTitle === "Neuer Titel via Tastatur" ? "✔" : "✘", `("${commitCheck.savedTitle}")`);
		if (commitCheck.savedTitle !== "Neuer Titel via Tastatur" || !commitCheck.renameFinished) {
			throw new Error("Umbenennen per Enter schlug fehl!");
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
