package org.impala67.app.study

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space

/**
 * Lernmodus (`ankiStudyHtml` in web/render-anki.js): Frage → „Antwort zeigen“ → Antwort und vier
 * Bewertungen mit den Intervallen des Kerns. [deck] `null` lernt alle Stapel, [mix] mischt die fälligen
 * Karten aller Stapel. [onExit] führt zurück zur Stapelübersicht.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ReviewScreen(store: ImpalaStore, deck: String?, onExit: () -> Unit, modifier: Modifier = Modifier, mix: Boolean = false) {
    val vm = viewModel(key = "review:$deck:$mix") { ReviewViewModel(store, deck, mix) }
    val state by vm.state.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val haptics = LocalHapticFeedback.current
    var editing by remember { mutableStateOf(false) }
    var options by remember { mutableStateOf(false) }
    BackHandler(onBack = onExit)

    val s = state
    Column(modifier.fillMaxSize().background(Impala.colors.panel)) {
        ReviewHeader(deck, mix, s?.canUndo == true, onExit, vm::undo)
        if (s == null) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { LoadingIndicator() }
            return@Column
        }
        val progress by animateFloatAsState(
            if (s.total == 0) 1f else 1f - s.remaining / s.total.toFloat(), MaterialTheme.motionScheme.slowSpatialSpec(), label = "progress",
        )
        LinearProgressIndicator(
            progress = { progress.coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = Space.s4).height(6.dp),
            color = Impala.colors.accent, trackColor = Impala.colors.text.copy(alpha = 0.08f),
            strokeCap = StrokeCap.Round, gapSize = 0.dp, drawStopIndicator = {},
        )
        val card = s.card
        if (card == null) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                ReviewDone(s.queue, onRecheck = { vm.refresh(unpin = true) }, onExit = onExit)
            }
            return@Column
        }
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = Space.s5, vertical = Space.s4),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 640.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s3)) {
                CardMeta(card)
                CardFace("Frage", card.front, back = false)
                if (s.showBack) {
                    AnswerDivider()
                    CardFace("Rückseite", card.back, back = true)
                }
            }
        }
        Column(
            Modifier.fillMaxWidth().padding(horizontal = Space.s4).padding(bottom = Space.s2).widthIn(max = 640.dp).align(Alignment.CenterHorizontally),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s3),
        ) {
            QueueCounts(s.queue)
            if (s.showBack) {
                GradeButtons(s.preview) { g ->
                    haptics.performHapticFeedback(if (g == 1) HapticFeedbackType.Reject else HapticFeedbackType.Confirm)
                    vm.grade(g)
                }
            } else {
                RevealButton {
                    haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                    vm.reveal()
                }
            }
            StudyFooter(onEdit = { editing = true }, onSuspend = vm::suspend, onOptions = { options = true })
        }
        if (editing) CardEditorSheet(store, card.id, card.deck, onDismiss = { editing = false }, onSaved = { vm.refresh(showBack = s.showBack) })
        if (options) DeckConfigDialog(store, card.deck) { options = false }
    }
    error?.let { ErrorDialog(it, vm::dismissError) }
}
