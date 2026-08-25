import test from "node:test";
import assert from "node:assert/strict";
import {
	cacheOptionalModuleGroup,
	mayPrefetchOptionalModules,
	stylesheetAssetUrls,
} from "../web/optional-modules.js";

test("Idle-Prefetch respektiert Datensparmodus und sehr langsame Verbindungen", () => {
	assert.equal(mayPrefetchOptionalModules(undefined), true);
	assert.equal(mayPrefetchOptionalModules({ effectiveType: "4g", saveData: false }), true);
	assert.equal(mayPrefetchOptionalModules({ effectiveType: "2g", saveData: false }), false);
	assert.equal(mayPrefetchOptionalModules({ effectiveType: "4g", saveData: true }), false);
});

test("Stylesheet-Abhaengigkeiten werden absolut und ohne Duplikate ermittelt", () => {
	const css = "@font-face{src:url(../fonts/a.woff2)} .x{src:url('../fonts/a.woff2')} .y{src:url(data:image/png;base64,x)}";
	assert.deepEqual(stylesheetAssetUrls(css, "https://cdn.example/pkg/css/main.css"), [
		"https://cdn.example/pkg/fonts/a.woff2",
	]);
});

test("eine Modulgruppe cached Hauptdateien und CSS-Folgeassets gemeinsam", async () => {
	const entries = new Map();
	const cache = {
		async match(url) { return entries.get(url)?.clone(); },
		async put(url, response) { entries.set(url, response.clone()); },
		async delete(url) { return entries.delete(url); },
	};
	const cssUrl = "https://cdn.example/pkg/main.css";
	const jsUrl = "https://cdn.example/pkg/main.js";
	const fontUrl = "https://cdn.example/pkg/font.woff2";
	const responses = new Map([
		[cssUrl, new Response("@font-face{src:url(./font.woff2)}", { headers: { "content-type": "text/css" } })],
		[jsUrl, new Response("globalThis.pkg = {};", { headers: { "content-type": "text/javascript" } })],
		[fontUrl, new Response("font", { headers: { "content-type": "font/woff2" } })],
	]);
	const fetched = [];
	const result = await cacheOptionalModuleGroup(cache, { name: "Test", urls: [cssUrl, jsUrl] }, async (url) => {
		fetched.push(url);
		return responses.get(url).clone();
	});

	assert.deepEqual(fetched, [cssUrl, jsUrl, fontUrl]);
	assert.deepEqual([...entries.keys()], [cssUrl, jsUrl, fontUrl]);
	assert.deepEqual(result, { name: "Test", cached: 3, downloaded: 3 });
});
