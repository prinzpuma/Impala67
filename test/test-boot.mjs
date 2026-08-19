import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('./web/index.html', 'utf8');
const dom = new JSDOM(html, {
	url: 'https://prinzpuma.github.io/Impala67/',
	pretendToBeVisual: true,
	runScripts: "dangerously"
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.performance = dom.window.performance;
globalThis.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));

// IndexedDB mock
globalThis.indexedDB = {
	open: () => {
		const req = { onsuccess: null, onerror: null, onupgradeneeded: null };
		setTimeout(() => {
			req.result = {
				createObjectStore: () => ({ createIndex: () => {} }),
				transaction: () => ({
					objectStore: () => ({
						getAll: () => {
							const r = { onsuccess: null };
							setTimeout(() => { if (r.onsuccess) r.onsuccess({ target: { result: [] } }); }, 0);
							return r;
						},
						openCursor: () => {
							const r = { onsuccess: null };
							setTimeout(() => { if (r.onsuccess) r.onsuccess({ target: { result: null } }); }, 0);
							return r;
						},
						add: () => {}
					})
				})
			};
			if (req.onsuccess) req.onsuccess({ target: req });
		}, 0);
		return req;
	}
};

try {
	const main = await import('../web/main.js');
	console.log('MAIN.JS IMPORTED OK');
} catch (err) {
	console.error('MAIN.JS IMPORT ERROR:', err);
}
