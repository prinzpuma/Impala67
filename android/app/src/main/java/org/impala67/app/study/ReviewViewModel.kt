package org.impala67.app.study

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import uniffi.impala_ffi.CardInfo
import uniffi.impala_ffi.StudyQueue

/** Stand des Lernmodus. [total] ist die größte offene Kartenzahl dieser Sitzung (für den Fortschritt). */
data class ReviewState(
    val queue: StudyQueue,
    val card: CardInfo?,
    val preview: List<String>,
    val showBack: Boolean,
    val total: Int,
    val canUndo: Boolean,
) {
    val remaining: Int get() = (queue.new + queue.learn + queue.review).toInt()
}

/**
 * Lernmodus (`ankiStudyHtml` in render-anki.js, Bewerten in app-click-anki.js). Planung und Intervalle
 * liefert der Kern: `studyQueue`, `reviewPreview`, `reviewCard`. Die Karte bleibt bis zur Bewertung
 * festgepinnt, auch wenn sich die Warteschlange ändert (kein Wechsel mitten im Nachdenken).
 */
class ReviewViewModel(
    private val store: ImpalaStore,
    private val deck: String?,
    private val mix: Boolean,
    private val telemetry: () -> Boolean = { true },
) : ViewModel() {
    private val _state = MutableStateFlow<ReviewState?>(null)
    val state: StateFlow<ReviewState?> = _state.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private var pinned: String? = null
    private var busy = false
    /** Für die Lern-Telemetrie (telemetrie.js): wann die Frage erschien, wann aufgedeckt, wievielte Karte. */
    private var shownCard: String? = null
    private var shownAt = 0L
    private var revealedAt = 0L
    private var graded = 0

    init { refresh() }

    fun dismissError() { _error.value = null }

    /** Warteschlange neu lesen; `unpin` wählt die nächste fällige Karte statt der angezeigten. */
    fun refresh(unpin: Boolean = false, showBack: Boolean = false) {
        if (unpin) pinned = null
        viewModelScope.launch {
            val old = _state.value
            _state.value = store.write { core ->
                val queue = core.studyQueue(deck, utcOffsetMinutes(), mix)
                val keep = pinned?.let { id -> core.card(id)?.takeIf { !it.trashed && !it.suspended && !it.archived } }
                val card = keep ?: queue.dueNow.firstOrNull()
                pinned = card?.id
                val remaining = (queue.new + queue.learn + queue.review).toInt()
                if (card?.id != shownCard) { shownCard = card?.id; shownAt = System.currentTimeMillis(); revealedAt = 0 }
                ReviewState(
                    queue, card, card?.let { core.reviewPreview(it.id) }.orEmpty(),
                    showBack && card != null && card.id == keep?.id,
                    maxOf(old?.total ?: 0, remaining), core.canUndoReview(),
                )
            }
        }
    }

    fun reveal() {
        if (revealedAt == 0L) revealedAt = System.currentTimeMillis()
        _state.value = _state.value?.takeIf { it.card != null }?.copy(showBack = true)
    }

    /** `review`-Telemetrie wie `TELE` in der PWA: Denkzeit, Bewertungszeit, Position, Uhrzeit (nur wenn aufzeichnen an). */
    private suspend fun logReview(card: CardInfo, grade: Int) {
        if (!telemetry()) return
        val now = System.currentTimeMillis()
        val revealed = if (revealedAt > 0) revealedAt else now
        val clamp = { ms: Long -> ms.coerceIn(0, 300_000) }
        val at = java.time.LocalDateTime.now()
        runCatching {
            store.dispatch(
                "teleEvent",
                mapOf(
                    "id" to java.util.UUID.randomUUID().toString(),
                    "kind" to "review",
                    "data" to mapOf(
                        "reviewId" to java.util.UUID.randomUUID().toString(), "cardId" to card.id, "deck" to card.deck,
                        "grade" to grade, "thinkMs" to clamp(revealed - shownAt), "gradeMs" to clamp(now - revealed),
                        "pos" to graded, "hour" to at.hour, "dow" to at.dayOfWeek.value % 7, "typed" to false,
                        "distracted" to false, "timer" to false,
                    ),
                ),
            )
        }
        graded++
    }

    /** Bewertung 1 = Nochmal … 4 = Einfach. */
    fun grade(grade: Int) {
        val card = _state.value?.card ?: return
        if (busy) return
        busy = true
        viewModelScope.guarded(_error) {
            try {
                store.write { it.reviewCard(card.id, grade.toUByte()) }
                logReview(card, grade)
                refresh(unpin = true)
            } finally {
                busy = false
            }
        }
    }

    fun suspend() {
        val card = _state.value?.card ?: return
        viewModelScope.guarded(_error) {
            store.write { it.setCardSuspended(card.id, true) }
            refresh(unpin = true)
        }
    }

    /** Letzte Bewertung zurücknehmen; die Karte kommt wieder, Rückseite verdeckt. */
    fun undo() {
        viewModelScope.guarded(_error) {
            val id = store.write { it.undoReview() }
            if (id != null) pinned = id
            refresh()
        }
    }
}
