import test from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import { generateQrSvg, createQrMatrix } from "../web/qrcode.js";

/**
 * Hilfsfunktion: Rastert das erzeugte SVG in einen Pixel-Puffer (RGBA)
 * und decodiert den QR-Code mit dem Standard-Decoder jsQR.
 */
function decodeSvg(svg) {
	const match = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
	assert.ok(match, "SVG muss ein gültiges viewBox-Attribut enthalten");
	const gridDim = parseInt(match[1], 10);
	const rectMatches = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1"\/>/g)];

	const scale = 4;
	const imgW = gridDim * scale;
	const imgH = gridDim * scale;
	const imgData = new Uint8ClampedArray(imgW * imgH * 4);
	imgData.fill(255); // Weißer Hintergrund

	for (const m of rectMatches) {
		const rx = parseInt(m[1], 10);
		const ry = parseInt(m[2], 10);
		const minX = rx * scale;
		const minY = ry * scale;
		for (let py = minY; py < minY + scale; py++) {
			for (let px = minX; px < minX + scale; px++) {
				const idx = (py * imgW + px) * 4;
				imgData[idx] = 0;
				imgData[idx + 1] = 0;
				imgData[idx + 2] = 0;
				imgData[idx + 3] = 255; // Schwarzes Modul
			}
		}
	}

	return jsQR(imgData, imgW, imgH);
}

test("QR-Code: Basis-Generierung und Matrix-Struktur", () => {
	const qr = createQrMatrix("https://impala67.app");
	assert.ok(qr.modules, "Matrix muss modules-Array enthalten");
	assert.ok(qr.modules.length >= 21, "Matrixgröße muss mindestens Version 1 (21x21) sein");
	assert.strictEqual(qr.modules.length, qr.modules[0].length, "Matrix muss quadratisch sein");

	const svg = generateQrSvg("https://impala67.app", 200);
	assert.ok(svg.startsWith("<svg"), "SVG muss mit <svg beginnen");
	assert.ok(svg.includes("shape-rendering=\"crispEdges\""), "SVG muss crispEdges für scharfe Kanten nutzen");
	assert.ok(svg.includes("viewBox="), "SVG muss viewBox enthalten");
});

test("QR-Code: Kamera-Scannbarkeit für Standard-URLs", () => {
	const testUrl = "https://impala67.app";
	const svg = generateQrSvg(testUrl, 240);
	const result = decodeSvg(svg);

	assert.ok(result, "QR-Code muss von Kamera/jsQR erkannt werden");
	assert.strictEqual(result.data, testUrl, "Decodierter Text muss exakt mit Eingabe-URL übereinstimmen");
});

test("QR-Code: UTF-8 Sonderzeichen & Umlaute werden fehlerfrei decodiert", () => {
	const text = "Impala67: Notizen & Zusammenfassungen (ä, ö, ü, ß, €)";
	const svg = generateQrSvg(text, 240);
	const result = decodeSvg(svg);

	assert.ok(result, "QR-Code mit Umlauten muss erkannt werden");
	assert.strictEqual(result.data, text, "Umlaute und Sonderzeichen müssen unverändert decodiert werden");
});

test("QR-Code: E2E Cloudflare Sync Pairing Link Flow", () => {
	// 1. Gerät A: Cloudflare-Zugangsdaten erzeugen Kopplungslink
	const cfUrl = "https://impala67-sync.joshua-workers.workers.dev";
	const cfKey = "cf-v3-9f8e7d6c5b4a31029e8d7c6b5a43210f";
	const baseAppUrl = "https://joshua.github.io/Notion/";

	const payload = Buffer.from(unescape(encodeURIComponent(JSON.stringify({ url: cfUrl, key: cfKey })))).toString("base64");
	const pairingLink = `${baseAppUrl}#cf-pair=${payload}`;

	// 2. Gerät A generiert QR-Code SVG
	const qrSvg = generateQrSvg(pairingLink, 240);

	// 3. Gerät B scannt QR-Code per Smartphone-Kamera
	const scanned = decodeSvg(qrSvg);
	assert.ok(scanned, "Smartphone-Kamera muss den QR-Code scannen können");
	assert.strictEqual(scanned.data, pairingLink, "Gescannte URL muss exakt mit Kopplungs-Link übereinstimmen");

	// 4. Gerät B öffnet die URL und extrahiert den Hash (#cf-pair=...)
	const hashMatch = scanned.data.match(/#cf-pair=(.+)$/);
	assert.ok(hashMatch, "Gescannte URL muss #cf-pair Hash-Parameter enthalten");

	const scannedPayload = hashMatch[1];
	const decoded = JSON.parse(decodeURIComponent(escape(Buffer.from(scannedPayload, "base64").toString("utf-8"))));

	// 5. Zugangsdaten stimmen exakt überein -> Sync verbindet sich sofort
	assert.strictEqual(decoded.url, cfUrl, "Extrahierte Worker-URL muss identisch sein");
	assert.strictEqual(decoded.key, cfKey, "Extrahierter Sync-Schlüssel muss identisch sein");
});

test("QR-Code: Lange Nutzdaten & verschiedene QR-Versionen (100 bis 1000 Zeichen)", () => {
	const testLengths = [50, 120, 250, 500, 800];
	for (const len of testLengths) {
		const str = `https://example.com/sync?data=${"A".repeat(len)}`;
		const svg = generateQrSvg(str, 240);
		const decoded = decodeSvg(svg);

		assert.ok(decoded, `QR-Code mit Länge ${str.length} muss decodierbar sein`);
		assert.strictEqual(decoded.data, str, `QR-Code mit Länge ${str.length} muss exakt übereinstimmen`);
	}
});
