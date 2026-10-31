package org.impala67.app.heft

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize

private val TileShape = RoundedCornerShape(Radius.xs)

/** Laufendes Ziehen einer Seite: Zeiger in Wurzelkoordinaten, Griffpunkt in der Kachel, Ziel-Index. */
private data class PageDrag(val id: String, val from: Int, val pointer: Offset, val grab: Offset, val target: Int?)

/**
 * Raster aller Seiten (heft-pages-ui.js `pagesGridHtml`): Miniaturen mit Nummer, die aktive Seite
 * umrandet. Am Griff ⠿ lässt sich eine Seite auf eine andere ziehen ([onMove], Ziel gestrichelt).
 * Im Auswahlmodus zeigt ein Haken die gewählten Seiten; am Ende „Neue Seite“.
 */
@Composable
fun HeftPagesGrid(
    vm: HeftViewModel,
    pages: List<String>,
    current: Int,
    selected: Set<String>,
    picking: Boolean,
    onTap: (String) -> Unit,
    onAdd: () -> Unit,
    onMove: (id: String, to: Int) -> Unit,
    modifier: Modifier = Modifier,
    /** Feste Spaltenzahl (Tablet-Popover: 3 × 160 dp); sonst so viele, wie hineinpassen. */
    columns: Int? = null,
) {
    val grid = rememberLazyGridState()
    val tiles = remember { HashMap<String, Rect>() }
    var area by remember { mutableStateOf(Rect.Zero) }
    var drag by remember { mutableStateOf<PageDrag?>(null) }
    val edge = with(LocalDensity.current) { 28.dp.toPx() }
    val step = with(LocalDensity.current) { 18.dp.toPx() }

    fun target(p: Offset): Int? {
        val visible = grid.layoutInfo.visibleItemsInfo.mapTo(HashSet()) { it.key }
        return pages.indices.firstOrNull { i -> pages[i] in visible && tiles[pages[i]]?.contains(p) == true }
    }
    // Am Rand des Rasters mitscrollen (wie die Auswahlgeste der PWA: 28 px Rand, 18 px Schritt).
    val dragging = drag != null
    LaunchedEffect(dragging) {
        while (dragging) {
            val p = drag?.pointer ?: break
            val dy = when { p.y < area.top + edge -> -step; p.y > area.bottom - edge -> step; else -> 0f }
            if (dy != 0f) {
                grid.scrollBy(dy)
                drag = drag?.let { it.copy(target = target(it.pointer)) }
            }
            delay(16)
        }
    }

    LazyVerticalGrid(
        columns = columns?.let { GridCells.Fixed(it) } ?: GridCells.Adaptive(minSize = 110.dp),
        state = grid,
        modifier = modifier.onGloballyPositioned { area = it.boundsInRoot() },
        // `.heft-pop-grid`: 16 / 22 / 30 px Innenabstand, 26 × 18 px Lücken (Nummer steht in der Lücke).
        contentPadding = PaddingValues(start = 22.dp, top = 16.dp, end = 22.dp, bottom = 30.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        itemsIndexed(pages, key = { _, id -> id }) { i, id ->
            val d = drag
            val mine = d?.id == id
            PageTile(
                vm = vm,
                heftPageId = id,
                index = i,
                highlighted = if (picking) id in selected else i == current,
                checked = id in selected,
                picking = picking,
                dropTarget = d != null && !mine && d.target == i,
                onClick = { onTap(id) },
                modifier = Modifier.onGloballyPositioned { tiles[id] = it.boundsInRoot() },
                lift = if (mine && d != null) {
                    { tiles[id]?.let { d.pointer - d.grab - it.topLeft } ?: Offset.Zero }
                } else null,
                grip = { coords ->
                    Modifier.pointerInput(id) {
                        detectDragGestures(
                            onDragStart = { o ->
                                val p = coords()?.localToRoot(o) ?: return@detectDragGestures
                                val tile = tiles[id] ?: return@detectDragGestures
                                drag = PageDrag(id, i, p, p - tile.topLeft, null)
                            },
                            onDrag = { change, _ ->
                                change.consume()
                                val p = coords()?.localToRoot(change.position) ?: return@detectDragGestures
                                drag = drag?.copy(pointer = p, target = target(p))
                            },
                            onDragEnd = {
                                val done = drag
                                drag = null
                                if (done?.target != null && done.target != done.from) onMove(done.id, done.target)
                            },
                            onDragCancel = { drag = null },
                        )
                    }
                },
            )
        }
        if (!picking) {
            item(key = "neue-seite") { AddTile(onAdd) }
        }
    }
}

@Composable
private fun PageTile(
    vm: HeftViewModel,
    heftPageId: String,
    index: Int,
    highlighted: Boolean,
    checked: Boolean,
    picking: Boolean,
    dropTarget: Boolean,
    onClick: () -> Unit,
    modifier: Modifier,
    /** Versatz der gezogenen Kachel zum Finger; `null`, wenn sie nicht gezogen wird. */
    lift: (() -> Offset)?,
    /** Ziehgeste für den Griff; bekommt dessen Koordinaten. */
    grip: (coords: () -> LayoutCoordinates?) -> Modifier,
) {
    val c = Impala.colors
    val data by vm.page(heftPageId).collectAsStateWithLifecycle()
    val dash = with(LocalDensity.current) { PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx())) }
    Column(
        modifier.zIndex(if (lift != null) 1f else 0f)
            .clickable(role = Role.Button, onClickLabel = "Seite ${index + 1}", onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(HeftPage.RATIO)
                .graphicsLayer {
                    val o = lift?.invoke() ?: return@graphicsLayer
                    translationX = o.x
                    translationY = o.y
                    scaleX = 1.04f
                    scaleY = 1.04f
                    alpha = 0.85f
                }
                .drawBehind {
                    if (!dropTarget) return@drawBehind
                    // .heft-pop-thumb.drag-target: gestrichelter Akzentrahmen mit 4 px Abstand.
                    val out = 4.dp.toPx()
                    drawRoundRect(
                        c.accent,
                        topLeft = Offset(-out, -out),
                        size = Size(size.width + 2 * out, size.height + 2 * out),
                        cornerRadius = CornerRadius(Radius.xs.toPx() + out),
                        style = Stroke(2.dp.toPx(), pathEffect = dash),
                    )
                },
        ) {
            // `.heft-pop-thumb canvas`: feiner dunkler Ring und weicher Schatten; aktiv mit Akzentrahmen 3 px außen.
            PageSketch(
                data,
                Modifier.fillMaxSize()
                    .drawBehind {
                        if (!highlighted) return@drawBehind
                        val out = 3.dp.toPx() + 1.dp.toPx()
                        drawRoundRect(
                            c.accent,
                            topLeft = Offset(-out, -out),
                            size = Size(size.width + 2 * out, size.height + 2 * out),
                            cornerRadius = CornerRadius(Radius.xs.toPx() + out),
                            style = Stroke(2.dp.toPx()),
                        )
                    }
                    .shadow(if (lift != null) 12.dp else 6.dp, TileShape, ambientColor = Color.Black.copy(alpha = 0.3f), spotColor = Color.Black.copy(alpha = 0.7f))
                    .clip(TileShape).border(1.dp, Color.Black.copy(alpha = 0.14f), TileShape),
            )
            if (!picking) {
                var coords by remember { mutableStateOf<LayoutCoordinates?>(null) }
                // `.heft-page-drag`: runder, halbtransparenter Griff oben rechts (auf Touch-Geräten 70 %).
                Box(
                    Modifier.align(Alignment.TopEnd).padding(6.dp).size(26.dp).alpha(0.7f).clip(CircleShape)
                        .background(Color(0x73141414))
                        .onGloballyPositioned { coords = it }
                        .then(grip { coords })
                        .semantics { contentDescription = "Seite verschieben" },
                    Alignment.Center,
                ) {
                    Text("⠿", color = Color.White, fontSize = 13.sp)
                }
            }
            if (picking && checked) {
                Box(
                    Modifier.align(Alignment.TopEnd).padding(6.dp).size(26.dp).clip(CircleShape).background(c.accent),
                    Alignment.Center,
                ) {
                    Icon(painterResource(R.drawable.ic_i_check), null, Modifier.size(16.dp), c.onAccent)
                }
            }
        }
        // Seitenzahl als Kapsel; aktiv getönt.
        Text(
            "${index + 1}",
            modifier = Modifier.padding(top = 6.dp).clip(CircleShape)
                .background(if (highlighted && !picking) c.tint2 else Color.Transparent)
                .padding(horizontal = 8.dp, vertical = 1.dp),
            color = if (highlighted && !picking) c.text else c.text2,
            fontSize = TextSize.xs2,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun AddTile(onClick: () -> Unit) {
    val c = Impala.colors
    // `.heft-pop-add`: getönte Fläche im Seitenformat, „+“ im Kreis, darunter „Neue Seite“.
    Box(
        Modifier.fillMaxWidth().aspectRatio(HeftPage.RATIO).clip(TileShape).background(c.tint)
            .clickable(role = Role.Button, onClickLabel = "Neue Seite", onClick = onClick),
        Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(c.tint2), Alignment.Center) {
                Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(20.dp), c.text2)
            }
            Text("Neue Seite", color = c.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
        }
    }
}
