// mcp/sync-client.mjs - Cloudflare Sync Protocol v4 Client für Impala67 MCP-Server
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
	CLOUD_SYNC_PROTOCOL,
	CLOUD_SYNC_PROTOCOL_HEADER,
	chunkCloudEvents,
	cloudEventsEnvelope,
	prepareCloudEvents,
	prepareIncomingCloudEvents,
	pruneEventsForUpload,
	sha256Hex as coreSha256Hex,
} from "../web/sync-core.js";

import {
	deriveSyncCredentials,
	encryptPayload,
	decryptPayload,
	formatStorageUsage,
} from "../web/sync-crypto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DEFAULT_SYNC_URL = "https://impala67-sync.joshuagayer1.workers.dev";
const DEFAULT_CONFIG_FILE = resolve(__dirname, ".config.json");

/**
 * Liest Konfigurationswerte aus Parametern, Umgebungsvariablen oder mcp/.config.json.
 */
export function loadSyncConfig(opts = {}) {
	const configPath = opts.configPath || DEFAULT_CONFIG_FILE;
	let fileConfig = {};
	if (existsSync(configPath)) {
		try {
			const text = readFileSync(configPath, "utf8");
			fileConfig = JSON.parse(text);
		} catch (err) {
			console.error("[impala-mcp-sync] Warnung: Konfigurationsdatei konnte nicht gelesen werden:", err.message);
		}
	}

	const syncKey = String(
		opts.syncKey ||
		process.env.IMPALA67_SYNC_KEY ||
		fileConfig.syncKey ||
		fileConfig.IMPALA67_SYNC_KEY ||
		""
	).trim();

	const syncUrl = String(
		opts.syncUrl ||
		process.env.IMPALA67_SYNC_URL ||
		fileConfig.syncUrl ||
		fileConfig.IMPALA67_SYNC_URL ||
		DEFAULT_SYNC_URL
	).trim().replace(/\/+$/, "");

	return { syncKey, syncUrl };
}

/**
 * Erstellt einen SyncClient für Cloudflare Sync Protocol v4.
 */
export async function createSyncClient(opts = {}) {
	const { syncKey, syncUrl } = loadSyncConfig(opts);
	let credentials = null;

	if (syncKey) {
		try {
			credentials = await deriveSyncCredentials(syncKey);
		} catch (err) {
			console.error("[impala-mcp-sync] Fehler bei Schlüssel-Ableitung:", err.message);
		}
	}

	function authHeaders(extra = {}) {
		if (!credentials) return extra;
		return {
			Authorization: `Bearer ${credentials.authToken}`,
			"X-User-Id": credentials.userId,
			[CLOUD_SYNC_PROTOCOL_HEADER]: String(CLOUD_SYNC_PROTOCOL),
			...extra,
		};
	}

	function api(endpoint) {
		const base = syncUrl.replace(/\/+$/, "");
		const sep = endpoint.includes("?") ? "&" : "?";
		return credentials ? `${base}${endpoint}${sep}user=${encodeURIComponent(credentials.userId)}` : `${base}${endpoint}`;
	}

	return {
		isConfigured: () => !!credentials,
		getUrl: () => syncUrl,
		getCredentials: () => credentials,

		/**
		 * Holt neue verschlüsselte Event-Pakete vom Server ab und entschlüsselt sie.
		 */
		async pull(sinceSeq = 0, limit = 100) {
			if (!credentials) {
				return { configured: false, events: [], maxSeq: sinceSeq, generation: 0 };
			}

			try {
				const res = await fetch(api(`/api/sync?since=${sinceSeq}&limit=${limit}`), {
					headers: authHeaders(),
				});

				if (!res.ok) {
					const errorText = await res.text().catch(() => "");
					throw new Error(`Cloudflare Sync Pull Fehler (${res.status}): ${errorText}`);
				}

				const data = await res.json();
				const serverGeneration = Number(data.generation) || 1;
				const packets = Array.isArray(data.events) ? data.events : [];
				const maxSeq = Number(data.maxSeq) || sinceSeq;

				const incoming = [];
				for (const packet of packets) {
					const envelope = await decryptPayload(credentials.cryptoKey, packet);
					incoming.push(...prepareIncomingCloudEvents([envelope]));
				}

				return {
					configured: true,
					events: incoming,
					packetsCount: packets.length,
					maxSeq,
					generation: serverGeneration,
					hasMore: !!data.hasMore,
					usage: data.usage !== undefined ? formatStorageUsage(data.usage, data.limit) : null,
				};
			} catch (err) {
				return { configured: true, error: err.message, events: [], maxSeq: sinceSeq };
			}
		},

		/**
		 * Bereitet lokale Events vor, verschlüsselt sie (E2EE) und lädt sie als Batch hoch.
		 */
		async push(events) {
			if (!credentials) {
				return { configured: false, ok: false, error: "Kein Sync-Schlüssel konfiguriert." };
			}

			if (!Array.isArray(events) || !events.length) {
				return { configured: true, ok: true, savedCount: 0 };
			}

			try {
				const wire = prepareCloudEvents(pruneEventsForUpload(events), { includeRemote: false });
				if (!wire.length) {
					return { configured: true, ok: true, savedCount: 0 };
				}

				const chunks = chunkCloudEvents(wire);
				const packets = [];

				for (const chunk of chunks) {
					const id = `p-${await coreSha256Hex(chunk.map((e) => e.id).join("\n"))}`;
					const encrypted = await encryptPayload(credentials.cryptoKey, cloudEventsEnvelope(chunk));
					packets.push({ id, ...encrypted });
				}

				const res = await fetch(api("/api/events"), {
					method: "POST",
					headers: authHeaders({ "Content-Type": "application/json" }),
					body: JSON.stringify({ events: packets }),
				});

				if (!res.ok) {
					const errorText = await res.text().catch(() => "");
					throw new Error(`Cloudflare Sync Push Fehler (${res.status}): ${errorText}`);
				}

				const data = await res.json();
				return {
					configured: true,
					ok: true,
					savedCount: Number(data.savedCount) || 0,
					maxSeq: Number(data.maxSeq) || 0,
					generation: Number(data.generation) || 1,
					ack: data.ack || null,
					usage: data.usage !== undefined ? formatStorageUsage(data.usage, data.limit) : null,
				};
			} catch (err) {
				return { configured: true, ok: false, error: err.message };
			}
		},
	};
}
