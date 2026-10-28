package org.impala67.app.data

import android.content.Context
import android.util.Log
import java.io.File

/**
 * Einmaliger Migrator beim Wechsel von der alten Capacitor-WebView auf die native Android-App.
 * Scannt die Chromium LevelDB-Dateien von LocalStorage nach Sync-Schlüssel, Worker-URL und Drive-Konto.
 */
object WebViewMigrator {

    private const val TAG = "WebViewMigrator"

    private val SYNC_KEY_REGEX = Regex("""[A-Za-z0-9_\-]{24,128}""")
    private val WORKER_URL_REGEX = Regex("""https://[a-zA-Z0-9.\-_]+(?::\d+)?(?:/[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=]*)?""")
    private val DRIVE_EMAIL_REGEX = Regex("""[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}""")

    /**
     * Führt die Migration aus, falls sie noch nicht als erledigt markiert ist.
     */
    fun migrateIfNeeded(context: Context, securePrefs: SecurePrefs) {
        if (securePrefs.migrationDone) {
            return
        }

        try {
            val appDataDir = context.applicationInfo.dataDir
            val webViewDir = File(appDataDir, "app_webview")
            if (!webViewDir.exists() || !webViewDir.isDirectory) {
                Log.d(TAG, "Keine WebView-Daten unter $webViewDir vorhanden")
                securePrefs.migrationDone = true
                return
            }

            val levelDbFiles = mutableListOf<File>()
            collectLevelDbFiles(webViewDir, levelDbFiles)

            if (levelDbFiles.isEmpty()) {
                Log.d(TAG, "Keine .ldb oder .log Dateien in app_webview gefunden")
                securePrefs.migrationDone = true
                return
            }

            var foundSyncKey: String? = null
            var foundWorkerUrl: String? = null
            var foundDriveEmail: String? = null

            for (file in levelDbFiles) {
                try {
                    // Dateien über 20 MB überspringen, um Speicherüberläufe zu vermeiden
                    if (file.length() > 20 * 1024 * 1024) continue
                    val bytes = file.readBytes()

                    if (foundSyncKey == null) {
                        foundSyncKey = extractValue(bytes, "impala67_cf_sync_key", SYNC_KEY_REGEX)
                    }
                    if (foundWorkerUrl == null) {
                        foundWorkerUrl = extractValue(bytes, "impala67_cf_server_url", WORKER_URL_REGEX)
                    }
                    if (foundDriveEmail == null) {
                        foundDriveEmail = extractValue(bytes, "impala67_drive_email", DRIVE_EMAIL_REGEX)
                    }

                    if (foundSyncKey != null && foundWorkerUrl != null && foundDriveEmail != null) {
                        break
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Konnte ${file.absolutePath} nicht lesen", e)
                }
            }

            // Gefundene Werte übernehmen falls in SecurePrefs noch leer
            if (!foundSyncKey.isNullOrBlank() && securePrefs.cfSyncKey.isNullOrBlank()) {
                Log.i(TAG, "Sync-Schlüssel aus WebView-LocalStorage erfolgreich migriert")
                securePrefs.cfSyncKey = foundSyncKey
            }
            if (!foundWorkerUrl.isNullOrBlank() && (securePrefs.cfWorkerUrl.isNullOrBlank() || securePrefs.cfWorkerUrl == SecurePrefs.DEFAULT_CF_WORKER_URL)) {
                Log.i(TAG, "Worker-URL aus WebView-LocalStorage migriert: $foundWorkerUrl")
                securePrefs.cfWorkerUrl = foundWorkerUrl
            }
            if (!foundDriveEmail.isNullOrBlank() && securePrefs.driveAccountEmail.isNullOrBlank()) {
                Log.i(TAG, "Drive-E-Mail aus WebView-LocalStorage migriert: $foundDriveEmail")
                securePrefs.driveAccountEmail = foundDriveEmail
            }

        } catch (e: Exception) {
            Log.e(TAG, "Fehler während der WebView-Migration", e)
        } finally {
            securePrefs.migrationDone = true
        }
    }

    /**
     * Rekursives Sammeln aller .ldb- und .log-Dateien.
     */
    private fun collectLevelDbFiles(dir: File, result: MutableList<File>) {
        val files = dir.listFiles() ?: return
        for (file in files) {
            if (file.isDirectory) {
                collectLevelDbFiles(file, result)
            } else {
                val name = file.name.lowercase()
                if (name.endsWith(".ldb") || name.endsWith(".log")) {
                    result.add(file)
                }
            }
        }
    }

    /**
     * Sucht nach einem Schlüssel in UTF-8 und UTF-16LE und extrahiert den nachfolgenden Wert per Regex.
     */
    private fun extractValue(bytes: ByteArray, key: String, regex: Regex): String? {
        // 1. Suche nach UTF-8 / Latin1 Schlüssel
        val latin1 = String(bytes, Charsets.ISO_8859_1)
        val idxUtf8 = latin1.indexOf(key)
        if (idxUtf8 != -1) {
            val start = idxUtf8 + key.length
            val end = (start + 256).coerceAtMost(latin1.length)
            val snippet = latin1.substring(start, end)
            val match = regex.find(snippet)
            if (match != null) {
                return match.value
            }
        }

        // 2. Suche nach UTF-16LE kodiertem Schlüssel (Chromium speichert manche Strings UTF-16LE)
        val keyUtf16Bytes = key.toByteArray(Charsets.UTF_16LE)
        val keyUtf16Pattern = String(keyUtf16Bytes, Charsets.ISO_8859_1)
        val idxUtf16 = latin1.indexOf(keyUtf16Pattern)
        if (idxUtf16 != -1) {
            val start = idxUtf16 + keyUtf16Pattern.length
            val end = (start + 512).coerceAtMost(latin1.length)
            val snippetUtf16 = latin1.substring(start, end)
            // Null-Bytes entfernen für ASCII-Regex
            val cleaned = snippetUtf16.replace("\u0000", "")
            val match = regex.find(cleaned)
            if (match != null) {
                return match.value
            }
        }

        return null
    }
}
