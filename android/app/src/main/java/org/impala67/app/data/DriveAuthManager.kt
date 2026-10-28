package org.impala67.app.data

import android.accounts.Account
import android.content.Context
import android.util.Log
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.impala_ffi.DriveTokens

/**
 * Verwaltet Google Sign-In und OAuth2-Zugriffstokens für Google Drive (AppData & File Scopes).
 * Implementiert die UniFFI-Schnittstelle DriveTokens für den Rust-Sync-Kern.
 */
class DriveAuthManager(
    private val context: Context,
    private val securePrefs: SecurePrefs
) : DriveTokens {

    companion object {
        private const val TAG = "DriveAuthManager"
        const val SCOPE_DRIVE_APPDATA = "https://www.googleapis.com/auth/drive.appdata"
        const val SCOPE_DRIVE_FILE = "https://www.googleapis.com/auth/drive.file"
        private const val OAUTH_SCOPE_STRING = "oauth2:$SCOPE_DRIVE_APPDATA $SCOPE_DRIVE_FILE"
    }

    /**
     * Gültiges Zugriffstoken oder null (wird synchron vom Drive-Thread aufgerufen).
     */
    override fun accessToken(): String? {
        val cached = securePrefs.driveAccessToken
        if (!cached.isNullOrBlank()) {
            return cached
        }
        return fetchTokenInternal()
    }

    /**
     * Drive meldete HTTP 401 für rejected: löscht altes Token still und fordert ein frisches an.
     */
    override fun renewToken(rejected: String): String? {
        try {
            GoogleAuthUtil.clearToken(context, rejected)
        } catch (e: Exception) {
            Log.w(TAG, "clearToken für abgelehntes Token fehlgeschlagen", e)
        }
        securePrefs.driveAccessToken = null
        return fetchTokenInternal()
    }

    /**
     * Token ist abgelaufen und kann still nicht erneuert werden.
     */
    override fun tokenExpired() {
        Log.w(TAG, "Google Drive Token als abgelaufen markiert")
        securePrefs.driveAccessToken = null
    }

    /**
     * Prüft, ob ein Google-Konto für Drive-Backup hinterlegt ist.
     */
    fun isConfigured(): Boolean {
        return !securePrefs.driveAccountEmail.isNullOrBlank() || GoogleSignIn.getLastSignedInAccount(context) != null
    }

    /**
     * Liefert die E-Mail des angemeldeten Drive-Kontos.
     */
    fun currentEmail(): String? {
        return securePrefs.driveAccountEmail ?: GoogleSignIn.getLastSignedInAccount(context)?.email
    }

    /**
     * Konfiguration für den Google Sign-In Intent im Client.
     */
    fun getSignInOptions(): GoogleSignInOptions {
        return GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestEmail()
            .requestScopes(Scope(SCOPE_DRIVE_APPDATA), Scope(SCOPE_DRIVE_FILE))
            .build()
    }

    /**
     * Übernimmt ein neues Konto nach erfolgreichem Login in der UI.
     */
    suspend fun onSignedIn(account: GoogleSignInAccount): Boolean = withContext(Dispatchers.IO) {
        val email = account.email ?: return@withContext false
        securePrefs.driveAccountEmail = email
        securePrefs.driveAccessToken = null
        val token = fetchTokenInternal()
        token != null
    }

    /**
     * Meldet das Drive-Konto lokal ab.
     */
    fun signOut() {
        securePrefs.clearDriveTokens()
    }

    /**
     * Holt synchron ein OAuth2-Token über GoogleAuthUtil.
     */
    private fun fetchTokenInternal(): String? {
        val email = securePrefs.driveAccountEmail
            ?: GoogleSignIn.getLastSignedInAccount(context)?.email
            ?: return null

        return try {
            val account = Account(email, "com.google")
            val token = GoogleAuthUtil.getToken(context, account, OAUTH_SCOPE_STRING)
            if (!token.isNullOrBlank()) {
                securePrefs.driveAccessToken = token
                securePrefs.driveAccountEmail = email
            }
            token
        } catch (e: Exception) {
            Log.e(TAG, "Fehler beim Beziehen des Google Drive Access Tokens", e)
            null
        }
    }
}
