package org.impala67.app.heft

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.HeftPageData
import uniffi.impala_ffi.heftSnapshotFirstPage
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val stamp = SimpleDateFormat("dd.MM., HH:mm", Locale.GERMANY)

/**
 * Verlauf der Seitenübersicht (heft-pages-ui.js `pagesHistoryHtml`): je Stand die erste Seite als
 * Miniatur mit Datum und Uhrzeit; Antippen fragt nach und stellt wieder her ([onRestore]).
 * [snaps] `null` = lädt noch. Bilder fehlen in den Miniaturen (nur Papier, Striche, Texte).
 */
@Composable
fun HeftHistoryGrid(snaps: List<HeftSnap>?, columns: Int?, modifier: Modifier = Modifier, onRestore: (HeftSnap) -> Unit) {
    val c = Impala.colors
    when {
        snaps == null -> Empty("Verlauf wird geladen …", modifier)
        snaps.isEmpty() -> Empty("Noch keine Stände. Sie entstehen automatisch beim Schreiben (höchstens alle 10 Min., nur auf diesem Gerät).", modifier)
        else -> LazyVerticalGrid(
            columns = columns?.let { GridCells.Fixed(it) } ?: GridCells.Adaptive(minSize = 110.dp),
            modifier = modifier,
            contentPadding = PaddingValues(start = 22.dp, top = 16.dp, end = 22.dp, bottom = 30.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            items(snaps, key = { it.t }) { snap ->
                var page by remember(snap.t) { mutableStateOf<HeftPageData?>(null) }
                LaunchedEffect(snap.t) { page = withContext(Dispatchers.IO) { runCatching { heftSnapshotFirstPage(snap.file.readText()) }.getOrNull() } }
                Column(
                    Modifier.clickable(role = Role.Button, onClickLabel = "Stand wiederherstellen") { onRestore(snap) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    val shape = RoundedCornerShape(Radius.xs)
                    PageSketch(page, Modifier.fillMaxWidth().aspectRatio(HeftPage.RATIO).shadow(3.dp, shape).clip(shape))
                    Text(stamp.format(Date(snap.t)), color = c.text2, fontSize = TextSize.xs2)
                }
            }
        }
    }
}

@Composable
private fun Empty(text: String, modifier: Modifier) {
    Box(modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 36.dp), Alignment.Center) {
        Text(text, color = Impala.colors.text2, fontSize = TextSize.sm)
    }
}
