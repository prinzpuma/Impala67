package org.impala67.app.heft

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.border
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke as DrawStroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import kotlin.math.max
import androidx.compose.ui.viewinterop.AndroidView
import androidx.ink.authoring.InProgressStrokesView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import uniffi.impala_ffi.HeftShape
import uniffi.impala_ffi.HeftStroke
import uniffi.impala_ffi.heftShapeOutline

/**
 * Eine Heftseite im Hochformat (1000 × 1414 Einheiten): Papier und gespeicherte Striche über ink,
 * darüber die Stifteingabe. Frisch geschriebene und gerade radierte Striche zeigt die Seite sofort
 * selbst, bis der Kern die neue Fassung geliefert hat (kein Aufblitzen).
 */
private val PageShape = RoundedCornerShape(Radius.xs)

@Composable
fun HeftPageView(vm: HeftViewModel, heftPageId: String, modifier: Modifier = Modifier) {
    val data by vm.page(heftPageId).collectAsStateWithLifecycle()
    val cache = remember { StrokeCache() }
    val pending = remember { mutableStateListOf<HeftStroke>() }
    var erased by remember { mutableStateOf(emptySet<String>()) }
    var ring by remember { mutableStateOf<Offset?>(null) }
    // Gehaltene Form während des Strichs: Umriss in Seiteneinheiten, Farbe und Dicke.
    var shapeLive by remember { mutableStateOf<ShapePreview?>(null) }
    val scope = rememberCoroutineScope()
    val ink = Impala.colors.accent

    val saved = data?.strokes.orEmpty()
    val savedIds = remember(saved) { saved.mapTo(HashSet()) { it.id } }
    LaunchedEffect(vm.overlayResetRev) {
        if (vm.overlayResetRev > 0) {
            pending.clear()
            erased = emptySet()
        }
    }
    LaunchedEffect(savedIds) {
        erased = erased.filterTo(HashSet()) { it in savedIds }
        cache.retain(savedIds + pending.map { it.id })
    }
    val pendingSnapshot = pending.toList()
    val visible = remember(saved, savedIds, pendingSnapshot, erased) {
        saved.filter { it.id !in erased } + pendingSnapshot.filter { it.id !in savedIds && it.id !in erased }
    }
    // Lasso-Vorschau: Striche, die noch an der alten Stelle liegen, zeichnet die Seite verschoben.
    val sel = vm.lasso?.takeIf { it.heftPageId == heftPageId }
    val drag = sel?.drag
    val moving = remember(visible, drag?.marks) {
        drag?.marks?.let { marks -> visible.filter { marks[it.id] == it.mark() }.mapTo(HashSet()) { it.id } }.orEmpty()
    }
    val settled = remember(saved, erased, moving) { saved.filter { it.id !in erased && it.id !in moving } }
    val moved = remember(visible, moving) { visible.filter { it.id in moving }.mapNotNull(cache::get) }
    val gesture = remember { LassoGesture(vm, heftPageId) }
    val objects = remember { ObjGesture(vm, heftPageId) }
    // Gewähltes Bild/Textfeld: während der Geste (und bis gespeichert) an der Vorschau-Stelle zeichnen.
    val obj = vm.objSel?.takeIf { it.heftPageId == heftPageId }
    val editing = vm.textEdit?.takeIf { it.heftPageId == heftPageId }
    LaunchedEffect(data) { data?.let(vm::objectSettled) }

    val tracker = remember {
        EraseTracker(
            scope,
            find = { x, y -> vm.strokesAt(heftPageId, x, y, vm.tools.eraserSize) },
            onHit = { erased = erased + it },
            onDone = { ids -> ring = null; vm.removeStrokes(heftPageId, ids) },
        )
    }

    val scale = remember { floatArrayOf(1f) }
    BoxWithConstraints(
        modifier.fillMaxWidth().aspectRatio(HeftPage.RATIO)
            // `.heft-canvas`: weicher Schatten (--elev-3) und feiner heller Ring.
            .shadow(10.dp, PageShape, ambientColor = Color.Black.copy(alpha = 0.3f), spotColor = Color.Black.copy(alpha = 0.6f))
            .clip(PageShape).border(1.dp, Color.White.copy(alpha = 0.06f), PageShape)
            .fingerPicks(objects, k = { scale[0] }) {
                // Nur wenn der Finger blättert; zeichnet er, erkennt `PageInput` das Halten.
                vm.tools.onlyPen && !vm.reading && vm.tools.tool != HeftTool.LASSO && vm.tools.tool != HeftTool.LASER
            },
    ) {
        val k = constraints.maxWidth / HeftPage.WIDTH
        scale[0] = k
        // Gestufte Bitmap-Breite: vermeidet Komplett-Neuzeichnen nach jedem Pinch-Zoom.
        val bmpW = when {
            constraints.maxWidth <= 640 -> 512
            constraints.maxWidth <= 1280 -> 1024
            else -> 1536
        }
        val layer = rememberStrokeLayer(settled, cache, bmpW)
        LaunchedEffect(layer.drawnKeys, erased) {
            if (pending.isNotEmpty()) pending.removeAll { it.id in layer.drawnKeys || it.id in erased }
        }
        val pendingStrokes = remember(pendingSnapshot, layer.drawnKeys, erased, moving) {
            pendingSnapshot.filter { it.id !in layer.drawnKeys && it.id !in erased && it.id !in moving }.mapNotNull(cache::get)
        }
        val paper = Paper.of(data?.paper.orEmpty())
        val eraserPx = vm.tools.eraserSize.toFloat() * k
        val stored = data?.images.orEmpty()
        val bitmaps = rememberHeftImages(vm.store, vm.pageId, data?.id, stored, maxSide = imageSide(constraints.maxWidth))
        val liveImg = obj?.live?.takeIf { obj.kind == ObjKind.IMAGE }
        val liveTxt = obj?.live?.takeIf { obj.kind == ObjKind.TEXT }
        val images = if (liveImg == null) stored
        else stored.map { if (it.id == obj?.id) it.copy(x = liveImg.x, y = liveImg.y, w = liveImg.w, h = liveImg.h) else it }
        val texts = data?.texts.orEmpty().mapNotNull { t ->
            when {
                t.id == editing?.text?.id -> null
                liveTxt != null && t.id == obj?.id -> t.copy(x = liveTxt.x, y = liveTxt.y, w = liveTxt.w)
                else -> t
            }
        }
        val selFrame = obj?.takeIf { editing == null }?.let { s ->
            when (s.kind) {
                ObjKind.IMAGE -> images.find { it.id == s.id }?.frame()
                ObjKind.TEXT -> texts.find { it.id == s.id }?.frame()
            }
        }

        Canvas(Modifier.fillMaxSize()) {
            drawPaper(paper, ink, k)
            drawHeftImages(images, bitmaps, k)
            layer.image?.let {
                drawImage(
                    image = it,
                    dstSize = IntSize(size.width.roundToInt(), size.height.roundToInt()),
                    filterQuality = FilterQuality.Low,
                )
            }
            drawInkStrokes(pendingStrokes, k)
            if (drag != null && moved.isNotEmpty()) {
                withTransform({
                    scale(k, k, Offset.Zero)
                    translate(drag.dx, drag.dy)
                    scale(drag.factor, drag.factor, Offset(drag.ax, drag.ay))
                }) { drawInkStrokes(moved, 1f) }
            }
            drawHeftTexts(texts, k)
            selFrame?.let { drawObjSelection(it, k) }
            shapeLive?.let { drawShapePreview(it, k) }
            drawLassoPath(gesture.path, k)
            sel?.let { drawLassoSelection(it.shown, k) }
            ring?.let { drawCircle(ink, eraserPx, it * k, style = DrawStroke(1.5.dp.toPx())) }
        }

        val sink = remember {
            object : PageInputSink {
                override fun strokeFinished(tool: String, color: String, size: Double, points: List<Float>) {
                    val id = uniffi.impala_ffi.heftNewId()
                    pending += HeftStroke(id, tool, color, size, points, null)
                    vm.addStroke(heftPageId, tool, color, size, points, id)
                }
                override fun shapePreview(shape: HeftShape?, color: String, size: Double) {
                    shapeLive = shape?.let { ShapePreview(heftShapeOutline(it), HeftPalette.color(color), size) }
                }
                override fun shapeFinished(shape: HeftShape, color: String, size: Double) {
                    val id = uniffi.impala_ffi.heftNewId()
                    val outline = heftShapeOutline(shape)
                    val points = ArrayList<Float>(outline.size / 2 * 3)
                    for (j in 0 until outline.size / 2) { points += outline[j * 2]; points += outline[j * 2 + 1]; points += 1f }
                    pending += HeftStroke(id, "shape", color, size, points, shape)
                    vm.addShape(heftPageId, color, size, shape, id)
                }
                override fun writing(on: Boolean) = vm.setWriting(on)
                override fun eraseMove(x: Float, y: Float) { ring = Offset(x, y); tracker.move(x, y) }
                override fun eraseEnd() = tracker.end()
                override val lasso = gesture
                override fun lassoDismiss() = vm.dismissLasso()
                override val objects = objects
                override fun touchStart() = vm.closeText(commit = true)
            }
        }
        val context = LocalContext.current
        val input = remember { arrayOfNulls<PageInput>(1) }
        AndroidView(
            factory = {
                InProgressStrokesView(context).also { view ->
                    val pageInput = PageInput(view, sink)
                    input[0] = pageInput
                    view.setOnTouchListener { _, ev -> pageInput.onTouch(ev) }
                }
            },
            modifier = Modifier.fillMaxSize(),
            update = { input[0]?.let { it.k = k; it.tools = vm.tools; it.reading = vm.reading } },
        )
        editing?.let { HeftTextEditor(vm, it, k) }
    }
}

/**
 * „Nur Stift“ (der Finger blättert): Fingertipp wählt ein Bild/Textfeld (daneben: abwählen), Halten greift
 * auch seitenfüllende Scans und verschiebt sie mit demselben Finger. Beobachtet im Initial-Durchgang ohne
 * zu verbrauchen, damit die Liste weiter scrollt; erst nach dem Greifen gehören die Bewegungen dem Element.
 * Liegt der Finger auf der bestehenden Auswahl, greift sie `PageInput` (dann ist [ObjGesture.busy]).
 */
private fun Modifier.fingerPicks(objects: ObjGesture, k: () -> Float, active: () -> Boolean): Modifier = pointerInput(objects) {
    val slop = viewConfiguration.touchSlop
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        if (down.type != PointerType.Touch || !active() || penRecently()) return@awaitEachGesture
        val start = down.position
        // true = getippt, false = abgebrochen (bewegt, zweiter Finger, lang), null = gehalten.
        val tapped = withTimeoutOrNull(PICK_HOLD_MS) {
            while (true) {
                val ev = awaitPointerEvent(PointerEventPass.Initial)
                if (ev.changes.count { it.pressed } > 1) return@withTimeoutOrNull false
                val c = ev.changes.firstOrNull { it.id == down.id } ?: return@withTimeoutOrNull false
                if ((c.position - start).getDistance() > slop) return@withTimeoutOrNull false
                if (!c.pressed) return@withTimeoutOrNull c.uptimeMillis - down.uptimeMillis < 300
            }
            @Suppress("UNREACHABLE_CODE") false
        }
        if (objects.busy || penRecently()) return@awaitEachGesture
        val s = k()
        if (tapped == true) { objects.tap(start.x / s, start.y / s); return@awaitEachGesture }
        if (tapped == false) return@awaitEachGesture
        val h = objects.hit(start.x / s, start.y / s) ?: return@awaitEachGesture
        objects.pick(h, start.x / s, start.y / s)
        while (true) {
            val ev = awaitPointerEvent(PointerEventPass.Initial)
            val c = ev.changes.firstOrNull { it.id == down.id }
            if (c == null || !c.pressed) { objects.up(); break }
            objects.move(c.position.x / s, c.position.y / s)
            ev.changes.forEach { it.consume() }
        }
    }
}


/**
 * Dekodiergröße der Bilder in Zweierpotenzen: so dekodiert nicht jede Zoomstufe dieselben Bilder neu
 * (der Cache-Schlüssel enthält die Größe), und scharf bleiben sie trotzdem.
 */
private fun imageSide(width: Int): Int = (Integer.highestOneBit(max(1, width - 1)) shl 1).coerceIn(512, 4096)
