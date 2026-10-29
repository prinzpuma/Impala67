package org.impala67.app.editor

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.theme.Impala

/**
 * Seite anzeigen und bearbeiten (web/editor.js, render.js `renderPage`): Brotkrumen, Icon, Titel,
 * darunter die Blöcke aus dem Kern. Ein Tipp auf einen Textblock macht ihn zum Eingabefeld; die
 * Werkzeugleiste erscheint über der Tastatur. Gespeichert wird nach ~600 ms Ruhe über `updatePage`.
 *
 * Navigation nur über Rückrufe: [onOpenPage] (Brotkrumen, Rückverweise, Links).
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun EditorScreen(
    store: ImpalaStore,
    pageId: String,
    onOpenPage: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val vm: EditorViewModel = viewModel(key = "editor:$pageId") { EditorViewModel(store, pageId) }
    val head by vm.header.collectAsStateWithLifecycle()
    val c = Impala.colors
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { vm.flush() }
    BackHandler(enabled = vm.active != null) { vm.clearActive() }

    val onLink = rememberLinkHandler(store, onOpenPage)
    val slash = remember { SlashState() }
    val active = vm.active
    val ctx = remember(store, onLink, onOpenPage, active) {
        ReadContext(
            store = store, onLink = onLink, onOpenPage = onOpenPage,
            selectedId = active?.takeIf { it.mode == EditMode.Select }?.id,
            editingId = active?.takeIf { it.mode == EditMode.Text }?.id,
            onTap = vm::tap, onEditRaw = vm::editRaw, onToggleTodo = vm::toggleTodo,
            editSlot = { block, style, mod -> vm.active?.takeIf { it.id == block.id }?.let { BlockTextField(block, it, vm, slash, style, mod) } },
        )
    }
    val numbers = remember(vm.blocks) { listNumbers(vm.blocks) }

    Box(modifier.fillMaxSize().imePadding()) {
        when {
            vm.missing -> Text("Seite nicht gefunden.", Modifier.align(Alignment.Center), color = c.text2)
            !vm.loaded -> LoadingIndicator(Modifier.align(Alignment.Center))
            else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                LazyColumn(
                    Modifier.widthIn(max = 760.dp).fillMaxSize(), rememberLazyListState(),
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 180.dp),
                ) {
                    item(key = "head") {
                        Column {
                            Breadcrumbs(head, vm.title, onOpenPage)
                            PageTitleBlock(head, vm.title, vm::onTitle, vm::focusFirst, onOpenPage)
                        }
                    }
                    itemsIndexed(vm.blocks, key = { _, b -> b.id }) { i, b ->
                        val raw = active?.takeIf { it.mode == EditMode.Raw && it.id == b.id }
                        Box(Modifier.padding(vertical = 1.dp)) {
                            if (raw != null) RawBlockEditor(b, raw, vm) else ReadBlock(b, ctx, numbers[b.id], i == 0)
                        }
                    }
                    item(key = "tail") {
                        Box(Modifier.fillMaxWidth().heightIn(min = 160.dp).clickable(indication = null, interactionSource = null) { vm.focusEnd() })
                    }
                }
            }
        }
        AnimatedVisibility(
            visible = vm.active != null && vm.loaded,
            modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp),
            enter = slideInVertically { it } + fadeIn(),
            exit = slideOutVertically { it } + fadeOut(),
        ) { EditorToolbar(vm) }
    }
}
