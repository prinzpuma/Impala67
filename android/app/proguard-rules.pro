# ProGuard-Regeln für Impala67 (UniFFI + JNA + Rust-Kern)
-dontobfuscate
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-keep class uniffi.** { *; }
-keep class * implements androidx.navigation3.runtime.NavKey { *; }
-dontwarn java.awt.**
