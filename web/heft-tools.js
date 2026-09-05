"use strict";
import { U } from "./util.js";

export const TOOL_PREFS_KEY = "impala67HeftTools";

export const COLORS = ["#1c1c1e", "#2f6fed", "#e0483e", "#1f9d55", "#f5b800", "#8b7cc8"];
export const SIZES = [["F", 1.6], ["M", 3], ["B", 5.5]];
export const PAPERS = [["lined", "☰", "Liniert"], ["grid", "▦", "Kariert"], ["dots", "⣿", "Punkte"], ["blank", "▢", "Blanko"]];

export function loadToolPrefs(storage = U.storage) {
	const saved = (storage && storage.getJson ? storage.getJson(TOOL_PREFS_KEY, {}) : null) || {};
	return {
		color: saved.color || COLORS[0],
		size: typeof saved.size === "number" ? saved.size : 3,
		onlyPen: saved.onlyPen !== false,
		eraserSize: typeof saved.eraserSize === "number" ? saved.eraserSize : 16,
	};
}

export function saveToolPrefs(prefs = {}, storage = U.storage) {
	if (!storage || !storage.setJson) return false;
	return storage.setJson(TOOL_PREFS_KEY, {
		color: prefs.color || COLORS[0],
		size: typeof prefs.size === "number" ? prefs.size : 3,
		onlyPen: prefs.onlyPen !== false,
		eraserSize: typeof prefs.eraserSize === "number" ? prefs.eraserSize : 16,
	});
}
