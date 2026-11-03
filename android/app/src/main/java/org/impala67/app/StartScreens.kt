package org.impala67.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize

/** Nach so vielen ms Start zeigt die App einen Hinweis (index.html `#bootSplash`: 12 s). */
internal const val SLOW_START_MS = 12_000L

/** Kern lädt noch: Ladeanzeige, nach [SLOW_START_MS] mit Hinweis. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
internal fun StartWaiting() {
    var slow by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(SLOW_START_MS); slow = true }
    Column(
        Modifier.fillMaxSize().background(Impala.colors.panel).padding(Space.s6),
        verticalArrangement = Arrangement.spacedBy(Space.s4, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        LoadingIndicator()
        if (slow) {
            Text(
                "Der Start dauert ungewöhnlich lange … Große Datenmengen werden noch geladen.",
                Modifier.widthIn(max = 420.dp), color = Impala.colors.text2, fontSize = TextSize.sm, textAlign = TextAlign.Center,
            )
        }
    }
}

/** Unerwarteter Fehler beim Öffnen des Kerns (index.html `recordAppError`): Meldung statt Absturz. */
@Composable
internal fun StartError(error: Throwable?) {
    val c = Impala.colors
    Box(Modifier.fillMaxSize().background(c.panel).padding(Space.s6), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 480.dp), verticalArrangement = Arrangement.spacedBy(Space.s3)) {
            Text("Impala67 konnte nicht starten", style = MaterialTheme.typography.headlineSmall, color = c.text)
            Text(
                "Deine Daten bleiben auf dem Gerät erhalten. Starte die App neu; hilft das nicht, installiere die neueste Version.",
                color = c.text2, fontSize = TextSize.sm,
            )
            Text(error?.message ?: error?.javaClass?.simpleName ?: "Unbekannter Fehler", color = c.danger, fontSize = TextSize.xs)
        }
    }
}
