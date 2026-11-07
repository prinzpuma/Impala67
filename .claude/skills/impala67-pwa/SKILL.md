---
name: impala67-pwa
description: Project skill for Notion (Impala67). Covers local-first PWA architecture (native ES modules, IndexedDB), Cloudflare Sync Protocol v4 (WebSockets, Durable Objects, D1, R2, E2EE), Notion two-way sync, Service Worker offline caching, and testing workflows.
---

# Notion (Impala67) Project Skill

Use this skill when developing, refactoring, or testing within the **Notion** project repository (`Impala67`).

---

## 1. Core Architecture & Constraints

* **Local-First PWA**:
  * All user data lives primarily in browser **IndexedDB**; the data model, reducers, sync and backup logic run in the shared **Rust core** (WASM in the PWA). `web/db.js` and `web/state.js` are the I/O and query layer (`ModelCore`, `state-views.js`), not the source of truth.
  * Pure **native ES modules** without bundler/build step; `web/` is the deployed static app.
  * Free-tier design: Built to run without dedicated paid app servers. Native Android (`android/`) and iPad (`ios/`) apps use the same core via `core/impala-ffi`.
* **Cloudflare Sync (Protocol v4)**:
  * Backend (`server/`): Worker + Durable Objects (real-time WebSockets), D1 (index/quota metadata), R2 (encrypted event bundles & blobs).
  * Wire events never contain local sequence numbers (`seq`). Incoming events always receive a fresh local IndexedDB key.
  * Payloads must be strictly bounded by actual UTF-8 bytes, not just character counts.
* **Sync Transports & Echo Suppression**:
  * Both Cloudflare and Google Drive operate alongside each other.
  * External events record `_remoteSource` (`"cloudflare"` or `"drive"`). Each transport suppresses only its own echo so Drive acts as a complete independent backup.

---

## 2. Development & Code Health Rules

1. **Root-Cause Fixes**: Fix issues at their root; do not duplicate business rules across multiple files.
2. **Modular Extraction**: Keep large UI orchestrators (`heft.js`, `editor.js`, `app.js`, `render.js`) from growing. Extract domain logic into focused, testable ES modules with stable APIs; non-UI logic belongs in `core/` (Rust).
3. **Service Worker & Cache**:
   * Do **not** bump the cache version by hand: `deploy-pwa.yml` derives it from the release tags and sets it via `set-version.mjs` on every push.
   * New app files only need to be added to `APP_FILES` in `web/service-worker.js`; then run `npm run check:pwa`.
   * Verify offline startup and hard-reload behaviors.
4. **Secrets & Security**:
   * Never commit API keys, tokens, or `web/config.local.js`.
   * PWA only holds public client IDs; user AI provider keys remain in local browser storage.

---

## 3. Testing & Verification Workflows

* **Run targeted unit tests first**:
  ```bash
  npm test
  ```
  Run individual test files before full test runs to keep context short and clear.
* **Inspect before release**:
  ```bash
  git diff --check
  ```
* Push to `main` deploys the static PWA automatically via GitHub Pages (`.github/workflows/deploy-pwa.yml`). Official releases (Android APK) are manual (`release.yml`); the iPad app builds as an unsigned IPA (`ios-build.yml`).
