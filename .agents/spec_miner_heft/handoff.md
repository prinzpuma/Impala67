# Specification Mining & Architecture Report: Heft (Canvas & Drawing Subsystem)

## 1. Observation

### 1.1 Source Code Inventory
The Heft subsystem in Impala67 is composed of the following ES modules and test suites:
- `web/heft.js` (3,546 lines): Central Heft orchestrator, UI chrome, multi-page DOM renderer, event dispatcher, tool handlers, scanner UI, and export pipeline.
- `web/heft-geometry.js` (150 lines): Pure geometric operations (bounding box calculation, stroke hit testing, polygon collision, affine translation, anchor-based scaling).
- `web/heft-pages-core.js` (20 lines): Page array manipulation (move, clamped insertion index, deletion guards).
- `web/heft-document-core.js` (87 lines): Document shadow calculation, differential operation generator (`diffDocument`), and 64-bit FNV+DJB hash generator (`blobId`).
- `web/heft-scan.js` (603 lines): Document scanning pipeline (`SCANCORE`): quad detection v4 with 4 segmentation masks, 8x8 Gaussian homography solver, bilinear perspective warp, separable box blur/morphology, per-channel background illumination correction, and Laplace edge sharpness analysis.
- `web/handschrift.js` (100 lines): Handwriting recognition v2: multimodal AI vision OCR (Gemini 2.5 / GPT-4.1 / GPT-4o) with fallback to local Tesseract OCR with image preprocessing and confidence filtering.
- `web/pdfs.js` (106 lines): PDF loader, text extractor, and ingest pipeline with automatic AI summarization into note pages.
- `test/heft-drawing.test.mjs` (298 lines): Unit and integration tests for canvas rendering, pinch-zoom, persistence retry, bbox culling, and lasso transforms.
- `test/benchmark-heft.mjs` (178 lines): Performance benchmark testing 10 to 10,000 strokes and image loads.
- `test/heft-geometry.test.mjs`, `test/heft-pages-core.test.mjs`, `test/heft-document-core.test.mjs`: Core module unit test suites.

---

### 1.2 DOM Structure & Canvas Layer Hierarchy
When `HEFT.mount(container, pageId)` is called, the target container receives the following element hierarchy:

```html
<div class="heft-stage" style="position: relative;">
  <!-- Main Scroll Container -->
  <div class="heft-scroll" style="touch-action: none; overflow: hidden;">
    
    <!-- Scaled Pages Layer (GPU transform applied here during gestures) -->
    <div class="heft-pages" style="transform: translate(-X px, -Y px) scale(K); will-change: auto;">
      
      <!-- One Slot per Page -->
      <div class="heft-page-slot" data-hepage="0">
        <!-- Layer 1: Base Canvas (Fills page at fitScale * safeDpr) -->
        <canvas class="heft-canvas"></canvas>
        <span class="heft-page-label">Seite 1</span>
      </div>
      <div class="heft-page-slot" data-hepage="1">...</div>
      
      <!-- Ghost button for adding pages by dragging/clicking at end -->
      <button type="button" class="heft-addpage" data-headdend="1">＋ Neue Seite</button>
    </div>

    <!-- Layer 2: Detail Canvases (Direct children of .heft-scroll, z-index: 2, pointer-events: none) -->
    <!-- Exactly renders the visible viewport slice at full native screen resolution -->
    <canvas class="heft-detail-canvas" style="position: absolute; z-index: 2; display: block; left: ...px; top: ...px; width: ...px; height: ...px;"></canvas>

    <!-- Layer 3: Live Wet Ink Canvases (Direct children of .heft-scroll, z-index: 3, pointer-events: none) -->
    <!-- Renders active in-flight strokes with zero latency before commit -->
    <canvas class="heft-wet-canvas" style="position: absolute; z-index: 3; display: none; left: ...px; top: ...px; width: ...px; height: ...px;"></canvas>
  </div>

  <!-- UI Chrome & Floating Toolbars -->
  <div class="heft-chrome" aria-hidden="false">
    <!-- Top-left Pages Button & Counter -->
    <button type="button" class="heft-corner heft-corner-l" data-hepagesmenu="1" title="Seiten">
      <svg ...></svg>
      <span class="heft-pageno-inline"></span>
    </button>

    <!-- Center Floating Pill Toolbar -->
    <div class="heft-float" role="toolbar" aria-label="Werkzeuge">
      <div class="heft-pill">
        <button type="button" data-hewrite="1" class="heft-main active">Stift/Marker ▾</button>
        <button type="button" data-hetool="eraser" class="heft-main">Radierer</button>
        <span class="heft-sep"></span>
        <button type="button" data-hetool="lasso" class="heft-main">Lasso</button>
        <button type="button" data-hetool="laser" class="heft-main heft-laser">Laserpointer</button>
        <span class="heft-sep"></span>
        <button type="button" data-heimgmenu="1" class="heft-main">Bilder/Text</button>
        <span class="heft-sep"></span>
        <button type="button" data-heundo="1" class="heft-main">Rückgängig</button>
        <button type="button" data-heredo="1" class="heft-main">Wiederholen</button>
        <span class="heft-sep"></span>
        <button type="button" data-hecollapse="1" class="heft-main heft-min-btn">Einklappen</button>
      </div>
    </div>

    <!-- Draggable Tool Options Tray (Expanded state) -->
    <div class="heft-tray" data-hetray="1" role="group" aria-label="Schreib-Optionen" style="left: ...px; top: ...px;">
      <button type="button" class="heft-tray-drag" data-hetraydrag="1">⠿</button>
      <button type="button" data-hetool="pen" class="heft-opt active">Stift</button>
      <button type="button" data-hetool="marker" class="heft-opt">Marker</button>
      <span class="heft-sep"></span>
      <!-- Sizes: F (1.6px), M (3.0px), B (5.5px) -->
      <button type="button" class="heft-size" data-hesize="1.6"><i style="height:1.5px"></i></button>
      <button type="button" class="heft-size active" data-hesize="3"><i style="height:3px"></i></button>
      <button type="button" class="heft-size" data-hesize="5.5"><i style="height:5px"></i></button>
      <span class="heft-sep"></span>
      <!-- 6 Palette Swatches -->
      <button type="button" class="heft-swatch active" data-hecolor="#1c1c1e" style="--sw:#1c1c1e;background:#1c1c1e"></button>
      <button type="button" class="heft-swatch" data-hecolor="#2f6fed" style="--sw:#2f6fed;background:#2f6fed"></button>
      <button type="button" class="heft-swatch" data-hecolor="#e0483e" style="--sw:#e0483e;background:#e0483e"></button>
      <button type="button" class="heft-swatch" data-hecolor="#1f9d55" style="--sw:#1f9d55;background:#1f9d55"></button>
      <button type="button" class="heft-swatch" data-hecolor="#f5b800" style="--sw:#f5b800;background:#f5b800"></button>
      <button type="button" class="heft-swatch" data-hecolor="#8b7cc8" style="--sw:#8b7cc8;background:#8b7cc8"></button>
      <span class="heft-sep"></span>
      <!-- Apple Pencil / Touch-Reject Toggle -->
      <button type="button" data-heonlypen="1" class="heft-opt active" title="Nur Stift zeichnet">Stylus/Finger</button>
    </div>

    <!-- Top-right Actions -->
    <div class="heft-corner-r">
      <button type="button" class="heft-corner heft-chat" data-hechat="1" title="KI-Chat">Sparkle</button>
      <button type="button" class="heft-corner heft-plus" data-heplusmenu="1" title="Seite hinzufügen">Plus</button>
    </div>
  </div>

  <!-- Dynamic Overlays / Feedback Indicators -->
  <div class="heft-eraser-ring" hidden style="width: 32px; height: 32px; left: ...px; top: ...px;"></div>
  <div class="heft-pop" data-kind="pages|plus|img" style="top: ...px; left: ...px;">...</div>
</div>
```

---

### 1.3 Coordinate Spaces & Matrix Transformations

1. **Page Coordinate System (Virtual A4 Space)**:
   - Fixed size: `PAGE_W = 1000`, `PAGE_H = 1414` (aspect ratio ~ 1 : √2).
   - All stroke points `[x, y, pressure]`, text boxes, image rectangles, and shape definitions are strictly persisted in Page Coordinate units.

2. **Viewport Coordinate System (`view`)**:
   - `view.x`, `view.y`: Top-left offset of the viewport in unscaled base layout coordinates.
   - `view.k`: Zoom level, clamped to `ZOOM_MIN = 0.4` to `ZOOM_MAX = 6.0`.
   - `fitScale`: Scale factor calculated during `layout()` such that page width fits the screen container width minus padding (`PAD_X = 18`).
   - Total visual scale: `scale = fitScale * view.k`.

3. **DOM Transform Equation**:
   During gestures/panning, `.heft-pages` is transformed via CSS:
   ```javascript
   const dprSnap = window.devicePixelRatio || 1;
   const snap = (v) => Math.round(v * dprSnap) / dprSnap;
   pgs.style.transform = `translate(${snap(-view.x * view.k)}px, ${snap(-view.y * view.k)}px) scale(${view.k.toFixed(4)})`;
   ```

4. **Detail Tile Transform Matrix**:
   Detail canvas is placed outside the transformed container directly inside `.heft-scroll`:
   ```javascript
   cv.style.left = snap((page.x + t.x - view.x) * view.k) + "px";
   cv.style.top = snap((page.y + t.y - view.y) * view.k) + "px";
   cv.style.width = (t.w * view.k) + "px";
   cv.style.height = (t.h * view.k) + "px";

   // 2D Context transform mapping page coordinates to tile pixels:
   const f = t.dpr * t.k;
   ctx.setTransform(t.dpr * t.scale, 0, 0, t.dpr * t.scale, -t.x * f, -t.y * f);
   ```

5. **Screen Pointer to Page Mapping**:
   ```javascript
   const pos = (e, cv) => {
     const r = cv.getBoundingClientRect();
     return [
       Math.round((e.clientX - r.left) / scale * 10) / 10,
       Math.round((e.clientY - r.top) / scale * 10) / 10,
       Math.round((e.pressure || 0.5) * 100) / 100,
     ];
   };
   ```

---

### 1.4 Event Handling & Gesture System

| Event Class | Listener Target | Mechanism & Handling |
|-------------|-----------------|----------------------|
| **Pointer Down** | `canvas.heft-canvas` | Captures pointer ID (`setPointerCapture`). Checks `onlyPen` and palm rejection (`PALM_UNDO_MS = 350`). Initializes live ink context (`liveInkCtx`), arms snap-to-shape timer (`armHoldSnap` = 550ms), activates `heft-writing` chrome state. |
| **Pointer Move** | `canvas.heft-canvas` | Pulls coalesced pointer events (`getCoalescedEvents()`). Appends points `[x, y, pressure]` to `drawing.pts`. Renders incremental quadratic bezier segment to `wetCanvas`. In lasso mode, draws dashed selection boundary. In move/resize mode, updates strokes via `translateStroke`/`scaleStrokeFrom` throttled to `requestAnimationFrame`. |
| **Pointer Up / Cancel** | `canvas.heft-canvas` | Clears hold timer, computes final stroke bounding box `strokeBounds(s)`, commits stroke to `pg.strokes`, renders to base + detail canvas (`commitStrokeRender`), clears live ink canvas (`clearLiveInk`), records undo action `pushUndo({ kind: "add", stroke, pageIdx })`, triggers thumbnail update (`renderThumb`), debounces IndexedDB sync (`scheduleSave` = 350ms), queues OCR indexing (`scheduleHandwritingIndexV2`). |
| **Touch Gestures (1-Finger)** | `.heft-scroll` | In `onlyPen` mode (stylus mode): 1 finger pans viewport smoothly. Momentum fling on release with decay coefficient `0.996^dt`. |
| **Touch Gestures (2-Finger)** | `.heft-scroll` | Pinch-to-zoom with focal point invariance (`touchMid`, `touchDist`). Re-calculates `view.k`, `view.x`, `view.y` simultaneously. Double-tap with 2 fingers triggers `undo()`. |
| **Touch Gestures (3-Finger)** | `.heft-scroll` | 3-finger quick tap triggers `redo()`. |
| **Double Tap (1-Finger)** | `.heft-scroll` | Toggles zoom between 1.0x and 2.2x centered on tap location. |
| **Mouse Wheel** | `.heft-scroll` | `Ctrl`/`Meta` + Wheel zooms exponentially (`view.k * exp(-deltaY * 0.0022)`). Standard wheel scrolls `view.x` / `view.y`. |
| **Hold-to-Erase** | `[data-hetool="eraser"]` | Pointerdown hold switches tool to eraser; releasing pointerup anywhere reverts back to prior tool without toggling permanent eraser mode. |
| **Snap-to-Shape** | In-flight stroke | Holding stationary for >550ms triggers `trySnapShape()` -> `fitShape()`. Automatically converts handwritten path to geometric `rect`, `ellipse`, or `line`, vibrates device (`navigator.vibrate(12)`). |
| **Pull-to-Add Page** | `.heft-scroll` | Pulling upward beyond bottom of last page by >12px reveals ghost button; pulling >70px arms button; releasing appends a new page with identical template (`addPageAtEnd()`). |

---

### 1.5 Stroke & Geometric Object Model

1. **Document Data Structure**:
   ```typescript
   interface HeftDoc {
     v: 2;
     rev: number;
     pages: HeftPage[];
   }

   interface HeftPage {
     id: string;                         // UUID
     paper: "lined" | "grid" | "dots" | "blank";
     strokes: HeftStroke[];
     images: HeftImage[];
     texts: HeftText[];
     ocrText?: string;
   }
   ```

2. **Stroke Representation**:
   ```typescript
   interface HeftStroke {
     id: string;                         // Unique ID (U.uid())
     tool: "pen" | "marker" | "shape" | "laser";
     color: string;                      // Hex code (e.g. "#1c1c1e")
     size: number;                       // Base width (1.6, 3, 5.5)
     pts: [number, number, number][];    // [x, y, pressure]
     shape?: {
       type: "line" | "rect" | "ellipse";
       x1?: number; y1?: number; x2?: number; y2?: number; // line, rect
       cx?: number; cy?: number; rx?: number; ry?: number; // ellipse
     };
     bbox?: { minX: number; minY: number; maxX: number; maxY: number };
   }
   ```

3. **Image Representation**:
   ```typescript
   interface HeftImage {
     id: string;
     ref: string;                        // Content-addressed hash "b<len>-<fnv><djb>"
     x: number;
     y: number;
     w: number;
     h: number;
   }
   ```

4. **Text Box Representation**:
   ```typescript
   interface HeftText {
     id: string;
     text: string;
     x: number;
     y: number;
     w: number;
     h: number;
     size?: number;                      // Default 30
     color?: string;
     hidden?: boolean;
   }
   ```

5. **Differential Replication Operations (`diffDocument`)**:
   - `pg+`: Add page `{ t: "pg+", at: index, page: { id, paper } }`
   - `pg-`: Delete page `{ t: "pg-", p: pageId }`
   - `pgo`: Reorder pages `{ t: "pgo", order: string[] }`
   - `pgp`: Change page paper template `{ t: "pgp", p: pageId, paper }`
   - `ocr`: Update handwriting OCR text `{ t: "ocr", p: pageId, text }`
   - `s+` / `i+` / `x+`: Insert stroke / image / text item `{ t: "s+", p: pageId, o: item }`
   - `s=` / `i=` / `x=`: Update stroke / image / text item `{ t: "s=", p: pageId, o: item }`
   - `s-` / `i-` / `x-`: Delete items `{ t: "s-", p: pageId, ids: string[] }`

---

## 2. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Rendering | Dual-Layer Canvas Architecture | Combines fixed base page canvas with dynamic high-DPI detail tile slice to guarantee 60 FPS gestures without blur. | Viewport `view.x`, `view.y`, `view.k`, `fitScale` | Base canvas + detail tile canvas | Bounds clamped to `MAX_RENDER_PIXELS` (6M) and `MAX_CANVAS_DIM` (4096) | `web/heft.js:766-1018` |
| 2 | Rendering | Live Wet Ink Layer | Transient canvas at z-index 3 drawing real-time quadratic bezier strokes before commit. | In-flight pointer events | Real-time stroke preview | Cleared and committed to base/detail on pointer up | `web/heft.js:1020-1061` |
| 3 | Rendering | Bounding-Box Culling | Detail tile skips drawing strokes outside its visible page sub-rectangle in O(1) per stroke. | Stroke `s.bbox`, `tileRect` | Sub-set stroke drawing | Generates `s.bbox` lazily if null | `web/heft.js:620-628`, `web/heft-geometry.js:48-69` |
| 4 | Rendering | Offscreen Page Memory Culling | Collapses canvases of pages farther than 3.5 viewport heights away to 1x1 px. | `visiblePageIndices()`, `pageIndicesWithin()` | Canvas DOM element width/height = 1 | Re-expanded and redrawn on scroll into view | `web/heft.js:1062-1095` |
| 5 | Tools | Pressure-Sensitive Pen | Freehand drawing using quadratic bezier midpoints and pressure-modulated stroke width `segW(size, p)`. | Pointer event with pressure | Antialiased smooth ink strokes | Pressure defaults to 0.5 if unsupported | `web/heft.js:505-538` |
| 6 | Tools | Semi-Transparent Highlighter (Marker) | Flat translucent stroke with `globalAlpha = 0.32` and 3x line width. | Pointer coordinates | Highlight overlay | Preserves underlying ink readability | `web/heft.js:517-521` |
| 7 | Tools | Whole-Stroke Eraser | Removes entire touched strokes instantly with visual eraser ring feedback following cursor. | Pointer move with `eraserSize` | Stroke removed from `pg.strokes` | Distance-thresholded to prevent redundant collision checks | `web/heft.js:1305-1343` |
| 8 | Tools | Temporary Hold-to-Erase | Long-pressing eraser icon switches tool to eraser temporarily; releasing reverts to previous tool. | Pointerdown on eraser button | Tool state switch | Resets on pointerup / cancel | `web/heft.js:3310-3323` |
| 9 | Tools | Laser Pointer | Transient presentation laser trail that automatically fades out after 900ms without saving. | Pointer stroke | Transient canvas trail | Auto-cleans `laserTimers` and redraws page | `web/heft.js:1400-1404, 1637-1641` |
| 10 | Tools | Automatic Shape Snapping (`fitShape`) | Holding pointer still for >550ms converts hand-drawn stroke into line, rectangle, or ellipse. | Last 8+ points of active stroke | Geometric shape object | Reverts to raw stroke if error deviation > threshold | `web/heft.js:1477-1522` |
| 11 | Selection | Lasso Tool | Encloses strokes within arbitrary drawn polygon (`pointInPolygon`) for group manipulation. | Drawn closed polygon | Selected stroke subset `lassoSel` | Dismisses on outside touch tap | `web/heft.js:1382-1399, 1616-1622` |
| 12 | Selection | Lasso Translation & Scaling | Moves or scales selected strokes proportionally from anchor with bounding box and handle. | Pointer drag on box / handle | Modifies stroke points & bboxes in place | Clamped to page boundaries and factor limits (0.15 - 6.0) | `web/heft.js:1537-1557` |
| 13 | Selection | Lasso Duplicate & Delete | Clones or deletes all strokes in current lasso selection. | Click on toolbar buttons or Delete key | Modified `pg.strokes` | Generates new UUIDs for cloned strokes | `web/heft.js:2149-2175, 3269-3273` |
| 14 | Typography | Rich Text Box Insertion | Adds editable multiline text box with word wrapping, custom size, and font rendering. | Double tap on empty space or menu | `HeftText` item on page | Inline textarea overlay during editing | `web/heft.js:540-567, 2020-2088` |
| 15 | Media | Image Insertion & Manipulation | Inserts images with aspect-ratio scaling, corner resize handle, delete button, and hit testing. | File picker / Camera / Paste | `HeftImage` item referencing blob | Auto-converted to content-addressed hash `blobRef` | `web/heft.js:1436-1456, 2333-2349` |
| 16 | Navigation | Infinite Virtual Canvas Pan & Zoom | Smooth pan and zoom from 0.4x to 6.0x with focal invariance and inertia momentum fling. | Wheel, pinch, double tap | Updated `view.x`, `view.y`, `view.k` | Clamped to document content bounds (`clampView`) | `web/heft.js:749-757, 1160-1284` |
| 17 | Pages | Multi-Page Management | Reorder via drag & drop, template selection (lined, grid, dots, blank), pull-to-add, duplicate, delete. | Page menu popover | Updated `doc.pages` | Guarded: prevents deleting last remaining page | `web/heft.js:1902-1984, 2204-2246` |
| 18 | Pages | Multi-Page Batch Deletion | Multi-select mode with swipe-to-select allowing batch deletion with automatic snapshot backup. | Multi-select checkbox gestures | Pruned `doc.pages` | Creates local safety snapshot before deletion | `web/heft.js:1955-1972, 2233-2246` |
| 19 | History | Page-Anchored Undo / Redo | History stack supporting stroke addition, erasure, lasso moves, resizing, text/image edits. | Undo/Redo triggers | State restoration | Anchored to immutable `pageId` (resilient to page index drift) | `web/heft.js:1678-1721` |
| 20 | History | Local Version Snapshots (`Verlauf`) | Automated time-stamped document snapshots stored in IndexedDB with 24h TTL and restore UI. | Auto-snapshot every 10 min | Snapshot blob in DB | Prunes snapshots older than 24h / max 20 | `web/heft.js:359-440` |
| 21 | Import | Multi-Page PDF & Image Import | Ingests PDF documents via pdf.js rendering pages at 3x scale into background image pages. | PDF ArrayBuffer / Image files | Appended/inserted `HeftPage` items | Graceful fallback if pdf.js fails | `web/heft.js:2262-2307, 2368-2391` |
| 22 | Export | High-DPI PDF & PNG Export | Renders selected or all pages at 300 DPI (`2480px` width) into custom PDF-1.4 stream or PNG files. | Export dialog selections | PDF Blob / PNG File array | Uses Web Share API with fallback to direct download | `web/heft.js:2995-3128` |
| 23 | Scanner | Mobile Document Scanner (`SCANCORE`) | Camera stream with real-time paper edge detection, perspective homography rectification, illumination leveling, and filters (Color, B/W, Gray, Photo). | MediaStream video / Image | Rectified 300 DPI document scan | Interactive 4-corner post-adjustment UI if auto-detect is imperfect | `web/heft.js:2395-2990`, `web/heft-scan.js:1-603` |
| 24 | Intelligence | Multimodal Handwriting OCR | Multimodal AI vision transcription with local Tesseract fallback for handwriting search indexing. | Rendered page canvas | Text string saved in `page.ocrText` | Scheduled during browser idle time (`requestIdleCallback`) | `web/handschrift.js:1-100`, `web/heft.js:114-170` |
| 25 | Embeds | Note-Heft Bi-Directional Embedding | Embeds live Heft thumbnail previews into editor markdown notes via `:::heft <pageId>`. | Markdown token `:::heft` | Interactive preview card with page count | Auto-updates thumbnail when heft changes | `web/heft.js:3515-3531` |

---

## 3. Edge Cases & Stress Vectors

| # | Feature / Vector | Input / Stress Condition | Observed Behavior & Safeguard |
|---|------------------|--------------------------|--------------------------------|
| 1 | High Density Strokes | 1,000 to 10,000 rapid strokes on a single page | Handled efficiently without UI lockup. Bounding-box culling skips offscreen strokes on detail tiles; stroke translation updates `s.bbox` in O(1) without recomputing point arrays. |
| 2 | Rapid Stroke Ingestion | Pointer events firing faster than frame rate | Coalesced events (`e.getCoalescedEvents()`) are batched into single stroke points; live ink rendering executes on wet canvas; screen redraws are throttled to 1 per RAF frame. |
| 3 | Palm Rejection & Stray Touches | Palm resting on screen immediately before Apple Pencil tip touches | Stylus touch down triggers `PALM_UNDO_MS` (350ms) rollback restoring previous viewport position; CSS text selection is cleared to eliminate stray highlight artifacts. |
| 4 | Undo After Page Reordering | User draws stroke on Page 0, moves Page 0 to Page 4, then presses Undo | Undo entries record immutable `pageId` instead of volatile `pageIdx`. Resolves correct page regardless of insertions, deletions, or sorting. |
| 5 | Deletion of All Pages | User attempts to delete every page in the document | `canDeletePages(total, selected)` forbids deleting the last remaining page (`total - selected >= 1`). Single page delete button is disabled when `pages.length === 1`. |
| 6 | Extreme Zoom Levels | Zooming out to 0.4x or in to 6.0x | `clampView` limits zoom range to `[0.4, 6.0]`. Detail tile DPR budget restricts memory to `MAX_RENDER_PIXELS` (6M) and `MAX_CANVAS_DIM` (4096px) preventing WebKit canvas crash. |
| 7 | Subpixel Jitter on HiDPI | Fractional scroll coordinates on 2x/3x Retina screens | Transforms are explicitly rounded to physical device pixel boundaries (`snap = Math.round(v * dpr) / dpr`), preventing blurry bilinear texture resampling. |
| 8 | Massive Image Blobs | Inserting 50MB+ of high-resolution camera photos | Blobs are deduplicated and content-addressed via 64-bit FNV+DJB hash (`blobRef`); images are stored in IndexedDB separate from event payloads; UI decodes images asynchronously before export. |
| 9 | Multi-Device Concurrent Drawing | Two devices draw on the same page simultaneously | Differential `diffDocument` transmits fine-grained `s+` operations with unique stroke UUIDs. Conflict-free merger in `state.js:applyHeftOps` appends unique strokes without duplicating. |
| 10 | Camera Hardware Disconnect | User revokes camera permission or device sleeps during scan | `showCameraStopped` cleanly stops active tracks, cancels live Laplace evaluation loop, and displays non-blocking photo upload fallback button without crashing. |
| 11 | Large PDF Ingestion (100+ Pages) | User imports a large multi-page PDF book | Each page rendered at 3x scale into separate canvas, converted to compressed JPEG (0.92 quality) blob; memory is released iteratively per page during import. |
| 12 | High-Resolution Export Memory | Exporting 50-page notebook to 300 DPI PDF (2480px per page) | `pdfBlob` yields to the browser event loop between pages (`await nextFrame()`), allowing memory garbage collection and preventing UI freeze. |

---

## 4. Logic Chain

1. **Local-First & Event Sourcing Alignment**:
   - As observed in `web/heft-document-core.js` and `web/state.js`, Heft does not save monolithic JSON files or overwrite entire canvas states.
   - Every modification (stroke added `s+`, erased `s-`, transformed `s=`, page added `pg+`, page moved `pgo`) is converted into minimal differential operations via `diffDocument(shadow, nextDoc)`.
   - This ensures synchronization payloads are compact (a few bytes per stroke) and allows seamless multi-device concurrent drawing and cloud replication.

2. **Dual-Layer Rendering Rationale**:
   - Scaling a single DOM canvas directly via GPU transforms during zooming causes severe pixelation on high-DPI screens.
   - Conversely, resizing a 10,000-stroke canvas dynamically during a 60 FPS pinch gesture causes frame drops and high CPU/GPU load.
   - The dual-layer design solves this:
     - Base canvas remains fixed at `fitScale * safeDpr` inside the hardware-accelerated `.heft-pages` container (`will-change: transform` during gesture).
     - Upon gesture completion (`touchend` or settle timer), `sharpen()` renders the exact viewport slice onto `.heft-detail-canvas` at full native device resolution.
     - Live wet ink renders to `.heft-wet-canvas` at z-index 3 to ensure instant visual feedback.

3. **Stroke Representation & Geometry Performance**:
   - As observed in `web/heft-geometry.js`, strokes store bounding boxes `s.bbox`.
   - Translation modifies `s.pts` and shifts `s.bbox` in O(1) time without recalculating min/max coordinates across thousands of points.
   - Detail tile rendering applies bounding-box culling against `tileRect`, skipping offscreen strokes entirely.

---

## 5. Caveats

- **WebGL Acceleration**: The current canvas renderer uses the HTML5 Canvas 2D API (`CanvasRenderingContext2D`) rather than WebGL or WebGPU. While highly optimized with bounding box culling, extreme pages with >20,000 complex bezier strokes may experience slight render latency during initial tile generation.
- **Hardware Stylus Pressure Support**: Pressure sensitivity relies on the browser's Pointer Events API (`e.pressure`). On devices or browsers lacking pressure hardware, pressure falls back gracefully to a default value of `0.5`.
- **Offline OCR**: Multimodal AI vision OCR requires network connectivity to the configured AI provider. If offline, the system falls back to locally cached Tesseract.js.

---

## 6. Conclusion

The Heft drawing subsystem in Impala67 is a mature, production-grade, local-first vector canvas architecture designed for tablet and desktop note-taking:
- **Resilient State & Event Log**: Clean differential syncing via `heftOps` and immutable content-addressed image blobs (`heftBlobs`).
- **High-Performance Rendering**: Triple-canvas compositing (Base + Detail Tile + Wet Ink) with DPR budget clipping, bounding box culling, and offscreen page memory collapsing.
- **Comprehensive Toolset**: Pen, marker, stroke eraser, transient laser pointer, snap-to-shape hold engine, full-featured lasso group transforms, text boxes, and image tools.
- **Robust Multi-Page & File Pipeline**: Multi-page sorting, batch deletion with safety snapshots, 300 DPI PDF/PNG exports, and built-in mobile document scanner.

---

## 7. Verification Method

To verify the Heft canvas engine, geometry math, and document kernel:

```bash
# Run all unit and integration test suites for Heft
/home/jv232/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/heft-*.test.mjs

# Run benchmark test measuring rendering times up to 10,000 strokes
/home/jv232/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node test/benchmark-heft.mjs
```

All 17 unit and integration tests pass deterministically.
