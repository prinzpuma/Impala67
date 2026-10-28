package org.impala67.app.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.ImpalaColors
import org.impala67.app.ui.theme.Radius
import uniffi.impala_ffi.MdBlock
import uniffi.impala_ffi.MdBlockKind
import uniffi.impala_ffi.MdHeadingLevel
import uniffi.impala_ffi.MdListStyle

/** Eine Reihe Blöcke untereinander (Anzeige; im Editor liefert eine `LazyColumn` die Zeilen selbst). */
@Composable
internal fun BlockList(blocks: List<MdBlock>, ctx: ReadContext, modifier: Modifier = Modifier) {
    val numbers = remember(blocks) { listNumbers(blocks) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        blocks.forEachIndexed { i, b -> ReadBlock(b, ctx, numbers[b.id], i == 0) }
    }
}

/** Schriftart je Blocktyp (editor.css: `.blk-text`, `.blk-h1…3`, `.blk-code`). */
internal fun textStyleFor(block: MdBlock, c: ImpalaColors): TextStyle {
    val k = block.kind
    val color = block.textColor?.let { inlineColor(it, c.isDark) } ?: c.text
    val base = TextStyle(color = color, fontSize = 16.sp, lineHeight = 25.sp)
    return when {
        k is MdBlockKind.Heading -> when (k.level) {
            MdHeadingLevel.H1 -> base.copy(fontSize = 30.sp, lineHeight = 39.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.7).sp)
            MdHeadingLevel.H2 -> base.copy(fontSize = 24.sp, lineHeight = 31.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.4).sp)
            MdHeadingLevel.H3 -> base.copy(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold)
        }
        k is MdBlockKind.Code -> base.copy(fontFamily = FontFamily.Monospace, fontSize = 13.6.sp, lineHeight = 22.sp)
        k is MdBlockKind.ListItem && (k.style as? MdListStyle.Todo)?.checked == true ->
            base.copy(color = c.text2, textDecoration = TextDecoration.LineThrough)
        else -> base
    }
}

/** Platzhalter eines leeren Textblocks (editor.js `ph:`). */
internal fun placeholderFor(block: MdBlock): String = when (val k = block.kind) {
    is MdBlockKind.Heading -> "Überschrift " + (k.level.ordinal + 1)
    is MdBlockKind.ListItem -> if (k.style is MdListStyle.Todo) "To-do" else "Liste"
    is MdBlockKind.Quote -> "Zitat"
    else -> ""
}

/** Ein Block, wie ihn die PWA zeigt. Textblöcke wechseln über [ReadContext.editSlot] ins Eingabefeld. */
@Composable
internal fun ReadBlock(block: MdBlock, ctx: ReadContext, number: Int?, first: Boolean) {
    val c = Impala.colors
    val editing = ctx.editingId == block.id && ctx.editSlot != null
    val selected = ctx.selectedId == block.id && !editing
    var mod: Modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.xs))
    block.bgColor?.let { mod = mod.background(inlineColor(it, c.isDark).copy(alpha = 0.28f)) }
    if (selected) mod = mod.border(2.dp, c.accentBorderColor(), RoundedCornerShape(Radius.xs))
    val tap = ctx.onTap
    if (tap != null && !editing) mod = mod.clickable { tap(block) }
    Box(mod) {
        when (val k = block.kind) {
            is MdBlockKind.Paragraph -> TextBlock(block, ctx, editing, Modifier.padding(vertical = 3.dp, horizontal = 2.dp))
            is MdBlockKind.Heading -> {
                val top = if (first) 0.dp else when (k.level) { MdHeadingLevel.H1 -> 22.dp; MdHeadingLevel.H2 -> 16.dp; MdHeadingLevel.H3 -> 10.dp }
                TextBlock(block, ctx, editing, Modifier.padding(top = top, bottom = 2.dp, start = 2.dp, end = 2.dp))
            }
            is MdBlockKind.ListItem -> ListRow(block, k, ctx, editing, number)
            is MdBlockKind.Quote -> {
                val bar = c.text
                TextBlock(
                    block, ctx, editing,
                    Modifier.padding(start = 3.dp).drawBehind { drawRect(bar, size = Size(3.dp.toPx(), size.height)) }
                        .padding(start = 14.dp, top = 2.dp, bottom = 2.dp),
                )
            }
            is MdBlockKind.Code -> CodeBlock(block, k, ctx, editing)
            is MdBlockKind.Divider -> HorizontalDivider(Modifier.padding(vertical = 13.dp), color = c.edge)
            else -> ComplexBlock(block, ctx)
        }
    }
}

@Composable
private fun TextBlock(block: MdBlock, ctx: ReadContext, editing: Boolean, modifier: Modifier) {
    val c = Impala.colors
    val style = textStyleFor(block, c)
    if (editing) {
        ctx.editSlot?.invoke(block, style, modifier)
    } else {
        val styler = remember(c, ctx.onLink) { InlineStyler(c, keepMarkers = false, onLink = ctx.onLink) }
        val text = block.text()
        if (text.isEmpty()) {
            Text(placeholderFor(block).ifEmpty { " " }, modifier, style = style.copy(color = c.text2.copy(alpha = 0.45f)))
        } else {
            Text(styler.build(text), modifier, style = style)
        }
    }
}

@Composable
private fun ListRow(block: MdBlock, k: MdBlockKind.ListItem, ctx: ReadContext, editing: Boolean, number: Int?) {
    val c = Impala.colors
    Row(Modifier.padding(start = (k.indent.toInt() * 24).dp), verticalAlignment = Alignment.Top) {
        val style = k.style
        when (style) {
            is MdListStyle.Todo -> {
                val toggle = ctx.onToggleTodo
                Box(
                    Modifier.size(28.dp).clip(RoundedCornerShape(Radius.xs)).then(if (toggle != null) Modifier.clickable { toggle(block.id) } else Modifier),
                    contentAlignment = Alignment.Center,
                ) { Checkbox(checked = style.checked, onCheckedChange = null) }
            }
            MdListStyle.Bullet -> Box(Modifier.width(24.dp).heightIn(min = 28.dp), contentAlignment = Alignment.Center) {
                Text("•", color = c.text, fontSize = 16.sp)
            }
            MdListStyle.Number -> Box(Modifier.width(28.dp).heightIn(min = 28.dp).padding(end = 2.dp), contentAlignment = Alignment.CenterEnd) {
                Text("${number ?: 1}.", color = c.text, fontSize = 15.sp, textAlign = TextAlign.End)
            }
        }
        Box(Modifier.weight(1f)) { TextBlock(block, ctx, editing, Modifier.padding(vertical = 3.dp, horizontal = 2.dp)) }
    }
}

@Composable
private fun CodeBlock(block: MdBlock, k: MdBlockKind.Code, ctx: ReadContext, editing: Boolean) {
    val c = Impala.colors
    val shape = RoundedCornerShape(Radius.sm)
    Column(
        Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(shape).background(c.surfaceSubtle).border(1.dp, c.edgeSoft, shape)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        if (k.language.isNotEmpty()) Text(k.language, color = c.text2, fontSize = 12.sp, modifier = Modifier.padding(bottom = 4.dp))
        if (editing) {
            ctx.editSlot?.invoke(block, textStyleFor(block, c), Modifier.fillMaxWidth())
        } else {
            val text = k.text.ifEmpty { " " }
            Text(text, Modifier.horizontalScroll(rememberScrollState()), style = textStyleFor(block, c), softWrap = false)
        }
    }
}

private fun ImpalaColors.accentBorderColor() = accent.copy(alpha = if (isDark) 0.6f else 0.7f)
