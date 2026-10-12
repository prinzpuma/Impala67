// chat-start.js — Leerzustand des KI-Chats (Vollansicht): Begrüßung mit Leucht-Kugel
// und Vorschlagskarten. Die Karten setzen nur einen Prompt-Anfang ins Eingabefeld
// (data-chatsuggest, Handler in app.js), sie senden nichts automatisch.
import { U } from "./util.js";
import { icon } from "./icons.js";

const SUGGESTS = [
	["bulb", "Erklär's mir", "Schritt für Schritt, bis es klickt", "Erkläre mir Schritt für Schritt: "],
	["cards", "Karteikarten", "Aus einem Thema oder deinen Notizen", "Erstelle Karteikarten zu: "],
	["file", "Zusammenfassen", "Das Wichtigste kompakt auf einen Blick", "Fasse kompakt zusammen: "],
	["target", "Quiz mich", "5 Prüfungsfragen mit Auflösung", "Stell mir 5 Prüfungsfragen zu: "],
];

function greeting(hour) {
	return hour < 5 ? "Gute Nacht" : hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
}

export function chatStartHtml() {
	return '<div class="chat-start">' +
		'<div class="cs-orb" aria-hidden="true"><i></i><span>✦</span></div>' +
		'<h2 class="cs-title"><b>' + greeting(new Date().getHours()) + '.</b> <span>Was möchtest du heute verstehen?</span></h2>' +
		'<p class="cs-sub">Frag nach deinen Notizen, lass dir etwas erklären oder dich abfragen. Formeln und Code erscheinen sauber gesetzt.</p>' +
	"</div>";
}

export function chatSuggestsHtml() {
	return '<div class="chat-suggests">' + SUGGESTS.map(([ico, title, sub, prompt]) =>
		'<button type="button" data-chatsuggest="' + U.esc(prompt) + '">' +
			'<span class="cs-ico">' + icon(ico) + "</span>" +
			'<span class="cs-copy"><b>' + U.esc(title) + "</b><small>" + U.esc(sub) + "</small></span>" +
		"</button>").join("") + "</div>";
}
