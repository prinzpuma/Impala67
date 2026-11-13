package org.impala67.app.heft

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import android.graphics.RectF
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.structuralEqualityPolicy
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import uniffi.impala_ffi.HeftShape
import uniffi.impala_ffi.HeftStroke
import uniffi.impala_ffi.heftShapeOutline

/**
 * Eine Heftseite im Hochformat (1000 × 1414 Einheiten) in Grundgröße: Papier, Bilder und gespeicherte
 * Striche; die Kamera ([HeftCamera]) skaliert sie. Eingaben kommen über die gemeinsame Stift-Ebene der
 * Ansicht, bei der sich die Seite in [targets] anmeldet. Frisch geschriebene und gerade radierte Striche
 * zeigt die Seite sofort selbst, bis der Kern die neue Fassung geliefert hat (kein Aufblitzen).
 * Auflösung: Strich-Bitmap und Bilder folgen der Zoomstufe nach der Geste; ab starkem Zoom zeichnet die
 * Seite nur die sichtbaren Striche als Vektoren (scharf, wenig Arbeit).
 */
private val PageShape = RoundedCornerShape(Radius.xs)

@Composable
fun HeftPageView(vm: HeftViewModel, heftPageId: String, camera: HeftCamera, targets: HeftPageTargets, modifier: Modifier = Modifier) {
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
    DisposableEffect(heftPageId, targets) {
        val target = PageTarget(sink, objects)
        targets.register(heftPageId, target)
        onDispose { targets.unregister(heftPageId, target) }
    }

    // Ab starkem Zoom (die Bitmap wäre zu grob): nur die Striche im sichtbaren Ausschnitt als Vektoren.
    val detail by remember(camera) { derivedStateOf { camera.baseW * camera.z > DETAIL_PX } }
    val cull by remember(camera, heftPageId) {
        derivedStateOf(structuralEqualityPolicy()) { if (detail) camera.visibleInPage(heftPageId)?.let(::cullRect) else null }
    }

    BoxWithConstraints(
        modifier.fillMaxWidth().aspectRatio(HeftPage.RATIO)
            // `.heft-canvas`: weicher Schatten (--elev-3) und feiner heller Ring.
            .shadow(10.dp, PageShape, ambientColor = Color.Black.copy(alpha = 0.3f), spotColor = Color.Black.copy(alpha = 0.6f))
            .clip(PageShape).border(1.dp, Color.White.copy(alpha = 0.06f), PageShape),
    ) {
        val k = constraints.maxWidth / HeftPage.WIDTH
        // Bildschirmbreite der Seite nach der letzten Geste: danach richten sich Bitmap und Bilder.
        val shownW = constraints.maxWidth * camera.settled
        // Gestufte Bitmap-Breite: vermeidet Komplett-Neuzeichnen nach jedem Pinch-Zoom.
        val bmpW = when {
            shownW <= 640 -> 512
            shownW <= 1280 -> 1024
            else -> 1536
        }
        val layer = rememberStrokeLayer(settled, cache, bmpW)
        LaunchedEffect(layer.drawnKeys, erased) {
            if (pending.isNotEmpty()) pending.removeAll { it.id in layer.drawnKeys || it.id in erased }
        }
        // Vektor-Ausschnitt: gesetzte Striche, die den sichtbaren Bereich berühren (Rahmen aus dem Cache).
        val detailStrokes = cull?.let { c ->
            remember(settled, c) { settled.mapNotNull { s -> cache.entry(s)?.takeIf { RectF.intersects(it.bounds, c) }?.stroke } }
        }
        // Noch nicht in der Bitmap (bzw. im Vektor-Ausschnitt: noch nicht gespeichert) – sonst doppelt gezeichnet.
        val shown = if (detailStrokes != null) savedIds else layer.drawnKeys.keys
        val pendingStrokes = remember(pendingSnapshot, shown, erased, moving) {
            pendingSnapshot.filter { it.id !in shown && it.id !in erased && it.id !in moving }.mapNotNull(cache::get)
        }
        val paper = Paper.of(data?.paper.orEmpty())
        val eraserPx = vm.tools.eraserSize.toFloat() * k
        val stored = data?.images.orEmpty()
        val bitmaps = rememberHeftImages(vm.store, vm.pageId, data?.id, stored, maxSide = imageSide(shownW.roundToInt()))
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
            if (detailStrokes != null) {
                drawInkStrokes(detailStrokes, k, lod = camera.baseW * camera.settled / HeftPage.WIDTH)
            } else layer.image?.let {
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

    }
}

/**
 * Dekodiergröße der Bilder in Zweierpotenzen: so dekodiert nicht jede Zoomstufe dieselben Bilder neu
 * (der Cache-Schlüssel enthält die Größe), und scharf bleiben sie trotzdem.
 */
private fun imageSide(width: Int): Int = (Integer.highestOneBit(max(1, width - 1)) shl 1).coerceIn(512, 4096)

/** Ab dieser Bildschirmbreite der Seite (Pixel) zeichnet sie Striche als Vektoren statt aus der Bitmap (1536 + 20 %). */
private const val DETAIL_PX = 1840f

/**
 * Ausschnitt für die Vektor-Striche: sichtbarer Bereich plus ein Viertel Rand je Seite, auf ein
 * 125er-Raster nach außen gerundet. So ändert er sich beim Verschieben nur selten (dann neu gesammelt).
 */
private fun cullRect(v: RectF): RectF {
    val mx = v.width() / 4
    val my = v.height() / 4
    fun down(a: Float) = floor(a / CULL_GRID) * CULL_GRID
    fun up(a: Float) = ceil(a / CULL_GRID) * CULL_GRID
    return RectF(down(v.left - mx), down(v.top - my), up(v.right + mx), up(v.bottom + my))
}

private const val CULL_GRID = 125f
