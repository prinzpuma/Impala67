package org.impala67.app.ai

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.AiModel

/** Chip über dem Eingabefeld: Anhang mit Vorschau und ✕ (render.js:1705–1731). */
@Composable
fun AttachmentChip(a: ChatAttachment, onRemove: () -> Unit) {
    val note = when (a) {
        is ChatAttachment.Image -> "wird mitgesendet"
        is ChatAttachment.TextFile -> "${a.content.length} Zeichen · wird als Datei angehängt"
        is ChatAttachment.Pdf -> "${a.pages} Seiten · wird als PDF-Kontext angehängt" +
            if (a.content.isBlank()) " (kein Text erkannt)" else ""
    }
    Chip(onRemove, "Anhang entfernen") {
        if (a is ChatAttachment.Image) {
            Image(a.preview.asImageBitmap(), null, Modifier.size(28.dp).clip(RoundedCornerShape(Radius.xs)))
        } else {
            Icon(painterResource(if (a is ChatAttachment.Pdf) R.drawable.ic_i_file else R.drawable.ic_i_paperclip), null, Modifier.size(14.dp), tint = Impala.colors.accent)
        }
        Column(Modifier.weight(1f)) {
            Text(a.name, color = Impala.colors.text, fontSize = TextSize.xs, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(note, color = Impala.colors.text2, fontSize = TextSize.xs)
        }
    }
}

/** Seitenkontext-Chip (render.js `sideContextChip`): zeigt, dass die offene Seite mitgeht; ✕ schaltet das ab. */
@Composable
fun ContextChip(title: String, sent: ContextSent?, off: Boolean, onToggle: () -> Unit) {
    val note = when {
        off -> "Seitenkontext aus · antippen zum Mitsenden"
        sent != null && sent.sent < sent.total -> "Anfang mitgesendet (${sent.sent} von ${sent.total} Zeichen)"
        else -> "Seitenkontext · wird mitgesendet"
    }
    Chip(onToggle, if (off) "Seitenkontext wieder mitsenden" else "Seitenkontext entfernen", removable = !off) {
        Icon(painterResource(R.drawable.ic_i_file), null, Modifier.size(14.dp), tint = if (off) Impala.colors.text2 else Impala.colors.accent)
        Column(Modifier.weight(1f)) {
            Text(title.ifBlank { "Ohne Titel" }, color = Impala.colors.text, fontSize = TextSize.xs, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(note, color = Impala.colors.text2, fontSize = TextSize.xs)
        }
    }
}

@Composable
private fun Chip(onClick: () -> Unit, label: String, removable: Boolean = true, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.padding(horizontal = 10.dp).padding(top = Space.s1).fillMaxWidth().clip(RoundedCornerShape(Radius.md))
            .background(c.surface).border(1.dp, c.edgeSoft, RoundedCornerShape(Radius.md))
            .clickable(enabled = !removable, onClick = onClick).padding(horizontal = Space.s2, vertical = Space.s1),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        content()
        if (removable) Box(Modifier.size(24.dp).clip(RoundedCornerShape(Radius.sm)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.ic_i_x), label, Modifier.size(12.dp), tint = c.text2)
        }
    }
}

/** „+“-Menü (`#attachMenu`): Fotos und Dateien, bei offenem Heft die aktuelle Heftseite. */
@Composable
fun AttachMenu(expanded: Boolean, heftOpen: Boolean, onDismiss: () -> Unit, onFiles: () -> Unit, onHeft: () -> Unit) {
    DropdownMenu(expanded, onDismiss) {
        DropdownMenuItem(
            text = { Text("Fotos und Dateien hinzufügen") },
            leadingIcon = { Icon(painterResource(R.drawable.ic_i_paperclip), null, Modifier.size(16.dp)) },
            onClick = { onDismiss(); onFiles() },
        )
        if (heftOpen) DropdownMenuItem(
            text = { Text("Aktuelle Heft-Seite als Bild anhängen") },
            leadingIcon = { Icon(painterResource(R.drawable.ic_i_pen), null, Modifier.size(16.dp)) },
            onClick = { onDismiss(); onHeft() },
        )
    }
}

private enum class MenuPage { ROOT, MODELS, THINKING }

/** Modellmenü (render.js `modelMenuInnerHtml`): Wurzel „Modell ›“ / „Denkaufwand ›“ und die zwei Unterseiten. */
@Composable
fun ModelMenu(models: AiModels, expanded: Boolean, onDismiss: () -> Unit) {
    val choice by models.choice.collectAsStateWithLifecycle()
    val favs by models.favorites.collectAsStateWithLifecycle()
    val menu by models.menu.collectAsStateWithLifecycle()
    var page by remember { mutableStateOf(MenuPage.ROOT) }
    val close = { page = MenuPage.ROOT; onDismiss() }
    val c = Impala.colors
    val ch = choice ?: return
    DropdownMenu(expanded, close) {
        when (page) {
            MenuPage.ROOT -> {
                DropdownMenuItem(text = { RootRow("Modell", ch.label) }, onClick = { page = MenuPage.MODELS; models.refresh() })
                DropdownMenuItem(
                    text = { RootRow("Denkaufwand", if (ch.thinkingEnabled) "Automatisch" else "Reduziert") },
                    onClick = { page = MenuPage.THINKING },
                )
            }
            MenuPage.THINKING -> {
                DropdownMenuItem(text = { Text("‹ Zurück", color = c.text2) }, onClick = { page = MenuPage.ROOT })
                MenuLabel("Denkaufwand")
                Text(
                    "Das Modell verwendet automatisch eine passende Tiefe; für schnellere Antworten lässt sie sich auf das dokumentierte Minimum begrenzen.",
                    Modifier.padding(horizontal = Space.s3, vertical = Space.s1).widthIn(max = 260.dp),
                    color = c.text2, fontSize = TextSize.xs,
                )
                listOf(true to "Automatisch", false to "Reduziert").forEach { (v, label) ->
                    DropdownMenuItem(
                        text = { Text(label) },
                        trailingIcon = { if (v == ch.thinkingEnabled) Text("✓", color = c.accent) },
                        onClick = { models.setThinking(v); close() },
                    )
                }
            }
            MenuPage.MODELS -> {
                DropdownMenuItem(text = { Text("‹ Zurück", color = c.text2) }, onClick = { page = MenuPage.ROOT })
                MenuLabel("Verfügbare Modelle")
                if (menu.loading) Note("Modelle werden aktualisiert…")
                val live = menu.models
                val favLive = live.filter { "${it.providerId}::${it.id}" in favs }
                val groups = buildList {
                    if (favLive.isNotEmpty()) add("★ Favoriten" to favLive)
                    ch.providers.forEach { (id, name) ->
                        val rest = live.filter { it.providerId == id && "${it.providerId}::${it.id}" !in favs }
                        if (rest.isNotEmpty()) add(name to rest)
                    }
                    if (isEmpty() && ch.model.isNotEmpty()) add("Gespeichert & Vorschläge" to listOf(AiModel(ch.model, ch.providerId)))
                }
                if (groups.isEmpty() && !menu.loading) Note("Gerade ist kein Modell erreichbar oder geladen.")
                groups.forEachIndexed { i, (label, list) ->
                    if (i > 0) HorizontalDivider(color = c.edgeSoft)
                    MenuLabel(label)
                    list.forEach { m ->
                        val active = m.providerId == ch.providerId && m.id == ch.model
                        val fav = "${m.providerId}::${m.id}" in favs
                        DropdownMenuItem(
                            text = { Text(if (m.id == "impala-ai") "Impala AI" else m.id, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            leadingIcon = { Text(if (active) "✓" else " ", color = c.accent) },
                            trailingIcon = {
                                Box(
                                    Modifier.size(28.dp).clip(RoundedCornerShape(Radius.sm)).clickable { models.toggleFavorite(m.providerId, m.id) },
                                    contentAlignment = Alignment.Center,
                                ) { Text(if (fav) "★" else "☆", color = if (fav) c.accent else c.text2) }
                            },
                            onClick = { models.select(m.providerId, m.id); close() },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RootRow(title: String, sub: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.padding(end = Space.s4), color = Impala.colors.text, fontSize = TextSize.sm)
        Text("$sub ›", color = Impala.colors.text2, fontSize = TextSize.xs, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun MenuLabel(text: String) =
    Text(text, Modifier.padding(horizontal = Space.s3, vertical = Space.s1), color = Impala.colors.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)

@Composable
private fun Note(text: String) =
    Text(text, Modifier.padding(horizontal = Space.s3, vertical = Space.s1), color = Impala.colors.text2, fontSize = TextSize.xs)
