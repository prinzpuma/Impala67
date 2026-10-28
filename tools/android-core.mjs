// Rust-Kern für die native Android-App: .so-Dateien (arm64-v8a, x86_64) nach android/app/src/main/jniLibs
// und die Kotlin-Bindings neu erzeugen (android/app/src/main/java/uniffi/impala_ffi/impala_ffi.kt).
// Aufruf nach Änderungen in core/impala-ffi: node tools/android-core.mjs (braucht ANDROID_HOME mit NDK).
// Die Bindings entstehen aus der Host-Bibliothek: uniffi-bindgen liest eine Android-.so unter Windows nicht.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const core = path.join(root, "core");
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });

run(`node ${JSON.stringify(path.join(root, ".github", "scripts", "build-android-rust.mjs"))} --build-ndk`);

run("cargo build -p impala-ffi --lib", core);
const lib = { win32: "impala_ffi.dll", darwin: "libimpala_ffi.dylib" }[process.platform] || "libimpala_ffi.so";
const out = fs.mkdtempSync(path.join(os.tmpdir(), "impala-bindgen-"));
run(`cargo run -q -p impala-ffi --bin uniffi-bindgen -- generate --library ${JSON.stringify(path.join(core, "target", "debug", lib))} --language kotlin --out-dir ${JSON.stringify(out)} --no-format`, core);
const generated = path.join(out, "uniffi", "impala_ffi", "impala_ffi.kt");
const target = path.join(root, "android", "app", "src", "main", "java", "uniffi", "impala_ffi", "impala_ffi.kt");
fs.copyFileSync(generated, target);
fs.rmSync(out, { recursive: true, force: true });
console.log(`Bindings: ${path.relative(root, target)}`);
