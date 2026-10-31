package org.impala67.app.heft

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.annotation.DrawableRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.TextSize

/**
 * Aktionsleiste der Lasso-Auswahl (heft-lasso.js `updateLassoBarUI`): In Text, Duplizieren, Löschen,
 * Auswahl aufheben. Das Trainingsbeispiel der PWA entfällt: nativ erkennt ML Kit die Handschrift.
 */
@Composable
fun HeftLassoBar(vm: HeftViewModel, modifier: Modifier = Modifier) {
    val c = Impala.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    Surface(modifier, shape = CircleShape, color = c.menu, border = BorderStroke(1.dp, c.edge), shadowElevation = 8.dp) {
        Row(Modifier.padding(horizontal = 6.dp, vertical = 4.dp), Arrangement.spacedBy(4.dp), Alignment.CenterVertically) {
            LassoButton(R.drawable.ic_i_note, "In Text") {
                vm.message("Handschrift wird erkannt…")
                scope.launch {
                    val text = runCatching { vm.lassoRecognize() }
                        .onFailure { vm.message("Erkennung fehlgeschlagen: " + (it.message ?: it)) }
                        .getOrElse { return@launch }
                    if (text.isNullOrBlank()) { vm.message("Kein Text erkannt."); return@launch }
                    val copied = runCatching {
                        val clip = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clip.setPrimaryClip(ClipData.newPlainText("Handschrift", text))
                    }.isSuccess
                    vm.message((if (copied) "Erkannt & kopiert: „" else "Erkannt (Kopieren nicht möglich): „") + text + "“")
                }
            }
            LassoButton(R.drawable.ic_i_copy, "Duplizieren", onClick = vm::lassoDuplicate)
            LassoButton(R.drawable.ic_i_trash, "Löschen", onClick = vm::lassoDelete)
            Icon(
                painterResource(R.drawable.ic_i_x),
                "Auswahl aufheben",
                Modifier.size(30.dp).clip(CircleShape)
                    .clickable(role = Role.Button, onClick = vm::clearLasso)
                    .padding(7.dp),
                c.text2,
            )
        }
    }
}

@Composable
private fun LassoButton(@DrawableRes icon: Int, label: String, onClick: () -> Unit) {
    val color = Impala.colors.text
    Row(
        Modifier.height(32.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 10.dp),
        Arrangement.spacedBy(6.dp),
        Alignment.CenterVertically,
    ) {
        Icon(painterResource(icon), null, Modifier.size(16.dp), color)
        Text(label, color = color, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}
