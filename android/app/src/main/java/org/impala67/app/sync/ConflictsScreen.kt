package org.impala67.app.sync

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.components.TintLabel
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.ConflictInfo

/** Ab dieser Breite stehen Liste und Konflikt nebeneinander (`min-width: 760px` der PWA, hier Tablet). */
private val WIDE = 600.dp

/**
 * Sync-Konflikte (web/conflict-ui.js, Dialog `conflict-modal`): Liste der offenen Konflikte, je Konflikt
 * Gegenüberstellung und Entscheidungen, „Alle … mit Empfehlung lösen“. Ohne Konflikte nach der letzten
 * Entscheidung ruft die Shell [onDone] auf.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ConflictsScreen(store: ImpalaStore, onDone: () -> Unit, modifier: Modifier = Modifier) {
    val vm = viewModel { ConflictsViewModel(store) }
    val items by vm.conflicts.collectAsStateWithLifecycle()
    val list = items
    if (list == null) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
        return
    }
    var resolvedOne by rememberSaveable { mutableStateOf(false) }
    if (list.isEmpty()) {
        if (resolvedOne) LaunchedEffect(Unit) { onDone() }
        else EmptyState(modifier, onDone)
        return
    }

    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var index by rememberSaveable { mutableIntStateOf(0) }
    var confirmBulk by rememberSaveable { mutableStateOf(false) }
    val i = index.coerceIn(0, list.lastIndex)
    val current = list[i]
    val copyText by produceState("", current.key, current.copyPageId) { value = vm.copyText(current.copyPageId) }
    val bulkN = list.count { it.recommended != null }

    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }

    fun choose(action: ConflictAction) {
        scope.launch { if (vm.resolve(current, action.resolution)) resolvedOne = true }
    }

    BoxWithConstraints(modifier.fillMaxSize().background(Impala.colors.panel)) {
        val wide = maxWidth >= WIDE
        Column(Modifier.fillMaxSize()) {
            Header(
                count = list.size, index = i, bulkN = bulkN, wide = wide,
                onPrev = { index = (i - 1 + list.size) % list.size },
                onNext = { index = (i + 1) % list.size },
                onBulk = { confirmBulk = true },
                onClose = onDone,
            )
            Row(Modifier.fillMaxWidth().weight(1f)) {
                if (wide) {
                    ConflictList(list, i, { index = it }, Modifier.width(240.dp).fillMaxHeight())
                    VerticalDivider()
                }
                ConflictDetail(
                    c = current, index = i, count = list.size, copyText = copyText, wide = wide,
                    onChoose = ::choose,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(Space.s4))
    }

    if (confirmBulk) {
        AlertDialog(
            onDismissRequest = { confirmBulk = false },
            title = { Text("Alle $bulkN Konflikte lösen?") },
            text = {
                Text("Bei $bulkN Konflikten wird die Empfehlung übernommen. Die jeweils andere Fassung landet im Papierkorb und lässt sich dort wiederherstellen.")
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmBulk = false
                    scope.launch {
                        val result = vm.resolveRecommended()
                        val done = result.resolved.toInt()
                        if (done > 0) resolvedOne = true
                        if (done > 0) snackbar.showSnackbar("$done ${if (done == 1) "Konflikt" else "Konflikte"} gelöst.")
                        if (result.error != null) snackbar.showSnackbar(ConflictText.BULK_FAILED)
                    }
                }) { Text("Mit Empfehlung lösen") }
            },
            dismissButton = { TextButton(onClick = { confirmBulk = false }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun EmptyState(modifier: Modifier, onDone: () -> Unit) {
    Column(
        modifier.fillMaxSize().padding(Space.s5),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Keine offenen Konflikte.", fontSize = TextSize.base, color = Impala.colors.text2)
        Box(Modifier.padding(top = Space.s4)) { TintButton(onDone) { TintLabel("Schließen") } }
    }
}

/** Kopfzeile: Titel, „Alle … lösen“, auf dem Telefon ‹ 1 / 3 ›, Schließen. */
@Composable
private fun Header(
    count: Int,
    index: Int,
    bulkN: Int,
    wide: Boolean,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onBulk: () -> Unit,
    onClose: () -> Unit,
) {
    val c = Impala.colors
    Row(
        Modifier.fillMaxWidth().padding(start = Space.s4, end = Space.s2, top = Space.s2, bottom = Space.s2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        Icon(painterResource(R.drawable.ic_i_alert), null, Modifier.size(18.dp), tint = c.warn)
        Text(
            ConflictText.TITLE, fontSize = TextSize.md, fontWeight = FontWeight.SemiBold,
            maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
        )
        if (bulkN >= 2) {
            TintButton(onBulk, strong = true, height = 40.dp) {
                TintLabel(ConflictText.BULK_BUTTON_PREFIX + bulkN + ConflictText.BULK_BUTTON_SUFFIX, strong = true)
            }
        }
        if (!wide && count > 1) {
            IconButton(onPrev, shapes = IconButtonDefaults.shapes()) {
                Icon(painterResource(R.drawable.ic_i_chevron_left), "Vorheriger Konflikt", tint = c.text2)
            }
            Text("${index + 1} / $count", fontSize = TextSize.sm, color = c.text2)
            IconButton(onNext, shapes = IconButtonDefaults.shapes()) {
                Icon(painterResource(R.drawable.ic_i_chevron_right), "Nächster Konflikt", tint = c.text2)
            }
        }
        IconButton(onClose, shapes = IconButtonDefaults.shapes()) {
            Icon(painterResource(R.drawable.ic_i_x), "Schließen", tint = c.text2)
        }
    }
}

/** Liste der offenen Konflikte (breite Ansicht). */
@Composable
private fun ConflictList(list: List<ConflictInfo>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier) {
    LazyColumn(modifier.padding(Space.s2), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        itemsIndexed(list, key = { _, c -> c.key }) { k, c ->
            ListRow(c, active = k == selected) { onSelect(k) }
        }
    }
}

@Composable
private fun ListRow(c: ConflictInfo, active: Boolean, onClick: () -> Unit) {
    val colors = Impala.colors
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp),
        shape = RoundedCornerShape(Radius.md),
        color = if (active) colors.tint2 else colors.panel,
    ) {
        Column(Modifier.padding(horizontal = Space.s3, vertical = Space.s2)) {
            Text(c.title, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(ConflictText.kindLabel(c), fontSize = TextSize.xs3, color = colors.text2)
            Text(ConflictText.time(c.time), fontSize = TextSize.xs3, color = colors.text2)
        }
    }
}

/** Detail des gewählten Konflikts: Titel, Erklärung, Gegenüberstellung, Entscheidungen. */
@Composable
private fun ConflictDetail(
    c: ConflictInfo,
    index: Int,
    count: Int,
    copyText: String,
    wide: Boolean,
    onChoose: (ConflictAction) -> Unit,
    modifier: Modifier,
) {
    val colors = Impala.colors
    val actions = remember(c) { ConflictText.actions(c) }
    var more by rememberSaveable(c.key) { mutableStateOf(false) }
    Column(
        modifier.verticalScroll(rememberScrollState()).padding(horizontal = Space.s4, vertical = Space.s3),
        verticalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        Text("Konflikt ${index + 1} von $count · ${ConflictText.kindLabel(c)}", fontSize = TextSize.xs, color = colors.text2)
        Text(c.title, style = MaterialTheme.typography.titleLarge, overflow = TextOverflow.Ellipsis)
        Text(ConflictText.explain(c), fontSize = TextSize.base, color = colors.text2, lineHeight = 21.sp)
        c.reason?.let { reason ->
            TextButton({ more = !more }) { Text(if (more) "Weniger dazu" else "Mehr dazu", fontSize = TextSize.sm) }
            if (more) Text(reason, fontSize = TextSize.sm, color = colors.text2, lineHeight = 21.sp)
        }
        ConflictCompare(c, copyText)
        if (wide) {
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                actions.forEach { a -> ActionCard(a, Modifier.weight(1f)) { onChoose(a) } }
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                actions.forEach { a -> ActionCard(a, Modifier.fillMaxWidth()) { onChoose(a) } }
            }
        }
    }
}

/** Entscheidungskarte (`cf-action`): Empfohlene mit Akzent-Tönung und Badge. */
@Composable
private fun ActionCard(a: ConflictAction, modifier: Modifier, onClick: () -> Unit) {
    val c = Impala.colors
    Surface(
        onClick = onClick,
        modifier = modifier.heightIn(min = 44.dp),
        shape = RoundedCornerShape(Radius.lg),
        color = if (a.recommended) c.tint else c.surface,
        border = BorderStroke(1.dp, if (a.recommended) c.accentBorder else c.edge),
    ) {
        Column(Modifier.padding(horizontal = Space.s3, vertical = Space.s3), verticalArrangement = Arrangement.spacedBy(Space.s1)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                Text(a.title, fontSize = TextSize.base, fontWeight = FontWeight.SemiBold, color = c.text)
                if (a.recommended && a.badge != null) {
                    Text(
                        a.badge, fontSize = TextSize.xs2, fontWeight = FontWeight.SemiBold, color = c.onAccent,
                        modifier = Modifier.clip(CircleShape).background(c.accent).padding(horizontal = Space.s2, vertical = 2.dp),
                    )
                }
            }
            Text(a.sub, fontSize = TextSize.xs, color = c.text2, lineHeight = 17.sp)
        }
    }
}
