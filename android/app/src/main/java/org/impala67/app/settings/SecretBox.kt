package org.impala67.app.settings

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Verschlüsselt Geheimnisse in [DevicePrefs] mit einem Schlüssel aus dem Android Keystore
 * (AES-256-GCM). Der Keystore-Schlüssel verlässt das Gerät nie: Eine Sicherung der Einstellungen
 * lässt sich auf einem anderen Gerät nicht entschlüsseln – dort gilt das Gerät dann als nicht gekoppelt.
 */
internal object SecretBox {
    private const val ALIAS = "impala67_device_prefs"
    private const val PREFIX = "ks1:"
    private const val IV_BYTES = 12

    fun seal(plain: String): String {
        if (plain.isEmpty()) return ""
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.iv + cipher.doFinal(plain.toByteArray())
        return PREFIX + Base64.encodeToString(sealed, Base64.NO_WRAP)
    }

    /**
     * Gegenstück zu [seal]. Werte ohne Präfix stammen aus Versionen vor der Verschlüsselung und werden
     * unverändert geliefert (beim nächsten Schreiben verschlüsselt). Nicht lesbar (fremdes Gerät,
     * Keystore zurückgesetzt): `null`.
     */
    fun open(stored: String): String? {
        if (!stored.startsWith(PREFIX)) return stored
        return runCatching {
            val sealed = Base64.decode(stored.removePrefix(PREFIX), Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, IV_BYTES))
            String(cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES))
        }.getOrNull()
    }

    @Synchronized
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply { init(spec) }
            .generateKey()
    }
}
