package org.impala67.app.heft

import android.graphics.RectF
import androidx.compose.animation.core.AnimationState
import androidx.compose.animation.core.DecayAnimationSpec
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateDecay
import androidx.compose.animation.core.tween
import androidx.compose.animation.rememberSplineBasedDecay
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import org.impala67.app.R
import org.impala67.app.ui.components.pressScale
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListItemInfo
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.ink.authoring.InProgressStrokesView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.LocalAppearance
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Lücke unter jeder Seite (PWA 24 px), darin „Seite N“. */
private val PAGE_GAP = 24.dp

/** Oberkante der ersten Seite auf dem Tablet: knapp unter der Leiste, die leicht übersteht (PWA). */
private val DESK_TOP = 52.dp

/** Auf dem Telefon liegt die Werkzeugleiste über dem Heft unter der Kopfzeile. */
private val PHONE_TOP = 64.dp

/** Schlüssel des Eintrags „Neue Seite“ am Ende der Liste. */
private const val ADD_KEY = "heft-add-end"
private val GHOST_H = 52.dp

/**
 * Kamera des Hefts (heft-viewport.js `view`): Die Seiten liegen einmal in Grundgröße (Passbreite
 * [baseW]) in einer Spalte der Breite [colW]; Zoom [z] und waagerechter Versatz [tx] sind reine
 * Transformation, senkrecht scrollt die Liste in Grundpixeln. So zoomt und verschiebt der Pinch live,
 * ohne dass Seiten neu gelegt werden, und beim Loslassen springt nichts. [settled] ist die Zoomstufe
 * nach der letzten Geste: danach richten sich die Auflösungen (Strich-Bitmap, Bilder).
 * Bildschirm-x = tx + Spalten-x · z, Bildschirm-y = Spalten-y · z.
 */
@Stable
class HeftCamera(val lazy: LazyListState) {
    var z by mutableFloatStateOf(1f)
        private set
    private var rawTx by mutableFloatStateOf(0f)
    var settled by mutableFloatStateOf(1f)
        private set
    var viewW by mutableFloatStateOf(1f)
        private set
    var viewH by mutableFloatStateOf(1f)
        private set
    var baseW by mutableFloatStateOf(1f)
        private set
    var colW by mutableFloatStateOf(1f)
        private set

    /** Waagerechter Versatz: schmaler als die Ansicht mittig, sonst bündig an den Rändern begrenzt. */
    val tx: Float get() = clampTx(rawTx, z)

    fun layout(viewW: Float, viewH: Float, baseW: Float, colW: Float) {
        this.viewW = viewW
        this.viewH = viewH
        this.baseW = baseW
        this.colW = colW
    }

    private fun clampTx(x: Float, z: Float): Float {
        val w = colW * z
        return if (w <= viewW) (viewW - w) / 2 else x.coerceIn(viewW - w, 0f)
    }

    /** Verschieben um Bildschirmpixel (Finger nach rechts/unten = Inhalt folgt); gibt zurück, was davon ging. */
    fun pan(d: Offset): Offset {
        val old = tx
        rawTx = clampTx(old + d.x, z)
        val used = lazy.dispatchRawDelta(-d.y / z)
        return Offset(rawTx - old, -used * z)
    }

    /** Zoom um [zoom] mit Fixpunkt [c] (Bildschirm), danach wandert dieser Punkt um [pan] mit den Fingern. */
    fun transform(c: Offset, pan: Offset, zoom: Float) {
        val nz = (z * zoom).coerceIn(MIN, MAX)
        val colX = (c.x - tx) / z
        val to = c + pan
        val dy = c.y / z - to.y / nz
        rawTx = clampTx(to.x - colX * nz, nz)
        z = nz
        lazy.dispatchRawDelta(dy)
    }

    /**
     * Rechteck (Bildschirm) ins Bild schieben, mit [margin] Abstand zu den Rändern und [top] oben (Leiste);
     * passt es nicht ganz, zählt die linke obere Ecke.
     */
    fun reveal(r: Rect, margin: Float, top: Float) {
        val dx = when {
            r.left < margin || r.width > viewW - 2 * margin -> margin - r.left
            r.right > viewW - margin -> viewW - margin - r.right
            else -> 0f
        }
        val dy = when {
            r.top < top || r.height > viewH - top - margin -> top - r.top
            r.bottom > viewH - margin -> viewH - margin - r.bottom
            else -> 0f
        }
        if (dx != 0f || dy != 0f) pan(Offset(dx, dy))
    }

    /** Geste vorbei: Auflösungen dürfen auf die neue Stufe nachziehen. */
    fun settle() {
        rawTx = tx
        settled = z
    }

    /** Bildschirmrechteck eines Listeneintrags, dessen Inhalt [w] × [h] Grundpixel groß ist und waagerecht mittig steht, [dy] unter seiner Oberkante. */
    private fun rect(item: LazyListItemInfo, before: Int, w: Float, h: Float, dy: Float = 0f): Rect {
        val x = tx + (colW - w) / 2 * z
        val y = (item.offset + before + dy) * z
        return Rect(x, y, x + w * z, y + h * z)
    }

    private fun pageRect(item: LazyListItemInfo, before: Int) = rect(item, before, baseW, baseW / HeftPage.RATIO)

    /** Bildschirmrechteck einer sichtbaren Heftseite. */
    fun pageRect(key: String): Rect? {
        val info = lazy.layoutInfo
        val item = info.visibleItemsInfo.firstOrNull { it.key == key } ?: return null
        return pageRect(item, info.beforeContentPadding)
    }

    /** Heftseite unter einem Bildschirmpunkt. */
    fun pageAt(x: Float, y: Float): Pair<String, Rect>? {
        val info = lazy.layoutInfo
        for (item in info.visibleItemsInfo) {
            val key = item.key as? String ?: continue
            if (key == ADD_KEY) continue
            val r = pageRect(item, info.beforeContentPadding)
            if (r.contains(Offset(x, y))) return key to r
        }
        return null
    }

    /** Bildschirmrechteck eines Eintrags am Ende der Liste (Knopf „Neue Seite“). */
    fun itemRect(key: String, w: Float, h: Float, dy: Float): Rect? {
        val info = lazy.layoutInfo
        val item = info.visibleItemsInfo.firstOrNull { it.key == key } ?: return null
        return rect(item, info.beforeContentPadding, w, h, dy)
    }

    /** Sichtbarer Ausschnitt einer Seite in Seiteneinheiten (auch über den Seitenrand hinaus), `null` wenn nicht sichtbar. */
    fun visibleInPage(key: String): RectF? {
        val r = pageRect(key) ?: return null
        val k = r.width / HeftPage.WIDTH
        return RectF(-r.left / k, -r.top / k, (viewW - r.left) / k, (viewH - r.top) / k)
    }

    companion object {
        const val MIN = 0.4f
        const val MAX = 6f
    }
}

/** Eine Heftseite für die Stift-Ebene: Empfänger der Eingaben und ihre Bilder/Textfelder. */
class PageTarget(val sink: PageInputSink, val objects: ObjGesture)

/** Angemeldete Heftseiten (nur die gerade komponierten). */
class HeftPageTargets {
    private val map = HashMap<String, PageTarget>()

    fun register(id: String, target: PageTarget) {
        map[id] = target
    }

    fun unregister(id: String, target: PageTarget) {
        if (map[id] === target) map.remove(id)
    }

    /** Seite unter einem Bildschirmpunkt samt Lage. */
    fun hit(camera: HeftCamera, x: Float, y: Float): Pair<PageTarget, Rect>? {
        val (id, r) = camera.pageAt(x, y) ?: return null
        return (map[id] ?: return null) to r
    }
}

/**
 * Die Heft-Ansicht: Seitenliste unter der Kamera, darüber eine Stift-Ebene für alle Seiten und ganz
 * oben, was eigene Berührungen braucht (offenes Textfeld, „Neue Seite“). Finger-Gesten (Pinch,
 * Doppeltipp, Tippen auf Bilder/Textfelder) laufen über die ganze Fläche.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HeftViewport(
    vm: HeftViewModel,
    pages: List<String>,
    camera: HeftCamera,
    desk: Boolean,
    onAddPage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val reduceMotion = LocalAppearance.current.reduceMotion
    val targets = remember { HeftPageTargets() }
    val decay = rememberSplineBasedDecay<Offset>()
    val context = LocalContext.current
    val wheelStep = remember(context) { android.view.ViewConfiguration.get(context).scaledVerticalScrollFactor }
    val flingJob = remember { arrayOfNulls<Job>(1) }
    val host = remember(camera, targets) {
        object : PageInputHost {
            override fun locate(x: Float, y: Float): PageHit? {
                val (t, r) = targets.hit(camera, x, y) ?: return null
                return PageHit(t.sink, r.left, r.top, r.width / HeftPage.WIDTH)
            }
            override fun pan(dx: Float, dy: Float) {
                camera.pan(Offset(dx, dy))
            }
            override fun fling(vx: Float, vy: Float) {
                flingJob[0]?.cancel()
                flingJob[0] = scope.fling(camera, decay, Offset(vx, vy))
            }
            override fun stopFling() {
                flingJob[0]?.cancel()
            }
        }
    }

    BoxWithConstraints(modifier.fillMaxSize().clipToBounds()) {
        val density = LocalDensity.current
        val viewW = constraints.maxWidth.toFloat()
        // Ruhehöhe für die Passbreite: wächst nur mit (neu bei anderer Breite, z. B. Drehen). Die Tastatur
        // und das Umlegen der Leisten verkleinern die Ansicht kurzzeitig, die Seite bleibt dabei gleich groß.
        var steadyH by remember(viewW) { mutableFloatStateOf(constraints.maxHeight.toFloat()) }
        if (!WindowInsets.isImeVisible && constraints.maxHeight > steadyH) steadyH = constraints.maxHeight.toFloat()
        val viewH = constraints.maxHeight.toFloat()
        // Ganze Pixel für Rand und Seitenbreite: dann liegt die Seite exakt dort, wo die Stift-Ebene sie
        // vermutet (sonst wandert ein Strich bei starkem Zoom um Bruchteile × Zoom neben die Spitze).
        val margin = with(density) { 16.dp.roundToPx() }.toFloat()
        // Passbreite wie fitScale in heft-viewport.js: die ganze Seite sichtbar, oben Platz für die
        // schwebende Leiste, unten für die Seitenzahl.
        val top = if (desk) DESK_TOP else PHONE_TOP
        val bottom = if (desk) 72.dp else 96.dp
        val fitH = steadyH - with(density) { (top + 40.dp).toPx() }
        val baseW = max(1f, floor(min(viewW - 2 * margin, fitH * HeftPage.RATIO)))
        val colW = baseW + 2 * margin
        SideEffect { camera.layout(viewW, viewH, baseW, colW) }

        // Doppeltipp: weich auf ca. 2,2× bzw. zurück auf Passbreite (heft-viewport.js `animateZoom`).
        fun zoomTo(c: Offset) {
            flingJob[0]?.cancel()
            val from = camera.z
            val target = if (from >= 1.9f) 1f else max(2.2f, min(HeftCamera.MAX, from * 1.8f))
            scope.launch {
                if (reduceMotion) camera.transform(c, Offset.Zero, target / camera.z)
                else animate(from, target, animationSpec = tween(240)) { v, _ -> camera.transform(c, Offset.Zero, v / camera.z) }
                camera.settle()
            }
        }

        val gestures = rememberUpdatedState(HeftGestureCallbacks(
            transform = { c, pan, zoom -> flingJob[0]?.cancel(); camera.transform(c, pan, zoom) },
            transformEnd = camera::settle,
            doubleTap = { zoomTo(it) },
            undo = { if (!vm.reading) vm.undo() },
            redo = { if (!vm.reading) vm.redo() },
            fingerFree = { vm.reading || vm.tools.onlyPen },
        ))
        val ghostTouch = remember { MutableInteractionSource() }
        val ghostW = min(baseW, with(density) { 360.dp.roundToPx() }.toFloat())

        Box(
            Modifier.fillMaxSize()
                .heftGestures(gestures)
                .heftFingerPicks(targets, camera) {
                    // Nur wenn der Finger blättert; zeichnet er, erkennt `PageInput` das Halten.
                    vm.tools.onlyPen && !vm.reading && vm.tools.tool != HeftTool.LASSO && vm.tools.tool != HeftTool.LASER
                }
                .heftWheel(wheelStep) { camera.pan(it) },
        ) {
            LazyColumn(
                Modifier.layout { measurable, c ->
                    // Spalte in Grundpixeln, so hoch wie die Ansicht geteilt durch den Zoom: beim Rauszoomen
                    // liegen sofort genug Seiten bereit. Gezeichnet skaliert ab der linken oberen Ecke.
                    val p = measurable.measure(Constraints.fixed(colW.roundToInt(), ceil(viewH / camera.z).toInt().coerceAtLeast(1)))
                    layout(c.maxWidth, c.maxHeight) {
                        p.placeWithLayer(0, 0) {
                            transformOrigin = TransformOrigin(0f, 0f)
                            scaleX = camera.z
                            scaleY = camera.z
                            translationX = camera.tx
                        }
                    }
                },
                state = camera.lazy,
                contentPadding = PaddingValues(top = top, bottom = bottom),
                // Verschieben übernehmen Stift-Ebene und Kamera (frei in alle Richtungen).
                userScrollEnabled = false,
            ) {
                itemsIndexed(pages, key = { _, id -> id }) { i, id ->
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                        HeftPageView(vm, id, camera, targets, Modifier.width(with(density) { baseW.toDp() }))
                        // `.heft-page-label`
                        Box(Modifier.height(PAGE_GAP), Alignment.TopCenter) {
                            Text("Seite ${i + 1}", Modifier.padding(top = 4.dp), color = Impala.colors.text2, fontSize = TextSize.xs2)
                        }
                    }
                }
                if (pages.isNotEmpty()) {
                    item(key = ADD_KEY) {
                        Box(Modifier.fillMaxWidth().padding(top = GHOST_TOP), Alignment.Center) {
                            AddPageGhost(Modifier.width(with(density) { ghostW.toDp() }).height(GHOST_H), ghostTouch)
                        }
                    }
                }
            }

            // Stift-Ebene über allen Seiten (Bildschirmgröße, nicht Seitengröße).
            val input = remember { arrayOfNulls<PageInput>(1) }
            AndroidView(
                factory = { ctx ->
                    InProgressStrokesView(ctx).also { view ->
                        val pageInput = PageInput(view, host)
                        input[0] = pageInput
                        view.setOnTouchListener { _, ev -> pageInput.onTouch(ev) }
                    }
                },
                modifier = Modifier.fillMaxSize(),
                update = { input[0]?.let { it.tools = vm.tools; it.reading = vm.reading } },
            )

            // Über der Stift-Ebene: was eigene Berührungen braucht.
            if (pages.isNotEmpty()) {
                val ghostTopPx = with(density) { GHOST_TOP.toPx() }
                val ghostHPx = with(density) { GHOST_H.toPx() }
                Box(
                    Modifier
                        // Ganze Fläche als eigene Größe, die Knopffläche darin an der Stelle des Listeneintrags.
                        .layout { measurable, c ->
                            val r = camera.itemRect(ADD_KEY, ghostW, ghostHPx, ghostTopPx)
                            if (r == null) layout(0, 0) {}
                            else {
                                val p = measurable.measure(Constraints.fixed(r.width.roundToInt().coerceAtLeast(1), r.height.roundToInt().coerceAtLeast(1)))
                                layout(c.maxWidth, c.maxHeight) { p.place(r.left.roundToInt(), r.top.roundToInt()) }
                            }
                        }
                        .clip(GhostShape)
                        .clickable(ghostTouch, ripple(), role = Role.Button, onClick = onAddPage),
                )
            }
            vm.textEdit?.let { edit ->
                // Textfeld schwebt an seiner Seite; seine Größe folgt der Zoomstufe (scharf statt skaliert).
                val k = camera.baseW * camera.z / HeftPage.WIDTH
                // Beim Öffnen und wenn die Tastatur die Ansicht verkleinert: Feld ins Bild holen.
                val revealMargin = with(density) { 24.dp.toPx() }
                val revealTop = with(density) { (top + 16.dp).toPx() }
                LaunchedEffect(edit, viewH) {
                    val page = camera.pageRect(edit.heftPageId) ?: return@LaunchedEffect
                    val pk = page.width / HeftPage.WIDTH
                    val size = edit.text?.size ?: 30.0
                    val w = edit.text?.w ?: newTextWidth(edit.x)
                    val x = page.left + edit.x.toFloat() * pk
                    val y = page.top + edit.y.toFloat() * pk
                    camera.reveal(Rect(x, y, x + max(80f, w.toFloat() * pk), y + ((size * 1.4 + 20) * pk).toFloat()), revealMargin, revealTop)
                }
                Box(
                    Modifier.layout { measurable, c ->
                        val p = measurable.measure(c.copy(minWidth = 0, minHeight = 0))
                        val r = camera.pageRect(edit.heftPageId)
                        layout(c.maxWidth, c.maxHeight) { if (r != null) p.place(r.left.roundToInt(), r.top.roundToInt()) }
                    },
                ) { HeftTextEditor(vm, edit, k) }
            }
        }
    }
}

private val GHOST_TOP = 4.dp

/** Ecken wie `AddPageGhost` (Radius.lg bei 52 dp Höhe), als Anteil, damit sie mit dem Zoom mitwachsen. */
private val GhostShape = RoundedCornerShape(percent = (Radius.lg.value / GHOST_H.value * 100).roundToInt())

/** Schwung nach dem Loslassen (heft-viewport.js `fling`): läuft aus, bis beide Richtungen am Rand anstehen. */
private fun CoroutineScope.fling(camera: HeftCamera, decay: DecayAnimationSpec<Offset>, velocity: Offset): Job = launch {
    var last = Offset.Zero
    AnimationState(Offset.VectorConverter, Offset.Zero, velocity).animateDecay(decay) {
        val d = value - last
        last = value
        if (camera.pan(d).getDistance() < 0.5f && d.getDistance() > 0.5f) cancelAnimation()
    }
}

/**
 * „Nur Stift“ (der Finger blättert): Fingertipp wählt ein Bild/Textfeld (daneben: abwählen), Halten greift
 * auch seitenfüllende Scans und verschiebt sie mit demselben Finger. Beobachtet im Initial-Durchgang ohne
 * zu verbrauchen, damit der Finger weiter verschiebt; erst nach dem Greifen gehören die Bewegungen dem
 * Element (die Stift-Ebene bekommt dann einen Abbruch). Liegt der Finger auf der bestehenden Auswahl,
 * greift sie `PageInput` (dann ist [ObjGesture.busy]).
 */
private fun Modifier.heftFingerPicks(targets: HeftPageTargets, camera: HeftCamera, active: () -> Boolean): Modifier = pointerInput(targets, camera) {
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
        if (tapped == false || penRecently()) return@awaitEachGesture
        // Die Seite unter dem Finger, mit ihrer Lage beim Aufsetzen (der Finger hat sich kaum bewegt).
        val (target, r) = targets.hit(camera, start.x, start.y) ?: return@awaitEachGesture
        val objects = target.objects
        if (objects.busy) return@awaitEachGesture
        val s = r.width / HeftPage.WIDTH
        fun x(p: Offset) = (p.x - r.left) / s
        fun y(p: Offset) = (p.y - r.top) / s
        if (tapped == true) { objects.tap(x(start), y(start)); return@awaitEachGesture }
        val h = objects.hit(x(start), y(start)) ?: return@awaitEachGesture
        objects.pick(h, x(start), y(start))
        while (true) {
            val ev = awaitPointerEvent(PointerEventPass.Initial)
            val c = ev.changes.firstOrNull { it.id == down.id }
            if (c == null || !c.pressed) { objects.up(); break }
            objects.move(x(c.position), y(c.position))
            ev.changes.forEach { it.consume() }
        }
    }
}

/** „Neue Seite“ am Ende (nur die Optik; angetippt wird die gleich große Fläche über der Stift-Ebene). */
@Composable
private fun AddPageGhost(modifier: Modifier, interaction: MutableInteractionSource) {
    val c = Impala.colors
    val shape = RoundedCornerShape(Radius.lg)
    Row(
        modifier.pressScale(interaction, 0.97f).clip(shape).border(1.dp, c.edge, shape),
        Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(18.dp), c.text2)
        Text("Neue Seite", color = c.text2, fontSize = TextSize.sm, fontWeight = FontWeight.Medium)
    }
}
