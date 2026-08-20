import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

test("fest versionierte Basis-CDN-Skripte sind mit SRI abgesichert", () => {
	const expected = new Map([
		["https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js", "sha384-+VfUPEb0PdtChMwmBcBmykRMDd+v6D/oFmB3rZM/puCMDYcIvF968OimRh4KQY9a"],
		["https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js", "sha384-/TQbtLCAerC3jgaim+N78RZSDYV7ryeoBCVqTuzRrFec2akfBkHS7ACQ3PQhvMVi"],
	]);
	for (const [src, integrity] of expected) {
		const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const tag = html.match(new RegExp(`<script[^>]+src=["']${escaped}["'][^>]*>`, "i"))?.[0] || "";
		assert.match(tag, new RegExp(`integrity=["']${integrity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i"));
		assert.match(tag, /crossorigin=["']anonymous["']/i);
	}
});
