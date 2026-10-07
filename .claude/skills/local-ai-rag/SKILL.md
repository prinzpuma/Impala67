---
name: local-ai-rag
description: Workflows for local embeddings, embedding web worker, RAG vector similarity search, and client-side AI key management.
---

# Local AI & RAG Skill

Use this skill when working on local embeddings, semantic search, retrieval-augmented generation (RAG), or AI integrations in `web/ai.js`, `web/embedding.js`, `web/embedding-worker.js`, and `web/rag.js`.

---

## 1. Core Principles & Security

* **User-Local Secrets**:
  * AI provider API keys (OpenAI, Anthropic, Gemini, etc.) must remain strictly in local browser storage (`localStorage` / IndexedDB).
  * Never commit keys, hardcode default credentials, or send keys through cloud sync.
* **Worker Isolation**:
  * Heavy vector embedding computations run inside `web/embedding-worker.js` to keep the main UI thread at 60fps.
  * Keep communication with the worker asynchronous with clear progress reporting (`onProgress`).
* **RAG Architecture**:
  * `web/embedding.js` is a decoupled, cycle-free bridge so `web/rag.js` does not circularly depend on `web/ai.js`.
  * Chunking and token limits must be strictly observed to avoid overflowing context windows or memory.

---

## 2. Verification Workflow

* **Verify syntax**:
  ```bash
  node --check web/embedding.js
  node --check web/embedding-worker.js
  node --check web/rag.js
  node --check web/ai.js
  ```
* **Run unit tests**:
  ```bash
  npm test
  ```
