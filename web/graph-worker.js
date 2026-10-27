"use strict";

import { dot, norm } from "./vector-math.js";

// Rechenarbeit des Wissensgraphen. Der Worker hält das UI auch bei mehreren
// tausend Karten flüssig; bewusst kein allgemeines Graph-Framework.
// Volle Vektoren: Vorher rechnete das Clustering nur 96 Stichproben-Dimensionen und ließ den
// Rest der Zentren auf 0 – die Brücken in graph.js verglichen dann kaum überlappende Werte.
function cluster(items) {
	if (!items.length) return [];
	const dims = items[0].vec.length;
	const k = Math.max(1, Math.min(14, Math.round(Math.sqrt(items.length / 7))));
	let centers = Array.from({ length: k }, (_, i) => {
		const at = Math.floor(i * items.length / k);
		return Float32Array.from(items[at].vec);
	});
	let assign = new Int16Array(items.length);
	const itemNorms = items.map((item) => norm(item.vec));
	for (let pass = 0; pass < 8; pass++) {
		const centerNorms = centers.map(norm);
		for (let i = 0; i < items.length; i++) {
			let best = 0, score = -Infinity;
			for (let c = 0; c < centers.length; c++) {
				const s = dot(items[i].vec, centers[c]) / (itemNorms[i] * centerNorms[c]);
				if (s > score) { score = s; best = c; }
			}
			assign[i] = best;
		}
		const sums = centers.map(() => new Float32Array(items[0].vec.length));
		const counts = new Uint32Array(k);
		for (let i = 0; i < items.length; i++) {
			const c = assign[i], v = items[i].vec;
			counts[c]++;
			for (let d = 0; d < dims; d++) sums[c][d] += v[d] || 0;
		}
		centers = centers.map((old, c) => {
			if (!counts[c]) return old;
			for (let d = 0; d < dims; d++) sums[c][d] /= counts[c];
			return sums[c];
		});
	}
	return centers.map((center, c) => ({
		ids: items.filter((_, i) => assign[i] === c).map((x) => x.id),
		center: Array.from(center),
	})).filter((x) => x.ids.length);
}

self.onmessage = (event) => {
	try {
		const groups = (event.data.groups || []).map((group) => ({
			key: group.key,
			subject: group.subject,
			topic: group.topic,
			clusters: cluster(group.items || []),
		}));
		self.postMessage({ ok: true, groups });
	} catch (error) {
		self.postMessage({ ok: false, error: String(error && error.message || error) });
	}
};
