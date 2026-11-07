---
name: pwa-release-cache
description: Procedures for managing Service Worker caching, cache versioning, offline resilience, and PWA cache verification.
---

# PWA Release & Cache Management Skill

Use this skill whenever modifying static web assets in `web/`, updating `web/service-worker.js`, inspecting offline behavior, or running PWA cache verifications.

---

## 1. Golden Rules for Service Worker & Cache

1. **Cache Version Is Automatic**:
   * Do **not** bump the cache version in `web/service-worker.js` by hand. On every push, `deploy-pwa.yml` derives it from the release tags (`version-from-tags.mjs`, e.g. `2.2.124-dev.57`) and writes it via `set-version.mjs`.
   * New cached files only need to be added to `APP_FILES` in `web/service-worker.js`; verify with `npm run check:pwa`.
2. **Offline-First Resilience**:
   * The app must boot and load notes from IndexedDB completely offline without network access; the Rust core/WASM must start from the cached files.
   * Check cache fallback handling in `web/service-worker.js` for navigation and asset fetches.
3. **Release Workflow Isolation**:
   * Do not hand-edit version stamps in `package.json`/`web/version.json`; the CI sets them from release tags (`version-from-tags.mjs`, `set-version.mjs`).
   * Official releases are manual (`release.yml`); a push to `main` only deploys the PWA (`deploy-pwa.yml`).

---

## 2. Verification Workflow

* **Verify PWA cache asset list**:
  ```bash
  npm run check:pwa
  ```
  This runs `node .github/scripts/check-pwa-cache.mjs` and verifies that all required assets are present in the cache list.

* **Syntax check across web files**:
  ```bash
  npm run check:syntax
  ```

* **Verify full test suite & cache**:
  ```bash
  npm run verify
  ```
