package org.impala67.app.library

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import java.io.File
import kotlin.math.roundToInt

/** Geöffnetes PDF: Renderer samt Seitengrößen (Punkte). Der Renderer erlaubt nur eine offene Seite zur Zeit. */
private class OpenPdf(val file: File) {
    private val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer = PdfRenderer(fd)
    private val lock = Mutex()
    val sizes: List<Pair<Int, Int>> = (0 until renderer.pageCount).map { i -> renderer.openPage(i).use { it.width to it.height } }

    suspend fun render(index: Int, widthPx: Int): Bitmap = lock.withLock {
        withContext(Dispatchers.IO) {
            renderer.openPage(index).use { page ->
                val h = (widthPx * page.height / page.width.toFloat()).roundToInt().coerceAtLeast(1)
                Bitmap.createBitmap(widthPx.coerceAtLeast(1), h, Bitmap.Config.ARGB_8888).also {
                    it.eraseColor(android.graphics.Color.WHITE)
                    page.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                }
            }
        }
    }

    fun close() { runCatching { renderer.close(); fd.close() } }
}

/**
 * PDF-Ansicht (web/pdfs.js): Seiten untereinander, Verkleinern / 100 % / Vergrößern / An Breite anpassen,
 * Vollbild, extern öffnen und Herunterladen.
 */
@Composable
fun PdfViewer(store: ImpalaStore, fileId: String, title: String, onToggleFullscreen: (() -> Unit)?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = Impala.colors
    val pdf by produceState<Result<OpenPdf>?>(null, fileId) {
        value = runCatching {
            val file = cachePdf(context, store, fileId, title) ?: error("PDF-Daten nicht gefunden")
            withContext(Dispatchers.IO) { OpenPdf(file) }
        }
    }
    DisposableEffect(pdf) { onDispose { pdf?.getOrNull()?.close() } }
    var zoom by remember { mutableFloatStateOf(1f) }
    var fit by remember { mutableStateOf(true) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        val file = pdf?.getOrNull()?.file ?: return@rememberLauncherForActivityResult
        if (uri != null) scope.launch(Dispatchers.IO) { runCatching { context.contentResolver.openOutputStream(uri, "wt")!!.use { out -> file.inputStream().use { it.copyTo(out) } } } }
    }
    Column(modifier.fillMaxSize().background(c.panel)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Space.s3, vertical = Space.s1), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title.ifBlank { "PDF" }, Modifier.weight(1f), color = c.text, fontSize = TextSize.sm, maxLines = 1)
            ToolButton(R.drawable.ic_i_minus, "Verkleinern") { fit = false; zoom = (zoom / 1.25f).coerceAtLeast(0.25f) }
            Text("${(zoom * 100).roundToInt()} %", Modifier.clip(RoundedCornerShape(6.dp)).clickable { fit = false; zoom = 1f }.padding(horizontal = 6.dp, vertical = 4.dp), color = c.text2, fontSize = TextSize.xs)
            ToolButton(R.drawable.ic_i_plus, "Vergrößern") { fit = false; zoom = (zoom * 1.25f).coerceAtMost(5f) }
            ToolButton(R.drawable.ic_i_arrows_h, "An Breite anpassen") { fit = true; zoom = 1f }
            onToggleFullscreen?.let { ToolButton(R.drawable.ic_i_fullscreen, "Vollbild", it) }
            ToolButton(R.drawable.ic_i_external, "In neuem Tab öffnen") { pdf?.getOrNull()?.file?.let { openPdfExternally(context, it) } }
            ToolButton(R.drawable.ic_i_download, "PDF herunterladen") { save.launch(title.ifBlank { "Dokument" } + ".pdf") }
        }
        val p = pdf
        when {
            p == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("PDF wird geladen…", color = c.text2) }
            p.isFailure -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(p.exceptionOrNull()?.message ?: "PDF nicht gefunden", color = c.text2) }
            else -> BoxWithConstraints(Modifier.fillMaxSize().background(c.surfaceSubtle)) {
                val doc = p.getOrThrow()
                val density = LocalDensity.current
                val baseW = maxWidth - 32.dp
                val pageW = if (fit) baseW else baseW * zoom
                val px = with(density) { pageW.roundToPx() }
                Box(Modifier.fillMaxSize().horizontalScroll(rememberScrollState())) {
                    LazyColumn(Modifier.width(pageW + 32.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(Space.s3)) {
                        items(doc.sizes.size) { i ->
                            val (w, h) = doc.sizes[i]
                            val bmp by produceState<Bitmap?>(null, i, px) { value = runCatching { doc.render(i, px.coerceAtMost(4000)) }.getOrNull() }
                            Box(Modifier.padding(horizontal = 16.dp).width(pageW).aspectRatio(w / h.toFloat()).background(Color.White)) {
                                bmp?.let { Image(it.asImageBitmap(), "Seite ${i + 1}", Modifier.fillMaxSize()) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolButton(icon: Int, label: String, onClick: () -> Unit) {
    Box(Modifier.size(32.dp).clip(RoundedCornerShape(6.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), label, Modifier.size(16.dp), tint = Impala.colors.text2)
    }
}
