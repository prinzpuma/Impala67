package org.impala67.app.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.components.PanelCard
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space

/**
 * Abschnittsliste der Einstellungen (`SETTINGS_SECTIONS` der PWA). Die Shell entscheidet, ob sie
 * allein steht (Telefon) oder neben [SettingsSection] (Tablet, Liste + Detail).
 */
@Composable
fun SettingsSections(onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().background(Impala.colors.panel)
            .verticalScroll(rememberScrollState()).padding(horizontal = Space.s4, vertical = Space.s2),
    ) {
        PanelCard(Modifier.fillMaxWidth()) {
            SettingsSectionInfo.entries.forEach { section ->
                SettingsLinkRow(section.label, section.description, section.icon) { onOpen(section.id) }
            }
        }
    }
}

/**
 * Detailseite eines Abschnitts (`renderSettingsPage` der PWA). [section] ist die ID aus [SettingsSections];
 * unbekannte IDs zeigen die Übersicht. Meldungen wie „Name gespeichert.“ gehen an [toast].
 */
@Composable
fun SettingsSection(
    section: String,
    store: ImpalaStore,
    prefs: DevicePrefs,
    toast: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val vm: SettingsViewModel = viewModel { SettingsViewModel(store, prefs) }
    LaunchedEffect(vm) { vm.messages.collect { toast(it) } }
    val info = SettingsSectionInfo.resolve(section)
    Column(
        modifier.fillMaxSize().background(Impala.colors.panel)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Space.s4).padding(top = Space.s4, bottom = Space.s8),
    ) {
        Text(info.pageTitle, style = MaterialTheme.typography.headlineMedium)
        Text(
            info.pageSubtitle, style = MaterialTheme.typography.bodyMedium, color = Impala.colors.text2,
            modifier = Modifier.padding(top = Space.s1, bottom = Space.s4),
        )
        when (info) {
            SettingsSectionInfo.OVERVIEW -> OverviewSettings()
            SettingsSectionInfo.APPEARANCE -> AppearanceSettings(vm, prefs)
            SettingsSectionInfo.AI -> AiSettings(vm)
            SettingsSectionInfo.LEARNING -> LearningSettings(vm, prefs)
            SettingsSectionInfo.SYNC -> SyncSettings()
            SettingsSectionInfo.APP -> AppSettings(vm, prefs)
        }
    }
}
