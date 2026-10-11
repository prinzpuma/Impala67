"use strict";
// Scanner-Oberfläche des Hefts: Kamera mit Live-Prüfung und Auto-Scan, Aufnahmeleiste mit
// Hintergrund-Warteschlange, Nachbearbeitung (Ecken, Filter, Drehen) und Abschluss als PDF oder Heftseiten.
// Bildverarbeitung: heft-scan.js (SCANCORE, läuft im Web-Worker). Auf Android zuerst der Google-Scanner.
import { U } from "./util.js";
import { PLATFORM_NATIVE } from "./platform-native.js";
import { SCANCORE } from "./heft-scan.js";
import { SCAN_OUT_MAX_EDGE, SCAN_JPEG_QUALITY } from "./heft-scan-pixels.js";
import { buildPdf } from "./heft-export.js";

const { SCAN_MODES, loadImg, quadArea, isConvex, detectQuadAsync, liveCheck, processShot, blobToDataUrl } = SCANCORE;

// Kappe für das Videobild, falls ImageCapture fehlt (sonst volle Sensorauflösung per takePhoto).
const CAPTURE_MAX_DIM = 4096;

// Bild wieder freigeben, sofern es nicht die Quelle selbst ist (Bitmaps haben close()).
function releaseImg(img, src) {
	if (img && img !== src && typeof img.close === "function") { try { img.close(); } catch {  } }
}
function stopStream(stream) {
	try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch {  }
}
function qualityNote(q) {
	if (!q) return "";
	if (q.soft) return "Weich";
	if (q.tooDark) return "Dunkel";
	if (q.glare) return "Spiegelung";
	if (q.flat) return "Kontrast";
	return "";
}
// buildPdf erwartet JPEG-Data-URLs (DCTDecode). Andere Formate werden auf Weiß nach JPEG gewandelt.
async function toJpegDataUrl(blob) {
	const img = await loadImg(blob);
	try {
		const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
		const c = document.createElement("canvas");
		c.width = w; c.height = h;
		const x = c.getContext("2d");
		x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
		x.drawImage(img, 0, 0, w, h);
		return c.toDataURL("image/jpeg", 0.92);
	} finally { releaseImg(img, blob); }
}

// host: insertPages([{ src, w, h, scan }]), pickFiles(opts, cb), fileToImageData(file, maxDim, mime)
export function createScanner(host) {
	let scanUI = null;
	let editCommitT = 0;

	async function openScanner() {
		if (scanUI) return;

		if (PLATFORM_NATIVE.scanner.isEnabled()) {
			try {
				const res = await PLATFORM_NATIVE.scanner.scan({ pageLimit: 25 });
				if (res?.images?.length) {
					// Als Bilddaten übernehmen: die Cache-Datei des Scanners ist vergänglich und nicht synchronisierbar.
					const images = [];
					for (const uri of res.images) {
						const src = window.Capacitor?.convertFileSrc ? window.Capacitor.convertFileSrc(uri) : uri;
						const im = await host.fileToImageData(await (await fetch(src)).blob(), SCAN_OUT_MAX_EDGE, "image/jpeg", SCAN_JPEG_QUALITY);
						images.push({ ...im, scan: true });
					}
					host.insertPages(images);
					return;
				}
				if (res?.canceled) {
					return;
				}
				if (res?.error) {
					U.toast?.("Google-Scanner nicht verfügbar – nutze internen Scanner.", "info");
				}
			} catch (err) {
				console.warn("[heft] Native scanner error, falling back to internal scanner:", err);
				U.toast?.("Google-Scanner fehlgeschlagen – nutze internen Scanner.", "info");
			}
			// Fallback: Bei Fehlern oder fehlendem ML Kit startet automatisch der interne Kamera-Scanner.
		}

		const filters = SCAN_MODES.map((m) =>
			'<button type="button" data-hescanfilter="' + m[0] + '" aria-pressed="' + (m[0] === "color" ? "true" : "false") + '"' + (m[0] === "color" ? ' class="active"' : "") + ">" + m[1] + "</button>").join("");
		const wrap = document.createElement("div");
		wrap.className = "heft-scan";
		wrap.innerHTML =
			'<div class="heft-scan-top"><b>Dateien scannen</b><button type="button" data-hescanclose="1" title="Schließen" aria-label="Schließen">✕</button></div>' +
			'<div class="heft-scan-stage"><video autoplay playsinline muted></video>' +
				'<svg class="heft-scan-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="7,7 93,7 93,93 7,93"></polygon></svg>' +
				'<div class="heft-scan-quality" data-hescanquality="1" role="status" aria-live="polite">Kamera wird geprüft…</div>' +
				'<div class="heft-scan-flash" aria-hidden="true"></div>' +
				'<div class="heft-scan-hint">Blatt vollständig ins Bild legen. Grün = bereit; der Rahmen zeigt exakt den späteren Zuschnitt.</div></div>' +
			'<div class="heft-scan-shots"></div>' +
			'<div class="heft-scan-modes" role="group" aria-label="Filter für neue und vorhandene Seiten">' + filters + '</div>' +
			'<div class="heft-scan-bar">' +
				'<div class="heft-scan-tools">' +
					'<button type="button" data-hescanautocap="1" aria-pressed="false" title="Auto-Scan aktivieren">⚡ Auto aus</button>' +
					'<button type="button" data-hescantorch="1" aria-pressed="false" title="Taschenlampe" hidden>🔦 Licht</button>' +
				'</div>' +
				'<button type="button" class="heft-scan-shutter" data-hescanshot="1" title="Seite aufnehmen" aria-label="Seite aufnehmen" disabled></button>' +
				'<div class="heft-scan-actions">' +
					'<button type="button" data-hescanpdf="1" disabled>📄 Als PDF speichern</button>' +
					'<button type="button" data-hescanheft="1" disabled>📓 In Heft einfügen</button>' +
				'</div>' +
			'</div>' +
			'<div class="heft-scan-busy" hidden><span>Seiten werden vorbereitet…</span></div>';
		document.body.appendChild(wrap);
		scanUI = { wrap, stream: null, track: null, torch: false, shots: [], stripCount: 0, edit: null, mode: "color", busy: false, exporting: false, pending: 0, queue: Promise.resolve(), liveTimer: 0, liveStable: 0, liveMissing: 0, liveHistory: [], autoCapture: false, autoArmed: false, autoCooldown: 0 };
		const ui = scanUI;
		wrap.addEventListener("click", onScanClick);
		try {
			if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("getUserMedia fehlt");

			const stream = await acquireStream();
			if (scanUI !== ui || !wrap.isConnected) { stopStream(stream); return; }
			ui.stream = stream;
			const video = wrap.querySelector("video");
			video.srcObject = stream;
			video.muted = true;
			video.setAttribute("playsinline", "");
			refreshShutter(ui);

			try { await video.play(); } catch (e2) { console.warn("Heft: Video-play blockiert", e2); }
			startLiveQuality(video, ui);
			const track = stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
			if (track) {
				ui.track = track;
				await setupTrack(ui, track);
				track.addEventListener("ended", () => showCameraStopped(ui), { once: true });
			}
			video.addEventListener("error", () => showCameraStopped(ui), { once: true });
		} catch (e) {
			console.warn("Heft: Kamera nicht verfügbar", e);
			if (scanUI === ui) {
				wrap.querySelector(".heft-scan-stage").innerHTML =
					'<div class="heft-scan-nocam"><p>Keine Kamera verfügbar oder Zugriff abgelehnt.</p>' +
					'<button type="button" data-hescanpick="1">Fotos auswählen…</button></div>';
				refreshShutter(ui);
			}
		}
	}

	// Erst hohe Auflösung wünschen, dann auf kleinere Profile und zuletzt auf beliebige Kamera zurückfallen.
	async function acquireStream() {
		const attempts = [
			{ facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
			{ facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
			true,
		];
		let lastError = null;
		for (const video of attempts) {
			try {
				return await navigator.mediaDevices.getUserMedia({ video, audio: false });
			} catch (err) {
				lastError = err;
				const name = err && err.name;
				if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError" && name !== "NotFoundError") throw err;
			}
		}
		throw lastError;
	}

	async function setupTrack(owner, track) {
		let caps = null;
		try { caps = track.getCapabilities ? track.getCapabilities() : null; } catch { caps = null; }
		const advanced = {};
		if (caps && Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) advanced.focusMode = "continuous";
		if (caps && Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) advanced.exposureMode = "continuous";
		try {
			if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] });
		} catch (constraintError) { console.info("Heft: Kamera-Automatik bleibt auf Gerätestandard", constraintError); }
		if (caps && caps.torch) {
			const b = owner.wrap.querySelector("[data-hescantorch]");
			if (b) b.hidden = false;
		}
	}

	async function toggleTorch(owner, b) {
		if (!owner.track) return;
		const on = !owner.torch;
		try {
			await owner.track.applyConstraints({ advanced: [{ torch: on }] });
			owner.torch = on;
			b.classList.toggle("active", on);
			b.setAttribute("aria-pressed", String(on));
		} catch (e) {
			console.warn("Heft: Taschenlampe nicht verfügbar", e);
			U.toast?.("Taschenlampe ist auf diesem Gerät nicht verfügbar", "error");
		}
	}

	// Auslöser nur während des Bildgreifens und ohne Kamera gesperrt — nie durch Aufbereitung oder Export.
	function refreshShutter(owner) {
		const shut = owner.wrap.querySelector(".heft-scan-shutter");
		if (shut) shut.disabled = owner.busy || !owner.stream;
	}

	function showCameraStopped(owner) {
		if (!owner || scanUI !== owner || !owner.wrap.isConnected) return;
		stopLiveQuality();
		stopStream(owner.stream);
		owner.stream = null;
		owner.track = null;
		owner.torch = false;
		const stage = owner.wrap.querySelector(".heft-scan-stage");
		if (stage) stage.innerHTML = '<div class="heft-scan-nocam"><p>Kameraverbindung wurde unterbrochen.</p><button type="button" data-hescanpick="1">Fotos auswählen…</button><small>Bereits aufgenommene Scans bleiben erhalten.</small></div>';
		const tb = owner.wrap.querySelector("[data-hescantorch]");
		if (tb) tb.hidden = true;
		refreshShutter(owner);
		U.toast?.("Kamera wurde beendet — du kannst Fotos auswählen.", "error");
	}

	function closeScanner() {
		const owner = scanUI;
		if (!owner) return;
		closeEdit();
		stopLiveQuality();
		stopStream(owner.stream);
		owner.shots.forEach(revokeThumb);
		try { owner.wrap.remove(); } catch {  }
		scanUI = null;
	}

	function quadDelta(a, b) {
		if (!a || !b || a.length !== 4 || b.length !== 4) return Infinity;
		let sum = 0;
		for (let i = 0; i < 4; i++) sum += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
		return sum / 4;
	}
	function stabilizeLiveInfo(info, owner) {
		if (!info.found) { owner.liveHistory = []; return info; }
		const last = owner.liveHistory && owner.liveHistory[owner.liveHistory.length - 1];
		const jump = last ? quadDelta(info.quad, last.quad) : 0;

		if (jump > Math.max(info.sw, info.sh) * 0.14) owner.liveHistory = [];
		const entry = { quad: info.quad.map((p) => p.slice()), mean: info.mean, sharp: info.sharp, contrast: info.contrast };
		(owner.liveHistory || (owner.liveHistory = [])).push(entry);
		if (owner.liveHistory.length > 5) owner.liveHistory.shift();
		const hist = owner.liveHistory;
		const median = (values) => { const s = values.slice().sort((a, b) => a - b); return s[(s.length / 2) | 0]; };

		const quad = info.quad.map((_, i) => [median(hist.map((f) => f.quad[i][0])), median(hist.map((f) => f.quad[i][1]))]);
		let spread = 0;
		for (const frame of hist) spread = Math.max(spread, quadDelta(frame.quad, quad));
		return { ...info, quad, jitter: spread, stable: hist.length >= 3 && spread < Math.max(info.sw, info.sh) * 0.035 };
	}
	function setLiveGuide(info, video) {
		if (!scanUI) return;
		const stage = scanUI.wrap.querySelector(".heft-scan-stage");
		const guide = scanUI.wrap.querySelector(".heft-scan-guide polygon");
		const label = scanUI.wrap.querySelector("[data-hescanquality]");
		if (!stage || !guide || !label || !video) return;

		const sr = stage.getBoundingClientRect(), vr = video.getBoundingClientRect();
		const left = (vr.left - sr.left) / Math.max(1, sr.width) * 100;
		const top = (vr.top - sr.top) / Math.max(1, sr.height) * 100;
		const width = vr.width / Math.max(1, sr.width) * 100;
		const height = vr.height / Math.max(1, sr.height) * 100;
		const toPct = (p) => (left + p[0] / info.sw * width).toFixed(1) + "," + (top + p[1] / info.sh * height).toFixed(1);
		guide.setAttribute("points", info.quad.map(toPct).join(" "));
		const lightOK = info.mean >= 62 && info.mean <= 235;
		const sharpOK = info.sharp >= 8;
		const contrastOK = info.contrast >= 16;
		const framingOK = info.area >= 0.12 && info.area <= 0.90 && info.margin >= 2;
		const ready = info.found && lightOK && sharpOK && contrastOK && framingOK;
		const stableReady = ready && info.stable;
		guide.parentElement.classList.toggle("ready", stableReady);
		guide.parentElement.classList.toggle("warn", !stableReady);
		if (stableReady) label.textContent = "✓ Dokument stabil erkannt · bereit";
		else if (!info.found) label.textContent = "Blatt vollständig ins Bild legen";
		else if (!framingOK) label.textContent = "Blattrand vollständig sichtbar halten";
		else if (!sharpOK) label.textContent = "Kamera ruhiger halten";
		else if (!lightOK) label.textContent = info.mean < 62 ? "Mehr Licht nötig" : "Zu hell / Spiegelung vermeiden";
		else if (!contrastOK) label.textContent = "Kontrast zu gering";
		else label.textContent = "Dokument wird stabilisiert…";
		return stableReady;
	}
	function startLiveQuality(video, owner) {
		if (!owner || scanUI !== owner) return;
		stopLiveQuality();
		// Die Erkennung läuft im Worker. Während eine Prüfung läuft, wird der 340-ms-Takt
		// übersprungen; Ergebnisse nach Schließen/Wechsel des Scanners werden verworfen.
		const check = async () => {
			if (scanUI !== owner || owner.busy || owner.liveBusy || !video.videoWidth || !video.isConnected) return;
			owner.liveBusy = true;
			try {
				const frame = await liveCheck(video);
				if (scanUI !== owner || owner.busy) return;
				const info = stabilizeLiveInfo(frame, owner);
				const ready = setLiveGuide(info, video);
				if (!ready) {
					owner.liveStable = 0;

					owner.liveMissing = info.found ? 0 : owner.liveMissing + 1;
					if (owner.liveMissing >= 3) owner.autoArmed = true;
					return;
				}
				owner.liveMissing = 0;
				owner.liveStable++;

				if (owner.autoCapture && owner.autoArmed && owner.liveStable >= 5 && Date.now() > owner.autoCooldown) {
					owner.autoArmed = false;
					owner.liveStable = 0;
					owner.autoCooldown = Date.now() + 1800;
					scanCapture(true);
				}
			} catch (e) { console.warn("Heft: Live-Scan-Prüfung fehlgeschlagen", e); }
			finally { owner.liveBusy = false; }
		};
		check();
		owner.liveTimer = setInterval(check, 340);
	}
	function stopLiveQuality() {
		if (scanUI && scanUI.liveTimer) { clearInterval(scanUI.liveTimer); scanUI.liveTimer = 0; }
	}
	// Overlay nur noch für Abschluss und Export; die Aufbereitung läuft im Hintergrund.
	function setScanBusy(on, label) {
		if (!scanUI) return;
		const el = scanUI.wrap.querySelector(".heft-scan-busy");
		if (!el) return;
		el.hidden = !on;
		const sp = el.querySelector("span");
		if (sp && label) sp.textContent = label;
	}
	function flashShot(owner) {
		const flash = owner.wrap.querySelector(".heft-scan-flash");
		if (flash) { flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go"); }
		navigator.vibrate?.(15);
	}

	function onScanClick(e) {
		const b = e.target.closest("button");
		const owner = scanUI;
		if (!b || !owner) return;
		const d = b.dataset;
		if (d.hescanclose) closeScanner();
		else if (d.hescanshot) scanCapture();
		else if (d.hescanpdf) scanFinishPdf();
		else if (d.hescanheft) scanFinishHeft();
		else if (d.hescanautocap) toggleAutoCapture(owner, b);
		else if (d.hescantorch) toggleTorch(owner, b);
		else if (d.hescanfilter) setGlobalMode(owner, d.hescanfilter);
		else if (d.hescanpick) scanPickFiles();
		else if (d.hescandelshot) removeShot(owner, owner.shots[Number(d.hescandelshot)]);
		else if (d.hescanedit != null) openEdit(Number(d.hescanedit));
		else if (d.hescaneditback) closeEdit();
		else if (d.hescancompare) {
			const ed = curEdit();
			if (ed) {
				ed.compare = !ed.compare;
				b.textContent = ed.compare ? "◐ Nur Scan" : "◑ Vorher/Nachher";
				if (!ed.cornerMode && ed.sh.out) drawEditResult(ed.sh);
			}
		}
		else if (d.hescancorners) {
			const ed = curEdit();
			if (ed && ed.img) { ed.cornerMode = true; layoutEdit(); }
			else U.toast?.("Rohbild wird geladen…");
		}
		else if (d.hescanmode) {
			const ed = curEdit();
			if (ed) {
				ed.mode = d.hescanmode;
				ed.el.querySelectorAll("[data-hescanmode]").forEach((m) => m.classList.toggle("active", m.dataset.hescanmode === ed.mode));
				queueEditReprocess();
			}
		}
		else if (d.hescanrot) {
			const ed = curEdit();
			if (ed) {
				ed.rot = (ed.rot + 1) % 4;
				const rb = ed.el.querySelector("[data-hescanrot]");
				if (rb) rb.textContent = "⟳ Drehen" + (ed.rot ? " (" + (ed.rot * 90) + "°)" : "");
				queueEditReprocess();
			}
		}
		else if (d.hescandel) {
			const ed = curEdit();
			if (ed) { const sh = ed.sh; closeEdit(); removeShot(owner, sh); }
		}
		else if (d.hescandone) finishEdit();
	}
	function toggleAutoCapture(owner, b) {
		owner.autoCapture = !owner.autoCapture;
		if (owner.autoCapture) { owner.autoArmed = true; owner.liveStable = 0; }
		else owner.autoArmed = false;
		b.classList.toggle("active", owner.autoCapture);
		b.setAttribute("aria-pressed", String(owner.autoCapture));
		b.textContent = owner.autoCapture ? "⚡ Auto an" : "⚡ Auto aus";
	}

	async function scanCapture(isAuto = false) {
		const owner = scanUI;
		if (!owner || owner.busy) return;

		if (!isAuto) { owner.autoArmed = false; owner.liveStable = 0; owner.autoCooldown = Date.now() + 1800; }
		const video = owner.wrap.querySelector("video");
		if (!video) return;

		owner.busy = true;
		refreshShutter(owner);
		let src = null;
		try {
			if (!video.videoWidth) { try { await video.play(); } catch {  } }
			if (scanUI !== owner) return;
			if (!video.videoWidth) { U.toast?.("Kamera startet noch — kurz warten und erneut tippen", "error"); return; }
			src = await grabFrame(owner, video);
		} catch (e) {
			console.warn("Heft: Aufnahme fehlgeschlagen", e);
			U.toast?.("Scan fehlgeschlagen", "error");
		} finally {
			if (scanUI === owner) { owner.busy = false; refreshShutter(owner); }
		}
		if (!src || scanUI !== owner) return;
		flashShot(owner);
		queueShot(owner, src);
	}
	// Volle Sensorauflösung per ImageCapture; sonst (oder bei Fehler) das Videobild als Canvas.
	async function grabFrame(owner, video) {
		if (owner.track && "ImageCapture" in window) {
			try { return await new window.ImageCapture(owner.track).takePhoto(); }
			catch (e) { console.info("Heft: ImageCapture nicht nutzbar, nehme Videobild", e); }
		}
		const k = Math.min(1, CAPTURE_MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
		const c = document.createElement("canvas");
		c.width = Math.max(2, Math.round(video.videoWidth * k));
		c.height = Math.max(2, Math.round(video.videoHeight * k));
		const x = c.getContext("2d");
		x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
		x.drawImage(video, 0, 0, c.width, c.height);
		return c;
	}

	// ---- Warteschlange: Seiten werden nacheinander aufbereitet, die Oberfläche bleibt bedienbar.
	function enqueue(owner, task) {
		owner.pending++;
		owner.queue = owner.queue.then(async () => {
			try { if (scanUI === owner) await task(); }
			catch (e) { console.warn("Heft: Scan-Warteschlange", e); }
			finally {
				owner.pending--;
				if (scanUI === owner) renderShots();
			}
		});
		renderShots();
		return owner.queue;
	}
	async function waitQueueIdle(owner) {
		while (scanUI === owner && owner.pending > 0) await owner.queue;
	}
	function isLive(owner, sh) {
		return scanUI === owner && owner.shots.includes(sh);
	}
	// Seite aufbereiten. rev verwirft Ergebnisse, die von einer neueren Aufbereitung überholt wurden.
	function queueProcess(owner, sh, snapshot, onDone) {
		const rev = ++sh.rev;
		enqueue(owner, async () => {
			if (!isLive(owner, sh)) return;
			try {
				if (!sh.quad) await detectShot(sh);
				const out = snapshot ? await processShot(sh, snapshot) : await processShot(sh);
				if (!isLive(owner, sh) || sh.rev !== rev) return;
				sh.out = out;
				sh.failed = false;
				setThumb(sh, out);
				if (onDone) onDone();
			} catch (e) {
				console.warn("Heft: Scan-Aufbereitung fehlgeschlagen", e);
				if (isLive(owner, sh) && sh.rev === rev) {
					sh.failed = true;
					U.toast?.("Eine Seite konnte nicht aufbereitet werden", "error");
				}
			}
		});
	}
	// Ausgangsbild lesen, Größe und Eckenvorschlag ermitteln (nur beim ersten Durchlauf einer Seite).
	async function detectShot(sh) {
		const img = await loadImg(sh.src);
		try {
			const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
			// Erkennung im Worker, damit das Hinzufügen einer Aufnahme die Bedienung nicht blockiert
			const quad = await detectQuadAsync(img, w, h);
			sh.w = w; sh.h = h; sh.quad = quad;
			sh.autoCrop = quadArea(quad) < w * h * 0.96;
		} finally { releaseImg(img, sh.src); }
	}
	function queueShot(owner, src) {
		const sh = { src, w: 0, h: 0, quad: null, autoCrop: true, mode: owner.mode, rot: 0, out: null, thumbUrl: "", rev: 0, failed: false };
		owner.shots.push(sh);
		queueProcess(owner, sh, null);
	}
	function setGlobalMode(owner, mode) {
		if (!SCAN_MODES.some((m) => m[0] === mode)) return;
		owner.mode = mode;
		owner.wrap.querySelectorAll("[data-hescanfilter]").forEach((b) => {
			const on = b.dataset.hescanfilter === mode;
			b.classList.toggle("active", on);
			b.setAttribute("aria-pressed", String(on));
		});
		for (const sh of owner.shots) {
			if (sh.mode === mode) continue;
			sh.mode = mode;
			queueProcess(owner, sh, null);
		}
	}
	function removeShot(owner, sh) {
		const idx = sh ? owner.shots.indexOf(sh) : -1;
		if (idx < 0) return;
		owner.shots.splice(idx, 1);
		sh.rev++; // laufende Aufbereitung dieser Seite verwerfen
		revokeThumb(sh);
		renderShots();
		U.toast?.("Seite " + (idx + 1) + " gelöscht");
	}

	// ---- Thumbnails: ObjectURLs nur für fertige Scans, beim Ersetzen, Löschen und Schließen freigegeben.
	function revokeThumb(sh) {
		if (sh.thumbUrl) { try { URL.revokeObjectURL(sh.thumbUrl); } catch {  } sh.thumbUrl = ""; }
	}
	function setThumb(sh, out) {
		revokeThumb(sh);
		sh.thumbUrl = URL.createObjectURL(out.blob);
	}
	function shotTileHtml(sh, i) {
		const n = i + 1;
		const hasThumb = !!sh.thumbUrl;
		let note = "";
		if (sh.failed) note = "Fehler";
		else if (hasThumb) note = !sh.autoCrop ? "Vollbild" : qualityNote(sh.out && sh.out.quality);
		const inner = hasThumb ? '<img src="' + sh.thumbUrl + '" alt="Seite ' + n + '">'
			: (sh.failed ? '<b class="heft-scan-failmark" aria-hidden="true">!</b>' : '<i class="heft-scan-spin" aria-hidden="true"></i>');
		const cls = "heft-scan-shot" + (hasThumb || sh.failed ? "" : " pending") + (sh.failed ? " failed" : "");
		return '<div class="heft-scan-tile">' +
			'<button type="button" class="' + cls + '" data-hescanedit="' + i + '" title="Seite ' + n + ' bearbeiten" aria-label="Seite ' + n + ' bearbeiten">' + inner +
				'<span>' + n + '</span>' + (note ? '<small>' + note + '</small>' : "") + '</button>' +
			'<button type="button" class="heft-scan-x" data-hescandelshot="' + i + '" title="Seite ' + n + ' löschen" aria-label="Seite ' + n + ' löschen">×</button>' +
		'</div>';
	}
	function renderShots() {
		const owner = scanUI;
		if (!owner) return;
		const strip = owner.wrap.querySelector(".heft-scan-shots");
		if (strip) {
			const grew = owner.shots.length > owner.stripCount;
			owner.stripCount = owner.shots.length;
			strip.innerHTML = owner.shots.map(shotTileHtml).join("");
			if (grew) strip.scrollLeft = strip.scrollWidth;
		}
		const n = owner.shots.filter((sh) => sh.out).length;
		const enabled = n > 0 || owner.pending > 0;
		const pdfBtn = owner.wrap.querySelector("[data-hescanpdf]");
		const heftBtn = owner.wrap.querySelector("[data-hescanheft]");
		if (pdfBtn) { pdfBtn.disabled = !enabled; pdfBtn.textContent = "📄 Als PDF speichern" + (n ? " (" + n + ")" : ""); }
		if (heftBtn) { heftBtn.disabled = !enabled; heftBtn.textContent = "📓 In Heft einfügen" + (n ? " (" + n + ")" : ""); }
	}
	function scanPickFiles() {
		const owner = scanUI;
		if (!owner) return;
		host.pickFiles({ multiple: true, capture: true }, async (files) => {
			for (const f of files) {
				if (scanUI !== owner) return;
				try {
					const im = await host.fileToImageData(f, 2400, "image/png");
					if (scanUI !== owner) return;
					queueShot(owner, im.src);
				} catch (e) {
					console.warn("Heft: Scan-Foto fehlgeschlagen", e);
					U.toast?.("Foto konnte nicht gelesen werden", "error");
				}
			}
		});
	}

	// ---- Nachbearbeitung
	const curEdit = () => (scanUI && scanUI.edit) || null;

	function fitStageScale(el, contentW, contentH) {
		const stageW = el.clientWidth || window.innerWidth;
		const stageH = el.clientHeight || Math.max(180, window.innerHeight - 170);
		return Math.max(0.02, Math.min((stageW - 24) / contentW, (stageH - 24) / contentH));
	}

	function queueCornerReprocess() {
		clearTimeout(editCommitT);
		editCommitT = setTimeout(() => { editCommitT = 0; queueEditReprocess(); }, 160);
	}
	function syncShotWithEdit(sh, ed) {
		sh.quad = ed.quad.map((p) => p.slice());
		sh.mode = ed.mode;
		sh.rot = ed.rot;
		sh.autoCrop = quadArea(sh.quad) < sh.w * sh.h * 0.96;
		return { quad: sh.quad.map((p) => p.slice()), mode: sh.mode, rot: sh.rot, commit: false };
	}
	function queueEditReprocess() {
		const owner = scanUI, ed = curEdit();
		if (!owner || !ed) return;
		const sh = ed.sh;
		const snapshot = syncShotWithEdit(sh, ed);
		ed.dirty = false;
		queueProcess(owner, sh, snapshot, () => {
			if (curEdit() === ed && !ed.cornerMode && sh.out) drawEditResult(sh);
		});
	}

	function drawEditResult(sh) {
		const ed = curEdit();
		if (!ed || ed.sh !== sh || !sh.out) return;
		const stage = ed.el.querySelector(".heft-scan-editstage");
		const cv = ed.el.querySelector("canvas");
		if (!stage || !cv) return;
		createImageBitmap(sh.out.blob).then((bmp) => {
			if (curEdit() !== ed) { bmp.close(); return; }
			const k = fitStageScale(stage, bmp.width, bmp.height);
			cv.width = Math.max(1, Math.round(bmp.width * k));
			cv.height = Math.max(1, Math.round(bmp.height * k));
			const x = cv.getContext("2d");
			x.clearRect(0, 0, cv.width, cv.height);
			if (ed.compare && ed.img) {
				const half = cv.width / 2;
				x.drawImage(ed.img, 0, 0, half, cv.height);
				x.drawImage(bmp, half, 0, half, cv.height);
				x.fillStyle = "rgba(3,5,10,.7)";
				x.fillRect(0, 0, half, 21); x.fillRect(half, 0, half, 21);
				x.strokeStyle = "rgba(255,255,255,.8)"; x.lineWidth = 2;
				x.beginPath(); x.moveTo(half, 0); x.lineTo(half, cv.height); x.stroke();
				x.fillStyle = "#fff"; x.font = "600 11px -apple-system,sans-serif"; x.textAlign = "center";
				x.fillText("VORHER", half / 2, 14); x.fillText("AUFBEREITET", half + half / 2, 14);
			} else {
				x.drawImage(bmp, 0, 0, cv.width, cv.height);
			}
			x.fillStyle = "rgba(3,5,10,0.55)";
			x.fillRect(0, cv.height - 22, cv.width, 22);
			x.fillStyle = "rgba(255,255,255,0.88)";
			x.font = "11px -apple-system,sans-serif";
			x.textAlign = "center";
			x.fillText(ed.compare ? "Links Rohfoto · rechts entzerrter und aufbereiteter Scan" : "Aufbereitet · Ecken anpassen für manuellen Zuschnitt", cv.width / 2, cv.height - 7);
			bmp.close();
		}).catch((e) => console.warn("Heft: Vorschau laden fehlgeschlagen", e));
	}
	function openEdit(i) {
		const owner = scanUI;
		const sh = owner && owner.shots[i];
		if (!sh) return;
		if (!sh.quad) { U.toast?.("Seite wird noch aufbereitet…"); return; }
		closeEdit();
		const ed = document.createElement("div");
		ed.className = "heft-scan-edit";
		ed.innerHTML =
			'<div class="heft-scan-top"><b>Scan ' + (i + 1) + ' bearbeiten</b><button type="button" data-hescaneditback="1" title="Zurück" aria-label="Zurück">✕</button></div>' +
			'<div class="heft-scan-editstage"><canvas></canvas></div>' +
			'<div class="heft-scan-modes">' + SCAN_MODES.map((m) =>
				'<button type="button" data-hescanmode="' + m[0] + '" class="' + (sh.mode === m[0] ? "active" : "") + '">' + m[1] + '</button>').join("") + '</div>' +
			'<div class="heft-scan-editbar">' +
				'<button type="button" data-hescancompare="1">◑ Vorher/Nachher</button>' +
				'<button type="button" data-hescancorners="1">⌜ Ecken anpassen</button>' +
				'<button type="button" data-hescanrot="1">⟳ Drehen' + (sh.rot ? " (" + (sh.rot * 90) + "°)" : "") + '</button>' +
				'<button type="button" data-hescandel="1">🗑 Löschen</button>' +
				'<button type="button" class="heft-scan-apply" data-hescandone="1">✓ Fertig</button>' +
			'</div>';
		owner.wrap.appendChild(ed);

		const state = { sh, el: ed, quad: sh.quad.map((p) => p.slice()), mode: sh.mode || "color", rot: sh.rot || 0, img: null, drag: -1, k: 1, cornerMode: false, compare: false, dirty: false };
		owner.edit = state;
		const cv = ed.querySelector("canvas");
		cv.addEventListener("pointerdown", onEditDown);
		cv.addEventListener("pointermove", onEditMove);
		cv.addEventListener("pointerup", onEditUp);
		cv.addEventListener("pointercancel", onEditUp);

		if (sh.out) drawEditResult(sh);
		loadImg(sh.src).then((img) => {
			if (curEdit() !== state) { releaseImg(img, sh.src); return; }
			state.img = img;
			if (sh.out) drawEditResult(sh);
			else layoutEdit();
		}).catch((e) => console.warn("Heft: Rohbild laden fehlgeschlagen", e));
	}
	function closeEdit() {
		clearTimeout(editCommitT); editCommitT = 0;
		const ed = curEdit();
		if (!ed) return;
		releaseImg(ed.img, ed.sh.src);
		ed.el.remove();
		scanUI.edit = null;
	}
	function layoutEdit() {
		const ed = curEdit();
		if (!ed || !ed.img) return;
		const stage = ed.el.querySelector(".heft-scan-editstage");
		const cv = ed.el.querySelector("canvas");
		ed.k = fitStageScale(stage, ed.sh.w, ed.sh.h);
		cv.width = Math.max(1, Math.round(ed.sh.w * ed.k));
		cv.height = Math.max(1, Math.round(ed.sh.h * ed.k));
		drawEdit();
	}
	function drawEdit() {
		const ed = curEdit();
		if (!ed || !ed.img) return;
		const cv = ed.el.querySelector("canvas");
		const x = cv.getContext("2d");
		const k = ed.k, q = ed.quad;
		x.clearRect(0, 0, cv.width, cv.height);
		x.drawImage(ed.img, 0, 0, cv.width, cv.height);

		x.save();
		x.fillStyle = "rgba(3,5,10,0.55)";
		x.beginPath();
		x.rect(0, 0, cv.width, cv.height);
		x.moveTo(q[0][0] * k, q[0][1] * k);
		for (let i = 3; i >= 1; i--) x.lineTo(q[i][0] * k, q[i][1] * k);
		x.closePath();
		x.fill("evenodd");
		x.restore();

		x.strokeStyle = "#6fc3ff"; x.lineWidth = 2;
		x.beginPath();
		x.moveTo(q[0][0] * k, q[0][1] * k);
		for (let i = 1; i < 4; i++) x.lineTo(q[i][0] * k, q[i][1] * k);
		x.closePath();
		x.stroke();
		q.forEach((p) => {
			x.beginPath(); x.arc(p[0] * k, p[1] * k, 10, 0, Math.PI * 2);
			x.fillStyle = "rgba(111,195,255,0.25)"; x.fill();
			x.beginPath(); x.arc(p[0] * k, p[1] * k, 5, 0, Math.PI * 2);
			x.fillStyle = "#6fc3ff"; x.fill();
		});
	}
	function editPos(e, cv) {
		const r = cv.getBoundingClientRect();
		const sx = cv.width / Math.max(1, r.width);
		const sy = cv.height / Math.max(1, r.height);
		const ed = curEdit();
		const k = (ed && ed.k) || 1;
		return [((e.clientX - r.left) * sx) / k, ((e.clientY - r.top) * sy) / k];
	}
	function onEditDown(e) {
		const ed = curEdit();
		if (!ed || !ed.img) return;

		if (!ed.cornerMode) {
			ed.cornerMode = true;
			layoutEdit();
			return;
		}
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		const p = editPos(e, e.currentTarget);
		const rr = 34 / ed.k;
		let best = -1, bd = rr * rr;
		ed.quad.forEach((q, i) => {
			const dx = q[0] - p[0], dy = q[1] - p[1];
			if (dx * dx + dy * dy <= bd) { bd = dx * dx + dy * dy; best = i; }
		});
		ed.drag = best;
	}
	function onEditMove(e) {
		const ed = curEdit();
		if (!ed || ed.drag < 0) return;
		e.preventDefault();
		const p = editPos(e, e.currentTarget);
		ed.quad[ed.drag] = [Math.min(ed.sh.w, Math.max(0, p[0])), Math.min(ed.sh.h, Math.max(0, p[1]))];
		drawEdit();
	}
	function onEditUp() {
		const ed = curEdit();
		if (!ed) return;
		const was = ed.drag;
		ed.drag = -1;
		if (was < 0) return;
		const sh = ed.sh;

		if (quadArea(ed.quad) < sh.w * sh.h * 0.015 || !isConvex(ed.quad)) {
			ed.quad = sh.quad.map((p) => p.slice());
			drawEdit();
			U.toast?.("Ecken dürfen sich nicht kreuzen und müssen ausreichend Abstand haben.", "error");
			return;
		}

		ed.dirty = true;
		queueCornerReprocess();
	}
	function finishEdit() {
		const owner = scanUI, ed = curEdit();
		if (!owner || !ed) return;
		clearTimeout(editCommitT); editCommitT = 0;
		const sh = ed.sh;
		// Nur neu aufbereiten, wenn sich etwas geändert hat oder die Seite fehlgeschlagen ist.
		if (owner.shots.includes(sh) && (ed.dirty || sh.failed)) queueProcess(owner, sh, syncShotWithEdit(sh, ed));
		closeEdit();
		renderShots();
	}

	// ---- Abschluss: auf die Warteschlange warten, dann fertige Scans als Data-URLs liefern.
	async function collectReadyPages(owner, jpeg) {
		if (owner.exporting) return null;
		owner.exporting = true;
		setScanBusy(true, "Seiten werden vorbereitet…");
		try {
			await waitQueueIdle(owner);
			if (scanUI !== owner) return null;
			const ready = owner.shots.filter((sh) => sh.out);
			if (!ready.length) { U.toast?.("Keine fertigen Scans zum Export", "error"); return null; }
			const pages = [];
			for (const sh of ready) {
				const { blob, w, h } = sh.out;
				const dataUrl = jpeg && blob.type !== "image/jpeg" ? await toJpegDataUrl(blob) : await blobToDataUrl(blob);
				pages.push({ dataUrl, w, h });
			}
			return pages;
		} catch (e) {
			console.warn("Heft: Seiten vorbereiten fehlgeschlagen", e);
			U.toast?.("Seiten konnten nicht vorbereitet werden", "error");
			return null;
		} finally {
			if (scanUI === owner) setScanBusy(false);
			owner.exporting = false;
		}
	}
	async function scanFinishPdf() {
		const owner = scanUI;
		if (!owner) return;
		const pages = await collectReadyPages(owner, true);
		if (!pages || scanUI !== owner) return;
		try {
			const bytes = buildPdf(pages);
			U.downloadBlob("scan-" + new Date().toISOString().slice(0, 10) + ".pdf", new Blob([bytes], { type: "application/pdf" }));
			U.toast?.("PDF mit " + pages.length + " Seite(n) gespeichert");
		} catch (e) {
			console.warn("Heft: PDF erzeugen fehlgeschlagen", e);
			U.toast?.("PDF konnte nicht erzeugt werden", "error");
		}
	}
	async function scanFinishHeft() {
		const owner = scanUI;
		if (!owner) return;
		const pages = await collectReadyPages(owner, false);
		if (!pages || scanUI !== owner) return;
		closeScanner();
		host.insertPages(pages.map((p) => ({ src: p.dataUrl, w: p.w, h: p.h, scan: true })));
	}

	// Escape schließt zuerst die Nachbearbeitung, dann den Scanner. true = behandelt.
	function handleEscape() {
		if (scanUI && scanUI.edit) { closeEdit(); return true; }
		if (scanUI) { closeScanner(); return true; }
		return false;
	}

	return { open: openScanner, close: closeScanner, handleEscape };
}
