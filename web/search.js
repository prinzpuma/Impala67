"use strict";

import { S } from "./state.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";

const renderSidebar = (...args) => RENDER.renderSidebar(...args);

export function handleSearchToggle() {
	const s = U.el("search");
	if (!s) return;
	s.hidden = !s.hidden;
	if (!s.hidden) {
		S.sidebarMode = "files";
		renderSidebar();
		s.focus();
	} else {
		s.value = "";
		renderSidebar();
	}
}

export function handleSearchInput(e) {
	if (e.target.id === "search") {
		renderSidebar();
	}
}

export const SEARCH = {
	handleSearchToggle,
	handleSearchInput
};
