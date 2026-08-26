"use strict";

const clockNow = () => typeof performance !== "undefined" && typeof performance.now === "function"
	? performance.now()
	: Date.now();

// scheduler.yield() behaelt die Task-Prioritaet bei und ist deshalb der beste
// aktuelle Browser-Pfad. Safari/ältere PWAs fallen auf einen normalen Task zurück.
export function yieldToMain() {
	if (typeof globalThis.scheduler?.yield === "function") return globalThis.scheduler.yield();
	return new Promise((resolve) => setTimeout(resolve, 0));
}

// Eine gemeinsame Zeitscheibe fuer lange Schleifen. Der Aufrufer entscheidet,
// wo fachlich sicher unterbrochen werden darf; die Regel, WANN unterbrochen wird,
// bleibt dadurch zentral und direkt testbar.
export function cooperativeGate({ budgetMs = 12, now = clockNow, yieldFn = yieldToMain } = {}) {
	const budget = Math.max(1, Number(budgetMs) || 12);
	let sliceStarted = now();
	return async () => {
		if (now() - sliceStarted < budget) return false;
		await yieldFn();
		sliceStarted = now();
		return true;
	};
}
