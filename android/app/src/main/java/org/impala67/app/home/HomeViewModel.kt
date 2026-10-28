package org.impala67.app.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.study.LearningTime
import org.json.JSONObject
import uniffi.impala_ffi.CardInfo
import uniffi.impala_ffi.CardStage
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.markdownCardText
import uniffi.impala_ffi.markdownExcerpt
import uniffi.impala_ffi.markdownPlainText
import uniffi.impala_ffi.markdownTeaser
import java.time.LocalDate
import java.util.TimeZone

/** Sammelt die Daten der Startseite (in der PWA: `renderHome` in render.js). */
class HomeViewModel(private val store: ImpalaStore, private val prefs: DevicePrefs) : ViewModel() {
    private val pages = store.query(Touches.pages) { core ->
        val active = core.recentPages(UInt.MAX_VALUE)
        Pages(active.firstOrNull()?.let { continueItem(core, it) }, active.filter { it.favorite }.take(6), core.conflictCount().toInt())
    }
    private val cards = store.query(Touches.cards) { core ->
        val queue = core.studyQueue(null, utcOffsetMinutes(), false)
        val all = core.decks().flatMap { core.cardsInDeck(it.name) }.filter { !it.trashed && !it.archived }
        Cards((queue.new + queue.review + queue.learn).toInt(), all.isNotEmpty(), recall(all))
    }
    private val learning = store.query(Touches.learning) { LearningTime(it.learningSessions()) }
    private val articles = store.query(Touches.any(Touches.articles, Touches.settings)) { core ->
        val settings = runCatching { JSONObject(core.settingsJson()) }.getOrDefault(JSONObject())
        val name = settings.optString("homeUserName").trim()
        val list = if (settings.optBoolean("homeArticle", true)) core.homeArticles(30u) else emptyList()
        name to list.firstOrNull()
            ?.takeIf { it.readAt == null || it.day == LocalDate.now().toString() }
            ?.let { ArticleState(it, markdownTeaser(it.body), markdownPlainText(it.body), list.size) }
    }

    /** Alle Tagesartikel, neueste zuerst (Verlauf). */
    val history: StateFlow<List<uniffi.impala_ffi.HomeArticleInfo>?> = store.query(Touches.articles) { it.homeArticles(30u) }

    /** Neu zeichnen, wenn die Uhr Begrüßung, Datum oder „vor x Min.“ ändert. */
    private val minute = flow { while (true) { emit(System.currentTimeMillis()); delay(60_000) } }

    val state: StateFlow<HomeState?> = combine(
        pages.filterNotNull(), cards.filterNotNull(), learning.filterNotNull(), articles.filterNotNull(),
        combine(prefs.weekGoalMinutes, minute) { goal, _ -> goal },
    ) { p, c, l, (name, article), goal ->
        HomeState(
            dateLine = HomeText.dateLine(), greeting = HomeText.greeting(), name = name,
            conflictCount = p.conflicts, last = p.last, pins = p.pins,
            open = c.open, hasCards = c.hasCards,
            todaySeconds = l.seconds(LocalDate.now()), week = l.week(), goalMin = goal, streak = l.streakDays(),
            recall = c.recall, article = article,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun cycleGoal(done: (Int) -> Unit) = viewModelScope.launch { done(prefs.cycleWeekGoal()) }

    fun markArticleRead(id: String) = viewModelScope.launch { store.write { it.markHomeArticleRead(id) } }

    private data class Pages(val last: ContinueItem?, val pins: List<uniffi.impala_ffi.PageSummary>, val conflicts: Int)
    private data class Cards(val open: Int, val hasCards: Boolean, val recall: Recall?)

    private companion object {
        val CLOZE = Regex("""\{\{c\d+::(.*?)(?:::[^}]*)?\}\}""")

        fun utcOffsetMinutes() = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000

        fun continueItem(core: ImpalaCore, page: uniffi.impala_ffi.PageSummary): ContinueItem {
            val heft = page.kind == PageKind.HEFT
            val excerpt = if (heft) emptyList() else markdownExcerpt(page.title, core.page(page.id)?.content.orEmpty())
            return ContinueItem(page, excerpt, if (heft) core.heftPageIds(page.id).size else 0)
        }

        /** Täglich eine andere schon gelernte Karte (nur zum Aufdecken, der Lernplan bleibt unberührt). */
        fun recall(cards: List<CardInfo>): Recall? {
            val pool = cards.filter { !it.suspended && it.stage == CardStage.REVIEW && markdownCardText(it.front).length >= 3 }
            if (pool.size < 5) return null
            val offset = TimeZone.getDefault().getOffset(System.currentTimeMillis())
            val day = (System.currentTimeMillis() + offset) / 86_400_000L
            val card = pool[(((day * 2654435761L) and 0xFFFFFFFFL) % pool.size).toInt()]
            val cloze = CLOZE.containsMatchIn(card.front)
            val question = markdownCardText(if (cloze) card.front.replace(CLOZE, "＿＿＿") else card.front)
            val answer = if (cloze) CLOZE.findAll(card.front).joinToString(" · ") { markdownCardText(it.groupValues[1]) }
            else markdownCardText(card.back)
            if (answer.isEmpty()) return null
            return Recall(card.id, HomeText.cut(question, 140), HomeText.cut(answer, 220))
        }
    }
}
