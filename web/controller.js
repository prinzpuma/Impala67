"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { RENDER_ANKI } from "./render-anki.js";

// controller.js — 🎮 Gamepad-Steuerung für den Lernmodus (Roadmap „Controller für
// Karteikarten“, umgesetzt 27. Juli 2026). Vier Grundsätze:
// • KEINE zweite Lernlogik: jede Aktion klickt genau die Schaltfläche, die auch mit
//   Maus/Tastatur benutzt wird (data-ankishowback / data-ankigrade / data-ankiedit …).
// • Kein Polling im Leerlauf: die rAF-Schleife läuft nur, wenn ein Pad verbunden ist,
//   die Steuerung eingeschaltet ist UND der Lernmodus offen ist. Ein 1-Sekunden-Wächter
//   (existiert nur bei verbundenem Pad) startet sie wieder — sonst nichts.
// • EINE Quelle der Wahrheit: ACTIONS (Label + Standardtaste + Ausführung) speist
//   Belegung, Einstellungen, HUD und Anlern-Modus.
// • Fremde Pads (Stadia im Bluetooth-Modus, 8BitDo, generisches HID — alles, was
//   mapping ≠ "standard" meldet): Tasten UND Achsen werden generisch gelesen,
//   abweichende Indizes lernt man je Aktion einmal an.

const LS = {
	on: "impala67Controller",
	map: "impala67ControllerMap",
	hud: "impala67ControllerHud",
	vib: "impala67ControllerVib",
	dead: "impala67ControllerDead",
};
const get = (k, fb) => U.storage.get(k, fb);
const put = (k, v) => U.storage.set(k, v);

const enabled = () => get(LS.on, "off") === "on"; // Standard: aus
const hudOn = () => get(LS.hud, "on") === "on";
const vibOn = () => get(LS.vib, "on") === "on";
const deadzone = () => Math.min(0.9, Math.max(0.2, Number(get(LS.dead, "0.5")) || 0.5));

const pads = () => (navigator.getGamepads ? Array.from(navigator.getGamepads()) : []).filter(Boolean);
const inStudy = () => S.view === "anki" && S.ankiTab === "study";
const click = (sel) => { const el = document.querySelector(sel); if (el) el.click(); return !!el; };
const reopen = () => { if (window.SETTINGS && S.settingsSection === "app" && S.settingsSubsection === "controller") window.SETTINGS.openSettings("controller"); };

// ---------- Aktionen: Label · Standardtaste (Standard-Mapping) · Ausführung ----------
// grade-Aktionen brauchen keine eigene run(): sie klicken den passenden
// Bewertungsknopf — und decken bei verdeckter Rückseite erst auf (Sicherheitsnetz).
const ACTIONS = [
	{ id: "show", label: "Antwort zeigen", def: "5", run: () => click("[data-ankishowback]") },
	{ id: "g3", label: "Gut (3)", def: "0", grade: 3 },
	{ id: "g1", label: "Nochmal (1)", def: "1", grade: 1 },
	{ id: "g2", label: "Schwer (2)", def: "2", grade: 2 },
	{ id: "g4", label: "Einfach (4)", def: "3", grade: 4 },
	{ id: "edit", label: "Karte bearbeiten", def: "12", run: () => click("[data-ankiedit]") },
	{ id: "susp", label: "Karte aussetzen", def: "13", run: () => suspendCurrent() },
	{ id: "prev", label: "Vorheriger Stapel", def: "14", run: () => hopDeck(-1) },
	{ id: "next", label: "Nächster Stapel", def: "15", run: () => hopDeck(1) },
	{ id: "exit", label: "Lernmodus verlassen", def: "9", run: () => click('[data-ankitab="decks"]') },
	{ id: "hud", label: "Tastenhinweise ein-/ausblenden", def: "8", run: () => toggleHints() },
];
const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

// Tastennamen des Standard-Mappings (w3c.github.io/gamepad). Unbekannte Indizes und
// Achsen bekommen einen generischen Namen — dann hilft der Anlern-Modus.
const NAMES = { 0: "A / ✕", 1: "B / ○", 2: "X / □", 3: "Y / △", 4: "L1", 5: "R1", 6: "L2", 7: "R2", 8: "Select", 9: "Start", 10: "L3", 11: "R3", 12: "D-Pad ↑", 13: "D-Pad ↓", 14: "D-Pad ←", 15: "D-Pad →", 16: "Home" };
const labelOf = (id) => (id == null ? "—" : (id[0] === "a" ? "Achse " + id.slice(1, -1) + " " + id.slice(-1) : (NAMES[id] || "Taste " + id)));

// Belegung = Standard + gespeicherte Abweichungen (null = bewusst frei gelassen).
function map() {
	const saved = U.storage.getJson(LS.map, {});
	const out = {};
	for (const a of ACTIONS) out[a.id] = saved[a.id] !== undefined ? saved[a.id] : a.def;
	return out;
}

// Gedrückte Eingaben als IDs: "3" = Taste 3, "a1-" = Achse 1 negativ. Deadzone gilt
// für Sticks UND analoge Trigger, damit ein schlaff sitzender Stick nichts auslöst.
function activeIds(p) {
	const d = deadzone();
	const out = [];
	p.buttons.forEach((b, i) => { if (b.pressed || (b.value || 0) > d) out.push(String(i)); });
	p.axes.forEach((v, i) => { if (v > d) out.push("a" + i + "+"); else if (v < -d) out.push("a" + i + "-"); });
	return out;
}

// ---------- Aktionen, die keine fertige Schaltfläche haben ----------
async function suspendCurrent() {
	const c = S.cards[S.reviewCardId] || STATE.studySnapshot(S.ankiDeck).dueNow[0];
	if (!c) return;
	S.reviewShowBack = false;
	await STATE.dispatch("cardUpdate", { id: c.id, patch: { suspended: true } }); // rendert selbst
	U.toast("Karte ausgesetzt.", "success");
}

// Stapel wechseln — nur Stapel, in denen heute noch etwas offen ist.
function hopDeck(dir) {
	const decks = RENDER_ANKI.ankiDecks().filter((d) => RENDER_ANKI.ankiStudyOpen(d));
	if (!decks.length) return;
	const i = decks.indexOf(S.ankiDeck);
	S.ankiDeck = decks[i === -1 ? (dir > 0 ? 0 : decks.length - 1) : (i + dir + decks.length) % decks.length];
	S.reviewShowBack = false;
	RENDER.renderMain();
	U.toast("Stapel: " + S.ankiDeck, "success");
}

function vibrate(ms) {
	const p = pads()[0];
	if (!vibOn() || !p || !p.vibrationActuator) return;
	try { p.vibrationActuator.playEffect("dual-rumble", { duration: ms, strongMagnitude: 0.5, weakMagnitude: 0.3 }); } catch { /* Pad kann nicht rumpeln */ }
}

// Kantenerkennung ruft genau EIN mal pro Tastendruck hier hinein.
function fire(inputId) {
	const m = map();
	const act = ACTIONS.find((a) => m[a.id] === inputId);
	if (!act) return null;
	if (act.grade) {
		// Sicherheitsnetz: bei verdeckter Rückseite wird nie bewertet, sondern aufgedeckt.
		if (!S.reviewShowBack) { click("[data-ankishowback]"); return "show"; }
		click('[data-ankigrade="' + act.grade + '"]');
		vibrate(act.grade === 1 ? 180 : 60);
		return act.id;
	}
	act.run();
	return act.id;
}

// ---------- „Was muss ich drücken?“ — Hinweise direkt in den Schaltflächen ----------
// KEIN schwebendes Overlay mehr (das überdeckte den KI-Kreis und die Fußleiste):
// render-anki.js fragt beim Bauen der Lern-Ansicht badge(id) ab und setzt den
// Tastennamen in genau die Schaltfläche, die diese Taste auslöst. Leerer String,
// solange kein Pad verbunden ist oder die Hinweise aus sind — dann ist die
// Oberfläche exakt wie vorher.
const hintsOn = () => enabled() && hudOn() && !!pads().length;
function badge(id) {
	if (!hintsOn()) return "";
	const key = map()[id];
	return key == null ? "" : '<span class="pad-key" title="Controller">' + U.esc(labelOf(key)) + "</span>";
}
const PAD_CSS = ".pad-key{display:inline-flex;margin-left:6px;padding:0 5px;border:1px solid var(--edge);border-radius:var(--radius-xs);" +
	"font-size:var(--text-3xs);font-weight:650;line-height:1.6;color:var(--text2);white-space:nowrap}" +
	".grades .pad-key,.grade-key .pad-key{margin-left:4px}";
// Die Hinweise stecken im gerenderten HTML: beim An-/Abstecken des Pads (oder beim
// Umschalten) wird die Lern-Ansicht EINMAL neu gezeichnet — nicht pro Frame.
let hadPad = null;
function syncBadges() {
	const now = hintsOn();
	if (now === hadPad) return;
	hadPad = now;
	if (inStudy()) RENDER.renderMain();
}
function toggleHints() {
	put(LS.hud, hudOn() ? "off" : "on");
	hadPad = null;
	syncBadges();
}

// ---------- Schleife: rAF nur im Lernmodus bzw. beim Anlernen ----------
let raf = 0, watch = 0, learn = null, prev = new Set(), lock = 0;

// Abgefragt wird in genau zwei Fällen: Lernmodus mit eingeschalteter Steuerung ODER
// Anlern-Modus. 🐛 Fix (27. Juli): Der Anlern-Modus muss auch bei AUSGESCHALTETER
// Steuerung abfragen — Standard ist „aus“, dadurch sah das „Drücke jetzt die Taste“-
// Fenster gar keine Eingaben und man konnte seine Tasten nie belegen.
const running = () => !!learn || (enabled() && inStudy());

// Alle verbundenen Pads zusammen lesen: fremde Pads (Stadia im Bluetooth-Modus,
// generische HID-Pads) landen nicht zwingend in Steckplatz 0.
function activeAll() {
	const out = [];
	for (const p of pads()) out.push(...activeIds(p));
	return out;
}

function poll() {
	raf = 0;
	if (!pads().length || !running()) { stop(); return; }
	const now = performance.now();
	const cur = new Set(activeAll());
	for (const id of cur) {
		if (prev.has(id)) continue; // Kantenerkennung: nur false → true zählt
		// Lernzeit-Erfassung über jeden Tastendruck informieren: ein Gamepad löst keine
		// Maus-/Tastatur-Ereignisse aus, sonst erscheint mitten im Abfragen „Lernst du noch?“.
		const woke = window.LERNZEIT && window.LERNZEIT.poke ? window.LERNZEIT.poke() : false;
		if (learn) { learnBind(id); break; }
		if (woke) break; // dieser Druck hat nur das „Lernst du noch?“-Tierchen weggeklickt
		if (now < lock) break; // 250-ms-Sperre nach einer Bewertung (Prellen)
		const done = fire(id);
		if (done) { if (done !== "hud") lock = now + 250; break; }
	}
	prev = cur;
	syncBadges();
	raf = requestAnimationFrame(poll);
}
// Start mit dem Ruhezustand als Basis: Trigger und Sticks, die schon beim Start
// ausschlagen (bei fremden Pads normal), gelten so nicht als Tastendruck — sonst hätte
// der Anlern-Modus sofort eine Achse belegt.
function start() {
	if (raf) return;
	prev = new Set(activeAll());
	raf = requestAnimationFrame(poll);
}
function stop() {
	if (raf) cancelAnimationFrame(raf);
	raf = 0;
	prev = new Set();
	syncBadges();
}
// Wächter: prüft einmal pro Sekunde, ob die Schleife laufen soll — und beendet sich
// selbst, sobald kein Pad mehr verbunden ist und nichts mehr zu tun ist.
function tick() {
	if (!pads().length || (!enabled() && !learn)) {
		if (watch) { clearInterval(watch); watch = 0; }
		stop();
		return;
	}
	if (running()) start(); else stop();
	syncBadges();
}
function ensureWatch() {
	if (!watch) watch = setInterval(tick, 1000);
	tick();
}

function learnBind(inputId) {
	const m = map();
	for (const k of Object.keys(m)) if (m[k] === inputId) m[k] = null; // Taste war woanders belegt
	m[learn] = inputId;
	const label = (BY_ID.get(learn) || {}).label || learn;
	learn = null;
	U.storage.setJson(LS.map, m);
	hadPad = null;
	U.toast(label + " → " + labelOf(inputId), "success");
	reopen();
}

// ---------- Einstellungen → 🎮 Controller (verdrahtet sich selbst, s. unten) ----------
function settingsHtml() {
	const p = pads()[0];
	const m = map();
	const status = p
		? "✅ " + U.esc(String(p.id).slice(0, 60)) + " · Belegung: " + (p.mapping === "standard" ? "standard" : "<b>unbekannt</b> — Tasten unten anlernen")
		: "Kein Pad gemeldet — einmal eine Taste am Controller drücken (Browser meldet Pads erst nach einem Tastendruck).";
	const rows = ACTIONS.map((a) =>
		"<tr><td>" + U.esc(a.label) + "</td><td><code>" + U.esc(labelOf(m[a.id])) + "</code></td>" +
		'<td class="anki-rowbtns"><button data-padlearn="' + a.id + '" title="Taste am Controller drücken">🎮 Lernen</button>' +
		'<button data-padclear="' + a.id + '" title="Belegung entfernen">✕</button></td></tr>').join("");
	const toggle = (id, label, on) => '<div class="ai-toggle-card"><span class="ai-toggle-copy"><b>' + label + '</b></span>' +
		'<label class="theme-switch"><input id="' + id + '" type="checkbox"' + (on ? " checked" : "") + '><span aria-hidden="true"></span></label></div>';
	return '<p class="hint">Karteikarten vom Sofa aus: der Lernmodus lässt sich komplett mit einem Gamepad bedienen. Der Controller löst dieselben Schaltflächen aus wie Maus und Tastatur — es gibt keine zweite Lernlogik. Abgefragt wird nur bei verbundenem Pad im Lernmodus.</p>' +
		toggle("inpController", "Controller-Steuerung", enabled()) +
		toggle("inpPadHud", "Tastenhinweise in den Schaltflächen", hudOn()) +
		toggle("inpPadVib", "Vibration als Rückmeldung", vibOn()) +
		'<p class="hint">Status: ' + status + "</p>" +
		(learn ? '<p class="hint">⏺ <b>Drücke jetzt die Taste für „' + U.esc((BY_ID.get(learn) || {}).label || "") + '“…</b> <button data-padlearncancel="1" class="mini">Abbrechen</button>' +
			(p ? " Anlernen funktioniert auch, solange die Steuerung noch aus ist." : " — der Browser meldet noch kein Pad: drücke bitte zuerst eine beliebige Taste am Controller.") + "</p>" : "") +
		"<h4>Belegung</h4>" +
		'<table class="lib-table"><thead><tr><th>Aktion</th><th>Taste</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>" +
		'<p class="hint">Bei verdeckter Rückseite decken die Bewertungstasten nur auf — blind bewerten ist nicht möglich.</p>' +
		"<h4>Deadzone</h4>" +
		'<p class="hint">Ab welchem Ausschlag Sticks und analoge Trigger als gedrückt gelten (aktuell ' + deadzone().toFixed(2) + ").</p>" +
		'<input id="padDead" type="range" min="0.2" max="0.9" step="0.05" value="' + deadzone() + '">' +
		'<div class="row-btns"><button data-padreset="1">↺ Standard-Belegung</button></div>' +
		'<p class="hint">Pads ohne Standard-Belegung (z. B. Stadia-Controller im Bluetooth-Modus, generische HID-Pads ohne Windows-Treiber) funktionieren trotzdem: Tasten und Achsen werden roh gelesen, die Indizes lernst du oben einmal an.</p>';
}

// Verdrahtung per Capture-Listener — genau wie experimente.js/telemetrie.js. settings.js
// ruft nur settingsHtml() auf und weiß sonst nichts über dieses Modul.
document.addEventListener("click", (e) => {
	const t = e.target instanceof Element ? e.target.closest("[data-padlearn],[data-padclear],[data-padreset],[data-padlearncancel]") : null;
	if (!t) return;
	if (t.dataset.padlearn) { learn = t.dataset.padlearn; ensureWatch(); }
	else if (t.dataset.padclear) {
		const m = map();
		m[t.dataset.padclear] = null;
		U.storage.setJson(LS.map, m);
		hadPad = null;
	} else if (t.dataset.padlearncancel) learn = null;
	else { U.storage.remove(LS.map); hadPad = null; U.toast("Standard-Belegung wiederhergestellt.", "success"); }
	reopen();
}, true);

document.addEventListener("change", (e) => {
	const id = e.target && e.target.id;
	if (id === "inpController") { put(LS.on, e.target.checked ? "on" : "off"); hadPad = null; ensureWatch(); reopen(); }
	else if (id === "inpPadHud") { put(LS.hud, e.target.checked ? "on" : "off"); hadPad = null; syncBadges(); }
	else if (id === "inpPadVib") put(LS.vib, e.target.checked ? "on" : "off");
	else if (id === "padDead") { put(LS.dead, String(e.target.value)); reopen(); }
}, true);

window.addEventListener("gamepadconnected", (e) => {
	hadPad = null;
	ensureWatch(); // auch bei ausgeschalteter Steuerung — sonst sieht der Anlern-Modus nichts
	U.toast(!enabled()
		? "🎮 Controller erkannt — unter Einstellungen → Controller einschalten."
		: (e.gamepad.mapping === "standard"
			? "🎮 Controller verbunden — " + labelOf(map().g3) + " zeigt die Antwort."
			: "🎮 Controller verbunden, Belegung unbekannt — bitte in den Einstellungen anlernen."), "success");
	reopen();
});
window.addEventListener("gamepaddisconnected", () => { hadPad = null; tick(); reopen(); });

// Badge-Styles einmalig (das Modul bringt seine paar Zeilen CSS selbst mit — so bleibt
// das Feature in EINER Datei und styles.css frei von Sonderfällen).
const style = document.createElement("style");
style.textContent = PAD_CSS;
document.head.appendChild(style);
if (enabled() && pads().length) ensureWatch();

export const CONTROLLER = {
	settingsHtml,
	badge, // render-anki.js: Tastenhinweis für eine Aktion (leer, wenn kein Pad)
	ACTIONS,
	map,
	labelOf,
	enabled,
};
