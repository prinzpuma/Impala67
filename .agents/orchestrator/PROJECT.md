# Project: Impala67 Headless Testing, Visual Analysis & Bug Hunting

## Architecture & Scope
Impala67 is a local-first static PWA with rich note-taking (Editor) and freehand canvas/drawing (Heft).
Testing scope covers:
- Editor: formatting, slash menus, KaTeX, tables, media/drag-drop, undo/redo, rapid inputs, Unicode/special chars
- Heft: drawing tools, lasso/selection, viewport/pan/zoom, page management, dense stroke fuzzing, mass objects, PDF handling
- Visual Inspection: screenshots across viewports, dark/light modes, spacing, contrast, clipping, rendering glitches
- Reporting: comprehensive prioritized bug report with reproduction steps and affected components.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Editor Core Formatting & Lists | Headings, bold, italic, lists, tasklists, indentation | M1 (Editor) | ORIGINAL_REQUEST §R1 |
| 2 | Slash Commands & KaTeX | Slash menu (`/math`, `/table`, `/code`), KaTeX rendering & live edit | M1 (Editor) | ORIGINAL_REQUEST §R1 |
| 3 | Tables & Media | Table manipulation, image drag/drop, resize, clipboard | M1 (Editor) | ORIGINAL_REQUEST §R1 |
| 4 | Editor Persistence & Stress | Undo/Redo, IndexedDB autosave, rapid inputs, long text stress | M1 (Editor) | ORIGINAL_REQUEST §R1 |
| 5 | Heft Drawing & Shape Tools | Pen, highlighter, eraser, lines, arrows, rect, circle | M2 (Heft) | ORIGINAL_REQUEST §R2 |
| 6 | Selection, Transform & Lasso | Object selection, move, scale, rotate, duplicate, lasso | M2 (Heft) | ORIGINAL_REQUEST §R2 |
| 7 | Viewport & Page Management | Zoom, pan, bounds, page add/delete/reorder/dup | M2 (Heft) | ORIGINAL_REQUEST §R2 |
| 8 | Heft Stress & Performance | 1000+ stroke sequences, mass objects, memory profile | M2 (Heft) | ORIGINAL_REQUEST §R2 |
| 9 | Heft Import/Export & PDF | Background PDF import, export to PDF/PNG | M2 (Heft) | ORIGINAL_REQUEST §R2 |
| 10| Visual Capture & Analysis | Dark/Light mode screenshots, layout clipping, contrast | M3 (Visual) | ORIGINAL_REQUEST §R3 |
| 11| Bug Synthesis & Triage | Consolidated prioritized bug report with repro steps | M4 (Report) | ORIGINAL_REQUEST §R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | Survey & Infra | Map test infra, existing test runner, page structures | none | DONE |
| M1 | Editor Testing (R1) | Headless functional + stress tests in Editor | M0 | IN_PROGRESS |
| M2 | Heft Testing (R2) | Headless canvas, tools, performance + stress in Heft | M0 | IN_PROGRESS |
| M3 | Visual Analysis (R3)| Screenshot captures & image analysis in Light/Dark modes | M0 | IN_PROGRESS |
| M4 | Bug Report (R4) | Final consolidated, prioritized bug report | M1, M2, M3 | PLANNED |
