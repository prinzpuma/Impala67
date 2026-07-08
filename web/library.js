"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";

// Ganzen Workspace als ZIP voller Markdown-Dateien exportieren (Ordnerstruktur = Seitenbaum)
export function exportWorkspaceZip(wsId) {
	const ws = S.workspaces[wsId];
	const safe = (s) => String(s || "Ohne Titel").replace(/[\\/:*?"<>|#]/g, "_").trim().slice(0, 80) || "Seite";
	const files = [];
	const used = new Set();
	const walk = (parentId, path) => {
		STATE.childrenOf(parentId, wsId).forEach((pg) => {
			let base = path + safe(pg.title), n = 2;
			while (used.has(base)) base = path + safe(pg.title) + " (" + (n++) + ")";
			used.add(base);
			files.push({ name: base + ".md", text: "# " + pg.title + "\n\n" + (pg.content || "") });
			walk(pg.id, base + "/");
		});
	};
	walk(null, "");
	if (!files.length) { alert("Dieser Workspace hat keine Seiten."); return; }
	U.downloadBlob(safe(ws ? ws.name : "Workspace") + ".zip", U.zip(files));
}

export const LIBRARY = {
	exportWorkspaceZip
};
