// Erzeugt die Android-Icons (Vector Drawables) aus dem Icon-Sprite der PWA (web/icons.svg),
// damit beide Apps dieselben Symbole zeigen. Strich wie `.i` in web/css/base.css (1.75, rund);
// die Farbe setzt Compose per `tint`. Aufruf nach Änderungen am Sprite: node tools/android-icons.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sprite = fs.readFileSync(path.join(root, "web", "icons.svg"), "utf8");
const outDir = path.join(root, "android", "app", "src", "main", "res", "drawable");
const STROKE = 1.75;

const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const n = (v, d = 0) => (v === undefined ? d : Number(v));

// Grundformen als Pfad (VectorDrawable kennt nur <path>)
function toPath(tag, a) {
	if (tag === "path") return a.d;
	if (tag === "circle" || tag === "ellipse") {
		const cx = n(a.cx), cy = n(a.cy), rx = n(a.rx ?? a.r), ry = n(a.ry ?? a.r);
		return `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${2 * rx},0a${rx},${ry} 0 1,0 ${-2 * rx},0Z`;
	}
	if (tag === "rect") {
		const x = n(a.x), y = n(a.y), w = n(a.width), h = n(a.height);
		const r = Math.min(n(a.rx ?? a.ry), w / 2, h / 2);
		if (!r) return `M${x},${y}h${w}v${h}h${-w}Z`;
		return `M${x + r},${y}h${w - 2 * r}a${r},${r} 0 0,1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0,1 ${-r},${r}` +
			`h${-(w - 2 * r)}a${r},${r} 0 0,1 ${-r},${-r}v${-(h - 2 * r)}a${r},${r} 0 0,1 ${r},${-r}Z`;
	}
	return null;
}

function drawable(viewBox, body) {
	const [, , vw, vh] = viewBox.split(/\s+/).map(Number);
	const paths = [...body.matchAll(/<(path|rect|circle|ellipse)\b([^>]*?)\/?>/g)].map(([, tag, raw]) => {
		const a = attrs(raw), d = toPath(tag, a);
		if (!d) return "";
		const filled = a.fill === "currentColor";
		const stroked = a.stroke !== "none";
		return `    <path android:pathData="${d}"` +
			(filled ? ' android:fillColor="#FFFFFFFF"' : "") +
			(stroked ? ` android:strokeColor="#FFFFFFFF" android:strokeWidth="${STROKE}" android:strokeLineCap="round" android:strokeLineJoin="round"` : "") +
			" />";
	}).filter(Boolean);
	return '<?xml version="1.0" encoding="utf-8"?>\n<!-- Erzeugt von tools/android-icons.mjs aus web/icons.svg – nicht von Hand ändern. -->\n' +
		`<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="${vw}" android:viewportHeight="${vh}">\n` +
		paths.join("\n") + "\n</vector>\n";
}

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (/^ic_i_.*\.xml$/.test(f)) fs.rmSync(path.join(outDir, f));
let count = 0;
for (const [, id, viewBox, body] of sprite.matchAll(/<symbol id="([^"]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g)) {
	fs.writeFileSync(path.join(outDir, `ic_i_${id.replace(/-/g, "_")}.xml`), drawable(viewBox, body));
	count++;
}
console.log(`${count} Icons nach ${path.relative(root, outDir)} geschrieben.`);
