package org.impala67.app.heft

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.rememberScrollableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import org.impala67.app.ImpalaApp
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.heft.scan.rememberDocumentScan
import org.impala67.app.ui.components.pressScale
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.LocalAppearance
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.HeftPageData
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Oberkante der ersten Seite auf dem Tablet: knapp unter der Leiste, die leicht übersteht (PWA). */
private val DESK_TOP = 52.dp

/** Auf dem Telefon liegt die Werkzeugleiste über dem Heft unter der Kopfzeile. */
private val PHONE_TOP = 64.dp

/** Lücke unter jeder Seite (PWA 24 px), darin „Seite N“. */
private val PAGE_GAP = 24.dp

/**
 * Heft öffnen (heft.js, heft-viewport.js): Seiten senkrecht scrollbar, Stift schreibt, Finger scrollt
 * und zoomt (Pinch, Doppeltipp). [pageId] ist die Seiten-ID des Hefts, nicht die einer Heftseite.
 * Tablet ([desk]): wie die PWA ohne Kopfzeile – Werkzeuge oben mittig, Ecken-Knöpfe links/rechts oben.
 * Telefon: Kopfzeile, Werkzeuge oben mittig, Seiten und „+“ unten in den Ecken.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun HeftScreen(
    store: ImpalaStore,
    pageId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    desk: Boolean = false,
    onAi: (() -> Unit)? = null,
) {
    val prefs = (LocalContext.current.applicationContext as ImpalaApp).prefs
    val vm = viewModel(key = "heft:$pageId") { HeftViewModel(store, pageId, prefs) }
    val ids by vm.pageIds.collectAsStateWithLifecycle()
    val title by vm.title.collectAsStateWithLifecycle()
    val pages = ids.orEmpty()
    val snackbar = remember { SnackbarHostState() }
    val lazy = rememberLazyListState(HeftLastPage[pageId])
    val zoom = remember { HeftZoom() }
    val scope = rememberCoroutineScope()
    val reduceMotion = LocalAppearance.current.reduceMotion
    var focus by remember { mutableStateOf<String?>(null) }
    var showPages by remember { mutableStateOf(false) }
    var insertPos by remember { mutableStateOf(InsertPos.AFTER) }

    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(pages, focus) {
        val at = pages.indexOf(focus)
        if (at >= 0) { lazy.animateScrollToItem(at); focus = null }
    }
    // Aktuelle Seite = die in der Mitte der Ansicht (der Knopf „Neue Seite“ am Ende zählt nicht).
    val current by remember {
        derivedStateOf {
            val info = lazy.layoutInfo
            val mid = (info.viewportStartOffset + info.viewportEndOffset) / 2
            val at = info.visibleItemsInfo.firstOrNull { mid in it.offset until it.offset + it.size }?.index ?: lazy.firstVisibleItemIndex
            min(at, max(0, info.totalItemsCount - 2))
        }
    }
    LaunchedEffect(current) { HeftLastPage[pageId] = current }
    val currentId = pages.getOrNull(current)
    val currentData by remember(currentId) { currentId?.let(vm::page) ?: MutableStateFlow<HeftPageData?>(null) }.collectAsStateWithLifecycle()
    val scan = rememberDocumentScan(
        onScanned = { scans -> scope.launch { focus = vm.addScanned(current + 1, scans) } },
        onError = vm::message,
    )

    val pageActions = HeftPageActions(
        add = { paper, pos ->
            val at = when (pos) {
                InsertPos.BEFORE -> current
                InsertPos.AFTER -> current + 1
                InsertPos.LAST -> null
            }
            focus = vm.addPage(at, paper)
        },
        setPaper = { p -> currentId?.let { vm.setPaper(it, p) } },
        remove = { currentId?.let(vm::removePage) },
        canRemove = pages.size > 1,
        scan = scan,
        overview = { showPages = true },
        currentPaper = currentData?.paper?.let(Paper::of),
        insertPos = insertPos,
        setInsertPos = { insertPos = it },
    )
    val pageLabel = if (pages.isEmpty()) "" else "Seite ${current + 1} von ${pages.size}"
    Scaffold(
        modifier,
        containerColor = if (desk) Impala.colors.panel else Impala.colors.bg0,
        topBar = {
            if (!desk) HeftTopBar(
                title = title ?: "Heft",
                pageLabel = pageLabel,
                onBack = onBack,
                canUndo = vm.canUndo,
                canRedo = vm.canRedo,
                onUndo = vm::undo,
                onRedo = vm::redo,
                onAi = onAi,
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
            val top = if (desk) DESK_TOP else PHONE_TOP
            val bottom = if (desk) 72.dp else 96.dp
            val fitH = viewH - with(density) { (top + 40.dp).toPx() }
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

            // Doppeltipp: weich auf ca. 2,2× bzw. zurück auf Passbreite (heft-viewport.js `animateZoom`).
            fun zoomTo(c: Offset) {
                val target = if (zoom.zoom >= 1.9f) 1f else max(2.2f, min(HeftZoom.MAX, zoom.zoom * 1.8f))
                val ratio = target / zoom.zoom
                scope.launch {
                    zoom.origin = c
                    if (!reduceMotion) animate(1f, ratio, animationSpec = tween(240)) { v, _ -> zoom.live = v }
                    commit(ratio, c)
                }
            }

            val gestures = rememberUpdatedState(HeftGestureCallbacks(
                pinchEnd = { s, c -> commit(s, c) },
                doubleTap = { zoomTo(it) },
                undo = vm::undo,
                redo = vm::redo,
                fingerFree = { vm.tools.onlyPen },
            ))

            Box(
                Modifier.fillMaxSize()
                    .heftGestures(zoom, gestures)
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
                    contentPadding = PaddingValues(top = top, bottom = bottom),
                ) {
                    itemsIndexed(pages, key = { _, id -> id }) { i, id ->
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                            HeftPageView(vm, id, Modifier.width(with(density) { pageW.toDp() }))
                            // `.heft-page-label`
                            Box(Modifier.height(PAGE_GAP), Alignment.TopCenter) {
                                Text("Seite ${i + 1}", Modifier.padding(top = 4.dp), color = Impala.colors.text2, fontSize = TextSize.xs2)
                            }
                        }
                    }
                    if (pages.isNotEmpty()) {
                        item(key = "heft-add-end") {
                            Box(Modifier.fillMaxWidth().padding(top = 4.dp), Alignment.Center) {
                                AddPageGhost(Modifier.width(with(density) { min(pageW, 360.dp.toPx()).toDp() })) {
                                    scope.launch { focus = vm.addPage(null, vm.lastPaper()) }
                                }
                            }
                        }
                    }
                }
                if (ids == null) {
                    Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        LoadingIndicator()
                        Text("Heft laden…", color = Impala.colors.text2, fontSize = TextSize.sm)
                    }
                }
            }

            // Leisten über dem Heft; beim Schreiben treten sie zurück.
            HeftChrome(vm) {
                HeftToolbar(vm, phone = !desk, modifier = Modifier.align(Alignment.TopCenter).padding(top = if (desk) 10.dp else 8.dp))

                AnimatedVisibility(
                    visible = vm.lasso != null,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = if (desk) 28.dp else 76.dp),
                    enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + slideInVertically { it / 2 },
                    exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + slideOutVertically { it / 2 },
                    label = "heft-lasso-bar",
                ) { HeftLassoBar(vm) }

                if (desk) {
                    HeftCornerPages({ showPages = true }, Modifier.align(Alignment.TopStart).padding(start = 12.dp, top = 14.dp))
                    HeftCornerActions(pageActions, onAi ?: {}, Modifier.align(Alignment.TopEnd).padding(end = 12.dp, top = 14.dp))
                } else {
                    PagesPill(
                        label = if (pages.isEmpty()) "" else "${current + 1} / ${pages.size}",
                        onClick = { showPages = true },
                        modifier = Modifier.align(Alignment.BottomStart).padding(start = 16.dp, bottom = 16.dp),
                    )
                    var addMenu by remember { mutableStateOf(false) }
                    Box(Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 16.dp)) {
                        HeftCornerButton("Seite hinzufügen", { addMenu = true }, Modifier.size(48.dp), active = addMenu) {
                            Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(22.dp))
                        }
                        HeftAddMenu(addMenu, { addMenu = false }, pageActions)
                    }
                }
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

/**
 * Ebene der Leisten. Schreib-Rückzug (heft.js `setWriting`): beim Schreiben treten alle Leisten auf
 * 30 % zurück. Eigener Baustein, damit nur diese Ebene neu zeichnet, nicht die Seiten.
 */
@Composable
private fun HeftChrome(vm: HeftViewModel, content: @Composable BoxScope.() -> Unit) {
    val writing = vm.writing
    val fade by animateFloatAsState(if (writing) 0.3f else 1f, tween(if (writing) 140 else 320), label = "heft-writing")
    Box(Modifier.fillMaxSize().graphicsLayer { alpha = fade }, content = content)
}

/** Telefon unten links: Seitenübersicht mit „n / m“ (der Zähler wechselt weich beim Blättern). */
@Composable
private fun PagesPill(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = Impala.colors
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier.height(48.dp).pressScale(interaction, 0.95f).heftFloat()
            .clickable(interaction, ripple(), role = Role.Button, onClickLabel = "Seiten", onClick = onClick)
            .padding(horizontal = 16.dp),
        Arrangement.spacedBy(8.dp),
        Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.ic_i_pages_stack), "Seiten", Modifier.size(19.dp), c.text)
        AnimatedContent(
            label,
            transitionSpec = {
                (fadeIn(MaterialTheme.motionScheme.fastEffectsSpec()) + slideInVertically { it / 2 })
                    .togetherWith(fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + slideOutVertically { -it / 2 })
            },
            label = "heft-page-count",
        ) { Text(it, color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold) }
    }
}

/** Am Ende des Hefts (heft.js Geist-Knopf „＋ Neue Seite“): hängt eine Seite mit dem letzten Papier an. */
@Composable
private fun AddPageGhost(modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = Impala.colors
    val shape = RoundedCornerShape(Radius.lg)
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier.height(52.dp).pressScale(interaction, 0.97f).clip(shape)
            .border(1.dp, c.edge, shape)
            .clickable(interaction, ripple(), role = Role.Button, onClick = onClick),
        Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(18.dp), c.text2)
        Text("Neue Seite", color = c.text2, fontSize = TextSize.sm, fontWeight = FontWeight.Medium)
    }
}
