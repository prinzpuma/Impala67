package org.impala67.app.notes

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.theme.Space
import uniffi.impala_ffi.PageSummary

/**
 * „Neu anlegen“ (`openTemplatePicker` in web/render.js): Notion-Seite, GoodNotes-Heft oder eine als
 * Vorlage markierte Seite. Telefon: Bottom-Sheet, Tablet: Dialog.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewPageDialog(
    store: ImpalaStore,
    desk: Boolean,
    onPick: (heft: Boolean) -> Unit,
    onTemplate: (PageSummary) -> Unit,
    onDismiss: () -> Unit,
) {
    val templates by produceState(emptyList<PageSummary>()) {
        value = store.write { core -> core.recentPages(UInt.MAX_VALUE).filter { it.isTemplate } }
    }
    if (desk) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Neu anlegen") },
            text = { NewPageChoices(templates, onPick, onTemplate) },
            confirmButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
        )
    } else {
        ModalBottomSheet(onDismissRequest = onDismiss) {
            Text("Neu anlegen", Modifier.padding(horizontal = Space.s4, vertical = Space.s2))
            NewPageChoices(templates, onPick, onTemplate)
            TextButton(onClick = onDismiss, modifier = Modifier.padding(horizontal = Space.s4, vertical = Space.s2)) { Text("Abbrechen") }
        }
    }
}

/** Die beiden Typen mit den Beschreibungen der PWA, darunter die Vorlagen. */
@Composable
private fun NewPageChoices(templates: List<PageSummary>, onPick: (heft: Boolean) -> Unit, onTemplate: (PageSummary) -> Unit) {
    Column {
        ListItem(
            headlineContent = { Text("Notion-Seite") },
            supportingContent = { Text("Blöcke · Markdown · Verlinkungen") },
            leadingContent = { Icon(painterResource(R.drawable.ic_i_note), null) },
            modifier = Modifier.clickable { onPick(false) },
        )
        ListItem(
            headlineContent = { Text("GoodNotes-Heft") },
            supportingContent = { Text("Papier · Stift · Seiten") },
            leadingContent = { Icon(painterResource(R.drawable.ic_i_notebook), null) },
            modifier = Modifier.clickable { onPick(true) },
        )
        if (templates.isNotEmpty()) Text("Oder aus einer Vorlage:", Modifier.padding(horizontal = Space.s4, vertical = Space.s2))
        templates.forEach { tpl ->
            ListItem(
                headlineContent = { Text(tpl.icon.let { if (it.isEmpty()) tpl.title else "$it ${tpl.title}" }) },
                leadingContent = { Icon(painterResource(R.drawable.ic_i_template), null) },
                modifier = Modifier.clickable { onTemplate(tpl) },
            )
        }
    }
}
