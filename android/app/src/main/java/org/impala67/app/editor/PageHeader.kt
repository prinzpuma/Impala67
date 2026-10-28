package org.impala67.app.editor

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.R
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import uniffi.impala_ffi.PageSummary

/** Zurück + Brotkrumen (render.js `breadcrumbHtml`): Arbeitsbereich / Eltern … / aktuelle Seite. */
@Composable
internal fun Breadcrumbs(
    head: PageHeaderData?,
    title: String,
    onOpenPage: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Impala.colors
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) {
            Icon(painterResource(R.drawable.ic_i_chevron_left), "Zurück", Modifier.size(22.dp), tint = c.text)
        }
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
            if (head != null) {
                Crumb(head.workspace)
                val anc = head.ancestors
                if (anc.size > 2) {
                    Sep(); Crumb(anc.first().title.ifEmpty { "Unbenannt" }) { onOpenPage(anc.first().id) }
                    Sep(); Text("…", color = c.text2.copy(alpha = 0.6f), fontSize = 13.sp)
                    Sep(); Crumb(anc.last().title.ifEmpty { "Unbenannt" }) { onOpenPage(anc.last().id) }
                } else {
                    anc.forEach { a -> Sep(); Crumb(a.title.ifEmpty { "Unbenannt" }) { onOpenPage(a.id) } }
                }
                Sep(); Crumb(title.ifEmpty { "Unbenannt" }, current = true)
            }
        }
    }
}

@Composable
private fun Sep() = Text("/", Modifier.padding(horizontal = 2.dp), color = Impala.colors.text2.copy(alpha = 0.4f), fontSize = 13.sp)

@Composable
private fun Crumb(label: String, current: Boolean = false, onClick: (() -> Unit)? = null) {
    val c = Impala.colors
    Text(
        label,
        Modifier.widthIn(max = if (current) 220.dp else 180.dp).clip(CircleShape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 8.dp, vertical = 4.dp),
        color = if (current) c.text else c.text2, fontSize = 13.sp,
        fontWeight = if (current) FontWeight.SemiBold else null, maxLines = 1, overflow = TextOverflow.Ellipsis,
    )
}

/** Icon, großer Titel (`#pageTitle`) und Rückverweise. Enter im Titel springt in den Text. */
@Composable
internal fun PageTitleBlock(
    head: PageHeaderData?,
    title: String,
    onTitle: (String) -> Unit,
    onEnter: () -> Unit,
    onOpenPage: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Impala.colors
    Column(modifier.fillMaxWidth()) {
        val icon = head?.page?.summary?.icon.orEmpty()
        if (icon.isNotEmpty()) Text(icon, Modifier.padding(top = 14.dp, start = 2.dp), fontSize = 40.sp, lineHeight = 48.sp)
        val style = TextStyle(color = c.text, fontSize = 34.sp, lineHeight = 41.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.85).sp)
        BasicTextField(
            value = title,
            onValueChange = { v -> if (v.contains('\n')) { onTitle(v.replace("\n", "")); onEnter() } else onTitle(v) },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp),
            textStyle = style,
            cursorBrush = SolidColor(c.accent),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            decorationBox = { inner ->
                Box {
                    if (title.isEmpty()) Text("Unbenannt", style = style.copy(color = c.text2.copy(alpha = 0.4f)))
                    inner()
                }
            },
        )
        head?.backlinks?.takeIf { it.isNotEmpty() }?.let { Backlinks(it, onOpenPage) }
    }
}

@Composable
private fun Backlinks(links: List<PageSummary>, onOpenPage: (String) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        TintButton(onClick = { open = !open }, strong = false, height = 36.dp) {
            Icon(painterResource(R.drawable.ic_i_backlink), null, Modifier.size(16.dp).padding(end = 0.dp))
            Text("  ${links.size} Rückverweise", fontSize = 13.sp)
        }
        if (open) {
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                links.take(20).forEach { l ->
                    Crumb((l.icon.takeIf { it.isNotEmpty() }?.plus(" ") ?: "") + l.title.ifEmpty { "Unbenannt" }) { onOpenPage(l.id) }
                }
            }
        }
    }
}
