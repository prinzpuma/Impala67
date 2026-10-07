---
name: community-clean-refactor
description: Structured refactoring and code cleanup based on Martin Fowler's Refactoring Catalog, the Two-Hats rule, and Clean Architecture principles.
---

# Community Clean Refactoring Skill (Martin Fowler Standard)

Use this skill when cleaning up legacy code, breaking down oversized files (like `heft.js`, `editor.js`, `state.js`), eliminating dead code, or consolidating duplicated logic.

---

## 1. The Two-Hats Rule (Martin Fowler)

* **Strict Separation of Concerns**:
  * **Hat 1 (Refactoring)**: Change code structure **without** altering observable behavior. All existing tests must pass identically before and after.
  * **Hat 2 (Feature/Bugfix)**: Add new capabilities or fix a defect. Do not perform structural cleanups at the same time.
  * **Never wear both hats simultaneously.** Mixing them causes elusive regression bugs.

---

## 2. Refactoring Catalog & Code Smell Checklist

1. **Long Functions (>50 lines)**:
   * Apply *Extract Function*: Isolate self-contained calculations or DOM manipulations into pure helper functions.
2. **Duplicated Logic (DRY Violation)**:
   * Apply *Consolidate Duplicate Conditional Fragments* or *Extract Shared Module*.
   * Ensure business rules live in exactly one single source of truth (as required by `AGENTS.md`).
3. **Oversized Orchestrators**:
   * Extract domain logic out of UI orchestrators into small, testable ES modules with stable, documented APIs.
4. **Dead Code Elimination**:
   * Before deleting functions, variables, or CSS classes, search the entire codebase (`grep_search`) to confirm zero active callers or event-bound references.
5. **Preserve Native Architecture**:
   * Never introduce Node-dependent build tools, bundlers, or transpilers during refactoring. Retain clean, standard browser ES modules.

---

## 3. Step-by-Step Refactoring Protocol

1. **Baseline Verification**:
   ```bash
   npm test
   npm run check:syntax
   ```
   Confirm all tests pass *before* touching a single line.
2. **Atomic Modification**:
   * Apply exactly one refactoring pattern at a time (e.g. rename, extract, or move).
3. **Immediate Verification**:
   * Re-run tests immediately after the atomic change. If anything fails, revert immediately.
4. **Final Integrity Check**:
   ```bash
   npm run verify
   git diff --check
   ```
