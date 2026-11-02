package org.impala67.app.graph

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.study.stats.SCard
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import kotlin.math.roundToInt

/** Detailpanel eines Unterthemas (graph.js `inspectorHtml`), im Bearbeiten-Modus mit Name, Thema und Verbindungen. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun Inspector(
    g: KnowledgeGraph,
    s: Skill,
    cards: Map<String, SCard>,
    vm: GraphViewModel,
    onStudyDeck: (String?) -> Unit,
    onToast: (String) -> Unit,
    modifier: Modifier,
) {
    val c = Impala.colors
    val m = mastery(s, cards)
    val subject = g.subjects.firstOrNull { it.id == s.subjectId }?.name.orEmpty()
    val topic = g.topics.firstOrNull { it.id == s.topicId }?.name
    val prereqs = s.prereqIds.mapNotNull(g::skill)
    val related = g.bridges.filter { it.a == s.id || it.b == s.id }.mapNotNull { g.skill(if (it.a == s.id) it.b else it.a) }
    Column(
        modifier.background(c.panel).border(1.dp, c.edgeSoft).verticalScroll(rememberScrollState()).padding(Space.s4),
        verticalArrangement = Arrangement.spacedBy(Space.s3),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(subject + (topic?.let { " › $it" } ?: ""), Modifier.weight(1f), color = c.text2, fontSize = TextSize.xs)
            Box(Modifier.size(28.dp).clip(CircleShape).clickable { vm.selected = null }, contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_i_x), "Details schließen", Modifier.size(12.dp), tint = c.text2)
            }
        }
        Text(s.title, color = c.text, fontSize = TextSize.lg, fontWeight = FontWeight.SemiBold)
        Text(s.description.ifBlank { "Aus deinen Karten abgeleitetes Unterthema." }, color = c.text2, fontSize = TextSize.sm)
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            Metric("${(m.value * 100).roundToInt()}%", m.label, Modifier.weight(1f))
            Metric("${m.due}", "jetzt fällig", Modifier.weight(1f))
            Metric("${m.rated}/${m.cards}", "bewertet", Modifier.weight(1f))
        }
        if (s.gap) Text("Noch keine Karte deckt dieses Unterthema ab.", color = c.warn, fontSize = TextSize.sm)
        else Button({ onStudyDeck(vm.deckFor(s, cards)?.takeIf { it != "Standard" }) }, Modifier.fillMaxWidth()) { Text("Zugehörige Karten lernen") }
        if (prereqs.isNotEmpty()) Relations("Voraussetzungen", prereqs, vm)
        if (related.isNotEmpty()) {
            Relations("Verwandte Unterthemen", related, vm)
            OutlinedButton({ vm.synthesize(s, related.first()) }) { Text("Verbindung als Synthese-Frage") }
        }
        if (vm.mode == GraphMode.EDIT) EditBlock(g, s, vm, onToast)
    }
}

@Composable
private fun Metric(value: String, label: String, modifier: Modifier) {
    val c = Impala.colors
    Column(modifier.clip(RoundedCornerShape(Radius.md)).background(c.surface).padding(Space.s2)) {
        Text(value, color = c.text, fontSize = TextSize.md, fontWeight = FontWeight.SemiBold)
        Text(label, color = c.text2, fontSize = TextSize.xs2)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Relations(title: String, list: List<Skill>, vm: GraphViewModel) {
    val c = Impala.colors
    Text(title, color = c.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s1), verticalArrangement = Arrangement.spacedBy(Space.s1)) {
        list.forEach { r ->
            Text(
                r.title,
                Modifier.clip(CircleShape).background(c.surface).clickable { vm.tap(r.id) }.padding(horizontal = Space.s3, vertical = Space.s1),
                color = c.text, fontSize = TextSize.sm,
            )
        }
    }
}

@Composable
private fun EditBlock(g: KnowledgeGraph, s: Skill, vm: GraphViewModel, onToast: (String) -> Unit) {
    val c = Impala.colors
    var title by remember(s.id) { mutableStateOf(s.title) }
    var topicId by remember(s.id) { mutableStateOf(s.topicId) }
    var menu by remember { mutableStateOf(false) }
    val label = { id: String ->
        val t = g.topics.firstOrNull { it.id == id }
        (g.subjects.firstOrNull { it.id == t?.subjectId }?.name.orEmpty()) + " › " + t?.name.orEmpty()
    }
    Text("Bearbeiten", color = c.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
    OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), label = { Text("Name") }, singleLine = true)
    Box {
        OutlinedButton({ menu = true }, Modifier.fillMaxWidth()) { Text("Fach › Thema: " + label(topicId), maxLines = 1) }
        DropdownMenu(menu, { menu = false }) {
            g.topics.forEach { t -> DropdownMenuItem(text = { Text(label(t.id)) }, onClick = { topicId = t.id; menu = false }) }
        }
    }
    Button({ vm.saveSkill(s.id, title, topicId, onToast) }, Modifier.fillMaxWidth()) { Text("Änderungen speichern") }
    Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
        OutlinedButton({ vm.startLink("bridge") }, Modifier.weight(1f)) { Text("Unterthemen verbinden") }
        OutlinedButton({ vm.startLink("prereq") }, Modifier.weight(1f)) { Text("Als Voraussetzung verbinden") }
    }
}
