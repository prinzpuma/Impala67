#!/usr/bin/env node
// mcp/lan-setup.mjs - Kopplungs-Code für die iPad-App im WLAN anlegen und die Adresse zum Eintragen zeigen.
// Aufruf: node mcp/lan-setup.mjs        (neu: --new erzeugt einen neuen Code, der alte gilt dann nicht mehr)
// Danach den MCP-Server neu starten; in der iPad-App unter Einstellungen → App & Speicher → Für Entwickler
// die angezeigte Adresse eintragen.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";

const file = new URL("./.lan-token", import.meta.url);
let token = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
if (!token || process.argv.includes("--new")) {
	token = randomBytes(18).toString("base64url");
	writeFileSync(file, token + "\n");
	console.log("Neuer Kopplungs-Code in mcp/.lan-token gespeichert.");
}

const port = Number(process.env.IMPALA_LAN_PORT || 8766);
const addresses = Object.values(networkInterfaces()).flat()
	.filter((a) => a && a.family === "IPv4" && !a.internal)
	.map((a) => a.address);

console.log("\nIn der iPad-App eintragen:");
for (const ip of addresses) console.log(`  ws://${ip}:${port}/?token=${token}`);
if (!addresses.length) console.log("  (keine WLAN-Adresse gefunden)");
console.log("\nDanach den MCP-Server neu starten (z. B. Claude-Sitzung neu öffnen).");
console.log("Windows fragt beim ersten Start nach der Firewall: „Private Netzwerke“ erlauben.");
