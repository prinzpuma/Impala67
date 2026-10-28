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
@Serializable data class SettingsRoute(val section: String? = null) : NavKey
@Serializable data object ConflictsRoute : NavKey

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
    StudyRoute -> TopLevel.Study
    MoreRoute, is SettingsRoute, ConflictsRoute -> TopLevel.More
    else -> TopLevel.Home
}
