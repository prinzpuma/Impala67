package org.impala67.app.ui.editor

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.FormatListBulleted
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.automirrored.rounded.NavigateNext
import androidx.compose.material.icons.automirrored.rounded.Note
import androidx.compose.material.icons.automirrored.rounded.Redo
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Archive
import androidx.compose.material.icons.rounded.AttachFile
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CheckBox
import androidx.compose.material.icons.rounded.CheckBoxOutlineBlank
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DriveFileMove
import androidx.compose.material.icons.rounded.EmojiEmotions
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.FormatListNumbered
import androidx.compose.material.icons.rounded.FormatQuote
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.HorizontalRule
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.PostAdd
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material.icons.rounded.TableChart
import androidx.compose.material.icons.rounded.Title
import androidx.compose.material.icons.rounded.Wallpaper
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.data.ImpalaRepository
import org.impala67.app.ui.theme.Accent
import org.impala67.app.ui.theme.AccentBorder
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgDeep
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.EdgeSoft
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.Success
import org.impala67.app.ui.theme.SurfaceActive
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.Warn
import org.json.JSONObject
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.MdBlock
import uniffi.impala_ffi.MdBlockKind
import uniffi.impala_ffi.MdHeadingLevel
import uniffi.impala_ffi.MdListStyle
import uniffi.impala_ffi.PageDetail
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.PageVersion
import uniffi.impala_ffi.WorkspaceInfo
import uniffi.impala_ffi.blocksToMarkdown
import uniffi.impala_ffi.markdownToBlocks
import java.util.UUID

private data class EditorSnapshot(
    val title: String,
    val blocks: List<MdBlock>
)

private val PAGE_EMOJIS = listOf(
    "📝", "📚", "💡", "🎯", "🚀", "🔬", "🧠", "📐",
    "💻", "🎨", "🏛️", "🌍", "⚡", "🔥", "🌱", "📊",
    "🎵", "🧪", "📖", "🗂️", "✅", "⭐", "🧩", "🎓"
)

private data class CoverOption(val id: String, val label: String)

private val PAGE_COVERS = listOf(
    CoverOption("", "Kein Cover"),
    CoverOption("sunset", "Sunset"),
    CoverOption("ocean", "Ocean"),
    CoverOption("forest", "Forest"),
    CoverOption("grape", "Grape"),
    CoverOption("aurora", "Aurora"),
    CoverOption("mono", "Mono"),
    CoverOption("karo", "Karo"),
    CoverOption("linien", "Linien"),
    CoverOption("punkte", "Punkte")
)

/**
 * Rückwärtskompatibler Überladungs-Einstiegspunkt für Aufrufer mit ImpalaRepository.
 */
@Composable
fun NoteEditorScreen(
    pageId: String,
    repository: ImpalaRepository,
    onNavigateToPage: (String) -> Unit,
    onBack: () -> Unit,
    onOpenAiForPage: (String) -> Unit = {},
    isTabletUi: Boolean = false,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val uiPrefs = remember(context) {
        context.getSharedPreferences("impala_ui_prefs", Context.MODE_PRIVATE)
    }
    var isFav by remember(pageId) {
        mutableStateOf(uiPrefs.getBoolean("fav_$pageId", false))
    }

    // Reagiere auf externe Änderungen im Repository
    var externalReloadTick by remember { mutableStateOf(0) }
    LaunchedEffect(pageId) {
        repository.changesFlow.collect { changes ->
            if (changes.closedPages.contains(pageId)) {
                onBack()
                return@collect
            }
            if (changes.pages.contains(pageId) || changes.pagesAll || changes.everything) {
                externalReloadTick++
            }
        }
    }

    NoteEditorScreen(
        core = repository.core,
        pageId = "$pageId#$externalReloadTick".substringBefore("#"),
        onNavigateBack = onBack,
        onOpenAiForPage = onOpenAiForPage,
        onMutation = { repository.refreshAll() },
        isTabletUi = isTabletUi,
        isFavorite = isFav,
        onToggleFavorite = {
            isFav = !isFav
            uiPrefs.edit().putBoolean("fav_$pageId", isFav).apply()
        },
        onOpenPage = onNavigateToPage,
        modifier = modifier
    )
}

/**
 * Vollwertiger nativer Notiz- & Markdown-Editor für Impala67 nach Vorbild der PWA (`web/render.js` & `web/editor.js`).
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun NoteEditorScreen(
    core: ImpalaCore,
    pageId: String,
    onNavigateBack: () -> Unit,
    onOpenAiForPage: (String) -> Unit = {},
    onMutation: () -> Unit = {},
    isTabletUi: Boolean = false,
    isFavorite: Boolean = false,
    onToggleFavorite: () -> Unit = {},
    onOpenPage: (String) -> Unit = {},
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val listState = rememberLazyListState()
    val metaPrefs = remember(context) {
        context.getSharedPreferences("impala_page_meta", Context.MODE_PRIVATE)
    }

    // Seiteninhalte & Metadaten
    var pageDetail by remember { mutableStateOf<PageDetail?>(null) }
    var pageTitle by remember { mutableStateOf("") }
    var pageIcon by remember(pageId) { mutableStateOf(metaPrefs.getString("icon_$pageId", "") ?: "") }
    var pageCover by remember(pageId) { mutableStateOf(metaPrefs.getString("cover_$pageId", "") ?: "") }
    var blocks by remember { mutableStateOf<List<MdBlock>>(emptyList()) }
    var ancestors by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    var subpages by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    var backlinks by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    var workspaces by remember { mutableStateOf<List<WorkspaceInfo>>(emptyList()) }
    var isDirty by remember { mutableStateOf(false) }

    // Undo / Redo Stack
    val undoStack = remember { mutableStateListOf<EditorSnapshot>() }
    val redoStack = remember { mutableStateListOf<EditorSnapshot>() }

    // Fokus und Formatierungsleiste
    var activeBlockId by remember { mutableStateOf<String?>(null) }
    var activeBlockSelection by remember { mutableStateOf(TextRange.Zero) }

    // Menüs, Dialoge und Sheets
    var showShareMenu by remember { mutableStateOf(false) }
    var showMoreMenu by remember { mutableStateOf(false) }
    var showIconDialog by remember { mutableStateOf(false) }
    var showCoverDialog by remember { mutableStateOf(false) }
    var showMoveDialog by remember { mutableStateOf(false) }
    var showHistoryDialog by remember { mutableStateOf(false) }
    var showInsertSheet by remember { mutableStateOf(false) }
    var insertTargetIndex by remember { mutableStateOf<Int?>(null) }
    var backlinksExpanded by remember { mutableStateOf(false) }

    // Debounce-Timer für Speicherung
    var saveJob by remember { mutableStateOf<Job?>(null) }

    fun pushUndoSnapshot() {
        val snap = EditorSnapshot(pageTitle, blocks)
        if (undoStack.lastOrNull() != snap) {
            undoStack.add(snap)
            if (undoStack.size > 40) undoStack.removeAt(0)
            redoStack.clear()
        }
    }

    fun persistNow(titleToSave: String, blocksToSave: List<MdBlock>) {
        try {
            val markdown = blocksToMarkdown(blocksToSave)
            core.updatePage(pageId, titleToSave, markdown)
            isDirty = false
            onMutation()
        } catch (e: Exception) {
            Log.e("NoteEditorScreen", "Fehler beim Speichern von Seite $pageId", e)
        }
    }

    fun scheduleSave(newTitle: String = pageTitle, newBlocks: List<MdBlock> = blocks) {
        isDirty = true
        saveJob?.cancel()
        saveJob = coroutineScope.launch {
            delay(380)
            withContext(Dispatchers.IO) {
                persistNow(newTitle, newBlocks)
            }
        }
    }

    fun updateIcon(newIcon: String) {
        pageIcon = newIcon
        metaPrefs.edit().putString("icon_$pageId", newIcon).apply()
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val payload = JSONObject().apply {
                    put("id", pageId)
                    put("patch", JSONObject().apply { put("icon", newIcon) })
                }.toString()
                core.dispatch("pageUpdate", payload)
                onMutation()
            } catch (_: Exception) {}
        }
    }

    fun updateCover(newCover: String) {
        pageCover = newCover
        metaPrefs.edit().putString("cover_$pageId", newCover).apply()
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val payload = JSONObject().apply {
                    put("id", pageId)
                    put("patch", JSONObject().apply { put("cover", newCover) })
                }.toString()
                core.dispatch("pageUpdate", payload)
                onMutation()
            } catch (_: Exception) {}
        }
    }

    fun insertNewBlock(kind: MdBlockKind) {
        pushUndoSnapshot()
        val newBlock = MdBlock(
            id = UUID.randomUUID().toString(),
            kind = kind,
            textColor = null,
            bgColor = null
        )
        val target = insertTargetIndex ?: blocks.size
        val updated = blocks.toMutableList().apply {
            add(target.coerceIn(0, size), newBlock)
        }
        blocks = updated
        activeBlockId = newBlock.id
        scheduleSave(newBlocks = updated)
        showInsertSheet = false
    }

    fun reloadPage(forceReloadContent: Boolean = false) {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val detail: PageDetail? = core.page(pageId)
                val ancs = core.ancestorsOf(pageId)
                val subs = core.childrenOf(pageId, null)
                val backs = core.backlinks(pageId)
                val wsList = core.workspaces()

                withContext(Dispatchers.Main) {
                    pageDetail = detail
                    ancestors = ancs
                    subpages = subs
                    backlinks = backs
                    workspaces = wsList

                    if (detail != null) {
                        if (forceReloadContent || (!isDirty && blocks.isEmpty())) {
                            pageTitle = detail.summary.title
                            blocks = markdownToBlocks(detail.content)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e("NoteEditorScreen", "Fehler beim Laden von Seite $pageId", e)
            }
        }
    }

    LaunchedEffect(pageId) {
        reloadPage(forceReloadContent = true)
    }

    DisposableEffect(pageId) {
        onDispose {
            saveJob?.cancel()
            if (isDirty) {
                persistNow(pageTitle, blocks)
            }
        }
    }

    // Spracherkennung für direktes Diktat
    val (speechState, toggleSpeech) = rememberNativeSpeechRecognizer(
        onSpeechResult = { recognizedText ->
            pushUndoSnapshot()
            val blockId = activeBlockId ?: blocks.firstOrNull()?.id
            if (blockId != null) {
                val updated = blocks.map { b ->
                    if (b.id == blockId) {
                        val oldText = getBlockText(b.kind)
                        val sep = if (oldText.isEmpty() || oldText.endsWith(" ")) "" else " "
                        val newText = oldText + sep + recognizedText
                        b.copy(kind = updateBlockText(b.kind, newText))
                    } else b
                }
                blocks = updated
                scheduleSave(newBlocks = updated)
            } else {
                val newBlock = MdBlock(
                    id = UUID.randomUUID().toString(),
                    kind = MdBlockKind.Paragraph(recognizedText),
                    textColor = null,
                    bgColor = null
                )
                blocks = listOf(newBlock)
                activeBlockId = newBlock.id
                scheduleSave(newBlocks = blocks)
            }
        }
    )

    // Bild-Auswahl
    val imagePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) {
            coroutineScope.launch(Dispatchers.IO) {
                try {
                    val inputStream = context.contentResolver.openInputStream(uri)
                    val bytes = inputStream?.use { it.readBytes() } ?: return@launch
                    val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                    val fileId = core.addFile(bytes, mime, "bild_${System.currentTimeMillis()}.jpg")

                    val imageBlock = MdBlock(
                        id = UUID.randomUUID().toString(),
                        kind = MdBlockKind.Image("Bild", fileId),
                        textColor = null,
                        bgColor = null
                    )

                    withContext(Dispatchers.Main) {
                        pushUndoSnapshot()
                        val target = insertTargetIndex ?: blocks.size
                        val updated = blocks.toMutableList().apply {
                            add(target.coerceIn(0, size), imageBlock)
                        }
                        blocks = updated
                        scheduleSave(newBlocks = updated)
                        showInsertSheet = false
                    }
                } catch (e: Exception) {
                    Log.e("NoteEditorScreen", "Fehler beim Hinzufügen des Bildes", e)
                }
            }
        }
    }

    val activeBlock = blocks.firstOrNull { it.id == activeBlockId }

    // Statistiken für das Mehr-Menü
    val fullMarkdownText = remember(blocks) {
        blocks.joinToString("\n") { getBlockText(it.kind) }
    }
    val wordCount = remember(fullMarkdownText) {
        val trimmed = fullMarkdownText.trim()
        if (trimmed.isEmpty()) 0 else trimmed.split(Regex("\\s+")).size
    }
    val charCount = fullMarkdownText.length
    val currentWorkspaceName = remember(workspaces, pageDetail) {
        val wsId = pageDetail?.summary?.workspaceId
        workspaces.firstOrNull { it.id == wsId }?.name?.ifBlank { "Workspace" } ?: "Workspace"
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = BgDeep,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            // PWA `.page-chrome` Kopfbereich
            Surface(
                color = BgDeep.copy(alpha = 0.95f),
                border = BorderStroke(0.5.dp, EdgeSoft),
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Links: Zurück-Button (auf Handy Hochkant) + Klickbarer Breadcrumb-Pfad
                    if (!isTabletUi) {
                        IconButton(
                            onClick = onNavigateBack,
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                                contentDescription = "Zurück",
                                tint = TextPrimary,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }

                    Row(
                        modifier = Modifier
                            .weight(1f)
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = currentWorkspaceName,
                            color = TextMuted,
                            fontSize = 12.sp,
                            maxLines = 1
                        )
                        Icon(
                            imageVector = Icons.AutoMirrored.Rounded.NavigateNext,
                            contentDescription = null,
                            tint = TextMuted,
                            modifier = Modifier.size(14.dp)
                        )

                        ancestors.forEach { anc ->
                            Text(
                                text = anc.title.ifEmpty { "Ohne Titel" },
                                color = TextSecondary,
                                fontSize = 12.sp,
                                maxLines = 1,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .clickable { onOpenPage(anc.id) }
                                    .padding(horizontal = 4.dp, vertical = 2.dp)
                            )
                            Icon(
                                imageVector = Icons.AutoMirrored.Rounded.NavigateNext,
                                contentDescription = null,
                                tint = TextMuted,
                                modifier = Modifier.size(14.dp)
                            )
                        }

                        if (pageIcon.isNotEmpty()) {
                            Text(
                                text = "$pageIcon ",
                                fontSize = 12.sp
                            )
                        }
                        Text(
                            text = pageTitle.ifEmpty { "Ohne Titel" },
                            color = TextPrimary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    // Rechts (`.page-actions`): Teilen, Favorit, KI-Coach, +, Mehr-Menü
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        // Teilen-Menü
                        Box {
                            IconButton(
                                onClick = { showShareMenu = true },
                                modifier = Modifier.size(34.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Share,
                                    contentDescription = "Teilen",
                                    tint = TextSecondary,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                            DropdownMenu(
                                expanded = showShareMenu,
                                onDismissRequest = { showShareMenu = false },
                                modifier = Modifier
                                    .background(BgPanel)
                                    .border(1.dp, Edge, RoundedCornerShape(12.dp))
                            ) {
                                DropdownMenuItem(
                                    text = { Text("Als Markdown-Text teilen", color = TextPrimary) },
                                    leadingIcon = { Icon(Icons.Rounded.Share, null, tint = Accent) },
                                    onClick = {
                                        showShareMenu = false
                                        val md = "# $pageTitle\n\n${blocksToMarkdown(blocks)}"
                                        val sendIntent = Intent(Intent.ACTION_SEND).apply {
                                            type = "text/markdown"
                                            putExtra(Intent.EXTRA_SUBJECT, pageTitle)
                                            putExtra(Intent.EXTRA_TEXT, md)
                                        }
                                        context.startActivity(Intent.createChooser(sendIntent, "Notiz teilen"))
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("Markdown in Zwischenablage", color = TextPrimary) },
                                    leadingIcon = { Icon(Icons.Rounded.ContentCopy, null, tint = TextSecondary) },
                                    onClick = {
                                        showShareMenu = false
                                        val md = "# $pageTitle\n\n${blocksToMarkdown(blocks)}"
                                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                        clipboard?.setPrimaryClip(ClipData.newPlainText(pageTitle, md))
                                        coroutineScope.launch {
                                            snackbarHostState.showSnackbar("Markdown in Zwischenablage kopiert")
                                        }
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("Wiki-Link [[Titel]] kopieren", color = TextPrimary) },
                                    leadingIcon = { Icon(Icons.AutoMirrored.Rounded.Note, null, tint = TextSecondary) },
                                    onClick = {
                                        showShareMenu = false
                                        val link = "[[${pageTitle.ifEmpty { pageId }}]]"
                                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                        clipboard?.setPrimaryClip(ClipData.newPlainText("Wiki-Link", link))
                                        coroutineScope.launch {
                                            snackbarHostState.showSnackbar("Link $link kopiert")
                                        }
                                    }
                                )
                            }
                        }

                        // ★ / ☆ Favoriten-Stern
                        IconButton(
                            onClick = onToggleFavorite,
                            modifier = Modifier.size(34.dp)
                        ) {
                            Icon(
                                imageVector = if (isFavorite) Icons.Rounded.Star else Icons.Rounded.StarBorder,
                                contentDescription = "Favorit",
                                tint = if (isFavorite) Warn else TextSecondary,
                                modifier = Modifier.size(20.dp)
                            )
                        }

                        // ✦ KI-Coach für diese Seite öffnen
                        IconButton(
                            onClick = { onOpenAiForPage(pageId) },
                            modifier = Modifier.size(34.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.AutoAwesome,
                                contentDescription = "KI-Coach",
                                tint = Accent,
                                modifier = Modifier.size(19.dp)
                            )
                        }

                        // + Block einfügen
                        IconButton(
                            onClick = {
                                insertTargetIndex = blocks.size
                                showInsertSheet = true
                            },
                            modifier = Modifier.size(34.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Add,
                                contentDescription = "Block einfügen",
                                tint = TextSecondary,
                                modifier = Modifier.size(20.dp)
                            )
                        }

                        // ⋯ Mehr-Menü (exakt wie in der PWA)
                        Box {
                            IconButton(
                                onClick = { showMoreMenu = true },
                                modifier = Modifier.size(34.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.MoreHoriz,
                                    contentDescription = "Mehr Optionen",
                                    tint = TextPrimary,
                                    modifier = Modifier.size(20.dp)
                                )
                            }

                            DropdownMenu(
                                expanded = showMoreMenu,
                                onDismissRequest = { showMoreMenu = false },
                                modifier = Modifier
                                    .background(BgPanel)
                                    .border(1.dp, Edge, RoundedCornerShape(14.dp))
                                    .widthIn(min = 260.dp)
                            ) {
                                // ↶ Rückgängig / ↷ Wiederholen
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 8.dp, vertical = 4.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = BgSidebar,
                                        border = BorderStroke(1.dp, EdgeSoft),
                                        modifier = Modifier
                                            .weight(1f)
                                            .clip(RoundedCornerShape(8.dp))
                                            .clickable(enabled = undoStack.isNotEmpty()) {
                                                val prev = undoStack.removeLastOrNull()
                                                if (prev != null) {
                                                    redoStack.add(EditorSnapshot(pageTitle, blocks))
                                                    pageTitle = prev.title
                                                    blocks = prev.blocks
                                                    scheduleSave(prev.title, prev.blocks)
                                                }
                                                showMoreMenu = false
                                            }
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(vertical = 8.dp),
                                            horizontalArrangement = Arrangement.Center,
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Icon(
                                                Icons.AutoMirrored.Rounded.Undo,
                                                contentDescription = null,
                                                tint = if (undoStack.isNotEmpty()) TextPrimary else TextMuted,
                                                modifier = Modifier.size(16.dp)
                                            )
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text(
                                                "Rückgängig",
                                                color = if (undoStack.isNotEmpty()) TextPrimary else TextMuted,
                                                fontSize = 12.sp
                                            )
                                        }
                                    }

                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = BgSidebar,
                                        border = BorderStroke(1.dp, EdgeSoft),
                                        modifier = Modifier
                                            .weight(1f)
                                            .clip(RoundedCornerShape(8.dp))
                                            .clickable(enabled = redoStack.isNotEmpty()) {
                                                val next = redoStack.removeLastOrNull()
                                                if (next != null) {
                                                    undoStack.add(EditorSnapshot(pageTitle, blocks))
                                                    pageTitle = next.title
                                                    blocks = next.blocks
                                                    scheduleSave(next.title, next.blocks)
                                                }
                                                showMoreMenu = false
                                            }
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(vertical = 8.dp),
                                            horizontalArrangement = Arrangement.Center,
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Icon(
                                                Icons.AutoMirrored.Rounded.Redo,
                                                contentDescription = null,
                                                tint = if (redoStack.isNotEmpty()) TextPrimary else TextMuted,
                                                modifier = Modifier.size(16.dp)
                                            )
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text(
                                                "Wiederholen",
                                                color = if (redoStack.isNotEmpty()) TextPrimary else TextMuted,
                                                fontSize = 12.sp
                                            )
                                        }
                                    }
                                }

                                HorizontalDivider(color = EdgeSoft, modifier = Modifier.padding(vertical = 4.dp))

                                DropdownMenuItem(
                                    text = { Text("🎨 Icon ändern", color = TextPrimary, fontSize = 14.sp) },
                                    onClick = {
                                        showMoreMenu = false
                                        showIconDialog = true
                                    }
                                )

                                DropdownMenuItem(
                                    text = { Text("🖼️ Cover ändern", color = TextPrimary, fontSize = 14.sp) },
                                    onClick = {
                                        showMoreMenu = false
                                        showCoverDialog = true
                                    }
                                )

                                DropdownMenuItem(
                                    text = { Text("🃏 Karten aus Seite / Lückentexten", color = TextPrimary, fontSize = 14.sp) },
                                    onClick = {
                                        showMoreMenu = false
                                        coroutineScope.launch(Dispatchers.IO) {
                                            try {
                                                persistNow(pageTitle, blocks)
                                                val count = core.cardsFromHighlights(pageId, null)
                                                snackbarHostState.showSnackbar(
                                                    if (count > 0u) "$count Karteikarten aus Seite erstellt"
                                                    else "Keine neuen Markierungen (==...==) oder Lücken ({{c1::...}}) gefunden"
                                                )
                                            } catch (e: Exception) {
                                                Log.e("NoteEditorScreen", "Karten erstellen fehlgeschlagen", e)
                                            }
                                        }
                                    }
                                )

                                DropdownMenuItem(
                                    text = { Text("📋 Seite duplizieren", color = TextPrimary, fontSize = 14.sp) },
                                    onClick = {
                                        showMoreMenu = false
                                        coroutineScope.launch(Dispatchers.IO) {
                                            try {
                                                val md = blocksToMarkdown(blocks)
                                                val copyId = core.createPage(
                                                    "${pageTitle.ifEmpty { "Notiz" }} (Kopie)",
                                                    md,
                                                    pageDetail?.summary?.parentId,
                                                    pageDetail?.summary?.workspaceId
                                                )
                                                onMutation()
                                                withContext(Dispatchers.Main) {
                                                    onOpenPage(copyId)
                                                }
                                            } catch (e: Exception) {
                                                Log.e("NoteEditorScreen", "Duplizieren fehlgeschlagen", e)
                                            }
                                        }
                                    }
                                )

                                DropdownMenuItem(
                                    text = { Text("📁 Verschieben nach…", color = TextPrimary, fontSize = 14.sp) },
                                    onClick = {
                                        showMoreMenu = false
                                        showMoveDialog = true
                                    }
                                )

                                DropdownMenuItem(
                                    text = { Text("🕓 Versionsverlauf", color = TextPrimary, fontSize = 14.sp) },
                                    onClick = {
                                        showMoreMenu = false
                                        showHistoryDialog = true
                                    }
                                )

                                DropdownMenuItem(
                                    text = { Text("📦 Archivieren", color = TextPrimary, fontSize = 14.sp) },
                                    onClick = {
                                        showMoreMenu = false
                                        coroutineScope.launch(Dispatchers.IO) {
                                            try {
                                                core.archivePage(pageId)
                                                onMutation()
                                                withContext(Dispatchers.Main) {
                                                    snackbarHostState.showSnackbar("Seite archiviert")
                                                }
                                            } catch (e: Exception) {
                                                Log.e("NoteEditorScreen", "Archivieren fehlgeschlagen", e)
                                            }
                                        }
                                    }
                                )

                                HorizontalDivider(color = EdgeSoft, modifier = Modifier.padding(vertical = 4.dp))

                                DropdownMenuItem(
                                    text = { Text("🗑️ In Papierkorb verschieben", color = Danger, fontSize = 14.sp) },
                                    onClick = {
                                        showMoreMenu = false
                                        coroutineScope.launch(Dispatchers.IO) {
                                            try {
                                                core.trashPage(pageId)
                                                onMutation()
                                                withContext(Dispatchers.Main) {
                                                    onNavigateBack()
                                                }
                                            } catch (e: Exception) {
                                                Log.e("NoteEditorScreen", "Papierkorb fehlgeschlagen", e)
                                            }
                                        }
                                    }
                                )

                                HorizontalDivider(color = EdgeSoft, modifier = Modifier.padding(vertical = 4.dp))

                                // Info-Fußzeile im Menü
                                Column(
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp)
                                ) {
                                    Text(
                                        text = "$wordCount Wörter · $charCount Zeichen · ${blocks.size} Blöcke",
                                        color = TextMuted,
                                        fontSize = 11.sp
                                    )
                                    val updatedStr = pageDetail?.summary?.updated?.take(16)?.replace('T', ' ') ?: "Gerade eben"
                                    Text(
                                        text = "Zuletzt bearbeitet: $updatedStr",
                                        color = TextMuted,
                                        fontSize = 11.sp
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 140.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                // 1. Optionales Page Cover Banner
                if (pageCover.isNotEmpty()) {
                    item(key = "page_cover_banner") {
                        PageCoverBanner(
                            coverId = pageCover,
                            onChangeCover = { showCoverDialog = true }
                        )
                    }
                }

                // 2. Seiten-Header (Icon + Hover-Buttons + Großer Titel + Rückverweise-Chip)
                item(key = "page_header_section") {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 12.dp)
                    ) {
                        // Dezenz-Buttons für + Icon / + Cover
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.padding(bottom = 8.dp)
                        ) {
                            if (pageIcon.isNotEmpty()) {
                                Surface(
                                    shape = RoundedCornerShape(14.dp),
                                    color = SurfaceSubtle,
                                    border = BorderStroke(1.dp, EdgeSoft),
                                    modifier = Modifier.clickable { showIconDialog = true }
                                ) {
                                    Text(
                                        text = pageIcon,
                                        fontSize = 36.sp,
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                                    )
                                }
                            } else {
                                Surface(
                                    shape = ImpalaPillShape,
                                    color = SurfaceSubtle,
                                    modifier = Modifier
                                        .clip(ImpalaPillShape)
                                        .clickable { showIconDialog = true }
                                ) {
                                    Row(
                                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(Icons.Rounded.EmojiEmotions, null, tint = TextMuted, modifier = Modifier.size(14.dp))
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text("+ Icon", color = TextMuted, fontSize = 12.sp)
                                    }
                                }
                            }

                            if (pageCover.isEmpty()) {
                                Surface(
                                    shape = ImpalaPillShape,
                                    color = SurfaceSubtle,
                                    modifier = Modifier
                                        .clip(ImpalaPillShape)
                                        .clickable { showCoverDialog = true }
                                ) {
                                    Row(
                                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(Icons.Rounded.Wallpaper, null, tint = TextMuted, modifier = Modifier.size(14.dp))
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text("+ Cover", color = TextMuted, fontSize = 12.sp)
                                    }
                                }
                            }
                        }

                        // Großer, mehrzeiliger Seitentitel
                        BasicTextField(
                            value = pageTitle,
                            onValueChange = {
                                pushUndoSnapshot()
                                pageTitle = it
                                scheduleSave(newTitle = it)
                            },
                            textStyle = TextStyle(
                                color = TextPrimary,
                                fontSize = 28.sp,
                                lineHeight = 34.sp,
                                fontWeight = FontWeight.Bold
                            ),
                            cursorBrush = SolidColor(Accent),
                            modifier = Modifier.fillMaxWidth(),
                            decorationBox = { innerTextField ->
                                if (pageTitle.isEmpty()) {
                                    Text(
                                        text = "Ohne Titel",
                                        color = TextMuted,
                                        fontSize = 28.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                                innerTextField()
                            }
                        )

                        // Rückverweise-Chip (`↙ N Rückverweise`)
                        if (backlinks.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(10.dp))
                            Surface(
                                shape = ImpalaPillShape,
                                color = AccentSoft,
                                border = BorderStroke(1.dp, AccentBorder),
                                modifier = Modifier
                                    .clip(ImpalaPillShape)
                                    .clickable { backlinksExpanded = !backlinksExpanded }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = "↙ ${backlinks.size} ${if (backlinks.size == 1) "Rückverweis" else "Rückverweise"}",
                                        color = Accent,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Medium
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Icon(
                                        imageVector = if (backlinksExpanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                                        contentDescription = null,
                                        tint = Accent,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            }

                            AnimatedVisibility(
                                visible = backlinksExpanded,
                                enter = expandVertically() + fadeIn(),
                                exit = shrinkVertically() + fadeOut()
                            ) {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = 8.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    backlinks.forEach { linkPage ->
                                        PageSummaryCard(
                                            page = linkPage,
                                            onClick = { onOpenPage(linkPage.id) }
                                        )
                                    }
                                }
                            }
                        }

                        HorizontalDivider(
                            color = EdgeSoft,
                            modifier = Modifier.padding(top = 14.dp)
                        )
                    }
                }

                // 3. Leere Seite: Initialer Absatz
                if (blocks.isEmpty()) {
                    item(key = "empty_placeholder") {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 20.dp, vertical = 16.dp)
                                .clickable {
                                    val newBlock = MdBlock(
                                        id = UUID.randomUUID().toString(),
                                        kind = MdBlockKind.Paragraph(""),
                                        textColor = null,
                                        bgColor = null
                                    )
                                    blocks = listOf(newBlock)
                                    activeBlockId = newBlock.id
                                    scheduleSave(newBlocks = blocks)
                                }
                        ) {
                            Text(
                                text = "Tippe hier oder schreibe '/' für Befehle…",
                                color = TextMuted,
                                fontSize = 16.sp
                            )
                        }
                    }
                }

                // 4. Blöcke rendern
                itemsIndexed(
                    items = blocks,
                    key = { _, block -> block.id }
                ) { index, block ->
                    Box(modifier = Modifier.padding(horizontal = 16.dp)) {
                        BlockItemRenderer(
                            block = block,
                            isActive = activeBlockId == block.id,
                            canMoveUp = index > 0,
                            canMoveDown = index < blocks.size - 1,
                            core = core,
                            onNavigateToPage = onOpenPage,
                            onFocus = { activeBlockId = block.id },
                            onSelectionChanged = { activeBlockSelection = it },
                            onContentChange = { updatedKind ->
                                val updated = blocks.toMutableList().apply {
                                    set(index, block.copy(kind = updatedKind))
                                }
                                blocks = updated
                                scheduleSave(newBlocks = updated)
                            },
                            onMoveBlock = { delta ->
                                val targetIdx = (index + delta).coerceIn(0, blocks.size - 1)
                                if (targetIdx != index) {
                                    pushUndoSnapshot()
                                    val updated = blocks.toMutableList().apply {
                                        val item = removeAt(index)
                                        add(targetIdx, item)
                                    }
                                    blocks = updated
                                    scheduleSave(newBlocks = updated)
                                }
                            },
                            onDeleteBlock = {
                                pushUndoSnapshot()
                                val updated = blocks.toMutableList().apply {
                                    removeAt(index)
                                }
                                blocks = updated
                                scheduleSave(newBlocks = updated)
                            },
                            onEnter = {
                                pushUndoSnapshot()
                                val nextKind = when (val k = block.kind) {
                                    is MdBlockKind.List -> {
                                        val style = when (k.style) {
                                            is MdListStyle.Todo -> MdListStyle.Todo(checked = false)
                                            else -> k.style
                                        }
                                        MdBlockKind.List(style, k.indent, "")
                                    }
                                    else -> MdBlockKind.Paragraph("")
                                }
                                val newBlock = MdBlock(
                                    id = UUID.randomUUID().toString(),
                                    kind = nextKind,
                                    textColor = null,
                                    bgColor = null
                                )
                                val updated = blocks.toMutableList().apply {
                                    add(index + 1, newBlock)
                                }
                                blocks = updated
                                activeBlockId = newBlock.id
                                scheduleSave(newBlocks = updated)
                            },
                            onBackspaceAtStart = {
                                if (block.kind !is MdBlockKind.Paragraph) {
                                    pushUndoSnapshot()
                                    val plain = getBlockText(block.kind)
                                    val updated = blocks.toMutableList().apply {
                                        set(index, block.copy(kind = MdBlockKind.Paragraph(plain)))
                                    }
                                    blocks = updated
                                    scheduleSave(newBlocks = updated)
                                } else if (blocks.size > 1) {
                                    pushUndoSnapshot()
                                    val prevIndex = (index - 1).coerceAtLeast(0)
                                    val prevBlock = blocks[prevIndex]
                                    val currentText = getBlockText(block.kind)
                                    val prevText = getBlockText(prevBlock.kind)

                                    val updated = blocks.toMutableList().apply {
                                        removeAt(index)
                                        if (currentText.isNotEmpty()) {
                                            set(prevIndex, prevBlock.copy(kind = updateBlockText(prevBlock.kind, prevText + currentText)))
                                        }
                                    }
                                    blocks = updated
                                    activeBlockId = prevBlock.id
                                    scheduleSave(newBlocks = updated)
                                }
                            },
                            onOpenSlashMenu = {
                                insertTargetIndex = index + 1
                                showInsertSheet = true
                            }
                        )
                    }
                }

                // 5. Am Ende der Seite: Verwandte Seiten / Unterseiten + Button `+ Unterseite anlegen`
                item(key = "section_subpages_footer") {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        HorizontalDivider(color = EdgeSoft, modifier = Modifier.padding(bottom = 8.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "UNTERSEITEN (${subpages.size})",
                                color = TextMuted,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 0.8.sp
                            )

                            Surface(
                                shape = ImpalaPillShape,
                                color = AccentSoft,
                                border = BorderStroke(1.dp, AccentBorder),
                                modifier = Modifier
                                    .clip(ImpalaPillShape)
                                    .clickable {
                                        coroutineScope.launch(Dispatchers.IO) {
                                            try {
                                                val newId = core.createPage(
                                                    "Neue Unterseite",
                                                    "",
                                                    pageId,
                                                    pageDetail?.summary?.workspaceId
                                                )
                                                onMutation()
                                                withContext(Dispatchers.Main) {
                                                    onOpenPage(newId)
                                                }
                                            } catch (e: Exception) {
                                                Log.e("NoteEditorScreen", "Unterseite anlegen fehlgeschlagen", e)
                                            }
                                        }
                                    }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(Icons.Rounded.Add, null, tint = Accent, modifier = Modifier.size(14.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = "Unterseite anlegen",
                                        color = Accent,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                            }
                        }

                        subpages.forEach { sub ->
                            PageSummaryCard(
                                page = sub,
                                onClick = { onOpenPage(sub.id) }
                            )
                        }
                    }
                }
            }

            // Schwebende Formatierungsleiste über der Tastatur und Systemleiste
            ExpressiveFloatingToolbar(
                activeBlock = activeBlock,
                isSpeechListening = speechState.isListening,
                onToggleSpeech = toggleSpeech,
                onWrapSelection = { prefix, suffix ->
                    if (activeBlock != null) {
                        pushUndoSnapshot()
                        val currentText = getBlockText(activeBlock.kind)
                        val start = activeBlockSelection.start.coerceIn(0, currentText.length)
                        val end = activeBlockSelection.end.coerceIn(0, currentText.length)
                        val min = minOf(start, end)
                        val max = maxOf(start, end)

                        val newText = if (min == max) {
                            currentText.substring(0, min) + prefix + suffix + currentText.substring(min)
                        } else {
                            currentText.substring(0, min) + prefix + currentText.substring(min, max) + suffix + currentText.substring(max)
                        }

                        val updated = blocks.map { b ->
                            if (b.id == activeBlock.id) b.copy(kind = updateBlockText(b.kind, newText)) else b
                        }
                        blocks = updated
                        scheduleSave(newBlocks = updated)
                    }
                },
                onChangeBlockKind = { newKind ->
                    if (activeBlock != null) {
                        pushUndoSnapshot()
                        val updated = blocks.map { b ->
                            if (b.id == activeBlock.id) b.copy(kind = newKind) else b
                        }
                        blocks = updated
                        scheduleSave(newBlocks = updated)
                    }
                },
                onIndentChange = { delta ->
                    if (activeBlock?.kind is MdBlockKind.List) {
                        pushUndoSnapshot()
                        val listKind = activeBlock.kind as MdBlockKind.List
                        val newIndent = (listKind.indent.toInt() + delta).coerceIn(0, 8).toUInt()
                        val updated = blocks.map { b ->
                            if (b.id == activeBlock.id) b.copy(kind = listKind.copy(indent = newIndent)) else b
                        }
                        blocks = updated
                        scheduleSave(newBlocks = updated)
                    }
                },
                onColorChange = { textColor, bgColor ->
                    if (activeBlock != null) {
                        pushUndoSnapshot()
                        val updated = blocks.map { b ->
                            if (b.id == activeBlock.id) b.copy(textColor = textColor, bgColor = bgColor) else b
                        }
                        blocks = updated
                        scheduleSave(newBlocks = updated)
                    }
                },
                modifier = Modifier.align(Alignment.BottomCenter)
            )
        }
    }

    // Modal Bottom Sheet: Block einfügen (Slash-Menü)
    if (showInsertSheet) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { showInsertSheet = false },
            sheetState = sheetState,
            containerColor = BgPanel,
            dragHandle = {
                Box(
                    modifier = Modifier
                        .padding(vertical = 10.dp)
                        .size(width = 36.dp, height = 4.dp)
                        .background(Edge, RoundedCornerShape(2.dp))
                )
            }
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Text(
                    text = "Block einfügen",
                    color = TextPrimary,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(bottom = 12.dp)
                )

                InsertBlockOption(Icons.Rounded.Title, "Überschrift 1 (H1)") {
                    insertNewBlock(MdBlockKind.Heading(MdHeadingLevel.H1, ""))
                }
                InsertBlockOption(Icons.Rounded.Title, "Überschrift 2 (H2)") {
                    insertNewBlock(MdBlockKind.Heading(MdHeadingLevel.H2, ""))
                }
                InsertBlockOption(Icons.Rounded.Title, "Überschrift 3 (H3)") {
                    insertNewBlock(MdBlockKind.Heading(MdHeadingLevel.H3, ""))
                }
                InsertBlockOption(Icons.Rounded.CheckBox, "Aufgabe (Todo-Checkbox)") {
                    insertNewBlock(MdBlockKind.List(MdListStyle.Todo(checked = false), 0u, ""))
                }
                InsertBlockOption(Icons.AutoMirrored.Rounded.FormatListBulleted, "Aufzählungsliste") {
                    insertNewBlock(MdBlockKind.List(MdListStyle.Bullet, 0u, ""))
                }
                InsertBlockOption(Icons.Rounded.FormatListNumbered, "Nummerierte Liste") {
                    insertNewBlock(MdBlockKind.List(MdListStyle.Number, 0u, ""))
                }
                InsertBlockOption(Icons.Rounded.FormatQuote, "Zitatblock") {
                    insertNewBlock(MdBlockKind.Quote(""))
                }
                InsertBlockOption(Icons.Rounded.Code, "Codeblock") {
                    insertNewBlock(MdBlockKind.Code("kotlin", ""))
                }
                InsertBlockOption(Icons.Rounded.Info, "Callout-Hinweisbox") {
                    val child = MdBlock(UUID.randomUUID().toString(), MdBlockKind.Paragraph(""), null, null)
                    insertNewBlock(MdBlockKind.Callout("blue", listOf(child)))
                }
                InsertBlockOption(Icons.Rounded.HorizontalRule, "Trennlinie") {
                    insertNewBlock(MdBlockKind.Divider)
                }
                InsertBlockOption(Icons.Rounded.TableChart, "Tabelle (2x2)") {
                    insertNewBlock(MdBlockKind.Table(listOf(listOf("Kopf 1", "Kopf 2"), listOf("Zelle 1", "Zelle 2"))))
                }
                InsertBlockOption(Icons.Rounded.Image, "Bild aus Galerie einfügen") {
                    imagePickerLauncher.launch("image/*")
                }
                InsertBlockOption(Icons.Rounded.School, "Lückentext-Karten synchronisieren") {
                    showInsertSheet = false
                    coroutineScope.launch(Dispatchers.IO) {
                        val count = core.cardsFromHighlights(pageId, null)
                        snackbarHostState.showSnackbar(
                            if (count > 0u) "$count Karteikarten synchronisiert"
                            else "Keine neuen Lücken (==...==) gefunden"
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }

    // Dialog: Emoji-Icon wählen
    if (showIconDialog) {
        Dialog(onDismissRequest = { showIconDialog = false }) {
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = BgPanel,
                border = BorderStroke(1.dp, Edge),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Seiten-Icon wählen", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                        if (pageIcon.isNotEmpty()) {
                            TextButton(onClick = {
                                updateIcon("")
                                showIconDialog = false
                            }) {
                                Text("Entfernen", color = Danger, fontSize = 13.sp)
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        PAGE_EMOJIS.forEach { emoji ->
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = if (pageIcon == emoji) AccentSoft else BgSidebar,
                                border = BorderStroke(1.dp, if (pageIcon == emoji) Accent else EdgeSoft),
                                modifier = Modifier
                                    .size(44.dp)
                                    .clickable {
                                        updateIcon(emoji)
                                        showIconDialog = false
                                    }
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(text = emoji, fontSize = 22.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Dialog: Seiten-Cover wählen
    if (showCoverDialog) {
        Dialog(onDismissRequest = { showCoverDialog = false }) {
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = BgPanel,
                border = BorderStroke(1.dp, Edge),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Text("Seiten-Cover ändern", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.height(12.dp))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        PAGE_COVERS.forEach { option ->
                            val isSelected = pageCover == option.id
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = if (isSelected) AccentSoft else BgSidebar,
                                border = BorderStroke(1.dp, if (isSelected) Accent else EdgeSoft),
                                modifier = Modifier.clickable {
                                    updateCover(option.id)
                                    showCoverDialog = false
                                }
                            ) {
                                Text(
                                    text = option.label,
                                    color = if (isSelected) Accent else TextPrimary,
                                    fontSize = 13.sp,
                                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // Dialog: Seite verschieben nach Workspace / Elternseite
    if (showMoveDialog) {
        var allPages by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
        LaunchedEffect(Unit) {
            withContext(Dispatchers.IO) {
                allPages = core.recentPages(40u).filter { it.id != pageId }
            }
        }

        Dialog(onDismissRequest = { showMoveDialog = false }) {
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = BgPanel,
                border = BorderStroke(1.dp, Edge),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Text("Seite verschieben nach…", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.height(12.dp))

                    if (workspaces.isNotEmpty()) {
                        Text("Workspaces (als Hauptseite)", color = TextMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        Spacer(modifier = Modifier.height(6.dp))
                        workspaces.forEach { ws ->
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = BgSidebar,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 3.dp)
                                    .clickable {
                                        showMoveDialog = false
                                        coroutineScope.launch(Dispatchers.IO) {
                                            try {
                                                core.movePageToWorkspace(pageId, ws.id)
                                                onMutation()
                                                reloadPage()
                                            } catch (_: Exception) {}
                                        }
                                    }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(Icons.Rounded.DriveFileMove, null, tint = Accent, modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(ws.name.ifBlank { "Standard-Workspace" }, color = TextPrimary, fontSize = 14.sp)
                                }
                            }
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                    }

                    Text("Untergeordnet unter Seite", color = TextMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.height(6.dp))
                    LazyColumn(modifier = Modifier.heightIn(max = 220.dp)) {
                        itemsIndexed(allPages) { _, targetPage ->
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = BgSidebar,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 3.dp)
                                    .clickable {
                                        showMoveDialog = false
                                        coroutineScope.launch(Dispatchers.IO) {
                                            try {
                                                core.movePage(pageId, targetPage.id, null)
                                                onMutation()
                                                reloadPage()
                                            } catch (_: Exception) {}
                                        }
                                    }
                            ) {
                                Text(
                                    text = targetPage.title.ifEmpty { "Ohne Titel" },
                                    color = TextPrimary,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // Dialog: Versionsverlauf
    if (showHistoryDialog) {
        PageHistoryDialog(
            pageId = pageId,
            core = core,
            onDismiss = { showHistoryDialog = false },
            onRestoreVersion = { version ->
                pushUndoSnapshot()
                pageTitle = version.title
                blocks = markdownToBlocks(version.content)
                persistNow(version.title, blocks)
                showHistoryDialog = false
                coroutineScope.launch {
                    snackbarHostState.showSnackbar("Version wiederhergestellt")
                }
            }
        )
    }
}

/**
 * Zeichnet das optionale Seiten-Cover-Banner (Farbverläufe & Muster wie in der PWA).
 */
@Composable
private fun PageCoverBanner(
    coverId: String,
    onChangeCover: () -> Unit
) {
    val gradientColors = when (coverId) {
        "sunset" -> listOf(Color(0xFFF97316), Color(0xFFEC4899), Color(0xFF8B5CF6))
        "ocean" -> listOf(Color(0xFF0EA5E9), Color(0xFF2563EB), Color(0xFF1E3A8A))
        "forest" -> listOf(Color(0xFF10B981), Color(0xFF059669), Color(0xFF064E3B))
        "grape" -> listOf(Color(0xFFA855F7), Color(0xFF6366F1), Color(0xFF312E81))
        "aurora" -> listOf(Color(0xFF2DD4BF), Color(0xFF3B82F6), Color(0xFF9333EA))
        "mono" -> listOf(Color(0xFF374151), Color(0xFF1F2937), Color(0xFF111827))
        else -> listOf(BgSidebar, BgPanel)
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(128.dp)
            .background(Brush.linearGradient(gradientColors))
            .clickable { onChangeCover() }
    ) {
        if (coverId == "karo" || coverId == "linien" || coverId == "punkte") {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val step = 24.dp.toPx()
                val lineColor = Color.White.copy(alpha = 0.12f)
                when (coverId) {
                    "karo" -> {
                        var x = 0f
                        while (x < size.width) {
                            drawLine(lineColor, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1f)
                            x += step
                        }
                        var y = 0f
                        while (y < size.height) {
                            drawLine(lineColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
                            y += step
                        }
                    }
                    "linien" -> {
                        var y = step
                        while (y < size.height) {
                            drawLine(lineColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 1.2f)
                            y += step
                        }
                    }
                    "punkte" -> {
                        var x = step / 2
                        while (x < size.width) {
                            var y = step / 2
                            while (y < size.height) {
                                drawCircle(lineColor, radius = 2f, center = Offset(x, y))
                                y += step
                            }
                            x += step
                        }
                    }
                }
            }
        }

        Surface(
            shape = ImpalaPillShape,
            color = BgDeep.copy(alpha = 0.65f),
            border = BorderStroke(1.dp, EdgeSoft),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(10.dp)
        ) {
            Text(
                text = "Cover ändern",
                color = TextSecondary,
                fontSize = 11.sp,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
            )
        }
    }
}

private fun updateBlockText(kind: MdBlockKind, newText: String): MdBlockKind {
    return when (kind) {
        is MdBlockKind.Paragraph -> kind.copy(text = newText)
        is MdBlockKind.Heading -> kind.copy(text = newText)
        is MdBlockKind.List -> kind.copy(text = newText)
        is MdBlockKind.Quote -> kind.copy(text = newText)
        is MdBlockKind.Code -> kind.copy(text = newText)
        is MdBlockKind.Math -> kind.copy(text = newText)
        is MdBlockKind.Other -> kind.copy(text = newText)
        is MdBlockKind.Toggle -> kind.copy(summary = newText)
        else -> kind
    }
}

/**
 * Rendert einen einzelnen Block typgerecht und editierbar.
 */
@Composable
private fun BlockItemRenderer(
    block: MdBlock,
    isActive: Boolean,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    core: ImpalaCore,
    onNavigateToPage: (String) -> Unit,
    onFocus: () -> Unit,
    onSelectionChanged: (TextRange) -> Unit,
    onContentChange: (MdBlockKind) -> Unit,
    onMoveBlock: (Int) -> Unit,
    onDeleteBlock: () -> Unit,
    onEnter: () -> Unit,
    onBackspaceAtStart: () -> Unit,
    onOpenSlashMenu: () -> Unit
) {
    val bgModifier = when (block.bgColor) {
        "blue" -> Modifier.background(Color(0x206B8CAE), RoundedCornerShape(8.dp))
        "green" -> Modifier.background(Color(0x2072BC8F), RoundedCornerShape(8.dp))
        "yellow" -> Modifier.background(Color(0x20E8C65A), RoundedCornerShape(8.dp))
        "red" -> Modifier.background(Color(0x20E97366), RoundedCornerShape(8.dp))
        else -> Modifier
    }

    val textCustomColor = when (block.textColor) {
        "blue" -> Accent
        "green" -> Color(0xFF72BC8F)
        "yellow" -> Color(0xFFE8C65A)
        "red" -> Danger
        else -> TextPrimary
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .then(bgModifier)
            .padding(horizontal = 4.dp, vertical = 2.dp)
    ) {
        when (val kind = block.kind) {
            is MdBlockKind.Paragraph -> {
                EditableTextField(
                    text = kind.text,
                    style = TextStyle(color = textCustomColor, fontSize = 16.sp, lineHeight = 24.sp),
                    placeholder = "Absatz schreiben oder '/' für Befehle…",
                    onValueChange = { newText ->
                        if (newText == "/") {
                            onOpenSlashMenu()
                        } else {
                            onContentChange(kind.copy(text = newText))
                        }
                    },
                    onFocus = onFocus,
                    onSelectionChanged = onSelectionChanged,
                    onEnter = onEnter,
                    onBackspaceAtStart = onBackspaceAtStart
                )
            }

            is MdBlockKind.Heading -> {
                val (size, weight) = when (kind.level) {
                    MdHeadingLevel.H1 -> 24.sp to FontWeight.Bold
                    MdHeadingLevel.H2 -> 20.sp to FontWeight.SemiBold
                    MdHeadingLevel.H3 -> 17.sp to FontWeight.Medium
                }
                EditableTextField(
                    text = kind.text,
                    style = TextStyle(color = textCustomColor, fontSize = size, fontWeight = weight),
                    placeholder = "Überschrift...",
                    onValueChange = { onContentChange(kind.copy(text = it)) },
                    onFocus = onFocus,
                    onSelectionChanged = onSelectionChanged,
                    onEnter = onEnter,
                    onBackspaceAtStart = onBackspaceAtStart
                )
            }

            is MdBlockKind.List -> {
                val indentPadding = (kind.indent.toInt() * 16).dp
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = indentPadding),
                    verticalAlignment = Alignment.Top
                ) {
                    when (val style = kind.style) {
                        is MdListStyle.Bullet -> {
                            Text(
                                text = "•",
                                color = Accent,
                                fontSize = 18.sp,
                                modifier = Modifier.padding(end = 8.dp, top = 2.dp)
                            )
                        }
                        is MdListStyle.Number -> {
                            Text(
                                text = "1.",
                                color = Accent,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(end = 8.dp, top = 2.dp)
                            )
                        }
                        is MdListStyle.Todo -> {
                            Icon(
                                imageVector = if (style.checked) Icons.Rounded.CheckBox else Icons.Rounded.CheckBoxOutlineBlank,
                                contentDescription = "Todo Checkbox",
                                tint = if (style.checked) Success else TextSecondary,
                                modifier = Modifier
                                    .size(22.dp)
                                    .padding(end = 4.dp, top = 2.dp)
                                    .clickable {
                                        onContentChange(kind.copy(style = MdListStyle.Todo(checked = !style.checked)))
                                    }
                            )
                        }
                    }

                    val isChecked = (kind.style as? MdListStyle.Todo)?.checked == true
                    EditableTextField(
                        text = kind.text,
                        style = TextStyle(
                            color = if (isChecked) TextMuted else textCustomColor,
                            fontSize = 15.sp,
                            textDecoration = if (isChecked) TextDecoration.LineThrough else TextDecoration.None
                        ),
                        placeholder = "Listeneintrag…",
                        onValueChange = { onContentChange(kind.copy(text = it)) },
                        onFocus = onFocus,
                        onSelectionChanged = onSelectionChanged,
                        onEnter = onEnter,
                        onBackspaceAtStart = onBackspaceAtStart,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            is MdBlockKind.Quote -> {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(SurfaceSubtle, RoundedCornerShape(4.dp))
                        .padding(vertical = 4.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .width(4.dp)
                            .heightIn(min = 28.dp)
                            .background(Accent, RoundedCornerShape(2.dp))
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    EditableTextField(
                        text = kind.text,
                        style = TextStyle(color = TextSecondary, fontSize = 15.sp, fontStyle = FontStyle.Italic),
                        placeholder = "Zitat…",
                        onValueChange = { onContentChange(kind.copy(text = it)) },
                        onFocus = onFocus,
                        onSelectionChanged = onSelectionChanged,
                        onEnter = onEnter,
                        onBackspaceAtStart = onBackspaceAtStart,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            is MdBlockKind.Divider -> {
                HorizontalDivider(
                    color = Edge,
                    thickness = 1.dp,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onFocus() }
                        .padding(vertical = 12.dp)
                )
            }

            is MdBlockKind.Code -> {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = BgSidebar,
                    border = BorderStroke(1.dp, Edge),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(10.dp)) {
                        Text(
                            text = kind.language.ifEmpty { "code" },
                            color = Accent,
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        EditableTextField(
                            text = kind.text,
                            style = TextStyle(
                                color = TextPrimary,
                                fontSize = 14.sp,
                                fontFamily = FontFamily.Monospace
                            ),
                            placeholder = "Code hier eingeben…",
                            onValueChange = { onContentChange(kind.copy(text = it)) },
                            onFocus = onFocus,
                            onSelectionChanged = onSelectionChanged,
                            onEnter = onEnter,
                            onBackspaceAtStart = onBackspaceAtStart
                        )
                    }
                }
            }

            is MdBlockKind.Math -> {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = BgSidebar,
                    border = BorderStroke(1.dp, AccentBorder),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(10.dp)) {
                        Text(
                            text = "LaTeX / TeX Formel",
                            color = Accent,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        EditableTextField(
                            text = kind.text,
                            style = TextStyle(
                                color = TextPrimary,
                                fontSize = 15.sp,
                                fontFamily = FontFamily.Monospace
                            ),
                            placeholder = "z.B. E = mc^2 oder \\int f(x) dx",
                            onValueChange = { onContentChange(kind.copy(text = it)) },
                            onFocus = onFocus,
                            onSelectionChanged = onSelectionChanged,
                            onEnter = onEnter,
                            onBackspaceAtStart = onBackspaceAtStart
                        )
                    }
                }
            }

            is MdBlockKind.Callout -> {
                val calloutBorder = when (kind.color) {
                    "red" -> Danger
                    "green" -> Success
                    "yellow" -> Warn
                    else -> Accent
                }
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = BgSidebar,
                    border = BorderStroke(1.dp, calloutBorder.copy(alpha = 0.5f)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(modifier = Modifier.padding(12.dp)) {
                        Icon(
                            imageVector = Icons.Rounded.Info,
                            contentDescription = null,
                            tint = calloutBorder,
                            modifier = Modifier
                                .size(22.dp)
                                .padding(top = 2.dp)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            kind.children.forEach { child ->
                                val childText = getBlockText(child.kind)
                                EditableTextField(
                                    text = childText,
                                    style = TextStyle(color = TextPrimary, fontSize = 15.sp),
                                    placeholder = "Wichtiger Hinweis…",
                                    onValueChange = { newT ->
                                        val updatedChild = child.copy(kind = updateBlockText(child.kind, newT))
                                        onContentChange(kind.copy(children = listOf(updatedChild)))
                                    },
                                    onFocus = onFocus,
                                    onSelectionChanged = onSelectionChanged,
                                    onEnter = onEnter,
                                    onBackspaceAtStart = onBackspaceAtStart
                                )
                            }
                        }
                    }
                }
            }

            is MdBlockKind.Toggle -> {
                var isOpen by remember { mutableStateOf(kind.open) }
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = BgSidebar,
                    border = BorderStroke(1.dp, Edge),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(10.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    isOpen = !isOpen
                                    onContentChange(kind.copy(open = isOpen))
                                }
                        ) {
                            Icon(
                                imageVector = if (isOpen) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                                contentDescription = null,
                                tint = Accent,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            EditableTextField(
                                text = kind.summary,
                                style = TextStyle(color = TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
                                placeholder = "Zusammenfassung / Titel des Toggles…",
                                onValueChange = { onContentChange(kind.copy(summary = it)) },
                                onFocus = onFocus,
                                onSelectionChanged = onSelectionChanged,
                                onEnter = onEnter,
                                onBackspaceAtStart = onBackspaceAtStart,
                                modifier = Modifier.weight(1f)
                            )
                        }

                        AnimatedVisibility(
                            visible = isOpen,
                            enter = expandVertically() + fadeIn(),
                            exit = shrinkVertically() + fadeOut()
                        ) {
                            Column(modifier = Modifier.padding(start = 26.dp, top = 8.dp)) {
                                kind.children.forEach { child ->
                                    val childText = getBlockText(child.kind)
                                    EditableTextField(
                                        text = childText,
                                        style = TextStyle(color = TextSecondary, fontSize = 14.sp),
                                        placeholder = "Versteckter Inhalt…",
                                        onValueChange = { newT ->
                                            val updatedChild = child.copy(kind = updateBlockText(child.kind, newT))
                                            onContentChange(kind.copy(children = listOf(updatedChild)))
                                        },
                                        onFocus = onFocus,
                                        onSelectionChanged = onSelectionChanged,
                                        onEnter = onEnter,
                                        onBackspaceAtStart = onBackspaceAtStart
                                    )
                                }
                            }
                        }
                    }
                }
            }

            is MdBlockKind.Table -> {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = BgSidebar,
                    border = BorderStroke(1.dp, Edge),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier
                            .horizontalScroll(rememberScrollState())
                            .padding(8.dp)
                    ) {
                        kind.rows.forEachIndexed { rIdx, row ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                row.forEachIndexed { cIdx, cell ->
                                    Box(
                                        modifier = Modifier
                                            .widthIn(min = 90.dp)
                                            .border(1.dp, Edge)
                                            .background(if (rIdx == 0) SurfaceActive else Color.Transparent)
                                            .padding(6.dp)
                                    ) {
                                        BasicTextField(
                                            value = cell,
                                            onValueChange = { newCell ->
                                                val mutableRows = kind.rows.map { it.toMutableList() }.toMutableList()
                                                mutableRows[rIdx][cIdx] = newCell
                                                onContentChange(kind.copy(rows = mutableRows))
                                            },
                                            textStyle = TextStyle(
                                                color = TextPrimary,
                                                fontSize = 14.sp,
                                                fontWeight = if (rIdx == 0) FontWeight.Bold else FontWeight.Normal
                                            ),
                                            cursorBrush = SolidColor(Accent)
                                        )
                                    }
                                }
                            }
                        }
                        Row(modifier = Modifier.padding(top = 6.dp)) {
                            Text(
                                text = "+ Zeile",
                                color = Accent,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clickable {
                                        val colCount = kind.rows.firstOrNull()?.size ?: 2
                                        val newRow = List(colCount) { "" }
                                        onContentChange(kind.copy(rows = kind.rows + listOf(newRow)))
                                    }
                                    .padding(4.dp)
                            )
                            Spacer(modifier = Modifier.width(16.dp))
                            Text(
                                text = "+ Spalte",
                                color = Accent,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clickable {
                                        val updatedRows = kind.rows.map { it + "" }
                                        onContentChange(kind.copy(rows = updatedRows))
                                    }
                                    .padding(4.dp)
                            )
                        }
                    }
                }
            }

            is MdBlockKind.Image -> {
                var bitmapBytes by remember(kind.src) { mutableStateOf<ByteArray?>(null) }
                LaunchedEffect(kind.src) {
                    withContext(Dispatchers.IO) {
                        try {
                            val fileData = core.file(kind.src)
                            bitmapBytes = fileData?.bytes
                        } catch (e: Exception) {
                            Log.e("NoteEditorScreen", "Bild laden fehlgeschlagen: ${kind.src}", e)
                        }
                    }
                }

                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = BgSidebar,
                    border = BorderStroke(1.dp, Edge),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier.padding(8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        val bytes = bitmapBytes
                        if (bytes != null) {
                            val bitmap = remember(bytes) {
                                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                            }
                            if (bitmap != null) {
                                Image(
                                    bitmap = bitmap.asImageBitmap(),
                                    contentDescription = kind.alt,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .heightIn(max = 300.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                )
                            }
                        } else {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(140.dp)
                                    .background(SurfaceSubtle, RoundedCornerShape(8.dp)),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = "Bild (${kind.alt})",
                                    color = TextMuted,
                                    fontSize = 13.sp
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = kind.alt.ifEmpty { "Bild" },
                            color = TextSecondary,
                            fontSize = 12.sp,
                            fontStyle = FontStyle.Italic
                        )
                    }
                }
            }

            is MdBlockKind.Heft -> {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = BgSidebar,
                    border = BorderStroke(1.dp, AccentBorder),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onNavigateToPage(kind.heftId) }
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Rounded.MenuBook,
                            contentDescription = "Heft",
                            tint = Accent,
                            modifier = Modifier.size(28.dp)
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = "Eingebettetes Heft",
                                color = TextPrimary,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = "Tippen zum Öffnen der Stift-Zeichenfläche",
                                color = TextMuted,
                                fontSize = 12.sp
                            )
                        }
                    }
                }
            }

            is MdBlockKind.File -> {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = BgSidebar,
                    border = BorderStroke(1.dp, Edge),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.AttachFile,
                            contentDescription = null,
                            tint = Accent,
                            modifier = Modifier.size(24.dp)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = kind.name.ifEmpty { kind.src },
                            color = TextPrimary,
                            fontSize = 14.sp
                        )
                    }
                }
            }

            is MdBlockKind.Columns -> {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    kind.columns.forEach { colBlocks ->
                        Column(modifier = Modifier.weight(1f)) {
                            colBlocks.forEach { child ->
                                Text(
                                    text = getBlockText(child.kind),
                                    color = TextPrimary,
                                    fontSize = 14.sp
                                )
                            }
                        }
                    }
                }
            }

            is MdBlockKind.Other -> {
                EditableTextField(
                    text = kind.text,
                    style = TextStyle(color = TextSecondary, fontSize = 14.sp),
                    placeholder = "Inhalt...",
                    onValueChange = { onContentChange(kind.copy(text = it)) },
                    onFocus = onFocus,
                    onSelectionChanged = onSelectionChanged,
                    onEnter = onEnter,
                    onBackspaceAtStart = onBackspaceAtStart
                )
            }
        }

        // Dezente Block-Aktionsleiste beim Fokussieren (Verschieben / Löschen)
        AnimatedVisibility(visible = isActive) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 2.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (canMoveUp) {
                    Icon(
                        imageVector = Icons.Rounded.KeyboardArrowUp,
                        contentDescription = "Block nach oben",
                        tint = TextMuted,
                        modifier = Modifier
                            .size(20.dp)
                            .clickable { onMoveBlock(-1) }
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                }
                if (canMoveDown) {
                    Icon(
                        imageVector = Icons.Rounded.KeyboardArrowDown,
                        contentDescription = "Block nach unten",
                        tint = TextMuted,
                        modifier = Modifier
                            .size(20.dp)
                            .clickable { onMoveBlock(1) }
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Icon(
                    imageVector = Icons.Rounded.Delete,
                    contentDescription = "Block löschen",
                    tint = Danger.copy(alpha = 0.7f),
                    modifier = Modifier
                        .size(17.dp)
                        .clickable { onDeleteBlock() }
                )
            }
        }
    }
}

@Composable
private fun EditableTextField(
    text: String,
    style: TextStyle,
    placeholder: String,
    onValueChange: (String) -> Unit,
    onFocus: () -> Unit,
    onSelectionChanged: (TextRange) -> Unit,
    onEnter: () -> Unit,
    onBackspaceAtStart: () -> Unit,
    modifier: Modifier = Modifier
) {
    var textFieldValue by remember(text) {
        mutableStateOf(TextFieldValue(text = text, selection = TextRange(text.length)))
    }

    BasicTextField(
        value = textFieldValue,
        onValueChange = { newValue ->
            textFieldValue = newValue
            onSelectionChanged(newValue.selection)
            if (newValue.text != text) {
                onValueChange(newValue.text)
            }
        },
        modifier = modifier
            .fillMaxWidth()
            .onFocusChanged { if (it.isFocused) onFocus() }
            .onKeyEvent { keyEvent ->
                if (keyEvent.key == Key.Enter) {
                    onEnter()
                    true
                } else if (keyEvent.key == Key.Backspace && textFieldValue.selection.start == 0 && textFieldValue.selection.end == 0) {
                    onBackspaceAtStart()
                    true
                } else {
                    false
                }
            },
        textStyle = style,
        cursorBrush = SolidColor(Accent),
        keyboardOptions = KeyboardOptions.Default.copy(
            imeAction = ImeAction.Default
        ),
        decorationBox = { innerTextField ->
            if (textFieldValue.text.isEmpty()) {
                Text(text = placeholder, color = TextMuted, style = style)
            }
            innerTextField()
        }
    )
}

@Composable
private fun PageSummaryCard(
    page: PageSummary,
    onClick: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = BgSidebar,
        border = BorderStroke(1.dp, Edge),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Rounded.Note,
                contentDescription = null,
                tint = Accent,
                modifier = Modifier.size(18.dp)
            )
            Spacer(modifier = Modifier.width(10.dp))
            Text(
                text = page.title.ifEmpty { "Ohne Titel" },
                color = TextPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun InsertBlockOption(
    icon: ImageVector,
    title: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = Accent,
            modifier = Modifier.size(21.dp)
        )
        Spacer(modifier = Modifier.width(14.dp))
        Text(
            text = title,
            color = TextPrimary,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium
        )
    }
}

@Composable
private fun PageHistoryDialog(
    pageId: String,
    core: ImpalaCore,
    onDismiss: () -> Unit,
    onRestoreVersion: (PageVersion) -> Unit
) {
    var history by remember { mutableStateOf<List<PageVersion>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }

    LaunchedEffect(pageId) {
        withContext(Dispatchers.IO) {
            try {
                val versions = core.pageHistory(pageId)
                history = versions.reversed()
            } catch (e: Exception) {
                Log.e("NoteEditorScreen", "Versionsverlauf laden fehlgeschlagen", e)
            } finally {
                isLoading = false
            }
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = BgPanel,
            border = BorderStroke(1.dp, Edge),
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Versionsverlauf",
                    color = TextPrimary,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(12.dp))

                if (isLoading) {
                    Text("Lade Verlauf…", color = TextMuted, fontSize = 14.sp)
                } else if (history.isEmpty()) {
                    Text("Keine älteren Versionen vorhanden.", color = TextMuted, fontSize = 14.sp)
                } else {
                    LazyColumn(
                        modifier = Modifier.heightIn(max = 320.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        itemsIndexed(history) { _, version ->
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = BgSidebar,
                                border = BorderStroke(1.dp, EdgeSoft),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { onRestoreVersion(version) }
                            ) {
                                Column(modifier = Modifier.padding(12.dp)) {
                                    Text(
                                        text = version.time.take(19).replace('T', ' '),
                                        color = Accent,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    Text(
                                        text = version.title.ifEmpty { "Ohne Titel" },
                                        color = TextPrimary,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Medium
                                    )
                                    if (version.content.isNotEmpty()) {
                                        Text(
                                            text = version.content.take(90),
                                            color = TextSecondary,
                                            fontSize = 12.sp,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onDismiss) {
                        Text("Schließen", color = TextSecondary)
                    }
                }
            }
        }
    }
}
