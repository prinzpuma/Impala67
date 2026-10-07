"use strict";
// Scanner-Oberfläche des Hefts: Kamera mit Live-Prüfung und Auto-Scan, Aufnahmeleiste,
// Nachbearbeitung (Ecken, Filter, Drehen) und Abschluss als PDF oder Heftseiten.
// Bildverarbeitung: heft-scan.js (SCANCORE). Auf Android zuerst der Google-Scanner.
import { U } from "./util.js";
import { PLATFORM_NATIVE } from "./platform-native.js";
import { SCANCORE } from "./heft-scan.js";
import { buildPdf } from "./heft-export.js";

const { SCAN_MODES, loadImg, quadArea, isConvex, detectQuad, processShot, lumStats } = SCANCORE;

// host: insertPages([{ src, w, h }]), pickFiles(opts, cb), fileToImageData(file, maxDim, mime)
export function createScanner(host) {
	let scanUI = null;

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
						images.push(await host.fileToImageData(await (await fetch(src)).blob(), 2400));
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

		const wrap = document.createElement("div");
		wrap.className = "heft-scan";
		wrap.innerHTML =
			'<div class="heft-scan-top"><b>Dateien scannen</b><button type="button" data-hescanclose="1" title="Schließen">✕</button></div>' +
			'<div class="heft-scan-stage"><video autoplay playsinline muted></video>' +
				'<svg class="heft-scan-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="7,7 93,7 93,93 7,93"></polygon></svg>' +
				'<div class="heft-scan-quality" data-hescanquality="1">Kamera wird geprüft…</div>' +
				'<div class="heft-scan-hint">Blatt vollständig ins Bild legen. Grün = bereit; der Rahmen zeigt exakt den späteren Zuschnitt.</div></div>' +
			'<div class="heft-scan-shots"></div>' +
			'<div class="heft-scan-bar">' +
				'<button type="button" class="heft-scan-shutter" data-hescanshot="1" title="Seite aufnehmen"></button>' +
				'<div class="heft-scan-actions">' +
					'<button type="button" data-hescanautocap="1" title="Auto-Scan aktivieren">⚡ Auto aus</button>' +
					'<button type="button" data-hescanpdf="1" disabled>📄 Als PDF speichern</button>' +
					'<button type="button" data-hescanheft="1" disabled>📓 In Heft einfügen</button>' +
				'</div>' +
			'</div>' +
			'<div class="heft-scan-busy" hidden><span>Scan wird aufbereitet…</span></div>';
		document.body.appendChild(wrap);
		scanUI = { wrap, stream: null, shots: [], edit: null, busy: false, liveTimer: 0, liveStable: 0, liveMissing: 0, liveHistory: [], autoCapture: false, autoArmed: false, autoCooldown: 0 };
		const ui = scanUI;
		wrap.addEventListener("click", onScanClick);
		try {
			if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("getUserMedia fehlt");

			let stream = null;
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
					audio: false,
				});
			} catch (cameraError) {

				const name = cameraError && cameraError.name;
				if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError" && name !== "NotFoundError") throw cameraError;
				stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
			}

			if (scanUI !== ui || !wrap.isConnected) { try { stream.getTracks().forEach((t) => t.stop()); } catch {  } return; }
			ui.stream = stream;
			const video = wrap.querySelector("video");
			video.srcObject = stream;
			video.muted = true;
			video.setAttribute("playsinline", "");

			try { await video.play(); } catch (e2) { console.warn("Heft: Video-play blockiert", e2); }
			startLiveQuality(video, ui);
			const track = stream.getVideoTracks && stream.getVideoTracks()[0];
			if (track) {

				try {
					const caps = track.getCapabilities ? track.getCapabilities() : null;
					const advanced = {};
					if (caps && Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) advanced.focusMode = "continuous";
					if (caps && Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) advanced.exposureMode = "continuous";
					if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] });
				} catch (constraintError) { console.info("Heft: Kamera-Automatik bleibt auf Gerätestandard", constraintError); }
				track.addEventListener("ended", () => showCameraStopped(ui), { once: true });
			}
			video.addEventListener("error", () => showCameraStopped(ui), { once: true });
		} catch (e) {

			console.warn("Heft: Kamera nicht verfügbar", e);
			if (scanUI === ui) {
				wrap.querySelector(".heft-scan-stage").innerHTML =
					'<div class="heft-scan-nocam"><p>Keine Kamera verfügbar oder Zugriff abgelehnt.</p>' +
					'<button type="button" data-hescanpick="1">Fotos auswählen…</button></div>';
				const shut = wrap.querySelector(".heft-scan-shutter");
				if (shut) shut.disabled = true;
			}
		}
	}
	function showCameraStopped(owner) {
		if (!owner || scanUI !== owner || !owner.wrap.isConnected) return;
		stopLiveQuality();
		try { if (owner.stream) owner.stream.getTracks().forEach((t) => t.stop()); } catch {  }
		owner.stream = null;
		const stage = owner.wrap.querySelector(".heft-scan-stage");
		if (stage) stage.innerHTML = '<div class="heft-scan-nocam"><p>Kameraverbindung wurde unterbrochen.</p><button type="button" data-hescanpick="1">Fotos auswählen…</button><small>Bereits aufgenommene Scans bleiben erhalten.</small></div>';
		const shut = owner.wrap.querySelector(".heft-scan-shutter");
		if (shut) shut.disabled = true;
		if (U.toast) U.toast("Kamera wurde beendet — du kannst Fotos auswählen.", "error");
	}
	function closeScanner() {
		if (!scanUI) return;
		stopLiveQuality();
		try { if (scanUI.stream) scanUI.stream.getTracks().forEach((t) => t.stop()); } catch {  }
		try { scanUI.wrap.remove(); } catch {  }
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
	function liveQualityFrame(video) {
		const sw = 300, sh = Math.max(150, Math.round(video.videoHeight / Math.max(1, video.videoWidth) * sw));
		const c = document.createElement("canvas"); c.width = sw; c.height = sh;
		c.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, sw, sh);
		// Kennzahlen aus SCANCORE.lumStats — genau die Formel, mit der danach auch der
		// fertige Scan bewertet wird. Die Rechnung stand hier vorher ein zweites Mal.
		// step 2: jedes zweite Pixel reicht dem 340-ms-Takt der Live-Prüfung.
		const { mean, contrast, sharp } = lumStats(c, 2);
		const quad = detectQuad(c, sw, sh);
		const found = quadArea(quad) < sw * sh * 0.96;
		const area = quadArea(quad) / Math.max(1, sw * sh);
		const margin = found ? Math.min(...quad.map((p) => Math.min(p[0], p[1], sw - 1 - p[0], sh - 1 - p[1]))) : 0;
		return { quad, found, mean, contrast, sharp, area, margin, sw, sh };
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
		const check = () => {
			if (scanUI !== owner || owner.busy || !video.videoWidth || !video.isConnected) return;
			try {
				const info = stabilizeLiveInfo(liveQualityFrame(video), owner);
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
		};
		check();
		owner.liveTimer = setInterval(check, 340);
	}
	function stopLiveQuality() {
		if (scanUI && scanUI.liveTimer) { clearInterval(scanUI.liveTimer); scanUI.liveTimer = 0; }
	}
	function setScanBusy(on, label) {
		if (!scanUI) return;
		scanUI.busy = !!on;
		const el = scanUI.wrap.querySelector(".heft-scan-busy");
		if (el) {
			el.hidden = !on;
			const sp = el.querySelector("span");
			if (sp && label) sp.textContent = label;
		}
		const shut = scanUI.wrap.querySelector(".heft-scan-shutter");
		if (shut) shut.disabled = !!on;
	}
	function onScanClick(e) {
		const b = e.target.closest("button");
		if (!b || !scanUI) return;
		const d = b.dataset;
		if (d.hescanclose) closeScanner();
		else if (d.hescanshot) scanCapture();
		else if (d.hescanpdf) { if (scanUI.shots.length) scanFinishPdf(); }
		else if (d.hescanheft) { if (scanUI.shots.length) scanFinishHeft(); }
		else if (d.hescanautocap) {
			scanUI.autoCapture = !scanUI.autoCapture;
			if (scanUI.autoCapture) { scanUI.autoArmed = true; scanUI.liveStable = 0; }
			else { scanUI.autoArmed = false; }
			b.classList.toggle("active", scanUI.autoCapture);
			b.textContent = scanUI.autoCapture ? "⚡ Auto an" : "⚡ Auto aus";
		}
		else if (d.hescanpick) scanPickFiles();
		else if (d.hescancompare) {
			const ed = scanUI.edit;
			if (ed) {
				ed.compare = !ed.compare;
				b.textContent = ed.compare ? "◐ Nur Scan" : "◑ Vorher/Nachher";
				const sh = scanUI.shots[ed.i];
				if (sh && sh.out) drawEditResult(sh);
			}
		}
		else if (d.hescancorners) {
			const ed = scanUI.edit;
			if (ed && ed.img) { ed.cornerMode = true; layoutEdit(); }
			else if (U.toast) U.toast("Rohbild wird geladen…");
		}
		else if (d.hescanedit != null) openEdit(Number(d.hescanedit));
		else if (d.hescaneditback) closeEdit();
		else if (d.hescanmode) {

			if (scanUI.edit) {
				scanUI.edit.mode = d.hescanmode;
				scanUI.edit.dirty = true;
				scanUI.edit.el.querySelectorAll("[data-hescanmode]").forEach((m) => m.classList.toggle("active", m.dataset.hescanmode === scanUI.edit.mode));
				liveReprocessEdit();
			}
		}
		else if (d.hescanrot) {
			if (scanUI.edit) {
				scanUI.edit.rot = (scanUI.edit.rot + 1) % 4;
				scanUI.edit.dirty = true;
				const rb = scanUI.edit.el.querySelector("[data-hescanrot]");
				if (rb) rb.textContent = "⟳ Drehen" + (scanUI.edit.rot ? " (" + (scanUI.edit.rot * 90) + "°)" : "");
				liveReprocessEdit();
			}
		}
		else if (d.hescandel) {
			if (scanUI.edit) { const i = scanUI.edit.i; closeEdit(); scanUI.shots.splice(i, 1); renderShots(); }
		}
		else if (d.hescandone) finishEdit();
	}
	async function scanCapture(isAuto = false) {
		const owner = scanUI;
		if (!owner || owner.busy) return;

		if (!isAuto) { owner.autoArmed = false; owner.liveStable = 0; owner.autoCooldown = Date.now() + 1800; }
		const video = owner.wrap.querySelector("video");
		if (!video) return;

		setScanBusy(true, "Kamera wird vorbereitet…");

		if (!video.videoWidth || !video.videoHeight) {
			try { await video.play(); } catch {  }
			if (scanUI !== owner) return;
			if (!video.videoWidth) {
				setScanBusy(false);
				if (U.toast) U.toast("Kamera startet noch — kurz warten und erneut tippen", "error");
				return;
			}
		}
		setScanBusy(true, "Aufnahme wird aufbereitet…");
		try {

			const cap = 2600, k = Math.min(1, cap / Math.max(video.videoWidth, video.videoHeight));
			const c = document.createElement("canvas");
			c.width = Math.max(2, Math.round(video.videoWidth * k)); c.height = Math.max(2, Math.round(video.videoHeight * k));
			const captureCtx = c.getContext("2d");
			captureCtx.imageSmoothingEnabled = true; captureCtx.imageSmoothingQuality = "high";
			captureCtx.drawImage(video, 0, 0, c.width, c.height);

			await addRawScan(c.toDataURL("image/png"), c.width, c.height, owner);
		} catch (e) {
			console.warn("Heft: Scan fehlgeschlagen", e);
			if (U.toast) U.toast("Scan fehlgeschlagen", "error");
		}
		if (scanUI === owner) setScanBusy(false);
	}

	async function addRawScan(src, w, h, owner) {
		const img = await loadImg(src);

		const iw = img.naturalWidth || w, ih = img.naturalHeight || h;

		const quad = detectQuad(img, iw, ih);
		const sh = { src, w: iw, h: ih, quad, autoCrop: quadArea(quad) < iw * ih * 0.96, mode: "color", rot: 0, out: null, img };
		await processShot(sh);
		if (scanUI !== owner || !sh.out) return;
		owner.shots.push(sh);
		renderShots();
	}
	function renderShots() {
		if (!scanUI) return;
		const strip = scanUI.wrap.querySelector(".heft-scan-shots");
		if (!strip) return;

		strip.innerHTML = scanUI.shots.map((sh, i) => {
			const src = (sh.out && sh.out.dataUrl) || sh.src;
			const quality = sh.out && sh.out.quality;
			const note = !sh.autoCrop ? "Vollbild" : (quality && quality.soft ? "Weich" : (quality && quality.tooDark ? "Dunkel" : (quality && quality.glare ? "Spiegelung" : (quality && quality.flat ? "Kontrast" : ""))));
			return '<button type="button" class="heft-scan-shot" data-hescanedit="' + i + '" title="Scan ' + (i + 1) + ' nachbearbeiten">' +
				'<img src="' + src + '" alt="Scan ' + (i + 1) + '"><span>' + (i + 1) + '</span>' +
				(note ? '<small>' + note + '</small>' : "") + '</button>';
		}).join("");
		strip.scrollLeft = strip.scrollWidth;
		const ready = scanUI.shots.filter((sh) => sh.out && sh.out.dataUrl);
		const n = ready.length;
		const pdfBtn = scanUI.wrap.querySelector("[data-hescanpdf]");
		const heftBtn = scanUI.wrap.querySelector("[data-hescanheft]");
		if (pdfBtn) { pdfBtn.disabled = !n; pdfBtn.textContent = "📄 Als PDF speichern" + (n ? " (" + n + ")" : ""); }
		if (heftBtn) { heftBtn.disabled = !n; heftBtn.textContent = "📓 In Heft einfügen" + (n ? " (" + n + ")" : ""); }
	}
	function scanPickFiles() {
		host.pickFiles({ multiple: true, capture: true }, async (files) => {
			const owner = scanUI;
			if (!owner) return;
			setScanBusy(true, "Fotos werden aufbereitet…");
			for (const f of files) {
				try {
					const im = await host.fileToImageData(f, 2400, "image/png");
					if (scanUI !== owner) return;
					await addRawScan(im.src, im.w, im.h, owner);
				} catch (e) {
					console.warn("Heft: Scan-Foto fehlgeschlagen", e);
					if (U.toast) U.toast("Foto konnte nicht gelesen werden", "error");
				}
			}
			if (scanUI === owner) setScanBusy(false);
		});
	}

	let liveSeq = 0, editCommitT = 0;

	function queueCornerReprocess() {
		clearTimeout(editCommitT);
		editCommitT = setTimeout(() => { editCommitT = 0; liveReprocessEdit(true); }, 160);
	}

	function syncShotWithEdit(sh, ed) {
		sh.quad = ed.quad.map((p) => p.slice());
		sh.mode = ed.mode;
		sh.rot = ed.rot;
		sh.autoCrop = quadArea(sh.quad) < sh.w * sh.h * 0.96;
		return { quad: sh.quad.map((p) => p.slice()), mode: sh.mode, rot: sh.rot, commit: false };
	}
	async function liveReprocessEdit(quiet = false) {
		const owner = scanUI;
		const ed = owner && owner.edit;
		if (!ed || !owner) return;
		const sh = owner.shots[ed.i];
		if (!sh) return;

		const snapshot = syncShotWithEdit(sh, ed);
		const seq = ++liveSeq;
		if (!quiet) setScanBusy(true, "Filter wird angewendet…");
		try {
			const out = await processShot(sh, snapshot);

			if (scanUI !== owner || seq !== liveSeq) return;
			sh.out = out;
			renderShots();
			if (owner.edit && owner.edit.el === ed.el) {
				ed.dirty = false;
				if (!ed.cornerMode && sh.out) drawEditResult(sh);
			}
		} catch (e) {
			console.warn("Heft: Live-Aufbereitung fehlgeschlagen", e);
			if (scanUI === owner && U.toast) U.toast("Scan-Aufbereitung fehlgeschlagen", "error");
		} finally {
			if (!quiet && scanUI === owner && seq === liveSeq) setScanBusy(false);
		}
	}

	function fitStageScale(el, contentW, contentH) {
		const stageW = el.clientWidth || window.innerWidth;
		const stageH = el.clientHeight || Math.max(180, window.innerHeight - 170);
		return Math.max(0.02, Math.min((stageW - 24) / contentW, (stageH - 24) / contentH));
	}

	function drawEditResult(sh) {
		const ed = scanUI && scanUI.edit;
		if (!ed || !sh.out) return;
		const stage = ed.el.querySelector(".heft-scan-editstage");
		const cv = ed.el.querySelector("canvas");
		if (!stage || !cv) return;
		const img = new Image();
		img.onload = () => {
			if (!scanUI || !scanUI.edit || scanUI.edit.el !== ed.el) return;

			const k = fitStageScale(stage, img.naturalWidth, img.naturalHeight);
			cv.width = Math.max(1, Math.round(img.naturalWidth * k));
			cv.height = Math.max(1, Math.round(img.naturalHeight * k));
			const x = cv.getContext("2d");
			x.clearRect(0, 0, cv.width, cv.height);
			if (ed.compare && ed.img) {
				const half = cv.width / 2;

				x.drawImage(ed.img, 0, 0, half, cv.height);
				x.drawImage(img, half, 0, half, cv.height);
				x.fillStyle = "rgba(3,5,10,.7)";
				x.fillRect(0, 0, half, 21); x.fillRect(half, 0, half, 21);
				x.strokeStyle = "rgba(255,255,255,.8)"; x.lineWidth = 2;
				x.beginPath(); x.moveTo(half, 0); x.lineTo(half, cv.height); x.stroke();
				x.fillStyle = "#fff"; x.font = "600 11px -apple-system,sans-serif"; x.textAlign = "center";
				x.fillText("VORHER", half / 2, 14); x.fillText("AUFBEREITET", half + half / 2, 14);
			} else {
				x.drawImage(img, 0, 0, cv.width, cv.height);
			}
			x.fillStyle = "rgba(3,5,10,0.55)";
			x.fillRect(0, cv.height - 22, cv.width, 22);
			x.fillStyle = "rgba(255,255,255,0.88)";
			x.font = "11px -apple-system,sans-serif";
			x.textAlign = "center";
			x.fillText(ed.compare ? "Links Rohfoto · rechts entzerrter und aufbereiteter Scan" : "Aufbereitet · Ecken anpassen für manuellen Zuschnitt", cv.width / 2, cv.height - 7);
		};
		img.src = sh.out.dataUrl;
	}
	function openEdit(i) {
		const sh = scanUI.shots[i];
		if (!sh) return;
		closeEdit();
		const ed = document.createElement("div");
		ed.className = "heft-scan-edit";
		ed.innerHTML =
			'<div class="heft-scan-top"><b>Scan ' + (i + 1) + ' bearbeiten</b><button type="button" data-hescaneditback="1" title="Zurück">✕</button></div>' +
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
		scanUI.wrap.appendChild(ed);

		scanUI.edit = { i, el: ed, quad: (sh.quad || []).map((p) => p.slice()), mode: sh.mode || "color", rot: sh.rot || 0, img: null, drag: -1, k: 1, cornerMode: false, compare: false, dirty: false };
		const cv = ed.querySelector("canvas");
		cv.addEventListener("pointerdown", onEditDown);
		cv.addEventListener("pointermove", onEditMove);
		cv.addEventListener("pointerup", onEditUp);
		cv.addEventListener("pointercancel", onEditUp);

		if (sh.out) drawEditResult(sh);
		const setRaw = (img) => {
			if (scanUI && scanUI.edit && scanUI.edit.el === ed) {
				scanUI.edit.img = img;
				if (!sh.out) layoutEdit();
			}
		};
		if (sh.img) setRaw(sh.img);
		else loadImg(sh.src).then((img) => { sh.img = img; setRaw(img); }).catch((e) => console.warn("Heft: Rohbild laden fehlgeschlagen", e));
	}
	function closeEdit() {
		clearTimeout(editCommitT); editCommitT = 0;
		if (scanUI && scanUI.edit) { scanUI.edit.el.remove(); scanUI.edit = null; }
	}
	function layoutEdit() {
		const ed = scanUI && scanUI.edit;
		if (!ed || !ed.img) return;
		const stage = ed.el.querySelector(".heft-scan-editstage");
		const cv = ed.el.querySelector("canvas");
		const sh = scanUI.shots[ed.i];
		ed.k = fitStageScale(stage, sh.w, sh.h);
		cv.width = Math.max(1, Math.round(sh.w * ed.k));
		cv.height = Math.max(1, Math.round(sh.h * ed.k));
		drawEdit();
	}
	function drawEdit() {
		const ed = scanUI && scanUI.edit;
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
		const k = (scanUI.edit && scanUI.edit.k) || 1;
		return [((e.clientX - r.left) * sx) / k, ((e.clientY - r.top) * sy) / k];
	}
	function onEditDown(e) {
		const ed = scanUI && scanUI.edit;
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
		const ed = scanUI && scanUI.edit;
		if (!ed || ed.drag < 0) return;
		e.preventDefault();
		const sh = scanUI.shots[ed.i];
		const p = editPos(e, e.currentTarget);
		ed.quad[ed.drag] = [Math.min(sh.w, Math.max(0, p[0])), Math.min(sh.h, Math.max(0, p[1]))];
		drawEdit();
	}
	function onEditUp() {
		const ed = scanUI && scanUI.edit;
		if (!ed) return;
		const was = ed.drag;
		ed.drag = -1;
		if (was < 0) return;
		const sh = scanUI.shots[ed.i];

		if (!sh || quadArea(ed.quad) < sh.w * sh.h * 0.015 || !isConvex(ed.quad)) {
			ed.quad = sh && sh.quad ? sh.quad.map((p) => p.slice()) : ed.quad;
			drawEdit();
			if (U.toast) U.toast("Ecken dürfen sich nicht kreuzen und müssen ausreichend Abstand haben.", "error");
			return;
		}

		ed.dirty = true;
		queueCornerReprocess();
	}
	async function finishEdit() {

		const owner = scanUI;
		const ed = owner && owner.edit;
		if (!ed || !owner) return;
		const sh = owner.shots[ed.i];
		if (sh) {
			const snapshot = syncShotWithEdit(sh, ed);

			clearTimeout(editCommitT); editCommitT = 0;
			if (!sh.out || ed.dirty) {

				const seq = ++liveSeq;
				setScanBusy(true, "Scan wird aufbereitet…");
				try {
					const out = await processShot(sh, snapshot);
					if (scanUI === owner && seq === liveSeq) { sh.out = out; ed.dirty = false; }
				} catch (e2) { console.warn("Heft: Scan aufbereiten fehlgeschlagen", e2); }
				if (scanUI === owner) setScanBusy(false);
			}
		}
		if (scanUI !== owner) return;
		closeEdit();
		renderShots();
	}

	const readyScanOuts = () => scanUI.shots.map((sh) => sh.out).filter((o) => o && o.dataUrl && o.w && o.h);
	function scanFinishPdf() {
		try {
			const outs = readyScanOuts();
			if (!outs.length) { if (U.toast) U.toast("Keine fertigen Scans zum Export", "error"); return; }
			const bytes = buildPdf(outs);
			U.downloadBlob("scan-" + new Date().toISOString().slice(0, 10) + ".pdf", new Blob([bytes], { type: "application/pdf" }));
			if (U.toast) U.toast("PDF mit " + outs.length + " Seite(n) gespeichert");
		} catch (e) {
			console.warn("Heft: PDF erzeugen fehlgeschlagen", e);
			if (U.toast) U.toast("PDF konnte nicht erzeugt werden", "error");
		}
	}
	function scanFinishHeft() {
		const outs = readyScanOuts();
		closeScanner();
		host.insertPages(outs.map((o) => ({ src: o.dataUrl, w: o.w, h: o.h })));
	}

	// Escape schließt zuerst die Nachbearbeitung, dann den Scanner. true = behandelt.
	function handleEscape() {
		if (scanUI && scanUI.edit) { closeEdit(); return true; }
		if (scanUI) { closeScanner(); return true; }
		return false;
	}

	return { open: openScanner, close: closeScanner, handleEscape };
}
