package org.impala67.app.heft

import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke as DrawStroke
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.em
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import uniffi.impala_ffi.HeftImage
import uniffi.impala_ffi.HeftPageData
import uniffi.impala_ffi.HeftText
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

enum class ObjKind { IMAGE, TEXT }

/** Rahmen eines Bilds oder Textfelds in Seiteneinheiten. */
@Immutable
data class ObjFrame(val x: Double, val y: Double, val w: Double, val h: Double) {
    fun contains(px: Double, py: Double) = px >= x && px <= x + w && py >= y && py <= y + h
}

/**
 * Ausgewähltes Bild oder Textfeld (heft.js `sel.imgId` / `sel.txtId`). [live] ist der Rahmen während
 * der Geste und danach, bis die Seite die gespeicherte Fassung zeigt; [dragging] solange der Finger liegt.
 */
@Immutable
data class ObjSel(val heftPageId: String, val kind: ObjKind, val id: String, val live: ObjFrame? = null, val dragging: Boolean = false)

/** Offenes Textfeld (heft.js `inlineEd`): [text] `null` = neues Feld bei [x]/[y]. */
@Immutable
data class TextEdit(val heftPageId: String, val x: Double, val y: Double, val text: HeftText?)

fun HeftImage.frame() = ObjFrame(x, y, w, h)

/** Die Höhe wird wie in der PWA beim Zeichnen gemessen, nicht dem gespeicherten `h` geglaubt. */
fun HeftText.frame() = ObjFrame(x, y, w ?: 400.0, heftTextHeight(this).toDouble())

/** Breite eines neuen Textfelds (heft.js `closeTextEditor`): 240–420, bis 40 vor den rechten Rand. */
fun newTextWidth(x: Double) = max(240.0, min(420.0, HeftPage.WIDTH - x - 40))

/** Unterkante des Inhalts einer Seite (heft.js `contentBottom`), mindestens 40. */
fun contentBottom(pg: HeftPageData): Double {
    var y = 40.0
    for (s in pg.strokes) for (i in 1 until s.points.size step 3) y = max(y, s.points[i].toDouble())
    for (im in pg.images) y = max(y, im.y + im.h)
    for (t in pg.texts) y = max(y, t.y + heftTextHeight(t))
    return y
}

/** Halten, bis ein Bild/Textfeld gegriffen wird (heft-input.js `PICK_HOLD_MS`). */
const val PICK_HOLD_MS = 450L

/** Seitenfüllende Bilder (Scans, PDF-Seiten) nur per Halten – sonst griffe jeder Tipp die Seite. */
private const val PAGE_SIZED = HeftPage.WIDTH * HeftPage.HEIGHT * 0.6

/**
 * Bilder und Textfelder einer Seite direkt auswählen (heft-input.js): Mit „Nur Stift“ wählt ein Fingertipp
 * aus, sonst (Finger zeichnet, Maus) das Halten; der Stift zeichnet immer. Eine bestehende Auswahl greift
 * jeder Zeiger: roter Knopf oben rechts löscht, blauer Griff unten rechts skaliert (Text nur in der
 * Breite), die Fläche verschiebt; Antippen eines ausgewählten Textfelds bearbeitet es. Koordinaten in
 * Seiteneinheiten.
 */
class ObjGesture(private val vm: HeftViewModel, private val heftPageId: String) {
    private enum class Mode { NONE, MOVE, RESIZE }

    /** Getroffenes Element mit seinem Rahmen. */
    class Hit(val kind: ObjKind, val id: String, val frame: ObjFrame)

    private var mode = Mode.NONE
    private var sx = 0.0
    private var sy = 0.0
    private var lx = 0.0
    private var ly = 0.0
    private var orig = ObjFrame(0.0, 0.0, 0.0, 0.0)
    private var tapEdit = false

    /** Gerade wird ein Element verschoben oder skaliert. */
    val busy get() = mode != Mode.NONE

    /** Rahmen wie er gerade zu sehen ist (Vorschau vor dem gespeicherten Stand). */
    private fun shown(sel: ObjSel, stored: ObjFrame) = sel.live ?: stored

    /** Oberstes Element unter dem Punkt (Textfelder vor Bildern); `tap`: ohne seitenfüllende Bilder. */
    fun hit(xf: Float, yf: Float, tap: Boolean = false): Hit? {
        val pg = vm.page(heftPageId).value ?: return null
        val x = xf.toDouble()
        val y = yf.toDouble()
        pg.texts.lastOrNull { it.frame().contains(x, y) }?.let { return Hit(ObjKind.TEXT, it.id, it.frame()) }
        return pg.images.lastOrNull { i -> i.frame().let { f -> f.contains(x, y) && !(tap && f.w * f.h > PAGE_SIZED) } }
            ?.let { Hit(ObjKind.IMAGE, it.id, it.frame()) }
    }

    /** Die bestehende Auswahl dieser Seite greifen (Löschknopf, Griff, Fläche); false = nicht getroffen. */
    fun grab(xf: Float, yf: Float, finger: Boolean): Boolean {
        val sel = vm.objSel?.takeIf { it.heftPageId == heftPageId } ?: return false
        val pg = vm.page(heftPageId).value ?: return false
        val stored = when (sel.kind) {
            ObjKind.TEXT -> pg.texts.find { it.id == sel.id }?.frame()
            ObjKind.IMAGE -> pg.images.find { it.id == sel.id }?.frame()
        } ?: return false
        val f = shown(sel, stored)
        val x = xf.toDouble()
        val y = yf.toDouble()
        val r = if (finger) 22.0 else 16.0
        fun near(px: Double, py: Double) = hypot(x - px, y - py) <= r
        when {
            near(f.x + f.w, f.y) -> vm.removeObject()
            near(f.x + f.w, f.y + f.h) -> start(Mode.RESIZE, x, y, f)
            f.contains(x, y) -> { start(Mode.MOVE, x, y, f); tapEdit = sel.kind == ObjKind.TEXT }
            else -> return false
        }
        return true
    }

    /** Halten hat [h] gegriffen: auswählen und mit demselben Zeiger verschieben. */
    fun pick(h: Hit, xf: Float, yf: Float) {
        vm.selectObject(heftPageId, h.kind, h.id)
        start(Mode.MOVE, xf.toDouble(), yf.toDouble(), h.frame)
    }

    /** Fingertipp („Nur Stift“): Element wählen, daneben die Auswahl aufheben. */
    fun tap(xf: Float, yf: Float) {
        val h = hit(xf, yf, tap = true)
        if (h != null) vm.selectObject(heftPageId, h.kind, h.id) else vm.clearObject()
    }

    /** Ein neuer Strich hebt die Auswahl auf. */
    fun clear() = vm.clearObject()

    private fun start(m: Mode, x: Double, y: Double, f: ObjFrame) {
        mode = m
        sx = x
        sy = y
        lx = x
        ly = y
        orig = f
        tapEdit = false
        vm.objectPreview(f, dragging = true)
    }

    fun move(xf: Float, yf: Float) {
        val sel = vm.objSel ?: return
        lx = xf.toDouble()
        ly = yf.toDouble()
        val dx = xf - sx
        val dy = yf - sy
        val o = orig
        val f = when (mode) {
            Mode.NONE -> return
            Mode.MOVE -> o.copy(
                x = min(HeftPage.WIDTH - 20.0, max(20 - o.w, o.x + dx)),
                y = min(HeftPage.HEIGHT - 20.0, max(20 - o.h, o.y + dy)),
            )
            Mode.RESIZE -> if (sel.kind == ObjKind.TEXT) o.copy(w = max(120.0, o.w + dx))
            else max(40.0, o.w + dx).let { w -> o.copy(w = w, h = w * (o.h / o.w)) }
        }
        vm.objectPreview(f, dragging = true)
    }

    fun up() {
        // Kaum bewegt = Antippen: ein ausgewähltes Textfeld öffnet sich zum Bearbeiten.
        if (mode == Mode.MOVE && tapEdit && hypot(lx - sx, ly - sy) < 4) {
            mode = Mode.NONE
            vm.objectPreview(orig, dragging = true)
            vm.objectRelease(orig)
            val sel = vm.objSel ?: return
            vm.page(heftPageId).value?.texts?.find { it.id == sel.id }?.let { vm.editText(heftPageId, it) }
            return
        }
        if (mode != Mode.NONE) vm.objectRelease(orig)
        mode = Mode.NONE
    }

    fun cancel() {
        if (mode != Mode.NONE) { vm.objectPreview(orig, dragging = true); vm.objectRelease(orig) }
        mode = Mode.NONE
    }
}

private val SelBlue = Color(0xFF2F6FED)
private val DelRed = Color(0xFFE0483E)
private val selDash = floatArrayOf(6f, 4f)

/** Auswahlrahmen eines Bilds oder Textfelds (heft.js `drawSelection`): gestrichelt, Griff und Löschknopf. */
fun DrawScope.drawObjSelection(f: ObjFrame, k: Float) {
    val x = f.x.toFloat() * k
    val y = f.y.toFloat() * k
    val w = f.w.toFloat() * k
    val h = f.h.toFloat() * k
    drawRect(SelBlue, Offset(x, y), Size(w, h), style = DrawStroke(1.5f * k, pathEffect = PathEffect.dashPathEffect(selDash.map { it * k }.toFloatArray())))
    drawCircle(SelBlue, 7f * k, Offset(x + w, y + h))
    drawCircle(DelRed, 9f * k, Offset(x + w, y))
    val a = 4f * k
    drawLine(Color.White, Offset(x + w - a, y - a), Offset(x + w + a, y + a), 2f * k)
    drawLine(Color.White, Offset(x + w + a, y - a), Offset(x + w - a, y + a), 2f * k)
}

/**
 * Textfeld zum Schreiben über der Seite (heft.js `openTextEditor`, `.heft-text-editor`): Enter bzw.
 * „Fertig“ speichert, Umschalt+Enter bricht um, Esc verwirft, Fokusverlust speichert.
 */
@Composable
fun HeftTextEditor(vm: HeftViewModel, edit: TextEdit, k: Float) {
    val t = edit.text
    val size = (t?.size ?: 30.0).toFloat()
    val w = (t?.w ?: newTextWidth(edit.x)).toFloat()
    val color = HeftPalette.color(t?.color ?: vm.tools.color)
    val c = Impala.colors
    val density = LocalDensity.current
    val focus = remember { FocusRequester() }
    var focused by remember(edit) { mutableStateOf(false) }
    var value by remember(edit) { mutableStateOf(TextFieldValue(vm.textDraft, TextRange(vm.textDraft.length))) }
    val shape = RoundedCornerShape(Radius.sm)
    BasicTextField(
        value = value,
        onValueChange = { value = it; vm.updateDraft(it.text) },
        modifier = Modifier
            .offset { IntOffset((edit.x * k).roundToInt(), (edit.y * k).roundToInt()) }
            .width(with(density) { max(80f, w * k).toDp() })
            .background(Color.White.copy(alpha = 0.93f), shape)
            .border(with(density) { 1.5f.toDp() }, c.accent, shape)
            .padding(with(density) { (10f * k).toDp() })
            .focusRequester(focus)
            .onFocusChanged { if (it.isFocused) focused = true else if (focused) vm.closeText(commit = true) }
            .onPreviewKeyEvent { ev ->
                if (ev.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when {
                    ev.key == Key.Escape -> { vm.closeText(commit = false); true }
                    ev.key == Key.Enter && !ev.isShiftPressed -> { vm.closeText(commit = true); true }
                    else -> false
                }
            },
        textStyle = TextStyle(color = color, fontSize = with(density) { (size * k).toSp() }, lineHeight = 1.4.em, fontWeight = FontWeight.Medium),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { vm.closeText(commit = true) }),
        cursorBrush = SolidColor(c.accent),
    )
    LaunchedEffect(edit) { focus.requestFocus() }
}
