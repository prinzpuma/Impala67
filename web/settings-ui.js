"use strict";

import { U } from "./util.js";
import { icon as spriteIcon, lead } from "./icons.js";

const e = (value) => U.esc(String(value ?? ""));

// Abschnitts-Icons der Einstellungen → Namen im zentralen Sprite (icons.svg)
const NAMES = { home: "home", sliders: "sliders", appearance: "palette", sparkles: "sparkles", sync: "sync", graduation: "graduation", gear: "gear", search: "search", chevron: "chevron-right", check: "check" };

export function icon(name, className = "") {
	return spriteIcon(NAMES[name] || "sliders", ("settings-icon " + className).trim());
}

export function page(title, description, content) {
	return '<header class="settings-page-head"><h2>' + e(title) + '</h2><p>' + e(description) + '</p></header><div class="settings-page-content">' + content + "</div>";
}

export function group(title, content, options = {}) {
	const id = options.id ? ' id="' + e(options.id) + '" data-settings-anchor' : "";
	const danger = options.danger ? " is-danger" : "";
	return '<section class="settings-group' + danger + '"' + id + '><h3>' + e(title) + '</h3><div class="settings-group-card">' + content + "</div>" + (options.footnote ? '<p class="settings-footnote">' + e(options.footnote) + "</p>" : "") + "</section>";
}

export function row({ id, title, description = "", descriptionId = "", descriptionLive = false, leading = "", trailing = "", extra = "", className = "", tag = "div" }) {
	const descriptionAttrs = (descriptionId ? ' id="' + e(descriptionId) + '"' : "") + (descriptionLive ? ' aria-live="polite"' : "");
	return "<" + tag + (id ? ' id="' + e(id) + '" data-settings-anchor' : "") + ' class="settings-row ' + e(className) + '">' +
		(leading ? '<span class="settings-row-leading">' + leading + "</span>" : "") +
		'<span class="settings-row-copy"><b>' + e(title) + "</b>" + (description ? "<small" + descriptionAttrs + ">" + e(description) + "</small>" : "") + extra + "</span>" +
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
	const anchor = options.anchor ? ' id="' + e(options.anchor) + '" data-settings-anchor' : "";
	return '<label class="settings-input-row"' + anchor + ' for="' + e(id) + '"><span><b>' + e(label) + "</b>" + (options.description ? "<small>" + e(options.description) + "</small>" : "") + "</span>" + control + "</label>";
}

export function actions(buttons, className = "") {
	return '<div class="settings-actions ' + e(className) + '">' + buttons.map((button) => '<button type="button"' + (button.id ? ' id="' + e(button.id) + '"' : "") + (button.data ? " " + button.data : "") + ' class="' + e(button.className || "") + '"' + (button.hidden ? " hidden" : "") + (button.disabled ? " disabled" : "") + (button.live ? ' aria-live="polite"' : "") + ">" + (button.icon ? lead(button.icon) : "") + e(button.label) + "</button>").join("") + "</div>";
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
