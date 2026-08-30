import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../../");
const WEB_DIR = path.join(ROOT_DIR, "web");
const SCREENSHOT_DIR = path.join(__dirname, "screenshots");

const MIME_MAP = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".pdf": "application/pdf",
	".webmanifest": "application/manifest+json",
	".wasm": "application/wasm",
};

let server = null;
let serverPort = 0;
let browser = null;

export function createStaticServer() {
	return new Promise((resolve) => {
		server = http.createServer((req, res) => {
			let reqPath = req.url.split("?")[0];
			if (reqPath === "/") reqPath = "/index.html";
			if (reqPath === "/config.local.js") {
				res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
				res.end("// local config\n");
				return;
			}
			const filePath = path.join(WEB_DIR, reqPath);
			if (!filePath.startsWith(WEB_DIR)) {
				res.writeHead(403);
				res.end("Forbidden");
				return;
			}
			fs.stat(filePath, (err, stats) => {
				if (err || !stats.isFile()) {
					res.writeHead(404);
					res.end("Not Found: " + reqPath);
					return;
				}
				const ext = path.extname(filePath).toLowerCase();
				const mime = MIME_MAP[ext] || "application/octet-stream";
				res.writeHead(200, {
					"Content-Type": mime,
					"Cache-Control": "no-cache, no-store, must-revalidate",
					"Service-Worker-Allowed": "/",
				});
				fs.createReadStream(filePath).pipe(res);
			});
		});
		server.listen(0, "127.0.0.1", () => {
			serverPort = server.address().port;
			resolve(serverPort);
		});
	});
}

export async function launchBrowser() {
	browser = await puppeteer.launch({
		executablePath: "/usr/bin/google-chrome",
		headless: "new",
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-gpu",
			"--disable-dev-shm-usage",
			"--disable-background-timer-throttling",
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
			"--window-size=1440,900",
		],
	});
	return browser;
}

export async function cleanup() {
	if (browser) {
		await browser.close();
		browser = null;
	}
	if (server) {
		await new Promise((r) => server.close(r));
		server = null;
	}
}

export function getServerUrl() {
	return `http://127.0.0.1:${serverPort}/`;
}

export { SCREENSHOT_DIR };
