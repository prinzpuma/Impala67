package org.impala67.app.editor

import androidx.annotation.DrawableRes
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.HorizontalFloatingToolbar
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala

/**
 * Expressive Floating Toolbar über der Tastatur: Rückgängig/Wiederholen, Blocktyp (wie das
 * „Umwandeln in“-Menü der PWA, web/editor-menus.js) und Block löschen.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
internal fun EditorToolbar(vm: EditorViewModel, modifier: Modifier = Modifier) {
    val c = Impala.colors
    val current = vm.active?.let { a -> vm.blocks.firstOrNull { it.id == a.id } }?.type()
    val isText = vm.active?.mode == EditMode.Text || current != null
    val maxW = (LocalConfiguration.current.screenWidthDp - 56).coerceIn(200, 640).dp
    HorizontalFloatingToolbar(expanded = true, modifier = modifier) {
        Row(Modifier.widthIn(max = maxW).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
            ToolIcon(R.drawable.ic_i_undo, "Rückgängig", vm.canUndo) { vm.undo() }
            ToolIcon(R.drawable.ic_i_redo, "Wiederholen", vm.canRedo) { vm.redo() }
            Spacer(Modifier.width(6.dp))
            TypeButton("T", BlockType.Text, current, isText, vm)
            TypeButton("H1", BlockType.H1, current, isText, vm)
            TypeButton("H2", BlockType.H2, current, isText, vm)
            TypeButton("H3", BlockType.H3, current, isText, vm)
            TypeButton("•", BlockType.Bullet, current, isText, vm)
            TypeButton("1.", BlockType.Number, current, isText, vm)
            TypeButton("☑", BlockType.Todo, current, isText, vm)
            TypeButton("”", BlockType.Quote, current, isText, vm)
            TypeButton("</>", BlockType.Code, current, isText, vm)
            Spacer(Modifier.width(6.dp))
            ToolIcon(R.drawable.ic_i_trash, "Block löschen", true, tint = c.danger) { vm.deleteActive() }
        }
    }
}

@Composable
private fun ToolIcon(@DrawableRes icon: Int, description: String, enabled: Boolean, tint: androidx.compose.ui.graphics.Color = Impala.colors.text, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled) {
        Icon(
            painterResource(icon), description, Modifier.size(20.dp),
            tint = if (enabled) tint else Impala.colors.text2.copy(alpha = 0.4f),
        )
    }
}

@Composable
private fun TypeButton(glyph: String, type: BlockType, current: BlockType?, enabled: Boolean, vm: EditorViewModel) {
    val c = Impala.colors
    IconToggleButton(
        checked = current == type,
        onCheckedChange = { vm.convert(type) },
        enabled = enabled,
        modifier = Modifier.semantics { contentDescription = type.label },
        colors = IconButtonDefaults.iconToggleButtonColors(
            contentColor = c.text,
            checkedContainerColor = c.tint3,
            checkedContentColor = c.text,
        ),
    ) {
        Text(
            glyph, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
            fontFamily = if (glyph == "</>") FontFamily.Monospace else null,
            modifier = Modifier.padding(horizontal = 2.dp),
        )
    }
}
