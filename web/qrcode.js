/**
 * Minimaler, eigenständiger QR-Code-Generator als natives ES-Modul (0 Abhängigkeiten)
 * Standardkonforme Generierung nach ISO/IEC 18004 (Byte-Modus, Reed-Solomon-Fehlerkorrektur,
 * Standard-Maskierung & Quiet Zone) für zuverlässiges Scannen per Smartphone-Kamera.
 */

// Galois-Feld GF(256) Arithmetik für Reed-Solomon-Fehlerkorrektur
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
let gfVal = 1;
for (let i = 0; i < 255; i++) {
	GF_EXP[i] = gfVal;
	GF_EXP[i + 255] = gfVal;
	GF_LOG[gfVal] = i;
	gfVal = (gfVal << 1) ^ (gfVal >= 128 ? 0x11D : 0);
}

function gfMul(a, b) {
	return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
	let poly = [1];
	for (let i = 0; i < degree; i++) {
		const root = GF_EXP[i];
		const next = new Array(poly.length + 1).fill(0);
		for (let j = 0; j < poly.length; j++) {
			next[j] ^= poly[j];
			next[j + 1] ^= gfMul(poly[j], root);
		}
		poly = next;
	}
	return poly;
}

function rsComputeRemainder(data, numEcCodewords) {
	const gen = rsGeneratorPoly(numEcCodewords).slice(1);
	const remainder = new Uint8Array(numEcCodewords);
	for (let i = 0; i < data.length; i++) {
		const factor = data[i] ^ remainder[0];
		remainder.copyWithin(0, 1);
		remainder[numEcCodewords - 1] = 0;
		for (let j = 0; j < numEcCodewords; j++) {
			remainder[j] ^= gfMul(gen[j], factor);
		}
	}
	return remainder;
}

// ISO/IEC 18004 Block- & Codewort-Tabelle für Fehlerkorrektur Level M (Medium, 15%)
// Format: [totalCodewords, ecPerBlock, g1Blocks, g1DataWords, g2Blocks, g2DataWords]
const EC_TABLE_M = [
	null,
	[26, 10, 1, 16, 0, 0],
	[44, 16, 1, 28, 0, 0],
	[70, 26, 1, 44, 0, 0],
	[100, 18, 2, 32, 0, 0],
	[134, 24, 2, 43, 0, 0],
	[172, 16, 4, 27, 0, 0],
	[196, 18, 4, 31, 0, 0],
	[242, 22, 2, 38, 2, 39],
	[292, 22, 3, 36, 2, 37],
	[346, 26, 4, 43, 1, 44],
	[404, 30, 1, 50, 4, 51],
	[466, 22, 6, 36, 2, 37],
	[532, 22, 8, 37, 1, 38],
	[581, 24, 4, 40, 5, 41],
	[655, 24, 5, 41, 5, 42],
	[733, 28, 7, 45, 3, 46],
	[815, 28, 10, 46, 1, 47],
	[901, 26, 9, 43, 4, 44],
	[991, 26, 3, 44, 11, 45],
	[1085, 26, 3, 41, 13, 42],
	[1156, 26, 17, 42, 0, 0],
	[1258, 28, 17, 46, 0, 0],
	[1364, 28, 4, 47, 14, 48],
	[1474, 28, 6, 45, 14, 46],
	[1588, 28, 8, 47, 13, 48],
	[1706, 28, 19, 46, 4, 47],
	[1828, 28, 22, 45, 3, 46],
	[1921, 28, 3, 45, 23, 46],
	[2051, 28, 21, 45, 7, 46],
	[2185, 28, 19, 47, 10, 48],
	[2323, 28, 2, 46, 29, 47],
	[2465, 28, 10, 46, 23, 47],
	[2611, 28, 14, 46, 21, 47],
	[2761, 28, 14, 46, 23, 47],
	[2876, 28, 12, 47, 26, 48],
	[3034, 28, 6, 47, 34, 48],
	[3196, 28, 29, 46, 14, 47],
	[3362, 28, 13, 46, 32, 47],
	[3532, 28, 40, 47, 7, 48],
	[3706, 28, 18, 47, 31, 48]
];

// ISO/IEC 18004 Alignment-Muster-Mittelpunkte für Version 1..40
const ALIGNMENT_COORDS = [
	[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
	[6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
	[6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
	[6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
	[6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
	[6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110],
	[6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122],
	[6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
	[6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138],
	[6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
	[6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
	[6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
	[6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]
];

// ISO/IEC 18004 Remainder-Bits pro Version
const REMAINDER_BITS = [
	0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3,
	4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0
];

function getCapacityBytes(version) {
	const t = EC_TABLE_M[version];
	const totalDataCodewords = t[2] * t[3] + t[4] * t[5];
	const charCountBits = version < 10 ? 8 : 16;
	const availableBits = totalDataCodewords * 8 - 4 - charCountBits;
	return Math.floor(availableBits / 8);
}

function selectVersion(byteLength) {
	for (let v = 1; v <= 40; v++) {
		if (getCapacityBytes(v) >= byteLength) return v;
	}
	throw new Error(`Text zu lang für QR-Code: ${byteLength} Bytes`);
}

function encodeData(utf8Bytes, version) {
	const t = EC_TABLE_M[version];
	const totalDataCodewords = t[2] * t[3] + t[4] * t[5];
	const bits = [];

	function pushBits(val, len) {
		for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
	}

	// 1. Modus-Indikator: Byte-Modus (0100)
	pushBits(4, 4);

	// 2. Zeichenzähler (8 Bit für V1-9, 16 Bit für V10-40)
	const countBits = version < 10 ? 8 : 16;
	pushBits(utf8Bytes.length, countBits);

	// 3. Nutzdaten-Bytes
	for (let i = 0; i < utf8Bytes.length; i++) pushBits(utf8Bytes[i], 8);

	// 4. Terminator (bis zu 4 Nullen)
	const maxBits = totalDataCodewords * 8;
	const termLen = Math.min(4, maxBits - bits.length);
	for (let i = 0; i < termLen; i++) bits.push(0);

	// 5. Byte-Grenze auffüllen
	while (bits.length % 8 !== 0) bits.push(0);

	// 6. Daten-Codewörter erstellen
	const dataCodewords = new Uint8Array(totalDataCodewords);
	let byteIdx = 0;
	for (let i = 0; i < bits.length; i += 8) {
		let b = 0;
		for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
		dataCodewords[byteIdx++] = b;
	}

	// 7. Auffüllbytes 0xEC, 0x11
	let pad = 0xEC;
	while (byteIdx < totalDataCodewords) {
		dataCodewords[byteIdx++] = pad;
		pad = pad === 0xEC ? 0x11 : 0xEC;
	}

	// 8. Reed-Solomon-Fehlerkorrekturblöcke berechnen & verschränken (Interleaving)
	const ecPerBlock = t[1];
	const g1Blocks = t[2];
	const g1DataWords = t[3];
	const g2Blocks = t[4];
	const g2DataWords = t[5];
	const totalBlocks = g1Blocks + g2Blocks;

	const dataBlocks = [];
	const ecBlocks = [];

	let offset = 0;
	for (let b = 0; b < g1Blocks; b++) {
		const block = dataCodewords.slice(offset, offset + g1DataWords);
		dataBlocks.push(block);
		ecBlocks.push(rsComputeRemainder(block, ecPerBlock));
		offset += g1DataWords;
	}
	for (let b = 0; b < g2Blocks; b++) {
		const block = dataCodewords.slice(offset, offset + g2DataWords);
		dataBlocks.push(block);
		ecBlocks.push(rsComputeRemainder(block, ecPerBlock));
		offset += g2DataWords;
	}

	// Daten-Codewörter verschränken
	const finalBits = [];
	const maxDataWords = Math.max(g1DataWords, g2DataWords);
	for (let i = 0; i < maxDataWords; i++) {
		for (let b = 0; b < totalBlocks; b++) {
			if (i < dataBlocks[b].length) {
				const val = dataBlocks[b][i];
				for (let k = 7; k >= 0; k--) finalBits.push((val >> k) & 1);
			}
		}
	}

	// Fehlerkorrektur-Codewörter verschränken
	for (let i = 0; i < ecPerBlock; i++) {
		for (let b = 0; b < totalBlocks; b++) {
			const val = ecBlocks[b][i];
			for (let k = 7; k >= 0; k--) finalBits.push((val >> k) & 1);
		}
	}

	// Remainder-Bits anhängen
	const remBits = REMAINDER_BITS[version];
	for (let i = 0; i < remBits; i++) finalBits.push(0);

	return finalBits;
}

export function createQrMatrix(data) {
	const utf8 = new TextEncoder().encode(String(data || ""));
	const version = selectVersion(utf8.length);
	const dataBits = encodeData(utf8, version);
	const size = version * 4 + 17;
	const matrix = Array.from({ length: size }, () => Array(size).fill(null));
	const isFunc = Array.from({ length: size }, () => Array(size).fill(false));

	function setFunc(r, c, val) {
		matrix[r][c] = val;
		isFunc[r][c] = true;
	}

	// Finder-Muster (7x7) + Separator (8x8)
	function addFinder(top, left) {
		for (let r = -1; r <= 7; r++) {
			for (let c = -1; c <= 7; c++) {
				const row = top + r;
				const col = left + c;
				if (row < 0 || row >= size || col < 0 || col >= size) continue;
				if (r === -1 || r === 7 || c === -1 || c === 7) {
					setFunc(row, col, false);
				} else if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
					setFunc(row, col, true);
				} else {
					setFunc(row, col, false);
				}
			}
		}
	}

	addFinder(0, 0);
	addFinder(0, size - 7);
	addFinder(size - 7, 0);

	// Timing-Muster (Reihe 6 & Spalte 6)
	for (let i = 8; i < size - 8; i++) {
		if (!isFunc[6][i]) setFunc(6, i, i % 2 === 0);
		if (!isFunc[i][6]) setFunc(i, 6, i % 2 === 0);
	}

	// Dunkles Modul (Dark Module)
	setFunc(4 * version + 9, 8, true);

	// Alignment-Muster (für Version >= 2)
	const alignCoords = ALIGNMENT_COORDS[version];
	for (let i = 0; i < alignCoords.length; i++) {
		for (let j = 0; j < alignCoords.length; j++) {
			const r = alignCoords[i];
			const c = alignCoords[j];
			if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 8) || (r >= size - 8 && c <= 8)) continue;
			for (let dr = -2; dr <= 2; dr++) {
				for (let dc = -2; dc <= 2; dc++) {
					const isBlack = (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0));
					setFunc(r + dr, c + dc, isBlack);
				}
			}
		}
	}

	// Format-Info-Bereiche reservieren
	for (let i = 0; i <= 8; i++) {
		if (i !== 6) { isFunc[8][i] = true; isFunc[i][8] = true; }
	}
	for (let i = size - 8; i < size; i++) isFunc[8][i] = true;
	for (let i = size - 7; i < size; i++) isFunc[i][8] = true;

	// Version-Info-Bereiche reservieren (für Version >= 7)
	if (version >= 7) {
		for (let r = 0; r < 6; r++) {
			for (let c = size - 11; c < size - 8; c++) isFunc[r][c] = true;
		}
		for (let c = 0; c < 6; c++) {
			for (let r = size - 11; r < size - 8; r++) isFunc[r][c] = true;
		}
	}

	// Datenbits im Zickzack-Muster platzieren
	let bitIdx = 0;
	let upwards = true;
	for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
		if (rightCol === 6) rightCol--;
		const rows = upwards
			? Array.from({ length: size }, (_, idx) => size - 1 - idx)
			: Array.from({ length: size }, (_, idx) => idx);

		for (const r of rows) {
			for (const c of [rightCol, rightCol - 1]) {
				if (!isFunc[r][c]) {
					const bit = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0;
					matrix[r][c] = bit === 1;
				}
			}
		}
		upwards = !upwards;
	}

	// Masken 0..7
	const maskFns = [
		(r, c) => (r + c) % 2 === 0,
		(r, c) => r % 2 === 0,
		(r, c) => c % 3 === 0,
		(r, c) => (r + c) % 3 === 0,
		(r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
		(r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
		(r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
		(r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
	];

	function getFormatBits(mask) {
		const data = (0 << 3) | mask; // EC-Level M = 00
		let bch = data << 10;
		for (let i = 4; i >= 0; i--) {
			if ((bch >> (i + 10)) & 1) bch ^= (0x537 << i);
		}
		return ((data << 10) | bch) ^ 0x5412;
	}

	function getVersionBits(v) {
		let bch = v << 12;
		for (let i = 5; i >= 0; i--) {
			if ((bch >> (i + 12)) & 1) bch ^= (0x1F25 << i);
		}
		return (v << 12) | bch;
	}

	let bestMask = 0;
	let bestPenalty = Infinity;
	let bestMatrix = null;

	for (let maskIdx = 0; maskIdx < 8; maskIdx++) {
		const masked = Array.from({ length: size }, (_, r) =>
			Array.from({ length: size }, (_, c) => {
				if (isFunc[r][c]) return matrix[r][c];
				const orig = matrix[r][c];
				return maskFns[maskIdx](r, c) ? !orig : orig;
			})
		);

		// Format-Informationen eintragen
		const fmt = getFormatBits(maskIdx);
		const fmtBits = [];
		for (let i = 0; i < 15; i++) fmtBits.push(((fmt >> i) & 1) === 1);

		masked[8][0] = fmtBits[0];
		masked[8][1] = fmtBits[1];
		masked[8][2] = fmtBits[2];
		masked[8][3] = fmtBits[3];
		masked[8][4] = fmtBits[4];
		masked[8][5] = fmtBits[5];
		masked[8][7] = fmtBits[6];
		masked[8][8] = fmtBits[7];
		masked[7][8] = fmtBits[8];
		masked[5][8] = fmtBits[9];
		masked[4][8] = fmtBits[10];
		masked[3][8] = fmtBits[11];
		masked[2][8] = fmtBits[12];
		masked[1][8] = fmtBits[13];
		masked[0][8] = fmtBits[14];

		for (let i = 0; i <= 7; i++) masked[8][size - 1 - i] = fmtBits[i];
		for (let i = 0; i <= 6; i++) masked[size - 1 - (6 - i)][8] = fmtBits[8 + i];

		// Version-Informationen für V >= 7 eintragen
		if (version >= 7) {
			const vBits = getVersionBits(version);
			for (let i = 0; i < 18; i++) {
				const bit = ((vBits >> i) & 1) === 1;
				const r = Math.floor(i / 3);
				const c = (i % 3);
				masked[size - 11 + c][r] = bit;
				masked[r][size - 11 + c] = bit;
			}
		}

		// Penalty-Berechnung nach ISO/IEC 18004
		let penalty = 0;

		// N1: Horizontale und vertikale Läufe gleicher Farbe (>= 5)
		for (let r = 0; r < size; r++) {
			let runColor = masked[r][0];
			let runLen = 1;
			for (let c = 1; c < size; c++) {
				if (masked[r][c] === runColor) runLen++;
				else {
					if (runLen >= 5) penalty += 3 + (runLen - 5);
					runColor = masked[r][c];
					runLen = 1;
				}
			}
			if (runLen >= 5) penalty += 3 + (runLen - 5);
		}
		for (let c = 0; c < size; c++) {
			let runColor = masked[0][c];
			let runLen = 1;
			for (let r = 1; r < size; r++) {
				if (masked[r][c] === runColor) runLen++;
				else {
					if (runLen >= 5) penalty += 3 + (runLen - 5);
					runColor = masked[r][c];
					runLen = 1;
				}
			}
			if (runLen >= 5) penalty += 3 + (runLen - 5);
		}

		// N2: 2x2-Blöcke gleicher Farbe
		for (let r = 0; r < size - 1; r++) {
			for (let c = 0; c < size - 1; c++) {
				const color = masked[r][c];
				if (color === masked[r][c + 1] && color === masked[r + 1][c] && color === masked[r + 1][c + 1]) {
					penalty += 3;
				}
			}
		}

		// N4: Dunkel/Hell-Balance
		let darkCount = 0;
		for (let r = 0; r < size; r++) {
			for (let c = 0; c < size; c++) if (masked[r][c]) darkCount++;
		}
		const percent = (darkCount * 100) / (size * size);
		penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

		if (penalty < bestPenalty) {
			bestPenalty = penalty;
			bestMask = maskIdx;
			bestMatrix = masked;
		}
	}

	return { modules: bestMatrix, version, mask: bestMask };
}

/**
 * Erzeugt ein sauberes, standardkonformes SVG für einen QR-Code.
 * Beinhaltet 4 Module Quiet Zone (Ruhezone) für sofortige Kamera-Erkennung.
 */
export function generateQrSvg(text, size = 240) {
	const { modules } = createQrMatrix(String(text || ""));
	const moduleCount = modules.length;
	const margin = 4; // Standard Quiet Zone
	const totalGrid = moduleCount + margin * 2;

	let rects = "";
	for (let r = 0; r < moduleCount; r++) {
		for (let c = 0; c < moduleCount; c++) {
			if (modules[r][c]) {
				rects += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1"/>`;
			}
		}
	}

	return `<svg viewBox="0 0 ${totalGrid} ${totalGrid}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" style="display:block;margin:0 auto;background:#fff;border-radius:12px;box-sizing:border-box;"><g fill="#000">${rects}</g></svg>`;
}
