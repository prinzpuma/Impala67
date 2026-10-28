package org.impala67.app.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.impala67.app.editor.MarkdownView
import org.impala67.app.ui.components.PanelCard
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.components.TintLabel
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.HomeArticleInfo

/**
 * Tagesartikel (home-article.js): aufklappbar mit Anriss, Quellen und „Gelesen“; gelesen nur ein Hinweis.
 * Das Schreiben per KI kommt mit dem KI-Modul; der Text erscheint bis zum Markdown-Renderer als Klartext.
 */
@Composable
fun ArticleCard(a: ArticleState, width: HomeWidth, onOpenPage: (String) -> Unit, onRead: () -> Unit, onHistory: () -> Unit) {
    val c = Impala.colors
    val history = if (a.count > 1) "Verlauf (${a.count})" else null
    if (a.read) {
        Row(Modifier.padding(top = 40.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Tagesartikel „${a.article.title}“ gelesen.", fontSize = TextSize.sm, color = c.text2, modifier = Modifier.weight(1f, fill = false))
            TextButton(onHistory) { Text("Nochmal lesen", fontSize = TextSize.sm) }
        }
        return
    }
    var open by rememberSaveable(a.article.id) { mutableStateOf(false) }
    val bg by animateColorAsState(if (open) c.surfaceSubtle else c.tint, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "article")
    val pad = if (width == HomeWidth.Narrow) PaddingValues(horizontal = Space.s5, vertical = Space.s4) else PaddingValues(horizontal = Space.s6, vertical = Space.s5)
    PanelCard(
        Modifier.fillMaxWidth().padding(top = 40.dp), color = bg, border = if (open) c.edgeSoft else Color.Transparent,
        padding = pad, onClick = { open = !open },
    ) {
        Text("Tagesartikel · " + a.article.topics.joinToString(" · "), fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold, color = c.text2)
        Text(a.article.title, fontSize = TextSize.lg, lineHeight = TextSize.lg * 1.3f, color = c.text, modifier = Modifier.padding(top = Space.s1))
        if (!open) {
            Text(a.teaser, fontSize = TextSize.md, lineHeight = TextSize.md * 1.5f, color = c.text2, modifier = Modifier.padding(top = Space.s1))
            Text("Weiterlesen", fontSize = TextSize.xs, color = c.accent, modifier = Modifier.padding(top = Space.s2))
        }
        AnimatedVisibility(open, enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + expandVertically(MaterialTheme.motionScheme.defaultSpatialSpec())) {
            Column(Modifier.padding(top = Space.s3)) {
                HorizontalDivider(color = c.edgeSoft)
                MarkdownView(a.article.body, Modifier.padding(top = Space.s3).widthIn(max = 640.dp), onOpenPage = onOpenPage)
                Sources(a.article, onOpenPage)
                Row(Modifier.padding(top = Space.s5), horizontalArrangement = Arrangement.spacedBy(Space.s4), verticalAlignment = Alignment.CenterVertically) {
                    TintButton(onRead) { TintLabel("Gelesen") }
                    history?.let { TextButton(onHistory) { Text(it) } }
                }
            }
        }
    }
}

/** „Aus deinen Notizen“ (`.hv-article-src`). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Sources(a: HomeArticleInfo, onOpenPage: (String) -> Unit) {
    if (a.sources.isEmpty()) return
    Text("Aus deinen Notizen", fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold, color = Impala.colors.text2, modifier = Modifier.padding(top = Space.s4, bottom = Space.s2))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s2), verticalArrangement = Arrangement.spacedBy(Space.s2)) {
        a.sources.forEach { src ->
            TintButton({ onOpenPage(src.id) }, strong = false) { TintLabel(src.title + if (src.archived) " · Archiv" else "", strong = false) }
        }
    }
}

/** Verlauf der Tagesartikel (`openHistory`) als Bottom-Sheet; der neueste ist aufgeklappt. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleHistorySheet(articles: List<HomeArticleInfo>, onOpenPage: (String) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Text("Tagesartikel", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = Space.s6))
        LazyColumn(contentPadding = PaddingValues(horizontal = Space.s6, vertical = Space.s3)) {
            items(articles, key = { it.id }) { a ->
                var open by rememberSaveable(a.id) { mutableStateOf(a == articles.first()) }
                Column(Modifier.fillMaxWidth().padding(vertical = Space.s3)) {
                    TextButton({ open = !open }, contentPadding = PaddingValues(0.dp)) {
                        Column(Modifier.fillMaxWidth()) {
                            Text(a.day + " · " + a.topics.joinToString(" · "), fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold, color = Impala.colors.text2)
                            Text(a.title, fontWeight = FontWeight.SemiBold, color = Impala.colors.text)
                        }
                    }
                    if (open) {
                        MarkdownView(a.body, Modifier.padding(top = Space.s3), onOpenPage = { onOpenPage(it); onDismiss() })
                        Sources(a) { onOpenPage(it); onDismiss() }
                    }
                }
                HorizontalDivider(color = Impala.colors.edgeSoft)
            }
        }
    }
}
