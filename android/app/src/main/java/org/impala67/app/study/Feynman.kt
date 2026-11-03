package org.impala67.app.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.ai.aiComplete
import org.impala67.app.ai.jsonIn
import org.impala67.app.ai.rememberDictation
import org.impala67.app.core.ImpalaStore
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.components.TintLabel
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import org.json.JSONArray
import org.json.JSONObject
import uniffi.impala_ffi.CardInfo

/** Ergebnis der KI-Prüfung (experimente.js `checkFeynman`): Rubrik und vorgeschlagene Note 1–4. */
data class FeynmanVerdict(
    val cardId: String,
    val hit: List<String>,
    val missing: List<String>,
    val wrong: List<String>,
    val comment: String,
    val note: Int,
)

private val GRADE_NAMES = mapOf(1 to "Nochmal", 2 to "Schwer", 3 to "Gut", 4 to "Einfach")

/** Erklärung gegen die Rückseite prüfen lassen (gleicher Prompt wie die PWA). Wirft bei KI-Fehlern. */
suspend fun checkFeynman(store: ImpalaStore, prefs: DevicePrefs, card: CardInfo, explanation: String): FeynmanVerdict {
    val raw = aiComplete(
        store, prefs,
        "Karteikarte:\nFrage: ${card.front}\nMusterantwort: ${card.back}\n\nErklärung des Lernenden:\n${explanation.trim()}" +
            "\n\nBewerte die Erklärung als Rubrik. Antworte NUR als JSON:\n" +
            """{"getroffen":["Kernpunkt …"],"fehlend":["…"],"falsch":["…"],"note":3,"kommentar":"1–2 Sätze"}""" +
            "\nnote: 1=Nochmal, 2=Schwer, 3=Gut, 4=Einfach.",
        "Du bist ein knapper, präziser Lern-Coach. Antworte auf Deutsch.",
    )
    val j = runCatching { JSONObject(jsonIn(raw) ?: "{}") }.getOrDefault(JSONObject())
    fun list(key: String) = (j.optJSONArray(key) ?: JSONArray()).let { a -> List(a.length()) { a.optString(it) }.filter { it.isNotBlank() } }
    val note = j.optInt("note", 3).takeIf { it in 1..4 } ?: 3
    return FeynmanVerdict(card.id, list("getroffen"), list("fehlend"), list("falsch"), j.optString("kommentar"), note)
}

/**
 * Erklär-Feld im Feynman-Lernmodus (render-anki.js `.feyn-inline`): tippen oder diktieren, Strg+Enter
 * prüft. „Prüfen & aufdecken“ deckt nach der Prüfung auf; „Ohne Erklärung aufdecken“ direkt.
 */
@Composable
fun FeynmanInput(text: String, onText: (String) -> Unit, checking: Boolean, onCheck: () -> Unit, onReveal: () -> Unit) {
    val c = Impala.colors
    val dictation = rememberDictation(onPartial = {}, onFinal = { said -> if (said.isNotBlank()) onText((text.trimEnd() + " " + said).trim()) })
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s2)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(R.drawable.ic_i_explain), null, Modifier.size(16.dp), tint = c.text2)
            Text("  Erkläre die Antwort in eigenen Worten — so einfach, dass es ein Kind versteht.", color = c.text2, fontSize = TextSize.sm)
        }
        OutlinedTextField(
            text, onText,
            Modifier.fillMaxWidth().heightIn(min = 110.dp).onPreviewKeyEvent { e ->
                if (e.type == KeyEventType.KeyDown && e.isCtrlPressed && e.key == Key.Enter) { onCheck(); true } else false
            },
            placeholder = { Text("Meine Erklärung … (Strg+Enter = prüfen)") },
            enabled = !checking,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s2), verticalAlignment = Alignment.CenterVertically) {
            TintButton({ dictation.toggle() }, strong = false) {
                Icon(painterResource(R.drawable.ic_i_mic), null, Modifier.size(16.dp))
                TintLabel(if (dictation.listening) "  Stopp" else "  Diktieren", strong = false)
            }
            TintButton({ if (!checking) onCheck() }) { TintLabel(if (checking) "Prüfe …" else "Prüfen & aufdecken") }
            TextButton(onReveal, Modifier.weight(1f, fill = false)) { Text("Ohne Erklärung aufdecken", color = c.text2, fontSize = TextSize.sm) }
        }
    }
}

/** Rubrik der KI über den Bewertungs-Buttons (experimente.js `verdictHtml`). */
@Composable
fun FeynmanFeedback(v: FeynmanVerdict) {
    val c = Impala.colors
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.md)).background(c.surfaceSubtle).padding(Space.s3),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        v.hit.forEach { Text("✓ $it", color = c.success, fontSize = TextSize.sm) }
        v.missing.forEach { Text("! fehlt: $it", color = c.warn, fontSize = TextSize.sm) }
        v.wrong.forEach { Text("✗ $it", color = c.danger, fontSize = TextSize.sm) }
        if (v.comment.isNotBlank()) Text(v.comment, color = c.text, fontSize = TextSize.sm)
        Text(
            "KI-Vorschlag: „${GRADE_NAMES[v.note]}“ — bestätige mit den Bewertungs-Buttons. Die Entscheidung bleibt bei dir.",
            color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold,
        )
    }
}
