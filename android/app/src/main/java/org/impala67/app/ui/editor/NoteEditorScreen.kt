package org.impala67.app.ui.editor

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
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.automirrored.rounded.NavigateNext
import androidx.compose.material.icons.automirrored.rounded.Note
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AttachFile
import androidx.compose.material.icons.rounded.CheckBox
import androidx.compose.material.icons.rounded.CheckBoxOutlineBlank
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PostAdd
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.TableChart
import androidx.compose.material.icons.rounded.Title
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
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.data.ImpalaRepository
import org.impala67.app.ui.theme.Accent
import org.impala67.app.ui.theme.AccentBorder
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.BgDeep
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.Success
import org.impala67.app.ui.theme.SurfaceActive
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.Warn
import uniffi.impala_ffi.MdBlock
import uniffi.impala_ffi.MdBlockKind
import uniffi.impala_ffi.MdHeadingLevel
import uniffi.impala_ffi.MdListStyle
import uniffi.impala_ffi.PageDetail
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.PageVersion
import uniffi.impala_ffi.blocksToMarkdown
import uniffi.impala_ffi.markdownToBlocks
import java.util.UUID

/**
 * Vollwertiger nativer Notiz- & Markdown-Editor für Impala67.
 * Bietet Block-basiertes Bearbeiten, Live-Synchronisation, Versionsverlauf und Diktat.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun NoteEditorScreen(
    pageId: String,
    repository: ImpalaRepository,
    onNavigateToPage: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val listState = rememberLazyListState()

    // Seiteninhalte
    var pageTitle by remember { mutableStateOf("") }
    var blocks by remember { mutableStateOf<List<MdBlock>>(emptyList()) }
    var ancestors by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    var subpages by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    var backlinks by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    var isDirty by remember { mutableStateOf(false) }

    // Fokus und Formatierungsleiste
    var activeBlockId by remember { mutableStateOf<String?>(null) }
    var activeBlockSelection by remember { mutableStateOf(TextRange.Zero) }

    // Dialoge und Sheets
    var showMoreMenu by remember { mutableStateOf(false) }
    var showHistoryDialog by remember { mutableStateOf(false) }
    var showInsertSheet by remember { mutableStateOf(false) }
    var insertTargetIndex by remember { mutableStateOf<Int?>(null) }

    // Debounce-Timer für Speicherung
    var saveJob by remember { mutableStateOf<Job?>(null) }

    // Hilfsfunktion: Sofortiges Speichern
    fun persistNow(titleToSave: String, blocksToSave: List<MdBlock>) {
        try {
            val markdown = blocksToMarkdown(blocksToSave)
            repository.core.updatePage(pageId, titleToSave, markdown)
            isDirty = false
        } catch (e: Exception) {
            Log.e("NoteEditorScreen", "Fehler beim Speichern von Seite $pageId", e)
        }
    }

    // Hilfsfunktion: Debounced Speichern
    fun scheduleSave(newTitle: String = pageTitle, newBlocks: List<MdBlock> = blocks) {
        isDirty = true
        saveJob?.cancel()
        saveJob = coroutineScope.launch {
            delay(400)
            withContext(Dispatchers.IO) {
                persistNow(newTitle, newBlocks)
            }
        }
    }

    // Hilfsfunktion: Neuen Block an der Zielposition einfügen
    fun insertNewBlock(kind: MdBlockKind) {
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

    // Seite & Metadaten laden
    fun reloadPage(forceReloadContent: Boolean = false) {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val detail: PageDetail? = repository.core.page(pageId)
                val ancs = repository.core.ancestorsOf(pageId)
                val subs = repository.core.childrenOf(pageId, null)
                val backs = repository.core.backlinks(pageId)

                withContext(Dispatchers.Main) {
                    ancestors = ancs
                    subpages = subs
                    backlinks = backs

                    if (detail != null) {
                        // Bei Initial-Load oder Fern-Änderung: Markdown neu parsen
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

    // Initiales Laden
    LaunchedEffect(pageId) {
        reloadPage(forceReloadContent = true)
    }

    // Sofortiges Speichern beim Verlassen der Ansicht
    DisposableEffect(pageId) {
        onDispose {
            saveJob?.cancel()
            if (isDirty) {
                persistNow(pageTitle, blocks)
            }
        }
    }

    // Reagieren auf repository.changesFlow
    LaunchedEffect(pageId) {
        repository.changesFlow.collect { changes ->
            if (changes.closedPages.contains(pageId)) {
                onBack()
                return@collect
            }
            if (changes.pages.contains(pageId) || changes.pagesAll || changes.everything) {
                // Bei Remote-Änderungen aktualisieren wir nahtlos
                if (changes.remote && !isDirty) {
                    reloadPage(forceReloadContent = true)
                } else {
                    reloadPage(forceReloadContent = false)
                }
            }
        }
    }

    // Spracherkennung für direktes Diktat
    val (speechState, toggleSpeech) = rememberNativeSpeechRecognizer(
        onSpeechResult = { recognizedText ->
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
                    val fileId = repository.core.addFile(bytes, mime, "bild_${System.currentTimeMillis()}.jpg")

                    val imageBlock = MdBlock(
                        id = UUID.randomUUID().toString(),
                        kind = MdBlockKind.Image("Bild", fileId),
                        textColor = null,
                        bgColor = null
                    )

                    withContext(Dispatchers.Main) {
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

    // Aktiver Block ermitteln
    val activeBlock = blocks.firstOrNull { it.id == activeBlockId }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = BgDeep,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        // Brotkrumen
                        if (ancestors.isNotEmpty()) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState()),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                ancestors.forEachIndexed { idx, anc ->
                                    Text(
                                        text = anc.title.ifEmpty { "Ohne Titel" },
                                        color = TextMuted,
                                        fontSize = 11.sp,
                                        maxLines = 1,
                                        modifier = Modifier.clickable { onNavigateToPage(anc.id) }
                                    )
                                    if (idx < ancestors.size - 1) {
                                        Icon(
                                            imageVector = Icons.AutoMirrored.rounded.NavigateNext,
                                            contentDescription = null,
                                            tint = TextMuted,
                                            modifier = Modifier.size(14.dp)
                                        )
                                    }
                                }
                            }
                        }
                        // Titel der Seite
                        BasicTextField(
                            value = pageTitle,
                            onValueChange = {
                                pageTitle = it
                                scheduleSave(newTitle = it)
                            },
                            textStyle = TextStyle(
                                color = TextPrimary,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold
                            ),
                            cursorBrush = SolidColor(Accent),
                            singleLine = true,
                            decorationBox = { innerTextField ->
                                if (pageTitle.isEmpty()) {
                                    Text("Titel der Notiz…", color = TextMuted, fontSize = 18.sp)
                                }
                                innerTextField()
                            }
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.rounded.ArrowBack,
                            contentDescription = "Zurück",
                            tint = TextPrimary
                        )
                    }
                },
                actions = {
                    // Block hinzufügen
                    IconButton(onClick = {
                        insertTargetIndex = blocks.size
                        showInsertSheet = true
                    }) {
                        Icon(
                            imageVector = Icons.Rounded.Add,
                            contentDescription = "Block einfügen",
                            tint = TextPrimary
                        )
                    }

                    // Aktionen-Menü
                    Box {
                        IconButton(onClick = { showMoreMenu = true }) {
                            Icon(
                                imageVector = Icons.Rounded.MoreVert,
                                contentDescription = "Optionen",
                                tint = TextPrimary
                            )
                        }

                        DropdownMenu(
                            expanded = showMoreMenu,
                            onDismissRequest = { showMoreMenu = false },
                            modifier = Modifier
                                .background(BgPanel)
                                .border(1.dp, Edge, RoundedCornerShape(12.dp))
                        ) {
                            DropdownMenuItem(
                                text = { Text("Unterseite anlegen", color = TextPrimary) },
                                leadingIcon = {
                                    Icon(Icons.Rounded.PostAdd, contentDescription = null, tint = TextSecondary)
                                },
                                onClick = {
                                    showMoreMenu = false
                                    coroutineScope.launch(Dispatchers.IO) {
                                        try {
                                            val newId = repository.core.createPage("Neue Unterseite", "", pageId, null)
                                            withContext(Dispatchers.Main) {
                                                onNavigateToPage(newId)
                                            }
                                        } catch (e: Exception) {
                                            Log.e("NoteEditorScreen", "Unterseite anlegen fehlgeschlagen", e)
                                        }
                                    }
                                }
                            )

                            DropdownMenuItem(
                                text = { Text("Lernkarten synchronisieren", color = TextPrimary) },
                                leadingIcon = {
                                    Icon(Icons.Rounded.School, contentDescription = null, tint = Accent)
                                },
                                onClick = {
                                    showMoreMenu = false
                                    coroutineScope.launch(Dispatchers.IO) {
                                        try {
                                            val count = repository.core.cardsFromHighlights(pageId, null)
                                            snackbarHostState.showSnackbar(
                                                if (count > 0u) "$count Karteikarten synchronisiert"
                                                else "Keine neuen Markierungen (==...==) gefunden"
                                            )
                                        } catch (e: Exception) {
                                            Log.e("NoteEditorScreen", "Karten synchronisieren fehlgeschlagen", e)
                                        }
                                    }
                                }
                            )

                            DropdownMenuItem(
                                text = { Text("Versionsverlauf", color = TextPrimary) },
                                leadingIcon = {
                                    Icon(Icons.Rounded.History, contentDescription = null, tint = TextSecondary)
                                },
                                onClick = {
                                    showMoreMenu = false
                                    showHistoryDialog = true
                                }
                            )

                            HorizontalDivider(color = Edge, modifier = Modifier.padding(vertical = 4.dp))

                            DropdownMenuItem(
                                text = { Text("In Papierkorb verschieben", color = Danger) },
                                leadingIcon = {
                                    Icon(Icons.Rounded.Delete, contentDescription = null, tint = Danger)
                                },
                                onClick = {
                                    showMoreMenu = false
                                    coroutineScope.launch(Dispatchers.IO) {
                                        try {
                                            repository.core.trashPage(pageId)
                                            withContext(Dispatchers.Main) {
                                                onBack()
                                            }
                                        } catch (e: Exception) {
                                            Log.e("NoteEditorScreen", "Papierkorb fehlgeschlagen", e)
                                        }
                                    }
                                }
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgDeep,
                    navigationIconContentColor = TextPrimary,
                    titleContentColor = TextPrimary,
                    actionIconContentColor = TextPrimary
                )
            )
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                contentPadding = PaddingValues(top = 8.dp, bottom = 120.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                // Leere Seite: Initialer Absatz
                if (blocks.isEmpty()) {
                    item(key = "empty_placeholder") {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 24.dp)
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
                                text = "Tippe hier oder auf '+' um Notizen zu verfassen…",
                                color = TextMuted,
                                fontSize = 16.sp
                            )
                        }
                    }
                }

                // Blöcke rendern
                itemsIndexed(
                    items = blocks,
                    key = { _, block -> block.id }
                ) { index, block ->
                    BlockItemRenderer(
                        block = block,
                        isActive = activeBlockId == block.id,
                        repository = repository,
                        onNavigateToPage = onNavigateToPage,
                        onFocus = { activeBlockId = block.id },
                        onSelectionChanged = { activeBlockSelection = it },
                        onContentChange = { updatedKind ->
                            val updated = blocks.toMutableList().apply {
                                set(index, block.copy(kind = updatedKind))
                            }
                            blocks = updated
                            scheduleSave(newBlocks = updated)
                        },
                        onEnter = {
                            // Neuer Absatz nach aktuellem Block
                            val newBlock = MdBlock(
                                id = UUID.randomUUID().toString(),
                                kind = MdBlockKind.Paragraph(""),
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
                            // Block löschen bzw. mit vorherigem verschmelzen
                            if (blocks.size > 1) {
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

                // Unterseiten-Sektion
                if (subpages.isNotEmpty()) {
                    item(key = "section_subpages") {
                        Spacer(modifier = Modifier.height(24.dp))
                        Text(
                            text = "UNTERSEITEN (${subpages.size})",
                            color = TextMuted,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                    }

                    itemsIndexed(
                        items = subpages,
                        key = { _, p -> "sub_${p.id}" }
                    ) { _, page ->
                        PageSummaryCard(
                            page = page,
                            onClick = { onNavigateToPage(page.id) }
                        )
                    }
                }

                // Rückverweise (Backlinks)
                if (backlinks.isNotEmpty()) {
                    item(key = "section_backlinks") {
                        Spacer(modifier = Modifier.height(24.dp))
                        Text(
                            text = "VERWEISE AUF DIESE SEITE (${backlinks.size})",
                            color = TextMuted,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                    }

                    itemsIndexed(
                        items = backlinks,
                        key = { _, p -> "back_${p.id}" }
                    ) { _, page ->
                        PageSummaryCard(
                            page = page,
                            onClick = { onNavigateToPage(page.id) }
                        )
                    }
                }
            }

            // Schwebende Formatierungsleiste über der Tastatur
            ExpressiveFloatingToolbar(
                activeBlock = activeBlock,
                isSpeechListening = speechState.isListening,
                onToggleSpeech = toggleSpeech,
                onWrapSelection = { prefix, suffix ->
                    if (activeBlock != null) {
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
                        val updated = blocks.map { b ->
                            if (b.id == activeBlock.id) b.copy(kind = newKind) else b
                        }
                        blocks = updated
                        scheduleSave(newBlocks = updated)
                    }
                },
                onIndentChange = { delta ->
                    if (activeBlock?.kind is MdBlockKind.List) {
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

    // Modal Bottom Sheet: Block einfügen
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
                InsertBlockOption(Icons.Rounded.CheckBox, "Aufgabe (Todo-Checkbox)") {
                    insertNewBlock(MdBlockKind.List(MdListStyle.Todo(checked = false), 0u, ""))
                }
                InsertBlockOption(Icons.Rounded.Code, "Codeblock") {
                    insertNewBlock(MdBlockKind.Code("kotlin", ""))
                }
                InsertBlockOption(Icons.Rounded.Info, "Callout-Hinweisbox") {
                    val child = MdBlock(UUID.randomUUID().toString(), MdBlockKind.Paragraph(""), null, null)
                    insertNewBlock(MdBlockKind.Callout("blue", listOf(child)))
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
                        val count = repository.core.cardsFromHighlights(pageId, null)
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

    // Dialog: Versionsverlauf
    if (showHistoryDialog) {
        PageHistoryDialog(
            pageId = pageId,
            repository = repository,
            onDismiss = { showHistoryDialog = false },
            onRestoreVersion = { version ->
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
 * Hilfsfunktion zum Aktualisieren des Blocktextes bei Format- oder Inhaltstransformationen.
 */
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
    repository: ImpalaRepository,
    onNavigateToPage: (String) -> Unit,
    onFocus: () -> Unit,
    onSelectionChanged: (TextRange) -> Unit,
    onContentChange: (MdBlockKind) -> Unit,
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

    Box(
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
                        if (newText.startsWith("/")) {
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
                                    .size(20.dp)
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
                    modifier = Modifier.padding(vertical = 12.dp)
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
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = kind.language.ifEmpty { "code" },
                                color = Accent,
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Bold
                            )
                        }
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
                        // Knöpfe: Zeile und Spalte hinzufügen
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
                            val fileData = repository.core.file(kind.src)
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
                                    text = "Bild wird geladen… (${kind.alt})",
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
                            imageVector = Icons.AutoMirrored.rounded.MenuBook,
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
    }
}

/**
 * Universelles editierbares Textfeld mit Tastatur-Ereignissen für Enter und Backspace.
 */
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

/**
 * Unterseiten- und Rückverweis-Kachel.
 */
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
                imageVector = Icons.AutoMirrored.rounded.Note,
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

/**
 * Option im Insert-Sheet.
 */
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
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = Accent,
            modifier = Modifier.size(22.dp)
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

/**
 * Dialog zur Anzeige und Wiederherstellung des Versionsverlaufs.
 */
@Composable
private fun PageHistoryDialog(
    pageId: String,
    repository: ImpalaRepository,
    onDismiss: () -> Unit,
    onRestoreVersion: (PageVersion) -> Unit
) {
    var history by remember { mutableStateOf<List<PageVersion>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }

    LaunchedEffect(pageId) {
        withContext(Dispatchers.IO) {
            try {
                val versions = repository.core.pageHistory(pageId)
                history = versions.reversed() // Neueste zuerst
            } catch (e: Exception) {
                Log.e("NoteEditorScreen", "Versionsverlauf laden fehlgeschlagen", e)
            } finally {
                isLoading = false
            }
        }
    }

    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = BgPanel,
            border = BorderStroke(1.dp, Edge),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
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
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(100.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("Verlauf wird geladen…", color = TextMuted)
                    }
                } else if (history.isEmpty()) {
                    Text(
                        text = "Keine früheren Versionen gespeichert.",
                        color = TextMuted,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(vertical = 16.dp)
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier.heightIn(max = 350.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        itemsIndexed(history) { _, version ->
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = BgSidebar,
                                border = BorderStroke(1.dp, Edge),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(10.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = version.time.take(19).replace("T", " "),
                                            color = Accent,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                        Text(
                                            text = version.title.ifEmpty { "Ohne Titel" },
                                            color = TextPrimary,
                                            fontSize = 14.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }

                                    Surface(
                                        shape = RoundedCornerShape(6.dp),
                                        color = AccentSoft,
                                        modifier = Modifier.clickable { onRestoreVersion(version) }
                                    ) {
                                        Text(
                                            text = "Wiederherstellen",
                                            color = Accent,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    Text(
                        text = "Schließen",
                        color = TextSecondary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier
                            .clickable(onClick = onDismiss)
                            .padding(8.dp)
                    )
                }
            }
        }
    }
}
