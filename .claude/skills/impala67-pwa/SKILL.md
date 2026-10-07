---
name: impala67-pwa
description: Project skill for Notion (Impala67). Covers local-first PWA architecture (native ES modules, IndexedDB), Cloudflare Sync Protocol v4 (WebSockets, Durable Objects, D1, R2, E2EE), Notion two-way sync, Service Worker offline caching, and testing workflows.
---

# Notion (Impala67) Project Skill

Use this skill when developing, refactoring, or testing within the **Notion** project repository (`Impala67`).

---

## 1. Core Architecture & Constraints

* **Local-First PWA**:
  * All user data lives primarily in browser **IndexedDB** (`web/db.js`, `web/state.js`).
  * Pure **native ES modules** without bundler/build step; `web/` is the deployed static app.
  * Free-tier design: Built to run without dedicated paid app servers.
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
2. **Modular Extraction**: Keep large UI orchestrators (`heft.js`, `editor.js`, `state.js`) from growing. Extract domain logic into focused, testable ES modules with stable APIs.
3. **Service Worker & Cache**:
   * Any change to cached app assets requires bumping the Service Worker cache version.
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
* Push to `main` deploys the static PWA automatically via GitHub Pages (`.github/workflows/release.yml`).
