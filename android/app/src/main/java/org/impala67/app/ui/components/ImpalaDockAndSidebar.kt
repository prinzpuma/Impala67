package org.impala67.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.material.icons.automirrored.rounded.NavigateNext
import androidx.compose.material.icons.automirrored.rounded.Note
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Archive
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.AutoStories
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Menu
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
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
import org.impala67.app.ui.theme.Accent
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgDeep
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.EdgeSoft
import org.impala67.app.ui.theme.ImpalaBouncySpringFloat
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.SurfaceActive
import org.impala67.app.ui.theme.SurfaceHover
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.SearchHit
import uniffi.impala_ffi.WorkspaceInfo

/**
 * Schwebende Dock-Pille für Mobilgeräte am unteren Bildschirmrand
 */
@Composable
fun ImpalaFloatingDock(
    currentRoute: String,
    onNavigateHome: () -> Unit,
    onNewNote: () -> Unit,
    onNewHeft: () -> Unit,
    onOpenStudy: () -> Unit,
    onOpenSearch: () -> Unit,
    onOpenAi: () -> Unit,
    onToggleSidebar: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(bottom = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            shape = ImpalaPillShape,
            color = BgSidebar,
            shadowElevation = 10.dp,
            modifier = Modifier
                .border(1.dp, EdgeSoft, ImpalaPillShape)
                .shadow(elevation = 12.dp, shape = ImpalaPillShape)
        ) {
            Row(
                modifier = Modifier
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                DockIconButton(
                    icon = Icons.Rounded.Home,
                    label = "Home",
                    isSelected = currentRoute == "home",
                    onClick = onNavigateHome
                )
                DockIconButton(
                    icon = Icons.Rounded.EditNote,
                    label = "Notiz",
                    isSelected = false,
                    onClick = onNewNote
                )
                DockIconButton(
                    icon = Icons.Rounded.AutoStories,
                    label = "Heft",
                    isSelected = false,
                    onClick = onNewHeft
                )
                DockIconButton(
                    icon = Icons.Rounded.School,
                    label = "Lernen",
                    isSelected = currentRoute == "study",
                    onClick = onOpenStudy
                )
                DockIconButton(
                    icon = Icons.Rounded.Search,
                    label = "Suche",
                    isSelected = false,
                    onClick = onOpenSearch
                )
                DockIconButton(
                    icon = Icons.Rounded.AutoAwesome,
                    label = "KI",
                    isSelected = false,
                    tint = Accent,
                    onClick = onOpenAi
                )
                DockIconButton(
                    icon = Icons.Rounded.Menu,
                    label = "Seiten",
                    isSelected = false,
                    onClick = onToggleSidebar
                )
            }
        }
    }
}

@Composable
private fun DockIconButton(
    icon: ImageVector,
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color? = null
) {
    val bg = if (isSelected) AccentSoft else Color.Transparent
    val iconColor = tint ?: if (isSelected) Accent else TextSecondary

    Box(
        modifier = modifier
            .clip(CircleShape)
            .background(bg)
            .clickable(onClick = onClick)
            .padding(8.dp),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = iconColor,
            modifier = Modifier.size(22.dp)
        )
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
                } catch (e: Exception) {
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
            .padding(horizontal = 16.dp, vertical = 8.dp),
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
                modifier = Modifier.size(16.dp)
            )
            val isCurrent = ancestor.id == pageId
            Text(
                text = ancestor.title.ifEmpty { "Ohne Titel" },
                color = if (isCurrent) TextPrimary else TextSecondary,
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
 * Seitenbaum & Workspace-Umschalter für die Seitenleiste
 */
@Composable
fun ImpalaSidebarContent(
    core: ImpalaCore,
    activePageId: String?,
    onNavigateToPage: (String) -> Unit,
    onNavigateHome: () -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()
    var workspaces by remember { mutableStateOf<List<WorkspaceInfo>>(emptyList()) }
    var selectedWorkspaceId by remember { mutableStateOf<String?>(null) }
    var isWorkspaceDropdownOpen by remember { mutableStateOf(false) }
    var showNewWorkspaceDialog by remember { mutableStateOf(false) }
    var newWorkspaceName by remember { mutableStateOf("") }

    // Lädt Workspaces
    fun reloadWorkspaces() {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val list = core.workspaces()
                workspaces = list
                if (selectedWorkspaceId == null && list.isNotEmpty()) {
                    selectedWorkspaceId = list.first().id
                }
            } catch (e: Exception) {
                // Fallback
            }
        }
    }

    LaunchedEffect(Unit) {
        reloadWorkspaces()
    }

    Column(
        modifier = modifier
            .fillMaxHeight()
            .background(BgSidebar)
            .border(width = 0.5.dp, color = EdgeSoft)
            .padding(12.dp)
    ) {
        // Workspace-Umschalter
        val currentWorkspace = workspaces.find { it.id == selectedWorkspaceId }
        val workspaceTitle = currentWorkspace?.name ?: "Standard-Workspace"

        Surface(
            shape = RoundedCornerShape(10.dp),
            color = SurfaceSubtle,
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, EdgeSoft, RoundedCornerShape(10.dp))
                .clickable { isWorkspaceDropdownOpen = true }
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Rounded.Folder,
                    contentDescription = null,
                    tint = Accent,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = workspaceTitle,
                    color = TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Icon(
                    imageVector = Icons.Rounded.ExpandMore,
                    contentDescription = "Workspace wählen",
                    tint = TextSecondary,
                    modifier = Modifier.size(18.dp)
                )

                DropdownMenu(
                    expanded = isWorkspaceDropdownOpen,
                    onDismissRequest = { isWorkspaceDropdownOpen = false },
                    modifier = Modifier.background(BgSidebar)
                ) {
                    for (ws in workspaces) {
                        DropdownMenuItem(
                            text = {
                                Text(
                                    text = ws.name,
                                    color = if (ws.id == selectedWorkspaceId) Accent else TextPrimary
                                )
                            },
                            onClick = {
                                selectedWorkspaceId = ws.id
                                isWorkspaceDropdownOpen = false
                            }
                        )
                    }
                    HorizontalDivider(color = EdgeSoft)
                    DropdownMenuItem(
                        text = { Text("+ Neuer Workspace", color = Accent) },
                        onClick = {
                            isWorkspaceDropdownOpen = false
                            showNewWorkspaceDialog = true
                        }
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Aktionen oben in der Leiste
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "SEITEN",
                color = TextMuted,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.8.sp
            )
            Row {
                IconButton(
                    onClick = {
                        coroutineScope.launch(Dispatchers.IO) {
                            try {
                                val newId = core.createPage("Neue Notiz", "", null, selectedWorkspaceId)
                                withContext(Dispatchers.Main) { onNavigateToPage(newId) }
                            } catch (e: Exception) {
                                // Fehlerbehandlung
                            }
                        }
                    },
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.EditNote,
                        contentDescription = "Neue Notiz",
                        tint = TextSecondary,
                        modifier = Modifier.size(18.dp)
                    )
                }
                IconButton(
                    onClick = {
                        coroutineScope.launch(Dispatchers.IO) {
                            try {
                                val newId = core.createHeft("Neues Heft", null, selectedWorkspaceId)
                                withContext(Dispatchers.Main) { onNavigateToPage(newId) }
                            } catch (e: Exception) {
                                // Fehlerbehandlung
                            }
                        }
                    },
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.AutoStories,
                        contentDescription = "Neues Heft",
                        tint = TextSecondary,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(6.dp))

        // Hierarchischer Seitenbaum
        Box(modifier = Modifier.weight(1f)) {
            PageTreeView(
                core = core,
                workspaceId = selectedWorkspaceId,
                activePageId = activePageId,
                onNavigateToPage = onNavigateToPage
            )
        }

        // Fußzeile: Einstellungen & Home
        HorizontalDivider(color = EdgeSoft, modifier = Modifier.padding(vertical = 8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { onNavigateHome() }
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Rounded.Home,
                    contentDescription = null,
                    tint = TextSecondary,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(text = "Startseite", color = TextSecondary, fontSize = 13.sp)
            }

            IconButton(
                onClick = onOpenSettings,
                modifier = Modifier.size(32.dp)
            ) {
                Icon(
                    imageVector = Icons.Rounded.Settings,
                    contentDescription = "Einstellungen & Sync",
                    tint = TextSecondary,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }

    if (showNewWorkspaceDialog) {
        AlertDialog(
            onDismissRequest = { showNewWorkspaceDialog = false },
            title = { Text(text = "Neuer Workspace", color = TextPrimary) },
            text = {
                BasicTextField(
                    value = newWorkspaceName,
                    onValueChange = { newWorkspaceName = it },
                    textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp),
                    cursorBrush = SolidColor(Accent),
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BgBubble, RoundedCornerShape(8.dp))
                        .padding(12.dp)
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val name = newWorkspaceName.trim()
                        if (name.isNotEmpty()) {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val id = core.createWorkspace(name)
                                    withContext(Dispatchers.Main) {
                                        selectedWorkspaceId = id
                                        reloadWorkspaces()
                                    }
                                } catch (e: Exception) {
                                    // Fehler ignorieren
                                }
                            }
                        }
                        newWorkspaceName = ""
                        showNewWorkspaceDialog = false
                    }
                ) {
                    Text("Anlegen", color = Accent)
                }
            },
            dismissButton = {
                TextButton(onClick = { showNewWorkspaceDialog = false }) {
                    Text("Abbrechen", color = TextSecondary)
                }
            },
            containerColor = BgSidebar
        )
    }
}

/**
 * Aufklappbarer Seitenbaum
 */
@Composable
private fun PageTreeView(
    core: ImpalaCore,
    workspaceId: String?,
    activePageId: String?,
    onNavigateToPage: (String) -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    var rootPages by remember(workspaceId) { mutableStateOf<List<PageSummary>>(emptyList()) }
    val expandedPages = remember { mutableStateListOf<String>() }

    fun loadRootPages() {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                rootPages = core.childrenOf(null, workspaceId)
            } catch (e: Exception) {
                rootPages = emptyList()
            }
        }
    }

    LaunchedEffect(workspaceId) {
        loadRootPages()
    }

    LazyColumn(modifier = Modifier.fillMaxSize()) {
        items(rootPages, key = { it.id }) { page ->
            PageTreeItem(
                page = page,
                depth = 0,
                core = core,
                workspaceId = workspaceId,
                activePageId = activePageId,
                expandedPages = expandedPages,
                onNavigateToPage = onNavigateToPage,
                onRefreshTree = { loadRootPages() }
            )
        }
    }
}

@Composable
private fun PageTreeItem(
    page: PageSummary,
    depth: Int,
    core: ImpalaCore,
    workspaceId: String?,
    activePageId: String?,
    expandedPages: MutableList<String>,
    onNavigateToPage: (String) -> Unit,
    onRefreshTree: () -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    val isExpanded = expandedPages.contains(page.id)
    val isActive = page.id == activePageId
    var children by remember(page.id, isExpanded) { mutableStateOf<List<PageSummary>>(emptyList()) }
    var showMenu by remember { mutableStateOf(false) }

    LaunchedEffect(page.id, isExpanded) {
        if (isExpanded) {
            withContext(Dispatchers.IO) {
                try {
                    children = core.childrenOf(page.id, workspaceId)
                } catch (e: Exception) {
                    children = emptyList()
                }
            }
        }
    }

    val rotation by animateFloatAsState(
        targetValue = if (isExpanded) 90f else 0f,
        animationSpec = ImpalaBouncySpringFloat,
        label = "chevronRotation"
    )

    Column {
        val itemBg = if (isActive) AccentSoft else Color.Transparent
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = (depth * 14).dp)
                .clip(RoundedCornerShape(8.dp))
                .background(itemBg)
                .clickable { onNavigateToPage(page.id) }
                .padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Pfeil zum Aufklappen
            Box(
                modifier = Modifier
                    .size(20.dp)
                    .clip(CircleShape)
                    .clickable {
                        if (isExpanded) {
                            expandedPages.remove(page.id)
                        } else {
                            expandedPages.add(page.id)
                        }
                    },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.NavigateNext,
                    contentDescription = null,
                    tint = TextMuted,
                    modifier = Modifier
                        .size(14.dp)
                        .rotate(rotation)
                )
            }

            Spacer(modifier = Modifier.width(4.dp))

            // Typ-Icon
            val icon = if (page.kind == PageKind.HEFT) Icons.Rounded.AutoStories else Icons.AutoMirrored.Rounded.Note
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = if (isActive) Accent else TextSecondary,
                modifier = Modifier.size(16.dp)
            )

            Spacer(modifier = Modifier.width(8.dp))

            // Titel
            Text(
                text = page.title.ifEmpty { "Ohne Titel" },
                color = if (isActive) TextPrimary else TextSecondary,
                fontWeight = if (isActive) FontWeight.SemiBold else FontWeight.Normal,
                fontSize = 13.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )

            // 3-Punkte Kontextmenü
            Box {
                IconButton(
                    onClick = { showMenu = true },
                    modifier = Modifier.size(22.dp)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.MoreVert,
                        contentDescription = "Optionen",
                        tint = TextMuted,
                        modifier = Modifier.size(14.dp)
                    )
                }

                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false },
                    modifier = Modifier.background(BgSidebar)
                ) {
                    DropdownMenuItem(
                        text = { Text("Unterseite anlegen", color = TextPrimary) },
                        leadingIcon = {
                            Icon(Icons.Rounded.Add, null, tint = Accent, modifier = Modifier.size(16.dp))
                        },
                        onClick = {
                            showMenu = false
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val id = core.createPage("Neue Unterseite", "", page.id, workspaceId)
                                    withContext(Dispatchers.Main) {
                                        if (!isExpanded) expandedPages.add(page.id)
                                        onNavigateToPage(id)
                                        onRefreshTree()
                                    }
                                } catch (e: Exception) {
                                    // Ignorieren
                                }
                            }
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Unterheft anlegen", color = TextPrimary) },
                        leadingIcon = {
                            Icon(Icons.Rounded.AutoStories, null, tint = Accent, modifier = Modifier.size(16.dp))
                        },
                        onClick = {
                            showMenu = false
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val id = core.createHeft("Neues Heft", page.id, workspaceId)
                                    withContext(Dispatchers.Main) {
                                        if (!isExpanded) expandedPages.add(page.id)
                                        onNavigateToPage(id)
                                        onRefreshTree()
                                    }
                                } catch (e: Exception) {
                                    // Ignorieren
                                }
                            }
                        }
                    )
                    HorizontalDivider(color = EdgeSoft)
                    DropdownMenuItem(
                        text = { Text("Archivieren", color = TextSecondary) },
                        leadingIcon = {
                            Icon(Icons.Rounded.Archive, null, tint = TextSecondary, modifier = Modifier.size(16.dp))
                        },
                        onClick = {
                            showMenu = false
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    core.archivePage(page.id)
                                    withContext(Dispatchers.Main) { onRefreshTree() }
                                } catch (e: Exception) {
                                    // Ignorieren
                                }
                            }
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("In den Papierkorb", color = Danger) },
                        leadingIcon = {
                            Icon(Icons.Rounded.Delete, null, tint = Danger, modifier = Modifier.size(16.dp))
                        },
                        onClick = {
                            showMenu = false
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    core.trashPage(page.id)
                                    withContext(Dispatchers.Main) { onRefreshTree() }
                                } catch (e: Exception) {
                                    // Ignorieren
                                }
                            }
                        }
                    )
                }
            }
        }

        // Unterseiten rendern
        AnimatedVisibility(
            visible = isExpanded,
            enter = expandVertically() + fadeIn(),
            exit = shrinkVertically() + fadeOut()
        ) {
            Column {
                for (child in children) {
                    PageTreeItem(
                        page = child,
                        depth = depth + 1,
                        core = core,
                        workspaceId = workspaceId,
                        activePageId = activePageId,
                        expandedPages = expandedPages,
                        onNavigateToPage = onNavigateToPage,
                        onRefreshTree = onRefreshTree
                    )
                }
            }
        }
    }
}

/**
 * Schnellsuche-Dialog (Strg+K / Volltextsuche über core.search)
 */
@Composable
fun QuickSearchDialog(
    core: ImpalaCore,
    isOpen: Boolean,
    onDismiss: () -> Unit,
    onSelectPage: (String) -> Unit
) {
    if (!isOpen) return

    val coroutineScope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SearchHit>>(emptyList()) }
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(query) {
        val q = query.trim()
        if (q.isNotEmpty()) {
            withContext(Dispatchers.IO) {
                try {
                    results = core.search(q, includeArchived = false)
                } catch (e: Exception) {
                    results = emptyList()
                }
            }
        } else {
            results = emptyList()
        }
    }

    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = BgSidebar,
            border = androidx.compose.foundation.BorderStroke(1.dp, Edge),
            shadowElevation = 16.dp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                // Suchleiste
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BgBubble, RoundedCornerShape(10.dp))
                        .padding(horizontal = 12.dp, vertical = 10.dp)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Search,
                        contentDescription = null,
                        tint = Accent,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        textStyle = TextStyle(color = TextPrimary, fontSize = 15.sp),
                        cursorBrush = SolidColor(Accent),
                        singleLine = true,
                        modifier = Modifier
                            .weight(1f)
                            .focusRequester(focusRequester),
                        decorationBox = { innerTextField ->
                            if (query.isEmpty()) {
                                Text("In Notizen und Heften suchen...", color = TextMuted, fontSize = 15.sp)
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
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                // Ergebnisliste
                if (query.isNotEmpty() && results.isEmpty()) {
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
                            .height((results.size.coerceAtMost(6) * 64).dp)
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
                                val hitIcon = Icons.Rounded.Description
                                Icon(
                                    imageVector = hitIcon,
                                    contentDescription = null,
                                    tint = Accent,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = hit.title.ifEmpty { "Ohne Titel" },
                                        color = TextPrimary,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Medium,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    val snippet = hit.snippet
                                    if (!snippet.isNullOrEmpty()) {
                                        Text(
                                            text = snippet,
                                            color = TextSecondary,
                                            fontSize = 12.sp,
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
