---
name: mobile-touch-ux
description: Guidelines and testing procedures for mobile UI, touch interactions, iPad desktop-view distinction, and iOS Safari quirks.
---

# Mobile & Touch UX Skill

Use this skill when modifying mobile layouts, touch navigation, gestures, responsive CSS, or iPad/phone behaviors in `web/mobile.js`, `web/mobile-view.js`, `web/mobile.css`, and `web/app.js`.

---

## 1. Core Principles & Platform Differentiation

* **Phone vs. iPad Distinction**:
  * Phone UI is strictly for phones: narrow viewports (`<= 700px`) or landscape touch devices with phone height (`<= 500px`).
  * iPads (portrait from 744px width, landscape from 744px height) use the **Desktop/iPad view**, not the phone shell.
  * Always use `APP.PLATFORM.phoneQuery` in JavaScript and avoid ad-hoc coarse pointer media queries that accidentally catch iPads.
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
  node --check web/mobile.js
  node --check web/mobile-view.js
  ```
* **Verify PWA cache**:
  ```bash
  npm run check:pwa
  ```
