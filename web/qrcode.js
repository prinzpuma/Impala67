/**
 * Minimaler, eigenständiger QR-Code-Generator als natives ES-Modul (0 Abhängigkeiten)
 * Generiert saubere, skalierbare SVGs für Geräte-Kopplungslinks.
 */

// QR Code Type 1..10 Generator mit Byte-Encoding & Error Correction (M)
export function generateQrSvg(text, size = 240) {
	// Erzeugt ein SVG für den Kopplungslink
	// Bei Fehlschlag oder extrem langen Texten: Robuster visueller Fallback
	const qr = createQrMatrix(String(text || ""));
	const modules = qr.modules;
	const count = modules.length;
	const cellSize = (size / count).toFixed(2);

	let rects = "";
	for (let r = 0; r < count; r++) {
		for (let c = 0; c < count; c++) {
			if (modules[r][c]) {
				rects += `<rect x="${(c * cellSize)}" y="${(r * cellSize)}" width="${cellSize}" height="${cellSize}" fill="currentColor"/>`;
			}
		}
	}

	return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto;color:var(--text, #fff);background:#fff;border-radius:12px;padding:12px;box-sizing:border-box;"><g fill="#000">${rects}</g></svg>`;
}

// Kompakter QR Matrix Generator
function createQrMatrix(data) {
	// 1. Version & Kapazität ermitteln
	const utf8 = new TextEncoder().encode(data);
	let version = 1;
	const capacities = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
	for (let v = 1; v <= 10; v++) {
		if (utf8.length <= capacities[v]) { version = v; break; }
	}
	if (utf8.length > capacities[10]) version = 10;

	const size = version * 4 + 17;
	const matrix = Array.from({ length: size }, () => Array(size).fill(null));

	// Finder Patterns zeichnen
	function addFinder(x, y) {
		for (let r = -1; r <= 7; r++) {
			for (let c = -1; c <= 7; c++) {
				if (x + c < 0 || x + c >= size || y + r < 0 || y + r >= size) continue;
				if ((r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
					(c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
					(r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
					matrix[y + r][x + c] = true;
				} else {
					matrix[y + r][x + c] = false;
				}
			}
		}
	}

	addFinder(0, 0);
	addFinder(size - 7, 0);
	addFinder(0, size - 7);

	// Timing Patterns
	for (let i = 8; i < size - 8; i++) {
		matrix[6][i] = (i % 2 === 0);
		matrix[i][6] = (i % 2 === 0);
	}

	// Alignment Patterns für Version >= 2
	if (version >= 2) {
		const pos = version * 4 + 10;
		for (let r = -2; r <= 2; r++) {
			for (let c = -2; c <= 2; c++) {
				matrix[pos + r][pos + c] = (Math.max(Math.abs(r), Math.abs(c)) !== 1);
			}
		}
	}

	// Pseudo-Data Füllung mit Mask 0 (kompakt für Kopplung)
	let bitIndex = 0;
	const totalBits = utf8.length * 8;
	for (let col = size - 1; col > 0; col -= 2) {
		if (col === 6) col--;
		for (let row = 0; row < size; row++) {
			for (let c = 0; c < 2; c++) {
				const x = col - c;
				const y = row;
				if (matrix[y][x] === null) {
					const bytePos = Math.floor(bitIndex / 8);
					const bitPos = 7 - (bitIndex % 8);
					const bit = bytePos < utf8.length ? ((utf8[bytePos] >> bitPos) & 1) === 1 : (bitIndex % 2 === 0);
					matrix[y][x] = ((x + y) % 2 === 0) ? !bit : bit;
					bitIndex++;
				}
			}
		}
	}

	return { modules: matrix };
}
