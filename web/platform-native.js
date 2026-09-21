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
		async selection() {
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
				app.addListener("backButton", (evt) => {
					onBackButton(evt);
				}).then((handle) => { backSub = handle; }).catch(() => {});
			}

			if (typeof onStateChange === "function") {
				app.addListener("appStateChange", (state) => {
					onStateChange(Boolean(state?.isActive));
				}).then((handle) => { stateSub = handle; }).catch(() => {});
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
		async scan({ pageLimit = 15 } = {}) {
			const ds = getPlugin("DocumentScanner");
			if (!ds) return null;
			try {
				const res = await ds.scanDocument({ pageLimit });
				return res?.scannedImages || [];
			} catch (err) {
				console.warn("[platform-native] ML Kit Scanner abgebrochen oder fehlgeschlagen:", err);
				return null;
			}
		},
	},

	// ---- Offline-Spracherkennung ----
	speech: {
		get isAvailable() {
			return Boolean(getPlugin("SpeechRecognition"));
		},
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
		async startListening({ lang = "de-DE", onResult, onError } = {}) {
			const sr = getPlugin("SpeechRecognition");
			if (!sr) return false;
			try {
				const has = await this.hasPermission();
				if (!has) {
					const req = await this.requestPermission();
					if (!req) { onError?.("Mikrofon-Berechtigung verweigert"); return false; }
				}
				sr.removeAllListeners?.();
				sr.addListener("partialResults", (data) => {
					const text = data?.matches?.[0] || "";
					if (text) onResult?.(text, false);
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
				onError?.(err?.message || "Spracherkennung fehlgeschlagen");
				return false;
			}
		},
		async stopListening() {
			const sr = getPlugin("SpeechRecognition");
			if (!sr) return false;
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
				const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout")), 800));
				const res = await Promise.race([checkPromise, timeoutPromise]);
				if (!res || (!res.url && !res.title && !res.description)) return null;
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
	},
};
