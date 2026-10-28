package org.impala67.app.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.ui.components.PanelCard
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.components.TintLabel
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary

/** Heft-Vorschaubild (kommt aus dem Heft-Modul). */
typealias HeftThumb = @Composable (pageId: String, modifier: Modifier) -> Unit

/** Breite der Startseite (Container-Queries in home.css): schmal < 520, breit ≥ 760. */
enum class HomeWidth { Narrow, Medium, Wide }

/** „Weitermachen“ (`.hv-continue`): Vorschau als Bild, daneben bzw. (breit) darunter der Titel. */
@Composable
fun ContinueCard(item: ContinueItem?, width: HomeWidth, onOpen: (String) -> Unit, onNewPage: () -> Unit, heftThumbnail: HeftThumb) {
    val wide = width == HomeWidth.Wide
    PanelCard(Modifier.fillMaxWidth(), padding = PaddingValues(14.dp), onClick = { item?.let { onOpen(it.page.id) } ?: onNewPage() }) {
        val copy: @Composable () -> Unit = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                Text(if (item == null) "Noch keine Seiten" else "Weitermachen", fontSize = TextSize.xs, color = Impala.colors.text2)
                Text(
                    item?.let { HomeText.title(it.page) } ?: "Erste Seite anlegen",
                    style = MaterialTheme.typography.headlineSmall.copy(fontSize = if (width == HomeWidth.Narrow) 18.sp else 24.sp),
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                if (item != null) Text("${item.meta} · ${HomeText.whenText(item.page.updated)}", fontSize = TextSize.sm, color = Impala.colors.text2)
            }
        }
        if (wide) {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                Preview(item, Modifier.fillMaxWidth().aspectRatio(16f / 10f), large = true, heftThumbnail)
                copy()
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s6), verticalAlignment = Alignment.CenterVertically) {
                Preview(item, Modifier.width(if (width == HomeWidth.Narrow) 120.dp else 200.dp).aspectRatio(4f / 3f), large = false, heftThumbnail)
                copy()
            }
        }
    }
}

/** `.hv-prev`: Heft auf Papier, Notiz als ausgeblendete erste Zeilen, leer als „+“. */
@Composable
private fun Preview(item: ContinueItem?, modifier: Modifier, large: Boolean, heftThumbnail: HeftThumb) {
    val c = Impala.colors
    val shape = RoundedCornerShape(Radius.lg)
    val frame = if (item == null) modifier.clip(shape).border(1.dp, c.edge, shape)
    else modifier.shadow(8.dp, shape, ambientColor = Color.Black.copy(alpha = 0.3f)).clip(shape).border(1.dp, c.edgeSoft, shape)
    when {
        item == null -> Box(frame, contentAlignment = Alignment.Center) { Text("+", fontSize = 28.sp, color = c.text2) }
        item.page.kind == PageKind.HEFT -> Box(frame.background(c.paper)) { heftThumbnail(item.page.id, Modifier.matchParentSize()) }
        else -> Column(
            frame.background(c.previewBg)
                .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
                .drawWithContent {
                    drawContent()
                    drawRect(Brush.verticalGradient(0.55f to Color.Black, 1f to Color.Transparent), blendMode = BlendMode.DstIn)
                }
                .padding(start = if (large) 28.dp else Space.s4, end = if (large) 28.dp else Space.s4, top = if (large) Space.s6 else Space.s4),
            verticalArrangement = Arrangement.spacedBy(if (large) Space.s2 else 5.dp),
        ) {
            val size = if (large) TextSize.sm else TextSize.xs3
            if (item.excerpt.isEmpty()) Text("Leere Seite", fontSize = TextSize.sm, color = c.text2)
            item.excerpt.forEach { Text(it, fontSize = size, lineHeight = size * 1.45f, color = c.text2, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }
}

/** Angeheftete Seiten (`.hv-pins`). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Pins(pages: List<PageSummary>, onOpen: (String) -> Unit) {
    if (pages.isEmpty()) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s2), verticalArrangement = Arrangement.spacedBy(Space.s2)) {
        pages.forEach { pg ->
            TintButton({ onOpen(pg.id) }, Modifier.widthIn(max = 220.dp), strong = false) { TintLabel(HomeText.title(pg), strong = false) }
        }
    }
}

/** „Weißt du's noch?“ (`.hv-recall`): zum Aufdecken, ohne Bewertung. */
@Composable
fun RecallCard(recall: Recall) {
    val c = Impala.colors
    var open by rememberSaveable(recall.cardId) { mutableStateOf(false) }
    val bg by animateColorAsState(if (open) c.surfaceSubtle else c.tint, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "recall")
    PanelCard(
        Modifier.fillMaxWidth().padding(top = Space.s2), color = bg, border = if (open) c.edgeSoft else Color.Transparent,
        padding = PaddingValues(horizontal = Space.s5, vertical = Space.s4),
        onClick = { open = !open },
    ) {
        Text("Weißt du's noch?", fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold, color = c.text)
        Spacer(Modifier.height(Space.s1))
        Text(recall.question, fontSize = TextSize.md, lineHeight = TextSize.md * 1.45f, color = c.text)
        if (!open) Text("Antwort zeigen", fontSize = TextSize.xs, color = c.accent, modifier = Modifier.padding(top = Space.s2))
        AnimatedVisibility(open, enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + expandVertically(MaterialTheme.motionScheme.defaultSpatialSpec())) {
            Column(Modifier.padding(top = Space.s3)) {
                HorizontalDivider(color = c.edgeSoft)
                Text(recall.answer, fontSize = TextSize.md, lineHeight = TextSize.md * 1.45f, color = c.text, modifier = Modifier.padding(top = Space.s3))
            }
        }
    }
}
