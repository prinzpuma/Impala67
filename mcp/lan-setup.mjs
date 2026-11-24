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

console.log("\nIn der iPad-App unter Einstellungen → App & Speicher → Für Entwickler eintragen:");
console.log(`  Kopplungs-Code (findet den PC automatisch per Bonjour):\n    ${token}`);
if (addresses.length) {
	console.log("\nOder direkt mit Adresse (Fallback ohne Bonjour):");
	for (const ip of addresses) console.log(`    ws://${ip}:${port}/?token=${token}`);
}
console.log("\nDer laufende MCP-Server übernimmt den Code innerhalb weniger Sekunden automatisch.");
console.log("Windows/Linux-Firewall: Port " + port + " (TCP) im lokalen WLAN erlauben.");
