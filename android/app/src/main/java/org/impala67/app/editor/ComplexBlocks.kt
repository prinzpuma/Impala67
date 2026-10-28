package org.impala67.app.editor

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.components.PanelCard
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import uniffi.impala_ffi.MdBlock
import uniffi.impala_ffi.MdBlockKind

private val BR = Regex("<br\\s*/?>", RegexOption.IGNORE_CASE)

/** Blöcke ohne direkt tippbaren Text: Bild, Heft, Datei, Formel, Tabelle, Callout, Toggle, Spalten, Unbekanntes. */
@Composable
internal fun ComplexBlock(block: MdBlock, ctx: ReadContext) {
    val c = Impala.colors
    val editable = ctx.onEditRaw != null && block.kind.let {
        it is MdBlockKind.Table || it is MdBlockKind.Callout || it is MdBlockKind.Toggle ||
            it is MdBlockKind.Columns || it is MdBlockKind.Other || it is MdBlockKind.Math
    }
    Box(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().padding(end = if (editable) 36.dp else 0.dp)) {
            when (val k = block.kind) {
                is MdBlockKind.Image -> ImageBlock(k, ctx.store)
                is MdBlockKind.Heft -> LinkCard(R.drawable.ic_i_notebook, "Heft") { ctx.onOpenPage?.invoke(k.heftId) }
                is MdBlockKind.File -> LinkCard(R.drawable.ic_i_paperclip, k.name.ifEmpty { "Datei" }) { }
                is MdBlockKind.Math -> Text(
                    k.text, Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 10.dp).horizontalScroll(rememberScrollState()),
                    color = c.text, fontFamily = FontFamily.Monospace, fontSize = 15.sp, textAlign = TextAlign.Center,
                )
                is MdBlockKind.Table -> TableBlock(k.rows, ctx)
                is MdBlockKind.Callout -> CalloutBlock(k, ctx)
                is MdBlockKind.Toggle -> ToggleBlock(block.id, k, ctx)
                is MdBlockKind.Columns -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    k.columns.forEach { col -> BlockList(col, ctx.forChildren(), Modifier.weight(1f)) }
                }
                is MdBlockKind.Other -> Text(k.text, Modifier.padding(3.dp), color = c.text, fontSize = 16.sp, lineHeight = 25.sp)
                else -> Unit
            }
        }
        if (editable) {
            IconButton(onClick = { ctx.onEditRaw?.invoke(block) }, Modifier.align(Alignment.TopEnd).size(36.dp)) {
                Icon(painterResource(R.drawable.ic_i_pen), "Als Markdown bearbeiten", Modifier.size(18.dp), tint = c.text2)
            }
        }
    }
}

@Composable
private fun LinkCard(icon: Int, label: String, onClick: () -> Unit) {
    val c = Impala.colors
    PanelCard(Modifier.fillMaxWidth(), color = c.surface, onClick = onClick) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(painterResource(icon), null, Modifier.size(20.dp), tint = c.text2)
            Text(label, color = c.text, fontSize = 15.sp)
        }
    }
}

@Composable
private fun ImageBlock(k: MdBlockKind.Image, store: ImpalaStore?) {
    val c = Impala.colors
    val id = k.src.removePrefix("file:").takeIf { k.src.startsWith("file:") }
    val bitmap by produceState<Bitmap?>(null, id, store) {
        value = if (id == null || store == null) null else withContext(Dispatchers.IO) {
            store.core.file(id)?.let { decodeSampled(it.bytes, 1600) }
        }
    }
    val shape = RoundedCornerShape(Radius.md)
    val bmp = bitmap
    if (bmp != null) {
        val maxW = with(LocalDensity.current) { bmp.width.toDp() }
        Image(
            bmp.asImageBitmap(), k.alt.ifEmpty { null }, Modifier.widthIn(max = maxW).fillMaxWidth().padding(vertical = 6.dp).clip(shape),
            contentScale = ContentScale.FillWidth,
        )
    } else {
        Box(Modifier.fillMaxWidth().height(96.dp).clip(shape).background(c.surface), contentAlignment = Alignment.Center) {
            Text(k.alt.ifEmpty { "Bild" }, color = c.text2, fontSize = 13.sp)
        }
    }
}

private fun decodeSampled(bytes: ByteArray, maxSide: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maxSide) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}

@Composable
private fun TableBlock(rows: List<List<String>>, ctx: ReadContext) {
    val c = Impala.colors
    val styler = remember(c, ctx.onLink) { InlineStyler(c, keepMarkers = false, onLink = ctx.onLink) }
    Column(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 4.dp).border(1.dp, c.edge)) {
        rows.forEachIndexed { r, row ->
            Row(Modifier.height(IntrinsicSize.Min)) {
                row.forEach { cell ->
                    Box(Modifier.width(150.dp).fillMaxHeight().border(0.5.dp, c.edge).padding(horizontal = 10.dp, vertical = 5.dp)) {
                        Text(
                            styler.build(cell.replace(BR, "\n")),
                            style = TextStyle(color = c.text, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = if (r == 0) FontWeight.SemiBold else null),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CalloutBlock(k: MdBlockKind.Callout, ctx: ReadContext) {
    val c = Impala.colors
    val tone = inlineColor(k.color, c.isDark)
    val shape = RoundedCornerShape(Radius.sm)
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(shape).background(tone.copy(alpha = 0.14f)).border(1.dp, c.surfaceHover, shape)
            .padding(start = 14.dp, top = 14.dp, end = 14.dp, bottom = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.padding(top = 3.dp).size(18.dp).clip(CircleShape).background(tone))
        BlockList(k.children, ctx.forChildren(), Modifier.weight(1f))
    }
}

@Composable
private fun ToggleBlock(id: String, k: MdBlockKind.Toggle, ctx: ReadContext) {
    val c = Impala.colors
    var open by rememberSaveable(id) { mutableStateOf(k.open) }
    val styler = remember(c, ctx.onLink) { InlineStyler(c, keepMarkers = false, onLink = ctx.onLink) }
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.xs)).clickable { open = !open }.padding(vertical = 3.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Box(Modifier.size(24.dp).padding(top = 2.dp), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_i_chevron_right), if (open) "Zuklappen" else "Aufklappen", Modifier.size(16.dp).rotate(if (open) 90f else 0f), tint = c.text2)
            }
            Text(styler.build(k.summary), color = c.text, fontSize = 16.sp, lineHeight = 25.sp, modifier = Modifier.weight(1f))
        }
        AnimatedVisibility(open) {
            BlockList(k.children, ctx.forChildren(), Modifier.padding(start = 24.dp))
        }
    }
}
