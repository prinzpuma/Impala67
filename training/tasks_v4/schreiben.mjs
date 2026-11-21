// Kategorie „schreiben“: präzise Änderungen an bestehenden Seiten und Karteikarten.
// Jede Runde prüft: Werkzeug ohne Fehler, genau die gewünschte Änderung, kein page.replace,
// keine Duplikate (kein page.create auf bestehende Seiten), bei Karten Anzahl und Stapelname.

import { countCreatedCards, hasChange, hasChangeWhere, noToolErrors } from "../task_helpers.mjs";

const J = (x) => JSON.stringify(x);
const cardsFilled = (c) =>
	Array.isArray(c.cards) && c.cards.length > 0 && c.cards.every((k) => String(k.front || "").trim() && String(k.back || "").trim());

export default [
	{
		id: "v4-schreiben-todo-haken",
		mode: "mcp",
		turns: [
			{
				text: "Auf meiner Todo-Liste steht der Punkt mit den LLM-Einstellungen, die nicht synchronisiert werden sollen. Hak den bitte als erledigt ab. Sonst nichts ändern.",
				check: (r) =>
					noToolErrors(r) &&
					!hasChange("page.replace")(r) &&
					hasChangeWhere("page.patch", (c) => /llm einstellungen/i.test(J(c)) && /\[x\]/i.test(J(c)))(r) &&
					!hasChangeWhere("page.patch", (c) => /lernfunktionen|wir brauchen/i.test(J(c)))(r),
			},
			{
				text: "Die Sache mit den Lernfunktionen ist auch erledigt, bitte die ebenfalls abhaken.",
				check: (r) =>
					noToolErrors(r) &&
					!hasChange("page.replace")(r) &&
					hasChangeWhere("page.patch", (c) => /lernfunktion/i.test(J(c)) && /\[x\]/i.test(J(c)))(r),
			},
		],
	},
	{
		id: "v4-schreiben-flaechen-status",
		mode: "app",
		workspacePage: "4 · Flächenschwerpunkt",
		turns: [
			{
				text: "Die Übung hier hab ich fertig gerechnet, setz bitte den Status auf erledigt. Sonst nichts ändern.",
				check: (r) =>
					noToolErrors(r) &&
					!hasChange("page.replace")(r) &&
					!hasChange("page.create")(r) &&
					hasChangeWhere("page.props", (c) => /erledigt/i.test(J(c)))(r),
			},
		],
	},
	{
		id: "v4-schreiben-punkte-korrektur",
		mode: "mcp",
		turns: [
			{
				text: "Bei Blatt 1 zum Kristallgitter hab ich 8 von 10 Punkten bekommen. Trag das bitte bei den Punkten ein.",
				check: (r) =>
					noToolErrors(r) &&
					!hasChange("page.replace")(r) &&
					hasChangeWhere("page.props", (c) => /8\s*\/\s*10/.test(J(c)))(r),
			},
			{
				text: "Ups, ich hab mich verzählt, es sind 7 von 10. Korrigier das bitte.",
				check: (r) =>
					noToolErrors(r) &&
					!hasChange("page.replace")(r) &&
					hasChangeWhere("page.props", (c) => /7\s*\/\s*10/.test(J(c)))(r) &&
					!hasChangeWhere("page.props", (c) => /8\s*\/\s*10/.test(J(c)))(r),
			},
		],
	},
	{
		id: "v4-schreiben-abgabe-datum",
		mode: "mcp",
		turns: [
			{
				text: "Bei Blatt 3 zur Zinkblende ist das Abgabedatum noch leer. Trag bitte den 15. Dezember 2026 ein.",
				check: (r) =>
					noToolErrors(r) &&
					!hasChange("page.replace")(r) &&
					hasChangeWhere("page.props", (c) => /2026-12-15|15\.\s*(12|dez)/i.test(J(c)))(r),
			},
		],
	},
	{
		id: "v4-schreiben-chemie-bindung-karten",
		mode: "app",
		workspacePage: "4 · Chemische Bindung I",
		turns: [
			{
				text: "Mach mir aus der Seite zur chemischen Bindung genau 5 Karteikarten im Stapel Chemie::Bindung zu den drei Bindungstypen und ihren Eigenschaften.",
				check: (r) =>
					noToolErrors(r) &&
					countCreatedCards(r) === 5 &&
					hasChangeWhere("card.create", (c) => /Chemie::Bindung/.test(String(c.deck || "")))(r) &&
					hasChangeWhere("card.create", cardsFilled)(r),
			},
			{
				text: "Zur Oktettregel steht auf der Seite ja auch was. Ergänz dafür noch 2 Karten im selben Stapel.",
				check: (r) =>
					noToolErrors(r) &&
					countCreatedCards(r) === 2 &&
					hasChangeWhere("card.create", (c) => /Chemie::Bindung/.test(String(c.deck || "")) && /oktett/i.test(J(c)))(r),
			},
		],
	},
	{
		id: "v4-schreiben-mosfet-karten",
		mode: "mcp",
		turns: [
			{
				text: "Aus der Seite zum MOSFET (Vorlesung 12) brauche ich genau 4 Karten im Stapel Elektronik::MOSFET: Sperrung, Triode, Sättigung und dass das Gate keinen Strom zieht. Sonst nichts ändern.",
				check: (r) =>
					noToolErrors(r) &&
					countCreatedCards(r) === 4 &&
					hasChangeWhere("card.create", (c) => /Elektronik::MOSFET/.test(String(c.deck || "")) && cardsFilled(c))(r) &&
					hasChangeWhere("card.create", (c) => /sperr|triode|sättig/i.test(J(c)) && /gate/i.test(J(c)))(r),
			},
		],
	},
	{
		id: "v4-schreiben-laplace-karten",
		mode: "app",
		workspacePage: "10 · Laplace-Transformation",
		turns: [
			{
				text: "Leg bitte 3 Karten im Stapel DGL::Laplace::Regeln an: Differentiationssatz mit Anfangswerten, Stabilität über die Pole und das Lösungsrezept für Anfangswertprobleme. Vorderseite als Frage, Rückseite mit der Formel bzw. dem Schritt.",
				check: (r) =>
					noToolErrors(r) &&
					countCreatedCards(r) === 3 &&
					hasChangeWhere("card.create", (c) => /DGL::Laplace::Regeln/.test(String(c.deck || "")) && cardsFilled(c))(r) &&
					hasChangeWhere("card.create", (c) => /pol/i.test(J(c)))(r),
			},
		],
	},
	{
		id: "v4-schreiben-todo-umbenennen",
		mode: "mcp",
		turns: [
			{
				text: "Die Seite „Todo in der App“ ist mir zu lang betitelt, nenn sie bitte in „Todo“ um.",
				check: (r) =>
					noToolErrors(r) &&
					!hasChange("page.replace")(r) &&
					hasChangeWhere("page.rename", (c) => /todo/i.test(J(c)))(r),
			},
			{
				text: "Doch nicht, gib ihr bitte den alten Namen wieder.",
				check: (r) =>
					noToolErrors(r) &&
					hasChangeWhere("page.rename", (c) => /Todo in der App/i.test(J(c)))(r),
			},
		],
	},
	{
		id: "v4-schreiben-bipolar-anhang",
		mode: "mcp",
		turns: [
			{
				text: "Hänge bitte unten an die Seite „6 · Der Bipolartransistor“ einen kurzen Merksatz an: Der Bipolartransistor ist stromgesteuert, der MOSFET spannungsgesteuert. Sonst nichts ändern.",
				check: (r) =>
					noToolErrors(r) &&
					!hasChange("page.replace")(r) &&
					!hasChange("page.create")(r) &&
					hasChangeWhere("page.append", (c) => /stromgesteuert/i.test(J(c)))(r),
			},
			{
				text: "Und bei „4 · Chemische Bindung I“ unten noch den Satz anhängen: Die Oktettregel ist nur eine Faustregel.",
				check: (r) =>
					noToolErrors(r) &&
					hasChangeWhere("page.append", (c) => /Oktettregel/i.test(J(c)) && /Faustregel/i.test(J(c)))(r) &&
					!hasChangeWhere("page.append", (c) => /stromgesteuert|Bipolartransistor/i.test(J(c)))(r),
			},
		],
	},
	{
		id: "v4-schreiben-dgl-blatt-eigenschaften",
		mode: "app",
		workspacePage: "DGL 1. Ordnung Übung",
		turns: [
			{
				text: "Bei dieser Seite bitte die Schwierigkeit auf leicht setzen und den Status auf Offen. Sonst nichts ändern.",
				check: (r) =>
					noToolErrors(r) &&
					!hasChange("page.replace")(r) &&
					hasChangeWhere("page.props", (c) => /leicht/i.test(J(c)))(r) &&
					hasChangeWhere("page.props", (c) => /offen/i.test(J(c)))(r),
			},
		],
	},
];
