# ProGuard-Regeln für Impala67 (UniFFI + JNA + Rust-Kern)
-dontobfuscate
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-keep class uniffi.** { *; }
-keep class * implements androidx.navigation3.runtime.NavKey { *; }
-dontwarn java.awt.**
# ML Kit (Digital Ink) lädt Komponenten per Reflexion – R8 darf nichts entfernen/umbauen
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_digital_ink.** { *; }
-keep class com.google.android.gms.internal.mlkit_common.** { *; }
