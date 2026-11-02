package org.impala67.app.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import uniffi.impala_ffi.AiModel

/** Voreinstellungen der Schnell-Schaltflächen (extras.js `data-provpreset`). */
private val PROVIDER_PRESETS = listOf(
    AiProvider("cloudflare", "Impala AI", "https://impala67-sync.joshuagayer1.workers.dev", ""),
    AiProvider("local", "Lokal (LM Studio)", "http://localhost:1234/v1", ""),
    AiProvider("google", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", ""),
    AiProvider("openai", "OpenAI", "https://api.openai.com/v1", ""),
)
private val PRESET_LABELS = mapOf("cloudflare" to "Impala AI", "local" to "LM Studio", "google" to "Gemini", "openai" to "OpenAI")

/**
 * „Aktives Modell“ (settings-renderer.js `aiModelsGroup` + `renderSettingsModelList`): Modelle aller
 * Quellen, nach Quelle gruppiert und durchsuchbar; darunter die manuelle Modell-ID.
 */
@Composable
fun AiModelsGroup(vm: SettingsViewModel, s: SettingsValues) {
    val list by vm.models.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    LaunchedEffect(vm) { if (list.models.isEmpty()) vm.loadModels() }
    val activeId = s.providerId.ifEmpty { s.providers.firstOrNull()?.id.orEmpty() }
    val nameOf = { id: String -> s.providers.firstOrNull { it.id == id }?.name?.ifEmpty { id } ?: id }

    SettingsGroup("Aktives Modell") {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s3),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StatusDot(if (s.model.isNotEmpty()) Impala.colors.accent else Impala.colors.warn)
            Column(Modifier.weight(1f).padding(start = Space.s3)) {
                Text(s.model.ifEmpty { "Kein Modell gewählt" }, style = MaterialTheme.typography.titleSmall)
                Text(
                    if (s.model.isNotEmpty()) nameOf(activeId) else "Wähle ein verfügbares Chat-Modell",
                    style = MaterialTheme.typography.bodySmall, color = Impala.colors.text2,
                )
            }
            OutlinedButton(enabled = !list.loading, onClick = vm::loadModels) { Text(if (list.loading) "Lädt …" else "Neu laden") }
        }
        val q = query.trim().lowercase()
        val hits = list.models.filter { q.isEmpty() || "${it.id} ${nameOf(it.providerId)}".lowercase().contains(q) }
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Modelle durchsuchen …") },
            supportingText = { Text(if (q.isEmpty()) "${list.models.size} Modelle" else "${hits.size} von ${list.models.size}") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s1),
        )
        list.error?.let { Hint(it) }
        // Aktuelles Modell ohne Live-Treffer trotzdem anbieten („Gespeichert“).
        val saved = s.model.takeIf { m -> m.isNotEmpty() && list.models.none { it.providerId == activeId && it.id == m } }
            ?.let { AiModel(it, activeId) }
        val groups = s.providers.map { p -> p.name.ifEmpty { p.id } to hits.filter { it.providerId == p.id } } +
            listOfNotNull(saved?.takeIf { q.isEmpty() }?.let { "Gespeichert" to listOf(it) })
        groups.filter { it.second.isNotEmpty() }.forEach { (label, models) ->
            Text(
                label, style = MaterialTheme.typography.labelMedium, color = Impala.colors.text2,
                modifier = Modifier.padding(start = Space.s4, top = Space.s3, bottom = Space.s1),
            )
            models.forEach { m ->
                ModelRow(m, active = m.providerId == activeId && m.id == s.model) { vm.selectModel(m.providerId, m.id) }
            }
        }
        if (!list.loading && list.models.isEmpty() && list.error == null) Hint("Keine Modelle gefunden. Prüfe die Quellen unten.")
        ManualModel(s, activeId) { provider, model -> vm.selectModel(provider, model) }
    }
}

@Composable
private fun ModelRow(m: AiModel, active: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.RadioButton, onClick = onClick)
            .background(if (active) Impala.colors.tint2 else Color.Transparent)
            .padding(horizontal = Space.s4, vertical = Space.s2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (m.id == "impala-ai") "Impala AI" else m.id, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        if (active) Text("✓", color = Impala.colors.accent)
    }
}

/** „Manuelle Modell-ID“: nur wenn die Quelle das Modell nicht auflistet. */
@Composable
private fun ManualModel(s: SettingsValues, activeId: String, onApply: (String, String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var model by remember(s.model) { mutableStateOf(s.model) }
    var provider by remember(activeId) { mutableStateOf(activeId) }
    var menu by remember { mutableStateOf(false) }
    SettingsRow(
        "Manuelle Modell-ID", "Nur wenn die Quelle das Modell nicht auflistet",
        trailing = { TextButton(onClick = { open = !open }) { Text(if (open) "Schließen" else "Eingeben") } },
    )
    if (!open) return
    Column(Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2), verticalArrangement = Arrangement.spacedBy(Space.s2)) {
        OutlinedTextField(model, { model = it }, label = { Text("Modell-ID") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s2, Alignment.End)) {
            Box {
                TextButton(onClick = { menu = true }) {
                    Text("Quelle: " + (s.providers.firstOrNull { it.id == provider }?.name?.ifEmpty { null } ?: provider.ifEmpty { "—" }))
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    s.providers.forEach { p ->
                        DropdownMenuItem(text = { Text(p.name.ifEmpty { p.id }) }, onClick = { provider = p.id; menu = false })
                    }
                }
            }
            OutlinedButton(enabled = model.isNotBlank() && provider.isNotEmpty(), onClick = { onApply(provider, model) }) { Text("Übernehmen") }
        }
    }
}

/**
 * „Quellen“ (`aiSourcesGroup`): je Quelle Name, Server-URL und API-Key, aufklappbar; die aktive Quelle
 * ist offen. Zugangsdaten gelten erst nach „Speichern“.
 */
@Composable
fun AiSourcesGroup(vm: SettingsViewModel, s: SettingsValues) {
    val activeId = s.providerId.ifEmpty { s.providers.firstOrNull()?.id.orEmpty() }
    SettingsGroup("Quellen", footnote = "Zugangsdaten werden erst mit Speichern übernommen.") {
        s.providers.forEach { p -> ProviderCard(vm, p, active = p.id == activeId) }
        FlowRow(
            Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s3),
            horizontalArrangement = Arrangement.spacedBy(Space.s2),
            verticalArrangement = Arrangement.spacedBy(Space.s2),
        ) {
            OutlinedButton(onClick = vm::addProvider) { Text("Quelle hinzufügen") }
            PROVIDER_PRESETS.forEach { preset ->
                TextButton(onClick = { vm.addPreset(preset) }) { Text(PRESET_LABELS.getValue(preset.id)) }
            }
        }
    }
}

@Composable
private fun ProviderCard(vm: SettingsViewModel, p: AiProvider, active: Boolean) {
    var open by remember(p.id) { mutableStateOf(active) }
    var name by remember(p) { mutableStateOf(p.name) }
    var base by remember(p) { mutableStateOf(p.base) }
    var key by remember(p) { mutableStateOf(p.key) }
    var status by remember(p) { mutableStateOf<Pair<Boolean, String>?>(null) }
    var testing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val dirty = name != p.name || base != p.base || key != p.key

    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button) { open = !open }.padding(horizontal = Space.s4, vertical = Space.s3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(p.name.ifEmpty { p.id }, style = MaterialTheme.typography.titleSmall)
            Text(
                if (active) "Aktive Quelle" else p.base.removePrefix("https://").removePrefix("http://"),
                style = MaterialTheme.typography.bodySmall, color = Impala.colors.text2,
            )
        }
        Icon(
            painterResource(R.drawable.ic_i_chevron_right), null,
            Modifier.size(18.dp), tint = Impala.colors.text2,
        )
    }
    if (!open) return
    Column(Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s1), verticalArrangement = Arrangement.spacedBy(Space.s2)) {
        OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            base, { base = it }, label = { Text("Server-URL") }, placeholder = { Text("https://…/v1") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            key, { key = it }, label = { Text("API-Key") }, placeholder = { Text("Optional") },
            singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
        )
        status?.let { (ok, text) ->
            Text(text, style = MaterialTheme.typography.bodySmall, color = if (ok) Impala.colors.accent else MaterialTheme.colorScheme.error)
        }
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s2, Alignment.End)) {
            TextButton(
                onClick = { vm.removeProvider(p.id) },
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) { Text("Entfernen") }
            OutlinedButton(enabled = !testing, onClick = {
                testing = true
                status = null
                scope.launch {
                    val r = runCatching { vm.ping(base, key) }.getOrNull()
                    testing = false
                    status = when {
                        r == null -> false to "Test fehlgeschlagen."
                        r.ok -> true to "Verbunden · ${r.models} Modelle gefunden."
                        else -> {
                            r.suggestedBase?.let { base = it }
                            false to (r.error ?: "Keine Verbindung.")
                        }
                    }
                }
            }) { Text(if (testing) "Teste …" else "Verbindung testen") }
            OutlinedButton(enabled = dirty, onClick = { vm.saveProvider(AiProvider(p.id, name, base, key)) }) { Text("Speichern") }
        }
    }
}

@Composable
private fun StatusDot(color: Color) {
    Box(Modifier.size(10.dp).clip(CircleShape).background(color))
}

@Composable
private fun Hint(text: String) {
    Text(
        text, style = MaterialTheme.typography.bodySmall, color = Impala.colors.text2,
        modifier = Modifier.padding(horizontal = Space.s4, vertical = Space.s2),
    )
}
