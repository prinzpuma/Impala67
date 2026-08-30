# Infrastructure Investigation Report: Testing & Headless Browser Automation in Impala67

## 1. Observation

### 1.1 Codebase & Test Structure
- **Root Directory**: `package.json`, `package-lock.json`, `web/`, `test/`, `server/`, `AGENTS.md`.
- **Application (`web/`)**: Native ES module static PWA with no bundler. Entry points: `web/index.html`, `web/main.js`, `web/boot.js`. Key modules: `web/editor.js`, `web/heft.js`, `web/state.js`, `web/db.js`, `web/render.js`, `web/tabs.js`.
- **Global Invocations (`web/main.js:47-74`)**: Attaches `U, DB, SRS, S, STATE, TOOLS, AI, RAG, DRIVE, PDFS, EDITOR, EXTRAS, COLLAPSE, CHATS, MOBILE, NOTION_MIGRATOR, SETTINGS, LIBRARY, TABS, SEARCH, SHORTCUTS, CHAT_FULLSCREEN, BOOT, POPOVERS, HEFT, VOICE, LERNZEIT, SCHULNOTEN, EXP, GRAPH, ANALYSE, CONTROLLER, CLOUDFLARE_SYNC, SYNC_MAINTENANCE, PERF_PROFILER, openPage, render, wireEvents` to `window`.
- **Test Directory (`test/`)**: 57 test files including unit tests (`*.test.mjs`), benchmarks (`benchmark-*.mjs`), and an end-to-end browser test (`test/sync-v4-browser.e2e.mjs`).
- **Test Runner**: Native Node.js test runner (`node:test` and `node:assert/strict`). There are no third-party test framework dependencies (Jest, Vitest, Mocha are not present or required).
- **Scripts in `package.json`**:
  ```json
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "test:e2e": "node --test test/sync-v4-browser.e2e.mjs",
    "test:all": "node --test test/*.test.mjs test/sync-v4-browser.e2e.mjs",
    "check:syntax": "find web server -type f -name '*.js' -print0 | xargs -0 -n1 node --check",
    "check:pwa": "node .github/scripts/check-pwa-cache.mjs",
    "verify": "npm test && npm run check:syntax && npm run check:pwa",
    "deploy": "wrangler deploy --config server/wrangler.toml",
    "dry-run": "wrangler deploy --config server/wrangler.toml --dry-run"
  }
  ```
- **Dependencies in `package.json`**:
  ```json
  "devDependencies": {
    "jsdom": "^26.0.0",
    "jsqr": "^1.4.0",
    "puppeteer-core": "^25.8.0",
    "wrangler": "^4.124.0"
  }
  ```

### 1.2 Environment Tooling & Binaries
- **Node.js**: `v24.19.0` located at `/usr/lib/chatgpt/resources/cua_node/bin/node` (and in `/home/jv232/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`).
- **npm**: `11.17.0` located at `/usr/lib/chatgpt/resources/cua_node/bin/npm`.
- **Path requirement**: Subprocesses require `export PATH="/usr/lib/chatgpt/resources/cua_node/bin:$PATH"`.
- **Browser Binary**: `/usr/bin/google-chrome` (Google Chrome `151.0.7922.173`).
- **Python**: `/usr/bin/python3` (Python `3.14.7`).
- **Existing Test Execution**: `npm test` executed 282 unit/integration tests with 282 passed, 0 failed in 13.28s.

### 1.3 Static PWA Serving & Headless Browser Automation Verification
- **Local Static Server**: Standard Node `node:http` server or `python3 -m http.server`.
- **Static Server Implementation Pattern**:
  - Serves static files from `web/` with MIME mapping (`.html`, `.js`, `.mjs`, `.css`, `.json`, `.svg`, `.png`, `.jpg`, `.wasm`).
  - Sends `Service-Worker-Allowed: /` and `Cache-Control: no-cache, no-store, must-revalidate`.
  - Handles `/config.local.js` with an empty JS stub response `// local config\n` to prevent 404s.
- **Headless Chrome Launch Pattern**:
  ```javascript
  import puppeteer from 'puppeteer-core';
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });
  ```
- **Live Verification Executed**:
  - Launched test server on `http://127.0.0.1:5220/`.
  - Created and mounted an Editor note with math formulas (`#blockEditor`), verified rendering, and saved screenshot to `.agents/explorer_infra/editor_rendered.png`.
  - Created and mounted a Heft canvas (`#heftStage`), verified 3 canvas layers + toolbar rendering, and saved screenshot to `.agents/explorer_infra/heft_rendered.png`.

---

## 2. Logic Chain

1. **Test Infrastructure & Execution**:
   - The repository uses native ES modules (`"type": "module"` in `package.json`) and Node's built-in `node:test` test runner.
   - All existing 57 test files run with `node --test`.
   - Node v24.19.0 is available at `/usr/lib/chatgpt/resources/cua_node/bin`. Setting this in `$PATH` ensures consistent execution across all scripts.

2. **Headless Browser Capabilities**:
   - `puppeteer-core` 25.8.0 is already installed in `node_modules`.
   - Google Chrome 151.0.7922.173 is installed at `/usr/bin/google-chrome`.
   - Together with `puppeteer-core`, tests can launch headless Chrome without downloading external browser packages.

3. **Static PWA Serving**:
   - The app does not require a build step or bundler. Files in `web/` are served directly.
   - Using an in-memory Node `http.createServer` inside test scripts allows standalone test execution with automatic port assignment and cleanup.

4. **Editor & Heft Automation Interface**:
   - The app exports all core singletons (`STATE`, `DB`, `EDITOR`, `HEFT`, `S`, `openPage`) to `window`.
   - Tests can invoke `window.STATE.dispatch('pageCreate', ...)` and `window.openPage(...)` to navigate, mutate state, or inspect internal structures.
   - UI interactions (keystrokes, mouse events, pointer/touch drawing events, drag-and-drop) can be driven via standard Puppeteer page methods (`page.keyboard`, `page.mouse`, `page.touchscreen`, `page.evaluate`).

5. **Visual Analysis & Screenshot Verification**:
   - Puppeteer's `page.screenshot({ type: 'png' })` captures pixel-accurate screenshots of Editor and Heft in light or dark mode and various viewport sizes.
   - Generated screenshots can be inspected directly via `view_file` to detect visual artifacts, clipping, layout glitches, or contrast issues.

---

## 3. Caveats

1. **System PATH**: The default terminal PATH lacks `/usr/lib/chatgpt/resources/cua_node/bin`. Commands must set `export PATH="/usr/lib/chatgpt/resources/cua_node/bin:$PATH"` or invoke the binary directly.
2. **Offline Mode & Network Errors**: During boot, background fetch checks for local AI / LM Studio (`localhost:1234`) or Cloudflare sync may produce benign `ERR_CONNECTION_REFUSED` console warnings if no local LLM is active. Tests should filter out expected connection errors when checking console health.
3. **Optional Modules**: Features like KaTeX rendering or PDF rendering dynamically load from CDN / cache (`optional-modules.js`). When running in headless tests with network access or local cache, KaTeX assets hydrate asynchronously.

---

## 4. Conclusion

The testing infrastructure in Impala67 is ready for headless automation, visual screenshot inspection, and stress testing:
- **Test Runner**: Node.js built-in runner (`node:test`) + ES modules (`node --test`).
- **Browser Automation**: `puppeteer-core` driving `/usr/bin/google-chrome`.
- **Server Harness**: Lightweight `node:http` server serving `web/`.
- **UI & State Control**: Fully accessible `window.STATE`, `window.EDITOR`, `window.HEFT`, and DOM selectors (`#blockEditor`, `#heftStage`).
- **Visual Capture**: Full screenshot capability producing inspectable PNGs.

---

## 5. Verification Method

To independently verify the test infrastructure, local server, and browser automation:

1. **Verify Node.js and npm**:
   ```bash
   export PATH="/usr/lib/chatgpt/resources/cua_node/bin:$PATH"
   node -v   # Expected: v24.19.0
   npm -v    # Expected: 11.17.0
   ```

2. **Verify Chrome Binary**:
   ```bash
   /usr/bin/google-chrome --version   # Expected: Google Chrome 151.x
   ```

3. **Verify Existing Test Suite**:
   ```bash
   export PATH="/usr/lib/chatgpt/resources/cua_node/bin:$PATH"
   npm test   # Expected: 282 tests pass
   ```

4. **Verify Live Browser Test & Screenshot**:
   - Inspect `.agents/explorer_infra/editor_rendered.png` and `.agents/explorer_infra/heft_rendered.png` using `view_file`.
