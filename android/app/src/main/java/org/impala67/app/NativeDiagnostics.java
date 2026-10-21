package org.impala67.app;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.webkit.WebView;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// Native Gründe für Neustarts (Prozess beendet, WebView abgestürzt, Activity neu erstellt) für das
// Leistungsprotokoll der Web-App sammeln. Die Einträge warten in SharedPreferences, bis eine Seite
// geladen ist, und gehen dann an window.__IMPALA_NATIVE_DIAG__ (performance-profiler.js liest sie).
final class NativeDiagnostics {

    private static final String PREFS = "impala67_native_diag";
    private static final String PENDING = "pending";
    private static final String LAST_EXIT = "lastExitTs";
    private static final int MAX_PENDING = 20;

    // Index = ApplicationExitInfo.REASON_*
    private static final String[] EXIT_REASONS = {
        "unknown", "exit-self", "signaled", "low-memory", "crash", "crash-native", "anr",
        "initialization-failure", "permission-change", "excessive-resource-usage", "user-requested",
        "user-stopped", "dependency-died", "other", "freezer", "package-state-change", "package-updated",
    };

    private NativeDiagnostics() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void note(Context context, String kind, JSONObject data) {
        try {
            JSONObject entry = data != null ? data : new JSONObject();
            entry.put("kind", kind);
            if (!entry.has("atMs")) entry.put("atMs", System.currentTimeMillis());
            SharedPreferences p = prefs(context);
            JSONArray pending = new JSONArray(p.getString(PENDING, "[]"));
            pending.put(entry);
            while (pending.length() > MAX_PENDING) pending.remove(0);
            // commit statt apply: Der Prozess kann direkt danach sterben
            p.edit().putString(PENDING, pending.toString()).commit();
        } catch (JSONException ignored) {
        }
    }

    // Warum ist der letzte App-Prozess beendet worden? (ab Android 11)
    static void collectExitReasons(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        try {
            ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            List<ApplicationExitInfo> infos = am.getHistoricalProcessExitReasons(null, 0, 5);
            SharedPreferences p = prefs(context);
            long lastSeen = p.getLong(LAST_EXIT, 0);
            long newest = lastSeen;
            for (ApplicationExitInfo info : infos) {
                if (info.getTimestamp() <= lastSeen) continue;
                newest = Math.max(newest, info.getTimestamp());
                // Beim allerersten Start nur den Stand merken, keine alten Einträge melden
                if (lastSeen == 0) continue;
                int reason = info.getReason();
                JSONObject entry = new JSONObject();
                entry.put("name", reason >= 0 && reason < EXIT_REASONS.length ? EXIT_REASONS[reason] : "reason-" + reason);
                entry.put("description", info.getDescription() != null ? info.getDescription() : "");
                entry.put("importance", info.getImportance());
                entry.put("pssMb", info.getPss() / 1024);
                entry.put("rssMb", info.getRss() / 1024);
                entry.put("atMs", info.getTimestamp());
                note(context, "native-app-exit", entry);
            }
            p.edit().putLong(LAST_EXIT, Math.max(newest, 1)).apply();
        } catch (Exception ignored) {
        }
    }

    // Wartende Einträge an die geladene Seite übergeben
    static void deliver(Context context, WebView webView) {
        SharedPreferences p = prefs(context);
        String pending = p.getString(PENDING, "[]");
        if ("[]".equals(pending)) return;
        p.edit().remove(PENDING).apply();
        webView.evaluateJavascript(
            "window.__IMPALA_NATIVE_DIAG__=(window.__IMPALA_NATIVE_DIAG__||[]).concat(" + pending + ");"
                + "window.dispatchEvent(new Event('impala-native-diag'));",
            null
        );
    }
}
