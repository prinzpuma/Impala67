package org.impala67.app.heft

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.TextSize

/**
 * Kopfzeile auf dem Telefon (mobile-view.js): Zurück, Titel mit „Seite x von y“, Rückgängig und
 * Wiederholen (stehen auf dem Telefon nicht in der Kapsel, heft-toolbar-ui.js), Bearbeiten/Fertig für den
 * Lesemodus und der KI-Assistent.
 * Seiten und „+“ schweben unten in den Ecken, in Daumennähe.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun HeftTopBar(
    title: String,
    pageLabel: String,
    onBack: () -> Unit,
    canUndo: Boolean,
    canRedo: Boolean,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    reading: Boolean,
    onReading: (Boolean) -> Unit,
    onAi: (() -> Unit)?,
) {
    val motion = MaterialTheme.motionScheme
    TopAppBar(
        title = {
            Column {
                Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                AnimatedContent(
                    pageLabel,
                    transitionSpec = { fadeIn(motion.fastEffectsSpec()) togetherWith fadeOut(motion.fastEffectsSpec()) },
                    label = "heft-page-label",
                ) { Text(it, color = Impala.colors.text2, fontSize = TextSize.xs, maxLines = 1) }
            }
        },
        navigationIcon = {
            IconButton(onBack, shapes = IconButtonDefaults.shapes()) {
                Icon(painterResource(R.drawable.ic_i_chevron_left), "Zurück")
            }
        },
        actions = {
            if (!reading) {
                IconButton(onUndo, enabled = canUndo, shapes = IconButtonDefaults.shapes()) {
                    Icon(painterResource(R.drawable.ic_i_undo), "Rückgängig", Modifier.size(21.dp))
                }
                IconButton(onRedo, enabled = canRedo, shapes = IconButtonDefaults.shapes()) {
                    Icon(painterResource(R.drawable.ic_i_redo), "Wiederholen", Modifier.size(21.dp))
                }
            }
            // `#mEditToggle`: Stift = Bearbeiten (Lesemodus an), Haken in Akzentfarbe = Fertig.
            IconButton({ onReading(!reading) }, shapes = IconButtonDefaults.shapes()) {
                if (reading) Icon(painterResource(R.drawable.ic_i_pen), "Bearbeiten", Modifier.size(21.dp))
                else Icon(painterResource(R.drawable.ic_i_check), "Fertig", Modifier.size(21.dp), Impala.colors.accent)
            }
            if (onAi != null) {
                IconButton(onAi, shapes = IconButtonDefaults.shapes()) {
                    Icon(painterResource(R.drawable.ic_i_sparkles), "KI-Assistent", Modifier.size(21.dp))
                }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Impala.colors.bg0),
    )
}

/** Rückfrage vor „Seite löschen“ („+“-Menü). */
@Composable
fun DeletePageDialog(onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Seite löschen?") },
        text = { Text("Die Seite mit allem, was darauf steht, wird entfernt. Rückgängig geht in dieser Sitzung.") },
        confirmButton = { TextButton(onConfirm) { Text("Löschen", color = Impala.colors.danger) } },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
    )
}
