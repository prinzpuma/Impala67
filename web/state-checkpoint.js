"use strict";

export const STATE_CHECKPOINT_FORMAT = 2;
export const LEGACY_STATE_CHECKPOINT_FORMAT = 1;
export const STATE_CHECKPOINT_KEYS = Object.freeze([
	"pages", "cards", "grades", "learningSessions", "chatSessions", "settings",
	"decks", "workspaces", "gnFolders", "treeOpen", "tabs", "activeTabId",
	"reviews", "telemetry", "heftDocs", "heftBlobs",
]);
export const STATE_CHECKPOINT_CORE_KEYS = Object.freeze(
	STATE_CHECKPOINT_KEYS.filter((key) => key !== "heftBlobs"),
);

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export function eventLogInfoOf(events) {
	const list = Array.isArray(events) ? events : [];
	let maxSeq = 0, lastEventId = "";
	for (const event of list) {
		const seq = Number(event?.seq) || 0;
		if (seq >= maxSeq) { maxSeq = seq; lastEventId = String(event?.id || ""); }
	}
	return { count: list.length, maxSeq, lastEventId };
}

export function checkpointStateOf(state) {
	return Object.fromEntries(STATE_CHECKPOINT_KEYS.map((key) => [key, state[key]]));
}

export function checkpointCoreStateOf(state) {
	return Object.fromEntries(STATE_CHECKPOINT_CORE_KEYS.map((key) => [key, state[key]]));
}

export function heftBlobSizesOf(state, knownSizes) {
	const sizes = { ...(knownSizes || {}) };
	for (const [hash, value] of Object.entries(state?.heftBlobs || {})) {
		if (typeof value === "string") sizes[hash] = value.length;
	}
	return sizes;
}

// Günstige Größenindikatoren für Praxis-Traces. Exakte JSON-Serialisierung würde
// genau den zusätzlichen Main-Thread-Hänger erzeugen, den der Profiler untersucht.
export function checkpointStateStats(state, knownBlobSizes) {
	const heftDocs = Object.values(state?.heftDocs || {});
	const heftBlobSizes = heftBlobSizesOf(state, knownBlobSizes);
	return {
		pageCount: Object.keys(state?.pages || {}).length,
		cardCount: Object.keys(state?.cards || {}).length,
		chatSessionCount: Object.keys(state?.chatSessions || {}).length,
		heftDocCount: heftDocs.length,
		heftPageCount: heftDocs.reduce((sum, doc) => sum + (Array.isArray(doc?.pages) ? doc.pages.length : 0), 0),
		heftBlobCount: Object.keys(heftBlobSizes).length,
		heftBlobChars: Object.values(heftBlobSizes).reduce((sum, value) => sum + (Number(value) || 0), 0),
	};
}

export function makeStateCheckpoint(state, info, maxTime, knownBlobSizes) {
	return {
		format: STATE_CHECKPOINT_FORMAT,
		maxSeq: Math.max(0, Number(info?.maxSeq) || 0),
		eventCount: Math.max(0, Number(info?.count) || 0),
		lastEventId: String(info?.lastEventId || ""),
		maxTime: String(maxTime || ""),
		heftBlobSizes: heftBlobSizesOf(state, knownBlobSizes),
		state: checkpointCoreStateOf(state),
	};
}

export function isUsableStateCheckpoint(checkpoint, currentInfo, boundaryEvent, tailEvents) {
	if (!checkpoint || !checkpoint.state) return false;
	if (checkpoint.format === STATE_CHECKPOINT_FORMAT) {
		if (!STATE_CHECKPOINT_CORE_KEYS.every((key) => own(checkpoint.state, key))) return false;
		if (!checkpoint.heftBlobSizes || typeof checkpoint.heftBlobSizes !== "object" || Array.isArray(checkpoint.heftBlobSizes)) return false;
	} else if (checkpoint.format === LEGACY_STATE_CHECKPOINT_FORMAT) {
		if (!STATE_CHECKPOINT_KEYS.every((key) => own(checkpoint.state, key))) return false;
	} else return false;
	const maxSeq = Math.max(0, Number(checkpoint.maxSeq) || 0);
	const eventCount = Math.max(0, Number(checkpoint.eventCount) || 0);
	const tail = Array.isArray(tailEvents) ? tailEvents : [];
	if (maxSeq > (Number(currentInfo?.maxSeq) || 0)) return false;
	if (eventCount + tail.length !== (Number(currentInfo?.count) || 0)) return false;
	if (maxSeq > 0 && (!boundaryEvent || Number(boundaryEvent.seq) !== maxSeq || String(boundaryEvent.id || "") !== String(checkpoint.lastEventId || ""))) return false;
	if (tail.some((event) => (Number(event?.seq) || 0) <= maxSeq)) return false;
	// Ein nachträglich importiertes älteres Event muss in die globale Zeitreihenfolge
	// einsortiert werden. In diesem seltenen Fall ist nur der Voll-Replay beweisbar korrekt.
	if (checkpoint.maxTime && tail.some((event) => String(event?.t || "") < checkpoint.maxTime)) return false;
	return true;
}
