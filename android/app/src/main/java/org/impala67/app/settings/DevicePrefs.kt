package org.impala67.app.settings

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore("device")

/**
 * Einstellungen nur für dieses Gerät (in der PWA: localStorage). Was auf allen Geräten gelten soll,
 * liegt in den Kern-Einstellungen (`settingsJson` / `updateSettings`).
 */
class DevicePrefs(private val context: Context) {
    /** Wochenziel in Minuten (lernzeit.js `weekGoalMinutes`), mindestens 30, sonst 300. */
    val weekGoalMinutes: Flow<Int> = context.dataStore.data.map { (it[WEEK_GOAL] ?: 300).coerceAtLeast(30) }

    /** Nächste Stufe wie `cycleGoal` in lernzeit.js. Liefert das neue Ziel. */
    suspend fun cycleWeekGoal(): Int {
        var next = 0
        context.dataStore.edit {
            val now = (it[WEEK_GOAL] ?: 300).coerceAtLeast(30)
            next = GOAL_PRESETS[(GOAL_PRESETS.indexOf(now) + 1) % GOAL_PRESETS.size]
            it[WEEK_GOAL] = next
        }
        return next
    }

    private companion object {
        val WEEK_GOAL = intPreferencesKey("weekGoalMinutes")
        val GOAL_PRESETS = listOf(120, 300, 480, 720)
    }
}
