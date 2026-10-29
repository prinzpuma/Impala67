package org.impala67.app.ui.shell

import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.res.painterResource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.editor.EditorScreen
import org.impala67.app.heft.HeftScreen
import uniffi.impala_ffi.PageKind

/** „+“ der Shell: öffnet „Neu anlegen“ (wie `newPageFlow` in der PWA). */
@Composable
fun NewButton(onClick: () -> Unit) {
    FloatingActionButton(onClick = onClick) { Icon(painterResource(R.drawable.ic_i_plus), "Neu anlegen") }
}

/** Seite öffnen: Notizen im Editor, Hefte im Heft. Die Art liest der Kern im Hintergrund. */
@Composable
fun PageEntry(store: ImpalaStore, id: String, nav: ShellNav) {
    val kind by produceState<PageKind?>(null, id) { value = withContext(Dispatchers.IO) { store.core.page(id)?.summary?.kind } }
    when (kind) {
        null -> {}
        PageKind.HEFT -> {
            DisposableEffect(id) { nav.immersive = true; onDispose { nav.immersive = false } }
            HeftScreen(store, id, onBack = nav::back)
        }
        PageKind.NOTE -> EditorScreen(store, id, onOpenPage = { nav.open(PageRoute(it)) })
    }
}