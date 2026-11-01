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

/** Doppeltipp auf ein Textfeld bzw. eine leere Stelle (heft-input.js: 400 bzw. 450 ms, 40 Einheiten). */
private const val TEXT_TAP_MS = 400L
private const val EMPTY_TAP_MS = 450L
private const val EMPTY_TAP_SLOP = 40.0

/**
 * Auswahl-Werkzeug einer Seite (heft-input.js, `H.tool === "select"`): Textfelder vor Bildern; am
 * roten Knopf oben rechts löschen, am blauen Griff unten rechts skalieren (Text nur in der Breite),
 * sonst greifen und verschieben. Doppeltipp auf ein Textfeld bearbeitet es, auf eine leere Stelle legt
 * er ein neues an. Koordinaten in Seiteneinheiten.
 */
class ObjGesture(private val vm: HeftViewModel, private val heftPageId: String) {
    private enum class Mode { NONE, MOVE, RESIZE }

    private var mode = Mode.NONE
    private var sx = 0.0
    private var sy = 0.0
    private var orig = ObjFrame(0.0, 0.0, 0.0, 0.0)
    private var textTap: Pair<String, Long>? = null
    private var emptyTap: Triple<Double, Double, Long>? = null

    /** Rahmen wie er gerade zu sehen ist (Vorschau vor dem gespeicherten Stand). */
    private fun shown(sel: ObjSel, stored: ObjFrame) = sel.live ?: stored

    fun down(xf: Float, yf: Float, finger: Boolean) {
        val pg = vm.page(heftPageId).value ?: return
        val x = xf.toDouble()
        val y = yf.toDouble()
        val r = if (finger) 22.0 else 16.0
        val now = SystemClock.uptimeMillis()
        fun near(px: Double, py: Double) = hypot(x - px, y - py) <= r
        val sel = vm.objSel?.takeIf { it.heftPageId == heftPageId }

        val st = sel?.takeIf { it.kind == ObjKind.TEXT }?.let { s -> pg.texts.find { it.id == s.id } }
        if (sel != null && st != null) {
            val f = shown(sel, st.frame())
            if (near(f.x + f.w, f.y)) { vm.removeObject(); return }
            if (near(f.x + f.w, f.y + f.h)) { grab(Mode.RESIZE, x, y, f); return }
        }
        pg.texts.lastOrNull { t -> (if (t.id == sel?.id) shown(sel, t.frame()) else t.frame()).contains(x, y) }?.let { ht ->
            val last = textTap
            if (sel?.id == ht.id && last != null && last.first == ht.id && now - last.second < TEXT_TAP_MS) {
                textTap = null
                vm.editText(heftPageId, ht)
                return
            }
            textTap = ht.id to now
            vm.selectObject(heftPageId, ObjKind.TEXT, ht.id)
            grab(Mode.MOVE, x, y, if (ht.id == sel?.id) shown(sel, ht.frame()) else ht.frame())
            return
        }

        val im = sel?.takeIf { it.kind == ObjKind.IMAGE }?.let { s -> pg.images.find { it.id == s.id } }
        if (sel != null && im != null) {
            val f = shown(sel, im.frame())
            if (near(f.x + f.w, f.y)) { vm.removeObject(); return }
            if (near(f.x + f.w, f.y + f.h)) { grab(Mode.RESIZE, x, y, f); return }
        }
        val hit = pg.images.lastOrNull { i -> (if (i.id == sel?.id) shown(sel, i.frame()) else i.frame()).contains(x, y) }
        if (hit != null) {
            emptyTap = null
            vm.selectObject(heftPageId, ObjKind.IMAGE, hit.id)
            grab(Mode.MOVE, x, y, if (hit.id == sel?.id) shown(sel, hit.frame()) else hit.frame())
            return
        }

        val last = emptyTap
        if (last != null && now - last.third < EMPTY_TAP_MS && hypot(x - last.first, y - last.second) < EMPTY_TAP_SLOP) {
            emptyTap = null
            vm.newText(heftPageId, max(20.0, x - 10), max(20.0, y - 20))
            return
        }
        emptyTap = Triple(x, y, now)
        vm.clearObject()
    }

    private fun grab(m: Mode, x: Double, y: Double, f: ObjFrame) {
        mode = m
        sx = x
        sy = y
        orig = f
        vm.objectPreview(f, dragging = true)
    }

    fun move(xf: Float, yf: Float) {
        val sel = vm.objSel ?: return
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
