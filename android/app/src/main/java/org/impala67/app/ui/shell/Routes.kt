package org.impala67.app.ui.shell

import androidx.annotation.DrawableRes
import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable
import org.impala67.app.R

/** Ziele der App (Navigation 3). Serialisierbar, damit der Back-Stack Prozess-Neustarts übersteht. */
@Serializable data object HomeRoute : NavKey
@Serializable data object NotesRoute : NavKey
@Serializable data class PageRoute(val id: String) : NavKey
@Serializable data object StudyRoute : NavKey
@Serializable data object MoreRoute : NavKey
@Serializable data object SearchRoute : NavKey
@Serializable data object AiRoute : NavKey
@Serializable data object SettingsRoute : NavKey
@Serializable data class SettingsSectionRoute(val section: String) : NavKey
@Serializable data object ConflictsRoute : NavKey
@Serializable data object TrashRoute : NavKey
@Serializable data class ReviewRoute(val deck: String? = null, val mix: Boolean = false) : NavKey
@Serializable data class CardBrowserRoute(val deck: String? = null) : NavKey
@Serializable data object ArchiveRoute : NavKey

/** Hauptbereiche wie das Mobil-Dock der PWA (mobile-view.js): Start, Notizen, Lernen, Mehr. */
enum class TopLevel(val route: NavKey, val label: String, @DrawableRes val icon: Int) {
    Home(HomeRoute, "Start", R.drawable.ic_i_home),
    Notes(NotesRoute, "Notizen", R.drawable.ic_i_note),
    Study(StudyRoute, "Lernen", R.drawable.ic_i_cards),
    More(MoreRoute, "Mehr", R.drawable.ic_i_grid),
}

/** Zu welchem Hauptbereich ein Ziel gehört (markiert den Eintrag in Leiste/Schiene). */
fun NavKey.topLevel(): TopLevel = when (this) {
    NotesRoute, is PageRoute -> TopLevel.Notes
    StudyRoute, is ReviewRoute, is CardBrowserRoute -> TopLevel.Study
    MoreRoute, SettingsRoute, is SettingsSectionRoute, ConflictsRoute, TrashRoute, ArchiveRoute -> TopLevel.More
    else -> TopLevel.Home
}

/** Titel in der oberen Leiste. */
fun NavKey.title(): String = when (this) {
    SearchRoute -> "Suche"
    AiRoute -> "KI-Assistent"
    SettingsRoute, is SettingsSectionRoute -> "Einstellungen"
    ConflictsRoute -> "Sync-Konflikte"
    TrashRoute -> "Papierkorb"
    ArchiveRoute -> "Archiv"
    is CardBrowserRoute -> "Karten"
    else -> topLevel().label
}
