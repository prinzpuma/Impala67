package org.impala67.app.editor

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import org.impala67.app.core.ImpalaStore
import uniffi.impala_ffi.markdownToBlocks

/**
 * Markdown als Blöcke anzeigen (`.md` aus styles.css + editor.css): Überschriften, Listen, Aufgaben,
 * Zitat, Code, Callout, Toggle, Tabelle, Bild, `[[Wiki-Links]]` … Der Block-Markdown kommt aus dem
 * Rust-Kern ([markdownToBlocks]), nur das Inline-Markdown wird hier gestaltet.
 *
 * Mit [store] werden Bilder (`file:<id>`) und `[[Titel]]`-Links aufgelöst; [onOpenPage] öffnet die
 * Zielseite (Seiten-ID). Ohne beides ist es reine Textanzeige.
 */
@Composable
fun MarkdownView(
    markdown: String,
    modifier: Modifier = Modifier,
    store: ImpalaStore? = null,
    onOpenPage: ((String) -> Unit)? = null,
) {
    val blocks = remember(markdown) { markdownToBlocks(markdown) }
    val onLink = rememberLinkHandler(store, onOpenPage)
    val ctx = remember(store, onOpenPage, onLink) { ReadContext(store, onLink, onOpenPage) }
    BlockList(blocks, ctx, modifier.fillMaxWidth())
}
