package org.impala67.app.editor

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.TextStyle
import org.impala67.app.core.ImpalaStore
import uniffi.impala_ffi.MdBlock

/**
 * Alles, was die Block-Darstellung von außen braucht. Ohne Editor-Felder (nur [store]/[onLink]) ist
 * sie reine Anzeige ([MarkdownView]); der Editor ergänzt Tippen, Auswahl und Rohtext-Bearbeitung.
 */
@Immutable
internal class ReadContext(
    val store: ImpalaStore?,
    val onLink: (String) -> Unit,
    val onOpenPage: ((String) -> Unit)? = null,
    val selectedId: String? = null,
    val editingId: String? = null,
    val onTap: ((MdBlock) -> Unit)? = null,
    val onEditRaw: ((MdBlock) -> Unit)? = null,
    val onToggleTodo: ((String) -> Unit)? = null,
    val editSlot: (@Composable (MdBlock, TextStyle, Modifier) -> Unit)? = null,
) {
    /** Kinder (Callout, Toggle, Spalten) sind in der Anzeige nur lesbar; bearbeitet wird der Elternblock. */
    fun forChildren() = ReadContext(store, onLink, onOpenPage)
}

/**
 * Links aus dem Text: `wiki:<Titel>` ([[Wiki-Link]]), `#<Seiten-ID>` (von der PWA erzeugte Links),
 * sonst eine Web-Adresse.
 */
@Composable
internal fun rememberLinkHandler(store: ImpalaStore?, onOpenPage: ((String) -> Unit)?): (String) -> Unit {
    val uri = LocalUriHandler.current
    return remember(store, onOpenPage, uri) {
        { target ->
            when {
                target.startsWith("wiki:") ->
                    store?.core?.findPageByTitle(target.removePrefix("wiki:"))?.let { onOpenPage?.invoke(it.id) }
                target.startsWith("#") -> onOpenPage?.invoke(target.removePrefix("#"))
                else -> runCatching { uri.openUri(target) }
            }
            Unit
        }
    }
}
