// Übersicht der Sync-Konten auf dem Cloudflare-Worker (nur lesend).
// Aufruf: node tools/konten.mjs   (vorher einmal: npx wrangler login)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const config = fileURLToPath(new URL("../server/wrangler.toml", import.meta.url));
const sql = `SELECT u.user_id, u.label, u.total_bytes, u.updated_at, COUNT(e.seq) AS events, MIN(e.created_at) AS first_event
	FROM user_storage u LEFT JOIN sync_events e ON e.user_id = u.user_id
	GROUP BY u.user_id ORDER BY u.total_bytes DESC`.replace(/\s+/g, " ");

// Eine Befehlszeile (npx braucht unter Windows die Shell); alle Teile sind feste Werte.
const command = `npx wrangler d1 execute impala67-db --remote --json --config ${JSON.stringify(config)} --command ${JSON.stringify(sql)}`;
const run = spawnSync(command, { encoding: "utf8", shell: true, maxBuffer: 16 * 1024 * 1024 });
if (run.status !== 0) {
	console.error(run.stderr || run.stdout || "wrangler ist fehlgeschlagen.");
	console.error("Angemeldet? npx wrangler login");
	process.exit(1);
}
const rows = JSON.parse(run.stdout)[0]?.results || [];
const day = (iso) => (iso ? String(iso).slice(0, 10) : "–");
console.table(rows.map((r) => ({
	Name: r.label || "(kein Name)",
	Konto: `${String(r.user_id).slice(0, 6)}…`,
	MB: Math.round(Number(r.total_bytes) / 1e5) / 10,
	Pakete: r.events,
	"Aktiv seit": day(r.first_event),
	"Zuletzt": day(r.updated_at),
})));
