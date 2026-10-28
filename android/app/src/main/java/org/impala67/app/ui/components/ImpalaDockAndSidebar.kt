package org.impala67.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.NavigateNext
import androidx.compose.material.icons.automirrored.rounded.Note
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Archive
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.AutoStories
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.DriveFileMove
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Hub
import androidx.compose.material.icons.rounded.LibraryBooks
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.OpenInNew
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material.icons.rounded.Style
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
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
import org.impala67.app.ui.theme.AccentBlue
import org.impala67.app.ui.theme.AccentBlueSoft
import org.impala67.app.ui.theme.AccentBorder
import org.impala67.app.ui.theme.AccentGreen
import org.impala67.app.ui.theme.AccentOrange
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.AccentViolet
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgCard
import org.impala67.app.ui.theme.BgElevated
import org.impala67.app.ui.theme.BgHover
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.BorderHairline
import org.impala67.app.ui.theme.BorderStrong
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.DangerRed
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.EdgeSoft
import org.impala67.app.ui.theme.ImpalaBouncySpringFloat
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.SuccessGreen
import org.impala67.app.ui.theme.SurfaceActive
import org.impala67.app.ui.theme.SurfaceHover
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextLight
import org.impala67.app.ui.theme.TextMain
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.WarningAmber
import uniffi.impala_ffi.ChatInfo
import uniffi.impala_ffi.DeckOverview
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.SearchHit
import uniffi.impala_ffi.WorkspaceInfo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * 1:1 PWA-Seitenleiste (`#sidebar`) für Tablet- und Handy-Querformat-Ansicht:
 * - Oben `.topbar` mit 3 Mode-Pills (`🏠 Home`, `💬 Chat`, `🃏 Karten`) + Rechts `🔍` Suche
 * - Mitte scrollbarer `#tree` (je nach `sidebarMode`: `"files"`, `"chats"`, `"anki"`)
 * - Unten `.side-foot` mit den 5 originalen PWA-Einträgen:
 *   1. `✦ Gemini Notebook`
 *   2. `🕸️ Wissensgraph`
 *   3. `📚 Bibliothek`
 *   4. `🗑️ Papierkorb` (mit Zähler-Badge)
 *   5. `⚙️ Einstellungen` (mit Sync-Punkt)
 */
@Composable
fun ImpalaPwaSidebar(
    core: ImpalaCore,
    sidebarMode: String,
    onSidebarModeChange: (String) -> Unit,
    activePageId: String?,
    activeChatId: String?,
    activeDeckName: String?,
    activeSpecialRoute: String?,
    favoritePageIds: Set<String>,
    onToggleFavorite: (String) -> Unit,
    onOpenPage: (pageId: String, inNewTab: Boolean) -> Unit,
    onOpenHome: () -> Unit,
    onOpenSearch: () -> Unit,
    onOpenNewTemplateModal: (workspaceId: String?, parentId: String?) -> Unit,
    onOpenChat: (chatId: String?) -> Unit,
    onOpenStudyDeck: (deckName: String?) -> Unit,
    onOpenNotebookLm: () -> Unit,
    onOpenGraph: () -> Unit,
    onOpenLibrary: () -> Unit,
    onOpenTrash: () -> Unit,
    onOpenSettings: () -> Unit,
    syncState: SyncUiModel?,
    refreshTrigger: Int,
    onMutation: () -> Unit,
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()

    var workspaces by remember { mutableStateOf<List<WorkspaceInfo>>(emptyList()) }
    var recentAllPages by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    var chats by remember { mutableStateOf<List<ChatInfo>>(emptyList()) }
    var decks by remember { mutableStateOf<List<DeckOverview>>(emptyList()) }
    var trashCount by remember { mutableIntStateOf(0) }

    val collapsedWorkspaces = remember { mutableStateListOf<String>() }
    val expandedPageIds = remember { mutableStateListOf<String>() }
    val collapsedDeckPrefixes = remember { mutableStateListOf<String>() }
    var isFavoritesExpanded by remember { mutableStateOf(true) }

    // Dialog-Zustände für Workspace / Stapel
    var showCreateWorkspaceDialog by remember { mutableStateOf(false) }
    var workspaceDialogInput by remember { mutableStateOf("") }
    var workspaceToRename by remember { mutableStateOf<WorkspaceInfo?>(null) }

    var showCreateDeckDialog by remember { mutableStateOf(false) }
    var newDeckInput by remember { mutableStateOf("") }

    var pageToRename by remember { mutableStateOf<PageSummary?>(null) }
    var renamePageInput by remember { mutableStateOf("") }
    var pageToMoveWorkspace by remember { mutableStateOf<PageSummary?>(null) }

    val utcOffsetMinutes = remember {
        TimeZone.getDefault().getOffset(System.currentTimeMillis()) / (1000 * 60)
    }

    fun reloadSidebarData() {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val wsList = core.workspaces().ifEmpty {
                    listOf(WorkspaceInfo(id = "default", name = "Notizen"))
                }
                val recents = core.recentPages(200u)
                val chatList = core.chats()
                val deckList = core.deckOverview(utcOffsetMinutes, false)
                val trashed = core.trashedPages().size
                withContext(Dispatchers.Main) {
                    workspaces = wsList
                    recentAllPages = recents
                    chats = chatList
                    decks = deckList
                    trashCount = trashed
                }
            } catch (_: Exception) {
            }
        }
    }

    LaunchedEffect(refreshTrigger, sidebarMode) {
        reloadSidebarData()
    }

    Column(
        modifier = modifier
            .fillMaxHeight()
            .background(BgSidebar)
    ) {
        // 1. Oben: .topbar Mode-Pills + Suche-Button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(40.dp)
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.weight(1f)
            ) {
                SidebarModePill(
                    emoji = "🏠",
                    label = "Home",
                    isSelected = sidebarMode == "files",
                    onClick = {
                        onSidebarModeChange("files")
                        onOpenHome()
                    }
                )
                SidebarModePill(
                    emoji = "💬",
                    label = "Chat",
                    isSelected = sidebarMode == "chats",
                    onClick = {
                        onSidebarModeChange("chats")
                    }
                )
                SidebarModePill(
                    emoji = "🃏",
                    label = "Karten",
                    isSelected = sidebarMode == "anki",
                    onClick = {
                        onSidebarModeChange("anki")
                        onOpenStudyDeck(null)
                    }
                )
            }

            // Rechtsbündig: #btnSearch
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .clip(RoundedCornerShape(7.dp))
                    .clickable(onClick = onOpenSearch),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Rounded.Search,
                    contentDescription = "Schnellsuche (Cmd+K)",
                    tint = TextMuted,
                    modifier = Modifier.size(16.dp)
                )
            }
        }

        HorizontalDivider(color = BorderHairline, thickness = 1.dp)

        // 2. Mitte: Scrollbarer #tree je nach aktivem sidebarMode
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        ) {
            when (sidebarMode) {
                "chats" -> {
                    SidebarChatsTree(
                        chats = chats,
                        activeChatId = activeChatId,
                        onNewChat = { onOpenChat(null) },
                        onSelectChat = { id -> onOpenChat(id) },
                        onDeleteChat = { id ->
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    core.deleteChat(id)
                                    withContext(Dispatchers.Main) {
                                        reloadSidebarData()
                                        onMutation()
                                    }
                                } catch (_: Exception) {
                                }
                            }
                        }
                    )
                }

                "anki" -> {
                    SidebarAnkiTree(
                        decks = decks,
                        activeDeckName = activeDeckName,
                        isStudyRouteActive = activeSpecialRoute == "study",
                        collapsedPrefixes = collapsedDeckPrefixes,
                        onOpenAllDecks = { onOpenStudyDeck(null) },
                        onSelectDeck = { deckName -> onOpenStudyDeck(deckName) },
                        onCreateDeckClick = {
                            newDeckInput = ""
                            showCreateDeckDialog = true
                        }
                    )
                }

                else -> {
                    // "files" Modus: Favoriten + Arbeitsbereiche + Hierarchischer Seitenbaum
                    val favoritePages = remember(recentAllPages, favoritePageIds) {
                        recentAllPages.filter { favoritePageIds.contains(it.id) }
                    }

                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(vertical = 6.dp, horizontal = 6.dp)
                    ) {
                        // ★ Favoriten-Sektion (falls nicht leer)
                        if (favoritePages.isNotEmpty()) {
                            item(key = "fav_header") {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(6.dp))
                                        .clickable { isFavoritesExpanded = !isFavoritesExpanded }
                                        .padding(horizontal = 6.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = if (isFavoritesExpanded) "▾" else "▸",
                                        color = TextMuted,
                                        fontSize = 11.sp,
                                        modifier = Modifier.width(14.dp)
                                    )
                                    Text(
                                        text = "★ FAVORITEN",
                                        color = TextMuted,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        letterSpacing = 0.7.sp,
                                        modifier = Modifier.weight(1f)
                                    )
                                }
                            }

                            if (isFavoritesExpanded) {
                                items(favoritePages, key = { "fav_${it.id}" }) { favPage ->
                                    val isCurrent = favPage.id == activePageId
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(7.dp))
                                            .background(if (isCurrent) AccentBlueSoft else Color.Transparent)
                                            .clickable { onOpenPage(favPage.id, false) }
                                            .padding(start = 18.dp, end = 6.dp, top = 5.dp, bottom = 5.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text(
                                            text = if (favPage.kind == PageKind.HEFT) "📓" else "📄",
                                            fontSize = 13.sp
                                        )
                                        Spacer(modifier = Modifier.width(7.dp))
                                        Text(
                                            text = favPage.title.ifBlank { "Ohne Titel" },
                                            color = if (isCurrent) TextMain else TextSecondary,
                                            fontSize = 13.sp,
                                            fontWeight = if (isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                            modifier = Modifier.weight(1f)
                                        )
                                        IconButton(
                                            onClick = { onToggleFavorite(favPage.id) },
                                            modifier = Modifier.size(20.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Rounded.Star,
                                                contentDescription = "Aus Favoriten entfernen",
                                                tint = WarningAmber,
                                                modifier = Modifier.size(13.dp)
                                            )
                                        }
                                    }
                                }
                                item(key = "fav_spacer") {
                                    Spacer(modifier = Modifier.height(8.dp))
                                }
                            }
                        }

                        // Arbeitsbereiche (core.workspaces())
                        items(workspaces, key = { "ws_${it.id}" }) { ws ->
                            val isCollapsed = collapsedWorkspaces.contains(ws.id)
                            var wsMenuExpanded by remember { mutableStateOf(false) }

                            Column(modifier = Modifier.fillMaxWidth()) {
                                // .ws-head Zeile
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(6.dp))
                                        .clickable {
                                            if (isCollapsed) collapsedWorkspaces.remove(ws.id)
                                            else collapsedWorkspaces.add(ws.id)
                                        }
                                        .padding(horizontal = 6.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = if (isCollapsed) "▸" else "▾",
                                        color = TextMuted,
                                        fontSize = 11.sp,
                                        modifier = Modifier.width(14.dp)
                                    )
                                    Text(
                                        text = ws.name.ifBlank { "NOTIZEN" }.uppercase(),
                                        color = TextMuted,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        letterSpacing = 0.7.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f)
                                    )

                                    // + Button (öffnet "Neu anlegen" Modal für diesen Workspace)
                                    Box(
                                        modifier = Modifier
                                            .size(22.dp)
                                            .clip(RoundedCornerShape(5.dp))
                                            .clickable { onOpenNewTemplateModal(ws.id, null) },
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Icon(
                                            imageVector = Icons.Rounded.Add,
                                            contentDescription = "Neu in ${ws.name}",
                                            tint = TextMuted,
                                            modifier = Modifier.size(14.dp)
                                        )
                                    }

                                    // ⋯ Workspace-Menü
                                    Box {
                                        Box(
                                            modifier = Modifier
                                                .size(22.dp)
                                                .clip(RoundedCornerShape(5.dp))
                                                .clickable { wsMenuExpanded = true },
                                            contentAlignment = Alignment.Center
                                        ) {
                                            Icon(
                                                imageVector = Icons.Rounded.MoreHoriz,
                                                contentDescription = "Arbeitsbereich-Optionen",
                                                tint = TextMuted,
                                                modifier = Modifier.size(14.dp)
                                            )
                                        }

                                        DropdownMenu(
                                            expanded = wsMenuExpanded,
                                            onDismissRequest = { wsMenuExpanded = false },
                                            modifier = Modifier.background(BgElevated)
                                        ) {
                                            DropdownMenuItem(
                                                text = { Text("Umbenennen", color = TextMain, fontSize = 13.sp) },
                                                leadingIcon = {
                                                    Icon(Icons.Rounded.Edit, null, tint = TextSecondary, modifier = Modifier.size(16.dp))
                                                },
                                                onClick = {
                                                    wsMenuExpanded = false
                                                    workspaceToRename = ws
                                                    workspaceDialogInput = ws.name
                                                }
                                            )
                                            DropdownMenuItem(
                                                text = { Text("Neuer Arbeitsbereich", color = AccentBlue, fontSize = 13.sp) },
                                                leadingIcon = {
                                                    Icon(Icons.Rounded.Add, null, tint = AccentBlue, modifier = Modifier.size(16.dp))
                                                },
                                                onClick = {
                                                    wsMenuExpanded = false
                                                    workspaceDialogInput = ""
                                                    showCreateWorkspaceDialog = true
                                                }
                                            )
                                            if (ws.id != "default" && workspaces.size > 1) {
                                                HorizontalDivider(color = BorderHairline)
                                                DropdownMenuItem(
                                                    text = { Text("Löschen", color = DangerRed, fontSize = 13.sp) },
                                                    leadingIcon = {
                                                        Icon(Icons.Rounded.DeleteOutline, null, tint = DangerRed, modifier = Modifier.size(16.dp))
                                                    },
                                                    onClick = {
                                                        wsMenuExpanded = false
                                                        coroutineScope.launch(Dispatchers.IO) {
                                                            try {
                                                                core.dispatch("workspaceDelete", """{"id":"${ws.id}"}""")
                                                                withContext(Dispatchers.Main) {
                                                                    reloadSidebarData()
                                                                    onMutation()
                                                                }
                                                            } catch (_: Exception) {
                                                            }
                                                        }
                                                    }
                                                )
                                            }
                                        }
                                    }
                                }

                                // Rekursiver, hierarchischer Seitenbaum dieses Workspaces
                                AnimatedVisibility(
                                    visible = !isCollapsed,
                                    enter = expandVertically() + fadeIn(),
                                    exit = shrinkVertically() + fadeOut()
                                ) {
                                    WorkspacePageTreeSection(
                                        core = core,
                                        workspaceId = ws.id,
                                        activePageId = activePageId,
                                        favoritePageIds = favoritePageIds,
                                        expandedPageIds = expandedPageIds,
                                        refreshTrigger = refreshTrigger,
                                        onOpenPage = onOpenPage,
                                        onCreateSubPage = { parentId ->
                                            onOpenNewTemplateModal(ws.id, parentId)
                                        },
                                        onRenameRequest = { pg ->
                                            pageToRename = pg
                                            renamePageInput = pg.title
                                        },
                                        onDuplicatePage = { pg ->
                                            coroutineScope.launch(Dispatchers.IO) {
                                                try {
                                                    val detail = core.page(pg.id)
                                                    val copyTitle = "${pg.title.ifBlank { "Ohne Titel" }} (Kopie)"
                                                    val newId = if (pg.kind == PageKind.HEFT) {
                                                        core.createHeft(copyTitle, pg.parentId, pg.workspaceId)
                                                    } else {
                                                        core.createPage(
                                                            copyTitle,
                                                            detail?.content ?: "",
                                                            pg.parentId,
                                                            pg.workspaceId
                                                        )
                                                    }
                                                    withContext(Dispatchers.Main) {
                                                        reloadSidebarData()
                                                        onMutation()
                                                        onOpenPage(newId, false)
                                                    }
                                                } catch (_: Exception) {
                                                }
                                            }
                                        },
                                        onToggleFavorite = onToggleFavorite,
                                        onMoveWorkspaceRequest = { pg ->
                                            pageToMoveWorkspace = pg
                                        },
                                        onArchivePage = { pg ->
                                            coroutineScope.launch(Dispatchers.IO) {
                                                try {
                                                    core.archivePage(pg.id)
                                                    withContext(Dispatchers.Main) {
                                                        reloadSidebarData()
                                                        onMutation()
                                                    }
                                                } catch (_: Exception) {
                                                }
                                            }
                                        },
                                        onTrashPage = { pg ->
                                            coroutineScope.launch(Dispatchers.IO) {
                                                try {
                                                    core.trashPage(pg.id)
                                                    withContext(Dispatchers.Main) {
                                                        reloadSidebarData()
                                                        onMutation()
                                                    }
                                                } catch (_: Exception) {
                                                }
                                            }
                                        }
                                    )
                                }

                                Spacer(modifier = Modifier.height(6.dp))
                            }
                        }
                    }
                }
            }
        }

        // 3. Unten: .side-foot (Die 5 originalen PWA-Footer-Einträge)
        HorizontalDivider(color = BorderHairline, thickness = 1.dp)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 6.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            SidebarFooterRow(
                emoji = "✦",
                label = "Gemini Notebook",
                isActive = activeSpecialRoute == "notebooklm",
                onClick = onOpenNotebookLm
            )
            SidebarFooterRow(
                emoji = "🕸️",
                label = "Wissensgraph",
                isActive = activeSpecialRoute == "graph",
                onClick = onOpenGraph
            )
            SidebarFooterRow(
                emoji = "📚",
                label = "Bibliothek",
                isActive = activeSpecialRoute == "library",
                onClick = onOpenLibrary
            )
            SidebarFooterRow(
                emoji = "🗑️",
                label = "Papierkorb",
                isActive = activeSpecialRoute == "trash",
                badgeText = if (trashCount > 0) trashCount.toString() else null,
                onClick = onOpenTrash
            )
            val syncDotColor = when (syncState) {
                is SyncUiModel.Synced, is SyncUiModel.Idle -> SuccessGreen
                is SyncUiModel.Syncing -> AccentBlue
                is SyncUiModel.Error -> DangerRed
                else -> TextMuted
            }
            SidebarFooterRow(
                emoji = "⚙️",
                label = "Einstellungen",
                isActive = false,
                statusDotColor = syncDotColor,
                onClick = onOpenSettings
            )
        }
    }

    // --- Dialoge für Seiten, Workspaces und Stapel ---

    // 1. Seite umbenennen
    val targetRenamePage = pageToRename
    if (targetRenamePage != null) {
        AlertDialog(
            onDismissRequest = { pageToRename = null },
            title = { Text("Seite umbenennen", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                BasicTextField(
                    value = renamePageInput,
                    onValueChange = { renamePageInput = it },
                    textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                    cursorBrush = SolidColor(AccentBlue),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BgBubble, RoundedCornerShape(8.dp))
                        .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                        .padding(12.dp)
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val newTitle = renamePageInput.trim().ifBlank { "Ohne Titel" }
                        pageToRename = null
                        coroutineScope.launch(Dispatchers.IO) {
                            try {
                                core.updatePage(targetRenamePage.id, newTitle, null)
                                withContext(Dispatchers.Main) {
                                    reloadSidebarData()
                                    onMutation()
                                }
                            } catch (_: Exception) {
                            }
                        }
                    }
                ) {
                    Text("Speichern", color = AccentBlue)
                }
            },
            dismissButton = {
                TextButton(onClick = { pageToRename = null }) {
                    Text("Abbrechen", color = TextMuted)
                }
            },
            containerColor = BgElevated
        )
    }

    // 2. Seite in anderen Arbeitsbereich verschieben
    val targetMovePage = pageToMoveWorkspace
    if (targetMovePage != null) {
        AlertDialog(
            onDismissRequest = { pageToMoveWorkspace = null },
            title = { Text("In Arbeitsbereich verschieben", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (ws in workspaces) {
                        val isCurrentWs = ws.id == targetMovePage.workspaceId
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (isCurrentWs) AccentBlueSoft else BgBubble)
                                .clickable {
                                    pageToMoveWorkspace = null
                                    coroutineScope.launch(Dispatchers.IO) {
                                        try {
                                            core.movePageToWorkspace(targetMovePage.id, ws.id)
                                            withContext(Dispatchers.Main) {
                                                reloadSidebarData()
                                                onMutation()
                                            }
                                        } catch (_: Exception) {
                                        }
                                    }
                                }
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Folder,
                                contentDescription = null,
                                tint = if (isCurrentWs) AccentBlue else TextSecondary,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Text(
                                text = ws.name,
                                color = if (isCurrentWs) AccentBlue else TextMain,
                                fontSize = 14.sp,
                                fontWeight = if (isCurrentWs) FontWeight.SemiBold else FontWeight.Normal
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { pageToMoveWorkspace = null }) {
                    Text("Schließen", color = TextMuted)
                }
            },
            containerColor = BgElevated
        )
    }

    // 3. Neuer Arbeitsbereich
    if (showCreateWorkspaceDialog) {
        AlertDialog(
            onDismissRequest = { showCreateWorkspaceDialog = false },
            title = { Text("Neuer Arbeitsbereich", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                BasicTextField(
                    value = workspaceDialogInput,
                    onValueChange = { workspaceDialogInput = it },
                    textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                    cursorBrush = SolidColor(AccentBlue),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BgBubble, RoundedCornerShape(8.dp))
                        .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                        .padding(12.dp)
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val name = workspaceDialogInput.trim()
                        showCreateWorkspaceDialog = false
                        if (name.isNotEmpty()) {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    core.createWorkspace(name)
                                    withContext(Dispatchers.Main) {
                                        reloadSidebarData()
                                        onMutation()
                                    }
                                } catch (_: Exception) {
                                }
                            }
                        }
                    }
                ) {
                    Text("Anlegen", color = AccentBlue)
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateWorkspaceDialog = false }) {
                    Text("Abbrechen", color = TextMuted)
                }
            },
            containerColor = BgElevated
        )
    }

    // 4. Arbeitsbereich umbenennen
    val targetRenameWs = workspaceToRename
    if (targetRenameWs != null) {
        AlertDialog(
            onDismissRequest = { workspaceToRename = null },
            title = { Text("Arbeitsbereich umbenennen", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                BasicTextField(
                    value = workspaceDialogInput,
                    onValueChange = { workspaceDialogInput = it },
                    textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                    cursorBrush = SolidColor(AccentBlue),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BgBubble, RoundedCornerShape(8.dp))
                        .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                        .padding(12.dp)
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val name = workspaceDialogInput.trim()
                        workspaceToRename = null
                        if (name.isNotEmpty()) {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val escaped = name.replace("\"", "\\\"")
                                    core.dispatch("workspaceUpdate", """{"id":"${targetRenameWs.id}","name":"$escaped"}""")
                                    withContext(Dispatchers.Main) {
                                        reloadSidebarData()
                                        onMutation()
                                    }
                                } catch (_: Exception) {
                                }
                            }
                        }
                    }
                ) {
                    Text("Speichern", color = AccentBlue)
                }
            },
            dismissButton = {
                TextButton(onClick = { workspaceToRename = null }) {
                    Text("Abbrechen", color = TextMuted)
                }
            },
            containerColor = BgElevated
        )
    }

    // 5. Neuer Stapel
    if (showCreateDeckDialog) {
        AlertDialog(
            onDismissRequest = { showCreateDeckDialog = false },
            title = { Text("Neuer Stapel", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                Column {
                    Text(
                        text = "Tipp: Nutze 'Fach::Thema' für Unterstapel.",
                        color = TextMuted,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                    BasicTextField(
                        value = newDeckInput,
                        onValueChange = { newDeckInput = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(BgBubble, RoundedCornerShape(8.dp))
                            .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                            .padding(12.dp)
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val name = newDeckInput.trim()
                        showCreateDeckDialog = false
                        if (name.isNotEmpty()) {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val created = core.createDeck(name)
                                    withContext(Dispatchers.Main) {
                                        reloadSidebarData()
                                        onMutation()
                                        onOpenStudyDeck(created)
                                    }
                                } catch (_: Exception) {
                                }
                            }
                        }
                    }
                ) {
                    Text("Anlegen", color = AccentBlue)
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateDeckDialog = false }) {
                    Text("Abbrechen", color = TextMuted)
                }
            },
            containerColor = BgElevated
        )
    }
}

@Composable
private fun SidebarModePill(
    emoji: String,
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val bg = if (isSelected) BgElevated else Color.Transparent
    val borderCol = if (isSelected) BorderStrong else Color.Transparent
    val textCol = if (isSelected) TextMain else TextMuted

    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
            .border(1.dp, borderCol, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = if (isSelected) 9.dp else 7.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(text = emoji, fontSize = 12.sp)
        if (isSelected) {
            Text(
                text = label,
                color = textCol,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1
            )
        }
    }
}

@Composable
private fun SidebarFooterRow(
    emoji: String,
    label: String,
    isActive: Boolean,
    badgeText: String? = null,
    statusDotColor: Color? = null,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(7.dp))
            .background(if (isActive) AccentBlueSoft else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = emoji,
            fontSize = 13.sp,
            color = if (isActive) AccentBlue else TextSecondary,
            modifier = Modifier.width(20.dp)
        )
        Text(
            text = label,
            color = if (isActive) TextMain else TextSecondary,
            fontSize = 12.5.sp,
            fontWeight = if (isActive) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        if (badgeText != null) {
            Box(
                modifier = Modifier
                    .background(BgBubble, ImpalaPillShape)
                    .padding(horizontal = 6.dp, vertical = 1.dp)
            ) {
                Text(
                    text = badgeText,
                    color = TextMuted,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }
        if (statusDotColor != null) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(statusDotColor)
            )
        }
    }
}

@Composable
private fun WorkspacePageTreeSection(
    core: ImpalaCore,
    workspaceId: String,
    activePageId: String?,
    favoritePageIds: Set<String>,
    expandedPageIds: MutableList<String>,
    refreshTrigger: Int,
    onOpenPage: (pageId: String, inNewTab: Boolean) -> Unit,
    onCreateSubPage: (parentId: String) -> Unit,
    onRenameRequest: (PageSummary) -> Unit,
    onDuplicatePage: (PageSummary) -> Unit,
    onToggleFavorite: (String) -> Unit,
    onMoveWorkspaceRequest: (PageSummary) -> Unit,
    onArchivePage: (PageSummary) -> Unit,
    onTrashPage: (PageSummary) -> Unit
) {
    var rootPages by remember(workspaceId, refreshTrigger) { mutableStateOf<List<PageSummary>>(emptyList()) }

    LaunchedEffect(workspaceId, refreshTrigger) {
        withContext(Dispatchers.IO) {
            try {
                rootPages = core.childrenOf(null, workspaceId)
            } catch (_: Exception) {
                rootPages = emptyList()
            }
        }
    }

    Column(modifier = Modifier.fillMaxWidth()) {
        if (rootPages.isEmpty()) {
            Text(
                text = "Keine Seiten",
                color = TextLight,
                fontSize = 11.5.sp,
                modifier = Modifier.padding(start = 20.dp, top = 2.dp, bottom = 4.dp)
            )
        } else {
            for (page in rootPages) {
                RecursivePageTreeRow(
                    page = page,
                    depth = 0,
                    core = core,
                    workspaceId = workspaceId,
                    activePageId = activePageId,
                    favoritePageIds = favoritePageIds,
                    expandedPageIds = expandedPageIds,
                    refreshTrigger = refreshTrigger,
                    onOpenPage = onOpenPage,
                    onCreateSubPage = onCreateSubPage,
                    onRenameRequest = onRenameRequest,
                    onDuplicatePage = onDuplicatePage,
                    onToggleFavorite = onToggleFavorite,
                    onMoveWorkspaceRequest = onMoveWorkspaceRequest,
                    onArchivePage = onArchivePage,
                    onTrashPage = onTrashPage
                )
            }
        }
    }
}

@Composable
private fun RecursivePageTreeRow(
    page: PageSummary,
    depth: Int,
    core: ImpalaCore,
    workspaceId: String,
    activePageId: String?,
    favoritePageIds: Set<String>,
    expandedPageIds: MutableList<String>,
    refreshTrigger: Int,
    onOpenPage: (pageId: String, inNewTab: Boolean) -> Unit,
    onCreateSubPage: (parentId: String) -> Unit,
    onRenameRequest: (PageSummary) -> Unit,
    onDuplicatePage: (PageSummary) -> Unit,
    onToggleFavorite: (String) -> Unit,
    onMoveWorkspaceRequest: (PageSummary) -> Unit,
    onArchivePage: (PageSummary) -> Unit,
    onTrashPage: (PageSummary) -> Unit
) {
    val isExpanded = expandedPageIds.contains(page.id)
    val isActive = page.id == activePageId
    val isFavorite = favoritePageIds.contains(page.id)
    var children by remember(page.id, refreshTrigger) { mutableStateOf<List<PageSummary>>(emptyList()) }
    var menuExpanded by remember { mutableStateOf(false) }

    LaunchedEffect(page.id, isExpanded, refreshTrigger) {
        withContext(Dispatchers.IO) {
            try {
                children = core.childrenOf(page.id, workspaceId)
            } catch (_: Exception) {
                children = emptyList()
            }
        }
    }

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = (depth * 12).dp)
                .clip(RoundedCornerShape(7.dp))
                .background(if (isActive) AccentBlueSoft else Color.Transparent)
                .clickable { onOpenPage(page.id, false) }
                .padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Aufklapp-Chevron
            Box(
                modifier = Modifier
                    .size(18.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .clickable {
                        if (isExpanded) expandedPageIds.remove(page.id)
                        else expandedPageIds.add(page.id)
                    },
                contentAlignment = Alignment.Center
            ) {
                if (children.isNotEmpty()) {
                    Text(
                        text = if (isExpanded) "▾" else "▸",
                        color = TextMuted,
                        fontSize = 11.sp
                    )
                } else {
                    Text(
                        text = "•",
                        color = TextLight.copy(alpha = 0.5f),
                        fontSize = 10.sp
                    )
                }
            }

            // Seiten-Icon (📄 oder 📓 für Heft)
            Text(
                text = if (page.kind == PageKind.HEFT) "📓" else "📄",
                fontSize = 13.sp,
                modifier = Modifier.padding(end = 6.dp)
            )

            // Titel
            Text(
                text = page.title.ifBlank { "Ohne Titel" },
                color = if (isActive) TextMain else TextSecondary,
                fontWeight = if (isActive) FontWeight.SemiBold else FontWeight.Normal,
                fontSize = 12.5.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )

            // Rechts: + (Unterseite erstellen)
            Box(
                modifier = Modifier
                    .size(20.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .clickable {
                        if (!isExpanded) expandedPageIds.add(page.id)
                        onCreateSubPage(page.id)
                    },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Rounded.Add,
                    contentDescription = "Unterseite erstellen",
                    tint = TextMuted,
                    modifier = Modifier.size(13.dp)
                )
            }

            // Rechts: ⋯ Kontextmenü
            Box {
                Box(
                    modifier = Modifier
                        .size(20.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .clickable { menuExpanded = true },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Rounded.MoreHoriz,
                        contentDescription = "Seiten-Menü",
                        tint = TextMuted,
                        modifier = Modifier.size(13.dp)
                    )
                }

                DropdownMenu(
                    expanded = menuExpanded,
                    onDismissRequest = { menuExpanded = false },
                    modifier = Modifier.background(BgElevated)
                ) {
                    DropdownMenuItem(
                        text = { Text("In neuem Tab öffnen", color = TextMain, fontSize = 13.sp) },
                        leadingIcon = {
                            Icon(Icons.Rounded.OpenInNew, null, tint = AccentBlue, modifier = Modifier.size(16.dp))
                        },
                        onClick = {
                            menuExpanded = false
                            onOpenPage(page.id, true)
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Umbenennen", color = TextMain, fontSize = 13.sp) },
                        leadingIcon = {
                            Icon(Icons.Rounded.Edit, null, tint = TextSecondary, modifier = Modifier.size(16.dp))
                        },
                        onClick = {
                            menuExpanded = false
                            onRenameRequest(page)
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Duplizieren", color = TextMain, fontSize = 13.sp) },
                        leadingIcon = {
                            Icon(Icons.Rounded.ContentCopy, null, tint = TextSecondary, modifier = Modifier.size(16.dp))
                        },
                        onClick = {
                            menuExpanded = false
                            onDuplicatePage(page)
                        }
                    )
                    DropdownMenuItem(
                        text = {
                            Text(
                                if (isFavorite) "★ Aus Favoriten entfernen" else "★ Zu Favoriten hinzufügen",
                                color = TextMain,
                                fontSize = 13.sp
                            )
                        },
                        leadingIcon = {
                            Icon(
                                if (isFavorite) Icons.Rounded.Star else Icons.Rounded.StarBorder,
                                null,
                                tint = WarningAmber,
                                modifier = Modifier.size(16.dp)
                            )
                        },
                        onClick = {
                            menuExpanded = false
                            onToggleFavorite(page.id)
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("In anderen Arbeitsbereich verschieben", color = TextMain, fontSize = 13.sp) },
                        leadingIcon = {
                            Icon(Icons.Rounded.DriveFileMove, null, tint = TextSecondary, modifier = Modifier.size(16.dp))
                        },
                        onClick = {
                            menuExpanded = false
                            onMoveWorkspaceRequest(page)
                        }
                    )
                    HorizontalDivider(color = BorderHairline)
                    DropdownMenuItem(
                        text = { Text("Archivieren", color = TextSecondary, fontSize = 13.sp) },
                        leadingIcon = {
                            Icon(Icons.Rounded.Archive, null, tint = TextSecondary, modifier = Modifier.size(16.dp))
                        },
                        onClick = {
                            menuExpanded = false
                            onArchivePage(page)
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("🗑️ In Papierkorb", color = DangerRed, fontSize = 13.sp) },
                        leadingIcon = {
                            Icon(Icons.Rounded.Delete, null, tint = DangerRed, modifier = Modifier.size(16.dp))
                        },
                        onClick = {
                            menuExpanded = false
                            onTrashPage(page)
                        }
                    )
                }
            }
        }

        if (isExpanded && children.isNotEmpty()) {
            for (child in children) {
                RecursivePageTreeRow(
                    page = child,
                    depth = depth + 1,
                    core = core,
                    workspaceId = workspaceId,
                    activePageId = activePageId,
                    favoritePageIds = favoritePageIds,
                    expandedPageIds = expandedPageIds,
                    refreshTrigger = refreshTrigger,
                    onOpenPage = onOpenPage,
                    onCreateSubPage = onCreateSubPage,
                    onRenameRequest = onRenameRequest,
                    onDuplicatePage = onDuplicatePage,
                    onToggleFavorite = onToggleFavorite,
                    onMoveWorkspaceRequest = onMoveWorkspaceRequest,
                    onArchivePage = onArchivePage,
                    onTrashPage = onTrashPage
                )
            }
        }
    }
}

/**
 * Sidebar im Modus `"chats"`:
 * Oben Button `+ Neuer KI-Chat`, darunter Liste aller gespeicherten Chats aus `core.chats()`.
 */
@Composable
private fun SidebarChatsTree(
    chats: List<ChatInfo>,
    activeChatId: String?,
    onNewChat: () -> Unit,
    onSelectChat: (String) -> Unit,
    onDeleteChat: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp)
    ) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = AccentBlueSoft,
            border = BorderStroke(1.dp, AccentBorder),
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onNewChat)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                Text(
                    text = "+ Neuer KI-Chat",
                    color = AccentBlue,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        if (chats.isEmpty()) {
            Text(
                text = "Noch keine gespeicherten KI-Chats.",
                color = TextMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(8.dp)
            )
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                items(chats, key = { it.id }) { chat ->
                    val isSelected = chat.id == activeChatId
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (isSelected) AccentBlueSoft else Color.Transparent)
                            .clickable { onSelectChat(chat.id) }
                            .padding(horizontal = 8.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.ChatBubbleOutline,
                            contentDescription = null,
                            tint = if (isSelected) AccentBlue else TextMuted,
                            modifier = Modifier.size(15.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = chat.title.ifBlank { "Neuer Chat" },
                                color = if (isSelected) TextMain else TextSecondary,
                                fontSize = 12.5.sp,
                                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            if (chat.updated.isNotBlank()) {
                                Text(
                                    text = chat.updated.take(10),
                                    color = TextLight,
                                    fontSize = 10.sp,
                                    maxLines = 1
                                )
                            }
                        }
                        IconButton(
                            onClick = { onDeleteChat(chat.id) },
                            modifier = Modifier.size(22.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.DeleteOutline,
                                contentDescription = "Chat löschen",
                                tint = TextMuted,
                                modifier = Modifier.size(14.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Sidebar im Modus `"anki"`:
 * Oben Header `STAPEL` mit `+` Button (`Neuer Stapel`) und Zeile `🃏 Alle Stapel (Übersicht)`,
 * darunter der hierarchische Stapelbaum (`::`) mit Fällig-/Neu-Badges.
 */
@Composable
private fun SidebarAnkiTree(
    decks: List<DeckOverview>,
    activeDeckName: String?,
    isStudyRouteActive: Boolean,
    collapsedPrefixes: MutableList<String>,
    onOpenAllDecks: () -> Unit,
    onSelectDeck: (String) -> Unit,
    onCreateDeckClick: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 6.dp, vertical = 6.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "STAPEL",
                color = TextMuted,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.7.sp
            )
            Box(
                modifier = Modifier
                    .size(22.dp)
                    .clip(RoundedCornerShape(5.dp))
                    .clickable(onClick = onCreateDeckClick),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Rounded.Add,
                    contentDescription = "Neuer Stapel",
                    tint = TextMuted,
                    modifier = Modifier.size(15.dp)
                )
            }
        }

        // Alle Stapel (Übersicht)
        val isAllSelected = isStudyRouteActive && activeDeckName == null
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(7.dp))
                .background(if (isAllSelected) AccentBlueSoft else Color.Transparent)
                .clickable(onClick = onOpenAllDecks)
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(text = "🃏", fontSize = 13.sp)
            Spacer(modifier = Modifier.width(7.dp))
            Text(
                text = "Alle Stapel (Übersicht)",
                color = if (isAllSelected) TextMain else TextSecondary,
                fontSize = 12.5.sp,
                fontWeight = if (isAllSelected) FontWeight.SemiBold else FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
        }

        Spacer(modifier = Modifier.height(4.dp))

        // Hierarchischer Stapelbaum nach `::`
        val visibleDecks = remember(decks, collapsedPrefixes.toList()) {
            decks.filter { d ->
                val parts = d.name.split("::")
                var hidden = false
                for (i in 1 until parts.size) {
                    val ancestor = parts.subList(0, i).joinToString("::")
                    if (collapsedPrefixes.contains(ancestor)) {
                        hidden = true
                        break
                    }
                }
                !hidden
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            items(visibleDecks, key = { it.name }) { deck ->
                val parts = deck.name.split("::")
                val depth = (parts.size - 1).coerceAtLeast(0)
                val leafName = parts.lastOrNull() ?: deck.name
                val hasSubDecks = decks.any { it.name.startsWith("${deck.name}::") }
                val isCollapsed = collapsedPrefixes.contains(deck.name)
                val isSelected = isStudyRouteActive && activeDeckName == deck.name
                val dueCount = (deck.learn + deck.review).toInt()
                val newCount = deck.new.toInt()

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = (depth * 12).dp)
                        .clip(RoundedCornerShape(7.dp))
                        .background(if (isSelected) AccentBlueSoft else Color.Transparent)
                        .clickable { onSelectDeck(deck.name) }
                        .padding(horizontal = 6.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(18.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .clickable(enabled = hasSubDecks) {
                                if (isCollapsed) collapsedPrefixes.remove(deck.name)
                                else collapsedPrefixes.add(deck.name)
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        if (hasSubDecks) {
                            Text(
                                text = if (isCollapsed) "▸" else "▾",
                                color = TextMuted,
                                fontSize = 11.sp
                            )
                        } else {
                            Text(
                                text = "•",
                                color = TextLight.copy(alpha = 0.5f),
                                fontSize = 10.sp
                            )
                        }
                    }

                    Text(
                        text = leafName,
                        color = if (isSelected) TextMain else TextSecondary,
                        fontSize = 12.5.sp,
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )

                    if (dueCount > 0) {
                        Box(
                            modifier = Modifier
                                .padding(start = 4.dp)
                                .background(AccentBlue.copy(alpha = 0.18f), ImpalaPillShape)
                                .padding(horizontal = 6.dp, vertical = 1.dp)
                        ) {
                            Text(
                                text = dueCount.toString(),
                                color = AccentBlue,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    if (newCount > 0) {
                        Box(
                            modifier = Modifier
                                .padding(start = 4.dp)
                                .background(AccentGreen.copy(alpha = 0.18f), ImpalaPillShape)
                                .padding(horizontal = 6.dp, vertical = 1.dp)
                        ) {
                            Text(
                                text = newCount.toString(),
                                color = AccentGreen,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * PWA "Neu anlegen" Modal (`TemplatePickerDialog`):
 * Auswahl zwischen:
 * - 📝 Notion-Seite (Leere Seite, Vorlesungsnotiz, Zusammenfassung, Projektplan, Tagesnotiz)
 * - 📓 GoodNotes-Heft (Titel, Papierart: Kariert, Liniert, Punktiert, Blanko, Cornell)
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TemplatePickerDialog(
    isOpen: Boolean,
    onDismiss: () -> Unit,
    onCreateNoteWithTemplate: (title: String, markdownContent: String) -> Unit,
    onCreateHeftWithPaper: (title: String, paper: String) -> Unit
) {
    if (!isOpen) return

    var selectedKind by remember { mutableIntStateOf(0) } // 0 = Notion-Seite, 1 = GoodNotes-Heft
    var heftTitle by remember { mutableStateOf("Neues Heft") }
    var selectedPaper by remember { mutableStateOf("grid") } // grid, lined, dots, blank, cornell

    val todayFormatted = remember {
        SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = BgElevated,
            border = BorderStroke(1.dp, BorderStrong),
            shadowElevation = 18.dp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp)
        ) {
            Column(
                modifier = Modifier
                    .padding(18.dp)
                    .verticalScroll(rememberScrollState())
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Neu anlegen",
                        color = TextMain,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold
                    )
                    IconButton(onClick = onDismiss, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Rounded.Close, contentDescription = "Schließen", tint = TextMuted, modifier = Modifier.size(18.dp))
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                // Auswahl-Tabs: 📝 Notion-Seite vs. 📓 GoodNotes-Heft
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BgSidebar, RoundedCornerShape(10.dp))
                        .padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                     listOf(
                        0 to "📝 Notion-Seite",
                        1 to "📓 GoodNotes-Heft"
                    ).forEach { (idx, title) ->
                        val active = selectedKind == idx
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (active) BgBubble else Color.Transparent)
                                .border(
                                    width = 1.dp,
                                    color = if (active) AccentBorder else Color.Transparent,
                                    shape = RoundedCornerShape(8.dp)
                                )
                                .clickable { selectedKind = idx }
                                .padding(vertical = 8.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = title,
                                color = if (active) TextMain else TextMuted,
                                fontSize = 13.sp,
                                fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                if (selectedKind == 0) {
                    val templates = listOf(
                        Triple("📄 Leere Seite", "Neue Notiz", ""),
                        Triple(
                            "🎓 Vorlesungsnotiz",
                            "Vorlesung $todayFormatted",
                            "## Thema & Ziele\n- \n\n## Kernkonzepte\n\n\n## Fragen & Beispiele\n- [ ] \n\n## Zusammenfassung\n> "
                        ),
                        Triple(
                            "📋 Zusammenfassung",
                            "Zusammenfassung",
                            "## Überblick\n\n## Wichtige Definitionen\n- **Begriff**: Erklärung\n\n## Prüfungsrelevante Punkte\n1. \n2. "
                        ),
                        Triple(
                            "🚀 Projektplan",
                            "Projektplan",
                            "## Zielsetzung\n\n## Aufgaben\n- [ ] Meilenstein 1\n- [ ] Meilenstein 2\n\n## Notizen & Ressourcen\n- "
                        ),
                        Triple(
                            "📅 Tagesnotiz",
                            "Tagesnotiz $todayFormatted",
                            "## Fokus heute ($todayFormatted)\n- [ ] Wichtigste Aufgabe\n\n## Mitschriften & Ideen\n- \n\n## Rückblick\n- "
                        )
                    )

                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        for ((label, defaultTitle, body) in templates) {
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = BgCard,
                                border = BorderStroke(1.dp, BorderHairline),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        onDismiss()
                                        onCreateNoteWithTemplate(defaultTitle, body)
                                    }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = label,
                                            color = TextMain,
                                            fontSize = 14.sp,
                                            fontWeight = FontWeight.SemiBold
                                        )
                                        Text(
                                            text = if (body.isEmpty()) "Startet mit einer leeren Markdown-Notiz" else body.lineSequence().first().removePrefix("## "),
                                            color = TextMuted,
                                            fontSize = 11.5.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                    Icon(
                                        imageVector = Icons.AutoMirrored.Rounded.NavigateNext,
                                        contentDescription = null,
                                        tint = AccentBlue,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                        }
                    }
                } else {
                    Text(
                        text = "Titel des Hefts",
                        color = TextSecondary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    BasicTextField(
                        value = heftTitle,
                        onValueChange = { heftTitle = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(BgBubble, RoundedCornerShape(10.dp))
                            .border(1.dp, BorderHairline, RoundedCornerShape(10.dp))
                            .padding(horizontal = 12.dp, vertical = 10.dp)
                    )

                    Spacer(modifier = Modifier.height(14.dp))
                    Text(
                        text = "Papierart",
                        color = TextSecondary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                    Spacer(modifier = Modifier.height(8.dp))

                    val papers = listOf(
                        "grid" to "⊞ Kariert",
                        "lined" to "☰ Liniert",
                        "dots" to "⁙ Punktiert",
                        "blank" to "⬜ Blanko",
                        "cornell" to "◫ Cornell"
                    )

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        for ((paperKey, paperLabel) in papers) {
                            val isSelected = selectedPaper == paperKey
                            Surface(
                                shape = RoundedCornerShape(9.dp),
                                color = if (isSelected) AccentBlueSoft else BgCard,
                                border = BorderStroke(
                                    1.dp,
                                    if (isSelected) AccentBlue else BorderHairline
                                ),
                                modifier = Modifier.clickable { selectedPaper = paperKey }
                            ) {
                                Text(
                                    text = paperLabel,
                                    color = if (isSelected) AccentBlue else TextMain,
                                    fontSize = 12.5.sp,
                                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(18.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        TextButton(onClick = onDismiss) {
                            Text("Abbrechen", color = TextMuted)
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Surface(
                            shape = RoundedCornerShape(9.dp),
                            color = AccentBlue,
                            modifier = Modifier.clickable {
                                val cleanTitle = heftTitle.trim().ifBlank { "Neues Heft" }
                                val corePaper = if (selectedPaper == "cornell") "lined" else selectedPaper
                                onDismiss()
                                onCreateHeftWithPaper(cleanTitle, corePaper)
                            }
                        ) {
                            Text(
                                text = "📓 Heft anlegen",
                                color = Color(0xFF081018),
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Brotkrumen-Leiste (Breadcrumbs) basierend auf core.ancestorsOf(pageId)
 */
@Composable
fun ImpalaBreadcrumbs(
    pageId: String?,
    core: ImpalaCore,
    onNavigateToPage: (String) -> Unit,
    onNavigateHome: () -> Unit,
    modifier: Modifier = Modifier
) {
    var ancestors by remember(pageId) { mutableStateOf<List<PageSummary>>(emptyList()) }

    LaunchedEffect(pageId) {
        if (!pageId.isNullOrEmpty()) {
            withContext(Dispatchers.IO) {
                try {
                    ancestors = core.ancestorsOf(pageId)
                } catch (_: Exception) {
                    ancestors = emptyList()
                }
            }
        } else {
            ancestors = emptyList()
        }
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "Home",
            color = TextSecondary,
            fontSize = 12.sp,
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .clickable { onNavigateHome() }
                .padding(horizontal = 4.dp, vertical = 2.dp)
        )

        for (ancestor in ancestors) {
            Icon(
                imageVector = Icons.AutoMirrored.Rounded.NavigateNext,
                contentDescription = null,
                tint = TextMuted,
                modifier = Modifier.size(15.dp)
            )
            val isCurrent = ancestor.id == pageId
            Text(
                text = ancestor.title.ifEmpty { "Ohne Titel" },
                color = if (isCurrent) TextMain else TextSecondary,
                fontWeight = if (isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .clickable { onNavigateToPage(ancestor.id) }
                    .padding(horizontal = 4.dp, vertical = 2.dp)
            )
        }
    }
}

/**
 * Schnellsuche-Dialog (`#btnSearch` / `Cmd+K` über `core.search`)
 */
@Composable
fun QuickSearchDialog(
    core: ImpalaCore,
    isOpen: Boolean,
    onDismiss: () -> Unit,
    onSelectPage: (String) -> Unit
) {
    if (!isOpen) return

    var query by remember { mutableStateOf("") }
    var includeArchived by remember { mutableStateOf(false) }
    var results by remember { mutableStateOf<List<SearchHit>>(emptyList()) }
    var recentFallback by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            try {
                recentFallback = core.recentPages(10u)
            } catch (_: Exception) {
            }
        }
        focusRequester.requestFocus()
    }

    LaunchedEffect(query, includeArchived) {
        val q = query.trim()
        if (q.isNotEmpty()) {
            withContext(Dispatchers.IO) {
                try {
                    results = core.search(q, includeArchived = includeArchived)
                } catch (_: Exception) {
                    results = emptyList()
                }
            }
        } else {
            results = emptyList()
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = BgSidebar,
            border = BorderStroke(1.dp, BorderStrong),
            shadowElevation = 16.dp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BgBubble, RoundedCornerShape(10.dp))
                        .border(1.dp, BorderHairline, RoundedCornerShape(10.dp))
                        .padding(horizontal = 12.dp, vertical = 10.dp)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Search,
                        contentDescription = null,
                        tint = AccentBlue,
                        modifier = Modifier.size(19.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 15.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        singleLine = true,
                        modifier = Modifier
                            .weight(1f)
                            .focusRequester(focusRequester),
                        decorationBox = { innerTextField ->
                            if (query.isEmpty()) {
                                Text("In Notizen und Heften suchen...", color = TextMuted, fontSize = 14.sp)
                            }
                            innerTextField()
                        }
                    )
                    if (query.isNotEmpty()) {
                        IconButton(
                            onClick = { query = "" },
                            modifier = Modifier.size(20.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Close,
                                contentDescription = "Löschen",
                                tint = TextMuted,
                                modifier = Modifier.size(15.dp)
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = if (query.isBlank()) "ZULETZT GEÖFFNET" else "${results.size} TREFFER",
                        color = TextMuted,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.6.sp
                    )
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { includeArchived = !includeArchived }
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = if (includeArchived) "☑ Inkl. Archiv" else "☐ Inkl. Archiv",
                            color = if (includeArchived) AccentBlue else TextMuted,
                            fontSize = 11.sp
                        )
                    }
                }

                Spacer(modifier = Modifier.height(6.dp))

                if (query.isBlank()) {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 320.dp)
                    ) {
                        items(recentFallback, key = { it.id }) { pg ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable {
                                        onSelectPage(pg.id)
                                        onDismiss()
                                    }
                                    .padding(vertical = 8.dp, horizontal = 10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = if (pg.kind == PageKind.HEFT) "📓" else "📄",
                                    fontSize = 14.sp
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Text(
                                    text = pg.title.ifEmpty { "Ohne Titel" },
                                    color = TextMain,
                                    fontSize = 13.5.sp,
                                    fontWeight = FontWeight.Medium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                    }
                } else if (results.isEmpty()) {
                    Text(
                        text = "Keine Treffer gefunden",
                        color = TextMuted,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(vertical = 16.dp)
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 340.dp)
                    ) {
                        items(results, key = { it.pageId }) { hit ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable {
                                        onSelectPage(hit.pageId)
                                        onDismiss()
                                    }
                                    .padding(vertical = 8.dp, horizontal = 10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Description,
                                    contentDescription = null,
                                    tint = AccentBlue,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = hit.title.ifEmpty { "Ohne Titel" },
                                        color = TextMain,
                                        fontSize = 13.5.sp,
                                        fontWeight = FontWeight.Medium,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    if (hit.snippet.isNotEmpty()) {
                                        Text(
                                            text = hit.snippet,
                                            color = TextSecondary,
                                            fontSize = 11.5.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
