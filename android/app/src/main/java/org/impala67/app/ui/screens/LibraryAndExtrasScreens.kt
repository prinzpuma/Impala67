package org.impala67.app.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.NavigateNext
import androidx.compose.material.icons.automirrored.rounded.Note
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Archive
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.AutoStories
import androidx.compose.material.icons.rounded.CenterFocusStrong
import androidx.compose.material.icons.rounded.CheckBox
import androidx.compose.material.icons.rounded.CheckBoxOutlineBlank
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DeleteForever
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Hub
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.RestoreFromTrash
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Unarchive
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
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.ui.theme.Accent
import org.impala67.app.ui.theme.AccentBorder
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgDeep
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.DangerBorder
import org.impala67.app.ui.theme.DangerSoft
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.EdgeSoft
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.Success
import org.impala67.app.ui.theme.SuccessBorder
import org.impala67.app.ui.theme.SuccessSoft
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.Warn
import org.impala67.app.ui.theme.WarnSoft
import uniffi.impala_ffi.CardInfo
import uniffi.impala_ffi.DeckInfo
import uniffi.impala_ffi.GradeInfo
import uniffi.impala_ffi.HeftFolder
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.SubjectGrades
import uniffi.impala_ffi.WorkspaceInfo
import java.time.LocalDate
import java.util.Locale
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

// ============================================================================
// 1. BIBLIOTHEK (LibraryScreen nach web/library.js)
// ============================================================================

private val FOLDER_PALETTE = listOf(
    Color(0xFF4A9EFF),
    Color(0xFFA78BFA),
    Color(0xFF34D399),
    Color(0xFFFB923C),
    Color(0xFFF87171)
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LibraryScreen(
    core: ImpalaCore,
    pages: List<PageSummary> = emptyList(),
    initialTab: String = "notion",
    onOpenPage: (String) -> Unit,
    onCreatePage: (isHeft: Boolean, folderId: String?) -> Unit = { _, _ -> },
    onMutation: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()
    var activeTab by remember(initialTab) { mutableStateOf(initialTab) }
    var searchQuery by remember { mutableStateOf("") }

    var workspaces by remember { mutableStateOf<List<WorkspaceInfo>>(emptyList()) }
    var allActivePages by remember { mutableStateOf<List<PageSummary>>(pages) }
    var archivedPages by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    var currentFolderId by remember { mutableStateOf<String?>(null) }
    var foldersInCurrent by remember { mutableStateOf<List<HeftFolder>>(emptyList()) }
    var allRootFolders by remember { mutableStateOf<List<HeftFolder>>(emptyList()) }
    var folderBreadcrumbs by remember { mutableStateOf<List<HeftFolder>>(emptyList()) }
    var hefteInCurrent by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    val heftPageCounts = remember { mutableStateMapOf<String, Int>() }
    val folderColorMap = remember { mutableStateMapOf<String, Color>() }

    var showNewFolderDialog by remember { mutableStateOf(false) }
    var newFolderTitle by remember { mutableStateOf("") }
    var selectedFolderColor by remember { mutableStateOf(FOLDER_PALETTE.first()) }

    var renameTargetPage by remember { mutableStateOf<PageSummary?>(null) }
    var renameText by remember { mutableStateOf("") }
    var moveHeftTarget by remember { mutableStateOf<PageSummary?>(null) }

    fun reloadLibrary() {
        coroutineScope.launch(Dispatchers.IO) {
            runCatching {
                val ws = core.workspaces()
                val recents = core.recentPages(500u)
                val arch = core.archivedPages()
                val subFolders = core.heftFolders(currentFolderId)
                val rootFolders = core.heftFolders(null)
                val crumbs = currentFolderId?.let { core.heftFolderPath(it) } ?: emptyList()
                val hefte = core.heftInFolder(currentFolderId)
                val counts = mutableMapOf<String, Int>()
                for (h in hefte) {
                    counts[h.id] = core.heftPageIds(h.id).size.coerceAtLeast(1)
                }

                withContext(Dispatchers.Main) {
                    workspaces = ws
                    allActivePages = if (recents.isNotEmpty()) recents else pages
                    archivedPages = arch
                    foldersInCurrent = subFolders
                    allRootFolders = rootFolders
                    folderBreadcrumbs = crumbs
                    hefteInCurrent = hefte
                    heftPageCounts.clear()
                    heftPageCounts.putAll(counts)
                }
            }
        }
    }

    LaunchedEffect(currentFolderId, pages) {
        reloadLibrary()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel)
            .navigationBarsPadding()
    ) {
        // Header & Suche
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(BgSidebar)
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "📚 Bibliothek",
                    color = TextPrimary,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (activeTab == "hefte") {
                        Surface(
                            shape = ImpalaPillShape,
                            color = BgBubble,
                            border = BorderStroke(1.dp, Edge),
                            modifier = Modifier
                                .clip(ImpalaPillShape)
                                .clickable {
                                    newFolderTitle = ""
                                    showNewFolderDialog = true
                                }
                        ) {
                            Text(
                                text = "+ Neuer Ordner",
                                color = TextPrimary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                            )
                        }
                    }

                    Surface(
                        shape = ImpalaPillShape,
                        color = Accent,
                        modifier = Modifier
                            .clip(ImpalaPillShape)
                            .clickable {
                                val createHeft = activeTab == "hefte"
                                coroutineScope.launch(Dispatchers.IO) {
                                    try {
                                        val id = if (createHeft) {
                                            val hId = core.createHeft("Neues Heft", null, null)
                                            if (currentFolderId != null) {
                                                core.heftMoveToFolder(hId, currentFolderId, null)
                                            }
                                            hId
                                        } else {
                                            core.createPage("Neue Notiz", "", null, null)
                                        }
                                        withContext(Dispatchers.Main) {
                                            onCreatePage(createHeft, currentFolderId)
                                            onMutation()
                                            onOpenPage(id)
                                        }
                                    } catch (_: Exception) {
                                    }
                                }
                            }
                    ) {
                        Text(
                            text = if (activeTab == "hefte") "+ Neues Heft" else "+ Neue Notiz",
                            color = Color(0xFF081018),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    }
                }
            }

            // Suchfeld
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(BgBubble, RoundedCornerShape(10.dp))
                    .border(1.dp, EdgeSoft, RoundedCornerShape(10.dp))
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                Icon(
                    imageVector = Icons.Rounded.Search,
                    contentDescription = null,
                    tint = TextMuted,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                BasicTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp),
                    cursorBrush = SolidColor(Accent),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (searchQuery.isEmpty()) {
                            Text("In Bibliothek suchen…", color = TextMuted, fontSize = 14.sp)
                        }
                        inner()
                    }
                )
                if (searchQuery.isNotEmpty()) {
                    IconButton(
                        onClick = { searchQuery = "" },
                        modifier = Modifier.size(20.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Close,
                            contentDescription = "Suche leeren",
                            tint = TextMuted,
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
            }

            // 4 Tabs
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val tabs = listOf(
                    "notion" to "📝 Notion-Seiten",
                    "hefte" to "📓 GoodNotes-Hefte",
                    "archiv" to "📦 Archiv",
                    "notebook" to "✦ Gemini Notebook"
                )
                items(tabs, key = { it.first }) { (key, label) ->
                    val selected = activeTab == key
                    Surface(
                        shape = ImpalaPillShape,
                        color = if (selected) AccentSoft else BgBubble,
                        border = BorderStroke(1.dp, if (selected) AccentBorder else EdgeSoft),
                        modifier = Modifier
                            .clip(ImpalaPillShape)
                            .clickable { activeTab = key }
                    ) {
                        Text(
                            text = label,
                            color = if (selected) TextPrimary else TextSecondary,
                            fontSize = 12.sp,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    }
                }
            }
        }

        HorizontalDivider(color = EdgeSoft)

        // Tab-Inhalt
        when (activeTab) {
            "notion" -> {
                val notePages = remember(allActivePages, searchQuery) {
                    allActivePages.filter {
                        it.kind == PageKind.NOTE &&
                            (searchQuery.isBlank() || it.title.contains(searchQuery, ignoreCase = true))
                    }
                }
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    val wsGroups = notePages.groupBy { it.workspaceId }
                    if (notePages.isEmpty()) {
                        item {
                            EmptyStateBox(
                                icon = "📝",
                                title = "Keine Notion-Seiten gefunden",
                                subtitle = "Erstelle oben eine neue Markdown-Notiz."
                            )
                        }
                    } else {
                        for ((wsId, list) in wsGroups) {
                            val wsName = workspaces.find { it.id == wsId }?.name?.ifEmpty { "Standard-Workspace" }
                                ?: "Workspace"
                            item(key = "ws_$wsId") {
                                Text(
                                    text = wsName.uppercase(Locale.GERMAN),
                                    color = TextMuted,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    letterSpacing = 0.8.sp,
                                    modifier = Modifier.padding(top = 6.dp, bottom = 2.dp)
                                )
                            }
                            items(list, key = { it.id }) { pg ->
                                LibraryNoteRow(
                                    page = pg,
                                    onOpen = { onOpenPage(pg.id) },
                                    onRename = {
                                        renameTargetPage = pg
                                        renameText = pg.title
                                    },
                                    onDuplicate = {
                                        coroutineScope.launch(Dispatchers.IO) {
                                            runCatching {
                                                val detail = core.page(pg.id)
                                                core.createPage(
                                                    "${pg.title.ifEmpty { "Notiz" }} (Kopie)",
                                                    detail?.content ?: "",
                                                    pg.parentId,
                                                    pg.workspaceId
                                                )
                                            }
                                            reloadLibrary()
                                            onMutation()
                                        }
                                    },
                                    onArchive = {
                                        coroutineScope.launch(Dispatchers.IO) {
                                            runCatching { core.archivePage(pg.id) }
                                            reloadLibrary()
                                            onMutation()
                                        }
                                    },
                                    onTrash = {
                                        coroutineScope.launch(Dispatchers.IO) {
                                            runCatching { core.trashPage(pg.id) }
                                            reloadLibrary()
                                            onMutation()
                                        }
                                    }
                                )
                            }
                        }
                    }
                    item { Spacer(modifier = Modifier.height(72.dp)) }
                }
            }

            "hefte" -> {
                // GoodNotes-Regal-Ansicht (gn-shelf)
                val filteredFolders = remember(foldersInCurrent, searchQuery) {
                    if (searchQuery.isBlank()) foldersInCurrent
                    else foldersInCurrent.filter { it.title.contains(searchQuery, ignoreCase = true) }
                }
                val filteredHefte = remember(hefteInCurrent, searchQuery) {
                    if (searchQuery.isBlank()) hefteInCurrent
                    else hefteInCurrent.filter { it.title.contains(searchQuery, ignoreCase = true) }
                }

                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    // Breadcrumbs (falls in einem Ordner)
                    if (currentFolderId != null) {
                        item {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(BgSidebar, RoundedCornerShape(10.dp))
                                    .padding(horizontal = 12.dp, vertical = 8.dp)
                            ) {
                                Text(
                                    text = "📂 Alle Hefte",
                                    color = Accent,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.clickable { currentFolderId = null }
                                )
                                for (crumb in folderBreadcrumbs) {
                                    Icon(
                                        imageVector = Icons.AutoMirrored.Rounded.NavigateNext,
                                        contentDescription = null,
                                        tint = TextMuted,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Text(
                                        text = crumb.title,
                                        color = if (crumb.id == currentFolderId) TextPrimary else Accent,
                                        fontSize = 12.sp,
                                        fontWeight = if (crumb.id == currentFolderId) FontWeight.SemiBold else FontWeight.Normal,
                                        modifier = Modifier.clickable { currentFolderId = crumb.id }
                                    )
                                }
                            }
                        }
                    }

                    // Ordner-Regal (gn-folder)
                    if (filteredFolders.isNotEmpty()) {
                        item {
                            Text(
                                text = "ORDNER",
                                color = TextMuted,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 0.8.sp
                            )
                        }
                        item {
                            FlowRow(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                for ((idx, folder) in filteredFolders.withIndex()) {
                                    val color = folderColorMap[folder.id]
                                        ?: FOLDER_PALETTE[idx % FOLDER_PALETTE.size]
                                    GoodNotesFolderCard(
                                        folder = folder,
                                        color = color,
                                        onOpen = { currentFolderId = folder.id },
                                        onDelete = {
                                            coroutineScope.launch(Dispatchers.IO) {
                                                runCatching { core.heftFolderDelete(folder.id) }
                                                reloadLibrary()
                                                onMutation()
                                            }
                                        }
                                    )
                                }
                            }
                        }
                    }

                    // Hefte-Regal (gn-book)
                    item {
                        Text(
                            text = "NOTIZBÜCHER & HEFTE",
                            color = TextMuted,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.8.sp
                        )
                    }

                    if (filteredHefte.isEmpty()) {
                        item {
                            EmptyStateBox(
                                icon = "📓",
                                title = "Noch keine Hefte in diesem Ordner",
                                subtitle = "Lege oben ein neues GoodNotes-Heft für Handschrift & Skizzen an."
                            )
                        }
                    } else {
                        item {
                            FlowRow(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(14.dp),
                                verticalArrangement = Arrangement.spacedBy(16.dp)
                            ) {
                                for ((idx, heft) in filteredHefte.withIndex()) {
                                    val coverColor = FOLDER_PALETTE[(heft.id.hashCode().and(0x7FFFFFFF) + idx) % FOLDER_PALETTE.size]
                                    val pageCount = heftPageCounts[heft.id] ?: 1
                                    GoodNotesBookCover(
                                        heft = heft,
                                        coverColor = coverColor,
                                        pageCount = pageCount,
                                        onOpen = { onOpenPage(heft.id) },
                                        onRename = {
                                            renameTargetPage = heft
                                            renameText = heft.title
                                        },
                                        onMoveToFolder = {
                                            moveHeftTarget = heft
                                        },
                                        onTrash = {
                                            coroutineScope.launch(Dispatchers.IO) {
                                                runCatching { core.trashPage(heft.id) }
                                                reloadLibrary()
                                                onMutation()
                                            }
                                        }
                                    )
                                }
                            }
                        }
                    }
                    item { Spacer(modifier = Modifier.height(72.dp)) }
                }
            }

            "archiv" -> {
                val filteredArch = remember(archivedPages, searchQuery) {
                    if (searchQuery.isBlank()) archivedPages
                    else archivedPages.filter { it.title.contains(searchQuery, ignoreCase = true) }
                }
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    if (filteredArch.isEmpty()) {
                        item {
                            EmptyStateBox(
                                icon = "📦",
                                title = "Archiv ist leer",
                                subtitle = "Archivierte Seiten und Hefte erscheinen hier und bleiben durchsuchbar."
                            )
                        }
                    } else {
                        items(filteredArch, key = { it.id }) { pg ->
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = BgSidebar,
                                border = BorderStroke(1.dp, EdgeSoft),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier.padding(14.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = pg.title.ifEmpty { "Ohne Titel" },
                                            color = TextPrimary,
                                            fontSize = 14.sp,
                                            fontWeight = FontWeight.Medium
                                        )
                                        Text(
                                            text = if (pg.kind == PageKind.HEFT) "Archiviertes Heft" else "Archivierte Notiz",
                                            color = TextMuted,
                                            fontSize = 11.sp
                                        )
                                    }
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Surface(
                                            shape = ImpalaPillShape,
                                            color = AccentSoft,
                                            border = BorderStroke(1.dp, AccentBorder),
                                            modifier = Modifier
                                                .clip(ImpalaPillShape)
                                                .clickable {
                                                    coroutineScope.launch(Dispatchers.IO) {
                                                        runCatching { core.unarchivePage(pg.id) }
                                                        reloadLibrary()
                                                        onMutation()
                                                    }
                                                }
                                        ) {
                                            Text(
                                                text = "Wiederherstellen",
                                                color = TextPrimary,
                                                fontSize = 11.sp,
                                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                                            )
                                        }
                                        Surface(
                                            shape = ImpalaPillShape,
                                            color = DangerSoft,
                                            border = BorderStroke(1.dp, DangerBorder),
                                            modifier = Modifier
                                                .clip(ImpalaPillShape)
                                                .clickable {
                                                    coroutineScope.launch(Dispatchers.IO) {
                                                        runCatching { core.trashPage(pg.id) }
                                                        reloadLibrary()
                                                        onMutation()
                                                    }
                                                }
                                        ) {
                                            Text(
                                                text = "Löschen",
                                                color = Danger,
                                                fontSize = 11.sp,
                                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                    item { Spacer(modifier = Modifier.height(72.dp)) }
                }
            }

            "notebook" -> {
                NotebookLmScreen(
                    core = core,
                    pages = allActivePages,
                    onOpenPage = onOpenPage,
                    onOpenAiWithPrompt = {},
                    onMutation = {
                        reloadLibrary()
                        onMutation()
                    },
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
    }

    // Dialog: Neuer Heft-Ordner
    if (showNewFolderDialog) {
        AlertDialog(
            onDismissRequest = { showNewFolderDialog = false },
            containerColor = BgSidebar,
            title = { Text("Neuer Heft-Ordner", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    BasicTextField(
                        value = newFolderTitle,
                        onValueChange = { newFolderTitle = it },
                        textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp),
                        cursorBrush = SolidColor(Accent),
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(BgBubble, RoundedCornerShape(8.dp))
                            .padding(12.dp),
                        decorationBox = { inner ->
                            if (newFolderTitle.isEmpty()) {
                                Text("Ordnername (z.B. Semester 3)", color = TextMuted, fontSize = 14.sp)
                            }
                            inner()
                        }
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (c in FOLDER_PALETTE) {
                            Box(
                                modifier = Modifier
                                    .size(28.dp)
                                    .clip(CircleShape)
                                    .background(c)
                                    .border(
                                        width = if (selectedFolderColor == c) 2.5.dp else 0.dp,
                                        color = if (selectedFolderColor == c) Color.White else Color.Transparent,
                                        shape = CircleShape
                                    )
                                    .clickable { selectedFolderColor = c }
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val title = newFolderTitle.trim()
                        if (title.isNotEmpty()) {
                            val chosenColor = selectedFolderColor
                            coroutineScope.launch(Dispatchers.IO) {
                                runCatching {
                                    val id = core.heftFolderCreate(title, currentFolderId)
                                    withContext(Dispatchers.Main) {
                                        folderColorMap[id] = chosenColor
                                    }
                                }
                                reloadLibrary()
                                onMutation()
                            }
                            showNewFolderDialog = false
                        }
                    }
                ) {
                    Text("Anlegen", color = Accent)
                }
            },
            dismissButton = {
                TextButton(onClick = { showNewFolderDialog = false }) {
                    Text("Abbrechen", color = TextMuted)
                }
            }
        )
    }

    // Dialog: Seite/Heft umbenennen
    if (renameTargetPage != null) {
        val target = renameTargetPage!!
        AlertDialog(
            onDismissRequest = { renameTargetPage = null },
            containerColor = BgSidebar,
            title = { Text("Umbenennen", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                BasicTextField(
                    value = renameText,
                    onValueChange = { renameText = it },
                    textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp),
                    cursorBrush = SolidColor(Accent),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BgBubble, RoundedCornerShape(8.dp))
                        .padding(12.dp)
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val newTitle = renameText.trim()
                        if (newTitle.isNotEmpty()) {
                            coroutineScope.launch(Dispatchers.IO) {
                                runCatching { core.updatePage(target.id, newTitle, null) }
                                reloadLibrary()
                                onMutation()
                            }
                        }
                        renameTargetPage = null
                    }
                ) {
                    Text("Speichern", color = Accent)
                }
            },
            dismissButton = {
                TextButton(onClick = { renameTargetPage = null }) {
                    Text("Abbrechen", color = TextMuted)
                }
            }
        )
    }

    // Dialog: Heft in Ordner verschieben
    if (moveHeftTarget != null) {
        val heft = moveHeftTarget!!
        AlertDialog(
            onDismissRequest = { moveHeftTarget = null },
            containerColor = BgSidebar,
            title = { Text("In Ordner verschieben", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = BgBubble,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                coroutineScope.launch(Dispatchers.IO) {
                                    runCatching { core.heftMoveToFolder(heft.id, null, null) }
                                    reloadLibrary()
                                    onMutation()
                                }
                                moveHeftTarget = null
                            }
                    ) {
                        Text(
                            text = "📂 Stammverzeichnis (Alle Hefte)",
                            color = TextPrimary,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(12.dp)
                        )
                    }
                    for (folder in allRootFolders) {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = BgBubble,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    coroutineScope.launch(Dispatchers.IO) {
                                        runCatching { core.heftMoveToFolder(heft.id, folder.id, null) }
                                        reloadLibrary()
                                        onMutation()
                                    }
                                    moveHeftTarget = null
                                }
                        ) {
                            Text(
                                text = "📁 ${folder.title}",
                                color = TextPrimary,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(12.dp)
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { moveHeftTarget = null }) {
                    Text("Schließen", color = Accent)
                }
            }
        )
    }
}

@Composable
private fun LibraryNoteRow(
    page: PageSummary,
    onOpen: () -> Unit,
    onRename: () -> Unit,
    onDuplicate: () -> Unit,
    onArchive: () -> Unit,
    onTrash: () -> Unit
) {
    var menuOpen by remember { mutableStateOf(false) }

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = BgSidebar,
        border = BorderStroke(1.dp, EdgeSoft),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onOpen)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.Note,
                    contentDescription = null,
                    tint = Accent,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(
                        text = page.title.ifEmpty { "Ohne Titel" },
                        color = TextPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = page.updated.take(10),
                        color = TextMuted,
                        fontSize = 11.sp
                    )
                }
            }

            Box {
                IconButton(
                    onClick = { menuOpen = true },
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.MoreVert,
                        contentDescription = "Aktionen",
                        tint = TextMuted,
                        modifier = Modifier.size(18.dp)
                    )
                }

                DropdownMenu(
                    expanded = menuOpen,
                    onDismissRequest = { menuOpen = false },
                    modifier = Modifier.background(BgSidebar)
                ) {
                    DropdownMenuItem(
                        text = { Text("Öffnen", color = TextPrimary) },
                        onClick = { menuOpen = false; onOpen() }
                    )
                    DropdownMenuItem(
                        text = { Text("Umbenennen", color = TextPrimary) },
                        onClick = { menuOpen = false; onRename() }
                    )
                    DropdownMenuItem(
                        text = { Text("Duplizieren", color = TextPrimary) },
                        onClick = { menuOpen = false; onDuplicate() }
                    )
                    DropdownMenuItem(
                        text = { Text("Archivieren", color = TextPrimary) },
                        onClick = { menuOpen = false; onArchive() }
                    )
                    DropdownMenuItem(
                        text = { Text("In Papierkorb", color = Danger) },
                        onClick = { menuOpen = false; onTrash() }
                    )
                }
            }
        }
    }
}

@Composable
private fun GoodNotesFolderCard(
    folder: HeftFolder,
    color: Color,
    onOpen: () -> Unit,
    onDelete: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = BgSidebar,
        border = BorderStroke(1.dp, Edge),
        modifier = Modifier
            .width(156.dp)
            .clip(RoundedCornerShape(14.dp))
            .clickable(onClick = onOpen)
    ) {
        Column {
            // Farbiger Ordner-Tab-Reiter oben
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(8.dp)
                    .background(color)
            )
            Column(modifier = Modifier.padding(12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Folder,
                        contentDescription = null,
                        tint = color,
                        modifier = Modifier.size(26.dp)
                    )
                    IconButton(
                        onClick = onDelete,
                        modifier = Modifier.size(22.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Close,
                            contentDescription = "Ordner löschen",
                            tint = TextMuted,
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = folder.title,
                    color = TextPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "Ordner",
                    color = TextMuted,
                    fontSize = 10.sp
                )
            }
        }
    }
}

@Composable
private fun GoodNotesBookCover(
    heft: PageSummary,
    coverColor: Color,
    pageCount: Int,
    onOpen: () -> Unit,
    onRename: () -> Unit,
    onMoveToFolder: () -> Unit,
    onTrash: () -> Unit
) {
    var menuOpen by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .width(142.dp)
            .clickable(onClick = onOpen),
        horizontalAlignment = Alignment.Start
    ) {
        // Realistisches Notizbuch-Cover (gn-book) mit Buchrücken (gn-spine)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(182.dp)
                .clip(RoundedCornerShape(topStart = 4.dp, bottomStart = 4.dp, topEnd = 12.dp, bottomEnd = 12.dp))
                .background(coverColor.copy(alpha = 0.85f))
                .border(
                    1.dp,
                    Color.White.copy(alpha = 0.18f),
                    RoundedCornerShape(topStart = 4.dp, bottomStart = 4.dp, topEnd = 12.dp, bottomEnd = 12.dp)
                )
        ) {
            // Buchrücken links (gn-spine)
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .width(14.dp)
                    .background(Color.Black.copy(alpha = 0.28f))
            )

            // Weißes Titel-Etikett auf dem Umschlag
            Surface(
                shape = RoundedCornerShape(6.dp),
                color = BgDeep.copy(alpha = 0.78f),
                modifier = Modifier
                    .padding(start = 24.dp, end = 12.dp, top = 26.dp)
                    .fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp)) {
                    Text(
                        text = heft.title.ifEmpty { "Ohne Titel" },
                        color = TextPrimary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(modifier = Modifier.height(3.dp))
                    Text(
                        text = "$pageCount ${if (pageCount == 1) "Seite" else "Seiten"}",
                        color = TextMuted,
                        fontSize = 10.sp
                    )
                }
            }

            // ⋯ Menü unten rechts auf dem Cover
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(6.dp)
            ) {
                IconButton(
                    onClick = { menuOpen = true },
                    modifier = Modifier
                        .size(26.dp)
                        .clip(CircleShape)
                        .background(BgDeep.copy(alpha = 0.55f))
                ) {
                    Icon(
                        imageVector = Icons.Rounded.MoreVert,
                        contentDescription = "Heft-Menü",
                        tint = TextPrimary,
                        modifier = Modifier.size(15.dp)
                    )
                }

                DropdownMenu(
                    expanded = menuOpen,
                    onDismissRequest = { menuOpen = false },
                    modifier = Modifier.background(BgSidebar)
                ) {
                    DropdownMenuItem(
                        text = { Text("Öffnen", color = TextPrimary) },
                        onClick = { menuOpen = false; onOpen() }
                    )
                    DropdownMenuItem(
                        text = { Text("Umbenennen", color = TextPrimary) },
                        onClick = { menuOpen = false; onRename() }
                    )
                    DropdownMenuItem(
                        text = { Text("In Ordner verschieben", color = TextPrimary) },
                        onClick = { menuOpen = false; onMoveToFolder() }
                    )
                    DropdownMenuItem(
                        text = { Text("Löschen", color = Danger) },
                        onClick = { menuOpen = false; onTrash() }
                    )
                }
            }
        }
    }
}

// ============================================================================
// 2. PAPIERKORB (TrashScreen nach renderTrashView in web/render.js)
// ============================================================================

@Composable
fun TrashScreen(
    core: ImpalaCore,
    onMutation: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()
    var filterTab by remember { mutableStateOf("all") }
    var searchQuery by remember { mutableStateOf("") }
    var showEmptyConfirm by remember { mutableStateOf(false) }

    var trashedPages by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    var trashedDecks by remember { mutableStateOf<List<DeckInfo>>(emptyList()) }
    var trashedCards by remember { mutableStateOf<List<CardInfo>>(emptyList()) }

    fun reloadTrash() {
        coroutineScope.launch(Dispatchers.IO) {
            runCatching {
                val pages = core.trashedPages()
                val decks = core.trashedDecks()
                val cards = core.trashedCards()
                withContext(Dispatchers.Main) {
                    trashedPages = pages
                    trashedDecks = decks
                    trashedCards = cards
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        reloadTrash()
    }

    val totalCount = trashedPages.size + trashedDecks.size + trashedCards.size

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel)
            .navigationBarsPadding()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(BgSidebar)
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "🗑️ Papierkorb",
                    color = TextPrimary,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )

                if (totalCount > 0) {
                    Surface(
                        shape = ImpalaPillShape,
                        color = DangerSoft,
                        border = BorderStroke(1.dp, DangerBorder),
                        modifier = Modifier
                            .clip(ImpalaPillShape)
                            .clickable { showEmptyConfirm = true }
                    ) {
                        Text(
                            text = "Papierkorb leeren ($totalCount)",
                            color = Danger,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    }
                }
            }

            // Suchfeld
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(BgBubble, RoundedCornerShape(10.dp))
                    .border(1.dp, EdgeSoft, RoundedCornerShape(10.dp))
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                Icon(
                    imageVector = Icons.Rounded.Search,
                    contentDescription = null,
                    tint = TextMuted,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                BasicTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp),
                    cursorBrush = SolidColor(Accent),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (searchQuery.isEmpty()) {
                            Text("Im Papierkorb suchen…", color = TextMuted, fontSize = 14.sp)
                        }
                        inner()
                    }
                )
            }

            // Filter-Tabs
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val tabs = listOf(
                    "all" to "Alle ($totalCount)",
                    "pages" to "Seiten & Hefte (${trashedPages.size})",
                    "decks" to "Stapel (${trashedDecks.size})",
                    "cards" to "Karten (${trashedCards.size})"
                )
                items(tabs, key = { it.first }) { (key, label) ->
                    val selected = filterTab == key
                    Surface(
                        shape = ImpalaPillShape,
                        color = if (selected) AccentSoft else BgBubble,
                        border = BorderStroke(1.dp, if (selected) AccentBorder else EdgeSoft),
                        modifier = Modifier
                            .clip(ImpalaPillShape)
                            .clickable { filterTab = key }
                    ) {
                        Text(
                            text = label,
                            color = if (selected) TextPrimary else TextSecondary,
                            fontSize = 12.sp,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    }
                }
            }
        }

        HorizontalDivider(color = EdgeSoft)

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (totalCount == 0) {
                item {
                    EmptyStateBox(
                        icon = "✨",
                        title = "Der Papierkorb ist leer",
                        subtitle = "Gelöschte Seiten, Hefte, Stapel und Karteikarten landen hier."
                    )
                }
            } else {
                // Seiten & Hefte
                if (filterTab == "all" || filterTab == "pages") {
                    val filteredPages = trashedPages.filter {
                        searchQuery.isBlank() || it.title.contains(searchQuery, ignoreCase = true)
                    }
                    items(filteredPages, key = { "pg_${it.id}" }) { pg ->
                        TrashItemRow(
                            icon = if (pg.kind == PageKind.HEFT) "📓" else "📄",
                            title = pg.title.ifEmpty { "Ohne Titel" },
                            badge = if (pg.kind == PageKind.HEFT) "Heft" else "Seite",
                            onRestore = {
                                coroutineScope.launch(Dispatchers.IO) {
                                    runCatching { core.restorePage(pg.id) }
                                    reloadTrash()
                                    onMutation()
                                }
                            },
                            onDeleteForever = {
                                coroutineScope.launch(Dispatchers.IO) {
                                    runCatching { core.deletePageForever(pg.id) }
                                    reloadTrash()
                                    onMutation()
                                }
                            }
                        )
                    }
                }

                // Stapel
                if (filterTab == "all" || filterTab == "decks") {
                    val filteredDecks = trashedDecks.filter {
                        searchQuery.isBlank() || it.name.contains(searchQuery, ignoreCase = true)
                    }
                    items(filteredDecks, key = { "dk_${it.name}" }) { deck ->
                        TrashItemRow(
                            icon = "🗂️",
                            title = deck.name,
                            badge = "Stapel · ${deck.cards} Karten",
                            onRestore = {
                                coroutineScope.launch(Dispatchers.IO) {
                                    runCatching { core.restoreDeck(deck.name) }
                                    reloadTrash()
                                    onMutation()
                                }
                            },
                            onDeleteForever = {
                                coroutineScope.launch(Dispatchers.IO) {
                                    runCatching { core.deleteDeck(deck.name) }
                                    reloadTrash()
                                    onMutation()
                                }
                            }
                        )
                    }
                }

                // Karten
                if (filterTab == "all" || filterTab == "cards") {
                    val filteredCards = trashedCards.filter {
                        searchQuery.isBlank() ||
                            it.front.contains(searchQuery, ignoreCase = true) ||
                            it.back.contains(searchQuery, ignoreCase = true)
                    }
                    items(filteredCards, key = { "cd_${it.id}" }) { card ->
                        TrashItemRow(
                            icon = "🃏",
                            title = card.front.ifEmpty { "Karteikarte" },
                            badge = "Karte · ${card.deck}",
                            onRestore = {
                                coroutineScope.launch(Dispatchers.IO) {
                                    runCatching { core.restoreCard(card.id) }
                                    reloadTrash()
                                    onMutation()
                                }
                            },
                            onDeleteForever = {
                                coroutineScope.launch(Dispatchers.IO) {
                                    runCatching { core.deleteCard(card.id) }
                                    reloadTrash()
                                    onMutation()
                                }
                            }
                        )
                    }
                }
            }
            item { Spacer(modifier = Modifier.height(72.dp)) }
        }
    }

    if (showEmptyConfirm) {
        AlertDialog(
            onDismissRequest = { showEmptyConfirm = false },
            containerColor = BgSidebar,
            title = { Text("Papierkorb endgültig leeren?", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                Text(
                    text = "Alle $totalCount Elemente im Papierkorb werden unwiderruflich gelöscht.",
                    color = TextSecondary,
                    fontSize = 13.sp
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showEmptyConfirm = false
                        coroutineScope.launch(Dispatchers.IO) {
                            runCatching {
                                core.emptyPageTrash()
                                core.emptyCardTrash()
                            }
                            reloadTrash()
                            onMutation()
                        }
                    }
                ) {
                    Text("Endgültig löschen", color = Danger, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showEmptyConfirm = false }) {
                    Text("Abbrechen", color = TextMuted)
                }
            }
        )
    }
}

@Composable
private fun TrashItemRow(
    icon: String,
    title: String,
    badge: String,
    onRestore: () -> Unit,
    onDeleteForever: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = BgSidebar,
        border = BorderStroke(1.dp, EdgeSoft),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                Text(text = icon, fontSize = 18.sp)
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(
                        text = title,
                        color = TextPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = badge,
                        color = TextMuted,
                        fontSize = 11.sp
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Surface(
                    shape = ImpalaPillShape,
                    color = AccentSoft,
                    border = BorderStroke(1.dp, AccentBorder),
                    modifier = Modifier
                        .clip(ImpalaPillShape)
                        .clickable(onClick = onRestore)
                ) {
                    Text(
                        text = "Wiederherstellen",
                        color = TextPrimary,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                    )
                }
                Surface(
                    shape = ImpalaPillShape,
                    color = DangerSoft,
                    border = BorderStroke(1.dp, DangerBorder),
                    modifier = Modifier
                        .clip(ImpalaPillShape)
                        .clickable(onClick = onDeleteForever)
                ) {
                    Text(
                        text = "Endgültig löschen",
                        color = Danger,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                    )
                }
            }
        }
    }
}

// ============================================================================
// 3. WISSENSGRAPH (KnowledgeGraphScreen nach web/graph.js)
// ============================================================================

private data class GraphNode(
    val id: String,
    val title: String,
    val isHeft: Boolean,
    var x: Float,
    var y: Float,
    val degree: Int
)

private data class GraphEdge(
    val sourceId: String,
    val targetId: String,
    val isWikiLink: Boolean
)

@Composable
fun KnowledgeGraphScreen(
    core: ImpalaCore,
    pages: List<PageSummary> = emptyList(),
    onOpenPage: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var filterMode by remember { mutableStateOf("all") } // "all", "linked", "hefte"
    var searchQuery by remember { mutableStateOf("") }
    var zoom by remember { mutableFloatStateOf(1f) }
    var panOffset by remember { mutableStateOf(Offset.Zero) }
    var selectedNodeId by remember { mutableStateOf<String?>(null) }

    var nodes by remember { mutableStateOf<List<GraphNode>>(emptyList()) }
    var edges by remember { mutableStateOf<List<GraphEdge>>(emptyList()) }

    LaunchedEffect(pages, filterMode, searchQuery) {
        withContext(Dispatchers.IO) {
            runCatching {
                val baseList = if (pages.isNotEmpty()) pages else core.recentPages(300u)
                val edgeSet = mutableSetOf<GraphEdge>()
                val degreeMap = mutableMapOf<String, Int>()
                val idSet = baseList.map { it.id }.toSet()

                for (pg in baseList) {
                    // Eltern-Kind-Beziehung
                    val pid = pg.parentId
                    if (!pid.isNullOrEmpty() && pid in idSet) {
                        edgeSet.add(GraphEdge(pid, pg.id, isWikiLink = false))
                        degreeMap[pid] = (degreeMap[pid] ?: 0) + 1
                        degreeMap[pg.id] = (degreeMap[pg.id] ?: 0) + 1
                    }
                    // Wiki-Links / Backlinks
                    val backlinks = runCatching { core.backlinks(pg.id) }.getOrDefault(emptyList())
                    for (bl in backlinks) {
                        if (bl.id in idSet && bl.id != pg.id) {
                            edgeSet.add(GraphEdge(bl.id, pg.id, isWikiLink = true))
                            degreeMap[bl.id] = (degreeMap[bl.id] ?: 0) + 1
                            degreeMap[pg.id] = (degreeMap[pg.id] ?: 0) + 1
                        }
                    }
                }

                val filteredPages = baseList.filter { pg ->
                    val matchesSearch = searchQuery.isBlank() || pg.title.contains(searchQuery, ignoreCase = true)
                    val matchesMode = when (filterMode) {
                        "linked" -> (degreeMap[pg.id] ?: 0) > 0
                        "hefte" -> pg.kind == PageKind.HEFT
                        else -> true
                    }
                    matchesSearch && matchesMode
                }

                // Radiales + Force-inspiriertes Layout berechnen
                val n = filteredPages.size.coerceAtLeast(1)
                val builtNodes = filteredPages.mapIndexed { i, pg ->
                    val angle = 2.0 * PI * i / n
                    val ring = 140f + (i % 3) * 95f
                    GraphNode(
                        id = pg.id,
                        title = pg.title.ifEmpty { "Ohne Titel" },
                        isHeft = pg.kind == PageKind.HEFT,
                        x = (cos(angle) * ring).toFloat(),
                        y = (sin(angle) * ring).toFloat(),
                        degree = degreeMap[pg.id] ?: 0
                    )
                }.toMutableList()

                // Kurze Force-Directed Relaxation (25 Iterationen)
                val nodeById = builtNodes.associateBy { it.id }
                repeat(25) {
                    for (i in builtNodes.indices) {
                        for (j in i + 1 until builtNodes.size) {
                            val a = builtNodes[i]
                            val b = builtNodes[j]
                            val dx = b.x - a.x
                            val dy = b.y - a.y
                            val distSq = (dx * dx + dy * dy).coerceAtLeast(100f)
                            val repulse = 4200f / distSq
                            val dist = sqrt(distSq)
                            a.x -= (dx / dist) * repulse
                            a.y -= (dy / dist) * repulse
                            b.x += (dx / dist) * repulse
                            b.y += (dy / dist) * repulse
                        }
                    }
                    for (e in edgeSet) {
                        val a = nodeById[e.sourceId] ?: continue
                        val b = nodeById[e.targetId] ?: continue
                        val dx = b.x - a.x
                        val dy = b.y - a.y
                        a.x += dx * 0.04f
                        a.y += dy * 0.04f
                        b.x -= dx * 0.04f
                        b.y -= dy * 0.04f
                    }
                }

                val activeIds = builtNodes.map { it.id }.toSet()
                val activeEdges = edgeSet.filter { it.sourceId in activeIds && it.targetId in activeIds }

                withContext(Dispatchers.Main) {
                    nodes = builtNodes
                    edges = activeEdges
                }
            }
        }
    }

    val selectedNode = remember(nodes, selectedNodeId) {
        nodes.find { it.id == selectedNodeId }
    }
    val neighborIds = remember(edges, selectedNodeId) {
        if (selectedNodeId == null) emptySet()
        else edges.mapNotNull {
            when (selectedNodeId) {
                it.sourceId -> it.targetId
                it.targetId -> it.sourceId
                else -> null
            }
        }.toSet()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel)
            .navigationBarsPadding()
    ) {
        // Steuerleiste oben
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(BgSidebar)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "🕸️ Wissensgraph",
                    color = TextPrimary,
                    fontSize = 19.sp,
                    fontWeight = FontWeight.Bold
                )

                Surface(
                    shape = ImpalaPillShape,
                    color = BgBubble,
                    border = BorderStroke(1.dp, EdgeSoft),
                    modifier = Modifier
                        .clip(ImpalaPillShape)
                        .clickable {
                            zoom = 1f
                            panOffset = Offset.Zero
                            selectedNodeId = null
                        }
                ) {
                    Text(
                        text = "Reset Zoom",
                        color = TextSecondary,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                val filters = listOf(
                    "all" to "Alle",
                    "linked" to "Nur Verknüpfte",
                    "hefte" to "Hefte"
                )
                for ((key, label) in filters) {
                    val active = filterMode == key
                    Surface(
                        shape = ImpalaPillShape,
                        color = if (active) AccentSoft else BgBubble,
                        border = BorderStroke(1.dp, if (active) AccentBorder else EdgeSoft),
                        modifier = Modifier
                            .clip(ImpalaPillShape)
                            .clickable { filterMode = key }
                    ) {
                        Text(
                            text = label,
                            color = if (active) TextPrimary else TextSecondary,
                            fontSize = 11.sp,
                            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                        )
                    }
                }

                // Kompakter Suchfilter
                BasicTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    textStyle = TextStyle(color = TextPrimary, fontSize = 12.sp),
                    cursorBrush = SolidColor(Accent),
                    singleLine = true,
                    modifier = Modifier
                        .weight(1f)
                        .background(BgBubble, ImpalaPillShape)
                        .border(1.dp, EdgeSoft, ImpalaPillShape)
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                    decorationBox = { inner ->
                        if (searchQuery.isEmpty()) {
                            Text("Knoten filtern…", color = TextMuted, fontSize = 12.sp)
                        }
                        inner()
                    }
                )
            }
        }

        HorizontalDivider(color = EdgeSoft)

        // Interaktiver Canvas-Graph
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(BgDeep)
        ) {
            Canvas(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, gestureZoom, _ ->
                            zoom = (zoom * gestureZoom).coerceIn(0.35f, 3.5f)
                            panOffset += pan
                        }
                    }
                    .pointerInput(nodes, zoom, panOffset) {
                        detectTapGestures { tapOffset ->
                            val cx = size.width / 2f + panOffset.x
                            val cy = size.height / 2f + panOffset.y
                            val hit = nodes.firstOrNull { node ->
                                val sx = cx + node.x * zoom
                                val sy = cy + node.y * zoom
                                hypot(tapOffset.x - sx, tapOffset.y - sy) <= 28f * max(zoom, 0.8f)
                            }
                            selectedNodeId = hit?.id
                        }
                    }
            ) {
                val cx = size.width / 2f + panOffset.x
                val cy = size.height / 2f + panOffset.y
                val nodeMap = nodes.associateBy { it.id }

                // Kanten zeichnen
                for (edge in edges) {
                    val src = nodeMap[edge.sourceId] ?: continue
                    val dst = nodeMap[edge.targetId] ?: continue
                    val highlighted = selectedNodeId != null &&
                        (edge.sourceId == selectedNodeId || edge.targetId == selectedNodeId)
                    val edgeColor = when {
                        highlighted -> Accent
                        edge.isWikiLink -> Warn.copy(alpha = 0.35f)
                        else -> Color.White.copy(alpha = 0.16f)
                    }
                    drawLine(
                        color = edgeColor,
                        start = Offset(cx + src.x * zoom, cy + src.y * zoom),
                        end = Offset(cx + dst.x * zoom, cy + dst.y * zoom),
                        strokeWidth = if (highlighted) 3.5f else 1.8f
                    )
                }

                // Knoten zeichnen
                for (node in nodes) {
                    val sx = cx + node.x * zoom
                    val sy = cy + node.y * zoom
                    val isSelected = node.id == selectedNodeId
                    val isNeighbor = node.id in neighborIds
                    val radius = (10f + (node.degree.coerceAtMost(8) * 1.8f)) * zoom.coerceIn(0.6f, 1.8f)

                    val fill = when {
                        isSelected -> Accent
                        isNeighbor -> Success
                        node.isHeft -> Warn
                        else -> Color(0xFF6B8CAE)
                    }
                    if (isSelected || isNeighbor) {
                        drawCircle(
                            color = fill.copy(alpha = 0.25f),
                            radius = radius * 1.65f,
                            center = Offset(sx, sy)
                        )
                    }
                    drawCircle(
                        color = fill,
                        radius = radius,
                        center = Offset(sx, sy)
                    )
                }
            }

            // Info-Karte für den ausgewählten Knoten
            if (selectedNode != null) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = BgSidebar,
                    border = BorderStroke(1.dp, AccentBorder),
                    shadowElevation = 12.dp,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp)
                        .fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = if (selectedNode.isHeft) "📓 GoodNotes-Heft" else "📝 Notion-Seite",
                                color = TextMuted,
                                fontSize = 11.sp
                            )
                            Text(
                                text = selectedNode.title,
                                color = TextPrimary,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = "${selectedNode.degree} ${if (selectedNode.degree == 1) "Verknüpfung" else "Verknüpfungen"}",
                                color = TextSecondary,
                                fontSize = 12.sp
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Surface(
                            shape = ImpalaPillShape,
                            color = Accent,
                            modifier = Modifier
                                .clip(ImpalaPillShape)
                                .clickable { onOpenPage(selectedNode.id) }
                        ) {
                            Text(
                                text = "Seite öffnen →",
                                color = Color(0xFF081018),
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

// ============================================================================
// 4. GEMINI NOTEBOOK (NotebookLmScreen nach web/notebooklm.js)
// ============================================================================

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NotebookLmScreen(
    core: ImpalaCore,
    pages: List<PageSummary> = emptyList(),
    onOpenPage: (String) -> Unit,
    onOpenAiWithPrompt: (String) -> Unit = {},
    onMutation: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()
    var availablePages by remember(pages) { mutableStateOf(pages) }
    val selectedIds = remember { mutableStateListOf<String>() }
    var statusBanner by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(pages) {
        if (pages.isEmpty()) {
            withContext(Dispatchers.IO) {
                val loaded = runCatching { core.recentPages(100u) }.getOrDefault(emptyList())
                withContext(Dispatchers.Main) {
                    availablePages = loaded
                    if (selectedIds.isEmpty()) {
                        selectedIds.addAll(loaded.take(3).map { it.id })
                    }
                }
            }
        } else if (selectedIds.isEmpty()) {
            selectedIds.addAll(pages.take(3).map { it.id })
        }
    }

    fun executeStudioAction(actionTitle: String, kindTag: String) {
        val chosen = availablePages.filter { it.id in selectedIds }
        if (chosen.isEmpty()) {
            statusBanner = "Bitte wähle zuerst mindestens eine Quelle aus."
            return
        }
        coroutineScope.launch(Dispatchers.IO) {
            runCatching {
                val sb = StringBuilder()
                sb.append("# $actionTitle\n\n")
                sb.append("_Erstellt mit Gemini Notebook aus ${chosen.size} Quellen:_\n\n")

                for (src in chosen) {
                    val detail = core.page(src.id)
                    val body = detail?.content?.trim().orEmpty()
                    sb.append("## Quelle: [[${src.title.ifEmpty { "Ohne Titel" }}]]\n")
                    if (body.isNotEmpty()) {
                        sb.append(body.take(800)).append("\n\n")
                    } else {
                        sb.append("_(Handschrift-Heft / Visuelle Quelle)_\n\n")
                    }
                }

                when (kindTag) {
                    "cards" -> {
                        for (src in chosen) {
                            core.createCard(
                                "Kernaussage aus „${src.title}“?",
                                "Siehe Notiz [[${src.title}]]",
                                "Gemini Notebook",
                                src.id
                            )
                        }
                        withContext(Dispatchers.Main) {
                            statusBanner = "✓ ${chosen.size} Karteikarten im Stapel „Gemini Notebook“ erzeugt!"
                            onMutation()
                        }
                    }
                    "chat" -> {
                        val prompt = "Analysiere meine ausgewählten Quellen (${chosen.joinToString { it.title }}): "
                        withContext(Dispatchers.Main) {
                            onOpenAiWithPrompt(prompt)
                            statusBanner = "KI-Chat mit ${chosen.size} Quellen gestartet."
                        }
                    }
                    else -> {
                        val newPageId = core.createPage(
                            "$actionTitle (${chosen.first().title.take(20)})",
                            sb.toString(),
                            null,
                            null
                        )
                        withContext(Dispatchers.Main) {
                            onMutation()
                            onOpenPage(newPageId)
                        }
                    }
                }
            }
        }
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel)
            .navigationBarsPadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = "✦ Gemini Notebook",
                    color = TextPrimary,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Wähle Notizen und Hefte als Quellen aus, um Studienführer, Briefings, Audio-Skripte oder Karteikarten zu generieren.",
                    color = TextSecondary,
                    fontSize = 13.sp
                )
            }
        }

        if (statusBanner != null) {
            item {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = AccentSoft,
                    border = BorderStroke(1.dp, AccentBorder),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = statusBanner!!,
                        color = TextPrimary,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }
        }

        // Studio-Aktionen
        item {
            Text(
                text = "STUDIO-AKTIONEN (${selectedIds.size} QUELLEN AUSGEWÄHLT)",
                color = TextMuted,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.8.sp
            )
        }

        item {
            val actions = listOf(
                Triple("📝 Studienführer erstellen", "Strukturierter Lernplan & Kernkonzepte", "guide"),
                Triple("📋 Briefing-Dokument", "Kompakte Executive-Zusammenfassung", "briefing"),
                Triple("❓ FAQ generieren", "Häufige Prüfungsfragen & Antworten", "faq"),
                Triple("🃏 Karteikarten aus Quellen erzeugen", "FSRS-Karten direkt in Stapel speichern", "cards"),
                Triple("🎙️ Audio-Überblick / Podcast-Skript", "Dialogisches Deep-Dive-Skript", "podcast"),
                Triple("💬 Mit ausgewählten Quellen chatten", "Gezielte Rückfragen im KI-Coach", "chat")
            )
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                maxItemsInEachRow = 2
            ) {
                for ((title, desc, tag) in actions) {
                    Surface(
                        shape = RoundedCornerShape(14.dp),
                        color = BgSidebar,
                        border = BorderStroke(1.dp, Edge),
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(14.dp))
                            .clickable { executeStudioAction(title.substringAfter(" "), tag) }
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Text(
                                text = title,
                                color = TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = desc,
                                color = TextMuted,
                                fontSize = 11.sp
                            )
                        }
                    }
                }
            }
        }

        // Quellen-Auswahl (Multi-Select)
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "QUELLEN AUSWÄHLEN",
                    color = TextMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.8.sp
                )
                Text(
                    text = if (selectedIds.size == availablePages.size) "Keine auswählen" else "Alle auswählen",
                    color = Accent,
                    fontSize = 12.sp,
                    modifier = Modifier.clickable {
                        if (selectedIds.size == availablePages.size) {
                            selectedIds.clear()
                        } else {
                            selectedIds.clear()
                            selectedIds.addAll(availablePages.map { it.id })
                        }
                    }
                )
            }
        }

        items(availablePages, key = { it.id }) { pg ->
            val checked = pg.id in selectedIds
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = if (checked) AccentSoft else BgSidebar,
                border = BorderStroke(1.dp, if (checked) AccentBorder else EdgeSoft),
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .clickable {
                        if (checked) selectedIds.remove(pg.id) else selectedIds.add(pg.id)
                    }
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = if (checked) Icons.Rounded.CheckBox else Icons.Rounded.CheckBoxOutlineBlank,
                        contentDescription = null,
                        tint = if (checked) Accent else TextMuted,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = if (pg.kind == PageKind.HEFT) "📓" else "📄",
                        fontSize = 15.sp
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = pg.title.ifEmpty { "Ohne Titel" },
                        color = TextPrimary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }

        item { Spacer(modifier = Modifier.height(72.dp)) }
    }
}

// ============================================================================
// 5. SCHULNOTEN & SCHNITT-RECHNER (GradesScreen nach web/schulnoten.js)
// ============================================================================

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GradesScreen(
    core: ImpalaCore,
    onMutation: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()
    var subjects by remember { mutableStateOf<List<SubjectGrades>>(emptyList()) }
    var showAddDialog by remember { mutableStateOf(false) }

    var inputSubject by remember { mutableStateOf("") }
    var inputGrade by remember { mutableStateOf("2.0") }
    var inputWeight by remember { mutableStateOf("1.0") }
    var inputComment by remember { mutableStateOf("") }

    fun reloadGrades() {
        coroutineScope.launch(Dispatchers.IO) {
            runCatching {
                val list = core.gradesBySubject()
                withContext(Dispatchers.Main) {
                    subjects = list
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        reloadGrades()
    }

    val overallAverage = remember(subjects) {
        val avgs = subjects.mapNotNull { it.average }
        if (avgs.isEmpty()) null else avgs.average()
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel)
            .navigationBarsPadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Header + Gesamtschnitt
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "🎓 Schulnoten & Schnitt",
                        color = TextPrimary,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = if (overallAverage != null) {
                            String.format(Locale.GERMAN, "Gesamtschnitt: Ø %.2f", overallAverage)
                        } else {
                            "Trage deine schriftlichen & mündlichen Noten ein"
                        },
                        color = if (overallAverage != null) Accent else TextSecondary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium
                    )
                }

                Surface(
                    shape = ImpalaPillShape,
                    color = Accent,
                    modifier = Modifier
                        .clip(ImpalaPillShape)
                        .clickable { showAddDialog = true }
                ) {
                    Text(
                        text = "+ Note eintragen",
                        color = Color(0xFF081018),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp)
                    )
                }
            }
        }

        if (subjects.isEmpty()) {
            item {
                EmptyStateBox(
                    icon = "🎓",
                    title = "Noch keine Noten eingetragen",
                    subtitle = "Tippe oben auf „+ Note eintragen“, um Fächer und Gewichtungen zu verwalten."
                )
            }
        } else {
            items(subjects, key = { it.subject }) { subj ->
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = BgSidebar,
                    border = BorderStroke(1.dp, EdgeSoft),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = subj.subject,
                                color = TextPrimary,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Surface(
                                shape = ImpalaPillShape,
                                color = AccentSoft,
                                border = BorderStroke(1.dp, AccentBorder)
                            ) {
                                Text(
                                    text = subj.average?.let { String.format(Locale.GERMAN, "Ø %.2f", it) } ?: "—",
                                    color = TextPrimary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(10.dp))

                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            for (g in subj.grades) {
                                GradeChip(
                                    grade = g,
                                    onDelete = {
                                        coroutineScope.launch(Dispatchers.IO) {
                                            runCatching { core.deleteGrade(g.id) }
                                            reloadGrades()
                                            onMutation()
                                        }
                                    }
                                )
                            }
                        }
                    }
                }
            }
        }

        item { Spacer(modifier = Modifier.height(72.dp)) }
    }

    if (showAddDialog) {
        AlertDialog(
            onDismissRequest = { showAddDialog = false },
            containerColor = BgSidebar,
            title = { Text("Note eintragen", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    GradeInputField(
                        value = inputSubject,
                        onValueChange = { inputSubject = it },
                        placeholder = "Fach (z.B. Mathematik)"
                    )
                    GradeInputField(
                        value = inputGrade,
                        onValueChange = { inputGrade = it },
                        placeholder = "Note (1.0 bis 6.0)"
                    )
                    GradeInputField(
                        value = inputWeight,
                        onValueChange = { inputWeight = it },
                        placeholder = "Gewichtung (z.B. 1.0 mündlich, 2.0 Klausur)"
                    )
                    GradeInputField(
                        value = inputComment,
                        onValueChange = { inputComment = it },
                        placeholder = "Kommentar (optional, z.B. Klausur 1)"
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val subj = inputSubject.trim()
                        val gr = inputGrade.replace(',', '.').toDoubleOrNull()
                        val wt = inputWeight.replace(',', '.').toDoubleOrNull() ?: 1.0
                        if (subj.isNotEmpty() && gr != null && gr in 1.0..6.0) {
                            coroutineScope.launch(Dispatchers.IO) {
                                runCatching {
                                    core.addGrade(
                                        subj,
                                        gr,
                                        wt,
                                        LocalDate.now().toString(),
                                        inputComment.trim().ifEmpty { null }
                                    )
                                }
                                reloadGrades()
                                onMutation()
                            }
                            inputComment = ""
                            showAddDialog = false
                        }
                    }
                ) {
                    Text("Speichern", color = Accent, fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showAddDialog = false }) {
                    Text("Abbrechen", color = TextMuted)
                }
            }
        )
    }
}

@Composable
private fun GradeChip(
    grade: GradeInfo,
    onDelete: () -> Unit
) {
    val badgeColor = when {
        grade.grade <= 2.0 -> Success
        grade.grade <= 3.5 -> Accent
        grade.grade <= 4.5 -> Warn
        else -> Danger
    }

    Surface(
        shape = RoundedCornerShape(10.dp),
        color = BgBubble,
        border = BorderStroke(1.dp, EdgeSoft)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = String.format(Locale.GERMAN, "%.1f", grade.grade),
                color = badgeColor,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold
            )
            if (grade.weight != 1.0) {
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = "×${grade.weight}",
                    color = TextMuted,
                    fontSize = 10.sp
                )
            }
            if (grade.comment.isNotEmpty()) {
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = grade.comment,
                    color = TextSecondary,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Spacer(modifier = Modifier.width(6.dp))
            Icon(
                imageVector = Icons.Rounded.Close,
                contentDescription = "Note löschen",
                tint = TextMuted,
                modifier = Modifier
                    .size(14.dp)
                    .clickable(onClick = onDelete)
            )
        }
    }
}

@Composable
private fun GradeInputField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String
) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp),
        cursorBrush = SolidColor(Accent),
        singleLine = true,
        modifier = Modifier
            .fillMaxWidth()
            .background(BgBubble, RoundedCornerShape(8.dp))
            .border(1.dp, EdgeSoft, RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        decorationBox = { inner ->
            if (value.isEmpty()) {
                Text(placeholder, color = TextMuted, fontSize = 13.sp)
            }
            inner()
        }
    )
}

@Composable
private fun EmptyStateBox(
    icon: String,
    title: String,
    subtitle: String
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = BgSidebar,
        border = BorderStroke(1.dp, EdgeSoft),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(text = icon, fontSize = 28.sp)
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = title,
                color = TextPrimary,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = subtitle,
                color = TextSecondary,
                fontSize = 12.sp
            )
        }
    }
}
