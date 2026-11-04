// Erzeugt das App-Icon der iPad-App (ios/Impala67/Assets.xcassets/AppIcon.appiconset) aus dem PWA-Icon
// (web/icon.svg), damit PWA, Android und iPad gleich aussehen. Xcode nimmt für App-Icons nur PNG an; ein
// einzelnes 1024×1024-Bild reicht (Xcode erzeugt die kleineren Größen). iOS rundet die Ecken selbst, deshalb
// wird der Hintergrund randlos gezeichnet, und das PNG bekommt keinen Alphakanal (App-Store-Regel).
// Gezeichnet wird mit Chrome bzw. Edge über puppeteer-core (Filter wie die Papier-Körnung brauchen eine
// echte SVG-Engine). Aufruf nach Änderungen am Icon: npm run ios:app-icon
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import puppeteer from "puppeteer-core";

const root = path.resolve(import.meta.dirname, "..");
const SIZE = 1024;
// CRC-32 für die PNG-Blöcke.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

const outDir = path.join(root, "ios", "Impala67", "Assets.xcassets", "AppIcon.appiconset");

const env = process.env;
const browsers = [
	env.CHROME_BIN,
	env.PUPPETEER_EXECUTABLE_PATH,
	...["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"].flatMap((v) => env[v]
		? [path.join(env[v], "Google", "Chrome", "Application", "chrome.exe"), path.join(env[v], "Microsoft", "Edge", "Application", "msedge.exe")]
		: []),
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/usr/bin/microsoft-edge",
	"/snap/bin/chromium",
	path.join(os.homedir(), ".cache", "ms-playwright", "chromium", "chrome-linux", "chrome"),
].filter(Boolean);

const executablePath = browsers.find((p) => fs.existsSync(p));
if (!executablePath) {
	console.error("Chrome oder Edge nicht gefunden – Pfad über CHROME_BIN angeben.");
	process.exit(1);
}

// Randloser Hintergrund: die abgerundete Ecke der PWA (rx="210") übernimmt iOS.
const svg = fs.readFileSync(path.join(root, "web", "icon.svg"), "utf8")
	.replace(/<rect width="1024" height="1024" rx="\d+"/, '<rect width="1024" height="1024"')
	.replace("<svg ", `<svg width="${SIZE}" height="${SIZE}" `);

const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
let rgba;
try {
	const page = await browser.newPage();
	await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });
	await page.setContent(`<!doctype html><html><body style="margin:0;background:#173A5E">${svg}</body></html>`);
	rgba = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
} finally {
	await browser.close();
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "AppIcon.png"), withoutAlpha(Buffer.from(rgba)));
fs.writeFileSync(path.join(outDir, "Contents.json"), JSON.stringify({
	images: [{ filename: "AppIcon.png", idiom: "universal", platform: "ios", size: "1024x1024" }],
	info: { author: "xcode", version: 1 },
}, null, 2) + "\n");
console.log(`App-Icon ${SIZE}×${SIZE} → ${path.relative(root, outDir)}`);

// --- PNG ohne Alphakanal (RGBA 8 Bit → RGB 8 Bit), ohne Zusatzpakete ---

function withoutAlpha(png) {
	let pos = 8, width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
	const idat = [];
	while (pos < png.length) {
		const len = png.readUInt32BE(pos);
		const type = png.toString("latin1", pos + 4, pos + 8);
		const data = png.subarray(pos + 8, pos + 8 + len);
		if (type === "IHDR") {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
			interlace = data[12];
		} else if (type === "IDAT") idat.push(data);
		pos += 12 + len;
	}
	if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) throw new Error(`Unerwartetes PNG (Typ ${colorType}, ${bitDepth} Bit)`);
	if (colorType === 2) return png;
	const raw = zlib.inflateSync(Buffer.concat(idat));
	const bpp = 4, stride = width * bpp;
	const out = Buffer.alloc(height * (1 + width * 3));
	let prev = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
			let add = 0;
			if (filter === 1) add = a;
			else if (filter === 2) add = b;
			else if (filter === 3) add = (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			line[x] = (line[x] + add) & 0xff;
		}
		const o = y * (1 + width * 3);
		out[o] = 0;
		for (let x = 0; x < width; x++) {
			out[o + 1 + x * 3] = line[x * 4];
			out[o + 2 + x * 3] = line[x * 4 + 1];
			out[o + 3 + x * 3] = line[x * 4 + 2];
		}
		prev = line;
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	return Buffer.concat([png.subarray(0, 8), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(out, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type, data) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, "latin1");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
	return Buffer.concat([head, data, crc]);
}

function crc32(buf) {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
