package org.impala67.app.library

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.LruCache
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.theme.Impala
import uniffi.impala_ffi.PageSummary
import java.io.ByteArrayOutputStream
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** Farben und Maße der Bibliothek (`web/css/shelf.css` & `ShelfStyle.swift`). */
object ShelfColors {
    private val dark: Boolean @Composable get() = Impala.colors.isDark
    val paper: Color @Composable get() = if (dark) Color(0xFF1E1D1B) else Color(0xFFF9F3EA)
    val sheet: Color @Composable get() = if (dark) Color(0xFF252422) else Color(0xFFFCFAF6)
    val woodTop: Color @Composable get() = if (dark) Color(0xFF3D352E) else Color(0xFFEAD9BD)
    val wood: Color @Composable get() = if (dark) Color(0xFF2C2621) else Color(0xFFCFB38B)
    val ink: Color @Composable get() = if (dark) Color(0xFFF5F4F0) else Color(0xFF3C352B)
    val edge: Color @Composable get() = if (dark) Color(0xFFFFFAF0).copy(alpha = 0.08f) else Color(0xFF967046).copy(alpha = 0.14f)
    val button: Color @Composable get() = if (dark) Color(0xFF8C6543) else Color(0xFFA8754C)
    val cream = Color(0xFFFBF7EE)
    val labelInk = Color(0xFF2C2823)
    val tint: Color @Composable get() = if (dark) Color(0xFFFFFAF0).copy(alpha = 0.07f) else Color(0xFFCFB38B).copy(alpha = 0.16f)
    val tint2: Color @Composable get() = if (dark) Color(0xFFFFFAF0).copy(alpha = 0.13f) else Color(0xFFCFB38B).copy(alpha = 0.26f)
    val ledge: Dp = 12.dp
}

/** Maße des Regals je Breite (`ShelfMetrics` in `ShelfStyle.swift`). */
class ShelfMetrics(widthDp: Float) {
    val narrow = widthDp > 0f && widthDp < 600f
    val book: Dp = if (narrow) 168.dp else 196.dp
    val folder: Dp = if (narrow) 100.dp else 118.dp
    val row: Dp = if (narrow) 236.dp else 266.dp
    val rowGap: Dp = if (narrow) 20.dp else 24.dp
    val gap: Dp = if (narrow) 16.dp else 26.dp
    val columns: Int
    val cell: Dp

    init {
        val minCell = if (narrow) 104f else 128f
        val avail = max(widthDp, minCell)
        val g = gap.value
        columns = max(1, ((avail + g) / (minCell + g)).toInt())
        cell = ((avail - g * (columns - 1)) / columns).dp
    }
}

/** Individuelles Heft-Cover aus der ID (`coverLook` in `web/library.js`). */
class CoverLook(p: PageSummary) {
    val top: Color
    val bottom: Color
    val pattern: Int
    val label: Int
    val band: Boolean

    init {
        val s = p.id.ifEmpty { p.title }
        var h = 2166136261u
        for (ch in s) h = (h xor ch.code.toUInt()) * 16777619u
        val hue: Int
        val sat: Int
        val light: Int
        if (p.cover == "mono") {
            hue = 30; sat = 5; light = 20 + ((h shr 10) % 10u).toInt()
        } else {
            val base = HUES[p.cover]
            hue = if (base != null) base + (h % 37u).toInt() - 18 else (h % 360u).toInt()
            sat = 30 + ((h shr 6) % 16u).toInt()
            light = 40 + ((h shr 10) % 13u).toInt()
        }
        top = hslToColor(hue.toFloat(), sat / 100f, (light + 7) / 100f)
        bottom = hslToColor(hue.toFloat(), sat / 100f, (light - 7) / 100f)
        pattern = ((h shr 14) % 8u).toInt()
        label = ((h shr 18) % 3u).toInt()
        band = ((h shr 21) % 3u) == 0u
    }

    private companion object {
        val HUES = mapOf("sunset" to 18, "ocean" to 214, "forest" to 128, "grape" to 312)
    }
}

fun hslToColor(h: Float, s: Float, l: Float): Color {
    val c = (1f - abs(2f * l - 1f)) * s
    val hp = ((h % 360f) + 360f) % 360f / 60f
    val x = c * (1f - abs(hp % 2f - 1f))
    val (r, g, b) = when (hp.toInt()) {
        0 -> Triple(c, x, 0f); 1 -> Triple(x, c, 0f); 2 -> Triple(0f, c, x)
        3 -> Triple(0f, x, c); 4 -> Triple(x, 0f, c); else -> Triple(c, 0f, x)
    }
    val m = l - c / 2f
    return Color(r + m, g + m, b + m)
}

private object CoverImageCache : LruCache<String, ImageBitmap>(48)

/** Lädt ein Cover-Bild (`coverImg`) aus dem Kern, skaliert auf max. 640 px und cached es. */
@Composable
fun CoverImage(store: ImpalaStore, id: String, modifier: Modifier = Modifier) {
    var bmp by remember(id) { mutableStateOf(CoverImageCache.get(id)) }
    LaunchedEffect(id) {
        if (bmp != null) return@LaunchedEffect
        val loaded = withContext(Dispatchers.IO) {
            val data = runCatching { store.core.file(id)?.bytes }.getOrNull() ?: return@withContext null
            decodeCoverBitmap(data, 640)?.asImageBitmap()?.also { CoverImageCache.put(id, it) }
        }
        if (loaded != null) bmp = loaded
    }
    bmp?.let { Image(it, null, modifier, contentScale = ContentScale.Crop) }
}

private fun decodeCoverBitmap(bytes: ByteArray, maxSide: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / sample > maxSide * 2) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}

/** Verkleinert ein gewähltes Bild auf max. 1600 px und kodiert es als JPEG (85 %). */
suspend fun encodeCoverJpeg(context: Context, uri: Uri): ByteArray? = withContext(Dispatchers.IO) {
    val raw = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@withContext null
    val bmp = decodeCoverBitmap(raw, 1600) ?: return@withContext null
    val scale = min(1f, 1600f / max(bmp.width, bmp.height).coerceAtLeast(1))
    val outBmp = if (scale < 1f) Bitmap.createScaledBitmap(bmp, max(1, (bmp.width * scale).toInt()), max(1, (bmp.height * scale).toInt()), true) else bmp
    ByteArrayOutputStream().use { out -> outBmp.compress(Bitmap.CompressFormat.JPEG, 85, out); out.toByteArray() }
}

/** Notizbuch im Schulheft-Stil: Rücken + Stoff-Cover mit Muster/Schild oder vollflächigem Bild. */
@Composable
fun NotebookCover(store: ImpalaStore, page: PageSummary, height: Dp = 196.dp, modifier: Modifier = Modifier) {
    val look = remember(page.id, page.title, page.cover) { CoverLook(page) }
    val spineShape = RoundedCornerShape(topStart = 5.dp, bottomStart = 5.dp)
    val coverShape = RoundedCornerShape(topStart = 2.dp, bottomStart = 2.dp, topEnd = 12.dp, bottomEnd = 12.dp)
    Row(modifier.height(height).shadow(4.dp, coverShape)) {
        Box(Modifier.width(11.dp).fillMaxHeight().clip(spineShape).background(Brush.horizontalGradient(listOf(Color(0xFF181614), Color(0xFF211E1A), Color(0xFF37332F)))))
        BoxWithConstraints(Modifier.weight(1f).fillMaxHeight().clip(coverShape).background(Brush.linearGradient(listOf(look.top, look.bottom))).border(1.dp, Color.Black.copy(alpha = 0.14f), coverShape)) {
            val img = page.coverImg
            if (img != null) {
                CoverImage(store, img, Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color.White.copy(alpha = 0.18f), Color.Transparent, Color.Black.copy(alpha = 0.12f)))))
            } else {
                CoverPattern(look.pattern)
                if (look.band) {
                    Box(Modifier.align(Alignment.TopEnd).padding(end = maxWidth * 0.13f).width(7.dp).fillMaxHeight()
                        .background(Brush.horizontalGradient(listOf(Color.Black.copy(alpha = 0.34f), Color.Black.copy(alpha = 0.22f)))))
                }
                val side = if (look.label == 2) 0.18f else 0.12f
                val topFrac = when (look.label) { 1 -> 0.62f; 2 -> 0.34f; else -> 0.22f }
                CoverLabel(pageTitle(page), if (look.label == 2) 3.dp else 6.dp, Modifier.fillMaxWidth().padding(horizontal = maxWidth * side).padding(top = maxWidth * topFrac))
            }
            Canvas(Modifier.fillMaxSize()) {
                drawLine(Color.White.copy(alpha = 0.22f), Offset(5.5.dp.toPx(), 0f), Offset(5.5.dp.toPx(), size.height), strokeWidth = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(9f, 9f)))
            }
        }
    }
}

@Composable
private fun CoverLabel(title: String, corner: Dp, modifier: Modifier) {
    val short = title.trim().ifEmpty { "Ohne Titel" }.let { if (it.length > 28) it.take(28) + "…" else it }
    Column(
        modifier.shadow(3.dp, RoundedCornerShape(corner + 3.dp)).clip(RoundedCornerShape(corner + 3.dp))
            .background(ShelfColors.cream).border(1.dp, ShelfColors.labelInk.copy(alpha = 0.55f), RoundedCornerShape(corner + 3.dp))
            .padding(horizontal = 9.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(short, color = ShelfColors.labelInk, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 13.sp)
        Box(Modifier.fillMaxWidth().height(1.dp).background(ShelfColors.labelInk.copy(alpha = 0.28f)))
        Box(Modifier.fillMaxWidth().height(1.dp).background(ShelfColors.labelInk.copy(alpha = 0.28f)))
    }
}

@Composable
private fun CoverPattern(kind: Int) {
    Canvas(Modifier.fillMaxSize()) {
        val w = size.width; val h = size.height
        when (kind) {
            1 -> for (y in 0..h.toInt() step 36) for (x in 0..w.toInt() step 36) drawCircle(Color.White.copy(alpha = 0.2f), 4f, Offset(x + 18f, y + 18f))
            2 -> { var x = 0f; while (x < w) { drawRect(Color.White.copy(alpha = 0.1f), Offset(x, 0f), Size(14f, h)); x += 42f } }
            3 -> rotate(-45f) { val r = hypot(w, h); var x = -r; while (x < r) { drawRect(Color.Black.copy(alpha = 0.1f), Offset(x, -r), Size(18f, 2 * r)); x += 44f } }
            4 -> { var x = 0f; while (x < w) { drawRect(Color.White.copy(alpha = 0.1f), Offset(x, 0f), Size(2f, h)); x += 32f }; var y = 0f; while (y < h) { drawRect(Color.White.copy(alpha = 0.1f), Offset(0f, y), Size(w, 2f)); y += 32f } }
            5 -> for (y in 0..h.toInt() step 30) for (x in 0..w.toInt() step 28) { drawCircle(Color.White.copy(alpha = 0.22f), 3.2f, Offset(x + 6f, y + 8f)); drawCircle(Color.Black.copy(alpha = 0.18f), 3.8f, Offset(x + 18f, y + 18f)) }
            6 -> { drawRect(Color.Black.copy(alpha = 0.2f), Offset(0f, h * 0.66f), Size(w, h * 0.04f)); drawRect(Color.White.copy(alpha = 0.16f), Offset(0f, h * 0.70f), Size(w, h * 0.12f)); drawRect(Color.Black.copy(alpha = 0.2f), Offset(0f, h * 0.82f), Size(w, h * 0.04f)) }
            7 -> { drawCircle(Color.White.copy(alpha = 0.17f), hypot(w * 0.82f, h * 0.88f) * 0.38f, Offset(w * 0.82f, h * 0.88f)); drawCircle(Color.Black.copy(alpha = 0.14f), hypot(w * 0.9f, h * 1.04f) * 0.30f, Offset(w * 0.1f, h * 1.04f)) }
            else -> rotate(45f) { val r = hypot(w, h); var x = -r; while (x < r) { drawRect(Color.White.copy(alpha = 0.04f), Offset(x, -r), Size(6f, 2 * r)); x += 15f } }
        }
    }
}

fun folderTone(key: String): Long {
    val tones = longArrayOf(0xFF7F98B4, 0xFF8AAB90, 0xFFA493B3, 0xFFCFA970, 0xFFC48E84, 0xFF7D8186)
    var h = 0u
    for (ch in key) h = h * 31u + ch.code.toUInt()
    return tones[(h % tones.size.toUInt()).toInt()]
}

/** Mappe mit Reiter, herausschauendem Blatt und kleinem Namensschild (`.gn-folder`). */
@Composable
fun FolderVisual(tone: Long, modifier: Modifier = Modifier) {
    val base = Color(tone)
    val back = lerp(Color(0xFF2A2016), base, 0.72f)
    BoxWithConstraints(modifier.shadow(4.dp, RoundedCornerShape(9.dp))) {
        val w = maxWidth; val h = maxHeight
        Box(Modifier.padding(top = 14.dp).fillMaxSize().clip(RoundedCornerShape(topStart = 6.dp, topEnd = 10.dp, bottomStart = 8.dp, bottomEnd = 8.dp)).background(back))
        Box(Modifier.padding(top = 4.dp).width(w * 0.44f).height(22.dp).clip(RoundedCornerShape(topStart = 7.dp, topEnd = 9.dp)).background(back))
        Box(Modifier.padding(top = 20.dp, bottom = 18.dp, start = w * 0.09f, end = w * 0.11f).fillMaxSize().rotate(-2.5f).clip(RoundedCornerShape(3.dp)).background(ShelfColors.cream))
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(h * 0.64f)
                .clip(RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp, bottomStart = 9.dp, bottomEnd = 9.dp))
                .background(Brush.verticalGradient(listOf(lerp(Color.White, base, 0.86f), base))),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                Modifier.width(w * 0.42f).height(22.dp).clip(RoundedCornerShape(6.dp)).background(ShelfColors.cream)
                    .border(1.dp, ShelfColors.labelInk.copy(alpha = 0.45f), RoundedCornerShape(6.dp)).padding(horizontal = 5.dp),
                verticalArrangement = Arrangement.SpaceEvenly,
            ) {
                Box(Modifier.fillMaxWidth().height(1.dp).background(ShelfColors.labelInk.copy(alpha = 0.25f)))
                Box(Modifier.fillMaxWidth().height(1.dp).background(ShelfColors.labelInk.copy(alpha = 0.25f)))
            }
        }
    }
}

/** Holzbrett unter jeder Regalzeile. */
@Composable
fun ShelfBoard(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().height(3.dp).background(ShelfColors.woodTop))
        Box(Modifier.fillMaxWidth().height(ShelfColors.ledge - 3.dp).background(ShelfColors.wood))
        Box(Modifier.fillMaxWidth().height(9.dp).background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.13f), Color.Transparent))))
    }
}

/** Deko am rechten Ende des letzten Bretts (Topfpflanze oder Bücherstapel). */
@Composable
fun ShelfDeco(books: Boolean, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val sx = size.width / 80f; val sy = size.height / 100f
        if (books) {
            drawRoundRect(Color(0xFF7F98B4), Offset(8 * sx, 84 * sy), Size(64 * sx, 16 * sy), CornerRadius(2.5f * sx))
            drawRect(ShelfColors.cream, Offset(60 * sx, 87 * sy), Size(12 * sx, 10 * sy))
            drawRoundRect(Color(0xFFC48E84), Offset(14 * sx, 69 * sy), Size(54 * sx, 15 * sy), CornerRadius(2.5f * sx))
            drawRect(ShelfColors.cream, Offset(14 * sx, 72 * sy), Size(11 * sx, 9 * sy))
            drawRoundRect(Color(0xFFCFA970), Offset(11 * sx, 56 * sy), Size(52 * sx, 13 * sy), CornerRadius(2.5f * sx))
            drawRect(ShelfColors.cream, Offset(52 * sx, 59 * sy), Size(11 * sx, 7 * sy))
            drawCircle(Color(0xFFC98562), 12 * sx, Offset(38 * sx, 44 * sy))
            drawPath(Path().apply { moveTo(38 * sx, 32 * sy); cubicTo(36 * sx, 24 * sy, 40 * sx, 18 * sy, 46 * sx, 16 * sy); cubicTo(45 * sx, 23 * sy, 43 * sx, 28 * sy, 38 * sx, 32 * sy) }, Color(0xFF6F9A6A))
        } else {
            drawPath(Path().apply { moveTo(40 * sx, 66 * sy); cubicTo(38 * sx, 44 * sy, 26 * sx, 34 * sy, 12 * sx, 30 * sy); cubicTo(14 * sx, 46 * sy, 24 * sx, 58 * sy, 40 * sx, 66 * sy) }, Color(0xFF6F9A6A))
            drawPath(Path().apply { moveTo(40 * sx, 66 * sy); cubicTo(42 * sx, 40 * sy, 54 * sx, 26 * sy, 68 * sx, 22 * sy); cubicTo(68 * sx, 42 * sy, 56 * sx, 58 * sy, 40 * sx, 66 * sy) }, Color(0xFF85B07C))
            drawPath(Path().apply { moveTo(40 * sx, 68 * sy); cubicTo(36 * sx, 48 * sy, 38 * sx, 28 * sy, 42 * sx, 12 * sy); cubicTo(50 * sx, 30 * sy, 48 * sx, 52 * sy, 40 * sx, 68 * sy) }, Color(0xFF5D8A5C))
            drawPath(Path().apply { moveTo(25 * sx, 66 * sy); lineTo(55 * sx, 66 * sy); lineTo(51 * sx, 100 * sy); lineTo(29 * sx, 100 * sy); close() }, Color(0xFFC98562))
            drawRoundRect(Color(0xFFD99A76), Offset(21 * sx, 60 * sy), Size(38 * sx, 9 * sy), CornerRadius(3 * sx))
        }
    }
}
