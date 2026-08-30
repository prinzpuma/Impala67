import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

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
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
};

export async function createTestHarness(options = {}) {
	const webDir = path.join(process.cwd(), "web");
	let server = null;
	let serverUrl = "";

	// Start static server on random port
	await new Promise((resolve, reject) => {
		server = http.createServer((req, res) => {
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
		server.listen(0, "127.0.0.1", () => {
			const port = server.address().port;
			serverUrl = `http://127.0.0.1:${port}/`;
			resolve();
		});
		server.on("error", reject);
	});

	const browser = await puppeteer.launch({
		executablePath: "/usr/bin/google-chrome",
		headless: "new",
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-gpu",
			"--disable-dev-shm-usage",
			"--window-size=1280,900"
		]
	});

	const context = await browser.createBrowserContext();
	const page = await context.newPage();
	await page.setViewport({ width: 1280, height: 900 });

	const consoleErrors = [];
	const pageErrors = [];

	page.on("console", (msg) => {
		if (msg.type() === "error") {
			const txt = msg.text();
			const loc = msg.location();
			const url = loc?.url || "";
			// Ignore benign network check to localhost:1234
			if (url.includes("localhost:1234") || txt.includes("localhost:1234") || txt.includes("ERR_CONNECTION_REFUSED")) {
				return;
			}
			consoleErrors.push({ text: txt, url, location: loc });
		}
	});

	page.on("pageerror", (err) => {
		pageErrors.push(err.message || String(err));
	});

	// Navigate and initialize
	await page.goto(serverUrl, { waitUntil: "networkidle0" });
	await page.waitForFunction(() => typeof window.STATE !== "undefined" && typeof window.EDITOR !== "undefined");

	// Helpers
	async function createPage({ title = "Test Page", content = "", kind = "note" } = {}) {
		const pid = await page.evaluate(async ({ title, content, kind }) => {
			const id = "test_" + Math.random().toString(36).slice(2, 10);
			await window.STATE.dispatch("pageCreate", {
				id,
				title,
				content,
				kind,
				workspaceId: "default"
			});
			window.openPage(id);
			return id;
		}, { title, content, kind });

		await page.waitForFunction(() => document.querySelector("#blockEditor") !== null);
		await new Promise((r) => setTimeout(r, 100));
		return pid;
	}

	async function getBlocks() {
		return await page.evaluate(() => {
			const editorEl = document.querySelector("#blockEditor");
			if (!editorEl) return [];
			const blkEls = Array.from(editorEl.querySelectorAll(":scope > .blk, :scope > .blk-columns .blk-column > .blk"));
			return blkEls.map((el) => {
				const id = el.dataset.blk;
				const type = el.dataset.btype;
				const textEl = el.querySelector("[data-btext], [data-bcode], [data-bsummary]");
				const text = textEl ? textEl.textContent : "";
				const html = textEl ? textEl.innerHTML : "";
				return { id, type, text, html };
			});
		});
	}

	async function getSerialized() {
		return await page.evaluate(() => window.EDITOR.serialize());
	}

	async function getEditorDomTree() {
		return await page.evaluate(() => {
			const ed = document.querySelector("#blockEditor");
			if (!ed) return null;
			function summarize(el) {
				return {
					tag: el.tagName.toLowerCase(),
					className: el.className,
					dataset: { ...el.dataset },
					text: el.children.length === 0 ? el.textContent : undefined,
					children: Array.from(el.children).map(summarize)
				};
			}
			return summarize(ed);
		});
	}

	async function waitAutosave(ms = 600) {
		await new Promise((r) => setTimeout(r, ms));
	}

	async function cleanup() {
		try { await page.close(); } catch {}
		try { await context.close(); } catch {}
		try { await browser.close(); } catch {}
		try { server.close(); } catch {}
	}

	return {
		server,
		serverUrl,
		browser,
		context,
		page,
		consoleErrors,
		pageErrors,
		createPage,
		getBlocks,
		getSerialized,
		getEditorDomTree,
		waitAutosave,
		cleanup
	};
}
