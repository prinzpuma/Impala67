"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { DB } from "./db.js";
import { AI } from "./ai.js";
import { RAG } from "./rag.js";
import { RENDER } from "./render.js";
import { DRIVE } from "./drive.js";
import { NOTION_MIGRATOR } from "./import-notion.js";
import { APP } from "./app.js";

const renderStatusDot = (...args) => RENDER.renderStatusDot(...args);
const render = (...args) => RENDER.render(...args);
const closeOverlay = (...args) => APP.closeOverlay(...args);
const openPage = (...args) => APP.openPage(...args);

// Verbindungsstatus automatisch prüfen (beim Start, nach Einstellungen, alle 60s)
export async function checkAI() {
	S.aiOnline = null;
	renderStatusDot();
	S.aiOnline = await AI.ping();
	renderStatusDot();
}

// Theme (dunkel/hell) — Gerätewahl in localStorage, Standard: dunkel.
export function applyTheme() {
	document.body.classList.toggle("light", (localStorage.getItem("impala67Theme") || localStorage.getItem("notionTheme")) === "light");
}

// Eigenes Hintergrundbild anwenden (Blob aus IndexedDB, dunkel überblendet)
export async function applyBg() {
	const bg = U.el("bg");
	if (!bg) return;
	try {
		const rec = await DB.getBlob("bgImage");
		if (rec && rec.buf && rec.buf.byteLength) {
			const url = URL.createObjectURL(new Blob([rec.buf], { type: (rec.meta && rec.meta.type) || "image/jpeg" }));
			bg.style.backgroundImage = "linear-gradient(rgba(6,8,12,0.84), rgba(6,8,12,0.93)), url('" + url + "')";
			bg.style.backgroundSize = "cover";
			bg.style.backgroundPosition = "center";
		} else {
			bg.style.backgroundImage = "";
			bg.style.backgroundSize = "";
			bg.style.backgroundPosition = "";
		}
	} catch (e) {
		console.warn("Hintergrund konnte nicht geladen werden:", e);
	}
}

// Zeichnet den Notion-Fortschritt in die Einstellungen — falls sie offen sind.
// Der Zustand lebt in S.notionJob und überlebt so das Schließen des Dialogs:
// beim Wiederöffnen (render.js → openSettings) wird er einfach neu gezeichnet.
export function renderNotionJob() {
	const bar = U.el("notionProgress");
	if (!bar) return; // Einstellungen (Notion-Tab) sind gerade nicht offen
	const job = S.notionJob;
	const fill = bar.querySelector(".progress-fill");
	const status = U.el("notionStatus");
	const cancelBtn = U.el("btnNotionCancel");
	const btnImp = U.el("btnMigrateNotion");
	const btnSync = U.el("btnNotionSync");
	const running = !!(job && job.running);
	bar.hidden = !job || (!running && job.fraction == null);
	if (fill) {
		if (job && job.fraction != null) { bar.classList.remove("indeterminate"); fill.style.width = Math.round(job.fraction * 100) + "%"; }
		else { bar.classList.toggle("indeterminate", running); fill.style.width = ""; }
	}
	if (status) status.textContent = job ? job.status || "" : "";
	if (cancelBtn) {
		cancelBtn.hidden = !running;
		cancelBtn.disabled = !!(job && job.cancelling);
		cancelBtn.textContent = job && job.cancelling ? "Wird abgebrochen…" : "⏹ Abbrechen";
	}
	if (btnImp) { btnImp.disabled = running; btnImp.textContent = running && job.kind === "import" ? "Importiere…" : "⬇ Import"; }
	if (btnSync) { btnSync.disabled = running; btnSync.textContent = running && job.kind === "sync" ? "Synchronisiere…" : "⇅ Zwei-Wege-Sync"; }
}

// Formularfeld-Helper für Einstellungen.
export function field(label, id, value, type) {
	return "<div><label for=\"" + id + "\">" + U.esc(label) + "</label>" +
		'<input id="' + id + '" type="' + (type || "text") + '" value="' + U.esc(value || "") + '"></div>';
}

// Einstellungen mit Unterpunkten (wie in Notion), feste Größe, Inhalt scrollt
export const SETTINGS_SECTIONS = [
	{ id: "ki", label: "KI" },
	{ id: "look", label: "Darstellung" },
	{ id: "notion", label: "Notion Sync" },
	{ id: "backup", label: "Backup" },
	{ id: "sync", label: "Sync" },
];

export function openSettings(section) {
	S.settingsSection = section || S.settingsSection || "ki";
	const sec = S.settingsSection;
	const o = U.el("overlay");
	if (!o) return;
	o.hidden = false;
	const nav = SETTINGS_SECTIONS.map((s) =>
		'<div class="set-item' + (s.id === sec ? " active" : "") + '" data-set="' + s.id + '">' + s.label + "</div>"
	).join("");
	let body = "";
	if (sec === "ki") {
		const providers = S.settings.aiProviders || [];
		body = "<h4>Quellen (mehrere KI-Server/API-Keys gleichzeitig möglich)</h4>" +
			'<div class="provider-list">' + providers.map((pr) =>
				'<div class="provider-card" data-provrow="' + pr.id + '">' +
					'<div class="provider-card-head">' +
						'<input data-provname="' + pr.id + '" placeholder="Name der Quelle" value="' + U.esc(pr.name) + '">' +
						'<button data-provdel="' + pr.id + '" class="icon-danger" title="Quelle entfernen">🗑</button>' +
					"</div>" +
					'<input data-provbase="' + pr.id + '" placeholder="Server-URL (OpenAI-kompatibel)" value="' + U.esc(pr.base) + '">' +
					'<input data-provkey="' + pr.id + '" type="password" placeholder="API-Key (optional)" value="' + U.esc(pr.key) + '">' +
				"</div>"
			).join("") + "</div>" +
			'<button id="btnAddProvider">＋ Quelle hinzufügen</button>' +
			// Schnell-Buttons für die drei Standard-Quellen — falls sie in älteren gespeicherten
			// Einstellungen fehlen (settingsSet überschreibt die Default-Liste aus state.js).
			'<div class="row-btns" style="margin-top:6px"><span class="hint">Schnell hinzufügen:</span>' +
			'<button data-provpreset="local">🖥 LM Studio (lokal)</button>' +
			'<button data-provpreset="google">✨ Google Gemini</button>' +
			'<button data-provpreset="openai">🤖 OpenAI</button></div>' +
			field("Embedding-Modell (optional, semantische Suche — nutzt die im Modell-Dropdown aktive Quelle)", "inpEmbed", S.settings.embedModel) +
			"<div><label for=\"inpCustomInstructions\">Eigene Anweisungen an die KI (optional)</label>" +
			'<textarea id="inpCustomInstructions" rows="3" placeholder="z.B. Studienfach, bevorzugte Sprache, Tonfall…">' + U.esc(S.settings.customInstructions) + "</textarea></div>" +
			'<p class="hint">Lege für jede Quelle Server-URL + optionalen API-Key an, z.B.:<br>' +
			"Google Gemini: https://generativelanguage.googleapis.com/v1beta/openai · Modelle z.B. gemma-4-31b-it, gemini-2.5-flash · Embeddings gemini-embedding-001.<br>" +
			"OpenAI: https://api.openai.com/v1 · Embeddings text-embedding-3-small.<br>" +
			"Lokal: z.B. http://localhost:1234/v1 (LM Studio, Port 1234, CORS aktivieren, kein Key nötig).<br>" +
			"Welches Modell aktiv ist, wählst du oben im Modell-Dropdown — dort erscheinen alle Quellen gruppiert mit ihren live abgefragten Modellen. Die KI kennt nur, was du hier selbst einträgst.</p>" +
			'<div class="modal-actions"><button id="btnSaveSettings">Speichern</button></div>';
	} else if (sec === "notion") {
		const last = S.settings.notionLastSync;
		body = field("Notion Integration Token (secret_…)", "inpNotionToken", S.settings.notionToken || S.notionToken, "password") +
			field("Notion Seiten-ID (Wurzelseite für den Sync; leer = alle freigegebenen Seiten)", "inpNotionPage", S.settings.notionPageId || S.notionPageId) +
			field("Eigener CORS-Proxy (optional, z.B. https://dein-worker.workers.dev/?; leer = corsproxy.io)", "inpCorsProxy", S.settings.corsProxy || "") +
			'<p class="hint">1) Auf notion.so/my-integrations eine interne Integration erstellen, Token kopieren.<br>' +
			'2) In Notion die gewünschten Seiten über „Teilen“ mit der Integration freigeben.<br>' +
			"3) <b>⬇ Import</b> holt alles einmalig. <b>⇅ Zwei-Wege-Sync</b> gleicht danach in beide Richtungen ab: die jeweils neuere Version gewinnt, lokal neue Seiten werden in deinem Notion unter der Wurzelseite angelegt.<br>" +
			"Hinweis: Notions API erlaubt keine direkten Browseranfragen (CORS). Ohne eigenen Proxy laufen die Anfragen über den öffentlichen corsproxy.io — sicherer ist ein eigener Mini-Proxy (Cloudflare Worker), dessen URL du oben einträgst.</p>" +
			(last ? '<p class="hint">Letzter Sync: ' + U.fmtDate(last) + "</p>" : "") +
			'<div class="modal-actions"><button id="btnMigrateNotion">⬇ Import</button><button id="btnNotionSync">⇅ Zwei-Wege-Sync</button><button id="btnNotionCancel" class="danger" hidden>⏹ Abbrechen</button></div>' +
			'<div class="progress-bar" id="notionProgress" hidden><div class="progress-fill"></div></div>' +
			'<p class="hint" id="notionStatus"></p>';
	} else if (sec === "look") {
		const theme = (localStorage.getItem("impala67Theme") || localStorage.getItem("notionTheme")) === "light" ? "light" : "dark"; // alter Schlüssel als Fallback
		body = '<h4>Design</h4><div class="row-btns">' +
			'<button id="btnThemeDark" class="' + (theme === "dark" ? "active" : "") + '">🌙 Dunkel</button>' +
			'<button id="btnThemeLight" class="' + (theme === "light" ? "active" : "") + '">☀️ Hell</button></div>' +
			'<h4 style="margin-top:14px">Hintergrund</h4>' +
			'<p class="hint">Eigenes Hintergrundbild für die App. Es wird lokal gespeichert und dunkel überblendet, damit Text lesbar bleibt.</p>' +
			'<div class="row-btns"><button id="btnPickBg">Bild wählen</button><button id="btnClearBg">Entfernen</button></div>';
	} else if (sec === "backup") {
		body = '<p class="hint">Manuelles Backup als JSON-Datei (Event-Log + PDFs). Ein Import wird konfliktfrei zusammengeführt (Log-Merge) — ideal auch über einen Google-Drive-Ordner.</p>' +
			'<div class="row-btns"><button id="btnExport">Export</button><button id="btnImport">Import</button></div>' +
			'<h4 style="margin-top:14px">Workspace als Markdown-ZIP</h4>' +
			'<p class="hint">Alle Seiten eines Workspace als .md-Dateien (Ordnerstruktur = Seitenbaum) — in jedem Editor nutzbar.</p>' +
			'<div class="row-btns">' + Object.values(S.workspaces).map((ws) =>
				'<button data-zipws="' + U.esc(ws.id) + '">🗜 ' + U.esc(ws.name) + "</button>").join("") + "</div>" +
			'<h4 style="margin-top:20px; color:var(--danger)">⚠️ Gefahrenzone</h4>' +
			'<p class="hint">Löscht alle lokalen Seiten und deren Versionsverlauf unwiderruflich von diesem Gerät. Deine Einstellungen, API-Keys und Karteikarten bleiben erhalten.</p>' +
			'<div class="row-btns"><button id="btnResetAll" class="danger">Alle Seiten löschen</button></div>';
	} else if (sec === "sync") {
		if (!S.settings.driveClientId) {
			body = field("Google Client-ID (einmalig einrichten)", "inpDrive", S.settings.driveClientId) +
				'<p class="hint">Google verlangt für jede App eine registrierte Client-ID — das ist einmalig nötig, keine Notion-Eigenheit:<br>' +
				"1) Google Cloud Console → Drive-API aktivieren.<br>" +
				'2) OAuth-Client vom Typ „Webanwendung“ anlegen, <code>' + location.origin + '</code> als autorisierten Ursprung eintragen.<br>' +
				"3) Client-ID hier einfügen und speichern.<br>" +
				"Danach reicht wirklich nur noch ein Klick auf „Mit Google anmelden“.</p>" +
				'<div class="modal-actions"><button id="btnSaveSettings">Speichern</button></div>';
		} else if (S.driveUserEmail) {
			body = '<div class="drive-connected">✅ Verbunden als <b>' + U.esc(S.driveUserEmail) + "</b></div>" +
				'<p class="hint">Deine Notizen synchronisieren sich mit deinem privaten Google-Drive-App-Speicher (für andere Apps unsichtbar).</p>' +
				'<div class="row-btns"><button id="btnDriveSyncSettings">☁️ Jetzt synchronisieren</button><button id="btnDriveLogout">Abmelden</button></div>';
		} else {
			body = '<p class="hint">Client-ID ist hinterlegt — ein Klick genügt.</p>' +
				'<div class="modal-actions"><button id="btnDriveLogin">Mit Google anmelden</button></div>';
		}
	}
	// Wie in Notion: kein "Schließen"-Button unten, sondern ein ✕ oben rechts.
	o.innerHTML = '<div class="modal settings-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<div class="settings-nav">' + nav + "</div>" +
		'<div class="settings-body"><h3>Einstellungen</h3>' + body + "</div></div>";
	// Läuft gerade ein Notion-Import/-Sync (oder ist einer fertig), den Fortschritt
	if (sec === "notion" && typeof renderNotionJob === "function") renderNotionJob();
}

// Einstellungen-Aktionen aus wireEvents:

export async function handleNotionSync(t) {
	if (S.notionJob && S.notionJob.running) return;
	const isSync = t.id === "btnNotionSync";
	const tok = U.el("inpNotionToken").value.trim();
	const pid = U.el("inpNotionPage").value.trim();
	const prox = U.el("inpCorsProxy") ? U.el("inpCorsProxy").value.trim() : (S.settings.corsProxy || "");
	S.notionToken = tok;
	S.notionPageId = pid;
	await STATE.dispatch("settingsSet", { notionToken: tok, notionPageId: pid, corsProxy: prox });
	if (!tok) { alert("Token ist erforderlich."); return; }
	S.notionJob = { running: true, cancelling: false, kind: isSync ? "sync" : "import", status: isSync ? "Starte Sync…" : "Starte Import…", fraction: null };
	renderNotionJob();
	const onStatus = (st, fraction) => {
		S.notionJob.status = st;
		S.notionJob.fraction = fraction == null ? null : fraction;
		renderNotionJob();
	};
	try {
		if (isSync) {
			const r = await NOTION_MIGRATOR.sync(tok, pid || null, onStatus);
			S.notionJob.status = "✅ Sync fertig — " + r.pulled + " übernommen, " + r.pushed + " nach Notion übertragen, " + r.created + " in Notion angelegt" + (r.merged ? ", " + r.merged + " Duplikat(e) zusammengeführt" : "") + ".";
		} else {
			const newId = await NOTION_MIGRATOR.migrate(tok, pid || null, onStatus);
			S.notionJob.status = "✅ Import fertig!";
			if (newId) setTimeout(() => { closeOverlay(); openPage(newId); }, 600);
		}
		S.notionJob.fraction = 1;
	} catch (err) {
		S.notionJob.status = err.cancelled ? "⏹ Abgebrochen." : "⚠️ " + err.message;
		S.notionJob.fraction = null;
	}
	S.notionJob.running = false;
	S.notionJob.cancelling = false;
	renderNotionJob();
	render();
}

export function handleNotionCancel() {
	NOTION_MIGRATOR.cancel();
	if (S.notionJob) { S.notionJob.cancelling = true; S.notionJob.status = "Wird abgebrochen…"; }
	renderNotionJob();
}

export async function handleDriveLogin(t) {
	t.disabled = true;
	const old = t.textContent;
	t.textContent = "Verbinde…";
	try {
		const info = await DRIVE.login();
		S.driveUserEmail = (info && info.email) ? info.email : "Google-Konto";
		openSettings("sync");
	} catch (err) {
		alert("Anmeldung fehlgeschlagen: " + err.message);
		t.disabled = false;
		t.textContent = old;
	}
}

export function handleDriveLogout() {
	DRIVE.logout();
	S.driveUserEmail = null;
	openSettings("sync");
}

export async function handleDriveSyncSettings(t) {
	t.disabled = true;
	const old = t.textContent;
	try {
		const imported = await DRIVE.sync((st) => { t.textContent = st; });
		if (imported > 0) { alert("Sync fertig — " + imported + " Änderungen übernommen. Die App lädt neu."); location.reload(); }
		else alert("Sync abgeschlossen — keine neuen Änderungen.");
	} catch (err) {
		alert("Sync fehlgeschlagen: " + err.message);
	}
	t.disabled = false;
	t.textContent = old;
}

export async function handleAddProvider() {
	const providers = (S.settings.aiProviders || []).slice();
	providers.push({ id: U.uid(), name: "Neue Quelle", base: "", key: "" });
	await STATE.dispatch("settingsSet", { aiProviders: providers });
	openSettings("ki");
}

export async function handleSaveSettings() {
	const patch = {};
	const g = (id) => document.getElementById(id);
	const provRows = document.querySelectorAll("[data-provrow]");
	if (provRows.length) {
		patch.aiProviders = Array.from(provRows).map((row) => {
			const id = row.dataset.provrow;
			const nameEl = row.querySelector("[data-provname]");
			const baseEl = row.querySelector("[data-provbase]");
			const keyEl = row.querySelector("[data-provkey]");
			return {
				id,
				name: nameEl && nameEl.value.trim() ? nameEl.value.trim() : id,
				base: baseEl ? baseEl.value.trim() : "",
				key: keyEl ? keyEl.value.trim() : "",
			};
		});
	}
	if (g("inpEmbed")) patch.embedModel = g("inpEmbed").value.trim();
	if (g("inpDrive")) patch.driveClientId = g("inpDrive").value.trim();
	if (g("inpCustomInstructions")) patch.customInstructions = g("inpCustomInstructions").value;
	await STATE.dispatch("settingsSet", patch);
	closeOverlay();
	checkAI();
	RAG.reindexStale();
	S.availableModels = [];
}

export async function handleClearBg() {
	await DB.putBlob("bgImage", new ArrayBuffer(0), {});
	applyBg();
}

export async function handleResetAll(t) {
	if (confirm("⚠️ ACHTUNG: Möchtest du wirklich alle lokalen Seiten unwiderruflich löschen?\n\nDeine Einstellungen, API-Keys, Karteikarten und Stapel bleiben erhalten!")) {
		t.disabled = true;
		t.textContent = "Lösche Seiten...";
		try {
			await DB.clearPages();
			alert("Alle Seiten wurden erfolgreich gelöscht. Aura lädt sich nun neu.");
			location.reload();
		} catch (err) {
			alert("Fehler beim Löschen der Seiten: " + err.message);
			t.disabled = false;
			t.textContent = "Alle Seiten löschen";
		}
	}
}

export async function handleDriveSync(t) {
	if (!S.settings.driveClientId) {
		alert("Für den Drive-Sync brauchst du einmalig eine Google OAuth Client-ID:\n" +
			"Google Cloud Console → Drive-API aktivieren → OAuth-Client (Webanwendung) → " +
			"Client-ID in Einstellungen → Sync eintragen. Danach reicht ein Klick.");
		return;
	}
	t.disabled = true;
	try {
		const imported = await DRIVE.sync((st) => { t.textContent = "☁️ " + st; });
		if (imported > 0) {
			alert("Sync fertig — " + imported + " Änderungen übernommen. Die App lädt neu.");
			location.reload();
		}
	} catch (err) {
		alert("Sync fehlgeschlagen: " + err.message);
	}
	t.disabled = false;
	t.textContent = "☁️ Sync";
}

export async function handleBackupNow() {
	U.download("notion-export-" + new Date().toISOString().slice(0, 10) + ".json", await DB.exportAll());
	localStorage.setItem("notionLastBackup", new Date().toISOString());
	if (S.view === "home") render();
}

export function handleThemeSelect(theme) {
	localStorage.setItem("notionTheme", theme);
	applyTheme();
}

export async function handleFileBgChange(e) {
	if (e.target.files[0]) {
		const file = e.target.files[0];
		e.target.value = "";
		const buf = await U.readAsBuffer(file);
		await DB.putBlob("bgImage", buf, { name: file.name, type: file.type });
		applyBg();
	}
}

export async function handleImportChange(e) {
	if (e.target.files[0]) {
		const file = e.target.files[0];
		e.target.value = "";
		try {
			const added = await DB.importAll(await U.readAsText(file));
			alert(added + " Änderungen importiert. Die App lädt neu.");
			location.reload();
		} catch (err) {
			alert("Import fehlgeschlagen: " + err.message);
		}
	}
}

export const SETTINGS = {
	checkAI,
	applyTheme,
	applyBg,
	renderNotionJob,
	openSettings,
	SETTINGS_SECTIONS,
	field,
	handleNotionSync,
	handleNotionCancel,
	handleDriveLogin,
	handleDriveLogout,
	handleDriveSyncSettings,
	handleAddProvider,
	handleSaveSettings,
	handleClearBg,
	handleResetAll,
	handleDriveSync,
	handleBackupNow,
	handleThemeSelect,
	handleFileBgChange,
	handleImportChange
};
