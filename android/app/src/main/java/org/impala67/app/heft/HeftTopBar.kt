package org.impala67.app.heft

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.TextSize

/** Aktionen der Seitenverwaltung (heft-pages-ui.js, „Seite hinzufügen“-Menü der Werkzeugleiste). */
class HeftPageActions(
    val add: (Paper) -> Unit,
    val setPaper: (Paper) -> Unit,
    val remove: () -> Unit,
    val canRemove: Boolean,
    val scan: () -> Unit,
)

/** Kopfzeile: Zurück, Titel mit „Seite x von y“, Seite hinzufügen, Papier und Seite löschen. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun HeftTopBar(title: String, pageLabel: String, onBack: () -> Unit, actions: HeftPageActions) {
    var addMenu by remember { mutableStateOf(false) }
    var pageMenu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    TopAppBar(
        title = {
            Column {
                Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                Text(pageLabel, color = Impala.colors.text2, fontSize = TextSize.xs)
            }
        },
        navigationIcon = {
            IconButton(onBack, shapes = IconButtonDefaults.shapes()) {
                Icon(painterResource(R.drawable.ic_i_chevron_left), "Zurück")
            }
        },
        actions = {
            IconButton({ addMenu = true }, shapes = IconButtonDefaults.shapes()) {
                Icon(painterResource(R.drawable.ic_i_plus), "Seite hinzufügen", Modifier.size(22.dp))
                DropdownMenu(addMenu, { addMenu = false }) {
                    Text("Neue Seite danach", Modifier.padding(horizontal = 12.dp, vertical = 4.dp), color = Impala.colors.text2, fontSize = TextSize.xs)
                    Paper.entries.forEach { p ->
                        DropdownMenuItem({ Text(p.label) }, { addMenu = false; actions.add(p) })
                    }
                    HorizontalDivider()
                    DropdownMenuItem(
                        { Text("Dokument scannen") },
                        { addMenu = false; actions.scan() },
                        leadingIcon = { Icon(painterResource(R.drawable.ic_i_camera), null, Modifier.size(20.dp)) },
                    )
                }
            }
            IconButton({ pageMenu = true }, shapes = IconButtonDefaults.shapes()) {
                Icon(painterResource(R.drawable.ic_i_pages_stack), "Seite", Modifier.size(22.dp))
                DropdownMenu(pageMenu, { pageMenu = false }) {
                    Text("Papier dieser Seite", Modifier.padding(horizontal = 12.dp, vertical = 4.dp), color = Impala.colors.text2, fontSize = TextSize.xs)
                    Paper.entries.forEach { p ->
                        DropdownMenuItem({ Text(p.label) }, { pageMenu = false; actions.setPaper(p) })
                    }
                    HorizontalDivider()
                    DropdownMenuItem(
                        { Text("Seite löschen", color = Impala.colors.danger) },
                        { pageMenu = false; confirm = true },
                        enabled = actions.canRemove,
                        leadingIcon = { Icon(painterResource(R.drawable.ic_i_trash), null, Modifier.size(20.dp), Impala.colors.danger) },
                    )
                }
            }
        },
    )
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Seite löschen?") },
            text = { Text("Die Seite mit allem, was darauf steht, wird entfernt. Rückgängig geht in dieser Sitzung.") },
            confirmButton = { TextButton({ confirm = false; actions.remove() }) { Text("Löschen", color = Impala.colors.danger) } },
            dismissButton = { TextButton({ confirm = false }) { Text("Abbrechen") } },
        )
    }
}
