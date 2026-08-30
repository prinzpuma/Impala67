# BRIEFING — 2026-08-30T00:04:45Z

## Mission
Conduct thorough headless browser automated testing & stress testing of the Heft canvas system in Impala67 across all tools, viewport, pages, performance/memory, and import/export, discovering and systematically reporting all defects.

## 🔒 My Identity
- Archetype: specialist / implementer / qa
- Roles: [specialist, implementer, qa]
- Working directory: /home/jv232/Documents/Codex/2026-08-22/ka/Impala67/.agents/worker_heft_m2
- Original parent: 48f7e20a-6753-451c-842e-b1bdcc6d5d74
- Milestone: M2 (Heft Canvas & Stress Testing)

## 🔒 Key Constraints
- Genuine execution: All implementations and tests must be genuine, executed against real browser instances. No hardcoded results.
- Write tests in Node.js / Puppeteer-core using `/usr/bin/google-chrome` and local HTTP server on `web/`.
- Maintain `.agents/` discipline: test scripts for automation run from our worker directory (or scripts directory), no non-metadata in `.agents` committed to repo.
- Comprehensive defect documentation with Title, Severity, Visual/Functional symptoms, Reproduction steps, Affected source code lines.

## Current Parent
- Conversation ID: 48f7e20a-6753-451c-842e-b1bdcc6d5d74
- Updated: 2026-08-30T00:04:45Z

## Task Summary
- **What to build/test**: Full automated test suite for Heft canvas (Tools, Selection/Lasso/Transform, Viewport, Pages, Stress/Perf, Import/Export).
- **Success criteria**: Genuine automated headless test run covering all required areas, heap/fps analysis, systematic bug catalog in handoff report.
- **Interface contracts**: `web/heft.js`, `web/heft-*.js`, `web/index.html`.

## Key Decisions Made
- Use puppeteer-core with `/usr/bin/google-chrome` and Node environment (`export PATH="/usr/lib/chatgpt/resources/cua_node/bin:$PATH"`).

## Artifact Index
- `.agents/worker_heft_m2/handoff.md` — Final testing and defect report.
- `.agents/worker_heft_m2/progress.md` — Real-time progress log.

## Change Tracker
- **Files modified**: None yet.
- **Build status**: Pending test execution.
- **Pending issues**: None.

## Quality Status
- **Build/test result**: Pending.
- **Lint status**: N/A.
- **Tests added/modified**: Automated Puppeteer scripts to be created and executed.
