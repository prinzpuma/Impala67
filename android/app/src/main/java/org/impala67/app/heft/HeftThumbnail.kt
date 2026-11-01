package org.impala67.app.heft

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.theme.Impala
import uniffi.impala_ffi.Changes
import uniffi.impala_ffi.HeftPageData
import java.util.concurrent.ConcurrentHashMap

/** Zuletzt angesehene Heftseite je Heft (in der PWA `HEFT.lastPage`); gilt nur für die laufende Sitzung. */
object HeftLastPage {
    private val pages = ConcurrentHashMap<String, Int>()

    operator fun get(pageId: String) = pages[pageId] ?: 0

    operator fun set(pageId: String, index: Int) { pages[pageId] = index }
}

/**
 * Vorschaubild eines Hefts (Startseite, `.hv-prev.heft`): die zuletzt angesehene Seite, sonst die erste,
 * mit Papier und Strichen. Das Bild füllt die Breite und beginnt oben; was die Höhe nicht fasst, wird abgeschnitten.
 */
@Composable
fun HeftThumbnail(store: ImpalaStore, pageId: String, modifier: Modifier = Modifier) {
    val page by remember(store, pageId) {
        val touched = { c: Changes -> pageId in c.hefte }
        store.query(touched) { core ->
            val ids = core.heftPageIds(pageId)
            ids.getOrNull(HeftLastPage[pageId].coerceIn(0, (ids.size - 1).coerceAtLeast(0)))
                ?.let { runCatching { core.heftPage(pageId, it) }.getOrNull() }
        }
    }.collectAsStateWithLifecycle()
    PageSketch(page, modifier, rememberHeftImages(store, pageId, page?.id, page?.images.orEmpty(), maxSide = 512))
}

/** Papier, Bilder, Striche und Textfelder einer Seite als Skizze (Startseite und Seitenübersicht). */
@Composable
fun PageSketch(data: HeftPageData?, modifier: Modifier = Modifier, images: Map<String, ImageBitmap> = emptyMap()) {
    val ink = Impala.colors.accent
    val cache = remember { StrokeCache() }
    val strokes = remember(data) { data?.strokes.orEmpty().mapNotNull(cache::get) }

    Canvas(modifier) {
        val k = size.width / HeftPage.WIDTH
        drawPaper(Paper.of(data?.paper.orEmpty()), ink, k)
        drawHeftImages(data?.images.orEmpty(), images, k)
        drawInkStrokes(strokes, k)
        drawHeftTexts(data?.texts.orEmpty(), k)
    }
}
