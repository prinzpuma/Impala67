// Gemeinsame, side-effect-freie Regeln für synchronisierte Einstellungen.
// Tokens bleiben im lokalen Settings-State verfügbar, werden aber bei Bedarf
// zuverlässig aus jedem Drive-Transport entfernt.
export const SETTINGS_SYNC = (() => {
	// notionToken: Notion-Import entfernt; ein evtl. noch gespeicherter Token bleibt trotzdem geheim.
	const SECRET_FIELDS = Object.freeze(["notionToken", "driveDesktopClientSecret"]);

	// Modellauswahl gilt je Gerät: Chat- und Embedding-Modell kommen nie von anderen Geräten
	// (die API-Schlüssel in aiProviders reisen dagegen weiter mit).
	const MODEL_FIELDS = Object.freeze(["aiProviderId", "aiModel", "embedProviderId", "embedModel"]);

	const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
	const allowsSecrets = (settings) => settings?.syncSecrets !== false;

	function sanitizeEvent(event, includeSecrets = true) {
		if (includeSecrets || !event || event.type !== "settingsSet" || !event.payload) return event;
		const payload = { ...event.payload };
		SECRET_FIELDS.forEach((key) => delete payload[key]);
		if (Array.isArray(payload.aiProviders)) {
			payload.aiProviders = payload.aiProviders.map(({ key, ...provider }) => provider);
		}
		return Object.keys(payload).length ? { ...event, payload } : null;
	}

	// Eingehende Fremd-Events: Modellauswahl entfernen. null: Event bestand nur daraus.
	function dropModelChoice(event) {
		if (!event || event.type !== "settingsSet" || !event.payload) return event;
		if (!MODEL_FIELDS.some((key) => hasOwn(event.payload, key))) return event;
		const payload = { ...event.payload };
		MODEL_FIELDS.forEach((key) => delete payload[key]);
		return Object.keys(payload).length ? { ...event, payload } : null;
	}

	function sanitizeEvents(events, includeSecrets = true) {
		return (Array.isArray(events) ? events : [])
			.map((event) => sanitizeEvent(event, includeSecrets))
			.filter(Boolean);
	}

	function secretSnapshot(settings) {
		return {
			notionToken: settings?.notionToken || "",
			driveDesktopClientSecret: settings?.driveDesktopClientSecret || "",
			aiProviders: (settings?.aiProviders || []).map((provider) => ({ ...provider })),
		};
	}

	return { allowsSecrets, sanitizeEvent, sanitizeEvents, dropModelChoice, secretSnapshot };
})();
