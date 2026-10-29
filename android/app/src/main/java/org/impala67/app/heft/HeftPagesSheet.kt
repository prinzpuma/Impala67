package org.impala67.app.heft

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.TextSize

/** „1 Seite“ / „3 Seiten“ wie `plural` in heft-pages-ui.js. */
internal fun seitenZahl(n: Int) = "$n " + if (n == 1) "Seite" else "Seiten"

// TODO(desk): Verlauf-Umschalter (Stände, `writeSnapshot` in heft-storage.js) fehlt – keine Snapshot-FFI.
// TODO(desk): Export/Import von Seiten (heft-export.js, heft-import.js) fehlt im Popover.
/**
 * Seitenübersicht des Hefts (heft.js „Seiten“-Popover, Raster): Kopf mit Schließen, Raster aller Seiten,
 * Fußleiste. Antippen springt zur Seite ([onJump]); „Auswählen“ markiert Seiten zum Löschen; „Neue Seite“
 * hängt eine Seite mit dem Papier der letzten Seite an.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun HeftPagesSheet(vm: HeftViewModel, pages: List<String>, current: Int, onJump: (String) -> Unit, onDismiss: () -> Unit) {
    val c = Impala.colors
    val scope = rememberCoroutineScope()
    var picking by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf(emptySet<String>()) }
    var confirm by remember { mutableStateOf(false) }
    val n = selected.size
    // TODO(desk): `canDeletePages` (impala_heft::pages) über die FFI exponieren; hier nur die UI-Sperre.
    // Mindestens eine Seite bleibt.
    val deletable = n in 1 until pages.size

    fun endPicking() { picking = false; selected = emptySet() }
    fun toggle(id: String) { selected = if (id in selected) selected - id else selected + id }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.panel,
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(88.dp)) {
                if (picking) {
                    val all = n == pages.size
                    TextButton({ selected = if (all) emptySet() else pages.toSet() }) { Text(if (all) "Keine" else "Alle") }
                }
            }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Seiten", style = MaterialTheme.typography.titleMedium)
                Text(
                    if (picking) "$n ausgewählt" else seitenZahl(pages.size),
                    color = c.text2, fontSize = TextSize.xs, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Box(Modifier.width(88.dp), contentAlignment = Alignment.CenterEnd) {
                IconButton(onDismiss) { Icon(painterResource(R.drawable.ic_i_x), "Schließen") }
            }
        }

        HeftPagesGrid(
            vm = vm,
            pages = pages,
            current = current,
            selected = selected,
            picking = picking,
            onTap = { id -> if (picking) toggle(id) else onJump(id) },
            onAdd = { scope.launch { onJump(vm.addPage(null, vm.lastPaper())) } },
            modifier = Modifier.weight(1f),
        )

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            Arrangement.spacedBy(8.dp),
            Alignment.CenterVertically,
        ) {
            if (picking) {
                TextButton({ endPicking() }) { Text("Fertig") }
                Spacer(Modifier.weight(1f))
                TextButton({ confirm = true }, enabled = deletable) {
                    Icon(painterResource(R.drawable.ic_i_trash), null, Modifier.size(18.dp), c.danger)
                    Spacer(Modifier.width(6.dp))
                    Text("Löschen ($n)", color = c.danger)
                }
            } else {
                TextButton({ picking = true }) { Text("Auswählen") }
                Spacer(Modifier.weight(1f))
            }
        }
        Spacer(Modifier.height(8.dp))
    }

    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Löschen") },
            text = { Text("$n ausgewählte " + (if (n == 1) "Seite" else "Seiten") + " wirklich löschen?") },
            confirmButton = {
                TextButton({
                    confirm = false
                    vm.removePages(pages.filter { it in selected })
                    endPicking()
                }) { Text("Löschen", color = c.danger) }
            },
            dismissButton = { TextButton({ confirm = false }) { Text("Abbrechen") } },
        )
    }
}
