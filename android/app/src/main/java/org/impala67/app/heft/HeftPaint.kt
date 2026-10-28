package org.impala67.app.heft

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PointMode
import androidx.compose.ui.graphics.StrokeCap
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

/** ink-Striche in Seitenkoordinaten auf die Zeichenfläche (mit [k] Pixel je Seiteneinheit). */
fun DrawScope.drawInkStrokes(strokes: List<Stroke>, k: Float) {
    if (strokes.isEmpty()) return
    val matrix = android.graphics.Matrix().apply { setScale(k, k) }
    drawIntoCanvas { canvas ->
        val native = canvas.nativeCanvas
        for (stroke in strokes) HeftInk.renderer.draw(native, stroke, matrix)
    }
}
