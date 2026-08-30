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

const STATIC_PORT = 5299;
const SCREENSHOT_DIR = path.resolve("/home/jv232/Documents/Codex/2026-08-22/ka/Impala67/.agents/worker_visual_m3/screenshots");

function startStaticServer() {
	return new Promise((resolve, reject) => {
		const webDir = path.resolve(process.cwd(), "web");
		const server = http.createServer((req, res) => {
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
				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("Not Found: " + urlPath);
				return;
			}
			const ext = path.extname(filePath).toLowerCase();
			const mime = MIME_MAP[ext] || "application/octet-stream";
			res.writeHead(200, {
				"Content-Type": mime,
				"Service-Worker-Allowed": "/",
				"Cache-Control": "no-cache, no-store, must-revalidate",
				"Access-Control-Allow-Origin": "*",
			});
			fs.createReadStream(filePath).pipe(res);
		});
		server.listen(STATIC_PORT, "127.0.0.1", () => {
			console.log(`Static server running on http://127.0.0.1:${STATIC_PORT}/`);
			resolve(server);
		});
		server.on("error", reject);
	});
}

async function main() {
	fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
	const server = await startStaticServer();
	const browser = await puppeteer.launch({
		executablePath: "/usr/bin/google-chrome",
		headless: "new",
		args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
	});

	try {
		const page = await browser.newPage();
		await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
		await page.goto(`http://127.0.0.1:${STATIC_PORT}/`, { waitUntil: "networkidle0" });

		// Wait for app to boot
		await page.waitForFunction(() => typeof window.STATE !== "undefined" && typeof window.openPage === "function");

		console.log("App loaded successfully in headless Chrome.");

		// Create Rich Note
		const richPageId = "page-rich-test";
		await page.evaluate(async (pid) => {
			const richMd = `# 🚀 Comprehensive Editor Feature Document

Impala67 combines local-first **Notion-like block editing** with *integrated KaTeX math*, ~~strikethrough notes~~, <u>underlined definitions</u>, \`inline code execution\`, and ==high-contrast color highlights==.

## 📑 Hierarchical Lists & Checklists
- Core System Capabilities
  - Local-first IndexedDB storage with differential replication
  - Real-time morphing DOM reconciliation (\`U.morph\`)
  - Zero external bundler dependencies (native ES modules)
- Interactive Task List
  - [x] Implement AST block parser and serializer
  - [x] Dual-layer canvas drawing engine with bounding box culling
  - [ ] Dynamic handwriting OCR indexing pipeline

1. First step: Initialize workspace database
2. Second step: Mount block editor on active page
3. Third step: Synchronize local changes to remote storage

### 💬 Quotes & Code Snippets
> "Local-first software gives users agency, ownership, and resilience against network failures while preserving high-speed interactions."

\`\`\`javascript
// Native ES module block transformer
export function transformBlock(block, targetType) {
  if (block.type === targetType) return block;
  return { ...block, type: targetType, updatedAt: Date.now() };
}
\`\`\`

---
`;
			await window.STATE.dispatch("pageCreate", {
				id: pid,
				title: "🚀 Rich Editor Features",
				content: richMd,
				workspaceId: "default",
				icon: "🚀",
			});
			window.openPage(pid);
		}, richPageId);

		await new Promise((r) => setTimeout(r, 600));

		// Set light theme
		await page.evaluate(() => {
			window.SETTINGS.handleThemeSelect("light");
		});
		await new Promise((r) => setTimeout(r, 300));
		await page.screenshot({ path: path.join(SCREENSHOT_DIR, "01_editor_rich_desktop_light.png") });
		console.log("Captured 01_editor_rich_desktop_light.png");

		// Set dark theme
		await page.evaluate(() => {
			window.SETTINGS.handleThemeSelect("dark");
		});
		await new Promise((r) => setTimeout(r, 300));
		await page.screenshot({ path: path.join(SCREENSHOT_DIR, "02_editor_rich_desktop_dark.png") });
		console.log("Captured 02_editor_rich_desktop_dark.png");

	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
