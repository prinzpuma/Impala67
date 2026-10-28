// Statischer Dev-Server für web/ ohne Python: node tools/serve.mjs [port]
// Gleiche Wirkung wie `python -m http.server 8000 --directory web`, mit richtigem MIME-Typ für .wasm.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const PORT = Number(process.argv[2]) || 8000;
const TYPES = {
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
	".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
	".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".onnx": "application/octet-stream",
};

http.createServer((req, res) => {
	const url = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
	let file = path.join(ROOT, url);
	if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
	if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
	fs.readFile(file, (err, data) => {
		if (err) { res.writeHead(404).end("Nicht gefunden"); return; }
		res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
		res.end(data);
	});
}).listen(PORT, "127.0.0.1", () => console.log(`web/ auf http://localhost:${PORT}`));
