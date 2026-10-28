package org.impala67.app.ui.screens

import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.AddCircle
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CloudSync
import androidx.compose.material.icons.rounded.CloudUpload
import androidx.compose.material.icons.rounded.Compress
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.data.SyncUiModel
import org.impala67.app.ui.theme.Accent
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.DangerSoft
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.EdgeSoft
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.Success
import org.impala67.app.ui.theme.SuccessSoft
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.Warn
import org.impala67.app.ui.theme.WarnSoft
import uniffi.impala_ffi.ConflictInfo
import uniffi.impala_ffi.ConflictResolution
import uniffi.impala_ffi.DiffRow
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.conflictDiffRows
import uniffi.impala_ffi.generateSyncKey

/**
 * Einstellungen, Cloudflare Live-Sync, Google Drive Backup & Konflikt-Auflösung
 */
@Composable
fun SettingsAndSyncSheet(
    core: ImpalaCore,
    syncUiModel: SyncUiModel?,
    onTriggerSync: () -> Unit,
    onTriggerDriveBackup: () -> Unit,
    onCompactCloud: () -> Unit,
    onSaveSyncKey: (String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    var selectedTab by remember { mutableIntStateOf(0) } // 0: Sync & Backup, 1: Konflikte, 2: Daten
    var conflicts by remember { mutableStateOf<List<ConflictInfo>>(emptyList()) }
    var selectedConflictForDiff by remember { mutableStateOf<ConflictInfo?>(null) }
    var statusMessage by remember { mutableStateOf<String?>(null) }

    fun reloadConflicts() {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val list = core.conflicts()
                withContext(Dispatchers.Main) {
                    conflicts = list
                }
            } catch (e: Exception) {
                // Fehler abfangen
            }
        }
    }

    LaunchedEffect(Unit) {
        reloadConflicts()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel)
            .imePadding()
            .navigationBarsPadding()
    ) {
        // Kopfzeile
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onClose) {
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                    contentDescription = "Zurück",
                    tint = TextPrimary
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "Einstellungen & Synchronisation",
                color = TextPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold
            )
        }

        // Tabs
        TabRow(
            selectedTabIndex = selectedTab,
            containerColor = BgSidebar,
            contentColor = Accent,
            divider = { HorizontalDivider(color = EdgeSoft) }
        ) {
            Tab(
                selected = selectedTab == 0,
                onClick = { selectedTab = 0 },
                text = { Text("Sync & Drive", fontSize = 13.sp) }
            )
            Tab(
                selected = selectedTab == 1,
                onClick = {
                    selectedTab = 1
                    reloadConflicts()
                },
                text = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Konflikte", fontSize = 13.sp)
                        if (conflicts.isNotEmpty()) {
                            Spacer(modifier = Modifier.width(4.dp))
                            Surface(
                                shape = ImpalaPillShape,
                                color = Danger
                            ) {
                                Text(
                                    text = conflicts.size.toString(),
                                    color = Color.White,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp)
                                )
                            }
                        }
                    }
                }
            )
            Tab(
                selected = selectedTab == 2,
                onClick = { selectedTab = 2 },
                text = { Text("Daten & Export", fontSize = 13.sp) }
            )
        }

        // Statusmeldung
        if (statusMessage != null) {
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = AccentSoft,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = statusMessage ?: "",
                        color = Accent,
                        fontSize = 13.sp,
                        modifier = Modifier.weight(1f)
                    )
                    IconButton(
                        onClick = { statusMessage = null },
                        modifier = Modifier.size(20.dp)
                    ) {
                        Icon(Icons.Rounded.Check, null, tint = Accent, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }

        // Tab-Inhalte
        when (selectedTab) {
            0 -> SyncAndDriveTab(
                syncUiModel = syncUiModel,
                onTriggerSync = onTriggerSync,
                onTriggerDriveBackup = onTriggerDriveBackup,
                onCompactCloud = onCompactCloud,
                onSaveSyncKey = onSaveSyncKey,
                onMessage = { statusMessage = it }
            )
            1 -> ConflictsTab(
                core = core,
                conflicts = conflicts,
                onSelectConflict = { selectedConflictForDiff = it },
                onRefresh = { reloadConflicts() },
                onMessage = { statusMessage = it }
            )
            2 -> DataExportTab(
                core = core,
                onMessage = { statusMessage = it }
            )
        }
    }

    // Detail-Diff-Dialog für Konflikte
    val conflict = selectedConflictForDiff
    if (conflict != null) {
        ConflictDiffDialog(
            conflict = conflict,
            onDismiss = { selectedConflictForDiff = null },
            onResolve = { resolution ->
                coroutineScope.launch(Dispatchers.IO) {
                    try {
                        core.resolveConflict(conflict.key, resolution)
                        withContext(Dispatchers.Main) {
                            selectedConflictForDiff = null
                            reloadConflicts()
                            statusMessage = "Konflikt aufgelöst."
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            statusMessage = "Fehler: ${e.message}"
                        }
                    }
                }
            }
        )
    }
}

/**
 * Tab 1: Cloudflare Live-Sync & Google Drive Backup
 */
@Composable
private fun SyncAndDriveTab(
    syncUiModel: SyncUiModel?,
    onTriggerSync: () -> Unit,
    onTriggerDriveBackup: () -> Unit,
    onCompactCloud: () -> Unit,
    onSaveSyncKey: (String) -> Unit,
    onMessage: (String) -> Unit
) {
    var syncKeyInput by remember { mutableStateOf("") }
    var isKeyVisible by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Cloudflare Live-Sync Karte
        item {
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BgSidebar),
                border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Rounded.CloudDone,
                                contentDescription = null,
                                tint = Accent,
                                modifier = Modifier.size(22.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "Cloudflare Live-Sync (E2EE)",
                                color = TextPrimary,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }

                        IconButton(onClick = onTriggerSync) {
                            Icon(
                                imageVector = Icons.Rounded.Refresh,
                                contentDescription = "Jetzt synchronisieren",
                                tint = Accent
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Ende-zu-Ende-verschlüsselte Echtzeit-Synchronisation zwischen all deinen Geräten ohne laufende Serverkosten.",
                        color = TextSecondary,
                        fontSize = 13.sp,
                        lineHeight = 18.sp
                    )

                    Spacer(modifier = Modifier.height(14.dp))

                    // Sync-Statuszeile
                    val usageText = (syncUiModel as? SyncUiModel.Synced)?.status?.usageText
                    if (!usageText.isNullOrEmpty()) {
                        Text(
                            text = "Cloud-Speicher: $usageText",
                            color = TextMuted,
                            fontSize = 12.sp
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                    } else if (syncUiModel is SyncUiModel.Syncing) {
                        Text(
                            text = "Fortschritt: ${syncUiModel.label}",
                            color = Accent,
                            fontSize = 12.sp
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                    } else if (syncUiModel is SyncUiModel.Error) {
                        Text(
                            text = "Fehler: ${syncUiModel.message}",
                            color = Danger,
                            fontSize = 12.sp
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                    }

                    // Sync-Schlüssel Eingabe
                    Text(text = "Sync-Schlüssel:", color = TextSecondary, fontSize = 12.sp)
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(BgBubble, RoundedCornerShape(10.dp))
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        BasicTextField(
                            value = syncKeyInput,
                            onValueChange = { syncKeyInput = it },
                            textStyle = TextStyle(
                                color = TextPrimary,
                                fontSize = 13.sp,
                                fontFamily = FontFamily.Monospace
                            ),
                            cursorBrush = SolidColor(Accent),
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                            decorationBox = { inner ->
                                if (syncKeyInput.isEmpty()) {
                                    Text("Schlüssel eingeben…", color = TextMuted, fontSize = 13.sp)
                                }
                                inner()
                            }
                        )
                        IconButton(
                            onClick = {
                                try {
                                    val generated = generateSyncKey()
                                    syncKeyInput = generated
                                    onMessage("Neuer E2EE-Schlüssel generiert!")
                                } catch (e: Exception) {
                                    onMessage("Fehler: ${e.message}")
                                }
                            },
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(Icons.Rounded.Key, "Generieren", tint = Accent, modifier = Modifier.size(16.dp))
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (syncKeyInput.isNotEmpty()) {
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = Accent,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable {
                                        onSaveSyncKey(syncKeyInput)
                                        onMessage("Sync-Schlüssel gespeichert!")
                                    }
                            ) {
                                Text(
                                    text = "Schlüssel anwenden",
                                    color = Color(0xFF081018),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                                )
                            }
                        }

                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = BgBubble,
                            border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .clickable(onClick = onCompactCloud)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Rounded.Compress, null, tint = TextSecondary, modifier = Modifier.size(14.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Cloud kompaktieren", color = TextSecondary, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
        }

        // Google Drive Backup Karte
        item {
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BgSidebar),
                border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Rounded.CloudUpload,
                                contentDescription = null,
                                tint = Warn,
                                modifier = Modifier.size(22.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "Google Drive Notfall-Backup",
                                color = TextPrimary,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Automatisches oder manuelles Backup deiner Datenbank auf deinem persönlichen Google Drive.",
                        color = TextSecondary,
                        fontSize = 13.sp,
                        lineHeight = 18.sp
                    )

                    Spacer(modifier = Modifier.height(14.dp))

                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = WarnSoft,
                        border = androidx.compose.foundation.BorderStroke(1.dp, Warn),
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable(onClick = onTriggerDriveBackup)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Rounded.CloudUpload, null, tint = Warn, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Jetzt auf Drive sichern", color = Warn, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Tab 2: Konflikt-Auflösung
 */
@Composable
private fun ConflictsTab(
    core: ImpalaCore,
    conflicts: List<ConflictInfo>,
    onSelectConflict: (ConflictInfo) -> Unit,
    onRefresh: () -> Unit,
    onMessage: (String) -> Unit
) {
    val coroutineScope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "${conflicts.size} offene Konflikte",
                color = if (conflicts.isNotEmpty()) Danger else TextSecondary,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium
            )

            if (conflicts.isNotEmpty()) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = Accent,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val result = core.resolveConflictsRecommended()
                                    withContext(Dispatchers.Main) {
                                        onRefresh()
                                        onMessage("${result.resolved} Konflikte automatisch gelöst.")
                                    }
                                } catch (e: Exception) {
                                    withContext(Dispatchers.Main) {
                                        onMessage("Fehler: ${e.message}")
                                    }
                                }
                            }
                        }
                ) {
                    Text(
                        text = "Alle mit Empfehlung lösen",
                        color = Color(0xFF081018),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        if (conflicts.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = 40.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        imageVector = Icons.Rounded.CheckCircle,
                        contentDescription = null,
                        tint = Success,
                        modifier = Modifier.size(48.dp)
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Keine Konflikte vorhanden",
                        color = TextPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "Alle Änderungen sind synchron und sauber zusammengeführt.",
                        color = TextSecondary,
                        fontSize = 13.sp
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(conflicts, key = { it.key }) { conflict ->
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = BgSidebar,
                        border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { onSelectConflict(conflict) }
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = conflict.title,
                                    color = TextPrimary,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Surface(
                                    shape = ImpalaPillShape,
                                    color = DangerSoft
                                ) {
                                    Text(
                                        text = conflict.kind.name,
                                        color = Danger,
                                        fontSize = 10.sp,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                    )
                                }
                            }

                            val reason = conflict.reason
                            if (!reason.isNullOrEmpty()) {
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = reason,
                                    color = TextSecondary,
                                    fontSize = 12.sp
                                )
                            }

                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "Tippen für Zeilen-Diff & Entscheidung",
                                color = Accent,
                                fontSize = 11.sp
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Tab 3: Lokaler JSON-Export & Import
 */
@Composable
private fun DataExportTab(
    core: ImpalaCore,
    onMessage: (String) -> Unit
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    var importJsonText by remember { mutableStateOf("") }
    var isExporting by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Export
        item {
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BgSidebar),
                border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "Daten exportieren",
                        color = TextPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Erstellt ein vollständiges JSON-Backup (kompatibel mit der Impala67 PWA).",
                        color = TextSecondary,
                        fontSize = 13.sp
                    )
                    Spacer(modifier = Modifier.height(14.dp))

                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = Accent,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable {
                                isExporting = true
                                coroutineScope.launch(Dispatchers.IO) {
                                    try {
                                        val json = core.exportJson(includeBlobs = true)
                                        withContext(Dispatchers.Main) {
                                            isExporting = false
                                            val sendIntent = Intent().apply {
                                                action = Intent.ACTION_SEND
                                                putExtra(Intent.EXTRA_TEXT, json)
                                                type = "application/json"
                                            }
                                            context.startActivity(Intent.createChooser(sendIntent, "Impala67 Backup teilen"))
                                        }
                                    } catch (e: Exception) {
                                        withContext(Dispatchers.Main) {
                                            isExporting = false
                                            onMessage("Export-Fehler: ${e.message}")
                                        }
                                    }
                                }
                            }
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            if (isExporting) {
                                CircularProgressIndicator(modifier = Modifier.size(14.dp), color = Color(0xFF081018), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Rounded.Share, null, tint = Color(0xFF081018), modifier = Modifier.size(16.dp))
                            }
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Exportieren & Teilen", color = Color(0xFF081018), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }

        // Import
        item {
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BgSidebar),
                border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "Backup importieren",
                        color = TextPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Füge ein JSON-Backup aus der PWA oder einer anderen App-Instanz ein:",
                        color = TextSecondary,
                        fontSize = 13.sp
                    )
                    Spacer(modifier = Modifier.height(10.dp))

                    BasicTextField(
                        value = importJsonText,
                        onValueChange = { importJsonText = it },
                        textStyle = TextStyle(color = TextPrimary, fontSize = 12.sp, fontFamily = FontFamily.Monospace),
                        cursorBrush = SolidColor(Accent),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(100.dp)
                            .background(BgBubble, RoundedCornerShape(8.dp))
                            .padding(10.dp),
                        decorationBox = { inner ->
                            if (importJsonText.isEmpty()) {
                                Text("{ \"pages\": [ ... ] }", color = TextMuted, fontSize = 12.sp)
                            }
                            inner()
                        }
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = BgBubble,
                        border = androidx.compose.foundation.BorderStroke(1.dp, Edge),
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable {
                                val text = importJsonText.trim()
                                if (text.isNotEmpty()) {
                                    coroutineScope.launch(Dispatchers.IO) {
                                        try {
                                            val summary = core.importJson(text)
                                            withContext(Dispatchers.Main) {
                                                importJsonText = ""
                                                onMessage("Import erfolgreich: ${summary.added} Einträge hinzugefügt.")
                                            }
                                        } catch (e: Exception) {
                                            withContext(Dispatchers.Main) {
                                                onMessage("Import-Fehler: ${e.message}")
                                            }
                                        }
                                    }
                                }
                            }
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Rounded.Download, null, tint = Accent, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Import ausführen", color = Accent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Side-by-Side / Zeilen-Diff Dialog mit Entscheidungs-Knöpfen
 */
@Composable
private fun ConflictDiffDialog(
    conflict: ConflictInfo,
    onDismiss: () -> Unit,
    onResolve: (ConflictResolution) -> Unit
) {
    val local = conflict.localContent ?: ""
    val remote = conflict.remoteContent ?: ""
    val diffRows = remember(local, remote) {
        conflictDiffRows(local, remote) ?: emptyList()
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = BgSidebar,
            border = androidx.compose.foundation.BorderStroke(1.dp, Edge),
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Konflikt: ${conflict.title}",
                    color = TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold
                )

                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = conflict.reason ?: "Unterschiedliche Stände auf zwei Geräten.",
                    color = TextSecondary,
                    fontSize = 12.sp
                )

                Spacer(modifier = Modifier.height(12.dp))

                // Diff-Liste
                LazyColumn(
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .height(240.dp)
                        .background(BgDeep, RoundedCornerShape(8.dp))
                        .padding(8.dp)
                ) {
                    items(diffRows) { row ->
                        when (row) {
                            is DiffRow.Line -> {
                                val bg = if (row.changed) Color(0x33E97366) else Color.Transparent
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .background(bg)
                                        .padding(vertical = 2.dp)
                                ) {
                                    Text(
                                        text = row.left ?: "",
                                        color = if (row.changed) Danger else TextSecondary,
                                        fontSize = 11.sp,
                                        fontFamily = FontFamily.Monospace,
                                        modifier = Modifier.weight(1f)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = row.right ?: "",
                                        color = if (row.changed) Success else TextSecondary,
                                        fontSize = 11.sp,
                                        fontFamily = FontFamily.Monospace,
                                        modifier = Modifier.weight(1f)
                                    )
                                }
                            }
                            is DiffRow.Gap -> {
                                Text(
                                    text = "… ${row.count} unveränderte Zeilen eingeklappt …",
                                    color = TextMuted,
                                    fontSize = 10.sp,
                                    modifier = Modifier.padding(vertical = 4.dp)
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Aktionen: Gewinner behalten, Verlierer nutzen, Beide behalten
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = Accent,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { onResolve(ConflictResolution.KEEP_WINNER) }
                    ) {
                        Text(
                            text = "Neueren Stand behalten (Gewinner)",
                            color = Color(0xFF081018),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            modifier = Modifier.padding(vertical = 10.dp)
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = BgBubble,
                            border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .clickable { onResolve(ConflictResolution.USE_LOSER) }
                        ) {
                            Text(
                                text = "Anderen Stand",
                                color = TextSecondary,
                                fontSize = 12.sp,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                modifier = Modifier.padding(vertical = 8.dp)
                            )
                        }

                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = BgBubble,
                            border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .clickable { onResolve(ConflictResolution.KEEP_BOTH) }
                        ) {
                            Text(
                                text = "Beide behalten",
                                color = TextSecondary,
                                fontSize = 12.sp,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                modifier = Modifier.padding(vertical = 8.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}
