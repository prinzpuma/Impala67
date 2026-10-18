"use strict";

// Klicks im Karteikarten-Bereich (Tabs, Lernen, Bewerten, Karten- und Stapel-Verwaltung)
// sowie im Kalender der Daily Notes. Aus dem zentralen Klick-Handler in app.js herausgelöst.

import { RENDER } from "./render.js";
import { RENDER_ANKI } from "./render-anki.js";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { TABS } from "./tabs.js";
import { PLATFORM_NATIVE } from "./platform-native.js";
import { focusRenameInput } from "./app-sidebar-events.js";
import { PLATFORM } from "./platform.js";
import { closestOf, blurActive } from "./app-ui.js";
import { closeOverlay, openPromptDialog, setAnkiZen, resetStudyCard, openDailyNote, rateAndReviewCard, showStudyAnswer } from "./app-dialogs.js";

// Spät gebunden ((...a) =>) wegen Modul-Zyklen — wie in app.js.
const render = (...a) => RENDER.render(...a);
const openPage = (...a) => TABS.openPage(...a);
const renderSidebar = (...a) => RENDER.renderSidebar(...a);
const renderMain = (...a) => RENDER.renderMain(...a);
const ankiCardsOf = (...a) => RENDER_ANKI.ankiCardsOf(...a);
const openCardEditor = (...a) => RENDER_ANKI.openCardEditor(...a);
const $ = (id) => U.el(id);

// Stapel-⋯-Menü und seine Aktionen. Läuft VOR dem Außenklick-Schließen der Popovers,
// sonst zerstört closeOutside das Menü im selben Klick. true = erledigt.
export async function handleDeckMenuClick(e) {
	const deckMenuBtn = closestOf(e, "[data-deckmenu]");
	if (deckMenuBtn) {
		e.preventDefault();
		e.stopPropagation();
		const name = deckMenuBtn.dataset.deckmenu;
		const open = S.deckMenuOpenName !== name;
		S.pageMenuOpenId = null;
		S.topMenu = null;
		S.modelMenuOpen = false;
		S.deckMenuOpenName = open ? name : null;
		renderSidebar(); // positioniert offenes Menü in render.js
		if (S.view === "anki") renderMain();
		return true;
	}
	const deckAction = closestOf(e, "[data-deckdel],[data-deckrename],[data-deckduplicate],[data-deckarchive]");
	if (deckAction) {
		e.preventDefault();
		e.stopPropagation();
		const name = deckAction.dataset.deckdel || deckAction.dataset.deckrename || deckAction.dataset.deckduplicate || deckAction.dataset.deckarchive;
		S.deckMenuOpenName = null;
		renderSidebar();
		if (S.view === "anki") renderMain();
		if (deckAction.hasAttribute("data-deckrename")) {
			if (PLATFORM.isTouch()) {
				openPromptDialog("Stapel umbenennen", async (newName) => {
					const trimmed = newName.trim();
					if (trimmed && trimmed !== name) {
						await STATE.dispatch("deckRename", { oldName: name, newName: trimmed });
					}
				}, name);
				return true;
			}
			S.renamingDeck = name;
			renderSidebar();
			const inp = document.querySelector('[data-deckrenamename="' + CSS.escape(name) + '"]');
			if (inp) focusRenameInput(inp);
			return true;
		}
		if (deckAction.hasAttribute("data-deckduplicate")) {
			await STATE.dispatch("deckDuplicate", { name });
			return true;
		}
		if (deckAction.hasAttribute("data-deckarchive")) {
			await STATE.dispatch("deckArchive", { name });
			if (S.ankiDeck && STATE.deckInTree(S.ankiDeck, name)) S.ankiDeck = null;
			resetStudyCard();
			U.toast("Stapel archiviert.", "success");
			return true;
		}
		// data-deckdel
		const n = ankiCardsOf(name).length;
		const msg = 'Stapel „' + name + '“ in den Papierkorb legen?' +
			(n ? " " + n + " Karte(n) (inkl. Unterstapel) wandern mit und sind wiederherstellbar." : "");
		if (await U.confirm(msg, { title: "Stapel löschen", ok: "In Papierkorb", danger: true })) {
			await STATE.dispatch("deckTrash", { name });
			if (S.ankiDeck && STATE.deckInTree(S.ankiDeck, name)) S.ankiDeck = null;
			U.toast("Stapel im Papierkorb.", "success");
		} else {
			render();
		}
		return true;
	}

	// Topbar-Menüs (Teilen/⋯) VOR closeOutside; blurActive nötig, weil renderMain
	return false;
}

// true = Klick gehört hierher und ist erledigt.
export async function handleAnkiClick(t, e) {
	// ---------- Anki-Bereich: Tabs, Lernen, Bewerten, Sortieren, Karten-Verwaltung ----------
	// ⛶ Vollbild (23. Juli): Body-Klasse blendet Seitenleiste + Tab-Leiste aus — rein per
	// CSS auf die sichtbare Anki-Ansicht begrenzt (styles.css, :has), erneut klicken = zurück.
	if (t.dataset.ankizen) { setAnkiZen(!S.ankiZen); return true; }
	if (t.dataset.ankitab) { S.ankiTab = t.dataset.ankitab; resetStudyCard(); renderMain(); return true; }
	if (t.hasAttribute("data-ankistudy")) {
		S.ankiDeck = t.dataset.ankistudy || null;
		// Interleaved Practice: nur der „Gemischt lernen“-Button aktiviert den Misch-Modus
		S.ankiMix = t.hasAttribute("data-ankimix");
		// 🧑‍🏫 Feynman-Modus als eigene Lern-Option aus der Stapel-Übersicht
		S.ankiFeyn = t.hasAttribute("data-ankifeyn");
		S.ankiTab = "study";
		resetStudyCard();
		// Home v4: der Stapel-Überblick startet das Lernen direkt von der Homeseite —
		// dafür ggf. in die Anki-Ansicht wechseln (seit 23. Juli als eigener Tab anki:main).
		if (S.view !== "anki") openPage("anki:main");
		else renderMain();
		return true;
	}
	// DRY: Klick auf „Antwort zeigen“ nutzt denselben Aufdeck-Pfad wie die
	// Leertaste — inkl. Festpinnen der sichtbaren Karte (Bug-Fix, s. oben).
	if (t.dataset.ankishowback) { showStudyAnswer(t.dataset.card); return true; }
	if (t.dataset.ankiwaitrefresh) { resetStudyCard(); renderMain(); return true; }
	if (t.dataset.ankigrade) {
		PLATFORM_NATIVE.haptics.light();
		await rateAndReviewCard(t.dataset.card, Number(t.dataset.ankigrade), t.dataset.reviewId);
		resetStudyCard();
		return true;
	}
	if (t.dataset.ankimore) {
		S.ankiBrowserLimit = (S.ankiBrowserLimit || 200) + 500;
		renderMain();
		return true;
	}
	if (t.dataset.ankisort) {
		if (S.ankiSort === t.dataset.ankisort) S.ankiSortDir = -(S.ankiSortDir || 1);
		else { S.ankiSort = t.dataset.ankisort; S.ankiSortDir = 1; }
		renderMain();
		return true;
	}
	if (t.hasAttribute("data-ankideckfilter")) {
		S.ankiDeck = t.dataset.ankideckfilter || null;
		S.ankiTab = "browser";
		renderMain();
		return true;
	}
	if (t.dataset.ankisuspend) {
		const c = S.cards[t.dataset.ankisuspend];
		if (c && c.id === S.reviewCardId) resetStudyCard();
		if (c) await STATE.dispatch("cardUpdate", { id: c.id, patch: { suspended: !c.suspended } });
		return true;
	}
	if (t.dataset.ankiarchive) {
		if (t.dataset.ankiarchive === S.reviewCardId) resetStudyCard();
		await STATE.dispatch("cardArchive", { id: t.dataset.ankiarchive });
		U.toast("Karte archiviert.", "success");
		return true;
	}
	if (t.dataset.ankiunarchive) {
		await STATE.dispatch("cardUnarchive", { id: t.dataset.ankiunarchive });
		U.toast("Karte wiederhergestellt.", "success");
		return true;
	}
	if (t.dataset.deckunarchive) {
		await STATE.dispatch("deckUnarchive", { name: t.dataset.deckunarchive });
		U.toast("Stapel wiederhergestellt.", "success");
		return true;
	}
	if (t.dataset.ankidel) {
		// Soft-Delete → Papierkorb (wiederherstellbar)
		if (await U.confirm("Diese Karte in den Papierkorb legen?", { title: "Karte löschen", ok: "In Papierkorb", danger: true })) {
			await STATE.dispatch("cardTrash", { id: t.dataset.ankidel });
			U.toast("Karte im Papierkorb.", "success");
		}
		return true;
	}
	if (t.dataset.ankiedit) { openCardEditor(t.dataset.ankiedit); return true; }
	if (t.dataset.ankinewcard) { openCardEditor(null); return true; }
	if (t.dataset.cardeditorsave) {
		const front = ($("cardFront") || {}).value || "";
		const back = ($("cardBack") || {}).value || "";
		// Stapel aus Select bzw. „Neuer Stapel“-Feld (kein freies datalist mehr)
		const deck = (RENDER_ANKI.readCardEditorDeck && RENDER_ANKI.readCardEditorDeck()) || "Standard";
		if (!front.trim()) { U.toast("Die Vorderseite darf nicht leer sein.", "error"); return true; }
		if (deck === "__new__" || !String(deck).trim()) { U.toast("Bitte einen Stapel wählen oder einen neuen Namen eingeben.", "error"); return true; }
		// Neuen Stapel-Namen im Baum anlegen, falls noch unbekannt
		if (deck !== "Standard" && !(S.decks || {})[deck] && !Object.values(S.cards).some((c) => (c.deck || "") === deck)) {
			await STATE.dispatch("deckCreate", { name: deck });
		}
		if (t.dataset.cardeditorsave === "new") {
			await STATE.dispatch("cardCreate", { id: U.uid(), front, back, deck });
		} else {
			await STATE.dispatch("cardUpdate", { id: t.dataset.cardeditorsave, patch: { front, back, deck } });
		}
		// Bug-Fix (Karteikarten): Nicht mitten im Lernen den aktiven Stapel
		// wechseln — ✎ Bearbeiten im Lernmodus kappte sonst die laufende
		// Session auf den Stapel der gerade bearbeiteten Karte.
		if (S.ankiTab !== "study") S.ankiDeck = deck === "Standard" ? null : deck;
		closeOverlay();
		return true;
	}

	// ---------- Stapel-Baum: Stapel öffnen (nicht bei ⋯ / + / Menü) ----------
	if (t.hasAttribute("data-deckopen") && !closestOf(e, ".row-add, .page-menu, input, button")) {
		S.ankiDeck = t.dataset.deckopen || null;
		S.deckMenuOpenName = null;
		if (S.ankiTab === "study") S.ankiTab = "decks";
		render();
		return true;
	}
	if (t.dataset.decknew || t.dataset.decksub) {
		const parent = t.dataset.decksub || "";
		openPromptDialog(parent ? 'Name des Unterstapels von „' + parent.split("::").pop() + '“' : "Name des neuen Stapels", async (name) => {
			const full = (parent ? parent + "::" : "") + name;
			await STATE.dispatch("deckCreate", { name: full });
			S.ankiDeck = full;
		});
		return true;
	}

	// ---------- Daily Notes: Tag anklicken / Monat blättern ----------
	if (t.dataset.dailyday) { await openDailyNote(t.dataset.dailyday); return true; }
	if (t.dataset.dailynav) {
		const base = S.dailyMonth ? new Date(S.dailyMonth + "-01T12:00:00") : new Date();
		const d = new Date(base.getFullYear(), base.getMonth() + Number(t.dataset.dailynav), 1);
		S.dailyMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
		renderMain();
		return true;
	}

	// Workspace als Markdown-ZIP exportieren (Einstellungen → Backup)
	return false;
}
