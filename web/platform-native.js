"use strict";

// platform-native.js — Schlanke Brücke zu nativen Capacitor-Plugins auf Mobilgeräten.
// Läuft direkt als ES-Modul ohne Bundler: Greift auf window.Capacitor zu.
// Im Standard-Webbrowser (Chrome, Safari, iPad) greifen stumme Fallbacks oder Web-APIs.

const getCapacitor = () => (typeof window !== "undefined" ? window.Capacitor : null);
const getPlugin = (name) => getCapacitor()?.Plugins?.[name] || null;

export const PLATFORM_NATIVE = {
	get isNative() {
		return Boolean(getCapacitor()?.isNativePlatform?.());
	},

	get platform() {
		return getCapacitor()?.getPlatform?.() || "web";
	},

	// ---- Taktiles Haptik-Feedback ----
	haptics: {
		isEnabled() {
			return typeof localStorage === "undefined" || localStorage.getItem("impala67NativeHaptics") !== "0";
		},

		async selection() {
			if (!this.isEnabled()) return false;
			const h = getPlugin("Haptics");
			if (h?.selectionChanged) {
				try { await h.selectionChanged(); return true; } catch { /* ignore */ }
			}
			if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
				try { navigator.vibrate(10); return true; } catch { /* ignore */ }
			}
			return false;
		},

		async light() {
			if (!this.isEnabled()) return false;
			const h = getPlugin("Haptics");
			if (h?.impact) {
				try { await h.impact({ style: "LIGHT" }); return true; } catch { /* ignore */ }
			}
			if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
				try { navigator.vibrate(15); return true; } catch { /* ignore */ }
			}
			return false;
		},

		async medium() {
			if (!this.isEnabled()) return false;
			const h = getPlugin("Haptics");
			if (h?.impact) {
				try { await h.impact({ style: "MEDIUM" }); return true; } catch { /* ignore */ }
			}
			if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
				try { navigator.vibrate(25); return true; } catch { /* ignore */ }
			}
			return false;
		},

		async error() {
			if (!this.isEnabled()) return false;
			const h = getPlugin("Haptics");
			if (h?.notification) {
				try { await h.notification({ type: "ERROR" }); return true; } catch { /* ignore */ }
			}
			if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
				try { navigator.vibrate([30, 40, 30]); return true; } catch { /* ignore */ }
			}
			return false;
		},
	},

	// ---- Lokale Benachrichtigungen (SRS Lernzeit & Karteikarten) ----
	notifications: {
		SRS_NOTIFICATION_ID: 1067,

		async requestPermission() {
			const n = getPlugin("LocalNotifications");
			if (!n) return false;
			try {
				const status = await n.requestPermissions();
				return status.display === "granted";
			} catch {
				return false;
			}
		},

		async scheduleSRSReview(count, options = {}) {
			if (!count || count <= 0) return false;
			const n = getPlugin("LocalNotifications");
			if (!n) return false;

			const hour = Number.isInteger(options.hour) ? options.hour : 18;
			const minute = Number.isInteger(options.minute) ? options.minute : 0;

			try {
				const perm = await n.checkPermissions();
				if (perm.display !== "granted") {
					const req = await n.requestPermissions();
					if (req.display !== "granted") return false;
				}

				// Vorherige Benachrichtigung löschen
				try {
					await n.cancel({ notifications: [{ id: this.SRS_NOTIFICATION_ID }] });
				} catch { /* noch keine vorhanden */ }

				// Nächsten Zeitpunkt bestimmen
				const now = new Date();
				const target = new Date();
				target.setHours(hour, minute, 0, 0);
				if (target.getTime() <= now.getTime()) {
					target.setDate(target.getDate() + 1); // morgen zur selben Zeit
				}

				await n.schedule({
					notifications: [
						{
							id: this.SRS_NOTIFICATION_ID,
							title: "Impala67 – Karteikarten fällig",
							body: `Du hast ${count} Karteikarte${count === 1 ? "" : "n"} zur Wiederholung bereit.`,
							schedule: { at: target },
							sound: "default",
							actionTypeId: "",
							extra: { srsCount: count },
						},
					],
				});
				return true;
			} catch (err) {
				console.warn("[platform-native] Benachrichtigung konnte nicht geplant werden:", err);
				return false;
			}
		},

		onActionPerformed(callback) {
			const n = getPlugin("LocalNotifications");
			if (!n || typeof callback !== "function") return () => {};
			let handle = null;
			try {
				const res = n.addListener("localNotificationActionPerformed", (action) => {
					callback(action);
				});
				if (res && typeof res.then === "function") {
					res.then((h) => { handle = h; }).catch(() => {});
				} else {
					handle = res;
				}
			} catch (err) {
				console.warn("[platform-native] localNotificationActionPerformed listener error:", err);
			}
			return () => {
				try { handle?.remove?.(); } catch { /* ignore */ }
			};
		},
	},

	// ---- Lokales Dateisystem (Backup in Android Dokumente-Ordner) ----
	filesystem: {
		async exportBackup(filename, contentString) {
			const fs = getPlugin("Filesystem");
			if (!fs) return { native: false, success: false };

			try {
				// Speichert in Documents/Impala67/
				const res = await fs.writeFile({
					path: `Impala67/${filename}`,
					data: contentString,
					directory: "DOCUMENTS",
					encoding: "utf8",
					recursive: true,
				});
				return {
					native: true,
					success: true,
					uri: res?.uri || `Documents/Impala67/${filename}`,
				};
			} catch (err) {
				console.error("[platform-native] Dateisystem-Export fehlgeschlagen:", err);
				return { native: true, success: false, error: err?.message };
			}
		},
	},

	// ---- App-Lifecycle & Zurück-Button ----
	lifecycle: {
		init({ onStateChange, onBackButton } = {}) {
			const app = getPlugin("App");
			if (!app) return () => {};

			let backSub = null;
			let stateSub = null;

			if (typeof onBackButton === "function") {
				try {
					const res = app.addListener("backButton", (evt) => {
						onBackButton(evt);
					});
					if (res && typeof res.then === "function") {
						res.then((handle) => { backSub = handle; }).catch(() => {});
					} else {
						backSub = res;
					}
				} catch (err) {
					console.warn("[platform-native] backButton listener error:", err);
				}
			}

			if (typeof onStateChange === "function") {
				try {
					const res = app.addListener("appStateChange", (state) => {
						onStateChange(Boolean(state?.isActive));
					});
					if (res && typeof res.then === "function") {
						res.then((handle) => { stateSub = handle; }).catch(() => {});
					} else {
						stateSub = res;
					}
				} catch (err) {
					console.warn("[platform-native] appStateChange listener error:", err);
				}
			}

			return () => {
				try { backSub?.remove?.(); } catch { /* ignore */ }
				try { stateSub?.remove?.(); } catch { /* ignore */ }
			};
		},
	},

	// ---- Google ML Kit Dokumenten-Scanner ----
	scanner: {
		get isAvailable() {
			return Boolean(getPlugin("DocumentScanner"));
		},
		async scan({ pageLimit = 25 } = {}) {
			const ds = getPlugin("DocumentScanner");
			if (!ds) return { success: false, images: [], canceled: false };
			try {
				const res = await ds.scanDocument({
					pageLimit,
					scannerMode: "FULL",
					galleryImportAllowed: true,
					resultFormats: "JPEG_PDF",
				});
				const images = res?.scannedImages || [];
				return {
					success: true,
					images,
					pdf: res?.pdf || null,
					canceled: false,
				};
			} catch (err) {
				const msg = String(err?.message || err || "").toLowerCase();
				const isCancel = msg.includes("cancel") || msg.includes("aborted") || msg.includes("user_canceled");
				if (!isCancel) {
					console.warn("[platform-native] ML Kit Scanner Fehler:", err);
				}
				return {
					success: false,
					images: [],
					pdf: null,
					canceled: isCancel,
					error: isCancel ? null : (err?.message || "Scanner-Fehler"),
				};
			}
		},
	},

	// ---- Offline-Spracherkennung ----
	speech: {
		get isAvailable() {
			return Boolean(getPlugin("SpeechRecognition"));
		},
		_activeListening: false,
		_lastTranscript: "",
		async hasPermission() {
			const sr = getPlugin("SpeechRecognition");
			if (!sr) return false;
			try {
				const check = await sr.hasPermissions();
				return Boolean(check?.speechRecognition);
			} catch { return false; }
		},
		async requestPermission() {
			const sr = getPlugin("SpeechRecognition");
			if (!sr) return false;
			try {
				const res = await sr.requestPermissions();
				return Boolean(res?.speechRecognition === "granted");
			} catch { return false; }
		},
		async startListening({ lang = "de-DE", onPartial, onResult, onError } = {}) {
			const sr = getPlugin("SpeechRecognition");
			if (!sr) return false;
			try {
				const has = await this.hasPermission();
				if (!has) {
					const req = await this.requestPermission();
					if (!req) { onError?.("Mikrofon-Berechtigung verweigert"); return false; }
				}
				this._activeListening = true;
				this._lastTranscript = "";
				sr.removeAllListeners?.();

				sr.addListener("partialResults", (data) => {
					const text = data?.matches?.[0] || "";
					if (text) {
						this._lastTranscript = text;
						onPartial?.(text);
					}
				});

				sr.addListener("listeningState", (state) => {
					if (state?.status === "stopped" || state?.state === "stopped") {
						if (this._activeListening) {
							this._activeListening = false;
							onResult?.(this._lastTranscript);
						}
					}
				});

				await sr.start({
					language: lang,
					maxResults: 1,
					prompt: "Sprechen…",
					partialResults: true,
					popup: false,
				});
				return true;
			} catch (err) {
				this._activeListening = false;
				onError?.(err?.message || "Spracherkennung fehlgeschlagen");
				return false;
			}
		},
		async stopListening() {
			const sr = getPlugin("SpeechRecognition");
			if (!sr) return false;
			this._activeListening = false;
			try {
				await sr.stop();
				sr.removeAllListeners?.();
				return true;
			} catch { return false; }
		},
	},

	// ---- Systemweites Teilen (Send-Intent) ----
	sendIntent: {
		get isAvailable() {
			return Boolean(getPlugin("SendIntent"));
		},
		async checkIncoming() {
			const si = getPlugin("SendIntent");
			if (!si) return null;
			try {
				const checkPromise = si.checkSendIntentReceived();
				const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout")), 3500));
				const res = await Promise.race([checkPromise, timeoutPromise]);
				if (!res) return null;

				const hasContent = res.url || res.title || res.description || (Array.isArray(res.additionalItems) && res.additionalItems.length > 0);
				if (!hasContent) return null;

				// Intent nach erfolgreicher Übergabe leeren
				try { si.finish?.(); } catch { /* ignore */ }

				return {
					type: res.type || "text",
					url: res.url || null,
					title: res.title || "",
					text: res.description || res.title || "",
					additionalItems: res.additionalItems || [],
				};
			} catch {
				return null;
			}
		},
		finish() {
			try { getPlugin("SendIntent")?.finish?.(); } catch { /* ignore */ }
		},
	},

	// ---- Google ML Kit On-Device Text- & Handschrifterkennung ----
	ocr: {
		get isAvailable() {
			return Boolean(getPlugin("TextRecognition"));
		},

		async recognizeCanvas(canvas) {
			const tr = getPlugin("TextRecognition");
			const fs = getPlugin("Filesystem");
			if (!tr || !canvas) return null;

			const fileName = `ocr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
			let tempUri = null;
			try {
				const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
				const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");

				if (fs?.writeFile) {
					const writeRes = await fs.writeFile({
						path: `temp/${fileName}`,
						data: base64,
						directory: "CACHE",
						recursive: true,
					});
					tempUri = writeRes?.uri || `temp/${fileName}`;
				}

				if (!tempUri) return null;

				const res = await tr.processImage({ path: tempUri });
				return typeof res?.text === "string" ? res.text.trim() : "";
			} catch (err) {
				console.warn("[platform-native] ML Kit OCR fehlgeschlagen:", err);
				return null;
			} finally {
				if (tempUri && fs?.deleteFile) {
					try {
						await fs.deleteFile({
							path: `temp/${fileName}`,
							directory: "CACHE",
						});
					} catch { /* ignore cleanup error */ }
				}
			}
		},
	},
};


