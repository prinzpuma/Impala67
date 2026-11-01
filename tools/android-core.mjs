// Rust-Kern für die native Android-App: baut impala-ffi mit dem Android-NDK (arm64-v8a, x86_64) nach
// android/app/src/main/jniLibs und erzeugt die Kotlin-Bindings neu
// (android/app/src/main/java/uniffi/impala_ffi/impala_ffi.kt).
// Aufruf nach Änderungen in core/impala-ffi: npm run build:android-core (braucht ANDROID_HOME mit NDK).
// In der CI prüft anschließend `git diff --exit-code` auf die Bindings, ob sie mitcommittet wurden.
// Die Bindings entstehen aus der Host-Bibliothek: uniffi-bindgen liest eine Android-.so unter Windows nicht.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const core = path.join(root, "core");
const run = (cmd, cwd = root, env = {}) => {
	console.log(`> ${cmd}`);
	execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
};

// 1. NDK finden (fehlt es, über sdkmanager installieren)
const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdkRoot) throw new Error("ANDROID_HOME / ANDROID_SDK_ROOT ist nicht gesetzt.");
const ndkDir = path.join(sdkRoot, "ndk");
if (!fs.existsSync(ndkDir) || fs.readdirSync(ndkDir).length === 0) {
	const sdkmanager = path.join(sdkRoot, "cmdline-tools", "latest", "bin", process.platform === "win32" ? "sdkmanager.bat" : "sdkmanager");
	run(`"${sdkmanager}" "ndk;27.2.12479018"`);
}
const ndk = path.join(ndkDir, fs.readdirSync(ndkDir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1));
const prebuilt = path.join(ndk, "toolchains", "llvm", "prebuilt");
const bin = path.join(prebuilt, fs.readdirSync(prebuilt)[0], "bin");
console.log(`NDK: ${ndk}`);

// 2. Rust-Ziele und Compiler/Linker für cc-rs (rusqlite bundled) und rustc
run("rustup target add aarch64-linux-android x86_64-linux-android");
const api = 26; // = minSdk in android/app/build.gradle.kts
const cmd = process.platform === "win32" ? ".cmd" : "";
const exe = process.platform === "win32" ? ".exe" : "";
const targets = [
	{ rust: "aarch64-linux-android", abi: "arm64-v8a" },
	{ rust: "x86_64-linux-android", abi: "x86_64" },
];
const env = { ANDROID_NDK_HOME: ndk, ANDROID_NDK_ROOT: ndk };
for (const { rust } of targets) {
	const under = rust.replaceAll("-", "_");
	const clang = path.join(bin, `${rust}${api}-clang${cmd}`);
	env[`CC_${under}`] = clang;
	env[`CXX_${under}`] = path.join(bin, `${rust}${api}-clang++${cmd}`);
	env[`AR_${under}`] = path.join(bin, `llvm-ar${exe}`);
	env[`CARGO_TARGET_${under.toUpperCase()}_LINKER`] = clang;
}

// 3. Beide Architekturen bauen und nach jniLibs kopieren
for (const t of targets) {
	run(`cargo build --profile native --target ${t.rust} -p impala-ffi`, core, env);
	const outDir = path.join(root, "android", "app", "src", "main", "jniLibs", t.abi);
	fs.mkdirSync(outDir, { recursive: true });
	const dst = path.join(outDir, "libimpala_ffi.so");
	fs.copyFileSync(path.join(core, "target", t.rust, "native", "libimpala_ffi.so"), dst);
	console.log(`Kopiert: ${path.relative(root, dst)} (${fs.statSync(dst).size} Bytes)`);
}

// 4. Kotlin-Bindings aus der Host-Bibliothek erzeugen
run("cargo build -p impala-ffi --lib", core);
const lib = { win32: "impala_ffi.dll", darwin: "libimpala_ffi.dylib" }[process.platform] || "libimpala_ffi.so";
const out = fs.mkdtempSync(path.join(os.tmpdir(), "impala-bindgen-"));
run(`cargo run -q -p impala-ffi --bin uniffi-bindgen -- generate --library ${JSON.stringify(path.join(core, "target", "debug", lib))} --language kotlin --out-dir ${JSON.stringify(out)} --no-format`, core);
const target = path.join(root, "android", "app", "src", "main", "java", "uniffi", "impala_ffi", "impala_ffi.kt");
fs.copyFileSync(path.join(out, "uniffi", "impala_ffi", "impala_ffi.kt"), target);
fs.rmSync(out, { recursive: true, force: true });
console.log(`Bindings: ${path.relative(root, target)}`);
