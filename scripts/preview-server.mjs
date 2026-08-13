import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.argv[2] || "web");
const port = Number(process.argv[3] || 4177);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

createServer(async (request, response) => {
	try {
		const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
		let file = resolve(root, "." + pathname);
		if (file !== root && !file.startsWith(root + sep)) throw new Error("Ungültiger Pfad");
		if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
		response.writeHead(200, { "Content-Type": (types[extname(file)] || "application/octet-stream") + "; charset=utf-8", "Cache-Control": "no-store" });
		response.end(await readFile(file));
	} catch {
		response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Nicht gefunden");
	}
}).listen(port, "127.0.0.1", () => console.log(`Settings-Preview: http://127.0.0.1:${port}/`));
