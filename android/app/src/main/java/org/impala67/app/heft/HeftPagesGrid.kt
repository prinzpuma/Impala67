package org.impala67.app.heft

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.item
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize

private val TileShape = RoundedCornerShape(Radius.xs)

// TODO(desk): Seiten per Ziehen verschieben (heft-pages-ui.js, Griff ⠿). Die FFI hat `heftMovePage`,
// aber keine Ziehgeste mit Zielmarkierung; ohne eigene Bibliothek (Reorderable) eine Pointer-Geste nötig.

/**
 * Raster aller Seiten (heft-pages-ui.js `pagesGridHtml`): Miniaturen mit Nummer, die aktive Seite
 * umrandet. Im Auswahlmodus zeigt ein Haken die gewählten Seiten; am Ende „Neue Seite“.
 */
@Composable
fun HeftPagesGrid(
    vm: HeftViewModel,
    pages: List<String>,
    current: Int,
    selected: Set<String>,
    picking: Boolean,
    onTap: (String) -> Unit,
    onAdd: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 110.dp),
        modifier = modifier,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        itemsIndexed(pages, key = { _, id -> id }) { i, id ->
            PageTile(
                vm = vm,
                heftPageId = id,
                index = i,
                highlighted = if (picking) id in selected else i == current,
                checked = id in selected,
                picking = picking,
                onClick = { onTap(id) },
            )
        }
        if (!picking) {
            item(key = "neue-seite") { AddTile(onAdd) }
        }
    }
}

@Composable
private fun PageTile(
    vm: HeftViewModel,
    heftPageId: String,
    index: Int,
    highlighted: Boolean,
    checked: Boolean,
    picking: Boolean,
    onClick: () -> Unit,
) {
    val c = Impala.colors
    val data by vm.page(heftPageId).collectAsStateWithLifecycle()
    Column(
        Modifier.clickable(role = Role.Button, onClickLabel = "Seite ${index + 1}", onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.fillMaxWidth().aspectRatio(HeftPage.RATIO)) {
            PageSketch(
                data,
                Modifier.fillMaxSize().shadow(2.dp, TileShape).clip(TileShape)
                    .then(if (highlighted) Modifier.border(2.dp, c.accent, TileShape) else Modifier),
            )
            if (picking && checked) {
                Box(
                    Modifier.align(Alignment.TopEnd).padding(6.dp).size(26.dp).clip(CircleShape).background(c.accent),
                    Alignment.Center,
                ) {
                    Icon(painterResource(R.drawable.ic_i_check), null, Modifier.size(16.dp), c.onAccent)
                }
            }
        }
        Text(
            "${index + 1}",
            modifier = Modifier.padding(top = 6.dp),
            color = if (highlighted) c.accent else c.text2,
            fontSize = TextSize.xs,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun AddTile(onClick: () -> Unit) {
    val c = Impala.colors
    Column(
        Modifier.clickable(role = Role.Button, onClickLabel = "Neue Seite", onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(HeftPage.RATIO).clip(TileShape)
                .background(c.tint).border(1.dp, c.accentBorder, TileShape),
            Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(22.dp), c.accent)
                Text("Neue Seite", color = c.accent, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
