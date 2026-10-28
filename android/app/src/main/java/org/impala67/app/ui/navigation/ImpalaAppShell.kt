package org.impala67.app.ui.navigation

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.data.ImpalaRepository
import org.impala67.app.ui.components.ImpalaBreadcrumbs
import org.impala67.app.ui.components.ImpalaFloatingDock
import org.impala67.app.ui.components.ImpalaSidebarContent
import org.impala67.app.ui.components.QuickSearchDialog
import org.impala67.app.ui.editor.NoteEditorScreen
import org.impala67.app.ui.heft.HeftScreen
import org.impala67.app.ui.screens.AiChatSheet
import org.impala67.app.ui.screens.HomeScreen
import org.impala67.app.ui.screens.SettingsAndSyncSheet
import org.impala67.app.ui.screens.StudyScreen
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.EdgeSoft
import uniffi.impala_ffi.PageKind

/**
 * Navigationsziele innerhalb von Impala67
 */
sealed class NavTarget {
    data object Home : NavTarget()
    data class NoteEditor(val pageId: String) : NavTarget()
    data class Heft(val pageId: String) : NavTarget()
    data class Study(val deck: String? = null) : NavTarget()
}

/**
 * Haupt-Anwendungs-Shell: Verbindet Adaptive Layouts (Tablets vs. Smartphones),
 * Seitenleiste, Dock-Pille, Suche, KI-Sheet, Einstellungen und Screens.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImpalaAppShell(
    repository: ImpalaRepository,
    initialTarget: NavTarget? = null,
    onScanDocumentRequested: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()
    var currentTarget by remember { mutableStateOf<NavTarget>(initialTarget ?: NavTarget.Home) }

    // Overlays
    var isSearchOpen by remember { mutableStateOf(false) }
    var isAiSheetOpen by remember { mutableStateOf(false) }
    var isSettingsOpen by remember { mutableStateOf(false) }
    var isMobileSidebarOpen by remember { mutableStateOf(false) }

    // Sync-Zustand reaktiv abonnieren
    val syncUiModel by repository.syncManager.syncState.collectAsStateWithLifecycle()

    // Helfer zur Seitennavigation mit Typ-Erkennung
    fun navigateToPage(pageId: String) {
        coroutineScope.launch(Dispatchers.IO) {
            val page = repository.core.page(pageId)
            withContext(Dispatchers.Main) {
                if (page?.summary?.kind == PageKind.HEFT) {
                    currentTarget = NavTarget.Heft(pageId)
                } else {
                    currentTarget = NavTarget.NoteEditor(pageId)
                }
            }
        }
    }

    // Predictive Back Handler
    BackHandler(
        enabled = isSearchOpen || isAiSheetOpen || isSettingsOpen || isMobileSidebarOpen || currentTarget !is NavTarget.Home
    ) {
        when {
            isSearchOpen -> isSearchOpen = false
            isAiSheetOpen -> isAiSheetOpen = false
            isSettingsOpen -> isSettingsOpen = false
            isMobileSidebarOpen -> isMobileSidebarOpen = false
            currentTarget !is NavTarget.Home -> currentTarget = NavTarget.Home
        }
    }

    val currentActivePageId = when (val target = currentTarget) {
        is NavTarget.NoteEditor -> target.pageId
        is NavTarget.Heft -> target.pageId
        else -> null
    }

    BoxWithConstraints(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel)
    ) {
        val isTablet = maxWidth >= 720.dp

        if (isTablet) {
            // Tablet- & Desktop-Layout: Feste Seitenleiste links, Inhalt rechts
            Row(modifier = Modifier.fillMaxSize()) {
                ImpalaSidebarContent(
                    core = repository.core,
                    activePageId = currentActivePageId,
                    onNavigateToPage = { id -> navigateToPage(id) },
                    onNavigateHome = { currentTarget = NavTarget.Home },
                    onOpenSettings = { isSettingsOpen = true },
                    modifier = Modifier.width(280.dp)
                )

                VerticalDivider(color = EdgeSoft, thickness = 1.dp)

                Column(modifier = Modifier.weight(1f).fillMaxHeight()) {
                    // Brotkrumen oben
                    if (currentActivePageId != null) {
                        ImpalaBreadcrumbs(
                            pageId = currentActivePageId,
                            core = repository.core,
                            onNavigateToPage = { id -> navigateToPage(id) },
                            onNavigateHome = { currentTarget = NavTarget.Home }
                        )
                    }

                    // Haupt-Inhalt
                    Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                        ScreenHost(
                            currentTarget = currentTarget,
                            repository = repository,
                            syncUiModel = syncUiModel,
                            onNavigateToPage = { id -> navigateToPage(id) },
                            onNavigateHome = { currentTarget = NavTarget.Home },
                            onOpenStudy = { deck -> currentTarget = NavTarget.Study(deck) },
                            onScanDocument = {
                        coroutineScope.launch(Dispatchers.IO) {
                            try {
                                val id = repository.createHeft("Scan-Heft")
                                withContext(Dispatchers.Main) {
                                    currentTarget = NavTarget.Heft(id)
                                }
                            } catch (e: Exception) {
                                onScanDocumentRequested()
                            }
                        }
                    },
                            onOpenSyncAndSettings = { isSettingsOpen = true }
                        )
                    }
                }
            }
        } else {
            // Smartphone-Layout: Vollbild-Inhalte mit schwebendem Dock
            Box(modifier = Modifier.fillMaxSize()) {
                ScreenHost(
                    currentTarget = currentTarget,
                    repository = repository,
                    syncUiModel = syncUiModel,
                    onNavigateToPage = { id -> navigateToPage(id) },
                    onNavigateHome = { currentTarget = NavTarget.Home },
                    onOpenStudy = { deck -> currentTarget = NavTarget.Study(deck) },
                    onScanDocument = {
                        coroutineScope.launch(Dispatchers.IO) {
                            try {
                                val id = repository.createHeft("Scan-Heft")
                                withContext(Dispatchers.Main) {
                                    currentTarget = NavTarget.Heft(id)
                                }
                            } catch (e: Exception) {
                                onScanDocumentRequested()
                            }
                        }
                    },
                    onOpenSyncAndSettings = { isSettingsOpen = true }
                )

                // Schwebende Dock-Pille am unteren Rand (nur auf Home & Study aktiv)
                if (currentTarget is NavTarget.Home || currentTarget is NavTarget.Study) {
                    ImpalaFloatingDock(
                        currentRoute = if (currentTarget is NavTarget.Home) "home" else "study",
                        onNavigateHome = { currentTarget = NavTarget.Home },
                        onNewNote = {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val id = repository.createNote("Neue Notiz")
                                    withContext(Dispatchers.Main) { navigateToPage(id) }
                                } catch (e: Exception) {
                                    // Ignorieren
                                }
                            }
                        },
                        onNewHeft = {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val id = repository.createHeft("Neues Heft")
                                    withContext(Dispatchers.Main) { navigateToPage(id) }
                                } catch (e: Exception) {
                                    // Ignorieren
                                }
                            }
                        },
                        onOpenStudy = { currentTarget = NavTarget.Study() },
                        onOpenSearch = { isSearchOpen = true },
                        onOpenAi = { isAiSheetOpen = true },
                        onToggleSidebar = { isMobileSidebarOpen = true },
                        modifier = Modifier.align(Alignment.BottomCenter)
                    )
                }

                // Mobile Seitenleiste als ModalBottomSheet
                if (isMobileSidebarOpen) {
                    ModalBottomSheet(
                        onDismissRequest = { isMobileSidebarOpen = false },
                        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
                        containerColor = BgSidebar
                    ) {
                        ImpalaSidebarContent(
                            core = repository.core,
                            activePageId = currentActivePageId,
                            onNavigateToPage = { id ->
                                isMobileSidebarOpen = false
                                navigateToPage(id)
                            },
                            onNavigateHome = {
                                isMobileSidebarOpen = false
                                currentTarget = NavTarget.Home
                            },
                            onOpenSettings = {
                                isMobileSidebarOpen = false
                                isSettingsOpen = true
                            },
                            modifier = Modifier.fillMaxWidth().fillMaxHeight(0.85f)
                        )
                    }
                }
            }
        }

        // Schnellsuche (Strg+K / Lupe)
        QuickSearchDialog(
            core = repository.core,
            isOpen = isSearchOpen,
            onDismiss = { isSearchOpen = false },
            onSelectPage = { id -> navigateToPage(id) }
        )

        // KI-Assistent Sheet / Vollbild
        AnimatedVisibility(
            visible = isAiSheetOpen,
            enter = slideInVertically(initialOffsetY = { it }) + fadeIn(),
            exit = slideOutVertically(targetOffsetY = { it }) + fadeOut()
        ) {
            AiChatSheet(
                core = repository.core,
                activePageId = currentActivePageId,
                onClose = { isAiSheetOpen = false }
            )
        }

        // Einstellungen & Sync Sheet
        AnimatedVisibility(
            visible = isSettingsOpen,
            enter = slideInHorizontally(initialOffsetX = { it }) + fadeIn(),
            exit = slideOutHorizontally(targetOffsetX = { it }) + fadeOut()
        ) {
            SettingsAndSyncSheet(
                core = repository.core,
                syncUiModel = syncUiModel,
                onTriggerSync = { repository.syncManager.triggerSyncNow(forceAll = true) },
                onTriggerDriveBackup = { repository.syncManager.triggerDriveSyncNow() },
                onCompactCloud = {
                    repository.syncManager.compactCloud(bypassCooldown = false)
                },
                onSaveSyncKey = { key ->
                    repository.securePrefs.cfSyncKey = key
                    repository.syncManager.configureCloudSync(key, repository.securePrefs.cfWorkerUrl)
                },
                onClose = { isSettingsOpen = false }
            )
        }
    }
}

@Composable
private fun ScreenHost(
    currentTarget: NavTarget,
    repository: ImpalaRepository,
    syncUiModel: org.impala67.app.data.SyncUiModel?,
    onNavigateToPage: (String) -> Unit,
    onNavigateHome: () -> Unit,
    onOpenStudy: (String?) -> Unit,
    onScanDocument: () -> Unit,
    onOpenSyncAndSettings: () -> Unit
) {
    when (currentTarget) {
        is NavTarget.Home -> {
            HomeScreen(
                core = repository.core,
                syncUiModel = syncUiModel,
                onOpenNote = { id -> onNavigateToPage(id) },
                onOpenHeft = { id -> onNavigateToPage(id) },
                onStartStudy = { deck -> onOpenStudy(deck) },
                onScanDocument = onScanDocument,
                onOpenSyncAndSettings = onOpenSyncAndSettings
            )
        }
        is NavTarget.NoteEditor -> {
            NoteEditorScreen(
                pageId = currentTarget.pageId,
                repository = repository,
                onNavigateToPage = onNavigateToPage,
                onBack = onNavigateHome
            )
        }
        is NavTarget.Heft -> {
            HeftScreen(
                pageId = currentTarget.pageId,
                repository = repository,
                onBack = onNavigateHome
            )
        }
        is NavTarget.Study -> {
            StudyScreen(
                core = repository.core,
                initialDeck = currentTarget.deck,
                onBack = onNavigateHome
            )
        }
    }
}
