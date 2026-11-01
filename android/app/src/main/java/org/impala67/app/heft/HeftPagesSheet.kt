package org.impala67.app.heft

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
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
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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

/**
 * Seitenübersicht des Hefts (heft.js „Seiten“-Popover, heft-pages-ui.js): Kopf mit Schließen, Umschalter
 * Raster/Verlauf, Inhalt, Fußleiste. Antippen springt zur Seite ([onJump]); „Auswählen“ markiert Seiten
 * zum Löschen oder Exportieren; „Neue Seite“ hängt eine Seite mit dem Papier der letzten Seite an;
 * „Importieren“ holt PDFs oder Bilder ([onImport]). Der Verlauf zeigt die lokalen Stände der letzten
 * 24 Stunden. Auf dem Tablet ([desk]) ein mittiges Popover (560 dp, Radius 22) wie in der PWA, sonst ein
 * Bottom Sheet.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HeftPagesSheet(
    vm: HeftViewModel,
    pages: List<String>,
    current: Int,
    desk: Boolean,
    title: String,
    onJump: (String) -> Unit,
    onImport: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = Impala.colors
    val scope = rememberCoroutineScope()
    var picking by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf(emptySet<String>()) }
    var confirm by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf(false) }
    var historyTab by remember { mutableStateOf(false) }
    var snaps by remember { mutableStateOf<List<HeftSnap>?>(null) }
    var restoring by remember { mutableStateOf<HeftSnap?>(null) }
    LaunchedEffect(historyTab) { if (historyTab) snaps = vm.snapshots() }
    val n = selected.size
    // TODO(desk): `canDeletePages` (impala_heft::pages) über die FFI exponieren; hier nur die UI-Sperre.
    // Mindestens eine Seite bleibt.
    val deletable = n in 1 until pages.size

    fun endPicking() { picking = false; selected = emptySet() }
    fun toggle(id: String) { selected = if (id in selected) selected - id else selected + id }

    val content: @Composable ColumnScope.() -> Unit = {
        // `.heft-pages-manager-head`: links frei (bzw. Alle/Keine), Titel mittig, ✕ rechts.
        Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(88.dp)) {
                if (picking) {
                    val all = n == pages.size
                    PagesTextButton(if (all) "Keine" else "Alle") { selected = if (all) emptySet() else pages.toSet() }
                }
            }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Seiten", color = c.text, fontSize = TextSize.base, fontWeight = FontWeight.SemiBold)
                Text(
                    if (picking) "$n ausgewählt" else seitenZahl(pages.size),
                    color = c.text2, fontSize = TextSize.xs2, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Box(Modifier.width(88.dp), contentAlignment = Alignment.CenterEnd) {
                Box(
                    Modifier.size(36.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Schließen", onClick = onDismiss),
                    Alignment.Center,
                ) { Icon(painterResource(R.drawable.ic_i_x), "Schließen", Modifier.size(16.dp), c.text2) }
            }
        }

        // `.heft-pages-seg`: Raster | Verlauf (nicht während der Auswahl).
        if (!picking) {
            Box(Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) {
                Segmented(listOf(false, true), historyTab, { if (it) "Verlauf" else "Raster" }) { historyTab = it }
            }
        }

        if (historyTab && !picking) {
            HeftHistoryGrid(snaps, columns = if (desk) 3 else null, modifier = Modifier.weight(1f, fill = false)) { restoring = it }
            Row(Modifier.fillMaxWidth().heightIn(min = 58.dp).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Letzte 24 h · antippen zum Wiederherstellen", color = c.text2, fontSize = TextSize.xs)
            }
        } else {
        HeftPagesGrid(
            vm = vm,
            pages = pages,
            current = current,
            selected = selected,
            picking = picking,
            onTap = { id -> if (picking) toggle(id) else onJump(id) },
            onAdd = { scope.launch { onJump(vm.addPage(null, vm.lastPaper())) } },
            onMove = vm::movePage,
            modifier = Modifier.weight(1f, fill = false),
            columns = if (desk) 3 else null,
        )

        // `.heft-pages-foot`: 58 dp hoch, Textknopf links, Aktion rechts.
        Row(
            Modifier.fillMaxWidth().heightIn(min = 58.dp).padding(horizontal = 14.dp, vertical = 10.dp),
            Arrangement.spacedBy(6.dp),
            Alignment.CenterVertically,
        ) {
            if (picking) {
                PagesTextButton("Fertig") { endPicking() }
                Spacer(Modifier.weight(1f))
                Row(
                    Modifier.height(36.dp).clip(CircleShape).background(c.danger.copy(alpha = 0.14f))
                        .clickable(enabled = deletable, role = Role.Button) { confirm = true }
                        .alpha(if (deletable) 1f else 0.4f).padding(horizontal = 14.dp),
                    Arrangement.spacedBy(6.dp),
                    Alignment.CenterVertically,
                ) {
                    Icon(painterResource(R.drawable.ic_i_trash), null, Modifier.size(16.dp), c.danger)
                    Text("Löschen ($n)", color = c.danger, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
                }
                FootButton("Exportieren ($n)", null, enabled = n > 0) { exporting = true }
            } else {
                PagesTextButton("Auswählen") { picking = true }
                Spacer(Modifier.weight(1f))
                FootButton("Importieren", R.drawable.ic_i_upload, onClick = onImport)
            }
        }
        }
    }

    if (desk) {
        Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Column(
                Modifier.width(560.dp).heightIn(max = 620.dp)
                    .heftFloat(RoundedCornerShape(22.dp), border = false),
            ) { content() }
        }
    } else {
        ModalBottomSheet(
            onDismissRequest = onDismiss,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = c.menu,
        ) {
            content()
            Spacer(Modifier.height(8.dp))
        }
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

    if (exporting) HeftExportDialog(vm, pages.filter { it in selected }, title, onDismiss = { exporting = false })

    restoring?.let { snap ->
        AlertDialog(
            onDismissRequest = { restoring = null },
            title = { Text("Wiederherstellen") },
            text = { Text("Diesen Stand wiederherstellen? Der aktuelle Stand wird vorher im Verlauf gesichert.") },
            confirmButton = {
                TextButton({ restoring = null; vm.restore(snap); onDismiss() }) { Text("Wiederherstellen") }
            },
            dismissButton = { TextButton({ restoring = null }) { Text("Abbrechen") } },
        )
    }
}

/** `.heft-pages-btn`: Kapsel in Flächenfarbe mit optionalem Icon. */
@Composable
private fun FootButton(label: String, icon: Int?, enabled: Boolean = true, onClick: () -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.height(36.dp).clip(CircleShape).background(c.surfaceSubtle)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .alpha(if (enabled) 1f else 0.4f).padding(horizontal = 14.dp),
        Arrangement.spacedBy(6.dp),
        Alignment.CenterVertically,
    ) {
        icon?.let { Icon(painterResource(it), null, Modifier.size(16.dp), c.text) }
        Text(label, color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
    }
}

/** `.heft-pages-text`: Akzent-Text in einer Kapsel (13 sp, halbfett). */
@Composable
private fun PagesTextButton(label: String, onClick: () -> Unit) {
    Text(
        label,
        Modifier.height(32.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp).wrapContentHeight(Alignment.CenterVertically),
        color = Impala.colors.accent,
        fontSize = TextSize.sm,
        fontWeight = FontWeight.SemiBold,
    )
}
