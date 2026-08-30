# Editor Component — Authoritative Specification & Mining Report

**Module**: `web/editor.js` & Related Subsystems  
**Date**: 2026-08-30  
**Archetype**: Specification Miner  
**Target Path**: `/home/jv232/Documents/Codex/2026-08-22/ka/Impala67/.agents/spec_miner_editor/handoff.md`

---

## 1. Observation

Direct code examination and behavioral verification of `web/editor.js`, `web/styles.css`, `web/mobile.css`, `web/util.js`, `web/render.js`, `web/app.js`, and test suites (`test/editor-fixes.test.mjs`, `test/editor-math-block.test.mjs`, `test/editor-slash-heft.test.mjs`, `test/code-block-layout.test.mjs`).

### 1.1 Architecture & Core Lifecycle
- **Exported Interface**: `EDITOR = { mount, parse, serialize, undoRedo, undo, redo }` (`web/editor.js:2718`).
- **Data Model**: `blocks` is an array of plain JavaScript block objects representing the authoritative state of the current editor session.
- **Roundtrip Flow**:
  1. `mount(host, pageId)`: Invoked by `render.js:651`. Parses `S.pages[pageId].content` into `blocks` via `parse(md)`.
  2. Incremental DOM Reconciliation: `render()` uses `U.morph(host, html)` keyed by `data-key` (block ID, image src, math src, file src) to avoid tearing down DOM elements, preserving focus, scroll, and media playback.
  3. Live Typing Sync: Input events trigger `syncFieldToModel(field)` and `handleLiveTriggers(field, e)` without full re-render.
  4. Debounced Persistence: `save(now)` serializes `blocks` to Markdown via `serialize()` and calls `STATE.dispatch("pageUpdate", { id, patch: { content }, viaEditor: true })` with a 450ms debounce and queues page for RAG embedding (`RAG.queuePage(pageId)`).
  5. Custom Undo/Redo Engine: Managed in `undoStacks[pageId]` / `redoStacks[pageId]` with snapshot JSON, caret position, and scroll top (`HISTORY_LIMIT = 200`, `HISTORY_PAGES = 3`, typing debounce 700ms).

### 1.2 Block Model Definitions
| Type | Structure | Markdown Syntax | Rendered DOM Structure |
|---|---|---|---|
| `p` | `{ id, type: "p", text, textColor?, bgColor? }` | `Paragraph text` | `<div class="blk-text" data-btext="<id>" contenteditable="true">` |
| `h1` | `{ id, type: "h1", text, textColor?, bgColor? }` | `# Heading 1` | `<div class="blk-text blk-h1" data-btext="<id>">` |
| `h2` | `{ id, type: "h2", text, textColor?, bgColor? }` | `## Heading 2` | `<div class="blk-text blk-h2" data-btext="<id>">` |
| `h3` | `{ id, type: "h3", text, textColor?, bgColor? }` | `### Heading 3` | `<div class="blk-text blk-h3" data-btext="<id>">` |
| `bullet` | `{ id, type: "bullet", indent, text, ... }` | `- List item` or `* ` or `+ ` | `<div class="blk-li"><span class="blk-marker">•</span><div class="blk-text"></div></div>` |
| `number` | `{ id, type: "number", indent, text, ... }` | `1. Numbered item` | `<div class="blk-li"><span class="blk-marker blk-num" data-bnum="<id>">1.</span><div class="blk-text"></div></div>` |
| `todo` | `{ id, type: "todo", checked, indent, text, ... }` | `- [ ] Todo` or `- [x] Done` | `<div class="blk-li"><span class="blk-marker"><input type="checkbox" data-btodo="<id>"></span><div class="blk-text"></div></div>` |
| `quote` | `{ id, type: "quote", text, ... }` | `> Quote text` | `<blockquote class="blk-quote"><div class="blk-text"></div></blockquote>` |
| `divider` | `{ id, type: "divider" }` | `---` | `<hr class="blk-hr">` |
| `code` | `{ id, type: "code", language, text }` | ```` ```lang\ncode\n``` ```` | `<div class="blk-codewrap"><button class="blk-codelang">lang</button><pre class="blk-code"><code class="blk-text" data-bcode="<id>"></code></pre></div>` |
| `math` | `{ id, type: "math", text }` | `$$\nformula\n$$` or `\[formula\]` | `<div class="blk-math" data-bmath="<id>"><span class="blk-mathview" data-mathsrc="..."></span></div>` |
| `image` | `{ id, type: "image", src, alt }` | `![alt](src)` | `<figure class="blk-img"><img data-imgsrc="..."><figcaption></figcaption></figure>` |
| `file` | `{ id, type: "file", src, name }` | `:::file <src> <name>` | `<figure class="blk-file" data-filesrc="..." data-fileblk="<id>">` (video/audio/pdf/download) |
| `heft` | `{ id, type: "heft", heftId }` | `:::heft <heftId>` | `<button class="blk-heft" data-heftembed="<heftId>" data-page="<heftId>">` |
| `table` | `{ id, type: "table", rows: string[][] }` | GFM pipe table (`\| col1 \| col2 \|`) | `<div class="blk-tablewrap"><table class="blk-table">...</table><button class="blk-tbtn-col">+</button><button class="blk-tbtn-row">+</button></div>` |
| `callout` | `{ id, type: "callout", color, children }` | `> [!color]\n> children` | `<div class="blk-callout blk-callout-<color>"><button class="blk-calloutdot"></button><div class="blk-children">...</div></div>` |
| `toggle` | `{ id, type: "toggle", summary, open, children }` | `<details open><summary>sum</summary>\n\nchildren\n</details>` | `<div class="blk-toggle"><button class="blk-togglearrow">▾</button><div data-bsummary="<id>"></div><div class="blk-children blk-togglebody"></div></div>` |
| `columns` | `{ id, type: "columns", columns: Block[][] }` | `:::columns\ncol1\n:::split\ncol2\n:::end` | `<div class="blk-columns"><div class="blk-column" data-bcolumn="<bid>:0">...</div></div>` |

### 1.3 DOM Elements, Selectors, and Dataset Map
- `#blockEditor`: Outer editor container mounted inside `#main`. Has class `.block-editor` and `data-owned="1"`.
- `.blk[data-blk="<bid>"][data-btype="<type>"][data-key="<bid>"]`: Outer block element.
- `.blk-gutter`: Left gutter container (hidden on mobile via `.mobile-ui .blk-gutter { display: none !important; }`).
  - `.blk-plus[data-bplus="<bid>"]`: Inserts a new paragraph block below with `/` pre-filled.
  - `.blk-handle[data-bhandle="<bid>"][draggable="true"]`: Block drag handle & block menu opener.
- `.blk-body`: Content container for block contents.
- Contenteditable fields:
  - `[data-btext="<bid>"]`: Rich-text editable for `p`, headings, lists, quotes.
  - `[data-bsummary="<bid>"]`: Summary field for toggle blocks.
  - `[data-bcell="<bid>:<rowIndex>:<colIndex>"]`: Individual table cell editable.
  - `[data-bcode="<bid>"]`: Code block plain-text editable.
- Interactive controls:
  - `[data-btodo="<bid>"]`: Checkbox toggle.
  - `[data-btogglearrow="<bid>"]`: Arrow button to expand/collapse toggle.
  - `[data-bcalloutcolor="<bid>"]`: Color cycle button (`blue -> green -> yellow -> red -> gray -> purple`).
  - `[data-bcodelang="<bid>"]`: Language prompt button.
  - `[data-btablecol="<bid>"]`: Add column button.
  - `[data-btablerow="<bid>"]`: Add row button.
  - `[data-fdl="<bid>"]`: Download file button.
  - `[data-btail="1"]`: Clickable bottom margin spacer (min-height 25dvh) to append a new paragraph.
  - `.child-page-row[data-page="<pageId>"]`: Subpage link row at bottom of document.

---

## 2. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|---|---|---|---|---|---|---|
| 1 | Parser / Serializer | Markdown Roundtrip | Converts full Markdown to block AST and vice-versa | Markdown string | Block objects AST | Fallback to `p` block; sanitizes control chars | `editor.js:322-587` |
| 2 | Parser | Nested Details / Toggles | Handles arbitrarily nested `<details>` with `<summary>` | Nested HTML `<details>` | Recursive `toggle` AST | Closes unbalanced tags safely | `editor.js:415-442` |
| 3 | Parser | Callouts | Parses `> [!color]` with nested block children | Markdown blockquote | `callout` AST with `children` | Defaults color to `blue` | `editor.js:444-456` |
| 4 | Parser | Multi-Columns | Recursive column parsing with `:::columns`, `:::split`, `:::end` | Fenced column syntax | `columns` AST with array of lists | Auto-inserts `p` in empty columns | `editor.js:393-412` |
| 5 | Parser | Tables | Parses GFM pipe tables (`\| a \| b \|`) with header separator | GFM table markdown | `table` AST with 2D `rows` array | Minimum 2x2 dimension guarantee | `editor.js:468-483` |
| 6 | Parser | Math Blocks | Parses `$$...$$` and `\[...\]` display formulas | LaTeX display math | `math` AST block | Preserves raw LaTeX text on parse | `editor.js:356-382` |
| 7 | Parser | Inline Math | Renders `$formula$` and `\(formula\)` to `.blk-imath` chips | Inline math delimiters | Span chips with `data-md` | Masked `\$` ignored; error returns raw text | `editor.js:207-228` |
| 8 | Parser | Media Detection | Identifies `.mp4`, `.mp3`, `.pdf`, etc. in `![alt](url)` and converts to `file` | Markdown image tag with audio/video/pdf | `file` AST block | Unknown types become download attachments | `editor.js:488-500` |
| 9 | Parser | Color Metadata | Parses and emits `<!--@c:<textColor>;bg:<bgColor>-->` comments | HTML comment annotations | Applies `textColor` / `bgColor` to block | Invalid format ignored | `editor.js:325, 540` |
| 10| Live Typing | Markdown Triggers | `# `, `## `, `### `, `- `, `* `, `+ `, `1. `, `[] `, `> ` | Space after prefix | Live transformation to matching block | None (keeps plain text) | `editor.js:1536-1587` |
| 11| Live Typing | Auto Separator / Code / Math | `---` -> divider, ```` ``` ```` -> code, `$$` -> math | Exact text trigger | Replaces block with structure block | None | `editor.js:1588-1613` |
| 12| Live Typing | Live Inline Markdown | Closes `**`, `*`, `` ` ``, `~~`, `==`, `<u>`, `$`, `\[` immediately | Delimiter typing | Live HTML rendering + caret compensation | None | `editor.js:1614-1632` |
| 13| Slash Menu | Command Palette | Opens slash palette on `/` or `/query` | Typing `/` + search | Popover `.blk-slashmenu` | Closes if no matching item found | `editor.js:1223-1265` |
| 14| Slash Menu | Command Execution | Converts block or inserts structure block (`19` commands) | Click / Enter on item | Transforms model & updates DOM | Warns on error & shows toast | `editor.js:1267-1336` |
| 15| Link Menu | `[[` Page Linker | Searches active workspace pages on `[[` with 80ms debounce | Typing `[[` + query | Popover `.blk-linkmenu` | "Keine Seite gefunden" message | `editor.js:1339-1369` |
| 16| Block Menu | Handle Operations | Umwandeln (Turn into), Color picker, Duplicate, Copy MD, Flashcard, Delete | Click `⋮⋮` handle | Popover `.blk-blockmenu` | Closes on blur / outside click | `editor.js:1372-1400` |
| 17| Math Popover | Formula Editor | Popup textarea for editing block & inline LaTeX formulas | Click on math block or inline chip | `.blk-mathpop` modal | Esc cancels, Enter commits | `editor.js:1403-1445` |
| 18| Table Editor | Cell Navigation & Growth | Tab / Shift+Tab / Enter / Backspace navigation | Keyboard events in `data-bcell` | Focuses target cell; adds row/col | Preserves table on Backspace (prevents loss) | `editor.js:2058-2115` |
| 19| Selection | Two-Stage Ctrl+A | 1st Ctrl+A selects field text; 2nd Ctrl+A selects all blocks | `Ctrl+A` / `Cmd+A` | `.selected` class on all blocks | None | `editor.js:1727-1741` |
| 20| Selection | Cross-Block Drag Selection| Dragging mouse across block boundaries selects block range | Mouse mousedown + mouseover | `.selected` on block range | Cancels on click | `editor.js:2418-2439` |
| 21| Selection | Block Shortcuts | Enter (edit), Delete/Backspace (delete), Ctrl+C (copy MD), Ctrl+X, Ctrl+D | Keydown during block selection | Executes bulk operation on blocks | Safe fallback navigation | `editor.js:2157-2254` |
| 22| Navigation | Boundary Jump | ArrowUp / ArrowDown at start/end of multiline text block | Arrow keys at boundary | Focuses neighbor block | Prevents browser trap | `editor.js:2011-2053` |
| 23| Drag & Drop | Block Reordering | Dragging block handle above/below neighbor blocks | Drag handle drop | Splices block order in array | Boundary checks prevent nesting loss | `editor.js:2442-2488` |
| 24| Drag & Drop | File / Media Drops | Dragging files from OS onto editor surface | File drop event | Puts blob in DB, inserts image/file | Error toast if blob write fails | `editor.js:2460-2471` |
| 25| Clipboard | Paste Handling | Pasting files (blobs), multi-line markdown blocks, or text | Clipboard paste event | Converts to file block, block AST, or text | Single history checkpoint | `editor.js:2491-2529` |
| 26| History | Local-First Undo/Redo | App-level undo/redo preserving caret, scroll, & structure | `Ctrl+Z` / `Ctrl+Y` / Topbar | Restores JSON snapshot | Toast: "Nichts rückgängig zu machen" | `editor.js:716-769` |
| 27| Sync Integration| External Sync Protection | `viaEditor: true` flag and `lastSaved` tracking | Remote IndexedDB update vs local edit | Suppresses destructive re-renders | Re-parses only on genuine external diff | `editor.js:2698-2712` |

---

## 3. Keyboard Shortcuts Specification

| Shortcut | Scope / Focus | Action | Target / Function |
|---|---|---|---|
| `Ctrl/Cmd + Z` | Window / Editor | Undo last action | `EDITOR.undo()` (`undoRedo(false)`) |
| `Ctrl/Cmd + Y` or `Ctrl/Cmd + Shift + Z` | Window / Editor | Redo last action | `EDITOR.redo()` (`undoRedo(true)`) |
| `Ctrl/Cmd + A` | Focused editable field | 1st press: Select text in field; 2nd press: Select all blocks | Two-stage `ctrlAArmed` |
| `Ctrl/Cmd + B` | Text selection | Bold formatting toggle (`**`) | `wrapSelection("**", "**")` |
| `Ctrl/Cmd + I` | Text selection | Italic formatting toggle (`*`) | `wrapSelection("*", "*")` |
| `Ctrl/Cmd + U` | Text selection | Underline formatting toggle (`<u>`) | `wrapSelection("<u>", "</u>")` |
| `Ctrl/Cmd + E` | Text selection | Inline code formatting toggle (`` ` ``) | `wrapSelection("\x60", "\x60")` |
| `Ctrl/Cmd + Shift + S`| Text selection | Strikethrough formatting toggle (`~~`) | `wrapSelection("~~", "~~")` |
| `Ctrl/Cmd + Shift + H`| Text selection | Highlight with `lastColor` (`{bg-color}`) | `colorWrap(lastColor)` |
| `Ctrl/Cmd + K` | Text selection | Prompt for URL & wrap as `[text](url)` | Inline link modal |
| `Ctrl/Cmd + D` | Block / Selection | Duplicate current block or selected block range | `cloneBlock` with new IDs |
| `Ctrl/Cmd + Shift + 0`| Text block | Convert to Paragraph (`p`) | `turnInto(b, "p")` |
| `Ctrl/Cmd + Shift + 1`| Text block | Convert to Heading 1 (`h1`) | `turnInto(b, "h1")` |
| `Ctrl/Cmd + Shift + 2`| Text block | Convert to Heading 2 (`h2`) | `turnInto(b, "h2")` |
| `Ctrl/Cmd + Shift + 3`| Text block | Convert to Heading 3 (`h3`) | `turnInto(b, "h3")` |
| `Ctrl/Cmd + Shift + 4`| Text block | Convert to To-do List item (`todo`) | `turnInto(b, "todo")` |
| `Ctrl/Cmd + Shift + 5`| Text block | Convert to Bullet List item (`bullet`) | `turnInto(b, "bullet")` |
| `Ctrl/Cmd + Shift + 6`| Text block | Convert to Numbered List item (`number`) | `turnInto(b, "number")` |
| `Ctrl/Cmd + Shift + 7`| Text block | Convert to Toggle List (`toggle`) | `turnInto(b, "toggle")` |
| `Ctrl/Cmd + Shift + 8`| Text block | Convert to Code Block (`code`) | `turnInto(b, "code")` |
| `Ctrl/Cmd + Shift + Up`| Text block | Move block up in parent list | `c.list.splice(ni, 0, ...)` |
| `Ctrl/Cmd + Shift + Down`| Text block | Move block down in parent list | `c.list.splice(ni, 0, ...)` |
| `Tab` | List item | Increase indent level (max = prev.indent + 1) | `b.indent++` |
| `Shift + Tab` | List item | Decrease indent level | `b.indent--` |
| `Tab` | Table cell | Next cell / wrap / append row | `handleTableKeys` |
| `Shift + Tab` | Table cell | Previous cell / wrap | `handleTableKeys` |
| `Tab` | Code block | Insert 2 spaces (`  `) | `document.execCommand("insertText", false, "  ")` |
| `Enter` | Text block | Split block at caret into new block | `splitFieldAtCaret` |
| `Shift + Enter` | Text block | Insert soft line break (`<br>`) | Browser native |
| `Enter` | Empty list item | Outdent or convert to `p` | `turnInto(b, "p")` |
| `Enter` | Toggle summary | Open toggle, add child if empty, focus child | `b.open = true` |
| `Enter` | Table cell | Move to cell below / append row | `handleTableKeys` |
| `Backspace` | Start of list item | Outdent or convert to `p` | `b.indent--` / `turnInto(b, "p")` |
| `Backspace` | Start of paragraph | Merge text with predecessor block | `mutate({ boundary })` |
| `Delete` | End of paragraph | Merge successor block text into current | `b.text += next.text` |
| `ArrowUp / Down` | Block boundary | Move focus to adjacent block | `focusNeighbor(nb, d)` |
| `Escape` | Text block | Exit to Block Selection Mode on outer block | `selectTopOf(b)` |
| `Escape` | Menu / Math Popover | Close open menu / popover | `closeMenus()` |
| `Ctrl/Cmd + C` | Block Selection Mode | Copy selected blocks as serialized Markdown | Clipboard write |
| `Ctrl/Cmd + X` | Block Selection Mode | Cut selected blocks as Markdown | Clipboard write + delete |

---

## 4. Slash Commands Directory

| Command | Key (`k`) | Icon | Label | Action & Behavior | Focus Target |
|---|---|---|---|---|---|
| `/p` | `p` | ¶ | Text | Transforms block to simple paragraph (`p`) | `data-btext="<bid>"` |
| `/h1` | `h1` | H1 | Überschrift 1 | Transforms block to Heading 1 (`h1`) | `data-btext="<bid>"` |
| `/h2` | `h2` | H2 | Überschrift 2 | Transforms block to Heading 2 (`h2`) | `data-btext="<bid>"` |
| `/h3` | `h3` | H3 | Überschrift 3 | Transforms block to Heading 3 (`h3`) | `data-btext="<bid>"` |
| `/todo` | `todo` | ☑ | To-do-Liste | Transforms block to checkbox task item | `data-btext="<bid>"` |
| `/bullet` | `bullet` | • | Aufzählung | Transforms block to bullet point list item | `data-btext="<bid>"` |
| `/number` | `number` | 1. | Nummerierte Liste | Transforms block to numbered list item | `data-btext="<bid>"` |
| `/toggle` | `toggle` | ▸ | Toggle-Liste | Converts to `<details>` toggle list with summary | `data-bsummary="<bid>"` |
| `/quote` | `quote` | ” | Zitat | Converts to blockquote (`quote`) | `data-btext="<bid>"` |
| `/callout` | `callout` | 💡 | Callout | Wraps text in highlighted callout box (`blue`) | `data-btext` of child block |
| `/code` | `code` | </> | Code | Creates code block with language selector | `data-bcode="<bid>"` |
| `/math` | `math` | √ | Gleichung | Creates display KaTeX block and opens Math popover | `.blk-mathinput` popover |
| `/table` | `table` | ▦ | Tabelle | Inserts 2x2 table grid | `data-bcell="<bid>:0:0"` |
| `/columns` | `columns` | ▫▫ | 2 Spalten | Creates 2-column layout container | `data-btext` in column 0, block 0 |
| `/divider` | `divider` | — | Trennlinie | Inserts horizontal rule (`---`) | New `p` block below |
| `/image` | `image` | 🏞 | Bild | Opens file picker (`image/*`), stores blob in DB | `img[data-imgsrc]` |
| `/file` | `file` | 📎 | Datei / Medien | Opens file picker (all formats), stores blob in DB | `.blk-file` |
| `/heft` | `heft` | 📓 | Heft | Dispatches `pageCreate` for Heft and embeds preview | `.blk-heft` |
| `/link` | `link` | 🔗 | Seite verlinken | Inserts `[[` and opens page link menu | `.blk-linkmenu` |

---

## 5. Edge Cases & Stress Test Attack Vectors

```
## Edge Cases
| # | Feature | Input / Condition | Observed / Documented Behavior |
|---|---------|-------------------|--------------------------------|
| 1 | KaTeX | Unclosed LaTeX block `$$\begin{pmatrix} 1 & 2` | Handled gracefully: `parse()` reads to EOF without crashing; `hydrateKatex` catches error with `throwOnError: false` |
| 2 | KaTeX | Escaped dollar `\$5 and \$10` | Regex `(?<!\\)\$` skips escaped dollars; rendered as plain text without math chip |
| 3 | KaTeX | Inline formula editing `\(x^2 + 1\)` | `openMathPop` extracts delimiters `\(` / `\)`; editing preserves original delimiter pair |
| 4 | Tables | 50x50 table or cells containing pipe `\|` | Parsed via regex `(?<!\\)\|`; cells escape pipes as `\|` and newlines as spaces |
| 5 | Tables | Backspace in empty cell (0,0) | Backspace is trapped (`e.preventDefault()`) so entire table is NEVER accidentally deleted |
| 6 | Tables | Delete key at preceding block end | Selects entire table block (`selectTopOf(next)`), requiring explicit 2nd Delete to delete |
| 7 | Toggles | Nested `<details>` tags | Multi-level depth counter in parser prevents premature closing and preserves hierarchy |
| 8 | Toggles | Backspace in empty summary | Converts toggle to paragraph if children are empty; unwraps children into list if non-empty |
| 9 | Callouts | Pasting Markdown into callout | Pasted multi-line list/text creates genuine child blocks inside callout |
| 10| Columns | Mobile viewport (<640px) | CSS `@media (max-width: 640px)` applies `flex-direction: column; gap: 0` |
| 11| Media | `.mp4` / `.pdf` inside `![alt](file.mp4)` | Parser intercepts non-image MIME types and converts to `file` block instead of broken `<img>` |
| 12| Undo/Redo| Rapid typing across 200+ actions | 700ms debounce batches continuous typing into logical checkpoints; stack capped at `HISTORY_LIMIT=200` |
| 13| Undo/Redo| Page switching during open debounce | `mount()` forces immediate `save(true)` and `commitHistory()` before changing `pageId`, preventing cross-page history bleed |
| 14| Selection | Double Ctrl+A -> Ctrl+C copy | 2nd Ctrl+A enters block selection; custom `Ctrl+C` serializes block slice to clipboard |
| 15| Caret | Backspace merge across formatting chips | `mutate({ boundary })` injects temporary `<span data-caret-boundary>` ensuring pixel-exact caret placement |
| 16| DOM | Rapid typing without full re-render | `syncFieldToModel` updates model in-place; `U.morph` only touches DOM when structure changes |
| 17| Security | Control chars & zero-width chars | `INVISIBLES_RE` (`\u200B`, `\u200D`, `\uFEFF`) stripped during `mdFromEditable` |
| 18| Drag/Drop| Dragging file over editor | `dragover` checks `e.dataTransfer.types.includes("Files")` and calls `preventDefault()` |
```

---

## 6. Logic Chain

1. **Local-First Consistency**: The block editor maintains an internal AST (`blocks`) which is synchronized synchronously on DOM input events and persisted asynchronously via debounced `STATE.dispatch("pageUpdate")`.
2. **Lossless Markdown Roundtrip**: Every block type maps 1:1 to a Markdown representation (`#`, `- `, `> [!color]`, `<details>`, `:::columns`, `$$\n...$$`, `:::file`, `:::heft`). Unrecognized or raw HTML is preserved as paragraph text.
3. **DOM Stability & Morphing**: `U.morph` prevents destructive redraws. `data-key` attributes on blocks, media, and math elements allow live updates while retaining media playback and caret focus.
4. **Boundary Caret Precision**: Merging blocks via Backspace/Delete uses DOM boundary markers (`data-caret-boundary`) rather than string character offsets, which prevents offset miscalculations caused by rich-text nodes (`<a>`, `<u>`, `.blk-imath`).
5. **Robust Fault Isolation**: KaTeX loading and rendering are guarded by `WeakSet` hydration tracking and `throwOnError: false`. Failed network loads fall back gracefully to raw LaTeX strings without throwing fatal exceptions.

---

## 7. Caveats

- **No Multi-User Conflict Resolution (CRDT)**: Local-first Markdown serialization is optimized for single-user editing and E2EE Cloudflare/Drive sync. Concurrent real-time keystroke collaboration on the same document block is not supported.
- **Mobile Gutter Absence**: On mobile devices (`body.mobile-ui`), `.blk-gutter` (plus and handle buttons) is hidden (`display: none !important`), and block transformations rely on slash commands or markdown triggers.
- **Large Document Performance**: For documents exceeding ~5,000 blocks, while `findContext` uses an indexed map (`ctxIdx`), single-pass serialization remains O(N).

---

## 8. Conclusion

`web/editor.js` implements a highly refined, production-grade Notion-like block editor operating entirely on local-first ES-modules without external build chains or bundlers. All public APIs, AST data structures, event bindings, keyboard mappings, and edge cases have been completely mined and documented.

---

## 9. Verification Method

To verify editor functionality and regression test suite:
```bash
# 1. Run all unit tests for the editor and math blocks
node --test test/editor-fixes.test.mjs test/editor-math-block.test.mjs test/editor-slash-heft.test.mjs test/code-block-layout.test.mjs

# 2. Run full verification suite
npm run verify
```
