// Gemeinsame, side-effect-freie Regeln für synchronisierte Einstellungen.
// Tokens bleiben im lokalen Settings-State verfügbar, werden aber bei Bedarf
// zuverlässig aus jedem Drive-Transport entfernt.
export const SETTINGS_SYNC = (() => {
	const SECRET_FIELDS = Object.freeze(["notionToken", "driveDesktopClientSecret"]);

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

	function sanitizeEvents(events, includeSecrets = true) {
		return (Array.isArray(events) ? events : [])
			.map((event) => sanitizeEvent(event, includeSecrets))
			.filter(Boolean);
	}

	// Ein Patch ohne Token-Felder darf lokale Tokens nicht löschen. Das ist
	// entscheidend, wenn ein Drive-Event absichtlich redigiert wurde.
	function mergePatch(current, patch) {
		const next = { ...(patch || {}) };
		if (Array.isArray(next.aiProviders)) {
			const oldById = new Map((current?.aiProviders || []).map((provider) => [provider.id, provider]));
			next.aiProviders = next.aiProviders.map((provider) => {
				if (hasOwn(provider, "key")) return provider;
				const old = oldById.get(provider.id);
				return old && hasOwn(old, "key") ? { ...provider, key: old.key } : provider;
			});
		}
		return next;
	}

	function secretSnapshot(settings) {
		return {
			notionToken: settings?.notionToken || "",
			driveDesktopClientSecret: settings?.driveDesktopClientSecret || "",
			aiProviders: (settings?.aiProviders || []).map((provider) => ({ ...provider })),
		};
	}

	return { SECRET_FIELDS, allowsSecrets, sanitizeEvent, sanitizeEvents, mergePatch, secretSnapshot };
})();
