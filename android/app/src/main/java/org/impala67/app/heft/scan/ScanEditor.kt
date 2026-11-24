package org.impala67.app.heft.scan

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.impala67.app.R
import org.impala67.app.ui.theme.TextSize
import kotlin.math.hypot
import kotlin.math.min

/**
 * „Scan N bearbeiten“ (heft-scanner-ui.js `openEditor`): Vorher mit ziehbaren Ecken, Nachher mit Filter und
 * Drehung, Löschen und Fertig. Änderungen gelten sofort für [shot]; „Fertig“ schließt.
 */
@Composable
internal fun ScanEditor(index: Int, shot: ScanShot, onDelete: () -> Unit, onDone: () -> Unit) {
    var before by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf(shot.filter) }
    var rotation by remember { mutableIntStateOf(shot.rotation) }
    val corners = remember { mutableStateListOf<Double>().apply { addAll(shot.corners) } }
    var result by remember { mutableStateOf<Bitmap?>(shot.preview) }
    // Original erst beim Öffnen lesen (liegt nur als JPEG im Speicher).
    val original by produceState<Bitmap?>(null, shot) { value = withContext(Dispatchers.Default) { runCatching { shot.original() }.getOrNull() } }
    var version by remember { mutableIntStateOf(0) }
    // Nachher neu berechnen, wenn Filter, Drehung oder Ecken sich ändern (kurz entprellt).
    LaunchedEffect(filter, rotation, version) {
        shot.filter = filter
        shot.rotation = rotation
        shot.corners = corners.toList()
        delay(120)
        result = withContext(Dispatchers.Default) { runCatching { shot.render(900) }.getOrNull() }
    }
    val image: @Composable (Modifier) -> Unit = { m ->
        Box(m.padding(12.dp), contentAlignment = Alignment.Center) {
            if (before) original?.let { CornerEditor(it, corners) { version++ } }
            else result?.let { Image(it.asImageBitmap(), "Ergebnis", Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
        }
    }
    val done = {
        shot.corners = corners.toList()
        onDone()
    }
    // Querformat wie der Scanner: Bild links, Leiste rechts; Hochformat untereinander.
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black).safeDrawingPadding()) {
        // Breite der Leiste hier festlegen: maxHeight ist in Row nicht erreichbar (DslMarker).
        val railWidth = if (maxHeight < 430.dp) 208.dp else 232.dp
        if (maxWidth > maxHeight) {
            Row(Modifier.fillMaxSize()) {
                image(Modifier.weight(1f).fillMaxHeight())
                Column(
                    Modifier.width(railWidth).fillMaxHeight().verticalScroll(rememberScrollState()).padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Scan ${index + 1} bearbeiten", color = Color.White, fontSize = TextSize.md, fontWeight = FontWeight.SemiBold)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Pill("Vorher", before) { before = true }
                        Pill("Nachher", !before) { before = false }
                    }
                    ScanFilter.entries.chunked(2).forEach { pair ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { pair.forEach { f -> Pill(f.label, filter == f) { filter = f } } }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        DarkIcon(R.drawable.ic_i_rotate, "Drehen") { rotation = (rotation + 1) % 4 }
                        TextButton(onDelete) { Text("Löschen", color = Color(0xFFFF6B6B)) }
                    }
                    Text("Ecken anpassen: in „Vorher“ ziehen", color = Color.White.copy(alpha = 0.6f), fontSize = TextSize.xs)
                    TextButton(done) { Text("Fertig", color = Color.White, fontWeight = FontWeight.SemiBold) }
                }
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Scan ${index + 1} bearbeiten", Modifier.weight(1f), color = Color.White, fontSize = TextSize.md, fontWeight = FontWeight.SemiBold)
                    Pill("Vorher", before) { before = true }
                    Box(Modifier.size(6.dp))
                    Pill("Nachher", !before) { before = false }
                }
                image(Modifier.weight(1f).fillMaxWidth())
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    ScanFilter.entries.forEach { f -> Pill(f.label, filter == f) { filter = f } }
                }
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    DarkIcon(R.drawable.ic_i_rotate, "Drehen") { rotation = (rotation + 1) % 4 }
                    Text("Ecken anpassen: in „Vorher“ ziehen", color = Color.White.copy(alpha = 0.6f), fontSize = TextSize.xs, modifier = Modifier.weight(1f))
                    TextButton(onDelete) { Text("Löschen", color = Color(0xFFFF6B6B)) }
                    TextButton(done) { Text("Fertig", color = Color.White, fontWeight = FontWeight.SemiBold) }
                }
            }
        }
    }
}

/** Originalbild mit vier ziehbaren Ecken (Viereck); Koordinaten in Originalpixeln. */
@Composable
private fun CornerEditor(img: Bitmap, corners: MutableList<Double>, onChanged: () -> Unit) {
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val maxW = with(density) { maxWidth.toPx() }
        val maxH = with(density) { maxHeight.toPx() }
        val k = min(maxW / img.width, maxH / img.height)
        val w = img.width * k
        val h = img.height * k
        val ox = (maxW - w) / 2
        val oy = (maxH - h) / 2
        Image(img.asImageBitmap(), "Original", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
        var drag by remember { mutableIntStateOf(-1) }
        Canvas(
            // Maßstab und Versatz als Schlüssel: nach dem Drehen gelten neue Werte für die Gesten.
            Modifier.fillMaxSize().pointerInput(img, k, ox, oy) {
                detectDragGestures(
                    onDragStart = { p ->
                        drag = (0 until 4).minByOrNull { i -> hypot(ox + corners[i * 2] * k - p.x, oy + corners[i * 2 + 1] * k - p.y) } ?: -1
                    },
                    onDragEnd = { drag = -1; onChanged() },
                    onDragCancel = { drag = -1 },
                ) { change, amount ->
                    change.consume()
                    val i = drag
                    if (i >= 0) {
                        corners[i * 2] = (corners[i * 2] + amount.x / k).coerceIn(0.0, img.width - 1.0)
                        corners[i * 2 + 1] = (corners[i * 2 + 1] + amount.y / k).coerceIn(0.0, img.height - 1.0)
                    }
                }
            },
        ) {
            val pts = (0 until 4).map { Offset(ox + (corners[it * 2] * k).toFloat(), oy + (corners[it * 2 + 1] * k).toFloat()) }
            val path = Path().apply { moveTo(pts[0].x, pts[0].y); pts.drop(1).forEach { lineTo(it.x, it.y) }; close() }
            drawPath(path, Color(0xFF34C759).copy(alpha = 0.15f))
            drawPath(path, Color(0xFF34C759), style = Stroke(2.dp.toPx()))
            pts.forEach { drawCircle(Color.White, 11.dp.toPx(), it); drawCircle(Color(0xFF34C759), 8.dp.toPx(), it) }
        }
    }
}
