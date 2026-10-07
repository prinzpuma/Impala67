---
name: cloudflare-sync-v4
description: Workflows and rules for Cloudflare Sync Protocol v4, E2EE (End-to-End Encryption), R2 event packages, D1 quota/indexing, and client-side compaction.
---

# Cloudflare Sync Protocol v4 Skill

Use this skill when working on sync features, E2EE encryption, WebSocket communication, conflict handling, or compaction in `web/sync-cloudflare.js`, `web/sync-crypto.js`, `web/sync-core.js`, `web/sync-maintenance.js`, and `server/`.

---

## 1. Core Principles & Protocol Constraints

* **Protocol Version**: Strictly **v4**.
* **D1 vs. R2 Storage Separation**:
  * **D1** stores solely index and quota metadata. Never store inline payloads in D1.
  * **R2** stores encrypted event packages and binary blobs.
* **Wire Event Constraints**:
  * Wire events must **never** contain local `seq` or replay metadata.
  * Incoming wire events must always receive a brand-new local IndexedDB key upon insertion.
* **Size & Byte Limits**:
  * Large sync payloads must be strictly bounded by **UTF-8 byte count** (e.g. via `TextEncoder`), never by string character count (`.length`).
* **Echo Suppression**:
  * Remote events carry their origin in `_remoteSource` (`"cloudflare"` or `"drive"`).
  * Each transport only suppresses its own echo. Never suppress across transports so Google Drive continues to serve as an independent backup.
* **First-Sync & Bundling**:
  * Initial states must be bundled into bounded event packages before E2EE encryption. Do not upload individual granular events as separate R2 objects.
* **Compaction / Generation Cut**:
  * Compaction runs client-side as a clean generation cut:
    1. Synchronize completely with Cloudflare.
    2. Call `/api/reset` on the worker.
    3. Re-upload compacted state and active referenced blobs from local IndexedDB.

---

## 2. Testing & Verification

* **Unit tests for crypto & sync**:
  ```bash
  node --test test/sync.test.mjs
  ```
* **Browser E2E sync test**:
  ```bash
  npm run test:e2e
  ```
* **Wrangler dry-run for server changes**:
  ```bash
  npm run dry-run
  ```
