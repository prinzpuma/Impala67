import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Wird im CI-Workflow (release.yml) über den Capacitor-Hook `capacitor:sync:after` aufgerufen.
// Baut den Rust-Kern (impala-ffi) für Android (arm64-v8a & x86_64) via cargo-ndk
// und räumt das temporäre Capacitor-Stub-Verzeichnis wieder auf.

const rootDir = process.env.CAPACITOR_ROOT_DIR || process.cwd();
const stubDir = path.join(rootDir, ".capacitor-disabled-stub");
fs.rmSync(stubDir, { recursive: true, force: true });

const coreDir = path.join(rootDir, "core");
const jniLibsDir = path.join(rootDir, "android", "app", "src", "main", "jniLibs");

function run(cmd, cwd = rootDir) {
	console.log(`> ${cmd}`);
	execSync(cmd, { cwd, stdio: "inherit" });
}

if (process.env.GITHUB_ACTIONS === "true" || process.argv.includes("--build-ndk")) {
	console.log("=== Impala67 Native Android Rust-Build (impala-ffi) ===");

	// 1. Android NDK sicherstellen
	const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
	if (sdkRoot) {
		const ndkDir = path.join(sdkRoot, "ndk");
		const hasNdk = fs.existsSync(ndkDir) && fs.readdirSync(ndkDir).length > 0;
		if (!hasNdk) {
			console.log("Installiere Android NDK über sdkmanager...");
			run(`yes | "${sdkRoot}/cmdline-tools/latest/bin/sdkmanager" "ndk;27.2.12479018"`);
		}
		const versions = fs.readdirSync(ndkDir).sort();
		const latestNdk = path.join(ndkDir, versions[versions.length - 1]);
		process.env.ANDROID_NDK_HOME = latestNdk;
		process.env.ANDROID_NDK_ROOT = latestNdk;
		console.log(`ANDROID_NDK_HOME = ${latestNdk}`);
	}

	// 2. Rust Android-Targets installieren
	run("rustup target add aarch64-linux-android x86_64-linux-android");

	// 3. cargo-ndk sicherstellen (vorgebautes Linux-Binary für schnellen CI-Lauf)
	try {
		execSync("cargo ndk --version", { stdio: "ignore" });
	} catch {
		if (process.platform === "linux") {
			console.log("Lade cargo-ndk Binary herunter...");
			run(
				"curl -L --proto '=https' --tlsv1.2 -sSf https://github.com/bbqsrc/cargo-ndk/releases/download/v3.5.4/cargo-ndk-v3.5.4-x86_64-unknown-linux-musl.tar.gz | tar -xzf - -C ~/.cargo/bin"
			);
		} else {
			run("cargo install cargo-ndk --locked");
		}
	}

	// 4. Rust-Kern für Android bauen (.so nach jniLibs)
	fs.mkdirSync(jniLibsDir, { recursive: true });
	run(
		`cargo ndk -t arm64-v8a -t x86_64 -o "${jniLibsDir}" build --profile native -p impala-ffi`,
		coreDir
	);

	console.log("=== Native Android Rust-Libraries erfolgreich gebaut ===");
}
