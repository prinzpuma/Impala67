// Erzeugt die iPad-Icons (Asset-Katalog, SVG als Vorlage) aus dem Icon-Sprite der PWA (web/icons.svg),
// damit PWA, Android und iPad dieselben Symbole zeigen. Strich wie `.i` in web/css/base.css (1.75, rund);
// die Farbe setzt SwiftUI (`renderingMode(.template)`). Aufruf nach Änderungen am Sprite:
// npm run ios:icons
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sprite = fs.readFileSync(path.join(root, "web", "icons.svg"), "utf8");
const catalog = path.join(root, "ios", "Impala67", "Assets.xcassets");
const STROKE = 1.75;

fs.mkdirSync(catalog, { recursive: true });
fs.writeFileSync(path.join(catalog, "Contents.json"), JSON.stringify({ info: { author: "xcode", version: 1 } }, null, 2) + "\n");
// Alte Icons entfernen, damit gelöschte Symbole nicht liegen bleiben.
for (const d of fs.readdirSync(catalog)) if (d.startsWith("i-") && d.endsWith(".imageset")) fs.rmSync(path.join(catalog, d), { recursive: true });

let count = 0;
for (const [, id, viewBox, body] of sprite.matchAll(/<symbol id="([^"]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g)) {
	const inner = body.replaceAll("currentColor", "#000");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="24" height="24">` +
		`<g fill="none" stroke="#000" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>\n`;
	const dir = path.join(catalog, `i-${id}.imageset`);
	fs.mkdirSync(dir);
	fs.writeFileSync(path.join(dir, `${id}.svg`), svg);
	fs.writeFileSync(path.join(dir, "Contents.json"), JSON.stringify({
		images: [{ filename: `${id}.svg`, idiom: "universal" }],
		info: { author: "xcode", version: 1 },
		properties: { "preserves-vector-representation": true, "template-rendering-intent": "template" },
	}, null, 2) + "\n");
	count++;
}
console.log(`${count} Icons → ${path.relative(root, catalog)}`);
