package org.impala67.app.data

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Sichere Speicherung sensibler Zugangsdaten (Cloudflare-Sync-Schlüssel, Google Drive Tokens).
 * Nutzt EncryptedSharedPreferences mit automatischem Fallback bei Geräten mit defektem Keystore.
 */
class SecurePrefs(context: Context) {

    companion object {
        private const val TAG = "SecurePrefs"
        private const val PREFS_FILE = "impala67_secure_prefs"
        private const val PREFS_FILE_FALLBACK = "impala67_prefs_fallback"

        private const val KEY_CF_SYNC_KEY = "cf_sync_key"
        private const val KEY_CF_WORKER_URL = "cf_worker_url"
        private const val KEY_DRIVE_ACCESS_TOKEN = "drive_access_token"
        private const val KEY_DRIVE_ACCOUNT_EMAIL = "drive_account_email"
        private const val KEY_MIGRATION_DONE = "migration_done"

        const val DEFAULT_CF_WORKER_URL = "https://impala67-sync.joshua-impala67.workers.dev"
    }

    private val prefs: SharedPreferences = createEncryptedOrFallback(context.applicationContext)

    private fun createEncryptedOrFallback(ctx: Context): SharedPreferences {
        return try {
            val masterKey = MasterKey.Builder(ctx)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            EncryptedSharedPreferences.create(
                ctx,
                PREFS_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            Log.w(TAG, "EncryptedSharedPreferences fehlgeschlagen, nutze Standard-Prefs Fallback", e)
            ctx.getSharedPreferences(PREFS_FILE_FALLBACK, Context.MODE_PRIVATE)
        }
    }

    /**
     * E2EE-Sync-Schlüssel für Cloudflare Live-Sync.
     */
    var cfSyncKey: String?
        get() = prefs.getString(KEY_CF_SYNC_KEY, null)
        set(value) = prefs.edit().apply {
            if (value != null) putString(KEY_CF_SYNC_KEY, value) else remove(KEY_CF_SYNC_KEY)
        }.apply()

    /**
     * URL des Cloudflare Workers (Standardwert falls nicht angepasst).
     */
    var cfWorkerUrl: String?
        get() = prefs.getString(KEY_CF_WORKER_URL, DEFAULT_CF_WORKER_URL)
        set(value) = prefs.edit().apply {
            if (value != null) putString(KEY_CF_WORKER_URL, value) else remove(KEY_CF_WORKER_URL)
        }.apply()

    /**
     * Aktuelles Google Drive OAuth2 Access-Token.
     */
    var driveAccessToken: String?
        get() = prefs.getString(KEY_DRIVE_ACCESS_TOKEN, null)
        set(value) = prefs.edit().apply {
            if (value != null) putString(KEY_DRIVE_ACCESS_TOKEN, value) else remove(KEY_DRIVE_ACCESS_TOKEN)
        }.apply()

    /**
     * Angemeldete Google-Konto E-Mail-Adresse.
     */
    var driveAccountEmail: String?
        get() = prefs.getString(KEY_DRIVE_ACCOUNT_EMAIL, null)
        set(value) = prefs.edit().apply {
            if (value != null) putString(KEY_DRIVE_ACCOUNT_EMAIL, value) else remove(KEY_DRIVE_ACCOUNT_EMAIL)
        }.apply()

    /**
     * Gibt an, ob die einmalige Migration aus der alten Capacitor WebView bereits stattfand.
     */
    var migrationDone: Boolean
        get() = prefs.getBoolean(KEY_MIGRATION_DONE, false)
        set(value) = prefs.edit().putBoolean(KEY_MIGRATION_DONE, value).apply()

    /**
     * Löscht alle Drive-bezogenen Tokens und Konto-Informationen.
     */
    fun clearDriveTokens() {
        prefs.edit()
            .remove(KEY_DRIVE_ACCESS_TOKEN)
            .remove(KEY_DRIVE_ACCOUNT_EMAIL)
            .apply()
    }
}
