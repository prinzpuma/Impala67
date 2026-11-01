package org.impala67.app.editor

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.MdBlock
import uniffi.impala_ffi.MdBlockKind

/** Farben des Blockmenüs (COLORS in editor-menus.js). */
private val COLORS = listOf("gray", "red", "orange", "yellow", "green", "blue", "purple", "pink")

/** Breite des Griffs links neben den Blöcken (Tablet). */
internal val GUTTER = 48.dp

/**
 * Griff links am Block (`.blk-gutter`): „+“ legt darunter einen Absatz mit Slash-Menü an, „⋮⋮“ öffnet das
 * Blockmenü. Sichtbar am aktiven Block (in der PWA bei Hover/Fokus) und solange das Menü offen ist.
 */
@Composable
internal fun BlockGutter(block: MdBlock, vm: EditorViewModel, menus: EditorMenus, onToast: (String) -> Unit) {
    val c = Impala.colors
    var menu by remember { mutableStateOf(false) }
    val shown = menu || vm.active?.id == block.id
    Row(Modifier.width(GUTTER).padding(top = 4.dp).alpha(if (shown) 1f else 0f), horizontalArrangement = Arrangement.End) {
        GutterButton(shown, "Block darunter einfügen", { vm.insertSlashBelow(block.id, menus) }) {
            Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(15.dp), tint = c.text2)
        }
        Box {
            GutterButton(shown, "Blockmenü", { menu = true }) { Text("⋮⋮", color = c.text2, fontSize = TextSize.xs, fontWeight = FontWeight.Bold) }
            BlockMenu(menu, { menu = false }, block, vm, onToast)
        }
    }
}

@Composable
private fun GutterButton(enabled: Boolean, label: String, onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        Modifier.size(24.dp, 28.dp).clip(RoundedCornerShape(Radius.xs)).clickable(enabled = enabled, onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { content() }
}

/** `openBlockMenu`: Umwandeln in, Farbe, Duplizieren, Als Markdown kopieren, Lernkarte, Löschen. */
@Composable
private fun BlockMenu(open: Boolean, onDismiss: () -> Unit, block: MdBlock, vm: EditorViewModel, onToast: (String) -> Unit) {
    val c = Impala.colors
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboard.current
    val texty = block.isText() && block.kind !is MdBlockKind.Code
    DropdownMenu(open, onDismiss, containerColor = c.menu) {
        if (block.isText()) {
            Section("Umwandeln in")
            BlockType.entries.forEach { t ->
                val current = block.type() == t
                DropdownMenuItem(
                    { Text(t.label, color = if (current) c.accent else c.text) },
                    { onDismiss(); vm.convertBlock(block.id, t) },
                )
            }
        }
        if (texty || block.kind is MdBlockKind.Callout) {
            Section("Farbe")
            ColorRow { name -> ColorDot(inlineColor(name, c.isDark), filled = false, label = name) { onDismiss(); vm.setBlockColor(block.id, name, background = false) } }
            ColorRow(remove = { onDismiss(); vm.setBlockColor(block.id, null, background = false) }) { name ->
                ColorDot(inlineColor(name, c.isDark), filled = true, label = "$name Hintergrund") { onDismiss(); vm.setBlockColor(block.id, name, background = true) }
            }
        }
        HorizontalDivider(Modifier.padding(vertical = 4.dp), color = c.edgeSoft)
        Item("Duplizieren", "Strg+D") { onDismiss(); vm.duplicateBlock(block.id) }
        Item("Als Markdown kopieren") {
            onDismiss()
            scope.launch {
                clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Markdown", vm.rawOf(block).trimEnd())))
                onToast("Als Markdown kopiert")
            }
        }
        if (texty) Item("Lernkarte erstellen") {
            onDismiss()
            scope.launch {
                runCatching { vm.cardFromBlock(block.id) }
                    .onSuccess { onToast("Lernkarte erstellt — Rückseite in Anki ergänzen") }
                    .onFailure { onToast("Lernkarte konnte nicht erstellt werden") }
            }
        }
        Item("Löschen", "Entf", danger = true) { onDismiss(); vm.deleteBlock(block.id) }
    }
}

@Composable
private fun Section(label: String) {
    Text(label, Modifier.padding(start = 12.dp, top = 8.dp, bottom = 2.dp), color = Impala.colors.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun Item(label: String, hint: String? = null, danger: Boolean = false, onClick: () -> Unit) {
    val c = Impala.colors
    DropdownMenuItem(
        text = { Text(label) },
        onClick = onClick,
        trailingIcon = hint?.let { { Text(it, color = c.text2, fontSize = TextSize.xs) } },
        colors = if (danger) MenuDefaults.itemColors(textColor = c.danger) else MenuDefaults.itemColors(),
    )
}

@Composable
private fun ColorRow(remove: (() -> Unit)? = null, dot: @Composable (String) -> Unit) {
    Row(Modifier.padding(horizontal = 10.dp, vertical = 3.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        COLORS.forEach { dot(it) }
        if (remove != null) {
            Box(
                Modifier.size(22.dp).clip(CircleShape).border(1.dp, Impala.colors.edge, CircleShape).clickable(onClickLabel = "Farbe entfernen", onClick = remove),
                contentAlignment = Alignment.Center,
            ) { Text("✕", color = Impala.colors.text2, fontSize = TextSize.xs) }
        }
    }
}

/** `.blk-cdot`: Textfarbe als Ring mit „A“, Hintergrund als gefüllter Punkt. */
@Composable
private fun ColorDot(color: androidx.compose.ui.graphics.Color, filled: Boolean, label: String, onClick: () -> Unit) {
    val m = Modifier.size(22.dp).clip(CircleShape)
    Box(
        (if (filled) m.background(color.copy(alpha = 0.45f)) else m.border(1.5.dp, color, CircleShape)).clickable(onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { if (!filled) Text("A", color = color, fontSize = TextSize.xs, fontWeight = FontWeight.Bold) }
}
