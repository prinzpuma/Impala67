import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const TARGET_DIRS = ["web", "server"];
let checked = 0;
let errors = 0;

async function scan(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			await scan(fullPath);
		} else if (entry.isFile() && entry.name.endsWith(".js")) {
			checked++;
			const res = spawnSync(process.execPath, ["--check", fullPath], { stdio: "pipe", encoding: "utf8" });
			if (res.status !== 0) {
				console.error(`Syntax error in ${fullPath}:\n${res.stderr || res.stdout}`);
				errors++;
			}
		}
	}
}

for (const dir of TARGET_DIRS) {
	await scan(dir);
}

if (errors > 0) {
	console.error(`Found ${errors} syntax error(s) across ${checked} files.`);
	process.exit(1);
} else {
	console.log(`All ${checked} JavaScript files passed syntax check.`);
}
