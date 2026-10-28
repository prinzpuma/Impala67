package org.impala67.app.ui.shell

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FloatingActionButtonMenu
import androidx.compose.material3.FloatingActionButtonMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ModalBottomSheet
import org.impala67.app.ui.theme.Space
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleFloatingActionButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore

/** „+“ (Mobil-Dock der PWA, App-Shortcuts): Expressive-FAB-Menü für neue Notiz bzw. neues Heft. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun NewMenu(onNote: () -> Unit, onHeft: () -> Unit) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    BackHandler(expanded) { expanded = false }
    FloatingActionButtonMenu(
        expanded = expanded,
        button = {
            ToggleFloatingActionButton(checked = expanded, onCheckedChange = { expanded = it }) {
                // Das Plus dreht sich beim Öffnen zum ×.
                Icon(painterResource(R.drawable.ic_i_plus), "Neu", Modifier.graphicsLayer { rotationZ = checkedProgress * 45f })
            }
        },
    ) {
        FloatingActionButtonMenuItem(
            onClick = { expanded = false; onNote() },
            text = { Text("Neue Notiz") },
            icon = { Icon(painterResource(R.drawable.ic_i_note), null) },
        )
        FloatingActionButtonMenuItem(
            onClick = { expanded = false; onHeft() },
            text = { Text("Neues Heft") },
            icon = { Icon(painterResource(R.drawable.ic_i_notebook), null) },
        )
    }
}

/** „+“ auf dem Telefon: Auswahl als Bottom-Sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewSheet(onNote: () -> Unit, onHeft: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        ListItem(
            headlineContent = { Text("Neue Notiz") },
            leadingContent = { Icon(painterResource(R.drawable.ic_i_note), null) },
            modifier = Modifier.clickable { onDismiss(); onNote() },
        )
        ListItem(
            headlineContent = { Text("Neues Heft") },
            supportingContent = { Text("Handschrift mit dem Stift") },
            leadingContent = { Icon(painterResource(R.drawable.ic_i_notebook), null) },
            modifier = Modifier.clickable { onDismiss(); onHeft() }.padding(bottom = Space.s4),
        )
    }
}

/** Seite öffnen, bis Editor und Heft portiert sind: zeigt den Titel. */
@Composable
fun PagePlaceholder(store: ImpalaStore, id: String) {
    val title by produceState("", id) { value = withContext(Dispatchers.IO) { store.core.page(id)?.summary?.title.orEmpty() } }
    Placeholder(title.ifEmpty { "Ohne Titel" }, "Editor (editor.js) bzw. Heft (heft.js) folgen.")
}
