---
name: mobile-touch-ux
description: Guidelines and testing procedures for mobile UI, touch interactions, iPad desktop-view distinction, and iOS Safari quirks.
---

# Mobile & Touch UX Skill

Use this skill when modifying mobile layouts, touch navigation, gestures, responsive CSS, or iPad/phone behaviors in `web/platform.js`, `web/styles.css`, `web/css/layout.css`, and `web/app.js`.

---

## 1. Core Principles & Platform Differentiation

* **Phone vs. iPad Distinction**:
  * The PWA has **no phone UI** anymore (phones use the Android app). A phone in portrait (`pointer: coarse`, `orientation: portrait`, `max-width: 700px`) only sees the "Bitte quer halten" hint (`#rotateHint`, pure CSS); in landscape it gets the normal desktop/tablet layout.
  * The desktop layout must stay usable down to ~640px width (collapsible sidebar, tablet breakpoint `max-width: 1024px`).
* **iOS Safari & Touch Quirks**:
  * Avoid scroll bouncing / rubber-banding on full-screen containers (`overscroll-behavior: contain`).
  * Respect Safe Area Insets (`env(safe-area-inset-bottom)`, `env(safe-area-inset-top)`).
  * Handle dynamic viewport height changes when the virtual keyboard opens/closes.
* **Modal & Navigation Cleanliness**:
  * Switching tabs or mobile navigation routes must reliably close modals, palettes, and popups (`closeModals()`, `closeAll()`).

---

## 2. Verification Workflow

* **Syntax check**:
  ```bash
  node --check web/platform.js
  ```
* **Verify PWA cache**:
  ```bash
  npm run check:pwa
  ```
