---
name: web-vitals-performance
description: Web performance optimization based on Google Core Web Vitals (INP, CLS, LCP), layout thrashing prevention, DOM batching, memory leak mitigation, and Apple HIG touch ergonomics.
---

# Web Vitals & Performance Engineering Skill

Use this skill when diagnosing UI lags, optimizing typing/scrolling responsiveness, reducing memory consumption, auditing mobile battery efficiency, or improving touch ergonomics.

---

## 1. Google Core Web Vitals & Responsiveness Standards

1. **Interaction to Next Paint (INP < 200ms)**:
   * Typing in the editor and tapping buttons must trigger visual feedback within 200ms (ideally < 50ms).
   * Debounce heavy computations (such as markdown parsing or search indexing).
   * Offload expensive workloads to Web Workers (`embedding-worker.js`) or defer via `requestIdleCallback` / `requestAnimationFrame`.
2. **Cumulative Layout Shift (CLS < 0.1)**:
   * Reserve layout space for asynchronously loaded elements (avatars, images, cards) using explicit dimensions or CSS aspect ratios to avoid jumping content.
3. **Prevent Layout Thrashing (Forced Synchronous Layouts)**:
   * **Never interleave DOM reads and DOM writes inside loops.**
   * Separate read phase (e.g. `element.offsetHeight`, `getBoundingClientRect()`) from write phase (e.g. `element.style.width`, `element.classList.add()`).

---

## 2. Memory & Mobile Resource Discipline

1. **Memory Leak Mitigation**:
   * Always pair `addEventListener` with a corresponding removal or leverage `AbortController` signals for automatic cleanup when views or modals unmount.
   * Disconnect `ResizeObserver`, `IntersectionObserver`, and `MutationObserver` instances when components close.
2. **Background & Battery Efficiency**:
   * Pause animation loops and throttle network polling when `document.visibilityState === "hidden"`.
3. **Touch Ergonomics (Apple HIG & W3C WCAG 2.2)**:
   * All interactive mobile touch targets must maintain a minimum bounding size of **44 × 44 CSS pixels** to prevent mis-taps.
   * Ensure text contrast ratios reach at least **4.5:1** for standard text against backgrounds in both light and dark themes.

---

## 3. Verification & Performance Check

* **Syntax & Module Checks**:
  ```bash
  npm run check:syntax
  ```
* **Verify Cache & Assets**:
  ```bash
  npm run check:pwa
  ```
* **Automated Test Suite**:
  ```bash
  npm test
  ```
