// Rust-Kern für die native iPad-App: erzeugt die Swift-Bindings (ios/Impala67/Core/Generated/impala_ffi.swift,
// ios/Bindings/impala_ffiFFI.h + module.modulemap) und baut auf macOS die statische Bibliothek
// ios/Frameworks/libimpala_ffi.a (aarch64-apple-ios, iPad/iPhone).
// Aufruf nach Änderungen in core/impala-ffi: npm run build:ios-core
// Unter Windows/Linux entstehen nur die Bindings (wie bei Android aus der Host-Bibliothek); die
// Bibliothek baut die CI auf einem macOS-Runner (.github/workflows/ios-build.yml).
// Mit --bindings-only auch auf macOS nur die Bindings.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const core = path.join(root, "core");
const ios = path.join(root, "ios");
const run = (cmd, cwd = root) => {
	console.log(`> ${cmd}`);
	execSync(cmd, { cwd, stdio: "inherit" });
};

// 1. Swift-Bindings aus der Host-Bibliothek
run("cargo build -p impala-ffi --lib", core);
const lib = { win32: "impala_ffi.dll", darwin: "libimpala_ffi.dylib" }[process.platform] || "libimpala_ffi.so";
const out = fs.mkdtempSync(path.join(os.tmpdir(), "impala-bindgen-"));
run(`cargo run -q -p impala-ffi --bin uniffi-bindgen -- generate --library ${JSON.stringify(path.join(core, "target", "debug", lib))} --language swift --out-dir ${JSON.stringify(out)} --no-format`, core);
const swiftDir = path.join(ios, "Impala67", "Core", "Generated");
const headerDir = path.join(ios, "Bindings");
fs.mkdirSync(swiftDir, { recursive: true });
fs.mkdirSync(headerDir, { recursive: true });
fs.copyFileSync(path.join(out, "impala_ffi.swift"), path.join(swiftDir, "impala_ffi.swift"));
fs.copyFileSync(path.join(out, "impala_ffiFFI.h"), path.join(headerDir, "impala_ffiFFI.h"));
// Xcode findet das C-Modul über SWIFT_INCLUDE_PATHS nur unter dem Namen module.modulemap.
fs.copyFileSync(path.join(out, "impala_ffiFFI.modulemap"), path.join(headerDir, "module.modulemap"));
fs.rmSync(out, { recursive: true, force: true });
console.log(`Bindings: ${path.relative(root, swiftDir)}, ${path.relative(root, headerDir)}`);

// 2. Statische Bibliothek fürs Gerät (nur macOS: braucht das iOS-SDK aus Xcode)
if (process.platform !== "darwin" || process.argv.includes("--bindings-only")) {
	console.log("Bibliothek übersprungen (nur auf macOS bzw. in der CI).");
	process.exit(0);
}
const target = "aarch64-apple-ios";
run(`rustup target add ${target}`);
run(`cargo build --profile native --target ${target} -p impala-ffi`, core);
const frameworks = path.join(ios, "Frameworks");
fs.mkdirSync(frameworks, { recursive: true });
const dst = path.join(frameworks, "libimpala_ffi.a");
fs.copyFileSync(path.join(core, "target", target, "native", "libimpala_ffi.a"), dst);
console.log(`Kopiert: ${path.relative(root, dst)} (${fs.statSync(dst).size} Bytes)`);
