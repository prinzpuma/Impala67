import { PLATFORM_NATIVE } from "./platform-native.js";

/**
 * Extrahiert Cloudflare Worker URL und Sync-Schlüssel aus einem gescannten Text.
 * Unterstützt App-Kopplungs-URLs (#cf-pair=...), rohes JSON oder direkte Base64-Payloads.
 */
export function parseCfPairingData(scannedText) {
	if (!scannedText || typeof scannedText !== "string") return null;
	const text = scannedText.trim();

	// 1. URL oder Hash-Fragment mit #cf-pair=
	const hashIdx = text.indexOf("#cf-pair=");
	if (hashIdx !== -1) {
		const payload = text.slice(hashIdx + 9);
		try {
			const decoded = JSON.parse(decodeURIComponent(escape(atob(payload))));
			if (decoded?.url && decoded?.key) return { url: String(decoded.url).trim(), key: String(decoded.key).trim() };
		} catch {}
	}

	// 2. Rohes JSON-Objekt { url, key }
	if (text.startsWith("{") && text.endsWith("}")) {
		try {
			const parsed = JSON.parse(text);
			if (parsed?.url && parsed?.key) return { url: String(parsed.url).trim(), key: String(parsed.key).trim() };
		} catch {}
	}

	// 3. Direkter Base64-Payload
	try {
		const decoded = JSON.parse(decodeURIComponent(escape(atob(text))));
		if (decoded?.url && decoded?.key) return { url: String(decoded.url).trim(), key: String(decoded.key).trim() };
	} catch {}

	return null;
}

let jsqrLoadingPromise = null;
function loadJsQrFallback() {
	if (typeof window !== "undefined" && window.jsQR) return Promise.resolve(window.jsQR);
	if (jsqrLoadingPromise) return jsqrLoadingPromise;

	jsqrLoadingPromise = new Promise((resolve) => {
		const script = document.createElement("script");
		script.src = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js";
		script.async = true;
		script.onload = () => resolve(window.jsQR || null);
		script.onerror = () => {
			console.warn("[qr-scanner] jsQR-Fallback konnte nicht geladen werden.");
			resolve(null);
		};
		document.head.appendChild(script);
	});
	return jsqrLoadingPromise;
}

/**
 * Öffnet einen Kamera-Scanner-Dialog zum Scannen von Cloudflare-Kopplungscodes.
 * @param {Function} onResult - Callback mit { url, key }, wenn ein gültiger Code erkannt wurde.
 * @param {Function} onError - Optionaler Callback bei Fehlern/Abbruch.
 */
export async function openQrScanner(onResult, onError) {
	document.getElementById("qrScanModal")?.remove();

	let stream = null;
	let scanTimer = null;
	let closed = false;

	const modal = document.createElement("div");
	modal.id = "qrScanModal";
	modal.className = "exp-modal-backdrop";
	modal.style.cssText = "display:flex;align-items:center;justify-content:center;position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;padding:16px;";

	modal.innerHTML = `
		<div class="card" style="max-width:440px;width:100%;background:var(--bg-card, #1e1e2e);color:var(--text, #fff);padding:20px;border-radius:16px;box-shadow:0 12px 36px rgba(0,0,0,0.6);text-align:center;">
			<h3 style="margin-top:0;margin-bottom:8px;">📷 QR-Code scannen</h3>
			<p style="font-size:0.88rem;opacity:0.85;margin-bottom:14px;line-height:1.4;">Halte die Kamera auf den QR-Code des anderen Geräts.</p>
			
			<div style="position:relative;width:100%;max-width:320px;margin:0 auto 16px;border-radius:12px;overflow:hidden;background:#000;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;">
				<video id="qrScanVideo" playsinline muted autoplay style="width:100%;height:100%;object-fit:cover;"></video>
				<!-- Zielsucher-Rahmen -->
				<div style="position:absolute;inset:24px;border:2px solid rgba(255,255,255,0.4);border-radius:12px;pointer-events:none;box-shadow:0 0 0 9999px rgba(0,0,0,0.35);">
					<div style="position:absolute;top:-2px;left:-2px;width:20px;height:20px;border-top:3px solid var(--accent, #6366f1);border-left:3px solid var(--accent, #6366f1);border-top-left-radius:6px;"></div>
					<div style="position:absolute;top:-2px;right:-2px;width:20px;height:20px;border-top:3px solid var(--accent, #6366f1);border-right:3px solid var(--accent, #6366f1);border-top-right-radius:6px;"></div>
					<div style="position:absolute;bottom:-2px;left:-2px;width:20px;height:20px;border-bottom:3px solid var(--accent, #6366f1);border-left:3px solid var(--accent, #6366f1);border-bottom-left-radius:6px;"></div>
					<div style="position:absolute;bottom:-2px;right:-2px;width:20px;height:20px;border-bottom:3px solid var(--accent, #6366f1);border-right:3px solid var(--accent, #6366f1);border-bottom-right-radius:6px;"></div>
				</div>
				<div id="qrScanStatus" style="position:absolute;bottom:10px;left:10px;right:10px;background:rgba(0,0,0,0.6);font-size:0.75rem;padding:4px 8px;border-radius:6px;">Suche QR-Code…</div>
			</div>

			<input type="file" id="qrScanFileInput" accept="image/*" style="display:none;">
			<div style="display:flex;flex-direction:column;gap:8px;">
				<button type="button" id="btnQrScanFile" class="btn secondary" style="width:100%;">📁 QR-Code aus Foto/Screenshot lesen</button>
				<button type="button" id="btnQrScanClose" class="btn" style="width:100%;background:rgba(255,255,255,0.1);">Abbrechen</button>
			</div>
		</div>
	`;

	document.body.appendChild(modal);

	const video = modal.querySelector("#qrScanVideo");
	const statusEl = modal.querySelector("#qrScanStatus");
	const btnClose = modal.querySelector("#btnQrScanClose");
	const btnFile = modal.querySelector("#btnQrScanFile");
	const fileInput = modal.querySelector("#qrScanFileInput");

	function cleanup() {
		closed = true;
		if (scanTimer) {
			clearInterval(scanTimer);
			scanTimer = null;
		}
		if (stream) {
			try {
				stream.getTracks().forEach((t) => t.stop());
			} catch {}
			stream = null;
		}
		modal.remove();
	}

	btnClose.addEventListener("click", () => {
		cleanup();
		onError?.("Scan abgebrochen");
	});

	modal.addEventListener("click", (e) => {
		if (e.target.id === "qrScanModal") {
			cleanup();
			onError?.("Scan abgebrochen");
		}
	});

	let barcodeDetector = null;
	if (typeof window !== "undefined" && "BarcodeDetector" in window) {
		try {
			barcodeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
		} catch (e) {
			console.info("[qr-scanner] BarcodeDetector Initialisierung:", e);
		}
	}

	// Falls kein nativer BarcodeDetector vorhanden ist (z. B. älteres iOS Safari), jsQR vorladen
	if (!barcodeDetector) {
		loadJsQrFallback();
	}

	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d", { willReadFrequently: true });

	async function processDetectedString(rawText) {
		const parsed = parseCfPairingData(rawText);
		if (parsed) {
			if (PLATFORM_NATIVE?.haptics?.impact) {
				PLATFORM_NATIVE.haptics.impact("medium").catch(() => {});
			}
			cleanup();
			onResult(parsed);
			return true;
		}
		if (statusEl) statusEl.textContent = "Unbekannter QR-Code. Bitte Impala67-Code scannen.";
		return false;
	}

	async function scanVideoFrame() {
		if (closed || !video || video.readyState < video.HAVE_CURRENT_DATA) return;

		// 1. Nativer BarcodeDetector (Chrome, Android WebView, modern WebKit)
		if (barcodeDetector) {
			try {
				const codes = await barcodeDetector.detect(video);
				if (codes && codes.length > 0 && codes[0].rawValue) {
					const handled = await processDetectedString(codes[0].rawValue);
					if (handled) return;
				}
			} catch {}
		}

		// 2. jsQR Fallback
		if (window.jsQR && ctx) {
			const vw = video.videoWidth || 320;
			const vh = video.videoHeight || 320;
			// Maximale Scan-Auflösung auf 640px deckeln (spart Akku & CPU)
			const scale = Math.min(1, 640 / Math.max(vw, vh));
			const cw = Math.floor(vw * scale);
			const ch = Math.floor(vh * scale);
			if (canvas.width !== cw || canvas.height !== ch) {
				canvas.width = cw;
				canvas.height = ch;
			}
			ctx.drawImage(video, 0, 0, cw, ch);
			const imgData = ctx.getImageData(0, 0, cw, ch);
			const code = window.jsQR(imgData.data, imgData.width, imgData.height, {
				inversionAttempts: "dontInvert",
			});
			if (code && code.data) {
				const handled = await processDetectedString(code.data);
				if (handled) return;
			}
		}
	}

	// Kamera starten
	try {
		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			throw new Error("getUserMedia nicht unterstützt");
		}
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
				audio: false,
			});
		} catch (cameraError) {
			stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
		}

		if (closed) {
			stream.getTracks().forEach((t) => t.stop());
			return;
		}

		video.srcObject = stream;
		video.setAttribute("playsinline", "");
		await video.play();

		// Scanner-Intervall alle 180ms (ausreichend schnell, akkuschonend)
		scanTimer = setInterval(scanVideoFrame, 180);
	} catch (err) {
		console.warn("[qr-scanner] Kamera-Fehler:", err);
		if (statusEl) statusEl.textContent = "Kamera nicht verfügbar. Bitte Foto wählen.";
	}

	// Datei-Upload Fallback
	btnFile.addEventListener("click", () => fileInput.click());
	fileInput.addEventListener("change", async (e) => {
		const file = e.target.files?.[0];
		if (!file) return;

		if (statusEl) statusEl.textContent = "Analysiere Bild…";
		try {
			const img = new Image();
			const url = URL.createObjectURL(file);
			img.onload = async () => {
				URL.revokeObjectURL(url);
				// BarcodeDetector prüfen
				if (barcodeDetector) {
					try {
						const codes = await barcodeDetector.detect(img);
						if (codes && codes.length > 0 && codes[0].rawValue) {
							if (await processDetectedString(codes[0].rawValue)) return;
						}
					} catch {}
				}
				// jsQR Fallback
				const jsqr = await loadJsQrFallback();
				if (jsqr && ctx) {
					canvas.width = img.naturalWidth || img.width;
					canvas.height = img.naturalHeight || img.height;
					ctx.drawImage(img, 0, 0);
					const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
					const code = jsqr(imgData.data, imgData.width, imgData.height);
					if (code && code.data) {
						if (await processDetectedString(code.data)) return;
					}
				}
				if (statusEl) statusEl.textContent = "Kein QR-Code im Bild gefunden.";
			};
			img.src = url;
		} catch (imgErr) {
			console.warn("[qr-scanner] Bild-Scan Fehler:", imgErr);
			if (statusEl) statusEl.textContent = "Fehler beim Lesen des Bildes.";
		}
	});
}
