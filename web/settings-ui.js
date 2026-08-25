"use strict";

import { U } from "./util.js";

const e = (value) => U.esc(String(value ?? ""));

export const ICONS = Object.freeze({
	home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5M9 20v-6h6v6"/>',
	sliders: '<path d="M4 7h10M18 7h2M14 4v6M4 17h2M10 17h10M7 14v6"/>',
	appearance: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2.2-.8 1.6-1.9-.6-1.2.2-2.6 1.6-2.6H17a4 4 0 0 0 4-4C21 7.3 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
	sparkles: '<path d="m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2L12 3ZM6 14l.8 2.2L9 17l-2.2.8L6 20l-.8-2.2L3 17l2.2-.8L6 14ZM18 12l.7 1.8 1.8.7-1.8.7L18 17l-.7-1.8-1.8-.7 1.8-.7L18 12Z"/>',
	sync: '<path d="M20 7h-6V1"/><path d="M20 7a9 9 0 0 0-15.5-2M4 17h6v6"/><path d="M4 17a9 9 0 0 0 15.5 2"/>',
	archive: '<path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6"/>',
	gamepad: '<path d="M7 8h10a5 5 0 0 1 4.7 6.7l-1 2.8a2.5 2.5 0 0 1-4.2 1l-1.8-2H9.3l-1.8 2a2.5 2.5 0 0 1-4.2-1l-1-2.8A5 5 0 0 1 7 8Z"/><path d="M7 11v4M5 13h4M16.5 12.5h.01M18.5 14.5h.01"/>',
	search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
	chevron: '<path d="m9 18 6-6-6-6"/>',
	check: '<path d="m5 12 4 4L19 6"/>',
});

export function icon(name, className = "") {
	return '<svg class="settings-icon ' + e(className) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.sliders) + "</svg>";
}

export function page(title, description, content) {
	return '<header class="settings-page-head"><h2>' + e(title) + '</h2><p>' + e(description) + '</p></header><div class="settings-page-content">' + content + "</div>";
}

export function group(title, content, options = {}) {
	const id = options.id ? ' id="' + e(options.id) + '" data-settings-anchor' : "";
	const danger = options.danger ? " is-danger" : "";
	return '<section class="settings-group' + danger + '"' + id + '><h3>' + e(title) + '</h3><div class="settings-group-card">' + content + "</div>" + (options.footnote ? '<p class="settings-footnote">' + e(options.footnote) + "</p>" : "") + "</section>";
}

export function row({ id, title, description = "", leading = "", trailing = "", className = "", tag = "div" }) {
	return "<" + tag + (id ? ' id="' + e(id) + '" data-settings-anchor' : "") + ' class="settings-row ' + e(className) + '">' +
		(leading ? '<span class="settings-row-leading">' + leading + "</span>" : "") +
		'<span class="settings-row-copy"><b>' + e(title) + "</b>" + (description ? "<small>" + e(description) + "</small>" : "") + "</span>" +
		(trailing ? '<span class="settings-row-control">' + trailing + "</span>" : "") + "</" + tag + ">";
}

export function toggle(id, title, description, checked, attrs = "") {
	const control = '<label class="settings-switch"><input id="' + e(id) + '" type="checkbox"' + (checked ? " checked" : "") + (attrs ? " " + attrs : "") + ' aria-label="' + e(title) + '"><span aria-hidden="true"></span></label>';
	return row({ id: attrs.includes("data-anchor-id") ? "" : undefined, title, description, trailing: control });
}

export function segmented(id, options, current, label) {
	return '<div id="' + e(id) + '" class="settings-segmented" role="group" aria-label="' + e(label) + '">' + options.map((option) =>
		'<button type="button"' + (option.id ? ' id="' + e(option.id) + '"' : "") + (option.data ? " " + option.data : "") + ' class="' + (option.value === current ? "active" : "") + '" aria-pressed="' + (option.value === current ? "true" : "false") + '">' + e(option.label) + "</button>"
	).join("") + "</div>";
}

export function field(label, id, value, options = {}) {
	const tag = options.multiline ? "textarea" : "input";
	const attrs = [options.type && 'type="' + e(options.type) + '"', options.placeholder && 'placeholder="' + e(options.placeholder) + '"', options.autocomplete && 'autocomplete="' + e(options.autocomplete) + '"', options.explicit && "data-settings-explicit"].filter(Boolean).join(" ");
	const control = tag === "textarea"
		? '<textarea id="' + e(id) + '" rows="' + (options.rows || 4) + '" ' + attrs + ">" + e(value) + "</textarea>"
		: '<input id="' + e(id) + '" value="' + e(value) + '" ' + attrs + ">";
	return '<label class="settings-input-row" for="' + e(id) + '"><span><b>' + e(label) + "</b>" + (options.description ? "<small>" + e(options.description) + "</small>" : "") + "</span>" + control + "</label>";
}

export function actions(buttons, className = "") {
	return '<div class="settings-actions ' + e(className) + '">' + buttons.map((button) => '<button type="button"' + (button.id ? ' id="' + e(button.id) + '"' : "") + (button.data ? " " + button.data : "") + ' class="' + e(button.className || "") + '"' + (button.hidden ? " hidden" : "") + (button.disabled ? " disabled" : "") + (button.live ? ' aria-live="polite"' : "") + ">" + e(button.label) + "</button>").join("") + "</div>";
}

export function status(tone, title, description, action = "") {
	return '<div class="settings-status is-' + e(tone) + '"><span class="settings-status-dot"></span><span><b>' + e(title) + "</b>" + (description ? "<small>" + e(description) + "</small>" : "") + "</span>" + action + "</div>";
}

export function disclosure(title, summary, content, open = false) {
	return '<details class="settings-disclosure"' + (open ? " open" : "") + '><summary><span><b>' + e(title) + "</b>" + (summary ? "<small>" + e(summary) + "</small>" : "") + "</span>" + icon("chevron") + '</summary><div class="settings-disclosure-body">' + content + "</div></details>";
}

export function saveBar() {
	return '<div class="settings-savebar" data-settings-savebar hidden><span>Nicht gespeicherte Änderungen</span><div><button type="button" id="btnDiscardSettings">Verwerfen</button><button type="button" id="btnSaveSettings" class="primary">Speichern</button></div></div>';
}
