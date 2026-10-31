package org.impala67.app.heft

import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.rememberScrollableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import org.impala67.app.heft.scan.rememberDocumentScan
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.TextSize
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Oberkante der ersten Seite auf dem Tablet: knapp unter der Leiste, die leicht übersteht (PWA). */
private val DESK_TOP = 48.dp

/** Lücke unter jeder Seite (PWA 24 px), darin „Seite N“. */
private val PAGE_GAP = 24.dp

/**
 * Heft öffnen (heft.js, heft-viewport.js): Seiten senkrecht scrollbar, Stift schreibt, Finger scrollt
 * und zoomt (Pinch). [pageId] ist die Seiten-ID des Hefts, nicht die einer Heftseite.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun HeftScreen(store: ImpalaStore, pageId: String, onBack: () -> Unit, modifier: Modifier = Modifier, onAi: (() -> Unit)? = null) {
    // Tablet (mit [onAi]): wie die PWA ohne Kopfzeile – Werkzeuge oben mittig, Ecken-Knöpfe links/rechts oben.
    val desk = onAi != null
    val vm = viewModel(key = "heft:$pageId") { HeftViewModel(store, pageId) }
    val ids by vm.pageIds.collectAsStateWithLifecycle()
    val title by vm.title.collectAsStateWithLifecycle()
    val pages = ids.orEmpty()
    val snackbar = remember { SnackbarHostState() }
    val lazy = rememberLazyListState(HeftLastPage[pageId])
    val zoom = remember { HeftZoom() }
    val scope = rememberCoroutineScope()
    var focus by remember { mutableStateOf<String?>(null) }
    var showPages by remember { mutableStateOf(false) }

    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(pages, focus) {
        val at = pages.indexOf(focus)
        if (at >= 0) { lazy.animateScrollToItem(at); focus = null }
    }
    // Aktuelle Seite = die in der Mitte der Ansicht.
    val current by remember {
        derivedStateOf {
            val info = lazy.layoutInfo
            val mid = (info.viewportStartOffset + info.viewportEndOffset) / 2
            info.visibleItemsInfo.firstOrNull { mid in it.offset until it.offset + it.size }?.index ?: lazy.firstVisibleItemIndex
        }
    }
    LaunchedEffect(current) { HeftLastPage[pageId] = current }
    val currentId = pages.getOrNull(current)
    val scan = rememberDocumentScan(
        onScanned = { scans -> scope.launch { focus = vm.addScanned(current + 1, scans) } },
        onError = vm::message,
    )

    val pageActions = HeftPageActions(
        add = { focus = vm.addPage(current + 1, it) },
        setPaper = { p -> currentId?.let { vm.setPaper(it, p) } },
        remove = { currentId?.let(vm::removePage) },
        canRemove = pages.size > 1,
        scan = scan,
        overview = { showPages = true },
    )
    Scaffold(
        modifier,
        containerColor = if (desk) Impala.colors.panel else Impala.colors.bg0,
        topBar = {
            if (!desk) HeftTopBar(
                title = title ?: "Heft",
                pageLabel = if (pages.isEmpty()) "" else "Seite ${current + 1} von ${pages.size}",
                onBack = onBack,
                actions = pageActions,
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { inner ->
        BoxWithConstraints(Modifier.padding(inner).fillMaxSize().clipToBounds()) {
            val density = LocalDensity.current
            val viewW = constraints.maxWidth.toFloat()
            val viewH = constraints.maxHeight.toFloat()
            val margin = with(density) { 16.dp.toPx() }
            // Abstand unter jeder Seite (PWA: 24 px), darin steht „Seite N“.
            val gap = with(density) { PAGE_GAP.toPx() }
            // Passbreite wie fitScale in heft-viewport.js: die ganze Seite sichtbar, oben Platz für die
            // schwebende Leiste, unten für die Seitenzahl.
            val top = if (desk) DESK_TOP else 12.dp
            val fitH = viewH - with(density) { (top + 56.dp).toPx() }
            val baseW = min(viewW - 2 * margin, fitH * HeftPage.RATIO)
            val pageW = baseW * zoom.zoom
            val contentW = max(viewW, pageW + 2 * margin)
            val maxPan by rememberUpdatedState(contentW - viewW)
            val pan = zoom.panX.coerceIn(0f, max(0f, maxPan))

            val panState = rememberScrollableState { delta ->
                val old = zoom.panX
                zoom.panX = (old - delta).coerceIn(0f, max(0f, maxPan))
                old - zoom.panX
            }

            fun commit(scale: Float, c: Offset) {
                val old = zoom.zoom
                val new = (old * scale).coerceIn(HeftZoom.MIN, HeftZoom.MAX)
                val ratio = new / old
                val newPageW = baseW * new
                val newContentW = max(viewW, newPageW + 2 * margin)
                // Fixpunkt waagerecht: gleicher Seitenbruchteil unter dem Finger.
                val left = (contentW - pageW) / 2
                val newLeft = (newContentW - newPageW) / 2
                zoom.panX = (newLeft + (zoom.panX + c.x - left) * ratio - c.x).coerceIn(0f, max(0f, newContentW - viewW))
                // Fixpunkt senkrecht: die Seite wächst, die Lücke darunter (gap) bleibt.
                val pageH = pageW / HeftPage.RATIO
                val newPageH = newPageW / HeftPage.RATIO
                val itemH = pageH + gap
                val newItemH = newPageH + gap
                val u = lazy.firstVisibleItemIndex * itemH + lazy.firstVisibleItemScrollOffset + c.y
                val index = (u / itemH).toInt()
                val r = u - index * itemH
                val pos = max(0f, index * newItemH + (if (r <= pageH) r * ratio else newPageH + (r - pageH)) - c.y)
                lazy.requestScrollToItem((pos / newItemH).toInt(), (pos % newItemH).roundToInt())
                zoom.zoom = new
                zoom.live = 1f
            }

            val showOptions = vm.tools.expanded

            Box(
                Modifier.fillMaxSize()
                    .heftPinch(zoom) { s, c -> commit(s, c) }
                    .scrollable(panState, Orientation.Horizontal),
            ) {
                LazyColumn(
                    Modifier
                        .requiredWidth(with(density) { contentW.toDp() })
                        .fillMaxHeight()
                        .offset { IntOffset(-pan.roundToInt(), 0) }
                        .graphicsLayer {
                            scaleX = zoom.live
                            scaleY = zoom.live
                            // Fixpunkt in Spalten-Pixeln (die Spalte ist um den Pan verschoben).
                            transformOrigin = TransformOrigin((zoom.origin.x + pan) / size.width, zoom.origin.y / size.height)
                        },
                    state = lazy,
                    contentPadding = PaddingValues(top = top, bottom = 72.dp),
                ) {
                    itemsIndexed(pages, key = { _, id -> id }) { i, id ->
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                            HeftPageView(vm, id, Modifier.width(with(density) { pageW.toDp() }))
                            // `.heft-page-label`
                            Box(Modifier.height(PAGE_GAP), Alignment.TopCenter) {
                                Text("Seite ${i + 1}", Modifier.padding(top = 3.dp), color = Impala.colors.text2, fontSize = TextSize.xs2)
                            }
                        }
                    }
                }
            }

            val vertical = maxWidth < 600.dp
            if (vertical) {
                Row(Modifier.align(Alignment.CenterEnd).padding(end = 12.dp), Arrangement.spacedBy(8.dp), Alignment.CenterVertically) {
                    if (showOptions) HeftOptions(vm, vertical = true)
                    HeftToolbar(vm, vertical = true)
                }
            } else if (desk) {
                Column(Modifier.align(Alignment.TopCenter).padding(top = 13.dp), Arrangement.spacedBy(2.dp), Alignment.CenterHorizontally) {
                    HeftToolbar(vm, vertical = false)
                    if (showOptions) HeftOptions(vm, vertical = false)
                }
            } else {
                Column(Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp), Arrangement.spacedBy(8.dp), Alignment.CenterHorizontally) {
                    if (showOptions) HeftOptions(vm, vertical = false)
                    HeftToolbar(vm, vertical = false)
                }
            }
            if (vm.lasso != null) {
                // Über der Werkzeugleiste, wenn sie unten liegt (PWA: bottom 74px).
                val bottom = if (!vertical && !desk) 96.dp else 74.dp
                HeftLassoBar(vm, Modifier.align(Alignment.BottomCenter).padding(bottom = bottom))
            }
            if (onAi != null) {
                HeftCornerPages({ showPages = true }, Modifier.align(Alignment.TopStart).padding(start = 12.dp, top = 18.dp))
                HeftCornerActions(pageActions, onAi, Modifier.align(Alignment.TopEnd).padding(end = 12.dp, top = 18.dp))
            }
        }
    }

    if (showPages) {
        HeftPagesSheet(
            vm = vm,
            pages = pages,
            current = current,
            desk = desk,
            onJump = { id -> showPages = false; focus = id },
            onDismiss = { showPages = false },
        )
    }
}
