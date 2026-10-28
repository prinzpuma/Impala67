package org.impala67.app.more

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space

/** Farbe einer Kachel: `--c-*` aus variables.css (dunkel) bzw. styles.css `body.light` (hell). */
private enum class Tint(private val dark: Color, private val light: Color) {
    Blue(Color(82, 156, 202), Color(72, 124, 165)),
    Green(Color(77, 171, 154), Color(84, 129, 100)),
    Orange(Color(255, 163, 68), Color(203, 123, 55)),
    Purple(Color(154, 109, 215), Color(138, 103, 171)),
    Gray(Color(155, 155, 155), Color(120, 119, 116)),
    Red(Color(255, 115, 105), Color(196, 85, 77)),
    ;

    @Composable
    fun color(): Color = if (Impala.colors.isDark) dark else light
}

/** Eine Zeile der Mehr-Ansicht; [action] ist die ID, die die Shell auswertet (wie `data-maction`). */
private data class MoreItem(val action: String, val tint: Tint, val icon: Int, val title: String, val meta: String)

private val AREAS = listOf(
    MoreItem("library", Tint.Blue, R.drawable.ic_i_library, "Bibliothek", "PDFs & Dokumente"),
    MoreItem("graph", Tint.Purple, R.drawable.ic_i_graph, "Wissensgraph", "Vernetzte Notizen"),
    MoreItem("notebooklm", Tint.Green, R.drawable.ic_i_notebook, "Gemini Notebook", "Quellen & Synthese"),
    MoreItem("lernzeit", Tint.Orange, R.drawable.ic_i_chart, "Lernanalyse", "Zeiten & Statistiken"),
)

private val STORAGE = listOf(
    MoreItem("archive", Tint.Gray, R.drawable.ic_i_archive, "Archiv", "Archivierte Notizen & Hefte"),
    MoreItem("trash", Tint.Red, R.drawable.ic_i_trash, "Papierkorb", "Gelöschte Inhalte"),
)

private val APP = listOf(
    MoreItem("settings", Tint.Gray, R.drawable.ic_i_sliders, "Einstellungen", "Design, KI, Konto"),
)

/**
 * Mehr-Ansicht (web/mobile-view.js `moreHtml`): Sync-Karte, dann Bereiche, Ablage und App. Jeder Eintrag
 * ruft [onAction] mit seiner Aktions-ID auf („sync“, „library“, „archive“ …); die Shell entscheidet.
 */
@Composable
fun MoreScreen(onAction: (String) -> Unit, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().background(Impala.colors.panel), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(horizontal = Space.s4)
                .padding(top = Space.s2, bottom = 48.dp),
        ) {
            SyncCard(onClick = { onAction("sync") })
            SectionLabel("Bereiche")
            MoreGroup(AREAS, onAction)
            SectionLabel("Ablage")
            MoreGroup(STORAGE, onAction)
            SectionLabel("App")
            MoreGroup(APP, onAction)
        }
    }
}

/** `.m-sync-card`: grüner Punkt, Titel und Hinweis zur Verschlüsselung. */
@Composable
private fun SyncCard(onClick: () -> Unit) {
    val c = Impala.colors
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 76.dp),
        shape = RoundedCornerShape(Radius.lg),
        color = c.surface,
    ) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(c.success))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Synchronisation", color = c.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    "Ende-zu-Ende verschlüsselt · Cloudflare & Google Drive",
                    color = c.text2, fontSize = 12.5.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(painterResource(R.drawable.ic_i_chevron_right), null, Modifier.size(18.dp), tint = c.text2.copy(alpha = 0.6f))
        }
    }
}

/** Abschnittsüberschrift wie `.m-section-label`. */
@Composable
private fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        Modifier.padding(start = Space.s1, top = 22.dp, bottom = Space.s2),
        color = Impala.colors.text2,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.5.sp,
    )
}

/** Gruppe mit Zeilen; Trennlinien beginnen nach der Kachel (`--m-sep: 58px`). */
@Composable
private fun MoreGroup(items: List<MoreItem>, onAction: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.lg)).background(Impala.colors.surface)) {
        items.forEachIndexed { index, item ->
            if (index > 0) MoreDivider(58.dp)
            MoreRow(item) { onAction(item.action) }
        }
    }
}

@Composable
private fun MoreDivider(inset: Dp) {
    HorizontalDivider(Modifier.padding(start = inset), thickness = 1.dp, color = Impala.colors.edgeSoft)
}

/** `.m-row` mit Icon-Kachel, Titel, Hinweis und Pfeil. */
@Composable
private fun MoreRow(item: MoreItem, onClick: () -> Unit) {
    val c = Impala.colors
    val tint = item.tint.color()
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(32.dp).clip(RoundedCornerShape(Radius.sm)).background(tint.copy(alpha = 0.18f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(painterResource(item.icon), null, Modifier.size(18.dp), tint = tint)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(item.title, color = c.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            Text(item.meta, color = c.text2, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(painterResource(R.drawable.ic_i_chevron_right), null, Modifier.size(18.dp), tint = c.text2.copy(alpha = 0.6f))
    }
}
