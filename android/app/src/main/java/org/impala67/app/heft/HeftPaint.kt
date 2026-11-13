package org.impala67.app.heft

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PointMode
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke as DrawStroke
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.nativeCanvas
import androidx.ink.strokes.Stroke

/** Papierfarbe der Seiten (heft.js `paintPaper`); bleibt auch im dunklen Modus hell. */
val PaperColor = Color(0xFFFBFAF7)

/** Raster aller Papiere in Seiteneinheiten. */
private const val GAP = 28f

/**
 * Papier einer Seite wie `paintPaper` in heft.js: Linien, Raster und Punkte in der Akzentfarbe,
 * gezeichnet in Seitenkoordinaten (1000 × 1414), skaliert mit [k] (Pixel je Seiteneinheit).
 */
fun DrawScope.drawPaper(paper: Paper, ink: Color, k: Float) {
    drawRect(PaperColor)
    if (paper == Paper.BLANK) return
    val w = HeftPage.WIDTH
    val h = HeftPage.HEIGHT
    withTransform({ scale(k, k, Offset.Zero) }) {
        when (paper) {
            Paper.DOTS -> {
                val dots = ArrayList<Offset>()
                var y = 40f
                while (y < h) {
                    var x = 40f
                    while (x < w) { dots += Offset(x, y); x += GAP }
                    y += GAP
                }
                drawPoints(dots, PointMode.Points, ink.copy(alpha = 0.35f), strokeWidth = 2.4f, cap = StrokeCap.Round)
            }
            else -> {
                val lined = paper == Paper.LINED
                val lines = ArrayList<Offset>()
                var y = if (lined) 96f else GAP
                while (y < (if (lined) h - 40f else h)) {
                    lines += Offset(if (lined) 90f else 0f, y)
                    lines += Offset(if (lined) w - 50f else w, y)
                    y += GAP
                }
                if (paper == Paper.GRID) {
                    var x = GAP
                    while (x < w) { lines += Offset(x, 0f); lines += Offset(x, h); x += GAP }
                }
                drawPoints(lines, PointMode.Lines, ink.copy(alpha = 0.22f), strokeWidth = 1f)
                if (lined) drawLine(ink.copy(alpha = 0.4f), Offset(90f, 40f), Offset(90f, h - 40f), strokeWidth = 1f)
            }
        }
    }
}

/**
 * ink-Striche in Seitenkoordinaten auf die Zeichenfläche (mit [k] Pixel je Seiteneinheit). [lod]: Pixel je
 * Seiteneinheit auf dem Bildschirm, falls die Fläche danach noch skaliert wird (Kamera-Zoom).
 */
fun DrawScope.drawInkStrokes(strokes: List<Stroke>, k: Float, lod: Float = k) {
    if (strokes.isEmpty()) return
    val canvasMatrix = android.graphics.Matrix().apply { setScale(k, k) }
    val matrix = android.graphics.Matrix().apply { setScale(lod, lod) }
    drawIntoCanvas { canvas ->
        // Der Renderer nutzt die Matrix nur für die Detailstufe; zeichnen muss der Canvas selbst skaliert.
        val native = canvas.nativeCanvas
        val saved = native.save()
        native.concat(canvasMatrix)
        for (stroke in strokes) HeftInk.renderer.draw(native, stroke, matrix)
        native.restoreToCount(saved)
    }
}

/** Vorschau einer erkannten Form: Umriss `[x, y, …]` in Seiteneinheiten. */
class ShapePreview(val outline: List<Float>, val color: Color, val size: Double)

/** Formvorschau beim Halten (wie der fertige Strich `shape`: volle Deckkraft, runde Enden). */
fun DrawScope.drawShapePreview(shape: ShapePreview, k: Float) {
    val o = shape.outline
    if (o.size < 4) return
    val path = Path().apply {
        moveTo(o[0] * k, o[1] * k)
        for (j in 1 until o.size / 2) lineTo(o[j * 2] * k, o[j * 2 + 1] * k)
    }
    drawPath(path, shape.color, style = DrawStroke(width = (shape.size * 1.1 * 0.7).toFloat() * k, cap = StrokeCap.Round, join = StrokeJoin.Round))
}
