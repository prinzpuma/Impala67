"use strict";
// Reine Kompaktierungs-Regeln des Event-Logs. Eigenes Modul, damit db.js (Sync-Upload)
// und compact-worker.js (lokale Kompaktierung abseits des UI-Threads) dieselbe Logik nutzen.
// ---- Log-Kompaktierung: verlustfrei & deterministisch (drop-only) → Log-Merge bleibt konsistent,
// auch wenn Geräte zu unterschiedlichen Zeitpunkten kompaktieren. Regeln:
// 1. Patch-Events (pageUpdate/cardUpdate/settingsSet) fliegen, wenn ALLE Felder von neueren Patches
//    desselben Ziels überschrieben sind (pageUpdate trägt vollen content = DER Speicherfresser).
// 2. Updates endgültig gelöschter Seiten/Karten fliegen. Rest bleibt (klein, teils reihenfolge-abhängig).
// 3. UI-Zustand: uiTabsSet ist ein Gesamtsnapshot (nur der jüngste zählt), uiTreeSet eine
//    Operation je key (jüngstes Event je key genügt) — beide fluteten das Log sonst dauerhaft.
// 4. teleEvent: Roh-Telemetrie verfällt nach TELE_KEEP_DAYS (drop-only, kein Merge-Konflikt —
//    ältere Auswertungen verlieren nur Alt-Daten, nie aktuelle).
// Verlaufs-Schutz: N jüngste Inhalts-Stände je Seite überleben — pageHistory liest das Event-Log.
const KEEP_CONTENT_VERSIONS = 10;
const TELE_KEEP_DAYS = 90;

export function compactEvents(events) {
	const sorted = [...events].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || (a.seq || 0) - (b.seq || 0));
	const deletedAt = { page: {}, card: {} };
	for (const ev of sorted) {
		if (!ev.payload) continue;
		if (ev.type === "pageDelete") deletedAt.page[ev.payload.id] = ev.t;
		if (ev.type === "cardDelete") deletedAt.card[ev.payload.id] = ev.t;
	}
	// Chats sind Last-write-wins nach `updated` (state.js „chatUpsert“): jedes Event ist ein
	// kompletter Schnappschuss. Behalten wird nur der Gewinner je Chat (bei Gleichstand das
	// spätere Event, wie beim Replay) — ältere Schnappschüsse blähten Log und Sync auf.
	const chatWinner = {};
	for (const ev of sorted) {
		if (ev.type !== "chatUpsert" || !ev.payload?.id) continue;
		const updated = String(ev.payload.updated || ev.t || ""), best = chatWinner[ev.payload.id];
		if (!best || updated >= best.updated) chatWinner[ev.payload.id] = { ev, updated };
	}
	const covered = {}, contentKept = {}, keep = [];
	let uiTabsKept = false;
	const uiTreeKeys = new Set();
	for (let i = sorted.length - 1; i >= 0; i--) { // rückwärts: neueste zuerst
		const ev = sorted[i], p = ev.payload || {};
		if (ev.type === "uiTabsSet") { if (uiTabsKept) continue; uiTabsKept = true; }
		else if (ev.type === "uiTreeSet") { if (p.key == null || uiTreeKeys.has(p.key)) continue; uiTreeKeys.add(p.key); }
		else if (ev.type === "chatUpsert" && p.id && chatWinner[p.id].ev !== ev) continue;
		if (ev.type === "pageUpdate" && deletedAt.page[p.id] && ev.t <= deletedAt.page[p.id]) continue;
		if (ev.type === "cardUpdate" && deletedAt.card[p.id] && ev.t <= deletedAt.card[p.id]) continue;
		const [bucket, patch] =
			ev.type === "pageUpdate" ? ["page:" + p.id, p.patch] :
			ev.type === "cardUpdate" ? ["card:" + p.id, p.patch] :
			ev.type === "settingsSet" ? ["settings", p] : [null, null];
		if (bucket && patch) {
			const seen = covered[bucket] ??= new Set();
			const keys = Object.keys(patch);
			if (ev.type === "pageUpdate" && typeof patch.content === "string" && (contentKept[p.id] || 0) < KEEP_CONTENT_VERSIONS) {
				contentKept[p.id] = (contentKept[p.id] || 0) + 1; // Verlaufs-Schutz: immer behalten
			} else if (keys.length && keys.every((k) => seen.has(k))) continue; // komplett überschrieben
			keys.forEach((k) => seen.add(k));
		}
		keep.push(ev);
	}
	keep.reverse();
	// Bilddaten (heftBlob) sind unveränderlich: sie können nie "überschrieben" werden und
	// fallen deshalb durch keine der Regeln oben. Weg dürfen sie trotzdem — aber nur, wenn
	// KEIN behaltenes Heft-Event sie noch referenziert (Bild gelöscht, Seite entfernt,
	// oder der neueste Snapshot enthält sie schlicht nicht mehr). Genau das ist der Grund,
	// warum die Bilder überhaupt aus dem Heft-Dokument ausgezogen sind: so lässt sich der
	// größte Speicherposten gezielt aufräumen, statt ihn in jedem Snapshot mitzuschleppen.
	const usedRefs = new Set();
	for (const ev of keep) {
		const p = ev.payload || {};
		if (ev.type === "heftOps") {
			for (const op of p.ops || []) if (op && op.o && op.o.ref) usedRefs.add(op.o.ref);
		} else if (ev.type === "heftSnap") {
			for (const pg of (p.doc && p.doc.pages) || []) for (const im of pg.images || []) if (im && im.ref) usedRefs.add(im.ref);
		}
	}
	return keep.filter((ev) => ev.type !== "heftBlob" || usedRefs.has(ev.payload && ev.payload.hash));
}
