# Context & Environment

## Target Application: Impala67
- Type: Static PWA (local-first, ES modules without bundler)
- Core components:
  - Editor (`web/editor.js`, `web/editor-*.js`, related CSS)
  - Heft (`web/heft.js`, `web/heft-*.js`, canvas rendering, tools, PDF export/import)
  - State & Persistence (`web/state.js`, `web/db.js`, IndexedDB)
- Testing Environment: Headless Chromium (Playwright/Puppeteer/Node.js/live server)
- OS: Linux
- Goal: Systematically test, stress test, capture visual states in Light & Dark modes, and produce a prioritized bug report.
