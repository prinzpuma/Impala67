// Erzeugt das Leerlauf-Tier der Lernzeit (ein kleines Impala) für alle drei Versionen aus EINER Vorlage:
//   PWA:     web/lernzeit-tier.js           (Inline-SVG, damit die Augen blinzeln können)
//   Android: android/.../drawable/lz_tier*.xml (Vector Drawables)
//   iPad:    ios/.../Assets.xcassets/lz-tier*.imageset (SVG, Vektor erhalten)
// Aufruf nach Änderungen an der Zeichnung: node tools/lernzeit-tier.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const W = 100, H = 92;

const FUR = "#C98B4E", DARK_FUR = "#A8703C", CREAM = "#F4E4C9", EAR = "#EAB79A", HORN = "#3B2A1E", NOSE = "#3A2516", EYE = "#2B1A0F";
const ell = (cx, cy, rx, ry) => `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${2 * rx},0a${rx},${ry} 0 1,0 ${-2 * rx},0Z`;

// Formen von hinten nach vorn. fill/stroke, optional rotate [Grad, px, py], alpha, eye (für das Blinzeln).
function shapes(sleep) {
	const eye = (x) => sleep
		? [{ d: `M${x - 4.5},45q4.5,4 9,0`, stroke: NOSE, width: 2.2 }]
		: [{ d: ell(x, 45, 4.4, 4.4), fill: EYE, eye: true }, { d: ell(x + 1.4, 43.6, 1.4, 1.4), fill: "#FFFFFF", eye: true }];
	return [
		{ d: "M41,30C35,21 42,13 35,2M59,30C65,21 58,13 65,2", stroke: HORN, width: 4.2 },
		{ d: "M38.5,21.5l-4,1M37,13.5l-4,0.8M61.5,21.5l4,1M63,13.5l4,0.8", stroke: HORN, width: 2 },
		{ d: ell(25, 38, 14, 6.5), fill: FUR, rotate: [-22, 25, 38] },
		{ d: ell(24, 38, 9, 3.4), fill: EAR, rotate: [-22, 25, 38] },
		{ d: ell(75, 38, 14, 6.5), fill: FUR, rotate: [22, 75, 38] },
		{ d: ell(76, 38, 9, 3.4), fill: EAR, rotate: [22, 75, 38] },
		{ d: "M30,92C32,80 40,74 50,74S68,80 70,92Z", fill: FUR },
		{ d: "M43,92C44,84 47,80 50,80S56,84 57,92Z", fill: CREAM },
		{ d: "M50,25C38,25 33,33 34,45C35,59 41,71 50,76C59,71 65,59 66,45C67,33 62,25 50,25Z", fill: FUR },
		{ d: "M50,25C45,25 42,28 42,32C46,31 54,31 58,32C58,28 55,25 50,25Z", fill: DARK_FUR },
		{ d: ell(41, 39, 5, 2) + ell(59, 39, 5, 2), fill: CREAM },
		{ d: "M42,62C42,70 46,76 50,76C54,76 58,70 58,62C55,59 45,59 42,62Z", fill: CREAM },
		{ d: ell(50, 66, 5, 3.2), fill: NOSE },
		...eye(42), ...eye(58),
		{ d: ell(38, 54, 3.5, 2) + ell(62, 54, 3.5, 2), fill: "#E7967A", alpha: 0.45 },
	];
}

function svg(sleep, { blink = false } = {}) {
	const el = (s) => {
		const paint = s.stroke
			? `fill="none" stroke="${s.stroke}" stroke-width="${s.width}" stroke-linecap="round"`
			: `fill="${s.fill}"` + (s.alpha ? ` fill-opacity="${s.alpha}"` : "");
		const tf = s.rotate ? ` transform="rotate(${s.rotate.join(" ")})"` : "";
		const cls = blink && s.eye ? ' class="lz-eye"' : "";
		return `<path d="${s.d}" ${paint}${tf}${cls}/>`;
	};
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${shapes(sleep).map(el).join("")}</svg>`;
}

function vector(sleep) {
	const el = (s) => {
		const paint = s.stroke
			? `android:strokeColor="${s.stroke}" android:strokeWidth="${s.width}" android:strokeLineCap="round"`
			: `android:fillColor="${s.fill}"` + (s.alpha ? ` android:fillAlpha="${s.alpha}"` : "");
		const p = `<path android:pathData="${s.d}" ${paint}/>`;
		return s.rotate ? `<group android:rotation="${s.rotate[0]}" android:pivotX="${s.rotate[1]}" android:pivotY="${s.rotate[2]}">${p}</group>` : p;
	};
	return `<?xml version="1.0" encoding="utf-8"?>
<!-- Erzeugt von tools/lernzeit-tier.mjs – nicht von Hand ändern. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="${W}dp" android:height="${H}dp" android:viewportWidth="${W}" android:viewportHeight="${H}">
${shapes(sleep).map((s) => "  " + el(s)).join("\n")}
</vector>
`;
}

const write = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

write("web/lernzeit-tier.js", `"use strict";
// Erzeugt von tools/lernzeit-tier.mjs – nicht von Hand ändern.
// Leerlauf-Tier der Lernzeit (lernzeit.js): wach (Augen mit .lz-eye zum Blinzeln) und dösend.
export const TIER_SVG = ${JSON.stringify(svg(false, { blink: true }))};
export const TIER_SCHLAF_SVG = ${JSON.stringify(svg(true))};
`);
write("android/app/src/main/res/drawable/lz_tier.xml", vector(false));
write("android/app/src/main/res/drawable/lz_tier_schlaf.xml", vector(true));
for (const [name, sleep] of [["lz-tier", false], ["lz-tier-schlaf", true]]) {
	const dir = `ios/Impala67/Assets.xcassets/${name}.imageset`;
	write(`${dir}/${name}.svg`, svg(sleep) + "\n");
	write(`${dir}/Contents.json`, JSON.stringify({
		images: [{ filename: `${name}.svg`, idiom: "universal" }],
		info: { author: "xcode", version: 1 },
		properties: { "preserves-vector-representation": true, "template-rendering-intent": "original" },
	}, null, 2) + "\n");
}
console.log("Lernzeit-Tier für PWA, Android und iPad geschrieben.");
