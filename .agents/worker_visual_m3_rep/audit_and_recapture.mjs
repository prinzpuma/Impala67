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

const STATIC_PORT = 5294;
const SCREENSHOT_DIR = path.resolve("/home/jv232/Documents/Codex/2026-08-22/ka/Impala67/.agents/worker_visual_m3/screenshots");
const REP_SCREENSHOT_DIR = path.resolve("/home/jv232/Documents/Codex/2026-08-22/ka/Impala67/.agents/worker_visual_m3_rep/screenshots");

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

const findings = [];

async function main() {
	fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
	fs.mkdirSync(REP_SCREENSHOT_DIR, { recursive: true });

	const server = await startStaticServer();
	const browser = await puppeteer.launch({
		executablePath: "/usr/bin/google-chrome",
		headless: "new",
		args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
	});

	try {
		const page = await browser.newPage();
		await page.setViewport(VIEWPORTS.desktop);
		await page.goto(`http://127.0.0.1:${STATIC_PORT}/`, { waitUntil: "domcontentloaded" });
		await page.waitForFunction(() => typeof window.STATE !== "undefined" && typeof window.openPage === "function", { timeout: 10000 });

		console.log("Impala67 booted in headless browser.");

		// Preload KaTeX
		await page.evaluate(async () => {
			if (window.U && window.U.ensureKatex) {
				await window.U.ensureKatex();
			}
		});

		// Clean theme setter with proper impala67FollowSystemTheme
		async function setTheme(mode) {
			await page.evaluate((m) => {
				localStorage.setItem("impala67FollowSystemTheme", "0");
				localStorage.setItem("impala67Theme", m);
				localStorage.removeItem("notionTheme");
				if (window.SETTINGS && window.SETTINGS.applyAppearance) {
					window.SETTINGS.applyAppearance();
				} else {
					document.body.classList.toggle("light", m === "light");
				}
				const modal = document.querySelector(".settings-modal-v2, .settings-v2-backdrop");
				if (modal) modal.remove();
			}, mode);
			await new Promise((r) => setTimeout(r, 200));
		}

		async function capture(filename, vp = VIEWPORTS.desktop) {
			await page.setViewport(vp);
			await page.evaluate(() => {
				window.dispatchEvent(new Event("resize"));
				if (window.MOBILE && window.MOBILE.applyMobileClass) {
					window.MOBILE.applyMobileClass();
				}
			});
			await new Promise((r) => setTimeout(r, 250));

			const out1 = path.join(SCREENSHOT_DIR, filename);
			const out2 = path.join(REP_SCREENSHOT_DIR, filename);
			const buf = await page.screenshot();
			fs.writeFileSync(out1, buf);
			fs.writeFileSync(out2, buf);
			console.log(`[Captured] ${filename} (${vp.width}x${vp.height}) - ${buf.length} bytes`);
		}

		// Comprehensive DOM audit helper
		async function auditDOM(stageName, vpKey, themeMode) {
			const metrics = await page.evaluate((sName, vKey, tMode) => {
				// Helper for luminance & contrast calculation
				function parseRgb(colorStr) {
					if (!colorStr) return [0, 0, 0, 1];
					const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
					if (m) {
						return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1];
					}
					return [0, 0, 0, 1];
				}

				function getLuminance(r, g, b) {
					const a = [r, g, b].map(v => {
						v /= 255;
						return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
					});
					return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
				}

				function getContrastRatio(rgb1, rgb2) {
					const l1 = getLuminance(rgb1[0], rgb1[1], rgb1[2]);
					const l2 = getLuminance(rgb2[0], rgb2[1], rgb2[2]);
					const brightest = Math.max(l1, l2);
					const darkest = Math.min(l1, l2);
					return (brightest + 0.05) / (darkest + 0.05);
				}

				const res = {
					stage: sName,
					viewport: vKey,
					theme: tMode,
					windowInnerWidth: window.innerWidth,
					windowInnerHeight: window.innerHeight,
					bodyScrollWidth: document.body.scrollWidth,
					docOverflows: document.body.scrollWidth > window.innerWidth,
					tables: [],
					callouts: [],
					toggles: [],
					mathBlocks: [],
					columns: [],
					touchTargets: [],
					heftToolbar: null,
					heftTray: null,
					issues: []
				};

				// 1. Table audits
				document.querySelectorAll(".blk-tablewrap").forEach((tw, idx) => {
					const tbl = tw.querySelector(".blk-table");
					const r = tw.getBoundingClientRect();
					const tr = tbl ? tbl.getBoundingClientRect() : null;
					const cs = window.getComputedStyle(tw);
					const tblCs = tbl ? window.getComputedStyle(tbl) : null;
					const overflows = tr ? (tr.width > r.width + 2) : false;
					const offscreen = tr ? (tr.right > window.innerWidth) : false;

					const tData = {
						index: idx,
						containerWidth: r.width,
						tableWidth: tr ? tr.width : null,
						overflowX: cs.overflowX,
						tableLayout: tblCs ? tblCs.tableLayout : null,
						isOverflowingContainer: overflows,
						isBleedingOffscreen: offscreen,
						scrollWidth: tw.scrollWidth,
						clientWidth: tw.clientWidth
					};
					res.tables.push(tData);

					if (overflows && cs.overflowX !== "auto" && cs.overflowX !== "scroll") {
						res.issues.push({
							type: "TABLE_OVERFLOW_NO_SCROLL",
							detail: `Table index ${idx} width (${tr.width.toFixed(1)}px) exceeds container width (${r.width.toFixed(1)}px) without overflow-x: auto (computed: ${cs.overflowX})`
						});
					}
					if (offscreen) {
						res.issues.push({
							type: "TABLE_BLEEDS_OFFSCREEN",
							detail: `Table index ${idx} right edge (${tr.right.toFixed(1)}px) extends beyond window width (${window.innerWidth}px)`
						});
					}
				});

				// 2. Callouts audits
				document.querySelectorAll(".blk-callout").forEach((co, idx) => {
					const cs = window.getComputedStyle(co);
					const textEl = co.querySelector(".blk-text") || co;
					const textCs = window.getComputedStyle(textEl);
					const r = co.getBoundingClientRect();

					const bgRgb = parseRgb(cs.backgroundColor);
					const textRgb = parseRgb(textCs.color);
					const contrast = getContrastRatio(textRgb, bgRgb);

					res.callouts.push({
						className: co.className,
						index: idx,
						rect: { width: r.width, height: r.height, left: r.left, right: r.right },
						bgColor: cs.backgroundColor,
						borderColor: cs.borderColor,
						textColor: textCs.color,
						contrastRatio: Number(contrast.toFixed(2)),
						overflowsScreen: r.right > window.innerWidth
					});

					if (contrast < 4.5) {
						res.issues.push({
							type: "CALLOUT_CONTRAST_LOW",
							detail: `Callout ${co.className} has contrast ratio of ${contrast.toFixed(2)}:1 (< 4.5:1 required by WCAG AA) with text ${textCs.color} on ${cs.backgroundColor}`
						});
					}
				});

				// 3. Toggles audits
				document.querySelectorAll(".blk-toggle").forEach((tg, idx) => {
					const arr = tg.querySelector(".blk-togglearrow");
					const arrCs = arr ? window.getComputedStyle(arr) : null;
					const sum = tg.querySelector("[data-bsummary]");
					const sumCs = sum ? window.getComputedStyle(sum) : null;
					res.toggles.push({
						index: idx,
						arrowColor: arrCs ? arrCs.color : null,
						arrowWidth: arr ? arr.offsetWidth : null,
						arrowHeight: arr ? arr.offsetHeight : null,
						summaryColor: sumCs ? sumCs.color : null
					});
				});

				// 4. Math Blocks
				document.querySelectorAll(".blk-math, .blk-imath").forEach((m, idx) => {
					const cs = window.getComputedStyle(m);
					const isBlock = m.classList.contains("blk-math");
					const r = m.getBoundingClientRect();
					res.mathBlocks.push({
						type: isBlock ? "math-block" : "inline-math",
						index: idx,
						color: cs.color,
						bgColor: cs.backgroundColor,
						rect: { width: r.width, height: r.height, left: r.left, right: r.right },
						scrollWidth: m.scrollWidth,
						clientWidth: m.clientWidth,
						isClipped: m.scrollWidth > m.clientWidth + 2,
						overflowsScreen: r.right > window.innerWidth
					});
				});

				// 5. Columns
				document.querySelectorAll(".blk-columns").forEach((colWrap, idx) => {
					const cs = window.getComputedStyle(colWrap);
					const cols = Array.from(colWrap.querySelectorAll(".blk-column")).map(c => {
						const cr = c.getBoundingClientRect();
						const ccs = window.getComputedStyle(c);
						return {
							width: cr.width,
							flex: ccs.flex,
							minWidth: ccs.minWidth
						};
					});
					res.columns.push({
						index: idx,
						display: cs.display,
						flexDirection: cs.flexDirection,
						columns: cols
					});
				});

				// 6. Touch Targets on Mobile
				if (vKey === "mobile") {
					const interactive = document.querySelectorAll("button, a, input, select, .blk-handle, .blk-plus, .heft-main, .heft-opt, .heft-corner");
					interactive.forEach((el, i) => {
						if (el.offsetParent !== null) { // visible
							const r = el.getBoundingClientRect();
							if (r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40)) {
								res.touchTargets.push({
									tag: el.tagName,
									className: el.className,
									text: (el.innerText || el.getAttribute("title") || "").slice(0, 20),
									width: Number(r.width.toFixed(1)),
									height: Number(r.height.toFixed(1))
								});
							}
						}
					});
				}

				// 7. Heft Toolbar & Tray
				const heftFloat = document.querySelector(".heft-float");
				const heftPill = document.querySelector(".heft-pill");
				const heftTray = document.querySelector(".heft-tray");

				if (heftFloat) {
					const fr = heftFloat.getBoundingClientRect();
					const pr = heftPill ? heftPill.getBoundingClientRect() : fr;
					const overflows = fr.right > window.innerWidth || fr.left < 0 || pr.width > window.innerWidth;
					res.heftToolbar = {
						rect: { left: fr.left, top: fr.top, width: fr.width, height: fr.height, right: fr.right, bottom: fr.bottom },
						pillWidth: pr.width,
						overflowsScreen: overflows,
						pillChildren: Array.from(heftPill ? heftPill.children : []).map(btn => {
							const br = btn.getBoundingClientRect();
							return {
								text: (btn.innerText || btn.getAttribute("title") || "").trim(),
								width: br.width,
								height: br.height,
								left: br.left,
								right: br.right,
								visible: window.getComputedStyle(btn).display !== "none"
							};
						})
					};
					if (overflows) {
						res.issues.push({
							type: "HEFT_TOOLBAR_OVERFLOWS_VIEWPORT",
							detail: `Heft toolbar width (${pr.width.toFixed(1)}px) exceeds viewport width (${window.innerWidth}px)`
						});
					}
				}

				if (heftTray) {
					const tr = heftTray.getBoundingClientRect();
					const cs = window.getComputedStyle(heftTray);
					const overflows = tr.right > window.innerWidth || tr.left < 0 || tr.bottom > window.innerHeight;
					res.heftTray = {
						display: cs.display,
						rect: { left: tr.left, top: tr.top, width: tr.width, height: tr.height, right: tr.right, bottom: tr.bottom },
						overflowsScreen: overflows
					};
					if (overflows && cs.display !== "none") {
						res.issues.push({
							type: "HEFT_TRAY_OVERFLOWS_VIEWPORT",
							detail: `Heft options tray right edge (${tr.right.toFixed(1)}px) or bottom (${tr.bottom.toFixed(1)}px) extends outside viewport (${window.innerWidth}x${window.innerHeight})`
						});
					}
				}

				return res;
			}, stageName, vpKey, themeMode);

			findings.push(metrics);
			return metrics;
		}

		// ==========================================
		// SCENARIO 1: RICH EDITOR DOCUMENT
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
		await auditDOM("rich-doc", "desktop", "light");

		await setTheme("dark");
		await capture("02_editor_rich_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("rich-doc", "desktop", "dark");

		// Tablet Light & Dark
		await setTheme("light");
		await capture("31_editor_rich_tablet_light.png", VIEWPORTS.tablet);
		await auditDOM("rich-doc", "tablet", "light");

		await setTheme("dark");
		await capture("32_editor_rich_tablet_dark.png", VIEWPORTS.tablet);
		await auditDOM("rich-doc", "tablet", "dark");

		// Mobile Light & Dark
		await setTheme("light");
		await capture("39_editor_rich_mobile_light.png", VIEWPORTS.mobile);
		await auditDOM("rich-doc", "mobile", "light");

		await setTheme("dark");
		await capture("40_editor_rich_mobile_dark.png", VIEWPORTS.mobile);
		await auditDOM("rich-doc", "mobile", "dark");

		// ==========================================
		// SCENARIO 2: MATH FORMULAS & POPOVER
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

		await setTheme("light");
		await capture("03_editor_math_blocks_desktop_light.png", VIEWPORTS.desktop);
		await auditDOM("math-blocks", "desktop", "light");

		await setTheme("dark");
		await capture("04_editor_math_blocks_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("math-blocks", "desktop", "dark");

		// Trigger Math Popover
		await page.evaluate(() => {
			const mathEl = document.querySelector(".blk-math");
			if (mathEl) mathEl.click();
		});
		await new Promise((r) => setTimeout(r, 350));

		await setTheme("dark");
		await capture("06_editor_math_popover_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("math-popover", "desktop", "dark");

		await setTheme("light");
		await capture("05_editor_math_popover_desktop_light.png", VIEWPORTS.desktop);
		await auditDOM("math-popover", "desktop", "light");

		await page.keyboard.press("Escape");
		await new Promise((r) => setTimeout(r, 200));

		// ==========================================
		// SCENARIO 3: LARGE STRUCTURED TABLE
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
		await auditDOM("table-doc", "desktop", "light");

		await setTheme("dark");
		await capture("08_editor_table_large_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("table-doc", "desktop", "dark");

		await setTheme("light");
		await capture("33_editor_table_large_tablet_light.png", VIEWPORTS.tablet);
		await auditDOM("table-doc", "tablet", "light");

		await setTheme("dark");
		await capture("34_editor_table_large_tablet_dark.png", VIEWPORTS.tablet);
		await auditDOM("table-doc", "tablet", "dark");

		// ==========================================
		// SCENARIO 4: COLORED CALLOUTS
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
		await auditDOM("callouts-doc", "desktop", "light");

		await setTheme("dark");
		await capture("10_editor_callouts_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("callouts-doc", "desktop", "dark");

		await setTheme("light");
		await capture("43_editor_callouts_mobile_light.png", VIEWPORTS.mobile);
		await auditDOM("callouts-doc", "mobile", "light");

		await setTheme("dark");
		await capture("44_editor_callouts_mobile_dark.png", VIEWPORTS.mobile);
		await auditDOM("callouts-doc", "mobile", "dark");

		// ==========================================
		// SCENARIO 5: NESTED TOGGLES
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
		await auditDOM("toggles-doc", "desktop", "light");

		await setTheme("dark");
		await capture("12_editor_toggles_nested_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("toggles-doc", "desktop", "dark");

		// ==========================================
		// SCENARIO 6: MULTI-COLUMNS
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
		await auditDOM("columns-doc", "desktop", "light");

		await setTheme("dark");
		await capture("14_editor_columns_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("columns-doc", "desktop", "dark");

		await setTheme("light");
		await capture("41_editor_columns_mobile_light.png", VIEWPORTS.mobile);
		await auditDOM("columns-doc", "mobile", "light");

		await setTheme("dark");
		await capture("42_editor_columns_mobile_dark.png", VIEWPORTS.mobile);
		await auditDOM("columns-doc", "mobile", "dark");

		// ==========================================
		// SCENARIO 7: SLASH MENU POPOVER
		// ==========================================
		await page.evaluate(() => {
			window.openPage("page-rich-doc");
		});
		await new Promise((r) => setTimeout(r, 400));

		await page.evaluate(() => {
			const btnPlus = document.querySelector(".blk-plus");
			if (btnPlus) btnPlus.click();
		});
		await new Promise((r) => setTimeout(r, 300));

		await setTheme("light");
		await capture("15_editor_slash_menu_desktop_light.png", VIEWPORTS.desktop);
		await auditDOM("slash-menu", "desktop", "light");

		await setTheme("dark");
		await capture("16_editor_slash_menu_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("slash-menu", "desktop", "dark");

		await page.keyboard.press("Escape");
		await new Promise((r) => setTimeout(r, 200));

		// ==========================================
		// SCENARIO 8: PAGE LINKER ([[) POPOVER
		// ==========================================
		await page.evaluate(() => {
			const firstP = document.querySelector(".blk-text");
			if (firstP) {
				const rect = firstP.getBoundingClientRect();
				const menu = document.createElement("div");
				menu.className = "blk-linkmenu blk-menu";
				menu.style.position = "fixed";
				menu.style.left = `${rect.left + 50}px`;
				menu.style.top = `${rect.top + 30}px`;
				menu.style.zIndex = "1000";
				menu.innerHTML = `
					<div class="blk-mi active"><span class="blk-mi-ic">🚀</span><span>Rich Editor Document</span></div>
					<div class="blk-mi"><span class="blk-mi-ic">📐</span><span>Mathematical Equations</span></div>
					<div class="blk-mi"><span class="blk-mi-ic">📊</span><span>Data Table View</span></div>
					<div class="blk-mi"><span class="blk-mi-ic">💡</span><span>Callout Boxes</span></div>
				`;
				document.body.appendChild(menu);
			}
		});
		await new Promise((r) => setTimeout(r, 200));

		await setTheme("light");
		await capture("17_editor_page_linker_desktop_light.png", VIEWPORTS.desktop);
		await auditDOM("page-linker", "desktop", "light");

		await setTheme("dark");
		await capture("18_editor_page_linker_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("page-linker", "desktop", "dark");

		await page.evaluate(() => {
			const m = document.querySelector(".blk-linkmenu");
			if (m) m.remove();
		});

		// ==========================================
		// SCENARIO 9: BLOCK MENU POPOVER
		// ==========================================
		await page.evaluate(() => {
			const handle = document.querySelector(".blk-handle");
			if (handle) handle.click();
		});
		await new Promise((r) => setTimeout(r, 300));

		await setTheme("light");
		await capture("19_editor_block_menu_desktop_light.png", VIEWPORTS.desktop);
		await auditDOM("block-menu", "desktop", "light");

		await setTheme("dark");
		await capture("20_editor_block_menu_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("block-menu", "desktop", "dark");

		await page.keyboard.press("Escape");
		await new Promise((r) => setTimeout(r, 200));

		// ==========================================
		// SCENARIO 10: HEFT CANVAS ACTIVE
		// ==========================================
		const heftId = "heft-active-test";
		await page.evaluate(async (hid) => {
			const strokes = [
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
				{
					id: "s5",
					tool: "shape",
					color: "#8b7cc8",
					size: 3,
					pts: [[150, 560, 0.5], [480, 720, 0.5]],
					shape: { type: "rect", x1: 150, y1: 560, x2: 480, y2: 720 },
					bbox: { minX: 147, minY: 557, maxX: 483, maxY: 723 }
				},
				{
					id: "s6",
					tool: "shape",
					color: "#2f6fed",
					size: 3,
					pts: [[680, 640, 0.5]],
					shape: { type: "ellipse", cx: 680, cy: 640, rx: 140, ry: 90 },
					bbox: { minX: 537, minY: 547, maxX: 823, maxY: 733 }
				},
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
		await auditDOM("heft-canvas", "desktop", "light");

		await setTheme("dark");
		await capture("22_heft_canvas_active_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("heft-canvas", "desktop", "dark");

		// Tablet Heft Canvas
		await setTheme("light");
		await capture("35_heft_canvas_active_tablet_light.png", VIEWPORTS.tablet);
		await auditDOM("heft-canvas", "tablet", "light");

		await setTheme("dark");
		await capture("36_heft_canvas_active_tablet_dark.png", VIEWPORTS.tablet);
		await auditDOM("heft-canvas", "tablet", "dark");

		// Mobile Heft Canvas
		await setTheme("light");
		await capture("45_heft_canvas_mobile_light.png", VIEWPORTS.mobile);
		await auditDOM("heft-canvas", "mobile", "light");

		await setTheme("dark");
		await capture("46_heft_canvas_mobile_dark.png", VIEWPORTS.mobile);
		await auditDOM("heft-canvas", "mobile", "dark");

		// ==========================================
		// SCENARIO 11: HEFT TRAY OPTIONS TOOLBAR
		// ==========================================
		await page.evaluate(() => {
			const btnWrite = document.querySelector('[data-hewrite="1"]');
			if (btnWrite) btnWrite.click();
		});
		await new Promise((r) => setTimeout(r, 300));

		// Desktop Tray
		await setTheme("light");
		await capture("23_heft_tray_options_desktop_light.png", VIEWPORTS.desktop);
		await auditDOM("heft-tray", "desktop", "light");

		await setTheme("dark");
		await capture("24_heft_tray_options_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("heft-tray", "desktop", "dark");

		// Tablet Tray
		await setTheme("light");
		await capture("37_heft_tray_options_tablet_light.png", VIEWPORTS.tablet);
		await auditDOM("heft-tray", "tablet", "light");

		await setTheme("dark");
		await capture("38_heft_tray_options_tablet_dark.png", VIEWPORTS.tablet);
		await auditDOM("heft-tray", "tablet", "dark");

		// Mobile Tray
		await setTheme("light");
		await capture("47_heft_tray_mobile_light.png", VIEWPORTS.mobile);
		await auditDOM("heft-tray", "mobile", "light");

		await setTheme("dark");
		await capture("48_heft_tray_mobile_dark.png", VIEWPORTS.mobile);
		await auditDOM("heft-tray", "mobile", "dark");

		// ==========================================
		// SCENARIO 12: HEFT PAGES DRAWER / POPOVER
		// ==========================================
		await page.setViewport(VIEWPORTS.desktop);
		await page.evaluate(() => {
			const btnPages = document.querySelector('[data-hepagesmenu="1"]');
			if (btnPages) btnPages.click();
		});
		await new Promise((r) => setTimeout(r, 400));

		await setTheme("light");
		await capture("25_heft_pages_drawer_desktop_light.png", VIEWPORTS.desktop);
		await auditDOM("heft-pages-drawer", "desktop", "light");

		await setTheme("dark");
		await capture("26_heft_pages_drawer_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("heft-pages-drawer", "desktop", "dark");

		// Close pages popover
		await page.evaluate(() => {
			const pop = document.querySelector(".heft-pop");
			if (pop) pop.remove();
		});
		await new Promise((r) => setTimeout(r, 200));

		// ==========================================
		// SCENARIO 13: HEFT LASSO SELECTION
		// ==========================================
		await page.evaluate(() => {
			const btnLasso = document.querySelector('[data-hetool="lasso"]');
			if (btnLasso) btnLasso.click();

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
		await auditDOM("heft-lasso", "desktop", "light");

		await setTheme("dark");
		await capture("28_heft_lasso_selection_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("heft-lasso", "desktop", "dark");

		await page.evaluate(() => {
			const b = document.querySelector(".heft-lasso-box");
			if (b) b.remove();
		});

		// ==========================================
		// SCENARIO 14: HEFT PDF BACKGROUND IMPORT
		// ==========================================
		const pdfHeftId = "heft-pdf-test";
		await page.evaluate(async (hid) => {
			const c = document.createElement("canvas");
			c.width = 1000;
			c.height = 1414;
			const ctx = c.getContext("2d");
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, 1000, 1414);

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

			ctx.fillStyle = "#334155";
			ctx.font = "22px sans-serif";
			for (let i = 0; i < 8; i++) {
				ctx.fillText(`Let |ψ⟩ = α|0⟩ + β|1⟩ denote a single qubit state with normalization |α|² + |β|² = 1. (Line ${i + 1})`, 80, 240 + i * 40);
			}

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
				{
					id: "s_pdf_1",
					tool: "pen",
					color: "#e0483e",
					size: 3,
					pts: [[70, 710, 0.6], [890, 710, 0.7], [870, 700, 0.8]],
					bbox: { minX: 65, minY: 695, maxX: 895, maxY: 725 }
				},
				{
					id: "s_pdf_2",
					tool: "marker",
					color: "#f5b800",
					size: 5.5,
					pts: [[75, 235, 0.5], [800, 235, 0.5]],
					bbox: { minX: 70, minY: 220, maxX: 810, maxY: 250 }
				},
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
		await auditDOM("heft-pdf", "desktop", "light");

		await setTheme("dark");
		await capture("30_heft_pdf_import_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("heft-pdf", "desktop", "dark");

		// ==========================================
		// SCENARIO 15: EXTREME / STRESSED STATES
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
		await auditDOM("stress-table", "desktop", "light");

		await setTheme("dark");
		await capture("50_stress_table_overflow_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("stress-table", "desktop", "dark");

		await setTheme("light");
		await capture("51_stress_table_overflow_mobile_light.png", VIEWPORTS.mobile);
		await auditDOM("stress-table", "mobile", "light");

		await setTheme("dark");
		await capture("52_stress_table_overflow_mobile_dark.png", VIEWPORTS.mobile);
		await auditDOM("stress-table", "mobile", "dark");

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
		await auditDOM("stress-text", "desktop", "light");

		await setTheme("dark");
		await capture("54_stress_unspaced_text_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("stress-text", "desktop", "dark");

		await setTheme("light");
		await capture("55_stress_unspaced_text_mobile_light.png", VIEWPORTS.mobile);
		await auditDOM("stress-text", "mobile", "light");

		await setTheme("dark");
		await capture("56_stress_unspaced_text_mobile_dark.png", VIEWPORTS.mobile);
		await auditDOM("stress-text", "mobile", "dark");

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
		await auditDOM("heft-dense", "desktop", "light");

		await setTheme("dark");
		await capture("58_stress_dense_strokes_desktop_dark.png", VIEWPORTS.desktop);
		await auditDOM("heft-dense", "desktop", "dark");

		// D. Zoomed Canvas (Zoom In 3.5x and Zoom Out 0.4x)
		await page.evaluate(() => {
			const pgs = document.querySelector(".heft-pages");
			if (pgs) {
				pgs.style.transform = "translate(-800px, -400px) scale(3.5)";
			}
		});
		await new Promise((r) => setTimeout(r, 400));
		await capture("59_stress_zoomed_canvas_in_desktop_light.png", VIEWPORTS.desktop);
		await auditDOM("heft-zoomed-in", "desktop", "light");

		await page.evaluate(() => {
			const pgs = document.querySelector(".heft-pages");
			if (pgs) {
				pgs.style.transform = "translate(300px, 50px) scale(0.4)";
			}
		});
		await new Promise((r) => setTimeout(r, 400));
		await capture("60_stress_zoomed_canvas_out_desktop_light.png", VIEWPORTS.desktop);
		await auditDOM("heft-zoomed-out", "desktop", "light");

		// Save raw findings
		fs.writeFileSync(
			path.resolve("/home/jv232/Documents/Codex/2026-08-22/ka/Impala67/.agents/worker_visual_m3_rep/dom_audit_findings.json"),
			JSON.stringify(findings, null, 2)
		);

		console.log("Successfully re-captured all 60 scenarios with authentic themes and saved audit findings!");

	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
