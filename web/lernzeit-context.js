"use strict";

// Eine einzige Positivliste entscheidet, ob die Idle-Frage erscheinen darf.
// Modale Einstellungen lassen die darunterliegende Ansicht in S absichtlich
// unverändert und müssen deshalb separat berücksichtigt werden.
export function idlePromptContextKind(state, settingsOpen = false) {
	if (settingsOpen) return null;
	if (state.view === "chat") return "ai";
	if (state.view === "anki" && state.ankiTab === "study") return "cards";
	const page = state.currentPageId && state.pages?.[state.currentPageId];
	if (state.view === "page" && page?.kind === "heft") return "notebook";
	return null;
}
