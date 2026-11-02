package org.impala67.app.ai

import kotlinx.coroutines.flow.first
import org.impala67.app.core.ImpalaStore
import org.impala67.app.settings.DevicePrefs
import uniffi.impala_ffi.AiAssistant
import uniffi.impala_ffi.AiOptions

/**
 * Einfache KI-Antwort ohne Chat und Werkzeuge (`AI.complete` der PWA) mit Quelle und Modell aus den
 * Einstellungen. Wirft bei Netz- oder Anbieterfehlern.
 */
suspend fun aiComplete(store: ImpalaStore, prefs: DevicePrefs, prompt: String, system: String? = null): String {
    val syncKey = prefs.cfSyncKey.first().takeIf { it.isNotBlank() }
    return store.write { core ->
        AiAssistant(core, AiOptions(null, null, null, null, null, null, syncKey, null), null, null).use { it.complete(prompt, system) }
    }
}

/** Erstes JSON-Objekt bzw. -Array in einer KI-Antwort (Modelle schreiben oft Text drumherum). */
fun jsonIn(raw: String, array: Boolean = false): String? =
    Regex(if (array) "\\[[\\s\\S]*\\]" else "\\{[\\s\\S]*\\}").find(raw)?.value
