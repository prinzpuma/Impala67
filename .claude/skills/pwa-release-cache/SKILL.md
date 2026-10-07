---
name: pwa-release-cache
description: Procedures for managing Service Worker caching, cache versioning, offline resilience, and PWA cache verification.
---

# PWA Release & Cache Management Skill

Use this skill whenever modifying static web assets in `web/`, updating `web/service-worker.js`, inspecting offline behavior, or running PWA cache verifications.

---

## 1. Golden Rules for Service Worker & Cache

1. **Cache Version Bumping**:
   * Any change to cached files in `web/` (`.js`, `.css`, `.html`, icons) requires bumping the cache version in `web/service-worker.js`.
   * Never leave the cache version unchanged when altering web client behavior.
2. **Offline-First Resilience**:
   * The app must boot and load notes from IndexedDB completely offline without network access.
   * Check cache fallback handling in `web/service-worker.js` for navigation and asset fetches.
3. **Release Workflow Isolation**:
   * In local development, avoid manually modifying release-only artifacts like `.github/workflows/release.yml` version stamps unless explicitly asked.
   * Automated release CI handles updating `web/version.json` and production cache versions.

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
