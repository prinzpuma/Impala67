package org.impala67.app.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize

/**
 * Einstellungen auf dem Tablet als Fenster wie `.settings-modal-v2` der PWA: höchstens 980 × 720 dp,
 * links die Bereiche (`.settings-sidebar`, 252 dp), rechts die gewählte Seite, oben rechts ×.
 */
@Composable
fun SettingsDialog(
    section: String,
    store: ImpalaStore,
    prefs: DevicePrefs,
    onSection: (String) -> Unit,
    onDismiss: () -> Unit,
    toast: (String) -> Unit,
) {
    val c = Impala.colors
    val active = SettingsSectionInfo.resolve(section)
    // Dialoge erben keine Inhaltsfarbe: Texte ohne eigene Farbe wären sonst schwarz.
    Dialog(onDismiss, DialogProperties(usePlatformDefaultWidth = false)) { CompositionLocalProvider(LocalContentColor provides c.text) {
        Box(
            Modifier.padding(24.dp).widthIn(max = 980.dp).heightIn(max = 720.dp).fillMaxSize()
                .clip(RoundedCornerShape(Radius.xl)).background(c.panel),
        ) {
            Row(Modifier.fillMaxSize()) {
                Column(
                    Modifier.width(252.dp).fillMaxHeight().background(c.surfaceSubtle).padding(horizontal = 12.dp, vertical = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(
                        "Einstellungen", Modifier.padding(start = 10.dp, end = 10.dp, bottom = 14.dp),
                        fontSize = TextSize.md, fontWeight = FontWeight.Bold, color = c.text,
                    )
                    SettingsSectionInfo.entries.forEach { info ->
                        NavItem(info, info == active) { onSection(info.id) }
                    }
                }
                SettingsSection(
                    active.id, store, prefs, toast, Modifier.weight(1f),
                    contentPadding = PaddingValues(start = 48.dp, end = 48.dp, top = 38.dp, bottom = 48.dp),
                    onOpen = onSection,
                )
            }
            Box(
                Modifier.align(Alignment.TopEnd).padding(top = 12.dp, end = 14.dp).size(32.dp).clip(RoundedCornerShape(50))
                    .clickable(onClickLabel = "Schließen", role = Role.Button, onClick = onDismiss),
                contentAlignment = Alignment.Center,
            ) { Icon(painterResource(R.drawable.ic_i_x), "Schließen", Modifier.size(16.dp), tint = c.text2) }
        }
    } }
}

/** `.settings-nav-item`: 40 dp hoch, aktiv mit Akzent-Tönung, Icon in Akzentfarbe. */
@Composable
private fun NavItem(info: SettingsSectionInfo, active: Boolean, onClick: () -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(Radius.md))
            .background(if (active) c.tint2 else Color.Transparent)
            .clickable(role = Role.Tab, onClick = onClick).padding(horizontal = 9.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(painterResource(info.icon), null, Modifier.size(17.dp), tint = if (active) c.accent else c.text2)
        Text(info.label, fontSize = TextSize.base, fontWeight = FontWeight.SemiBold, color = if (active) c.text else c.text2)
    }
}
