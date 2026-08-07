"use strict";

// Rechenarbeit des Wissensgraphen. Der Worker hält das UI auch bei mehreren
// tausend Karten flüssig; bewusst kein allgemeines Graph-Framework.
const sampleDims = (length) => {
	const n = Math.min(96, length);
	return Array.from({ length: n }, (_, i) => Math.floor(i * length / n));
};

const cosine = (a, b, dims) => {
	let dot = 0, aa = 0, bb = 0;
	for (const i of dims) {
		const x = a[i] || 0, y = b[i] || 0;
		dot += x * y; aa += x * x; bb += y * y;
	}
	return dot / (Math.sqrt(aa * bb) || 1);
};

function cluster(items) {
	if (!items.length) return [];
	const dims = sampleDims(items[0].vec.length);
	const k = Math.max(1, Math.min(14, Math.round(Math.sqrt(items.length / 7))));
	let centers = Array.from({ length: k }, (_, i) => {
		const at = Math.floor(i * items.length / k);
		return Float32Array.from(items[at].vec);
	});
	let assign = new Int16Array(items.length);
	for (let pass = 0; pass < 8; pass++) {
		for (let i = 0; i < items.length; i++) {
			let best = 0, score = -Infinity;
			for (let c = 0; c < centers.length; c++) {
				const s = cosine(items[i].vec, centers[c], dims);
				if (s > score) { score = s; best = c; }
			}
			assign[i] = best;
		}
		const sums = centers.map(() => new Float32Array(items[0].vec.length));
		const counts = new Uint32Array(k);
		for (let i = 0; i < items.length; i++) {
			const c = assign[i], v = items[i].vec;
			counts[c]++;
			for (const d of dims) sums[c][d] += v[d] || 0;
		}
		centers = centers.map((old, c) => {
			if (!counts[c]) return old;
			for (const d of dims) sums[c][d] /= counts[c];
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
