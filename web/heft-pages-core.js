"use strict";

// Seitenverwaltung im Rust-Kern (core/impala-heft pages.rs).
import { CORE } from "./rust-core.js";

export function movePage(pages, from, to) {
	if (!Array.isArray(pages) || !(from >= 0) || !(to >= 0)) return false;
	const order = CORE.heftMovePage(pages.length, from, to);
	if (!order) return false;
	const before = pages.slice();
	order.forEach((i, at) => { pages[at] = before[i]; });
	return true;
}

export const insertAt = (position, current, length) => CORE.heftInsertAt(String(position || ""), Math.max(0, current | 0), Math.max(0, length | 0));

export const canDeletePages = (total, selected) => CORE.heftCanDeletePages(Math.max(0, total | 0), Math.max(0, selected | 0));
