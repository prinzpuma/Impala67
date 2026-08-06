"use strict";

import { S } from "./state.js";

// Zentrale Fachzuordnung. Ein Lernereignis bekommt immer genau EIN Hauptfach.
// Die Reihenfolge ist absichtlich deterministisch: explizite Fachangabe > oberste
// Seitenebene > oberster Kartenstapel > unbestimmt. Embeddings bleiben damit ein
// optionaler späterer Fallback und verändern historische Daten nicht unbemerkt.
export const FACH = (() => {
	const MAX = 80;
	const GENERIC = /^(daily notes?|notizen?|willkommen|start|home|privat|allgemein|ohne titel)$/i;

	function clean(value) {
		return String(value || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX);
	}
	function explicitTag(page) {
		if (!page || !Array.isArray(page.tags)) return "";
		for (const raw of page.tags) {
			const tag = clean(raw);
			const match = tag.match(/^(?:fach|fachbereich|subject)\s*:\s*(.+)$/i);
			if (match) return clean(match[1]);
		}
		return "";
	}
	function rootPage(page) {
		let root = page, hops = 0;
		while (root && root.parentId && S.pages[root.parentId] && hops++ < 100) root = S.pages[root.parentId];
		return root || page || null;
	}
	function workspaceName(page) {
		const workspace = clean(S.workspaces[page?.workspaceId || "default"]?.name);
		return workspace && !GENERIC.test(workspace) ? workspace : "Notizen";
	}
	function page(page) {
		if (!page) return { name: "Allgemein", source: "fallback" };
		const explicit = clean(page.subject) || explicitTag(page);
		if (explicit) return { name: explicit, source: page.subject ? "manual" : "tag" };
		const root = clean(rootPage(page)?.title);
		if (root && !GENERIC.test(root)) return { name: root, source: "page-root" };
		return { name: workspaceName(page), source: "workspace" };
	}
	function deck(deckName) {
		const raw = clean(deckName);
		const root = clean(raw.split("::")[0]);
		if (!root || GENERIC.test(root)) return { name: "Karteikarten", source: "fallback" };
		return { name: root, source: "deck-root" };
	}
	function context({ deck: deckName, pageId } = {}) {
		const pageValue = pageId && S.pages[pageId] ? page(S.pages[pageId]) : null;
		const deckValue = deck(deckName);
		// Ein benannter Deck-Root ist für Karten die stabilste Quelle. Nur Standard
		// fällt auf die zugehörige Seite zurück, z.B. bei automatisch erzeugten Karten.
		if (deckValue.source !== "fallback") return deckValue;
		return pageValue || deckValue;
	}
	function card(card) {
		return context({ deck: card?.deck, pageId: card?.pageId });
	}

	return { clean, page, deck, context, card };
})();
