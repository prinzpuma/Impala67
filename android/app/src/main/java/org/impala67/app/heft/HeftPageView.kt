package org.impala67.app.heft

import androidx.compose.foundation.Canvas
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke as DrawStroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.ink.authoring.InProgressStrokesView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import uniffi.impala_ffi.HeftStroke

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
    val scope = rememberCoroutineScope()
    val ink = Impala.colors.accent

    val saved = data?.strokes.orEmpty()
    LaunchedEffect(saved) {
        val ids = saved.mapTo(HashSet()) { it.id }
        pending.removeAll { it.id in ids }
        erased = erased.filterTo(HashSet()) { it in ids }
        cache.retain(ids + pending.map { it.id })
    }
    val strokes = remember(saved, pending.size, erased) {
        (saved.filter { it.id !in erased } + pending).mapNotNull(cache::get)
    }

    val tracker = remember {
        EraseTracker(
            scope,
            find = { x, y -> vm.strokesAt(heftPageId, x, y, vm.tools.eraserSize) },
            onHit = { erased = erased + it },
            onDone = { ids -> ring = null; vm.removeStrokes(heftPageId, ids) },
        )
    }

    BoxWithConstraints(
        modifier.fillMaxWidth().aspectRatio(HeftPage.RATIO)
            .shadow(3.dp, PageShape).clip(PageShape),
    ) {
        val k = constraints.maxWidth / HeftPage.WIDTH
        val paper = Paper.of(data?.paper.orEmpty())
        val eraserPx = vm.tools.eraserSize.toFloat() * k

        Canvas(Modifier.fillMaxSize()) {
            drawPaper(paper, ink, k)
            drawInkStrokes(strokes, k)
            ring?.let { drawCircle(ink, eraserPx, it * k, style = DrawStroke(1.5.dp.toPx())) }
        }

        val sink = remember {
            object : PageInputSink {
                override fun strokeFinished(tool: String, color: String, size: Double, points: List<Float>) {
                    val id = uniffi.impala_ffi.heftNewId()
                    pending += HeftStroke(id, tool, color, size, points, null)
                    vm.addStroke(heftPageId, tool, color, size, points, id)
                }
                override fun eraseMove(x: Float, y: Float) { ring = Offset(x, y); tracker.move(x, y) }
                override fun eraseEnd() = tracker.end()
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
            update = { input[0]?.let { it.k = k; it.tools = vm.tools } },
        )
    }
}

