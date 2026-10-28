import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Wird im CI-Workflow (release.yml) über den Capacitor-Hook `capacitor:sync:after` aufgerufen.
// Baut den Rust-Kern (impala-ffi) für Android (arm64-v8a & x86_64) direkt mit dem Android NDK
// (ganz ohne externe Tools wie cargo-ndk) und räumt das temporäre Capacitor-Stub-Verzeichnis auf.

const rootDir = process.env.CAPACITOR_ROOT_DIR || process.cwd();
const stubDir = path.join(rootDir, ".capacitor-disabled-stub");
fs.rmSync(stubDir, { recursive: true, force: true });

const coreDir = path.join(rootDir, "core");
const jniLibsDir = path.join(rootDir, "android", "app", "src", "main", "jniLibs");

function run(cmd, cwd = rootDir, extraEnv = {}) {
	console.log(`> ${cmd}`);
	execSync(cmd, {
		cwd,
		stdio: "inherit",
		env: { ...process.env, ...extraEnv },
	});
}

if (process.env.GITHUB_ACTIONS === "true" || process.argv.includes("--build-ndk")) {
	console.log("=== Impala67 Native Android Rust-Build (impala-ffi) ===");

	// 1. Android NDK Toolchain-Pfad ermitteln
	const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
	if (!sdkRoot) {
		throw new Error("ANDROID_HOME / ANDROID_SDK_ROOT ist nicht gesetzt.");
	}
	const ndkDir = path.join(sdkRoot, "ndk");
	const hasNdk = fs.existsSync(ndkDir) && fs.readdirSync(ndkDir).length > 0;
	if (!hasNdk) {
		console.log("Installiere Android NDK über sdkmanager...");
		run(`yes | "${sdkRoot}/cmdline-tools/latest/bin/sdkmanager" "ndk;27.2.12479018"`);
	}
	const versions = fs.readdirSync(ndkDir).sort();
	const latestNdk = path.join(ndkDir, versions[versions.length - 1]);
	const prebuiltDir = path.join(latestNdk, "toolchains", "llvm", "prebuilt");
	const hostTag = fs.readdirSync(prebuiltDir)[0];
	const binDir = path.join(prebuiltDir, hostTag, "bin");
	console.log(`NDK Toolchain: ${binDir}`);

	// 2. Rust Android-Targets installieren
	run("rustup target add aarch64-linux-android x86_64-linux-android");

	// 3. Umgebungsvariablen für cc-rs (rusqlite bundled) und rustc-Linker setzen
	const api = "24";
	const ext = process.platform === "win32" ? ".cmd" : "";
	const arExt = process.platform === "win32" ? ".exe" : "";
	const ndkEnv = {
		ANDROID_NDK_HOME: latestNdk,
		ANDROID_NDK_ROOT: latestNdk,
		CC_aarch64_linux_android: path.join(binDir, `aarch64-linux-android${api}-clang${ext}`),
		CXX_aarch64_linux_android: path.join(binDir, `aarch64-linux-android${api}-clang++${ext}`),
		AR_aarch64_linux_android: path.join(binDir, `llvm-ar${arExt}`),
		CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER: path.join(binDir, `aarch64-linux-android${api}-clang${ext}`),
		CC_x86_64_linux_android: path.join(binDir, `x86_64-linux-android${api}-clang${ext}`),
		CXX_x86_64_linux_android: path.join(binDir, `x86_64-linux-android${api}-clang++${ext}`),
		AR_x86_64_linux_android: path.join(binDir, `llvm-ar${arExt}`),
		CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER: path.join(binDir, `x86_64-linux-android${api}-clang${ext}`),
	};

	// 4. Beide Architekturen mit Cargo bauen und nach jniLibs kopieren
	const targets = [
		{ rust: "aarch64-linux-android", abi: "arm64-v8a" },
		{ rust: "x86_64-linux-android", abi: "x86_64" },
	];

	for (const t of targets) {
		run(`cargo build --profile native --target ${t.rust} -p impala-ffi`, coreDir, ndkEnv);
		const outDir = path.join(jniLibsDir, t.abi);
		fs.mkdirSync(outDir, { recursive: true });
		const srcSo = path.join(coreDir, "target", t.rust, "native", "libimpala_ffi.so");
		const dstSo = path.join(outDir, "libimpala_ffi.so");
		fs.copyFileSync(srcSo, dstSo);
		console.log(`Kopiert: ${dstSo} (${fs.statSync(dstSo).size} Bytes)`);
	}

	console.log("=== Native Android Rust-Libraries erfolgreich gebaut ===");
}
