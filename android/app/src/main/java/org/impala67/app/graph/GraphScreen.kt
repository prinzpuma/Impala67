package org.impala67.app.graph

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.unit.toSize
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.study.stats.SCard
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import kotlin.math.roundToInt

/**
 * Wissensgraph (web/graph.js): Fächer als Bahnen, darin Themen mit Unterthemen nach Voraussetzungs-Ebenen,
 * Linien für Voraussetzungen (und Verwandte im Lernmodus bzw. am gewählten Knoten), rechts das Detailpanel.
 */
@Composable
fun GraphScreen(store: ImpalaStore, prefs: DevicePrefs, onStudyDeck: (String?) -> Unit, onToast: (String) -> Unit, modifier: Modifier = Modifier) {
    val vm = viewModel { GraphViewModel(store, prefs) }
    val view by vm.view.collectAsStateWithLifecycle()
    val c = Impala.colors
    val v = view
    Column(modifier.fillMaxSize().background(c.panel)) {
        GraphHeader(vm)
        val status = vm.status ?: if (v?.stale == true) GraphStatus("Neue Lerninhalte erkannt", "Die Themenlandkarte kann kontrolliert aktualisiert werden.", retry = true) else null
        status?.let { StatusBar(it, vm) }
        val g = v?.graph
        if (v == null) return@Column
        if (g == null || g.skills.isEmpty()) {
            EmptyGraph(vm::analyse)
            return@Column
        }
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val wide = maxWidth >= 760.dp
            val skill = g.skill(vm.selected)
            Row(Modifier.fillMaxSize()) {
                Stage(g, v.cards, vm, Modifier.weight(1f).fillMaxHeight())
                if (wide && skill != null) Inspector(g, skill, v.cards, vm, onStudyDeck, onToast, Modifier.width(340.dp).fillMaxHeight())
            }
            if (!wide && skill != null) Inspector(
                g, skill, v.cards, vm, onStudyDeck, onToast,
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().fillMaxHeight(0.55f),
            )
        }
    }
}

@Composable
private fun GraphHeader(vm: GraphViewModel) {
    val c = Impala.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s3), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s3)) {
        Text("✦", color = c.accent, fontSize = TextSize.lg)
        Column {
            Text("Wissensgraph", color = c.text, fontSize = TextSize.md, fontWeight = FontWeight.SemiBold)
            Text("Deine Themenlandkarte", color = c.text2, fontSize = TextSize.xs)
        }
        Spacer(Modifier.weight(1f))
        Row(Modifier.clip(CircleShape).background(c.surface).padding(2.dp)) {
            GraphMode.entries.forEach { m ->
                Text(
                    m.label,
                    Modifier.clip(CircleShape).background(if (vm.mode == m) c.tint2 else c.surface)
                        .clickable { vm.mode = m; vm.pendingLink = null }.padding(horizontal = Space.s3, vertical = Space.s1),
                    color = if (vm.mode == m) c.text else c.text2, fontSize = TextSize.sm,
                )
            }
        }
        Row(
            Modifier.widthIn(min = 140.dp, max = 220.dp).clip(CircleShape).background(c.surface).padding(horizontal = Space.s3, vertical = Space.s1),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(painterResource(R.drawable.ic_i_search), null, Modifier.size(14.dp), tint = c.text2)
            BasicTextField(
                vm.query, { vm.query = it }, Modifier.padding(start = Space.s1).weight(1f), singleLine = true,
                textStyle = TextStyle(color = c.text, fontSize = TextSize.sm), cursorBrush = SolidColor(c.accent),
                decorationBox = { inner -> if (vm.query.isEmpty()) Text("Unterthemen suchen", color = c.text2, fontSize = TextSize.sm); inner() },
            )
        }
        Box(Modifier.size(32.dp).clip(CircleShape).clickable(onClick = vm::analyse), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.ic_i_sync), "Analyse aktualisieren", Modifier.size(16.dp), tint = c.text2)
        }
    }
}

@Composable
private fun StatusBar(s: GraphStatus, vm: GraphViewModel) {
    val c = Impala.colors
    Row(
        Modifier.padding(horizontal = Space.s4).fillMaxWidth().clip(RoundedCornerShape(Radius.md)).background(c.surface).padding(Space.s3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(s.title + if (s.busy) " …" else "", color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
            if (s.text.isNotEmpty()) Text(s.text, color = c.text2, fontSize = TextSize.xs)
        }
        if (s.retry) TextButton(vm::analyse) { Text("Erneut versuchen") }
        s.synth?.let { (f, b) -> TextButton({ vm.saveSynth(f, b) }) { Text("Als Karte speichern") } }
        if (!s.busy) Box(Modifier.size(28.dp).clip(CircleShape).clickable { vm.status = null; vm.pendingLink = null }, contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.ic_i_x), "Schließen", Modifier.size(12.dp), tint = c.text2)
        }
    }
}

@Composable
private fun EmptyGraph(onAnalyse: () -> Unit) {
    val c = Impala.colors
    Column(Modifier.fillMaxSize().padding(Space.s6), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("✦", color = c.accent, fontSize = TextSize.xl)
        Text("Baue deine Themenlandkarte", color = c.text, fontSize = TextSize.lg, fontWeight = FontWeight.SemiBold)
        Text("Die KI ordnet deine Karten in Fächer, Teilgebiete und verknüpfte Unterthemen.", color = c.text2, fontSize = TextSize.sm, modifier = Modifier.padding(vertical = Space.s2))
        TextButton(onAnalyse) { Text("Jetzt analysieren") }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Stage(g: KnowledgeGraph, cards: Map<String, SCard>, vm: GraphViewModel, modifier: Modifier) {
    val c = Impala.colors
    val rects = remember(g) { mutableStateMapOf<String, Rect>() }
    val origin = remember { arrayOfNulls<LayoutCoordinates>(1) }
    val masteries = remember(g, cards) { g.skills.associate { it.id to mastery(it, cards) } }
    val rec = if (vm.mode == GraphMode.LEARN) g.skills.maxByOrNull { s ->
        val m = masteries[s.id]!!
        m.due * 100 + (if (m.state == "fragile") 40 else 0) + (if (m.state == "discover") 15 else 0) + (1 - m.value) * 10
    } else null
    val prereq = c.accent.copy(alpha = 0.45f)
    val bridge = c.text2.copy(alpha = 0.4f)
    Box(
        modifier.verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState())
            .onGloballyPositioned { origin[0] = it }
            .drawBehind {
                val base = origin[0]?.positionInRoot() ?: Offset.Zero
                fun curve(a: String, b: String, color: androidx.compose.ui.graphics.Color, dashed: Boolean) {
                    val ra = rects[a] ?: return
                    val rb = rects[b] ?: return
                    val p1 = ra.center - base
                    val p2 = rb.center - base
                    val mid = (p1.y + p2.y) / 2
                    val path = Path().apply { moveTo(p1.x, p1.y); cubicTo(p1.x, mid, p2.x, mid, p2.x, p2.y) }
                    drawPath(path, color, style = Stroke(2.dp.toPx(), pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(8f, 6f)) else null))
                }
                g.skills.forEach { s -> s.prereqIds.forEach { p -> curve(p, s.id, prereq, false) } }
                g.bridges.forEach { e -> if (vm.mode == GraphMode.LEARN || vm.selected == e.a || vm.selected == e.b) curve(e.a, e.b, bridge, true) }
            }
            .padding(Space.s4),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Space.s5)) {
            g.subjects.forEach { subject ->
                val skills = g.skills.filter { it.subjectId == subject.id }
                val avg = if (skills.isEmpty()) 0 else (skills.sumOf { masteries[it.id]!!.value } / skills.size * 100).roundToInt()
                Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                        Text(subject.name, color = c.text, fontSize = TextSize.md, fontWeight = FontWeight.SemiBold)
                        Text("$avg%", color = c.text2, fontSize = TextSize.xs)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(Space.s4), verticalAlignment = Alignment.Top) {
                        g.topics.filter { it.subjectId == subject.id }.forEach { topic ->
                            val ts = skills.filter { it.topicId == topic.id }
                            if (ts.isNotEmpty()) Column(
                                Modifier.widthIn(min = 220.dp, max = 420.dp).clip(RoundedCornerShape(Radius.lg)).border(1.dp, c.edgeSoft, RoundedCornerShape(Radius.lg)).padding(Space.s3),
                                verticalArrangement = Arrangement.spacedBy(Space.s3),
                            ) {
                                val tv = (ts.sumOf { masteries[it.id]!!.value } / ts.size * 100).roundToInt()
                                Row { Text(topic.name, Modifier.weight(1f, fill = false), color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold); Text("  $tv%", color = c.text2, fontSize = TextSize.xs) }
                                ts.groupBy { g.level(it) }.entries.sortedByDescending { it.key }.forEach { (_, list) ->
                                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s2), verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                                        list.forEach { s ->
                                            Node(g, s, masteries[s.id]!!, vm, rec?.id == s.id, Modifier.onGloballyPositioned { rects[s.id] = Rect(it.positionInRoot(), it.size.toSize()) })
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Node(g: KnowledgeGraph, s: Skill, m: Mastery, vm: GraphViewModel, recommended: Boolean, modifier: Modifier) {
    val c = Impala.colors
    val subject = g.subjects.firstOrNull { it.id == s.subjectId }?.name.orEmpty()
    val topic = g.topics.firstOrNull { it.id == s.topicId }?.name.orEmpty()
    val q = vm.query.lowercase()
    val dim = q.isNotEmpty() && !listOf(s.title, s.description, subject, topic).joinToString(" ").lowercase().contains(q)
    val ring = when (m.state) { "mastered" -> c.success; "fragile" -> c.warn; "gap" -> c.text2.copy(alpha = 0.4f); else -> c.accent }
    val selected = vm.selected == s.id
    Row(
        modifier.alpha(if (dim) 0.35f else 1f).widthIn(max = 260.dp).clip(RoundedCornerShape(Radius.md))
            .background(if (selected) c.tint2 else c.surface)
            .border(if (selected) 2.dp else 1.dp, if (selected) c.accent else if (s.gap) c.edge else c.edgeSoft, RoundedCornerShape(Radius.md))
            .clickable { vm.tap(s.id) }.padding(horizontal = Space.s3, vertical = Space.s2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        Box(
            Modifier.size(18.dp).drawBehind {
                drawCircle(ring.copy(alpha = 0.2f), style = Stroke(3.dp.toPx()))
                drawArc(ring, -90f, (m.value * 360).toFloat(), false, style = Stroke(3.dp.toPx()))
            },
        )
        Column {
            Text(s.title, color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.Medium, maxLines = 2)
            Text(m.label + if (s.gap) " · keine Karten" else " · ${m.cards} Karten", color = c.text2, fontSize = TextSize.xs2)
            if (recommended) Text("Nächster Schritt", color = c.accent, fontSize = TextSize.xs2, fontWeight = FontWeight.SemiBold)
        }
    }
}
