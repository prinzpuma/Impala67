"use strict";

/**
 * Event-Bus für Impala67.
 * Plattform- und DOM-unabhängiger Publish/Subscribe-Bus (Node.js & Browser).
 * Entkoppelt State, UI und Hintergrundprozesse ohne zyklische Abhängigkeiten.
 */
export class EventBus {
	constructor() {
		/** @type {Map<string, Set<Function>>} */
		this._listeners = new Map();
	}

	/**
	 * Registriert einen Listener für ein Event.
	 * @param {string} eventName Name des Events
	 * @param {Function} listener Callback-Funktion
	 * @returns {() => void} Unsubscribe-Funktion
	 */
	on(eventName, listener) {
		if (!eventName || typeof listener !== "function") {
			return () => {};
		}
		let set = this._listeners.get(eventName);
		if (!set) {
			set = new Set();
			this._listeners.set(eventName, set);
		}
		set.add(listener);
		return () => this.off(eventName, listener);
	}

	/**
	 * Entfernt einen registrierten Listener.
	 * @param {string} eventName Name des Events
	 * @param {Function} listener Zu entfernende Callback-Funktion
	 */
	off(eventName, listener) {
		if (!eventName || !listener) return;
		const set = this._listeners.get(eventName);
		if (!set) return;

		set.delete(listener);
		for (const fn of set) {
			if (fn._original === listener) {
				set.delete(fn);
			}
		}

		if (set.size === 0) {
			this._listeners.delete(eventName);
		}
	}

	/**
	 * Registriert einen Listener, der nach dem ersten Aufruf automatisch deregistriert wird.
	 * @param {string} eventName Name des Events
	 * @param {Function} listener Callback-Funktion
	 * @returns {() => void} Unsubscribe-Funktion
	 */
	once(eventName, listener) {
		if (!eventName || typeof listener !== "function") {
			return () => {};
		}
		const onceWrapper = (payload) => {
			this.off(eventName, onceWrapper);
			listener(payload);
		};
		onceWrapper._original = listener;
		return this.on(eventName, onceWrapper);
	}

	/**
	 * Ruft alle für ein Event registrierten Listener auf.
	 * Fehler in einzelnen Listenern werden per try...catch abgefangen und via
	 * console.error geloggt, damit ein fehlerhafter UI-Listener niemals andere
	 * Listener oder den State-Fluss abbricht.
	 * @param {string} eventName Name des Events
	 * @param {*} [payload] Optionale Nutzdaten
	 */
	emit(eventName, payload) {
		if (!eventName) return;
		const set = this._listeners.get(eventName);
		if (!set || set.size === 0) return;

		// Snapshot der Listener erstellen, damit Deregistrierungen (z.B. once, off)
		// während der Iteration die Ausführung nicht stören.
		const handlers = Array.from(set);
		for (const handler of handlers) {
			try {
				handler(payload);
			} catch (error) {
				console.error(`[EventBus] Fehler in Listener für "${eventName}":`, error);
			}
		}
	}

	/**
	 * Bereinigt Listener für einen bestimmten Event-Namen oder alle Events.
	 * @param {string} [eventName] Optionaler Event-Name
	 */
	clear(eventName) {
		if (typeof eventName === "string") {
			this._listeners.delete(eventName);
		} else {
			this._listeners.clear();
		}
	}
}

export const BUS = new EventBus();
