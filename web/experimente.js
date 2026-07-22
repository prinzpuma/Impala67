"use strict";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { AI } from "./ai.js";
import { TOOLS } from "./tools.js";
import { PDFS } from "./pdfs.js";
import { TELE } from "./telemetrie.js";

// experimente.js — 🧪 Experimentelle KI-Lernmodi (Phase 2 aus „kommt noch“)
// ---------------------------------------------------------------------------
// Alle Features sind STANDARDMÄSSIG AUS und werden unter Einstellungen →
// „🧪 Experimente“ einzeln aktiviert. Gespeichert als
// S.settings.experiments = { feynman: true, … } — synct wie jede Einstellung.
//
// Architektur wie telemetrie.js: Das Modul koppelt sich von außen an —
// MutationObserver auf die Lernkarte, Capture-Listener für Klicks/Toggles und
// sanfte Wrapper um TOOLS.run bzw. PDFS.ingest. Nötige Kern-Änderungen sind
// minimal: settings.js ruft EXP.settingsHtml(), ai.js hängt EXP.extraToolDefs()
// an die Tool-Liste, main.js importiert das Modul und setzt window.EXP.
//
// Telemetrie (21. Juli 2026): Jede Nutzung wird als expEvent geloggt; Karten-
// Features markieren sich zusätzlich per TELE.mark → exp-Array im review-Event.
// So kann analyse.js „Experimente × Erfolg“ auswerten (siehe track/trackCard).

export const EXP = (() => {
	// ---------- Katalog (Reihenfolge = Anzeige in den Einstellungen) ----------
	const FEATURES = [
		["feynman", "🧑‍🏫 Feynman-Modus", "„Erst erklären“: Antwort in eigenen Worten tippen oder diktieren. Die KI prüft (getroffen / fehlend / falsch) und schlägt eine Note vor — bewertet wird weiterhin von dir."],
		["elaboration", "🤔 Elaborative Interrogation", "Nach ca. jeder 4. gut beantworteten Karte fragt die KI „Und warum?“ nach — mit kurzem Feedback zu deiner Begründung."],
		["variation", "🔀 Fragen-Variation", "Jede 3. Wiederholung wird die Vorderseite umformuliert, damit du das Konzept statt des Wortlauts lernst. Varianten werden lokal gecacht (offline-fähig)."],
		["scaffolding", "💡 Gestufte Hinweise", "Statt sofort aufzudecken: Kategorie → Anfang/Struktur → Eselsbrücke. Erst nach dem ersten Abrufversuch — sonst leidet der Testing-Effekt."],
		["mc", "🎯 Distraktor-Quiz", "Karte als Multiple-Choice mit plausiblen Falschantworten. Auflösung + Erklärung kommen sofort (Pflicht — sonst prägen sich Distraktoren ein)."],
		["fehler", "🕵️ Fehler-Detektor", "Die KI schreibt eine kurze Erklärung mit eingebauten Fehlern, du suchst sie. Die Auflösung wird immer angezeigt. Start unten per Button."],
		["pretest", "📖 Pre-Testing bei PDFs", "Nach dem PDF-Import stellt die KI dir Vorab-Fragen, BEVOR du liest. Falsch raten ist erwünscht — es primt das Gehirn (Pre-Testing-Effekt)."],
		["wissensluecken", "🔍 Wissenslücken-Detektor", "Neues Chat-Werkzeug: „Prüfe meine Notiz zu X auf Lücken“ — findet Fachbegriffe, die benutzt, aber nie erklärt werden (Fluch des Wissens)."],
	];

	const flags = () => (S.settings && S.settings.experiments) || {};
	const on = (k) => !!flags()[k];

	// ---------- 🧪 → Telemetrie (Phase 2 messbar machen) ----------
	// track: Nutzung als expEvent ins Telemetrie-Log (fire-and-forget, nie kritisch).
	// trackCard: zusätzlich TELE.mark — landet als exp-Array im review-Event der
	// AKTUELLEN Karte (nur für Features, die VOR der Bewertung laufen).
	const track = (feature, data) => { try { TELE.log("expEvent", Object.assign({ feature }, data || {})); } catch (err) { /* Telemetrie ist nie kritisch */ } };
	const trackCard = (feature, data) => { try { TELE.mark(feature); } catch (err) {} track(feature, data); };

	function parseJson(raw) {
		try {
			const m = String(raw || "").match(/\{[\s\S]*\}/);
			return m ? JSON.parse(m[0]) : null;
		} catch (e) { return null; }
	}
	async function ask(prompt, system) {
		const out = await AI.complete(prompt, system || "Du bist ein knapper, präziser Lern-Coach. Antworte auf Deutsch.");
		return String(out || "").trim();
	}
	// Aktuelle Lernkarte — dieselbe Quelle wie render-anki.js
	function currentCard() {
		try {
			const snap = STATE.studySnapshot(S.ankiDeck);
			return (snap && snap.dueNow && snap.dueNow[0]) || null;
		} catch (e) { return null; }
	}

	// ---------- Leichtes eigenes Modal ----------
	function openModal(title, bodyHtml) {
		closeModal();
		const bd = document.createElement("div");
		bd.className = "exp-modal-backdrop";
		bd.innerHTML = '<div class="exp-modal"><div class="exp-modal-head"><b>' + U.esc(title) + "</b>" +
			'<button type="button" class="mini" data-expclose="1" title="Schließen">✕</button></div>' +
			'<div class="exp-modal-body">' + bodyHtml + "</div></div>";
		bd.addEventListener("click", (e) => {
			if (e.target === bd || (e.target.closest && e.target.closest("[data-expclose]"))) closeModal();
		});
		document.body.appendChild(bd);
		return bd;
	}
	function closeModal() {
		const old = document.querySelector(".exp-modal-backdrop");
		if (old) old.remove();
	}

	// ---------- Einstellungs-Sektion (settings.js ruft settingsHtml auf) ----------
	function settingsHtml() {
		let h = '<p class="hint">Experimentelle KI-Lernmodi (Phase 2). Alles hier ist <b>standardmäßig aus</b>, wirkt sofort ohne Neustart und braucht eine konfigurierte KI (außer bereits gecachte Varianten/Hinweise).</p>';
		FEATURES.forEach((f) => {
			h += '<label class="exp-row"><input type="checkbox" data-expflag="' + f[0] + '"' + (on(f[0]) ? " checked" : "") + ">" +
				"<span><b>" + U.esc(f[1]) + '</b><div class="hint">' + U.esc(f[2]) + "</div></span></label>";
		});
		h += '<div class="row-btns"><button type="button" data-expfehler="1"' + (on("fehler") ? "" : " disabled") + '>🕵️ Fehler-Detektor jetzt starten</button></div>';
		return h;
	}

	// Toggles verdrahten sich selbst (Capture) — settings.js braucht keine Logik.
	document.addEventListener("change", (e) => {
		const t = e.target;
		if (!t || !t.dataset || !t.dataset.expflag) return;
		const next = Object.assign({}, flags());
		next[t.dataset.expflag] = !!t.checked;
		STATE.dispatch("settingsSet", { experiments: next });
		const fBtn = document.querySelector("[data-expfehler]");
		if (fBtn) fBtn.disabled = !next.fehler;
		if (U.toast) U.toast(t.checked ? "🧪 Experiment aktiviert" : "Experiment deaktiviert");
	}, true);

	// ---------- Klick-Verdrahtung (Capture, wie telemetrie.js) ----------
	document.addEventListener("click", (e) => {
		const t = e.target && e.target.closest ? e.target.closest("button") : null;
		if (!t) return;
		const d = t.dataset || {};
		if (d.expfehler) { runFehlerDetektor(); return; }
		if (d.expfeynstart) { openFeynman(); return; }
		if (d.expfeynmic) { toggleMic(t); return; }
		if (d.expfeyncheck) { checkFeynman(t); return; }
		if (d.exphint) { nextHint(t); return; }
		if (d.expmc) { openMc(); return; }
		if (d.expmcopt != null) { resolveMc(t); return; }
		if (d.expvarorig != null) { showOriginalFront(t); return; }
		// 🤔 Elaborative Interrogation: hängt sich an die normalen Bewertungs-
		// Buttons. Capture läuft VOR app.js — die Karte ist noch die aktuelle.
		if (d.ankigrade && on("elaboration")) {
			const g = Number(d.ankigrade);
			const card = currentCard();
			if (g >= 3 && card && Math.random() < 0.25) setTimeout(() => askWhy(card), 350);
		}
	}, true);

	// ---------- Lernkarten-Verstärkung (Beobachter statt render-anki-Umbau) ----------
	let rafPending = false;
	let shownAt = 0; // wann die Vorderseite erschien (für „erst selbst versuchen“)
	let hintLevel = 0;
	let hintsUsedFor = null; // Karten-ID, für die Hinweise benutzt wurden
	let lastCountedCard = null; // Variation zählt pro Karte, nicht pro Rerender
	let varTrackedFor = null; // Telemetrie: Varianten-Anzeige 1× pro Karte loggen, nicht pro Re-Render

	function scheduleEnhance() {
		if (rafPending) return;
		rafPending = true;
		requestAnimationFrame(() => { rafPending = false; enhance(); });
	}
	function enhance() {
		const cardEl = document.querySelector(".anki-study-mode .study-card");
		if (!cardEl || cardEl.dataset.expdone) return;
		cardEl.dataset.expdone = "1";
		const card = currentCard();
		if (!card) return;
		const showBtn = cardEl.querySelector("[data-ankishowback]");
		if (showBtn) {
			// Vorderseite
			shownAt = Date.now();
			hintLevel = 0;
			if (on("variation")) applyVariation(cardEl, card);
			const extras = [];
			// Kein Doppel-Knopf: Im Feynman-LERNMODUS (S.ankiFeyn, beim Stapel-Start
			// gewählt) rendert render-anki.js das Erklär-Feld bereits INLINE in die
			// Karte (.feyn-inline) — dann keinen zusätzlichen Dialog-Knopf anbieten.
			if (on("feynman") && !S.ankiFeyn && !cardEl.querySelector(".feyn-inline")) extras.push('<button type="button" class="mini" data-expfeynstart="1">🧑‍🏫 Erst erklären</button>');
			hydrateFeynInline(cardEl, card);
			if (on("scaffolding")) extras.push('<button type="button" class="mini" data-exphint="1">💡 Hinweis</button>');
			if (on("mc")) extras.push('<button type="button" class="mini" data-expmc="1">🎯 Als Quiz</button>');
			const actions = showBtn.closest(".modal-actions");
			if (extras.length && actions) actions.insertAdjacentHTML("beforeend", extras.join(""));
		} else if (cardEl.querySelector(".grades")) {
			const grades = cardEl.querySelector(".grades");
			// Rückseite (Feynman-Lernmodus): Das KI-Feedback erscheint ÜBER den
			// Bewertungs-Buttons statt in einem Dialog — der Notenvorschlag wird
			// direkt am passenden Button markiert. So bleibt der komplette Fluss
			// (erklären → prüfen → aufdecken → bewerten) in EINER Karte.
			if (feynVerdict && feynVerdict.cardId === card.id) {
				grades.insertAdjacentHTML("beforebegin", '<div class="exp-feynout feyn-verdict">' + feynVerdict.html + "</div>");
				const gb = grades.querySelector('[data-ankigrade="' + feynVerdict.note + '"]');
				if (gb) {
					gb.classList.add("grade-suggest");
					gb.insertAdjacentHTML("beforeend", '<span class="grade-ai" title="Vorschlag der KI aus deiner Erklärung">🧑‍🏫 KI-Vorschlag</span>');
				}
				feynVerdict = null;
			}
			// Ehrlichkeits-Notiz, wenn Hinweise benutzt wurden
			if (hintsUsedFor === card.id) {
				grades.insertAdjacentHTML("beforebegin",
					'<div class="hint exp-honesty">💡 Mit Hinweisen abgerufen — bewerte ehrlich (eher „Schwer“).</div>');
				hintsUsedFor = null;
			}
		}
	}

	// ---------- 🔀 Fragen-Variation (Cache in localStorage → offline-fähig) ----------
	async function applyVariation(cardEl, card) {
		const seenKey = "impala67ExpSeen:" + card.id;
		let seen = Number(localStorage.getItem(seenKey)) || 0;
		if (lastCountedCard !== card.id) {
			seen++;
			lastCountedCard = card.id;
			try { localStorage.setItem(seenKey, String(seen)); } catch (err) {}
		}
		if (seen < 3 || seen % 3 !== 0) return;
		const cacheKey = "impala67ExpVar:" + card.id;
		let vars = [];
		try { vars = JSON.parse(localStorage.getItem(cacheKey) || "[]"); } catch (err) {}
		if (!vars.length) {
			try {
				const raw = await ask("Karteikarte:\nFrage: " + card.front + "\nAntwort: " + card.back +
					'\n\nSchreibe 3 alternative Formulierungen der FRAGE (gleiche Antwort, anderer Blickwinkel, kein Wortlaut-Recycling). Antworte NUR als JSON: {"varianten":["…","…","…"]}');
				const j = parseJson(raw);
				if (j && Array.isArray(j.varianten) && j.varianten.length) {
					vars = j.varianten.map(String);
					try { localStorage.setItem(cacheKey, JSON.stringify(vars)); } catch (err) {}
				}
			} catch (err) { /* offline → Original zeigen */ }
		}
		if (!vars.length || !document.body.contains(cardEl)) return;
		const v = vars[Math.floor(seen / 3 - 1) % vars.length];
		const face = cardEl.querySelector(".card-face");
		if (!face || !v) return;
		if (varTrackedFor !== card.id) { varTrackedFor = card.id; trackCard("variation", { cardId: card.id }); }
		face.dataset.exporigHtml = face.innerHTML;
		face.innerHTML = '<div class="hint">🔀 Variante · <button type="button" class="mini" data-expvarorig="1">Original zeigen</button></div>' + U.md(v);
	}
	function showOriginalFront(btn) {
		const face = btn.closest(".card-face");
		if (face && face.dataset.exporigHtml) {
			face.innerHTML = face.dataset.exporigHtml;
			delete face.dataset.exporigHtml;
		}
	}

	// ---------- 💡 Gestufte Hinweise (erst NACH dem ersten Abrufversuch) ----------
	async function nextHint(btn) {
		const card = currentCard();
		if (!card) return;
		if (hintLevel === 0 && Date.now() - shownAt < 4000) {
			if (U.toast) U.toast("Erst selbst versuchen! Hinweise gibt es nach dem ersten Abrufversuch.");
			return;
		}
		const key = "impala67ExpHints:" + card.id;
		let hints = null;
		try { hints = JSON.parse(localStorage.getItem(key) || "null"); } catch (err) {}
		if (!hints) {
			btn.disabled = true;
			const old = btn.textContent;
			btn.textContent = "💡 …";
			try {
				const raw = await ask("Karteikarte:\nFrage: " + card.front + "\nAntwort: " + card.back +
					'\n\nErzeuge 3 gestufte Hinweise, OHNE die Antwort zu verraten:\n1) grobe Kategorie/Richtung, 2) Anfangsbuchstabe oder Struktur, 3) Eselsbrücke.\nAntworte NUR als JSON: {"hinweise":["…","…","…"]}');
				const j = parseJson(raw);
				hints = j && Array.isArray(j.hinweise) ? j.hinweise.map(String) : null;
				if (hints) { try { localStorage.setItem(key, JSON.stringify(hints)); } catch (err) {} }
			} catch (err) {
				if (U.toast) U.toast("Hinweise gerade nicht verfügbar (KI offline?)");
			}
			btn.disabled = false;
			btn.textContent = old;
			if (!hints) return;
		}
		if (!hints[hintLevel]) return;
		hintsUsedFor = card.id;
		trackCard("scaffolding", { cardId: card.id, stufe: hintLevel + 1 });
		let box = document.querySelector(".exp-hint-box");
		if (!box) {
			box = document.createElement("div");
			box.className = "exp-hint-box";
			const actions = btn.closest(".modal-actions");
			if (actions) actions.parentElement.insertBefore(box, actions);
			else btn.parentElement.appendChild(box);
		}
		box.insertAdjacentHTML("beforeend", '<div class="exp-hint-line">' + U.esc(hints[hintLevel]) + "</div>");
		hintLevel++;
		btn.textContent = hintLevel >= 3 ? "💡 Keine weiteren Hinweise" : "💡 Noch ein Hinweis (" + hintLevel + "/3)";
		if (hintLevel >= 3) btn.disabled = true;
	}

	// ---------- 🎯 Distraktor-Quiz (Auflösung + Erklärung sofort = Pflicht) ----------
	let mcState = null;
	async function openMc() {
		const card = currentCard();
		if (!card) return;
		const bd = openModal("🎯 Distraktor-Quiz", '<div class="exp-wait">Quiz wird erstellt …</div>');
		try {
			const raw = await ask("Karteikarte:\nFrage: " + card.front + "\nAntwort: " + card.back +
				'\n\nBaue daraus eine Multiple-Choice-Frage: 1 korrekte Antwort + 3 PLAUSIBLE Falschantworten (typische Denkfehler/Verwechslungen). Erkläre zu JEDER Option in einem Satz, warum sie richtig bzw. falsch ist.\nAntworte NUR als JSON: {"frage":"…","optionen":[{"text":"…","korrekt":true,"warum":"…"}]}');
			const j = parseJson(raw);
			if (!j || !Array.isArray(j.optionen) || !j.optionen.some((o) => o && o.korrekt)) throw new Error("Unbrauchbare KI-Antwort");
			const opts = j.optionen.slice(0, 4).sort(() => Math.random() - 0.5);
			mcState = { opts, cardId: card.id };
			const body = bd.querySelector(".exp-modal-body");
			if (!body) return;
			body.innerHTML = '<div class="md">' + U.md(String(j.frage || card.front)) + "</div>" +
				opts.map((o, i) => '<button type="button" class="exp-mc-opt" data-expmcopt="' + i + '">' + U.esc(String(o.text)) + "</button>").join("") +
				'<p class="hint">Nach deinem Klick kommt sofort die Auflösung mit Erklärung — so prägt sich kein Distraktor ein.</p>';
		} catch (err) {
			closeModal();
			if (U.toast) U.toast("Quiz nicht möglich: " + ((err && err.message) || err));
		}
	}
	function resolveMc(btn) {
		if (!mcState) return;
		const picked = mcState.opts[Number(btn.dataset.expmcopt)];
		trackCard("mc", { cardId: mcState.cardId, korrekt: !!(picked && picked.korrekt) });
		const all = document.querySelectorAll(".exp-mc-opt");
		all.forEach((el) => {
			const o = mcState.opts[Number(el.dataset.expmcopt)];
			el.disabled = true;
			if (o && o.korrekt) el.classList.add("correct");
			else if (el === btn) el.classList.add("wrong");
			else el.classList.add("off");
			if (o && (o.korrekt || el === btn) && o.warum) {
				el.insertAdjacentHTML("beforeend", '<div class="hint">' + U.esc(String(o.warum)) + "</div>");
			}
		});
		mcState = null;
	}

	// ---------- 🧑‍🏫 Feynman-Modus ----------
	// Zwei Wege:
	// (a) Experiment „Erst erklären“ auf einer normalen Karte → kleiner Dialog (openFeynman).
	// (b) Feynman-LERNMODUS (S.ankiFeyn, beim Stapel-Start gewählt): render-anki.js baut
	//     das Erklär-Feld direkt in die Lernkarte ein (.feyn-inline) — kein Dialog, kein
	//     Kontextwechsel. Nach „Prüfen & aufdecken“ wird die Karte automatisch aufgedeckt;
	//     das Feedback landet über den Bewertungs-Buttons (siehe enhance()).
	let feynCard = null;
	let feynVerdict = null; // { cardId, note, html } — Feedback für die Rückseite
	let feynDraft = null; // { cardId, text } — Tipptext übersteht ein Re-Render
	function hydrateFeynInline(cardEl, card) {
		const box = cardEl.querySelector(".feyn-inline");
		if (!box) return;
		const ta = box.querySelector(".exp-answer");
		if (!ta) return;
		// Entwurf wiederherstellen (Re-Render z. B. durch Selbsteinschätzungs-Chips)
		if (feynDraft && feynDraft.cardId !== card.id) feynDraft = null;
		if (feynDraft && !ta.value) ta.value = feynDraft.text;
		// Fokus direkt ins Feld — Erklären ist in diesem Modus der Hauptweg
		if (!ta.value) setTimeout(() => { if (document.body.contains(ta)) ta.focus(); }, 0);
	}
	// Entwurf merken + Tastatur: ␣/1–4 dürfen im Erklär-Feld KEINE Lern-Shortcuts
	// auslösen; Strg/⌘+Enter startet die Prüfung direkt aus dem Textfeld.
	document.addEventListener("input", (e) => {
		const t = e.target;
		if (t && t.classList && t.classList.contains("exp-answer") && t.closest(".feyn-inline")) {
			const card = currentCard();
			feynDraft = card ? { cardId: card.id, text: t.value } : null;
		}
	}, true);
	document.addEventListener("keydown", (e) => {
		const t = e.target;
		if (!t || !t.classList || !t.classList.contains("exp-answer")) return;
		if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
			const wrap = t.closest(".feyn-inline, .exp-modal");
			const check = wrap && wrap.querySelector("[data-expfeyncheck]");
			if (check) { e.preventDefault(); check.click(); }
			return;
		}
		e.stopPropagation();
	}, true);
	function openFeynman() {
		const card = currentCard();
		if (!card) return;
		feynCard = card;
		openModal("🧑‍🏫 Feynman-Modus",
			'<div class="md">' + U.md(card.front) + "</div>" +
			'<p class="hint">Erkläre die Antwort in eigenen Worten — so einfach, dass es ein Kind versteht.</p>' +
			'<textarea class="exp-answer" rows="5" placeholder="Meine Erklärung …"></textarea>' +
			'<div class="row-btns"><button type="button" data-expfeynmic="1">🎙️ Diktieren</button>' +
			'<button type="button" data-expfeyncheck="1">Von der KI prüfen lassen</button></div>' +
			'<div class="exp-feynout"></div>');
	}
	async function checkFeynman(btn) {
		// Funktioniert im Dialog (.exp-modal, Experiment-Knopf) UND inline in der
		// Lernkarte (.feyn-inline, Feynman-Lernmodus) — gleiche Prüfung, andere Ausgabe.
		const wrap = btn.closest(".feyn-inline") || btn.closest(".exp-modal");
		if (!wrap) return;
		const inline = wrap.classList.contains("feyn-inline");
		const card = inline ? currentCard() : feynCard;
		if (!card) return;
		const txt = (wrap.querySelector(".exp-answer") || {}).value || "";
		if (!txt.trim()) { if (U.toast) U.toast("Erst erklären — tippen oder diktieren"); return; }
		btn.disabled = true;
		const oldLabel = btn.textContent;
		btn.textContent = "Prüfe …";
		try {
			const raw = await ask("Karteikarte:\nFrage: " + card.front + "\nMusterantwort: " + card.back +
				"\n\nErklärung des Lernenden:\n" + txt.trim() +
				'\n\nBewerte die Erklärung als Rubrik. Antworte NUR als JSON:\n{"getroffen":["Kernpunkt …"],"fehlend":["…"],"falsch":["…"],"note":3,"kommentar":"1–2 Sätze"}\nnote: 1=Nochmal, 2=Schwer, 3=Gut, 4=Einfach.');
			const j = parseJson(raw) || {};
			const li = (arr, icon) => (Array.isArray(arr) ? arr : []).map((x) => "<li>" + icon + " " + U.esc(String(x)) + "</li>").join("");
			const names = { 1: "Nochmal", 2: "Schwer", 3: "Gut", 4: "Einfach" };
			const note = names[j.note] ? Number(j.note) : 3;
			const rubric = "<ul>" + li(j.getroffen, "✅") + li(j.fehlend, "⚠️ fehlt:") + li(j.falsch, "❌") + "</ul>" +
				"<p>" + U.esc(String(j.kommentar || "")) + "</p>";
			trackCard("feynman", { cardId: card.id, note });
			const verdictHtml = rubric + "<p><b>KI-Vorschlag: „" + names[note] + "“</b> — bestätige mit den Bewertungs-Buttons. Die Entscheidung bleibt bei dir.</p>";
			if (inline) {
				// Lernmodus: Feedback wandert auf die Rückseite (enhance() rendert es
				// über den Bewertungs-Buttons) — Karte automatisch aufdecken.
				feynVerdict = { cardId: card.id, note, html: verdictHtml };
				feynDraft = null;
				const show = document.querySelector('.anki-study-mode [data-ankishowback]');
				if (show) { show.click(); return; } // Re-Render — die Karte samt Button existiert danach neu
			} else {
				wrap.querySelector(".exp-feynout").innerHTML = verdictHtml;
			}
		} catch (err) {
			wrap.querySelector(".exp-feynout").innerHTML = '<p class="hint">KI nicht erreichbar — später erneut versuchen.</p>';
		}
		btn.disabled = false;
		btn.textContent = oldLabel;
	}
	// Diktat über die Web Speech API (läuft lokal im Browser, wie voice.js)
	let rec = null;
	function toggleMic(btn) {
		const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!SR) { if (U.toast) U.toast("Diktat wird von diesem Browser nicht unterstützt"); return; }
		if (rec) { try { rec.stop(); } catch (err) {} rec = null; btn.classList.remove("active"); return; }
		const ta = btn.closest(".exp-modal, .feyn-inline").querySelector(".exp-answer");
		rec = new SR();
		rec.lang = "de-DE";
		rec.continuous = true;
		rec.interimResults = false;
		rec.onresult = (e) => {
			for (let i = e.resultIndex; i < e.results.length; i++) {
				if (e.results[i].isFinal && ta) ta.value = (ta.value + " " + e.results[i][0].transcript).trim();
			}
		};
		rec.onend = () => { rec = null; btn.classList.remove("active"); };
		rec.start();
		btn.classList.add("active");
	}

	// ---------- 🤔 Elaborative Interrogation ----------
	async function askWhy(card) {
		const bd = openModal("🤔 Und warum?",
			'<p class="hint">Elaborative Interrogation: kurz begründen verankert das Wissen tiefer. Überspringen ist ok.</p>' +
			'<div class="exp-wait">Folgefrage wird erstellt …</div>');
		try {
			const q = await ask("Karteikarte:\nFrage: " + card.front + "\nAntwort: " + card.back +
				"\n\nStelle GENAU EINE kurze Warum- oder Wie-Folgefrage zu dieser Karte (nur die Frage, eine Zeile).");
			track("elaboration", { cardId: card.id }); // läuft NACH der Bewertung → nur expEvent, kein Karten-Marker
			const body = bd.querySelector(".exp-modal-body");
			if (!body || !document.body.contains(bd)) return;
			body.innerHTML = '<div class="md">' + U.md(q) + "</div>" +
				'<textarea class="exp-answer" rows="3" placeholder="Deine Begründung …"></textarea>' +
				'<div class="row-btns"><button type="button" data-expwhy="1">Prüfen</button>' +
				'<button type="button" data-expclose="1">Überspringen</button></div>';
			body.querySelector("[data-expwhy]").addEventListener("click", async (ev) => {
				const b = ev.currentTarget;
				const ans = (body.querySelector(".exp-answer") || {}).value || "";
				if (!ans.trim()) return;
				b.disabled = true;
				b.textContent = "Prüfe …";
				try {
					const fb = await ask("Folgefrage: " + q + "\nKarte: " + card.front + " → " + card.back +
						"\nBegründung des Lernenden: " + ans.trim() +
						"\n\nGib in 2–3 Sätzen Feedback: Was stimmt, was fehlt, was ist falsch?");
					body.insertAdjacentHTML("beforeend", '<div class="exp-feedback md">' + U.md(fb) + "</div>");
					b.remove();
				} catch (err) {
					b.disabled = false;
					b.textContent = "Prüfen";
					if (U.toast) U.toast("KI nicht erreichbar");
				}
			});
		} catch (err) {
			closeModal(); // still scheitern — der normale Lernfluss geht einfach weiter
		}
	}

	// ---------- 🕵️ Fehler-Detektor (Start über die Einstellungen) ----------
	async function runFehlerDetektor() {
		const thema = window.prompt("Zu welchem Thema soll die KI eine Erklärung mit eingebauten Fehlern schreiben?");
		if (!thema) return;
		track("fehler", { thema });
		const bd = openModal("🕵️ Fehler-Detektor", '<div class="exp-wait">Text wird erstellt …</div>');
		try {
			const raw = await ask('Schreibe eine kurze Erklärung (5–8 Sätze) zum Thema „' + thema +
				'“ und baue GENAU 2 sachliche Fehler ein (plausibel, keine Tippfehler).\nAntworte NUR als JSON: {"text":"…","fehler":[{"falsch":"Zitat aus dem Text","richtig":"Korrektur","warum":"…"}]}');
			const j = parseJson(raw);
			if (!j || !j.text) throw new Error("Unbrauchbare KI-Antwort");
			const body = bd.querySelector(".exp-modal-body");
			if (!body) return;
			body.innerHTML = '<div class="md">' + U.md(String(j.text)) + "</div>" +
				'<p class="hint">Finde die 2 eingebauten Fehler! Die Auflösung wird danach IMMER angezeigt — sonst prägen sich Fehler ein (Misinformation-Risiko).</p>' +
				'<div class="row-btns"><button type="button" data-expreveal="1">Auflösung zeigen</button></div>';
			body.querySelector("[data-expreveal]").addEventListener("click", (ev) => {
				ev.currentTarget.remove();
				body.insertAdjacentHTML("beforeend", "<ul>" + (Array.isArray(j.fehler) ? j.fehler : []).map((f) =>
					"<li>❌ „" + U.esc(String(f.falsch || "")) + "“ → ✅ " + U.esc(String(f.richtig || "")) +
					(f.warum ? ' <span class="hint">(' + U.esc(String(f.warum)) + ")</span>" : "") + "</li>").join("") + "</ul>");
			});
		} catch (err) {
			closeModal();
			if (U.toast) U.toast("Fehler-Detektor nicht möglich: " + ((err && err.message) || err));
		}
	}

	// ---------- 📖 Pre-Testing: sanfter Wrapper um die PDF-Pipeline ----------
	const origIngest = typeof PDFS.ingest === "function" ? PDFS.ingest.bind(PDFS) : null;
	if (origIngest) {
		PDFS.ingest = async function (file, onStatus) {
			const id = await origIngest(file, onStatus);
			try {
				if (on("pretest") && id && S.pages && S.pages[id]) preTest(S.pages[id]);
			} catch (err) { /* Pre-Test ist rein optional */ }
			return id;
		};
	}
	async function preTest(page) {
		const src = String(page.content || "").slice(0, 6000);
		if (src.length < 200) return;
		track("pretest", { pageId: page.id });
		const bd = openModal("📖 Pre-Testing: " + (page.title || "Neues PDF"), '<div class="exp-wait">Vorab-Fragen werden erstellt …</div>');
		try {
			const raw = await ask("Textauszug:\n" + src +
				'\n\nErzeuge 4 kurze Vorab-Fragen mit knapper Musterantwort, die das Kernwissen dieses Textes abfragen.\nAntworte NUR als JSON: {"fragen":[{"q":"…","a":"…"}]}');
			const j = parseJson(raw);
			const fragen = j && Array.isArray(j.fragen) ? j.fragen.slice(0, 5) : [];
			if (!fragen.length) throw new Error("keine Fragen");
			const body = bd.querySelector(".exp-modal-body");
			if (!body) return;
			body.innerHTML = '<p class="hint">Beantworte aus dem Bauch — <b>falsch raten ist erwünscht!</b> Erfolgloses Vorab-Raten verbessert nachweislich das spätere Behalten (Pre-Testing-Effekt).</p>' +
				fragen.map((f, i) => '<div class="exp-pretest-q"><b>' + (i + 1) + ". " + U.esc(String(f.q)) + '</b><textarea rows="2" placeholder="Deine Vermutung …"></textarea></div>').join("") +
				'<div class="row-btns"><button type="button" data-expreveal="1">Musterantworten zeigen — dann lesen</button></div>';
			body.querySelector("[data-expreveal]").addEventListener("click", (ev) => {
				ev.currentTarget.remove();
				body.querySelectorAll(".exp-pretest-q").forEach((el, i) => {
					el.insertAdjacentHTML("beforeend", '<div class="hint">✅ ' + U.esc(String((fragen[i] || {}).a || "")) + "</div>");
				});
			});
		} catch (err) {
			closeModal(); // kein Drama — das PDF ist ja bereits einsortiert
		}
	}

	// ---------- 🔍 Wissenslücken-Detektor als Chat-Werkzeug ----------
	// ai.js hängt extraToolDefs() an die Tool-Liste an; ausgeführt wird das Tool
	// über einen Wrapper um TOOLS.run — tools.js selbst bleibt unangetastet.
	function extraToolDefs() {
		if (!on("wissensluecken")) return [];
		return [{
			type: "function",
			function: {
				name: "check_wissensluecken",
				description: "🧪 Prüft eine Notiz-Seite auf Wissenslücken: Fachbegriffe, die verwendet, aber nirgends definiert oder erklärt werden (Fluch des Wissens). Nutzen, wenn der Nutzer seine Notizen auf Lücken/unklare Begriffe prüfen will.",
				parameters: {
					type: "object",
					properties: { seite: { type: "string", description: "Titel der zu prüfenden Seite" } },
					required: ["seite"],
				},
			},
		}];
	}
	const origRun = typeof TOOLS.run === "function" ? TOOLS.run.bind(TOOLS) : null;
	if (origRun) {
		TOOLS.run = async function (name, a) {
			if (name === "check_wissensluecken") {
				const title = (a && a.seite) || "";
				const pg = typeof STATE.findPage === "function" ? STATE.findPage(title) : null;
				if (!pg) return { error: "Seite nicht gefunden: " + title };
				track("wissensluecken", { pageId: pg.id || null });
				const raw = await ask("Notiz „" + (pg.title || title) + "“:\n" + String(pg.content || "").slice(0, 8000) +
					'\n\nFinde Fachbegriffe, die verwendet, aber NIRGENDS in der Notiz definiert oder erklärt werden. Antworte NUR als JSON: {"begriffe":[{"begriff":"…","kontext":"kurzes Zitat","vorschlag":"Ein-Satz-Erklärung"}]}');
				const j = parseJson(raw) || {};
				return {
					seite: pg.title || title,
					unerklaerte_begriffe: j.begriffe || [],
					hinweis: "Frage den Nutzer, welche Begriffe als Erklärung in der Notiz oder als neue Karteikarte ergänzt werden sollen.",
				};
			}
			return origRun(name, a);
		};
	}

	// ---------- Anlauf ----------
	// Styles für die Inline-Feynman-UI kommen aus dem Modul selbst (wie die
	// gesamte Verdrahtung hier) — styles.css bleibt unangetastet.
	function injectCss() {
		if (document.getElementById("expFeynCss")) return;
		const st = document.createElement("style");
		st.id = "expFeynCss";
		st.textContent =
			".feyn-inline{margin-top:10px;padding:12px 14px;border:1px dashed var(--border,rgba(128,128,128,.4));border-radius:10px;text-align:left}" +
			".feyn-inline-head{margin-bottom:2px}" +
			".feyn-inline .exp-answer{width:100%;box-sizing:border-box;margin:8px 0 6px;resize:vertical}" +
			".feyn-inline-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}" +
			".feyn-verdict{margin:10px auto 4px;padding:10px 14px;border-radius:10px;background:var(--surface-hover,rgba(128,128,128,.12));text-align:left;max-width:640px}" +
			".feyn-verdict ul{margin:4px 0;padding-left:18px}" +
			".grades .grade-suggest{outline:2px solid var(--accent,#2f6fed);outline-offset:2px}" +
			".grade-ai{display:block;font-size:10px;opacity:.8}";
		document.head.appendChild(st);
	}
	function init() {
		injectCss();
		new MutationObserver(scheduleEnhance).observe(document.body, { childList: true, subtree: true });
		scheduleEnhance();
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
	else init();

	return { settingsHtml, extraToolDefs, enabled: on };
})();