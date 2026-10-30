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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Scaffold
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
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Platz über der ersten Seite für die schwebende Werkzeugleiste (Tablet). */
private val DESK_TOOLBAR_SPACE = 72.dp

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
            val margin = with(density) { 12.dp.toPx() }
            val gap = with(density) { 12.dp.toPx() }
            // Passbreite wie fitScale in heft-viewport.js: ganze Seite sichtbar, nie breiter als die Ansicht.
            val baseW = min(viewW - 2 * margin, viewH * HeftPage.RATIO)
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
                val new = (old * scale).coerceIn(1f, HeftZoom.MAX)
                val ratio = new / old
                val newPageW = baseW * new
                val newContentW = max(viewW, newPageW + 2 * margin)
                // Fixpunkt waagerecht: gleicher Seitenbruchteil unter dem Finger.
                val left = (contentW - pageW) / 2
                val newLeft = (newContentW - newPageW) / 2
                zoom.panX = (newLeft + (zoom.panX + c.x - left) * ratio - c.x).coerceIn(0f, max(0f, newContentW - viewW))
                // Fixpunkt senkrecht: Lücke (gap) bleibt, die Seite wächst.
                val itemH = gap + pageW / HeftPage.RATIO
                val newItemH = gap + newPageW / HeftPage.RATIO
                val u = lazy.firstVisibleItemIndex * itemH + lazy.firstVisibleItemScrollOffset + c.y
                val index = (u / itemH).toInt()
                val r = u - index * itemH
                val pos = max(0f, index * newItemH + (if (r <= gap) r else gap + (r - gap) * ratio) - c.y)
                lazy.requestScrollToItem((pos / newItemH).toInt(), (pos % newItemH).roundToInt())
                zoom.zoom = new
                zoom.live = 1f
            }

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
                    contentPadding = PaddingValues(top = if (desk) DESK_TOOLBAR_SPACE else 0.dp, bottom = 96.dp),
                ) {
                    items(pages, key = { it }) { id ->
                        Box(Modifier.fillMaxWidth().padding(top = 12.dp), Alignment.TopCenter) {
                            HeftPageView(vm, id, Modifier.width(with(density) { pageW.toDp() }))
                        }
                    }
                }
            }

            val vertical = maxWidth < 600.dp
            val showOptions = vm.tools.expanded
            if (vertical) {
                Row(Modifier.align(Alignment.CenterEnd).padding(end = 12.dp), Arrangement.spacedBy(8.dp), Alignment.CenterVertically) {
                    if (showOptions) HeftOptions(vm, vertical = true)
                    HeftToolbar(vm, vertical = true)
                }
            } else if (desk) {
                Column(Modifier.align(Alignment.TopCenter).padding(top = 10.dp), Arrangement.spacedBy(8.dp), Alignment.CenterHorizontally) {
                    HeftToolbar(vm, vertical = false)
                    if (showOptions) HeftOptions(vm, vertical = false)
                }
            } else {
                Column(Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp), Arrangement.spacedBy(8.dp), Alignment.CenterHorizontally) {
                    if (showOptions) HeftOptions(vm, vertical = false)
                    HeftToolbar(vm, vertical = false)
                }
            }
            if (onAi != null) {
                val label = if (pages.isEmpty()) "" else "${current + 1}/${pages.size}"
                HeftCornerPages(label, { showPages = true }, Modifier.align(Alignment.TopStart).padding(12.dp))
                HeftCornerActions(pageActions, onAi, Modifier.align(Alignment.TopEnd).padding(12.dp))
            }
        }
    }

    if (showPages) {
        HeftPagesSheet(
            vm = vm,
            pages = pages,
            current = current,
            onJump = { id -> showPages = false; focus = id },
            onDismiss = { showPages = false },
        )
    }
}
