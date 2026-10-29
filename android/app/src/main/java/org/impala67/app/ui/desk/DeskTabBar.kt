package org.impala67.app.ui.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.shell.PageRoute
import org.impala67.app.ui.shell.ShellNav
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize

/**
 * Tab-Leiste über dem Inhalt (`#tabbar`, `renderTabs` in render.js): Zurück, offene Seiten als
 * Chips (170 dp, aktiv getönt, × zum Schließen), „+“ für eine neue Seite im neuen Tab und rechts
 * Teilen/Stern/⋯ der offenen Seite ([PageActions]).
 * TODO(desk): Vor-Knopf, Chat-Tabs.
 */
@Composable
fun DeskTabBar(store: ImpalaStore, nav: ShellNav, canGoBack: Boolean, modifier: Modifier = Modifier) {
    val c = Impala.colors
    val pages by remember(store) {
        store.query(Touches.pages) { core -> core.recentPages(UInt.MAX_VALUE).associateBy { it.id } }
    }.collectAsStateWithLifecycle()
    val activeId = nav.currentPageId
    Column(modifier.fillMaxWidth().background(c.panel)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s2, vertical = Space.s1_5),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            SmallButton(R.drawable.ic_i_chevron_left, "Zurück", enabled = canGoBack, onClick = nav::back)
            Row(
                Modifier.weight(1f, fill = false).horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                nav.tabs.forEach { id ->
                    TabChip(pages?.get(id)?.let { pageTitle(it) } ?: "Ohne Titel", id == activeId, { nav.open(PageRoute(id)) }, { nav.closeTab(id) })
                }
            }
            SmallButton(R.drawable.ic_i_plus, "Neuen Tab öffnen") { nav.create(heft = false, newTab = true) }
            if (activeId != null) PageActions(store, nav, activeId, favorite = pages?.get(activeId)?.favorite == true)
        }
        HorizontalDivider(color = c.edgeSoft)
    }
}

@Composable
private fun TabChip(title: String, active: Boolean, onClick: () -> Unit, onClose: () -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.widthIn(min = 96.dp, max = 170.dp).height(32.dp).clip(RoundedCornerShape(Radius.sm))
            .background(if (active) c.accent.copy(alpha = 0.14f) else Color.Transparent)
            .clickable(onClick = onClick).padding(start = 10.dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, Modifier.weight(1f, fill = false), color = if (active) c.text else c.text2, fontSize = TextSize.sm, maxLines = 1, overflow = TextOverflow.Ellipsis)
        SmallButton(R.drawable.ic_i_x, "Tab schließen", size = 24, onClick = onClose)
    }
}

@Composable
internal fun SmallButton(icon: Int, label: String, enabled: Boolean = true, size: Int = 32, active: Boolean = false, onClick: () -> Unit) {
    val c = Impala.colors
    Box(
        Modifier.size(size.dp).clip(RoundedCornerShape(Radius.sm)).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        val tint = if (!enabled) c.text2.copy(alpha = 0.3f) else if (active) c.accent else c.text2
        Icon(painterResource(icon), label, Modifier.size((size / 2).dp), tint = tint)
    }
}
