"use strict";

// test-main.js — Lädt das echte Impala67-Ökosystem und ersetzt die Startseite durch das Apple-/Claude-Atelier.
import "./main.js";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { TABS } from "./tabs.js";
import { RENDER } from "./render.js";
import { SEARCH } from "./search.js";

const esc = (s) => U.esc(s || "");

function getActiveTestMode() {
	return localStorage.getItem("impala67TestHomeMode") || "atelier";
}

function setActiveTestMode(mode) {
	localStorage.setItem("impala67TestHomeMode", mode);
	renderNewHome();
}

function fmtDate(iso) {
	if (!iso) return "Kürzlich";
	try {
		const d = new Date(iso);
		const now = new Date();
		const diffHours = (now - d) / 36e5;
		if (diffHours < 1) return "vor " + Math.max(1, Math.round((now - d) / 6e4)) + " Min";
		if (diffHours < 24) return "vor " + Math.round(diffHours) + " Std";
		if (diffHours < 48) return "Gestern";
		return d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
	} catch { return "Kürzlich"; }
}

// Generiert das HTML der neuen Startseite mit echten Benutzerdaten
function buildHomeHtml(mode) {
	const pages = STATE.activePages ? STATE.activePages() : Object.values(S.pages || {}).filter((p) => !p.trashed);
	const recent = pages.slice().sort((a, b) => ((b.updated || "") < (a.updated || "") ? -1 : 1));
	const due = (STATE.dueCards && STATE.dueCards().length) || 0;
	const dueCards = (STATE.dueCards && STATE.dueCards()) || [];
	const lz = (window.LERNZEIT && window.LERNZEIT.statsForHome && window.LERNZEIT.statsForHome()) || { streakDays: 0, todaySeconds: 0, goalPct: 0 };
	
	const hour = new Date().getHours();
	const greeting = hour < 5 ? "Gute Nacht" : hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
	const dateLine = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
	const homeName = ((S.settings || {}).homeUserName || "").trim();
	const topDoc = recent[0] || null;

	// Echte Aufgaben aus deinen Notizen extrahieren
	const realTodos = [];
	for (const p of pages) {
		const lines = (p.content || "").split("\n");
		for (const l of lines) {
			const match = l.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
			if (match && match[2].trim() && match[2].trim().length > 2) {
				realTodos.push({
					pageId: p.id,
					pageTitle: p.title || "Notiz",
					text: match[2].replace(/\*\*/g, "").trim(),
					done: match[1] !== " "
				});
				if (realTodos.length >= 10) break;
			}
		}
		if (realTodos.length >= 10) break;
	}

	// Switcher-Leiste oben
	const switcher = `
		<div class="test-nav-floating">
			<div class="test-nav-group">
				<button type="button" class="test-nav-btn is-star${mode === "atelier" ? " active" : ""}" data-nhmode="atelier">★ Atelier (Apple + Claude)</button>
				<button type="button" class="test-nav-btn${mode === "apple" ? " active" : ""}" data-nhmode="apple">Apple Native</button>
				<button type="button" class="test-nav-btn${mode === "claude" ? " active" : ""}" data-nhmode="claude">Claude Minimal</button>
				<button type="button" class="test-nav-btn is-original${mode === "old" ? " active" : ""}" data-nhmode="old">Ist-Zustand (Alte Version)</button>
			</div>
			<span style="font-size:11px;padding:3px 8px;border-radius:12px;background:rgba(48,209,88,0.12);color:#30d158;border:1px solid rgba(48,209,88,0.3);font-weight:600">
				● Vollversion aktiv (${pages.length} Notizen)
			</span>
		</div>
	`;

	if (mode === "old") {
		return switcher + '<div class="old-mode-note" style="padding:14px;background:var(--surface-subtle);border:1px solid var(--edge-soft);border-radius:12px;margin-bottom:16px;font-size:12px;color:var(--text2)">Hier ist die originale Startseite aktiv. Klicke oben auf <b>★ Atelier</b>, um das neue Design zu nutzen.</div>';
	}

	// 1. ATELIER (Standard)
	if (mode === "atelier") {
		const firstCard = dueCards[0] || { front: "Keine fälligen Karten vorhanden", back: "Alle Karten gelernt!" };
		const deskDocs = recent.length > 1 ? recent.slice(1, 4) : recent.slice(0, 3);

		return `
			<div class="new-home-root">
				${switcher}
				
				<header class="nh-hero">
					<div class="nh-eyebrow-row">
						<span class="nh-eyebrow">${esc(dateLine)} · ${esc(greeting)}</span>
						<span style="font-size:11px;color:var(--nh-text-tertiary)">${pages.length} Notizen synchronisiert</span>
					</div>
					<h1 class="nh-hero-title">${esc(greeting)}${homeName ? ", " + esc(homeName) : ""}. <em>Bereit für Fokus?</em></h1>
					
					<div class="nh-briefing-pills">
						<div class="nh-briefing-pill active-streak" title="Tage in Folge gelernt">
							<span>🔥</span>
							<span><b>${lz.streakDays || 0} Tage</b> Lernserie</span>
							<span style="opacity:0.4">·</span>
							<span style="font-size:11px">${Math.round((lz.todaySeconds || 0)/60)} Min heute gelernt</span>
						</div>
						<div class="nh-briefing-pill due-alert" data-nhaction="review" title="Karten jetzt lernen">
							<span>🃏</span>
							<span><b>${due}</b> Karten bereit</span>
							<span style="opacity:0.4">·</span>
							<span style="font-size:11px">${esc(firstCard.deck || "Karten")}</span>
						</div>
						<div class="nh-briefing-pill" title="Wochenziel">
							<span>🎯</span>
							<span>Wochenziel <b>${lz.goalPct || 0} %</b></span>
						</div>
					</div>
				</header>

				<!-- Claude Atelier Omni-Composer -->
				<div class="nh-composer-card">
					<div class="nh-composer-modes">
						<button type="button" class="nh-mode-chip active" data-nhaction="chat">✦ KI-Coach & Tutor</button>
						<button type="button" class="nh-mode-chip" data-nhaction="daily">📝 Daily Note öffnen</button>
						<button type="button" class="nh-mode-chip" data-nhaction="review">⚡ Karteikarten (${due})</button>
						<button type="button" class="nh-mode-chip" data-nhaction="newpage">＋ Neue Seite</button>
					</div>

					<div class="nh-composer-input-wrap">
						<textarea id="composerInput" class="nh-composer-textarea" rows="2" 
							placeholder="Frage zu deinen ${pages.length} Notizen stellen oder Strg+K Schnellsuche starten..."
							onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submitAtelierSearch(this);}"></textarea>
						<button type="button" class="nh-composer-submit" onclick="submitAtelierSearch(document.getElementById('composerInput'))" title="Suchen (Enter)">
							<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
						</button>
					</div>

					<div class="nh-composer-footer">
						<div class="nh-context-badge">
							<span class="dot"></span>
							<span>${pages.length} Notizen im echten Wissensspeicher aktiv</span>
						</div>
						<div class="nh-quick-prompts">
							<span class="nh-prompt-pill" data-nhaction="search">⌘K Schnellsuche</span>
							<span class="nh-prompt-pill" data-nhaction="chat">✦ KI-Chat öffnen</span>
							<span class="nh-prompt-pill" data-nhaction="library">📚 Bibliothek</span>
						</div>
					</div>
				</div>

				<!-- 2-Spalten Workspace Deck -->
				<div class="nh-deck-grid">
					
					<!-- Links: Das echte Manuskript -->
					${topDoc ? `
						<div class="nh-card-manuscript" data-nhpage="${esc(topDoc.id)}">
							<div>
								<div class="nh-card-header">
									<span class="nh-subject-badge">
										<span class="dot"></span>
										${topDoc.kind === 'heft' ? '📓 GoodNotes-Heft' : '📄 Notiz'} · Weitermachen
									</span>
									<span class="nh-time-tag">${fmtDate(topDoc.updated)} aktualisiert</span>
								</div>
								<h2 class="nh-manuscript-title">${esc(topDoc.title || "Unbenannt")}</h2>
								<p class="nh-manuscript-excerpt">
									${esc((topDoc.content || "").replace(/^[#\s\-*`>]+/gm, " ").slice(0, 180) || (topDoc.kind === 'heft' ? '📓 Handschriftliches GoodNotes-Heft mit Stiftskizzen und Notizen. Klicke hier, um das Heft aufzuschlagen...' : 'Klicke hier, um die Notiz im vollen Editor zu öffnen...'))}
								</p>
							</div>

							<div class="nh-card-footer">
								<span>${topDoc.kind === 'heft' ? 'GoodNotes Stift-Dokument' : 'Markdown Notiz'}</span>
								<button type="button" class="nh-continue-btn">Im Editor öffnen →</button>
							</div>
						</div>
					` : `
						<div class="nh-card-manuscript" data-nhaction="newpage">
							<h2 class="nh-manuscript-title">Neue Notiz anlegen</h2>
							<p class="nh-manuscript-excerpt">Klicke hier, um deine erste Notiz oder dein erstes GoodNotes-Heft anzulegen.</p>
						</div>
					`}

					<!-- Rechts: Study Hub & Checkliste -->
					<div class="nh-right-stack">
						
						<!-- FSRS Flashcard Quick Action -->
						<div class="nh-card-fsrs-interactive" data-nhaction="review">
							<div class="nh-fsrs-header">
								<span class="nh-fsrs-badge">
									<span>🃏</span> FSRS Lern-Sprint
								</span>
								<span class="nh-fsrs-counter">${due} fällig · ${esc(firstCard.deck || "Karten")}</span>
							</div>

							<div class="nh-flashcard-box">
								<div class="nh-flashcard-q">${esc(firstCard.front || "Keine fälligen Karten")}</div>
								<button type="button" class="nh-flashcard-reveal-btn">Jetzt wiederholen ▶</button>
							</div>

							<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--nh-text-tertiary)">
								<span>FSRS v5 aktiv</span>
								<span style="color:var(--nh-terracotta);font-weight:600">Vollbild-Lernen ›</span>
							</div>
						</div>

						<!-- Checkliste mit deinen echten Todos -->
						<div class="nh-card-checklist">
							<div class="nh-checklist-header">
								<span class="nh-checklist-title">Heutiger Fokus</span>
								<span class="nh-checklist-progress-text">${realTodos.length} Aufgaben</span>
							</div>
							<div class="nh-checklist-bar">
								<div class="nh-checklist-bar-fill" style="width: 35%"></div>
							</div>
							<div class="nh-checklist-items">
								${realTodos.slice(0, 4).map(t => `
									<div class="nh-task-row ${t.done ? 'done' : ''}" data-nhpage="${esc(t.pageId)}">
										<input type="checkbox" class="nh-task-checkbox" ${t.done ? 'checked' : ''} onclick="event.stopPropagation()">
										<span class="nh-task-label">${esc(t.text)}</span>
										<span class="nh-task-tag">${esc(t.pageTitle)}</span>
									</div>
								`).join('')}
							</div>
						</div>

					</div>
				</div>

				<!-- Auf deinem Schreibtisch (Echte Seiten) -->
				<section class="nh-desk-section">
					<div class="nh-desk-head">
						<span class="nh-desk-title">Auf deinem Schreibtisch</span>
						<button type="button" class="nh-filter-btn active" data-nhaction="library">Alle (${pages.length}) öffnen ›</button>
					</div>

					<div class="nh-desk-grid">
						${deskDocs.map(p => `
							<div class="nh-desk-card" data-nhpage="${esc(p.id)}">
								<div>
									<div class="nh-desk-card-top">
										<span class="nh-desk-card-type">${p.kind === 'heft' ? '📓 GoodNotes-Heft' : '📄 Notiz'}</span>
										<span>${fmtDate(p.updated)}</span>
									</div>
									<div class="nh-desk-card-title">${esc(p.title || "Unbenannt")}</div>
									<div class="nh-desk-card-snippet">
										${esc((p.content || "").replace(/^[#\s\-*`>]+/gm, " ").slice(0, 100) || (p.kind === 'heft' ? 'Handschriftliches GoodNotes-Heft...' : 'Kein Textauszug...'))}
									</div>
								</div>
								<div class="nh-desk-card-foot">
									<span>${p.kind === 'heft' ? 'Stift & Skizzen' : 'Markdown Notiz'}</span>
									<span style="color:var(--nh-terracotta);font-weight:600">Öffnen ›</span>
								</div>
							</div>
						`).join('')}
					</div>
				</section>

			</div>
		`;
	}

	// Standard Apple Native Fallback
	return `
		<div class="new-home-root">
			${switcher}
			<header class="nh-hero">
				<div class="nh-eyebrow">${esc(dateLine)}</div>
				<h1 class="nh-hero-title">${esc(greeting)}${homeName ? ", " + esc(homeName) : ""}</h1>
			</header>
			${topDoc ? `
				<div class="nh-card-manuscript" data-nhpage="${esc(topDoc.id)}">
					<h2 class="nh-manuscript-title">${esc(topDoc.title)}</h2>
					<p class="nh-manuscript-excerpt">${esc((topDoc.content||"").slice(0, 150))}</p>
				</div>
			` : ''}
		</div>
	`;
}

function renderNewHome() {
	if (S.view !== "home") return;
	const main = document.getElementById("main");
	if (!main) return;

	const mode = getActiveTestMode();
	if (mode === "old") {
		// Altes Original-Rendering
		return;
	}

	const html = buildHomeHtml(mode);
	main.innerHTML = html;
}

window.submitAtelierSearch = function(input) {
	const text = input ? input.value.trim() : "";
	if (!text) return;
	if (SEARCH && SEARCH.openPalette) {
		SEARCH.openPalette(text);
	}
};

// Globales Event-Handling für Klicks auf die neue Startseite — leitet ALLES an echte App-Aktionen weiter
document.addEventListener("click", (e) => {
	const modeBtn = e.target.closest("[data-nhmode]");
	if (modeBtn) {
		e.preventDefault();
		setActiveTestMode(modeBtn.getAttribute("data-nhmode"));
		return;
	}

	const pageCard = e.target.closest("[data-nhpage]");
	if (pageCard) {
		e.preventDefault();
		const id = pageCard.getAttribute("data-nhpage");
		if (id && TABS.openPage) {
			TABS.openPage(id);
		}
		return;
	}

	const actBtn = e.target.closest("[data-nhaction]");
	if (actBtn) {
		e.preventDefault();
		const act = actBtn.getAttribute("data-nhaction");
		if (act === "newpage" && RENDER.openTemplatePicker) RENDER.openTemplatePicker();
		else if (act === "review") {
			if (RENDER.openReview) RENDER.openReview();
			else if (RENDER.openCards) RENDER.openCards();
		}
		else if (act === "daily") {
			const daily = STATE.activePages().find((p) => p.daily === RENDER.localDayKey(new Date()));
			if (daily) TABS.openPage(daily.id);
			else if (RENDER.openTemplatePicker) RENDER.openTemplatePicker();
		}
		else if (act === "search" && SEARCH.openPalette) SEARCH.openPalette();
		else if (act === "library" && TABS.openLibrary) TABS.openLibrary();
		else if (act === "chat" && TABS.openNewTab) TABS.openNewTab("chat");
		return;
	}
}, true);

// Hook in RENDER.render()
const origRender = RENDER.render;
RENDER.render = function (...args) {
	origRender.apply(this, args);
	if (S.view === "home") {
		renderNewHome();
	}
};

// Backup MutationObserver auf #main
let _observerPending = false;
const obs = new MutationObserver(() => {
	if (S.view === "home" && getActiveTestMode() !== "old") {
		const oldHome = document.querySelector("#main .home-v2");
		if (oldHome && !_observerPending) {
			_observerPending = true;
			requestAnimationFrame(() => {
				_observerPending = false;
				renderNewHome();
			});
		}
	}
});

window.addEventListener("DOMContentLoaded", () => {
	const main = document.getElementById("main");
	if (main) obs.observe(main, { childList: true });
	setTimeout(renderNewHome, 100);
});

console.info("Impala67: Test-Startseite (Apple/Claude Atelier) erfolgreich in echte UI integriert!");
