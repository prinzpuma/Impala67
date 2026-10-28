package org.impala67.app.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.ui.components.PanelCard
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space

/** Gruppe wie `UI.group` der PWA: Überschrift über einer Karte, optional mit Fußnote. */
@Composable
fun SettingsGroup(title: String, footnote: String? = null, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(bottom = Space.s6), verticalArrangement = Arrangement.spacedBy(Space.s2)) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = Impala.colors.text2, modifier = Modifier.padding(horizontal = Space.s1))
        PanelCard(Modifier.fillMaxWidth()) { content() }
        footnote?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Impala.colors.text2, modifier = Modifier.padding(horizontal = Space.s1)) }
    }
}

/** Zeile mit Schalter (`switchControl` der PWA). */
@Composable
fun SettingsSwitchRow(title: String, description: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    ListItem(
        supportingContent = if (description != null) { { Text(description) } } else null,
        trailingContent = { Switch(checked = checked, onCheckedChange = onChange) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    ) { Text(title) }
}

/** Zeile mit frei wählbarem Inhalt rechts (Auswahl, Schaltfläche, Wert). */
@Composable
fun SettingsRow(title: String, description: String?, trailing: (@Composable () -> Unit)? = null) {
    ListItem(
        supportingContent = if (description != null) { { Text(description) } } else null,
        trailingContent = trailing,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    ) { Text(title) }
}

/** Zeile zum Öffnen eines Bereichs (Übersichtsliste, „Verwalten“). */
@Composable
fun SettingsLinkRow(title: String, description: String?, icon: Int? = null, onClick: () -> Unit) {
    ListItem(
        modifier = Modifier.clickable(role = Role.Button, onClick = onClick),
        supportingContent = if (description != null) { { Text(description) } } else null,
        leadingContent = if (icon != null) {
            { Icon(painterResource(icon), contentDescription = null, tint = Impala.colors.text2) }
        } else null,
        trailingContent = { Icon(painterResource(R.drawable.ic_i_chevron_right), contentDescription = null, tint = Impala.colors.text2) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    ) { Text(title) }
}

/**
 * Platzhalter für Bereiche, die erst mit ihrem Modul kommen (Sync, KI-Modelle, Speicher …).
 * Sichtbar und beschriftet, aber ohne Funktion.
 */
@Composable
fun SettingsPlaceholderRow(title: String, hint: String) {
    ListItem(
        supportingContent = { Text(hint) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    ) { Text(title, color = Impala.colors.text2) }
}

/** Kreis-Auswahlpunkt für Akzentfarben (`.settings-accents` der PWA). */
@Composable
fun AccentSwatch(color: AccentColor, selected: Boolean, label: String, onSelect: () -> Unit) {
    val ring = if (selected) Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier
    Box(
        Modifier
            .size(44.dp)
            .padding(4.dp)
            .clip(CircleShape)
            .background(Color(color.swatch))
            .then(ring)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onSelect)
            .semantics { contentDescription = label },
    )
}
