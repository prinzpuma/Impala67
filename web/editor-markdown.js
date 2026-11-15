"use strict";

// Markdown (pg.content) ↔ Editor-Blöcke im Rust-Kern (core/impala-markdown). Die Blockobjekte
// haben dieselbe Form wie bisher ({ id, type, text, … }).
import { U } from "./util.js";
import { CORE } from "./rust-core.js";

export const FENCE = "``" + "`";
export const LISTY = { bullet: 1, number: 1, todo: 1 };

export const parse = (md, uidGenerator) => CORE.mdParse(String(md || ""), typeof uidGenerator === "function" ? uidGenerator : U.uid);
export const serialize = (blocks = []) => CORE.mdSerialize(blocks);
export const serializeBlock = (b) => CORE.mdSerializeBlock(b);
export const mimeFromName = (name) => CORE.mdMimeFromName(String(name || ""));
// Klartext eines Blocks (z. B. Vorderseite einer Karte aus einem Block).
export const plainTextOf = (b) => CORE.mdPlainText(b);

export const shortcutType = (line) => CORE.mdShortcutType(String(line || ""));
export const convertBlock = (block, targetType) => CORE.mdConvertBlock(block, targetType);
export const continuationBlock = (block, newId) => CORE.mdContinuationBlock(block, newId);
export const indentBlock = (block, delta) => CORE.mdIndentBlock(block, delta);
export const listNumbers = (blocks) => CORE.mdListNumbers(blocks);
export const wrapMarkers = (text, start, end, before, after) => CORE.mdWrapMarkers(String(text || ""), start, end, before, after);
