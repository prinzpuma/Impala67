# ProGuard-Regeln für Impala67 (UniFFI + JNA + Rust-Kern)
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-keep class uniffi.** { *; }
-dontwarn java.awt.**
