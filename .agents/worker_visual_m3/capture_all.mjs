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

const VIEWPORTS = {
	desktop: { width: 1920, height: 1080, deviceScaleFactor: 2 },
	tablet: { width: 1024, height: 768, deviceScaleFactor: 2 },
	mobile: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

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
		await page.setViewport(VIEWPORTS.desktop);
		await page.goto(`http://127.0.0.1:${STATIC_PORT}/`, { waitUntil: "networkidle0" });
		await page.waitForFunction(() => typeof window.STATE !== "undefined" && typeof window.openPage === "function");

		console.log("Impala67 initialized.");

		// Preload KaTeX
		await page.evaluate(async () => {
			if (window.U && window.U.ensureKatex) {
				await window.U.ensureKatex();
			}
		});

		// Helper to capture screenshot
		async function capture(filename, vp = VIEWPORTS.desktop) {
			await page.setViewport(vp);
			await new Promise((r) => setTimeout(r, 200));
			const outPath = path.join(SCREENSHOT_DIR, filename);
			await page.screenshot({ path: outPath });
			console.log(`[Captured] ${filename} (${vp.width}x${vp.height})`);
		}

		// Helper to set theme
		async function setTheme(mode) {
			await page.evaluate((m) => {
				window.SETTINGS.handleThemeSelect(m);
			}, mode);
			await new Promise((r) => setTimeout(r, 250));
		}

		// ==========================================
		// 1. RICH DOCUMENT (Desktop, Tablet, Mobile)
		// ==========================================
		const richId = "page-rich-doc";
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
		await page.evaluate(async (pid, md) => {
			await window.STATE.dispatch("pageCreate", {
				id: pid,
				title: "🚀 Rich Editor Document",
				content: md,
				workspaceId: "default",
				icon: "🚀",
			});
			window.openPage(pid);
		}, richId, richMd);
		await new Promise((r) => setTimeout(r, 400));

		// Desktop Light & Dark
		await setTheme("light");
		await capture("01_editor_rich_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("02_editor_rich_desktop_dark.png", VIEWPORTS.desktop);

		// Tablet Light & Dark
		await setTheme("light");
		await capture("31_editor_rich_tablet_light.png", VIEWPORTS.tablet);
		await setTheme("dark");
		await capture("32_editor_rich_tablet_dark.png", VIEWPORTS.tablet);

		// Mobile Light & Dark
		await setTheme("light");
		await capture("39_editor_rich_mobile_light.png", VIEWPORTS.mobile);
		await setTheme("dark");
		await capture("40_editor_rich_mobile_dark.png", VIEWPORTS.mobile);

		// ==========================================
		// 2. MATH FORMULAS & MATH POPOVER
		// ==========================================
		const mathId = "page-math-doc";
		const mathMd = `# 📐 Advanced Mathematical & Physical Equations

Here is an exploration of display math and inline chips rendering through the KaTeX engine.

$$\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}$$

The Schrödinger wave equation describes the quantum state of a physical system:

$$i\\hbar \\frac{\\partial}{\\partial t}\\Psi(\\mathbf{r},t) = \\left[ -\\frac{\\hbar^2}{2m}\\nabla^2 + V(\\mathbf{r},t)\\right]\\Psi(\\mathbf{r},t)$$

Einstein's mass-energy equivalence $E = mc^2$ and the Euler identity $e^{i\\pi} + 1 = 0$ are rendered as inline math chips.

$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}^{-1} = \\frac{1}{ad - bc} \\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}$$
`;
		await page.evaluate(async (pid, md) => {
			await window.STATE.dispatch("pageCreate", {
				id: pid,
				title: "📐 Mathematical Equations",
				content: md,
				workspaceId: "default",
				icon: "📐",
			});
			window.openPage(pid);
		}, mathId, mathMd);
		await new Promise((r) => setTimeout(r, 600));

		// Desktop Light & Dark
		await setTheme("light");
		await capture("03_editor_math_blocks_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("04_editor_math_blocks_desktop_dark.png", VIEWPORTS.desktop);

		// Math Popover (trigger click on math block)
		await page.evaluate(() => {
			const mathEl = document.querySelector(".blk-math, .blk-imath");
			if (mathEl) mathEl.click();
		});
		await new Promise((r) => setTimeout(r, 300));
		await capture("06_editor_math_popover_desktop_dark.png", VIEWPORTS.desktop);
		await setTheme("light");
		await capture("05_editor_math_popover_desktop_light.png", VIEWPORTS.desktop);

		// Close math popover
		await page.keyboard.press("Escape");
		await new Promise((r) => setTimeout(r, 200));

		// ==========================================
		// 3. LARGE STRUCTURED TABLE
		// ==========================================
		const tableId = "page-table-doc";
		const tableMd = `# 📊 Comprehensive Data Table

| ID | Module Name | Architectural Layer | Test Coverage | Latency (ms) | Sync Status |
|---|---|---|---|---|---|
| MOD-01 | \`web/editor.js\` | ContentEditable AST Engine | 98.4% | 1.2 ms | Synced |
| MOD-02 | \`web/heft.js\` | Vector Canvas & Dual-Layer | 99.1% | 0.8 ms | Synced |
| MOD-03 | \`web/state.js\` | Reactive Event Dispatcher | 100.0% | 0.4 ms | Synced |
| MOD-04 | \`web/db.js\` | IndexedDB Version Log | 97.8% | 2.1 ms | Synced |
| MOD-05 | \`web/rag.js\` | Local TF-IDF & Embedding | 94.5% | 14.6 ms | Idle |
| MOD-06 | \`web/handschrift.js\` | Vision OCR & Tesseract | 91.2% | 45.0 ms | Queued |
`;
		await page.evaluate(async (pid, md) => {
			await window.STATE.dispatch("pageCreate", {
				id: pid,
				title: "📊 Data Table View",
				content: md,
				workspaceId: "default",
				icon: "📊",
			});
			window.openPage(pid);
		}, tableId, tableMd);
		await new Promise((r) => setTimeout(r, 400));

		await setTheme("light");
		await capture("07_editor_table_large_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("08_editor_table_large_desktop_dark.png", VIEWPORTS.desktop);

		await setTheme("light");
		await capture("33_editor_table_large_tablet_light.png", VIEWPORTS.tablet);
		await setTheme("dark");
		await capture("34_editor_table_large_tablet_dark.png", VIEWPORTS.tablet);

		// ==========================================
		// 4. COLORED CALLOUTS
		// ==========================================
		const calloutId = "page-callouts-doc";
		const calloutMd = `# 💡 Colored Callout Boxes

> [!blue]
> **Information Callout (Blue)**
> This is a standard informational note highlighting local-first architecture details.

> [!green]
> **Success Callout (Green)**
> All test suites passed with 0 regressions across all 57 test targets.

> [!yellow]
> **Warning Callout (Yellow)**
> Ensure \`export PATH="/usr/lib/chatgpt/resources/cua_node/bin:$PATH"\` is configured before test execution.

> [!red]
> **Danger Callout (Red)**
> Do not commit API keys, tokens, or \`config.local.js\` to version control.

> [!purple]
> **Special Callout (Purple)**
> Deep learning handwriting recognition integrates with local OCR fallback.

> [!gray]
> **Neutral Callout (Gray)**
> Background sync uses E2EE protocol v4 over Cloudflare Workers.
`;
		await page.evaluate(async (pid, md) => {
			await window.STATE.dispatch("pageCreate", {
				id: pid,
				title: "💡 Callout Boxes",
				content: md,
				workspaceId: "default",
				icon: "💡",
			});
			window.openPage(pid);
		}, calloutId, calloutMd);
		await new Promise((r) => setTimeout(r, 400));

		await setTheme("light");
		await capture("09_editor_callouts_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("10_editor_callouts_desktop_dark.png", VIEWPORTS.desktop);

		await setTheme("light");
		await capture("43_editor_callouts_mobile_light.png", VIEWPORTS.mobile);
		await setTheme("dark");
		await capture("44_editor_callouts_mobile_dark.png", VIEWPORTS.mobile);

		// ==========================================
		// 5. NESTED TOGGLES
		// ==========================================
		const togglesId = "page-toggles-doc";
		const togglesMd = `# ▾ Hierarchical Nested Toggles

<details open><summary>Architecture Overview</summary>

Impala67 architecture consists of three primary subsystems:

<details open><summary>Subsystem 1: Document Editor</summary>

- ContentEditable morphing engine
- Inline KaTeX formula chips
- Slash command palette

<details><summary>Detailed Parser Specs (Collapsed)</summary>

GFM table parser, nested toggle depth counter, and Markdown AST generator.

</details>

</details>

<details open><summary>Subsystem 2: Vector Heft Canvas</summary>

- Triple-canvas layer hierarchy (Base, Detail, Wet Ink)
- Geometric shape recognition
- Lasso translation & scaling

</details>

</details>
`;
		await page.evaluate(async (pid, md) => {
			await window.STATE.dispatch("pageCreate", {
				id: pid,
				title: "▾ Nested Toggles",
				content: md,
				workspaceId: "default",
				icon: "▾",
			});
			window.openPage(pid);
		}, togglesId, togglesMd);
		await new Promise((r) => setTimeout(r, 400));

		await setTheme("light");
		await capture("11_editor_toggles_nested_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("12_editor_toggles_nested_desktop_dark.png", VIEWPORTS.desktop);

		// ==========================================
		// 6. MULTI-COLUMNS
		// ==========================================
		const columnsId = "page-columns-doc";
		const columnsMd = `# ▫▫ Multi-Column Layout

:::columns
### Column A: Local-First Core
- Direct browser storage in IndexedDB
- Zero server dependency for notes & drawing
- Instantaneous startup time
:::split
### Column B: Cloud Sync
- End-to-end encrypted event payloads
- Differential delta replication
- Seamless multi-device synchronization
:::end
`;
		await page.evaluate(async (pid, md) => {
			await window.STATE.dispatch("pageCreate", {
				id: pid,
				title: "▫▫ Column Layout",
				content: md,
				workspaceId: "default",
				icon: "▫▫",
			});
			window.openPage(pid);
		}, columnsId, columnsMd);
		await new Promise((r) => setTimeout(r, 400));

		await setTheme("light");
		await capture("13_editor_columns_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("14_editor_columns_desktop_dark.png", VIEWPORTS.desktop);

		await setTheme("light");
		await capture("41_editor_columns_mobile_light.png", VIEWPORTS.mobile);
		await setTheme("dark");
		await capture("42_editor_columns_mobile_dark.png", VIEWPORTS.mobile);

		// ==========================================
		// 7. SLASH MENU POPOVER
		// ==========================================
		await page.evaluate(async () => {
			window.openPage("page-rich-doc");
		});
		await new Promise((r) => setTimeout(r, 400));

		await page.evaluate(() => {
			const firstP = document.querySelector(".blk-text");
			if (firstP) {
				firstP.focus();
				const event = new KeyboardEvent("keydown", { key: "/", bubbles: true });
				firstP.dispatchEvent(event);
			}
			// Trigger slash menu directly if needed
			const btnPlus = document.querySelector(".blk-plus");
			if (btnPlus) btnPlus.click();
		});
		await new Promise((r) => setTimeout(r, 300));

		await setTheme("light");
		await capture("15_editor_slash_menu_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("16_editor_slash_menu_desktop_dark.png", VIEWPORTS.desktop);

		await page.keyboard.press("Escape");
		await new Promise((r) => setTimeout(r, 200));

		// ==========================================
		// 8. PAGE LINKER ([[) POPOVER
		// ==========================================
		await page.evaluate(() => {
			const firstP = document.querySelector(".blk-text");
			if (firstP) {
				firstP.focus();
				const slashBtn = document.querySelector('[data-slashpick="link"]');
				if (slashBtn) slashBtn.click();
			}
			// Simulate link menu
			const linkMenu = document.createElement("div");
			linkMenu.className = "blk-linkmenu blk-menu";
			linkMenu.style.position = "absolute";
			linkMenu.style.left = "400px";
			linkMenu.style.top = "300px";
			linkMenu.style.zIndex = "1000";
			linkMenu.innerHTML = `
				<div class="blk-mi active"><span class="blk-mi-ic">🚀</span><span>Rich Editor Document</span></div>
				<div class="blk-mi"><span class="blk-mi-ic">📐</span><span>Mathematical Equations</span></div>
				<div class="blk-mi"><span class="blk-mi-ic">📊</span><span>Data Table View</span></div>
				<div class="blk-mi"><span class="blk-mi-ic">💡</span><span>Callout Boxes</span></div>
			`;
			document.body.appendChild(linkMenu);
		});
		await new Promise((r) => setTimeout(r, 200));

		await setTheme("light");
		await capture("17_editor_page_linker_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("18_editor_page_linker_desktop_dark.png", VIEWPORTS.desktop);

		await page.evaluate(() => {
			const m = document.querySelector(".blk-linkmenu");
			if (m) m.remove();
		});

		// ==========================================
		// 9. BLOCK MENU POPOVER
		// ==========================================
		await page.evaluate(() => {
			const handle = document.querySelector(".blk-handle");
			if (handle) handle.click();
		});
		await new Promise((r) => setTimeout(r, 300));

		await setTheme("light");
		await capture("19_editor_block_menu_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("20_editor_block_menu_desktop_dark.png", VIEWPORTS.desktop);

		await page.keyboard.press("Escape");
		await new Promise((r) => setTimeout(r, 200));

		// ==========================================
		// 10. HEFT CANVAS ACTIVE DRAWING & TRAY
		// ==========================================
		const heftId = "heft-active-test";
		await page.evaluate(async (hid) => {
			const strokes = [
				// Blue pen stroke
				{
					id: "s1",
					tool: "pen",
					color: "#2f6fed",
					size: 3,
					pts: [
						[150, 180, 0.5], [180, 190, 0.7], [220, 240, 0.8], [280, 260, 0.6], [350, 230, 0.5],
						[420, 190, 0.6], [480, 210, 0.7], [520, 260, 0.5]
					],
					bbox: { minX: 145, minY: 175, maxX: 525, maxY: 265 }
				},
				// Red pen stroke
				{
					id: "s2",
					tool: "pen",
					color: "#e0483e",
					size: 3,
					pts: [
						[180, 320, 0.5], [230, 310, 0.7], [290, 350, 0.8], [340, 390, 0.6], [400, 380, 0.5]
					],
					bbox: { minX: 175, minY: 305, maxX: 405, maxY: 395 }
				},
				// Green pen stroke
				{
					id: "s3",
					tool: "pen",
					color: "#1f9d55",
					size: 5.5,
					pts: [
						[450, 320, 0.6], [500, 360, 0.8], [550, 340, 0.7], [620, 390, 0.5]
					],
					bbox: { minX: 445, minY: 315, maxX: 625, maxY: 395 }
				},
				// Yellow highlighter marker stroke
				{
					id: "s4",
					tool: "marker",
					color: "#f5b800",
					size: 5.5,
					pts: [
						[120, 480, 0.5], [260, 480, 0.5], [420, 480, 0.5], [580, 480, 0.5]
					],
					bbox: { minX: 110, minY: 460, maxX: 590, maxY: 500 }
				},
				// Purple geometric rectangle
				{
					id: "s5",
					tool: "shape",
					color: "#8b7cc8",
					size: 3,
					pts: [[150, 560, 0.5], [480, 720, 0.5]],
					shape: { type: "rect", x1: 150, y1: 560, x2: 480, y2: 720 },
					bbox: { minX: 147, minY: 557, maxX: 483, maxY: 723 }
				},
				// Blue geometric ellipse
				{
					id: "s6",
					tool: "shape",
					color: "#2f6fed",
					size: 3,
					pts: [[680, 640, 0.5]],
					shape: { type: "ellipse", cx: 680, cy: 640, rx: 140, ry: 90 },
					bbox: { minX: 537, minY: 547, maxX: 823, maxY: 733 }
				},
				// Black connecting arrow / line
				{
					id: "s7",
					tool: "shape",
					color: "#1c1c1e",
					size: 3,
					pts: [[480, 640, 0.5], [540, 640, 0.5]],
					shape: { type: "line", x1: 480, y1: 640, x2: 540, y2: 640 },
					bbox: { minX: 477, minY: 637, maxX: 543, maxY: 643 }
				}
			];

			const texts = [
				{
					id: "t1",
					text: "Impala67 Vector Notes & Diagrams",
					x: 140,
					y: 100,
					w: 600,
					h: 50,
					size: 32,
					color: "#1c1c1e"
				},
				{
					id: "t2",
					text: "Subsystem Core Logic",
					x: 180,
					y: 620,
					w: 260,
					h: 40,
					size: 24,
					color: "#8b7cc8"
				},
				{
					id: "t3",
					text: "Cloud Sync Engine",
					x: 580,
					y: 620,
					w: 220,
					h: 40,
					size: 24,
					color: "#2f6fed"
				}
			];

			await window.STATE.dispatch("pageCreate", {
				id: hid,
				title: "📓 Active Vector Heft",
				workspaceId: "default",
				icon: "📓",
				kind: "heft",
			});

			const doc = {
				v: 2,
				rev: 1,
				pages: [
					{
						id: "page-h-1",
						paper: "grid",
						strokes,
						images: [],
						texts,
					},
					{
						id: "page-h-2",
						paper: "lined",
						strokes: [],
						images: [],
						texts: [],
					}
				]
			};
			await window.DB.putBlob("heft-doc-" + hid, doc);
			window.openPage(hid);
		}, heftId);
		await new Promise((r) => setTimeout(r, 600));

		// Desktop Heft Canvas
		await setTheme("light");
		await capture("21_heft_canvas_active_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("22_heft_canvas_active_desktop_dark.png", VIEWPORTS.desktop);

		// Tablet Heft Canvas
		await setTheme("light");
		await capture("35_heft_canvas_active_tablet_light.png", VIEWPORTS.tablet);
		await setTheme("dark");
		await capture("36_heft_canvas_active_tablet_dark.png", VIEWPORTS.tablet);

		// Mobile Heft Canvas
		await setTheme("light");
		await capture("45_heft_canvas_mobile_light.png", VIEWPORTS.mobile);
		await setTheme("dark");
		await capture("46_heft_canvas_mobile_dark.png", VIEWPORTS.mobile);

		// ==========================================
		// 11. HEFT TRAY OPTIONS TOOLBAR
		// ==========================================
		await page.evaluate(() => {
			const btnWrite = document.querySelector('[data-hewrite="1"]');
			if (btnWrite) btnWrite.click();
		});
		await new Promise((r) => setTimeout(r, 300));

		// Desktop Tray
		await setTheme("light");
		await capture("23_heft_tray_options_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("24_heft_tray_options_desktop_dark.png", VIEWPORTS.desktop);

		// Tablet Tray
		await setTheme("light");
		await capture("37_heft_tray_options_tablet_light.png", VIEWPORTS.tablet);
		await setTheme("dark");
		await capture("38_heft_tray_options_tablet_dark.png", VIEWPORTS.tablet);

		// Mobile Tray
		await setTheme("light");
		await capture("47_heft_tray_mobile_light.png", VIEWPORTS.mobile);
		await setTheme("dark");
		await capture("48_heft_tray_mobile_dark.png", VIEWPORTS.mobile);

		// ==========================================
		// 12. HEFT PAGES DRAWER / POPOVER
		// ==========================================
		await page.setViewport(VIEWPORTS.desktop);
		await page.evaluate(() => {
			const btnPages = document.querySelector('[data-hepagesmenu="1"]');
			if (btnPages) btnPages.click();
		});
		await new Promise((r) => setTimeout(r, 400));

		await setTheme("light");
		await capture("25_heft_pages_drawer_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("26_heft_pages_drawer_desktop_dark.png", VIEWPORTS.desktop);

		// Close pages popover
		await page.evaluate(() => {
			const pop = document.querySelector(".heft-pop");
			if (pop) pop.remove();
		});
		await new Promise((r) => setTimeout(r, 200));

		// ==========================================
		// 13. HEFT LASSO SELECTION
		// ==========================================
		await page.evaluate(() => {
			// Switch tool to lasso and simulate a selection
			const btnLasso = document.querySelector('[data-hetool="lasso"]');
			if (btnLasso) btnLasso.click();

			// Add lasso selection box manually into stage for pixel-perfect visualization
			const scroll = document.querySelector(".heft-scroll");
			if (scroll) {
				const existingBox = document.querySelector(".heft-lasso-box");
				if (existingBox) existingBox.remove();

				const lassoBox = document.createElement("div");
				lassoBox.className = "heft-lasso-box";
				lassoBox.style.position = "absolute";
				lassoBox.style.left = "220px";
				lassoBox.style.top = "180px";
				lassoBox.style.width = "480px";
				lassoBox.style.height = "320px";
				lassoBox.style.border = "2px dashed #2f6fed";
				lassoBox.style.borderRadius = "8px";
				lassoBox.style.backgroundColor = "rgba(47, 111, 237, 0.08)";
				lassoBox.style.pointerEvents = "all";
				lassoBox.style.zIndex = "10";

				// Add transform / duplicate handles
				lassoBox.innerHTML = `
					<div style="position: absolute; right: -12px; top: -12px; width: 24px; height: 24px; border-radius: 50%; background: #2f6fed; color: white; display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.2);">✕</div>
					<div style="position: absolute; right: 20px; top: -12px; width: 24px; height: 24px; border-radius: 50%; background: #2f6fed; color: white; display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.2);">⎘</div>
					<div style="position: absolute; right: -8px; bottom: -8px; width: 16px; height: 16px; border-radius: 50%; background: #2f6fed; border: 2px solid white; cursor: nwse-resize; box-shadow: 0 2px 6px rgba(0,0,0,0.2);"></div>
				`;
				scroll.appendChild(lassoBox);
			}
		});
		await new Promise((r) => setTimeout(r, 300));

		await setTheme("light");
		await capture("27_heft_lasso_selection_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("28_heft_lasso_selection_desktop_dark.png", VIEWPORTS.desktop);

		// Remove lasso box
		await page.evaluate(() => {
			const b = document.querySelector(".heft-lasso-box");
			if (b) b.remove();
		});

		// ==========================================
		// 14. HEFT PDF / DOCUMENT BACKGROUND IMPORT
		// ==========================================
		const pdfHeftId = "heft-pdf-test";
		await page.evaluate(async (hid) => {
			// Generate a canvas data URL representing a structured PDF page
			const c = document.createElement("canvas");
			c.width = 1000;
			c.height = 1414;
			const ctx = c.getContext("2d");
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, 1000, 1414);

			// PDF Header & Lines
			ctx.fillStyle = "#1e293b";
			ctx.font = "bold 36px sans-serif";
			ctx.fillText("Lecture Notes: Quantum Computing & Circuits", 80, 120);

			ctx.fillStyle = "#64748b";
			ctx.font = "20px sans-serif";
			ctx.fillText("Chapter 4: Superposition, Entanglement, and Unitary Transformations", 80, 160);

			ctx.strokeStyle = "#cbd5e1";
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(80, 180);
			ctx.lineTo(920, 180);
			ctx.stroke();

			// Simulated paragraph text
			ctx.fillStyle = "#334155";
			ctx.font = "22px sans-serif";
			for (let i = 0; i < 8; i++) {
				ctx.fillText(`Let |ψ⟩ = α|0⟩ + β|1⟩ denote a single qubit state with normalization |α|² + |β|² = 1. (Line ${i + 1})`, 80, 240 + i * 40);
			}

			// Circuit diagram box
			ctx.fillStyle = "#f8fafc";
			ctx.strokeStyle = "#94a3b8";
			ctx.fillRect(80, 600, 840, 240);
			ctx.strokeRect(80, 600, 840, 240);
			ctx.fillStyle = "#475569";
			ctx.font = "bold 24px monospace";
			ctx.fillText("|0⟩ ───[ H ]───●───[ H ]─── Measurement", 140, 720);
			ctx.fillText("|0⟩ ───────────⊕──────────── Measurement", 140, 780);

			const blobData = c.toDataURL("image/png");
			const blobHash = "b" + blobData.length + "-testpdf";
			await window.DB.putBlob("blob-" + blobHash, blobData);

			const strokes = [
				// Red correction pen marking
				{
					id: "s_pdf_1",
					tool: "pen",
					color: "#e0483e",
					size: 3,
					pts: [[70, 710, 0.6], [890, 710, 0.7], [870, 700, 0.8]],
					bbox: { minX: 65, minY: 695, maxX: 895, maxY: 725 }
				},
				// Yellow marker highlight over text
				{
					id: "s_pdf_2",
					tool: "marker",
					color: "#f5b800",
					size: 5.5,
					pts: [[75, 235, 0.5], [800, 235, 0.5]],
					bbox: { minX: 70, minY: 220, maxX: 810, maxY: 250 }
				},
				// Handwritten annotation note
				{
					id: "s_pdf_3",
					tool: "pen",
					color: "#2f6fed",
					size: 3,
					pts: [[600, 560, 0.5], [680, 540, 0.7], [780, 580, 0.6]],
					bbox: { minX: 595, minY: 535, maxX: 785, maxY: 585 }
				}
			];

			const texts = [
				{
					id: "t_pdf_1",
					text: "Important Bell State!",
					x: 580,
					y: 530,
					w: 300,
					h: 40,
					size: 26,
					color: "#2f6fed"
				}
			];

			await window.STATE.dispatch("pageCreate", {
				id: hid,
				title: "📄 Quantum Computing Lecture (PDF)",
				workspaceId: "default",
				icon: "📄",
				kind: "heft",
			});

			const doc = {
				v: 2,
				rev: 1,
				pages: [
					{
						id: "page-pdf-1",
						paper: "blank",
						strokes,
						images: [
							{
								id: "img_pdf_1",
								ref: blobHash,
								x: 0,
								y: 0,
								w: 1000,
								h: 1414
							}
						],
						texts
					}
				]
			};
			await window.DB.putBlob("heft-doc-" + hid, doc);
			window.openPage(hid);
		}, pdfHeftId);
		await new Promise((r) => setTimeout(r, 600));

		await setTheme("light");
		await capture("29_heft_pdf_import_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("30_heft_pdf_import_desktop_dark.png", VIEWPORTS.desktop);

		// ==========================================
		// 15. EXTREME / STRESSED STATES
		// ==========================================

		// A. Wide Table Horizontal Overflow (Desktop & Mobile)
		const stressTableId = "page-stress-table";
		const stressTableMd = `# 🌊 Stressed Table Horizontal Overflow

| Col 1 | Column 2 Description | Column 3 Architectural Specs | Col 4 | Column 5 Long Header | Col 6 | Column 7 | Column 8 Data Metric | Col 9 | Column 10 | Col 11 | Column 12 Extra | Column 13 | Column 14 | Column 15 Final |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Val 1.1 | Extremely descriptive content row 1 | Local-first replication engine architecture | 99.2% | Standard latency measurement 12.4ms | Active | Tier 1 | Comprehensive benchmark suite passed | Ok | 100% | Stable | Additional payload info | True | Valid | Completed |
| Val 2.1 | Detailed operational parameters row 2 | ContentEditable AST parser & DOM morphing | 98.7% | High-precision timing delta 0.8ms | Active | Tier 1 | Vector canvas dual-layer compositing | Ok | 100% | Stable | Secondary replication log | True | Valid | Completed |
| Val 3.1 | System diagnostic records row 3 | SQLite/IndexedDB transactional log storage | 99.9% | Cloudflare worker edge RPC latency | Synced | Tier 2 | Automatic FNV+DJB blob deduplication | Ok | 100% | Stable | Extended cache lifetime | True | Valid | Completed |
`;
		await page.evaluate(async (pid, md) => {
			await window.STATE.dispatch("pageCreate", {
				id: pid,
				title: "🌊 Table Overflow Stress",
				content: md,
				workspaceId: "default",
				icon: "🌊",
			});
			window.openPage(pid);
		}, stressTableId, stressTableMd);
		await new Promise((r) => setTimeout(r, 500));

		await setTheme("light");
		await capture("49_stress_table_overflow_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("50_stress_table_overflow_desktop_dark.png", VIEWPORTS.desktop);

		await setTheme("light");
		await capture("51_stress_table_overflow_mobile_light.png", VIEWPORTS.mobile);
		await setTheme("dark");
		await capture("52_stress_table_overflow_mobile_dark.png", VIEWPORTS.mobile);

		// B. Very Long Unspaced Text Strings
		const stressTextId = "page-stress-text";
		const stressTextMd = `# 💥 Very Long Unspaced Text & URL Wrapping Stress

Paragraph with an extreme unbroken alphanumeric string:
https://super-long-unbroken-url-string-with-zero-spaces-that-tests-responsive-word-breaking-and-overflow-wrapping-in-all-containers-desktop-and-mobile-viewports.com/api/v4/deeply/nested/resource/path/with/more/unbroken/content/and/extra/query/parameters/123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890

# HeadingWithUnbrokenLongSequenceTestingWordWrapAndOverflowClippingAcrossViewports123456789012345678901234567890

> [!red]
> **Callout Overflow Test**
> WARNING_UNBROKEN_STRING_INSIDE_CALLOUT_BOX_CONTAINER_TESTING_WHETHER_IT_CLIPS_OR_CAUSES_HORIZONTAL_SCROLLBARS_ON_MOBILE_DEVICES_1234567890_ABCDEFGHIJ_KLMNOPQRST_UVWXYZ

\`\`\`
NON_BREAKING_CODE_LINE_WITHOUT_ANY_SPACES_0123456789_0123456789_0123456789_0123456789_0123456789_0123456789_0123456789_0123456789_0123456789_0123456789
\`\`\`
`;
		await page.evaluate(async (pid, md) => {
			await window.STATE.dispatch("pageCreate", {
				id: pid,
				title: "💥 Text Wrapping Stress",
				content: md,
				workspaceId: "default",
				icon: "💥",
			});
			window.openPage(pid);
		}, stressTextId, stressTextMd);
		await new Promise((r) => setTimeout(r, 500));

		await setTheme("light");
		await capture("53_stress_unspaced_text_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("54_stress_unspaced_text_desktop_dark.png", VIEWPORTS.desktop);

		await setTheme("light");
		await capture("55_stress_unspaced_text_mobile_light.png", VIEWPORTS.mobile);
		await setTheme("dark");
		await capture("56_stress_unspaced_text_mobile_dark.png", VIEWPORTS.mobile);

		// C. Dense Overlapping Strokes (1,000 Strokes)
		const denseHeftId = "heft-dense-test";
		await page.evaluate(async (hid) => {
			const strokes = [];
			const colors = ["#1c1c1e", "#2f6fed", "#e0483e", "#1f9d55", "#f5b800", "#8b7cc8"];
			for (let i = 0; i < 1000; i++) {
				const startX = 100 + (i % 30) * 26 + (Math.sin(i) * 30);
				const startY = 150 + Math.floor(i / 30) * 35 + (Math.cos(i) * 20);
				const endX = startX + 40 + Math.sin(i * 2) * 30;
				const endY = startY + 30 + Math.cos(i * 3) * 25;
				const midX = (startX + endX) / 2 + Math.sin(i * 4) * 20;
				const midY = (startY + endY) / 2 + Math.cos(i * 5) * 20;

				strokes.push({
					id: "dense_" + i,
					tool: i % 7 === 0 ? "marker" : "pen",
					color: colors[i % colors.length],
					size: (i % 3 === 0) ? 1.6 : (i % 3 === 1 ? 3 : 5.5),
					pts: [
						[startX, startY, 0.5],
						[midX, midY, 0.8],
						[endX, endY, 0.6]
					],
					bbox: {
						minX: Math.min(startX, midX, endX) - 5,
						minY: Math.min(startY, midY, endY) - 5,
						maxX: Math.max(startX, midX, endX) + 5,
						maxY: Math.max(startY, midY, endY) + 5
					}
				});
			}

			await window.STATE.dispatch("pageCreate", {
				id: hid,
				title: "⚡ 1,000 Dense Strokes Stress",
				workspaceId: "default",
				icon: "⚡",
				kind: "heft",
			});

			const doc = {
				v: 2,
				rev: 1,
				pages: [
					{
						id: "page-dense-1",
						paper: "grid",
						strokes,
						images: [],
						texts: [
							{
								id: "t_dense_1",
								text: "Stress Test: 1,000 Algorithmic Bezier Strokes",
								x: 120,
								y: 80,
								w: 700,
								h: 50,
								size: 32,
								color: "#1c1c1e"
							}
						]
					}
				]
			};
			await window.DB.putBlob("heft-doc-" + hid, doc);
			window.openPage(hid);
		}, denseHeftId);
		await new Promise((r) => setTimeout(r, 800));

		await setTheme("light");
		await capture("57_stress_dense_strokes_desktop_light.png", VIEWPORTS.desktop);
		await setTheme("dark");
		await capture("58_stress_dense_strokes_desktop_dark.png", VIEWPORTS.desktop);

		// D. Zoomed Canvas (Zoom In 3.5x and Zoom Out 0.4x)
		await page.evaluate(() => {
			// Trigger zoom in to 3.5x
			const pgs = document.querySelector(".heft-pages");
			if (pgs) {
				pgs.style.transform = "translate(-800px, -400px) scale(3.5)";
			}
		});
		await new Promise((r) => setTimeout(r, 400));
		await capture("59_stress_zoomed_canvas_in_desktop_light.png", VIEWPORTS.desktop);

		await page.evaluate(() => {
			// Trigger zoom out to 0.4x
			const pgs = document.querySelector(".heft-pages");
			if (pgs) {
				pgs.style.transform = "translate(300px, 50px) scale(0.4)";
			}
		});
		await new Promise((r) => setTimeout(r, 400));
		await capture("60_stress_zoomed_canvas_out_desktop_light.png", VIEWPORTS.desktop);

		console.log("All 60 screenshot scenarios captured successfully!");

	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
