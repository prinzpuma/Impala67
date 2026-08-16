"use strict";

export function movePage(pages, from, to) {
	if (!Array.isArray(pages) || from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return false;
	const [page] = pages.splice(from, 1);
	pages.splice(to, 0, page);
	return true;
}

export function insertAt(position, current, length) {
	if (position === "start") return 0;
	if (position === "before") return Math.max(0, Math.min(current, length));
	if (position === "after") return Math.max(0, Math.min(current + 1, length));
	return Math.max(0, length);
}

export function canDeletePages(total, selected) {
	return selected > 0 && total - selected >= 1;
}
