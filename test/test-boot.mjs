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
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
globalThis.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));

// IndexedDB mock
globalThis.indexedDB = {
	open: () => {
		const req = { onsuccess: null, onerror: null, onupgradeneeded: null };
		setTimeout(() => {
			req.result = {
				objectStoreNames: { contains: () => true },
				createObjectStore: () => ({ createIndex: () => {} }),
				transaction: () => {
					const tx = {
						oncomplete: null,
						onerror: null,
						onabort: null,
						objectStore: () => ({
							get: () => ({ onsuccess: null, onerror: null }),
							getAllKeys: () => ({ onsuccess: null, onerror: null }),
							put: () => {},
							delete: () => {},
							getAll: () => {
								const r = { onsuccess: null };
								setTimeout(() => { if (r.onsuccess) r.onsuccess({ target: { result: [] } }); }, 0);
								return r;
							},
							count: () => {
								const r = { onsuccess: null };
								setTimeout(() => { if (r.onsuccess) r.onsuccess({ target: { result: 0 } }); }, 0);
								return r;
							},
							openCursor: () => {
								const r = { onsuccess: null };
								setTimeout(() => { if (r.onsuccess) r.onsuccess({ target: { result: null } }); }, 0);
								return r;
							},
							add: () => {}
						})
					};
					setTimeout(() => tx.oncomplete?.(), 0);
					return tx;
				},
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
