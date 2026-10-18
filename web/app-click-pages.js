"use strict";

// Klicks rund um Seiten: ⋯-Menü (Umbenennen, Verschieben, Archiv, Papierkorb), Anlege-Dialog
// mit Vorlagen, Tags, Seitenverlauf und Papierkorb-Ansicht. Aus app.js herausgelöst.

import { RENDER } from "./render.js";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { SETTINGS } from "./settings.js";
import { TABS } from "./tabs.js";
import { POPOVERS } from "./popovers.js";
import { icon } from "./icons.js";
import { focusRenameInput, movePageSubtreeToWorkspace } from "./app-sidebar-events.js";
import { PLATFORM } from "./platform.js";
import { closeTopMenu, focusPageTitle } from "./app-ui.js";
import { closeOverlay, openPromptDialog, openMoveDialog, openSubjectDialog, duplicatePage, newPageFlow } from "./app-dialogs.js";

// Spät gebunden ((...a) =>) wegen Modul-Zyklen — wie in app.js.
const render = (...a) => RENDER.render(...a);
const openPage = (...a) => TABS.openPage(...a);
const renderSidebar = (...a) => RENDER.renderSidebar(...a);
const renderMain = (...a) => RENDER.renderMain(...a);
const renderHistoryModal = (...a) => RENDER.renderHistoryModal(...a);

// true = Klick gehört hierher und ist erledigt.
export async function handlePageClick(t, e) {
	// ⋯-Menü: Seite als Vorlage markieren / Markierung entfernen
	if (t.dataset.pagetemplate) {
		S.pageMenuOpenId = null;
		S.topMenu = null; // auch im Topbar-⋯-Menü — sonst bleibt es nach der Aktion offen
		const pg = S.pages[t.dataset.pagetemplate];
		if (pg) await STATE.dispatch("pageUpdate", { id: pg.id, patch: { isTemplate: !pg.isTemplate } });
		return true;
	}

	// Anlege-Dialog: Notion-Seite, GoodNotes-Heft oder Vorlage als Startinhalt
	if (t.dataset.tplblank || t.dataset.tplheft) {
		const kind = t.dataset.tplheft ? "heft" : "notion";
		const p = S.pendingNewPage;
		S.pendingNewPage = null;
		closeOverlay();
		if (p) {
			const id = U.uid();
			await STATE.dispatch("pageCreate", {
				id, title: kind === "heft" ? "Neues Heft" : "Neue Seite", parentId: p.parentId || null, content: "",
				icon: null, tags: [], workspaceId: p.wsId || S.currentWorkspaceId, kind,
			});
			openPage(id, p.newTab ? { newTab: true } : undefined);
			focusPageTitle();
		}
		return true;
	}
	if (t.dataset.tpluse) {
		const p = S.pendingNewPage;
		const tpl = S.pages[t.dataset.tpluse];
		S.pendingNewPage = null;
		closeOverlay();
		if (p && tpl) {
			const id = U.uid();
			await STATE.dispatch("pageCreate", {
				id, title: tpl.title, parentId: p.parentId || null, content: tpl.content || "",
				icon: tpl.icon || null, tags: tpl.tags || [], workspaceId: p.wsId || S.currentWorkspaceId,
				kind: tpl.kind || "notion",
			});
			openPage(id, p.newTab ? { newTab: true } : undefined);
		}
		return true;
	}

	// Seitenverlauf: Version in der Liste auswählen → Vorschau aktualisieren
	if (t.dataset.histversion) {
		S.histIndex = Number(t.dataset.histversion);
		renderHistoryModal();
		return true;
	}

	if (t.dataset.set) { await SETTINGS.navigateSettings(t.dataset.set); return true; }

	// Neue Seite in einem Workspace (+ neben dem Workspace-Namen)
	if (t.dataset.newpage) { await newPageFlow(t.dataset.newpage, null); return true; }

	// Unterseite anlegen (+ neben einer Seiten-Zeile)
	if (t.dataset.addchild) {
		const parent = S.pages[t.dataset.addchild];
		await newPageFlow(parent ? parent.workspaceId : S.currentWorkspaceId, t.dataset.addchild);
		return true;
	}

	// ⋯-Menü je Seite (wie in Notion): öffnen/schließen, Duplizieren, Löschen (→ Papierkorb)
	if (t.dataset.pagemenu) {
		const id = t.dataset.pagemenu;
		S.pageMenuOpenId = S.pageMenuOpenId === id ? null : id;
		renderSidebar();
		if (S.view === "library") renderMain();
		// Menü fest (fixed) über dem Button positionieren, damit es nicht vom
		// Scroll-Container der Seitenleiste (#tree, overflow:auto) abgeschnitten wird.
		if (S.pageMenuOpenId) POPOVERS.position(
			document.querySelector('[data-pagemenu="' + id + '"]'),
			// :not(.top-menu): nie versehentlich das Topbar-⋯-Menü greifen
			document.querySelector(".page-menu:not(.top-menu)"), { align: "end", gap: 2 });
		return true;
	}
	// ⋯-Menü: Seite umbenennen — wie bei Stapeln per Inline-Textfeld direkt in der Zeile.
	if (t.dataset.pagefav) {
		S.pageMenuOpenId = null;
		const pg = S.pages[t.dataset.pagefav];
		if (pg) await STATE.dispatch("pageUpdate", { id: pg.id, patch: { favorite: !pg.favorite } });
		return true;
	}
	if (t.dataset.pagesubject) {
		S.pageMenuOpenId = null;
		closeTopMenu();
		renderSidebar();
		openSubjectDialog(t.dataset.pagesubject);
		return true;
	}
	if (t.dataset.pagemove) {
		S.pageMenuOpenId = null;
		closeTopMenu(); // sonst bleibt das Topbar-⋯-Menü hinter dem Dialog offen
		renderSidebar();
		openMoveDialog(t.dataset.pagemove);
		return true;
	}
	if (t.dataset.movetarget && S.movePageId) {
		const moveId = S.movePageId;
		const val = t.dataset.movetarget;
		const parentId = val.startsWith("pg:") ? val.slice(3) : null;
		const wsId = val.startsWith("ws:") ? val.slice(3) : ((S.pages[parentId] || {}).workspaceId || "default");
		await STATE.dispatch("pageMove", { id: moveId, parentId });
		await movePageSubtreeToWorkspace(moveId, wsId);
		S.movePageId = null;
		closeOverlay();
		return true;
	}
	if (t.dataset.tagfilter) {
		S.libTag = S.libTag === t.dataset.tagfilter ? null : t.dataset.tagfilter;
		renderMain();
		return true;
	}
	if (t.dataset.tagrename) {
		const oldTag = t.dataset.tagrename;
		openPromptDialog('Tag „' + oldTag + '“ umbenennen', async (newTag) => {
			for (const p of STATE.activePages()) {
				if ((p.tags || []).includes(oldTag)) {
					const tags = [...new Set(p.tags.map((x) => (x === oldTag ? newTag : x)))];
					await STATE.dispatch("pageUpdate", { id: p.id, patch: { tags } });
				}
			}
			if (S.libTag === oldTag) S.libTag = newTag;
			renderMain();
		}, oldTag);
		return true;
	}
	if (t.dataset.pageopennew) {
		const id = t.dataset.pageopennew;
		S.pageMenuOpenId = null;
		openPage(id, { newTab: true });
		return true;
	}
	if (t.dataset.pagerename) {
		e.preventDefault();
		e.stopPropagation();
		const id = t.dataset.pagerename;
		S.pageMenuOpenId = null;
		const pg = S.pages[id];
		if (!pg) { renderSidebar(); return true; }
		if (PLATFORM.isTouch()) {
			renderSidebar();
			const isHeft = pg.kind === "heft";
			openPromptDialog(isHeft ? "Heft umbenennen" : "Seite umbenennen", async (newName) => {
				const title = newName.trim();
				if (title && title !== pg.title) {
					await STATE.dispatch("pageUpdate", { id, patch: { title } });
				}
			}, pg.title);
			return true;
		}
		S.renamingPageId = id;
		renderSidebar();
		const inp = document.querySelector('[data-renamename="' + CSS.escape(id) + '"]');
		if (inp) focusRenameInput(inp);
		return true;
	}
	if (t.dataset.pageduplicate) {
		S.pageMenuOpenId = null;
		S.topMenu = null; // FIX: Duplizieren aus dem Topbar-⋯-Menü ließ das Menü auf der neuen Seite offen
		const newId = await duplicatePage(t.dataset.pageduplicate);
		if (newId) openPage(newId);
		else render();
		return true;
	}
	if (t.dataset.pagearchive) {
		S.pageMenuOpenId = null;
		S.topMenu = null;
		const id = t.dataset.pagearchive;
		const pg = S.pages[id];
		if (pg) {
			await STATE.dispatch("pageArchive", { id });
			const isHeft = pg.kind === "heft";
			U.toast((isHeft ? "Heft" : "Seite") + " archiviert.", "success");
		} else {
			render();
		}
		return true;
	}
	if (t.dataset.pageunarchive) {
		const id = t.dataset.pageunarchive;
		const pg = S.pages[id];
		if (pg) {
			await STATE.dispatch("pageUnarchive", { id });
			const isHeft = pg.kind === "heft";
			U.toast((isHeft ? "Heft" : "Seite") + " wiederhergestellt.", "success");
		} else {
			render();
		}
		return true;
	}
	if (t.dataset.pagetrash) {
		S.pageMenuOpenId = null;
		S.topMenu = null; // Löschen ist auch im Topbar-⋯-Menü — sonst bleibt es offen
		const id = t.dataset.pagetrash;
		const pg = S.pages[id];
		if (pg) {
			await STATE.dispatch("pageTrash", { id });
			U.toast("Seite im Papierkorb.", "success");
		} else {
			render(); // nur Menü-Zustand geändert, kein dispatch → sofort neu zeichnen
		}
		return true;
	}
	if (t.dataset.pagerestore) {
		await STATE.dispatch("pageRestore", { id: t.dataset.pagerestore });
		return true;
	}
	if (t.dataset.pagepurge) {
		const pg = S.pages[t.dataset.pagepurge];
		if (pg && await U.confirm('„' + pg.title + '“ endgültig löschen? Das kann nicht rückgängig gemacht werden.', {
			title: "Endgültig löschen", ok: "Löschen", danger: true,
		})) {
			await STATE.dispatch("pageDelete", { id: t.dataset.pagepurge });
		}
		return true;
	}
	// Papierkorb vollständig und endgültig leeren. Die Reihenfolge ist wichtig:
	// erst Seiten, dann Stapel, danach verwaiste Karten; alles bleibt bis zur
	// Bestätigung unverändert und wird als einzelne, synchronisierbare Events gelöscht.
	if (t.dataset.trashclear) {
		const pageIds = STATE.trashedPages().map((p) => p.id);
		const deckRoots = STATE.trashedDeckRoots();
		const cardIds = STATE.orphanTrashedCards().map((c) => c.id);
		const total = pageIds.length + deckRoots.length + cardIds.length;
		if (!total) { U.toast("Der Papierkorb ist bereits leer.", "success"); return true; }
		if (!await U.confirm("Alle " + total + " Elemente im Papierkorb endgültig löschen? Das kann nicht rückgängig gemacht werden.", {
			title: "Papierkorb leeren", ok: "Endgültig löschen", danger: true,
		})) return true;
		for (const id of pageIds) await STATE.dispatch("pageDelete", { id });
		for (const name of deckRoots) await STATE.dispatch("deckDelete", { name });
		for (const id of cardIds) await STATE.dispatch("cardDelete", { id });
		U.toast("Papierkorb geleert.", "success");
		return true;
	}

	if (t.dataset.trashfilter) {
		S.trashFilter = t.dataset.trashfilter;
		renderMain();
		return true;
	}

	// Papierkorb: Karten & Stapel wiederherstellen / endgültig löschen
	if (t.dataset.cardrestore) {
		await STATE.dispatch("cardRestore", { id: t.dataset.cardrestore });
		U.toast("Karte wiederhergestellt.", "success");
		return true;
	}
	if (t.dataset.cardpurge) {
		const c = S.cards[t.dataset.cardpurge];
		const label = c ? (c.front || "").slice(0, 40) : "Karte";
		if (await U.confirm('Karte „' + label + (label.length >= 40 ? "…" : "") + '“ endgültig löschen? Das kann nicht rückgängig gemacht werden.', {
			title: "Endgültig löschen", ok: "Löschen", danger: true,
		})) {
			await STATE.dispatch("cardDelete", { id: t.dataset.cardpurge });
		}
		return true;
	}
	if (t.dataset.deckrestore) {
		await STATE.dispatch("deckRestore", { name: t.dataset.deckrestore });
		U.toast("Stapel wiederhergestellt.", "success");
		return true;
	}
	if (t.dataset.deckpurge) {
		const name = t.dataset.deckpurge;
		const n = Object.values(S.cards).filter((c) => STATE.deckInTree(c.deck || "Standard", name)).length;
		if (await U.confirm('Stapel „' + name + '“ endgültig löschen?' +
			(n ? " " + n + " Karte(n) werden unwiderruflich entfernt." : "") +
			" Das kann nicht rückgängig gemacht werden.", {
			title: "Endgültig löschen", ok: "Löschen", danger: true,
		})) {
			await STATE.dispatch("deckDelete", { name });
		}
		return true;
	}

	// Chat-Verlauf: laufende Antworten bleiben an ihrer Sitzung gebunden.
	return false;
}
