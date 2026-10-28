package org.impala67.app.ui.screens

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
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
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.Psychology
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
import androidx.compose.material3.ScrollableTabRow
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.common.api.ApiException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.data.SyncUiModel
import org.impala67.app.ui.theme.Accent
import org.impala67.app.ui.theme.AccentBlue
import org.impala67.app.ui.theme.AccentBlueSoft
import org.impala67.app.ui.theme.AccentGreen
import org.impala67.app.ui.theme.AccentOrange
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.AccentViolet
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgCard
import org.impala67.app.ui.theme.BgDeep
import org.impala67.app.ui.theme.BgElevated
import org.impala67.app.ui.theme.BgHover
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.BorderHairline
import org.impala67.app.ui.theme.BorderStrong
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.DangerRed
import org.impala67.app.ui.theme.DangerSoft
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.EdgeSoft
import org.impala67.app.ui.theme.IMPALA_UI_PREFS
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.PREF_ACCENT_COLOR
import org.impala67.app.ui.theme.PREF_THEME_MODE
import org.impala67.app.ui.theme.PREF_UI_MODE_OVERRIDE
import org.impala67.app.ui.theme.Success
import org.impala67.app.ui.theme.SuccessGreen
import org.impala67.app.ui.theme.SuccessSoft
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextLight
import org.impala67.app.ui.theme.TextMain
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.Warn
import org.impala67.app.ui.theme.WarnSoft
import org.impala67.app.ui.theme.WarningAmber
import org.impala67.app.ui.theme.syncThemeFromPrefs
import uniffi.impala_ffi.ConflictInfo
import uniffi.impala_ffi.ConflictResolution
import uniffi.impala_ffi.DiffRow
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.conflictDiffRows
import uniffi.impala_ffi.generateSyncKey

/**
 * Einstellungen, Darstellung, KI-Modelle, Cloudflare Live-Sync, Google Drive Backup & Konflikte
 * (nach Vorbild von `web/settings.js`)
 */
@Composable
fun SettingsAndSyncSheet(
    core: ImpalaCore,
    syncUiModel: SyncUiModel? = null,
    repository: org.impala67.app.data.ImpalaRepository? = null,
    onTriggerSync: () -> Unit = {},
    onTriggerDriveBackup: () -> Unit = {},
    onCompactCloud: () -> Unit = {},
    onSaveSyncKey: (String) -> Unit = {},
    onClose: () -> Unit,
    onMutation: () -> Unit = {},
    onThemeChanged: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    // 5 Tabs: 0: Darstellung, 1: KI, 2: Sync & Backup, 3: Konflikte, 4: Daten
    var selectedTab by remember { mutableIntStateOf(0) }
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
            } catch (_: Exception) {}
        }
    }

    LaunchedEffect(Unit) {
        reloadConflicts()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel)
            .statusBarsPadding()
            .imePadding()
            .navigationBarsPadding()
    ) {
        // Kopfzeile
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onClose, modifier = Modifier.size(32.dp)) {
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                    contentDescription = "Zurück",
                    tint = TextMain,
                    modifier = Modifier.size(20.dp)
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "Einstellungen",
                color = TextMain,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold
            )
        }

        // 5 PWA-Tabs
        val tabs = listOf("Darstellung", "KI-Modelle", "Sync & Drive", "Konflikte", "Daten & Export")
        ScrollableTabRow(
            selectedTabIndex = selectedTab,
            containerColor = BgSidebar,
            contentColor = AccentBlue,
            edgePadding = 12.dp,
            divider = { HorizontalDivider(color = BorderHairline) }
        ) {
            tabs.forEachIndexed { index, title ->
                Tab(
                    selected = selectedTab == index,
                    onClick = {
                        selectedTab = index
                        if (index == 3) reloadConflicts()
                    },
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(title, fontSize = 13.sp, fontWeight = if (selectedTab == index) FontWeight.Bold else FontWeight.Medium)
                            if (index == 3 && conflicts.isNotEmpty()) {
                                Spacer(modifier = Modifier.width(4.dp))
                                Surface(shape = ImpalaPillShape, color = DangerRed) {
                                    Text(
                                        text = conflicts.size.toString(),
                                        color = Color.White,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp)
                                    )
                                }
                            }
                        }
                    }
                )
            }
        }

        // Statusmeldung
        if (statusMessage != null) {
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = AccentSoft,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(14.dp)
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = statusMessage ?: "",
                        color = AccentBlue,
                        fontSize = 13.sp,
                        modifier = Modifier.weight(1f)
                    )
                    IconButton(
                        onClick = { statusMessage = null },
                        modifier = Modifier.size(20.dp)
                    ) {
                        Icon(Icons.Rounded.Check, null, tint = AccentBlue, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }

        // Tab-Inhalte
        when (selectedTab) {
            0 -> AppearanceTab(
                context = context,
                core = core,
                onThemeChanged = onThemeChanged
            )
            1 -> AiModelsTab(
                context = context,
                core = core,
                onMessage = { statusMessage = it }
            )
            2 -> SyncAndDriveTab(
                syncUiModel = syncUiModel,
                repository = repository,
                onTriggerSync = onTriggerSync,
                onTriggerDriveBackup = onTriggerDriveBackup,
                onCompactCloud = onCompactCloud,
                onSaveSyncKey = onSaveSyncKey,
                onMessage = { statusMessage = it }
            )
            3 -> ConflictsTab(
                core = core,
                conflicts = conflicts,
                onSelectConflict = { selectedConflictForDiff = it },
                onRefresh = { reloadConflicts() },
                onMessage = { statusMessage = it }
            )
            4 -> DataExportTab(
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
                            onMutation()
                            statusMessage = "Konflikt erfolgreich gelöst."
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            statusMessage = "Fehler beim Lösen: ${e.message}"
                        }
                    }
                }
            }
        )
    }
}

/**
 * Rückwärtskompatible Überladung für Aufrufer mit `ImpalaRepository`
 */
@Composable
fun SettingsAndSyncSheet(
    repository: org.impala67.app.data.ImpalaRepository,
    core: ImpalaCore,
    syncController: Any? = null,
    syncState: Any? = null,
    onDismiss: () -> Unit,
    onMutation: () -> Unit = {},
    onThemeChanged: () -> Unit = {}
) {
    SettingsAndSyncSheet(
        core = core,
        syncUiModel = null,
        repository = repository,
        onTriggerSync = { repository.syncManager.triggerSyncNow() },
        onTriggerDriveBackup = { repository.syncManager.triggerDriveSyncNow() },
        onCompactCloud = { repository.syncManager.compactCloud() },
        onSaveSyncKey = { key -> repository.syncManager.configureCloudSync(key, null) },
        onClose = onDismiss,
        onMutation = onMutation,
        onThemeChanged = onThemeChanged
    )
}

// ============================================================================
// 1. DARSTELLUNG & DESIGN TAB
// ============================================================================

@Composable
private fun AppearanceTab(
    context: Context,
    core: ImpalaCore,
    onThemeChanged: () -> Unit
) {
    val prefs = remember { context.getSharedPreferences(IMPALA_UI_PREFS, Context.MODE_PRIVATE) }
    var currentTheme by remember { mutableStateOf(prefs.getString(PREF_THEME_MODE, "dark") ?: "dark") }
    var currentAccent by remember { mutableStateOf(prefs.getString(PREF_ACCENT_COLOR, "blue") ?: "blue") }
    var currentLayoutMode by remember { mutableStateOf(prefs.getString(PREF_UI_MODE_OVERRIDE, "auto") ?: "auto") }

    val coroutineScope = rememberCoroutineScope()

    fun updateTheme(newTheme: String) {
        currentTheme = newTheme
        prefs.edit().putString(PREF_THEME_MODE, newTheme).apply()
        coroutineScope.launch(Dispatchers.IO) {
            try { core.updateSettings("""{"theme": "$newTheme"}""") } catch (_: Exception) {}
        }
        syncThemeFromPrefs(context)
        onThemeChanged()
    }

    fun updateAccent(newAccent: String) {
        currentAccent = newAccent
        prefs.edit().putString(PREF_ACCENT_COLOR, newAccent).apply()
        coroutineScope.launch(Dispatchers.IO) {
            try { core.updateSettings("""{"accentColor": "$newAccent"}""") } catch (_: Exception) {}
        }
        syncThemeFromPrefs(context)
        onThemeChanged()
    }

    fun updateLayout(newMode: String) {
        currentLayoutMode = newMode
        prefs.edit().putString(PREF_UI_MODE_OVERRIDE, newMode).apply()
        onThemeChanged()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        // Farbschema
        Card(
            colors = CardDefaults.cardColors(containerColor = BgCard),
            border = BorderStroke(1.dp, BorderHairline),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Farbschema", color = TextMain, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("dark" to "Dunkel (PWA)", "light" to "Hell", "system" to "System").forEach { (id, label) ->
                        val isSel = currentTheme == id
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (isSel) AccentBlueSoft else BgBubble,
                            border = BorderStroke(1.dp, if (isSel) AccentBlue else BorderHairline),
                            modifier = Modifier
                                .weight(1f)
                                .clickable { updateTheme(id) }
                        ) {
                            Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(vertical = 10.dp)) {
                                Text(
                                    text = label,
                                    color = if (isSel) AccentBlue else TextSecondary,
                                    fontSize = 12.sp,
                                    fontWeight = if (isSel) FontWeight.Bold else FontWeight.Normal
                                )
                            }
                        }
                    }
                }
            }
        }

        // Akzentfarbe (4 PWA-Akzentfarben)
        Card(
            colors = CardDefaults.cardColors(containerColor = BgCard),
            border = BorderStroke(1.dp, BorderHairline),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Akzentfarbe", color = TextMain, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    val colors = listOf(
                        "blue" to (AccentBlue to "Blau"),
                        "violet" to (AccentViolet to "Violett"),
                        "green" to (AccentGreen to "Grün"),
                        "orange" to (AccentOrange to "Orange")
                    )
                    colors.forEach { (id, pair) ->
                        val (col, label) = pair
                        val isSel = currentAccent == id
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = BgBubble,
                            border = BorderStroke(if (isSel) 2.dp else 1.dp, if (isSel) col else BorderHairline),
                            modifier = Modifier
                                .weight(1f)
                                .clickable { updateAccent(id) }
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                modifier = Modifier.padding(vertical = 10.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(24.dp)
                                        .clip(CircleShape)
                                        .background(col)
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = label,
                                    color = if (isSel) col else TextMuted,
                                    fontSize = 11.sp,
                                    fontWeight = if (isSel) FontWeight.Bold else FontWeight.Normal
                                )
                            }
                        }
                    }
                }
            }
        }

        // Layout-Modus Weiche (Hochkant vs Querformat)
        Card(
            colors = CardDefaults.cardColors(containerColor = BgCard),
            border = BorderStroke(1.dp, BorderHairline),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Layout-Modus", color = TextMain, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                Text(
                    text = "Standardmäßig: Hochkant am Handy = Mobile UI, Querformat am Handy & Tablets = echte 3-Spalten PWA UI.",
                    color = TextMuted,
                    fontSize = 12.sp
                )

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(
                        "auto" to "Automatisch",
                        "tablet" to "Immer Tablet/PWA",
                        "mobile" to "Immer Handy"
                    ).forEach { (id, label) ->
                        val isSel = currentLayoutMode == id
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (isSel) AccentBlueSoft else BgBubble,
                            border = BorderStroke(1.dp, if (isSel) AccentBlue else BorderHairline),
                            modifier = Modifier
                                .weight(1f)
                                .clickable { updateLayout(id) }
                        ) {
                            Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(vertical = 8.dp)) {
                                Text(
                                    text = label,
                                    color = if (isSel) AccentBlue else TextSecondary,
                                    fontSize = 11.sp,
                                    fontWeight = if (isSel) FontWeight.Bold else FontWeight.Normal
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

// ============================================================================
// 2. KI-MODELLE TAB
// ============================================================================

@Composable
private fun AiModelsTab(
    context: Context,
    core: ImpalaCore,
    onMessage: (String) -> Unit
) {
    val aiPrefs = remember { context.getSharedPreferences("impala_ai_prefs", Context.MODE_PRIVATE) }
    var geminiKey by remember { mutableStateOf(aiPrefs.getString("gemini_key", "") ?: "") }
    var openaiKey by remember { mutableStateOf(aiPrefs.getString("openai_key", "") ?: "") }
    var anthropicKey by remember { mutableStateOf(aiPrefs.getString("anthropic_key", "") ?: "") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = BgCard),
            border = BorderStroke(1.dp, BorderHairline),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("API-Schlüssel (bleiben nur lokal auf deinem Gerät)", color = TextMain, fontSize = 14.sp, fontWeight = FontWeight.Bold)

                Text("Google Gemini API-Key:", color = TextSecondary, fontSize = 12.sp)
                BasicTextField(
                    value = geminiKey,
                    onValueChange = { geminiKey = it },
                    textStyle = TextStyle(color = TextMain, fontSize = 13.sp),
                    cursorBrush = SolidColor(AccentBlue),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(BgBubble)
                        .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                        .padding(10.dp)
                )

                Text("OpenAI API-Key:", color = TextSecondary, fontSize = 12.sp)
                BasicTextField(
                    value = openaiKey,
                    onValueChange = { openaiKey = it },
                    textStyle = TextStyle(color = TextMain, fontSize = 13.sp),
                    cursorBrush = SolidColor(AccentBlue),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(BgBubble)
                        .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                        .padding(10.dp)
                )

                Text("Anthropic Claude API-Key:", color = TextSecondary, fontSize = 12.sp)
                BasicTextField(
                    value = anthropicKey,
                    onValueChange = { anthropicKey = it },
                    textStyle = TextStyle(color = TextMain, fontSize = 13.sp),
                    cursorBrush = SolidColor(AccentBlue),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(BgBubble)
                        .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                        .padding(10.dp)
                )

                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = AccentBlue,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            aiPrefs.edit()
                                .putString("gemini_key", geminiKey.trim())
                                .putString("openai_key", openaiKey.trim())
                                .putString("anthropic_key", anthropicKey.trim())
                                .apply()
                            onMessage("KI-Schlüssel erfolgreich gespeichert.")
                        }
                ) {
                    Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(vertical = 10.dp)) {
                        Text("Schlüssel speichern", color = Color(0xFF081018), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }
            }
        }
    }
}

// ============================================================================
// 3. SYNC & DRIVE TAB
// ============================================================================

@Composable
private fun SyncAndDriveTab(
    syncUiModel: SyncUiModel?,
    repository: org.impala67.app.data.ImpalaRepository?,
    onTriggerSync: () -> Unit,
    onTriggerDriveBackup: () -> Unit,
    onCompactCloud: () -> Unit,
    onSaveSyncKey: (String) -> Unit,
    onMessage: (String) -> Unit
) {
    var syncKeyInput by remember { mutableStateOf("") }
    var isKeyVisible by remember { mutableStateOf(false) }
    val isOnline = syncUiModel is SyncUiModel.Synced || syncUiModel is SyncUiModel.Syncing || syncUiModel is SyncUiModel.Idle

    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val driveAuthManager = repository?.driveAuthManager
    val syncManager = repository?.syncManager
    val driveState by syncManager?.driveState?.collectAsStateWithLifecycle() ?: remember { mutableStateOf(null) }
    var driveEmail by remember(driveAuthManager) { mutableStateOf(driveAuthManager?.currentEmail()) }
    val isDriveConnected = !driveEmail.isNullOrBlank()

    // Dialog für Google-Einverständnis falls GoogleAuthUtil einen Intent liefert
    val recoverableLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { recResult ->
        if (recResult.resultCode == Activity.RESULT_OK) {
            coroutineScope.launch {
                val token = driveAuthManager?.accessToken()
                if (token != null && syncManager != null && driveAuthManager != null) {
                    syncManager.configureDriveSync(driveAuthManager)
                    syncManager.triggerDriveSyncNow()
                    driveEmail = driveAuthManager.currentEmail()
                    onMessage("Google Drive Zugriff erfolgreich autorisiert.")
                }
            }
        }
    }

    // Google Sign-In Intent Launcher
    val signInLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
        try {
            val account = task.getResult(ApiException::class.java)
            coroutineScope.launch {
                val ok = driveAuthManager?.onSignedIn(account) ?: false
                if (ok && syncManager != null && driveAuthManager != null) {
                    syncManager.configureDriveSync(driveAuthManager)
                    syncManager.triggerDriveSyncNow()
                    driveEmail = driveAuthManager.currentEmail()
                    onMessage("Google Drive erfolgreich verbunden.")
                } else {
                    val recIntent = driveAuthManager?.lastRecoverableIntent
                    if (recIntent != null) {
                        recoverableLauncher.launch(recIntent)
                    } else {
                        onMessage("Zugriffstoken konnte nicht bezogen werden. Bitte Internetverbindung prüfen.")
                    }
                }
            }
        } catch (e: ApiException) {
            val errorMsg = when (e.statusCode) {
                10 -> "Entwicklerfehler (Status 10): Bitte SHA-1 Fingerprint & Paketname (org.impala67.app) in der Google Cloud Console hinterlegen."
                12500 -> "Anmeldung fehlgeschlagen (Status 12500): Bitte OAuth-Zustimmungsbildschirm prüfen und Testnutzer eintragen."
                7 -> "Netzwerkfehler (Status 7): Keine Internetverbindung."
                12501 -> "Anmeldung abgebrochen."
                else -> "Google-Anmeldung fehlgeschlagen (${e.statusCode}): ${e.message}"
            }
            onMessage(errorMsg)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Status Card
        Card(
            colors = CardDefaults.cardColors(containerColor = BgCard),
            border = BorderStroke(1.dp, BorderHairline),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = if (isOnline) Icons.Rounded.CloudDone else Icons.Rounded.Cloud,
                        contentDescription = null,
                        tint = if (isOnline) SuccessGreen else TextMuted,
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = if (isOnline) "Cloudflare Live-Sync Aktiv" else "Sync Getrennt / Offline",
                        color = TextMain,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                }

                Text(
                    text = "Ende-zu-Ende verschlüsselte Echtzeit-Synchronisation (E2EE Protokoll v4).",
                    color = TextMuted,
                    fontSize = 12.sp
                )

                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = AccentBlue,
                        modifier = Modifier
                            .weight(1f)
                            .clickable {
                                onTriggerSync()
                                onMessage("Synchronisation gestartet...")
                            }
                    ) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(vertical = 10.dp)) {
                            Text("Jetzt synchronisieren", color = Color(0xFF081018), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        }
                    }

                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = BgBubble,
                        border = BorderStroke(1.dp, BorderHairline),
                        modifier = Modifier
                            .weight(1f)
                            .clickable {
                                onCompactCloud()
                                onMessage("Cloud-Kompaktierung angestoßen.")
                            }
                    ) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(vertical = 10.dp)) {
                            Text("Kompaktieren", color = TextMain, fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        // Sync-Key Card
        Card(
            colors = CardDefaults.cardColors(containerColor = BgCard),
            border = BorderStroke(1.dp, BorderHairline),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("E2EE Sync-Schlüssel", color = TextMain, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                Text(
                    text = "Nutze denselben Schlüssel auf deinen anderen Geräten, um Notizen zu synchronisieren.",
                    color = TextMuted,
                    fontSize = 12.sp
                )

                BasicTextField(
                    value = syncKeyInput,
                    onValueChange = { syncKeyInput = it },
                    textStyle = TextStyle(color = TextMain, fontSize = 13.sp, fontFamily = FontFamily.Monospace),
                    cursorBrush = SolidColor(AccentBlue),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(BgBubble)
                        .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                        .padding(10.dp)
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = BgBubble,
                        border = BorderStroke(1.dp, BorderHairline),
                        modifier = Modifier.clickable {
                            val generated = generateSyncKey()
                            syncKeyInput = generated
                        }
                    ) {
                        Text("Neuen Schlüssel generieren", color = TextSecondary, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp))
                    }

                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = AccentBlue,
                        modifier = Modifier.clickable {
                            onSaveSyncKey(syncKeyInput.trim())
                            onMessage("Sync-Schlüssel gespeichert.")
                        }
                    ) {
                        Text("Speichern", color = Color(0xFF081018), fontWeight = FontWeight.Bold, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                    }
                }
            }
        }

        // Google Drive Backup Card
        Card(
            colors = CardDefaults.cardColors(containerColor = BgCard),
            border = BorderStroke(1.dp, BorderHairline),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Rounded.CloudUpload,
                        contentDescription = null,
                        tint = if (isDriveConnected) AccentBlue else TextMuted,
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Google Drive Notfall-Backup",
                        color = TextMain,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                }

                Text(
                    text = "Unabhängiges Backup im privaten Google Drive App-Ordner (appDataFolder). Nur Impala67-Dateien werden gesichert.",
                    color = TextMuted,
                    fontSize = 12.sp
                )

                if (isDriveConnected) {
                    val emailDisplay = driveEmail ?: "Verbunden"
                    val lastOkText = driveState?.lastOk?.let { " • Zuletzt gesichert: $it" } ?: ""
                    Text(
                        text = "Verbunden als $emailDisplay$lastOkText",
                        color = SuccessGreen,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )

                    if (driveState?.running == true) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(14.dp),
                                strokeWidth = 2.dp,
                                color = AccentBlue
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = driveState?.progress?.ifBlank { "Sicherung läuft..." } ?: "Sicherung läuft...",
                                color = AccentBlue,
                                fontSize = 11.sp
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = AccentBlue,
                            modifier = Modifier
                                .weight(1f)
                                .clickable {
                                    onTriggerDriveBackup()
                                    onMessage("Drive-Backup gestartet...")
                                }
                        ) {
                            Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(vertical = 10.dp)) {
                                Text("Jetzt sichern", color = Color(0xFF081018), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                            }
                        }

                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = BgBubble,
                            border = BorderStroke(1.dp, BorderHairline),
                            modifier = Modifier.clickable {
                                driveAuthManager?.signOut {
                                    syncManager?.disconnectDriveSync()
                                    driveEmail = null
                                    onMessage("Google Drive abgemeldet.")
                                }
                            }
                        ) {
                            Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                                Text("Abmelden", color = TextSecondary, fontSize = 12.sp)
                            }
                        }
                    }
                } else {
                    Text(
                        text = "Nicht verbunden. Melde dich an, um automatische Drive-Backups zu aktivieren.",
                        color = TextSecondary,
                        fontSize = 12.sp
                    )

                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = AccentBlue,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp)
                            .clickable {
                                if (driveAuthManager != null) {
                                    val client = GoogleSignIn.getClient(context, driveAuthManager.getSignInOptions())
                                    signInLauncher.launch(client.signInIntent)
                                } else {
                                    onMessage("Drive-Authentifizierung nicht initialisiert.")
                                }
                            }
                    ) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(vertical = 10.dp)) {
                            Text("Mit Google anmelden", color = Color(0xFF081018), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

// ============================================================================
// 4. KONFLIKTE TAB
// ============================================================================

@Composable
private fun ConflictsTab(
    core: ImpalaCore,
    conflicts: List<ConflictInfo>,
    onSelectConflict: (ConflictInfo) -> Unit,
    onRefresh: () -> Unit,
    onMessage: (String) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Text("Sync-Konflikte lösen", color = TextMain, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(
                text = "Wenn dieselbe Seite auf zwei Geräten offline geändert wurde, kannst du hier die Unterschiede vergleichen und zusammenführen.",
                color = TextMuted,
                fontSize = 12.sp
            )
        }

        if (conflicts.isEmpty()) {
            item {
                Surface(
                    color = BgCard,
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, BorderHairline),
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp)
                ) {
                    Box(modifier = Modifier.padding(20.dp), contentAlignment = Alignment.Center) {
                        Text("Keine Konflikte vorhanden. Alles synchron!", color = SuccessGreen, fontSize = 13.sp)
                    }
                }
            }
        } else {
            items(conflicts, key = { it.key }) { conf ->
                Surface(
                    color = BgCard,
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, BorderHairline),
                    modifier = Modifier.fillMaxWidth().clickable { onSelectConflict(conf) }
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(conf.key, color = TextMain, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                            Text("Tippen zum Vergleichen & Lösen", color = AccentBlue, fontSize = 11.sp)
                        }
                        Icon(Icons.Rounded.WarningAmber, null, tint = WarningAmber, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}

// ============================================================================
// 5. DATEN & EXPORT TAB
// ============================================================================

@Composable
private fun DataExportTab(
    core: ImpalaCore,
    onMessage: (String) -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    var exportStatsText by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = BgCard),
            border = BorderStroke(1.dp, BorderHairline),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Backup & Daten-Export", color = TextMain, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                Text(
                    text = "Exportiere deinen gesamten Datenbestand als portable JSON-Datei inklusive aller Notizen, Hefte und Karteikarten.",
                    color = TextMuted,
                    fontSize = 12.sp
                )

                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = AccentBlue,
                    modifier = Modifier.clickable {
                        coroutineScope.launch(Dispatchers.IO) {
                            try {
                                val json = core.exportJson(false)
                                withContext(Dispatchers.Main) {
                                    exportStatsText = "Export bereit: ${(json.length / 1024)} KB"
                                    onMessage("Export-Datei erfolgreich generiert.")
                                }
                            } catch (e: Exception) {
                                withContext(Dispatchers.Main) {
                                    onMessage("Fehler: ${e.message}")
                                }
                            }
                        }
                    }
                ) {
                    Text("Vollständigen Export erstellen (JSON)", color = Color(0xFF081018), fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp))
                }

                if (exportStatsText != null) {
                    Text(exportStatsText ?: "", color = SuccessGreen, fontSize = 12.sp)
                }
            }
        }
    }
}

// ============================================================================
// Konflikt-Diff Dialog
// ============================================================================

@Composable
private fun ConflictDiffDialog(
    conflict: ConflictInfo,
    onDismiss: () -> Unit,
    onResolve: (ConflictResolution) -> Unit
) {
    val diffRows = remember(conflict) {
        try {
            val left = conflict.localContent ?: ""
            val right = conflict.remoteContent ?: ""
            conflictDiffRows(left, right) ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = BgElevated,
            border = BorderStroke(1.dp, BorderStrong),
            modifier = Modifier.fillMaxWidth().heightIn(max = 520.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Konflikt lösen: ${conflict.key}", color = TextMain, fontSize = 15.sp, fontWeight = FontWeight.Bold)

                LazyColumn(modifier = Modifier.weight(1f)) {
                    items(diffRows) { row ->
                        when (row) {
                            is DiffRow.Line -> {
                                if (row.changed) {
                                    if (row.left != null) Text("+ ${row.left}", color = SuccessGreen, fontSize = 12.sp)
                                    if (row.right != null) Text("- ${row.right}", color = DangerRed, fontSize = 12.sp)
                                } else {
                                    Text(row.left ?: row.right ?: "", color = TextMuted, fontSize = 12.sp)
                                }
                            }
                            is DiffRow.Gap -> Text("... ${row.count} Zeilen eingeklappt ...", color = TextLight, fontSize = 10.sp)
                        }
                    }
                }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = AccentBlue,
                        modifier = Modifier.weight(1f).clickable { onResolve(ConflictResolution.KEEP_WINNER) }
                    ) {
                        Text("Lokalen Stand behalten", color = Color(0xFF081018), fontWeight = FontWeight.Bold, fontSize = 11.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(vertical = 8.dp))
                    }
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = BgBubble,
                        border = BorderStroke(1.dp, BorderHairline),
                        modifier = Modifier.weight(1f).clickable { onResolve(ConflictResolution.USE_LOSER) }
                    ) {
                        Text("Cloud-Stand", color = TextMain, fontSize = 11.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(vertical = 8.dp))
                    }
                }
            }
        }
    }
}
