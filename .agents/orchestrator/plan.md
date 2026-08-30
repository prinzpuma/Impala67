# Testing & Exploration Master Plan

## 1. Objectives
Execute a rigorous, comprehensive headless test suite, stress test harness, and visual screenshot analysis of the Impala67 PWA (specifically Editor and Heft components), uncovering functional bugs, edge-case regressions, rendering glitches, and performance bottlenecks. Produce an exhaustive, prioritized bug report.

## 2. Tracks & Scope Decomposition

### Track 1: Editor Systematic Functional & Stress Testing (R1)
- Text formatting: Bold, italic, underline, strikethrough, inline code, headings (H1-H6), quotes, dividers
- Lists: Bulleted, numbered, nested lists, task/checkbox lists, indentation/outdentation
- Slash commands: `/math`, `/table`, `/code`, `/heft`, `/callout`, `/toggle`, etc.
- KaTeX Math Blocks: Rendering, live editing, invalid LaTeX syntax, large formulas, inline vs block math
- Tables: Row/column additions/deletions, cell navigation, text wrap/overflow, nested content
- Media & Images: Drag-and-drop, clipboard paste, resizing handles, broken URLs, large file sizes
- Undo/Redo & State Persistence: History stack integrity, autosave to IndexedDB, rapid undo/redo cycles
- Stress & Fuzzing: Rapid sequential typing, large document paste (10k+ words), special characters, unicode emojis, RTL text, HTML/XSS injection attempts

### Track 2: Heft Canvas, Tools & Stress Testing (R2)
- Drawing tools: Pen, highlighter (transparency/layering), eraser (stroke vs pixel), geometric shapes (rect, circle, triangle), lines, arrows, stroke width, color palette
- Selection & Transformation: Box select, lasso selection, multi-object move, scale, rotate, duplicate, delete
- Viewport & Navigation: Zoom in/out, pan, touch gestures/wheel events, viewport reset, coordinate boundaries
- Page Management: Add page, delete page, reorder pages, duplicate page, navigation between pages
- Mass Object & Memory Stress: Rapid stroke sequences (1000+ continuous strokes), hundreds of shapes/text nodes, heap memory profile, garbage collection behavior, frame-rate degradation
- Import / Export & PDF: Export to PDF, export to image (PNG/SVG), import background PDF, rendering accuracy across pages

### Track 3: Visual Screenshot & Image Analysis (R3)
- Headless Browser Setup: Playwright/Puppeteer with chromium in headless mode
- Viewport configurations: Desktop (1920x1080), Tablet/iPad (1024x768), Mobile (390x844)
- Theme Matrix: Light mode vs Dark mode
- Visual Artifacts: Element clipping, overflow issues, overlapping text, color contrast ratios, spacing/padding misalignment, broken icons, canvas artifacting

### Track 4: Bug Report Aggregation & Triage (R4)
- Triage criteria: Critical, High, Medium, Low
- Standard bug schema: Title, Severity, Symptoms (Visual/Functional), Reproduction Steps, Affected Component/File
- Verification of reproduction steps

## 3. Execution Phases
1. **Phase 1**: Codebase & Testing Setup Survey (Spec Miner / Explorers)
2. **Phase 2**: Parallel Execution of Editor & Heft automated headless & stress tests + Screenshot capture
3. **Phase 3**: Visual screenshot analysis & defect verification
4. **Phase 4**: Synthesis of comprehensive final Bug Report
