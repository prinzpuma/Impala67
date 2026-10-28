package org.impala67.app.ui.heft

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas as ComposeCanvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
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
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import uniffi.impala_ffi.*
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * 8 Schnellfarben aus der PWA (`web/heft-toolbar-ui.js`).
 */
val HeftQuickColors = listOf(
    "#1e1e1e",
    "#f8f9fa",
    "#3b82f6",
    "#ef4444",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899"
)

/**
 * 5 Strichstärken-Punkte im Stift-Tray.
 */
val HeftStrokeSizes = listOf(1.5f, 2.5f, 4.0f, 6.0f, 9.0f)

/**
 * Stift-Favoriten-Slot (`heft-penfav`).
 */
data class PenFavoriteSlot(
    val color: String,
    val size: Float
)

/**
 * Erweiterte Papier-Vorlagen der PWA.
 */
enum class ExtendedPaperType(val id: String, val label: String, val coreFallback: String) {
    GRID("grid", "Kariert (grid)", "grid"),
    LINED("lined", "Liniert (lined)", "lined"),
    DOTTED("dots", "Punktiert (dotted)", "dots"),
    BLANK("blank", "Blanko (blank)", "blank"),
    CORNELL("cornell", "Cornell-Notizen (cornell)", "lined"),
    MUSIC("music", "Musiknoten (music)", "blank"),
    PLANNER("planner", "Wochenplan (planner)", "grid")
}

/**
 * Papier-Farben der PWA.
 */
enum class PaperTint(val hex: String, val label: String) {
    CREAM("#FAF8F5", "Warmweiß / Creme (#FAF8F5)"),
    WHITE("#FFFFFF", "Reinweiß (#FFFFFF)"),
    DARK("#1E1E22", "Dunkel (#1E1E22)")
}

/**
 * Rückwärtskompatibler Überladungs-Einstiegspunkt für Aufrufer mit ImpalaRepository.
 */
@Composable
fun HeftScreen(
    pageId: String,
    repository: ImpalaRepository,
    onBack: () -> Unit,
    onOpenAiForPage: (String) -> Unit = {},
    isTabletUi: Boolean = false,
    modifier: Modifier = Modifier
) {
    var mobileReadOnly by remember { mutableStateOf(false) }
    var reloadTrigger by remember { mutableIntStateOf(0) }

    LaunchedEffect(pageId) {
        repository.changesFlow.collect { changes ->
            if (changes.everything || changes.hefte.contains(pageId) || changes.heftImages.isNotEmpty()) {
                reloadTrigger++
            }
        }
    }

    HeftScreen(
        core = repository.core,
        pageId = "$pageId#$reloadTrigger".substringBefore("#"),
        onNavigateBack = onBack,
        onOpenAiForPage = onOpenAiForPage,
        onMutation = { repository.refreshAll() },
        isTabletUi = isTabletUi,
        isMobileReadOnly = mobileReadOnly,
        onToggleMobileReadOnly = { mobileReadOnly = !mobileReadOnly },
        onToggleSidebar = {},
        modifier = modifier
    )
}

/**
 * Echte GoodNotes-/PWA-Heft-Oberfläche nach `web/heft.js` & `web/heft-toolbar-ui.js`.
 * Nutzt ein schwebendes Top-Chrome (`heft-chrome`), damit die untere Android-Taskleiste
 * beim Schreiben mit dem Stift niemals im Weg ist.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HeftScreen(
    core: ImpalaCore,
    pageId: String,
    onNavigateBack: () -> Unit,
    onOpenAiForPage: (String) -> Unit = {},
    onMutation: () -> Unit = {},
    isTabletUi: Boolean = false,
    isMobileReadOnly: Boolean = false,
    onToggleMobileReadOnly: () -> Unit = {},
    onToggleSidebar: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val heftPrefs = remember(context) {
        context.getSharedPreferences("impala_heft_prefs", Context.MODE_PRIVATE)
    }

    // Digital Ink OCR Manager
    val ocrManager = remember { DigitalInkOcrManager() }
    DisposableEffect(Unit) {
        onDispose {
            ocrManager.close()
        }
    }

    // Heft-Titel & Seiten-Zustand
    var heftTitle by remember { mutableStateOf("Heft") }
    var pageIds by remember { mutableStateOf<List<String>>(emptyList()) }
    var currentPageIndex by remember { mutableIntStateOf(0) }
    var currentPageData by remember { mutableStateOf<HeftPageData?>(null) }
    var isLoading by remember { mutableStateOf(true) }

    // 3 Stift-Favoriten-Slots (`heft-penfav`)
    val penSlots = remember {
        mutableStateListOf(
            PenFavoriteSlot("#1e1e1e", 2.5f),
            PenFavoriteSlot("#3b82f6", 2.5f),
            PenFavoriteSlot("#ef4444", 4.0f)
        )
    }
    var activePenSlotIndex by remember { mutableIntStateOf(0) }

    // Werkzeug-Zustand
    var selectedTool by remember { mutableStateOf(HeftTool.PEN) }
    var isLaserActive by remember { mutableStateOf(false) }
    var penColor by remember { mutableStateOf(penSlots[0].color) }
    var markerColor by remember { mutableStateOf("#f59e0b") }
    var strokeSize by remember { mutableFloatStateOf(penSlots[0].size) }
    var eraserSizeMode by remember { mutableStateOf("M") } // S, M, L
    var stylusOnlyMode by remember {
        mutableStateOf(heftPrefs.getBoolean("stylus_only", false))
    }

    // Toolbar & Tray Sichtbarkeit
    var isPillCollapsed by remember { mutableStateOf(false) }
    var showStrokeTray by remember { mutableStateOf(false) }
    var showEraserTray by remember { mutableStateOf(false) }
    var showPagePopover by remember { mutableStateOf(false) }
    var showPageGridDialog by remember { mutableStateOf(false) }
    var showRenameDialog by remember { mutableStateOf(false) }
    var renameInput by remember { mutableStateOf("") }

    // Papier-Erweiterungen (Cornell, Musik, Wochenplan + Papierfarbe)
    val currentHeftPageId = currentPageData?.id ?: ""
    var extendedPaper by remember(currentHeftPageId) {
        val saved = heftPrefs.getString("paper_ext_$currentHeftPageId", null)
        val initial = ExtendedPaperType.entries.firstOrNull { it.id == saved }
            ?: ExtendedPaperType.entries.firstOrNull { it.id == currentPageData?.paper }
            ?: ExtendedPaperType.LINED
        mutableStateOf(initial)
    }
    var paperTint by remember(currentHeftPageId) {
        val savedHex = heftPrefs.getString("paper_tint_$currentHeftPageId", PaperTint.CREAM.hex)
        val initial = PaperTint.entries.firstOrNull { it.hex == savedHex } ?: PaperTint.CREAM
        mutableStateOf(initial)
    }

    // Laserpointer-Spuren (temporär, verblassen nach 1.2s)
    val laserPoints = remember { mutableStateListOf<Offset>() }

    // Undo / Redo Stapel
    val undoStack = remember { mutableStateListOf<String>() }
    val redoStack = remember { mutableStateListOf<String>() }

    // Lasso-Auswahl
    var selectedStrokeIds by remember { mutableStateOf<List<String>>(emptyList()) }

    // Scanner-Sheet & Text-Dialog & Export
    var showScannerSheet by remember { mutableStateOf(false) }
    var showTextDialog by remember { mutableStateOf(false) }
    var newTextValue by remember { mutableStateOf("") }
    var isExporting by remember { mutableStateOf(false) }
    var isRunningOcr by remember { mutableStateOf(false) }

    fun loadPages(targetPageId: String? = null) {
        scope.launch(Dispatchers.IO) {
            try {
                val pgDetail = core.page(pageId)
                var ids = core.heftPageIds(pageId)
                if (ids.isEmpty()) {
                    val firstPageId = core.heftAddPage(pageId, null, HeftPaper.LINED.id)
                    ids = listOf(firstPageId)
                }

                val targetIndex = if (targetPageId != null) {
                    val idx = ids.indexOf(targetPageId)
                    if (idx >= 0) idx else 0
                } else {
                    currentPageIndex.coerceIn(0, ids.size - 1)
                }

                val currentId = ids[targetIndex]
                val data = core.heftPage(pageId, currentId)

                withContext(Dispatchers.Main) {
                    heftTitle = pgDetail?.summary?.title?.ifBlank { "Heft" } ?: "Heft"
                    pageIds = ids
                    currentPageIndex = targetIndex
                    currentPageData = data
                    isLoading = false
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    isLoading = false
                }
            }
        }
    }

    LaunchedEffect(pageId) {
        loadPages()
    }

    // Automatisches Ausblenden der Laserpointer-Spur
    LaunchedEffect(laserPoints.size) {
        if (laserPoints.isNotEmpty()) {
            delay(900)
            laserPoints.clear()
        }
    }

    val activeColor = when (selectedTool) {
        HeftTool.MARKER -> markerColor
        else -> penColor
    }

    val effectiveStrokeSize = when (selectedTool) {
        HeftTool.ERASER -> when (eraserSizeMode) {
            "S" -> 2.0f
            "L" -> 8.0f
            else -> 4.5f
        }
        else -> strokeSize
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF141518))
            .statusBarsPadding()
    ) {
        // 1. Haupt-Zeichencanvas
        if (isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Accent)
            }
        } else if (currentPageData != null) {
            Box(modifier = Modifier.fillMaxSize()) {
                JetpackInkCanvas(
                    pageId = pageId,
                    heftPageId = currentPageData!!.id,
                    pageData = currentPageData!!,
                    core = core,
                    selectedTool = selectedTool,
                    strokeColor = activeColor,
                    strokeSize = effectiveStrokeSize,
                    ocrManager = ocrManager,
                    onUndoStackChanged = { undoJson ->
                        if (!undoJson.isNullOrEmpty()) {
                            undoStack.add(undoJson)
                            redoStack.clear()
                        }
                        val curId = pageIds.getOrNull(currentPageIndex)
                        if (curId != null) {
                            scope.launch(Dispatchers.IO) {
                                val updated = core.heftPage(pageId, curId)
                                withContext(Dispatchers.Main) {
                                    currentPageData = updated
                                    onMutation()
                                }
                            }
                        }
                    },
                    onSelectedStrokesChanged = { selected ->
                        selectedStrokeIds = selected
                    }
                )

                // Overlay für erweiterte Papier-Vorlagen (Cornell, Musiknoten, Wochenplan) & Papier-Farbtönung
                ExtendedPaperOverlay(
                    extendedPaper = extendedPaper,
                    paperTint = paperTint
                )

                // Laserpointer-Modus: temporäre leuchtend rote Spur über dem Canvas
                if (isLaserActive && !isMobileReadOnly) {
                    ComposeCanvas(
                        modifier = Modifier
                            .fillMaxSize()
                            .pointerInput(Unit) {
                                detectDragGestures(
                                    onDragStart = { offset ->
                                        laserPoints.clear()
                                        laserPoints.add(offset)
                                    },
                                    onDrag = { change, _ ->
                                        change.consume()
                                        laserPoints.add(change.position)
                                    }
                                )
                            }
                    ) {
                        if (laserPoints.size >= 2) {
                            val path = Path().apply {
                                moveTo(laserPoints.first().x, laserPoints.first().y)
                                for (i in 1 until laserPoints.size) {
                                    lineTo(laserPoints[i].x, laserPoints[i].y)
                                }
                            }
                            // Äußerer Schein
                            drawPath(
                                path = path,
                                color = Color(0x66FF2E2E),
                                style = Stroke(width = 16f, cap = StrokeCap.Round, join = StrokeJoin.Round)
                            )
                            // Leuchtender Kern
                            drawPath(
                                path = path,
                                color = Color(0xFFFF1E1E),
                                style = Stroke(width = 5f, cap = StrokeCap.Round, join = StrokeJoin.Round)
                            )
                        }
                    }
                }

                // Lese-Modus Schutzschicht auf Smartphones (`isMobileReadOnly`): verhindert versehentliches Malen
                if (isMobileReadOnly) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .pointerInput(Unit) {
                                // Fängt 1-Finger-Gesten ab, damit nicht versehentlich gezeichnet wird
                                detectDragGestures { _, _ -> }
                            }
                    )
                }
            }
        }

        // 2. Schwebendes Top-Chrome (`#heftChrome` wie in der PWA)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.TopCenter)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Obere Zeile: Links (`heft-corner-group`) + Mitte (`heft-pill`) + Rechts (`heft-corner-group`)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // --- LINKS OBEN: Zurück/Sidebar + Seitenwechsel-Pill + Heft-Titel ---
                Surface(
                    shape = ImpalaPillShape,
                    color = BgPanel.copy(alpha = 0.94f),
                    border = BorderStroke(1.dp, Edge),
                    shadowElevation = 6.dp
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        IconButton(
                            onClick = {
                                if (isTabletUi) onToggleSidebar() else onNavigateBack()
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                imageVector = if (isTabletUi) Icons.Default.Menu else Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = if (isTabletUi) "Seitenleiste" else "Zurück",
                                tint = TextPrimary,
                                modifier = Modifier.size(18.dp)
                            )
                        }

                        // Seitenwechsel: ‹ 1 / N ›
                        IconButton(
                            onClick = {
                                if (currentPageIndex > 0) {
                                    currentPageIndex--
                                    loadPages(pageIds[currentPageIndex])
                                }
                            },
                            enabled = currentPageIndex > 0,
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(
                                Icons.Default.ChevronLeft,
                                contentDescription = "Vorherige Seite",
                                tint = if (currentPageIndex > 0) TextPrimary else TextMuted,
                                modifier = Modifier.size(18.dp)
                            )
                        }

                        Surface(
                            shape = ImpalaPillShape,
                            color = BgSidebar,
                            modifier = Modifier
                                .clip(ImpalaPillShape)
                                .clickable { showPageGridDialog = true }
                        ) {
                            Text(
                                text = "${currentPageIndex + 1} / ${pageIds.size.coerceAtLeast(1)}",
                                color = TextPrimary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }

                        IconButton(
                            onClick = {
                                if (currentPageIndex < pageIds.size - 1) {
                                    currentPageIndex++
                                    loadPages(pageIds[currentPageIndex])
                                }
                            },
                            enabled = currentPageIndex < pageIds.size - 1,
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(
                                Icons.Default.ChevronRight,
                                contentDescription = "Nächste Seite",
                                tint = if (currentPageIndex < pageIds.size - 1) TextPrimary else TextMuted,
                                modifier = Modifier.size(18.dp)
                            )
                        }

                        // Heft-Titel (antippbar zum Umbenennen)
                        Text(
                            text = heftTitle,
                            color = TextSecondary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier
                                .widthIn(max = if (isTabletUi) 150.dp else 90.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .clickable {
                                    renameInput = heftTitle
                                    showRenameDialog = true
                                }
                                .padding(horizontal = 6.dp, vertical = 4.dp)
                        )
                    }
                }

                // --- RECHTS OBEN: Lese-/Schreibmodus + KI-Coach + Seite & Papiervorlage-Menü (+) ---
                Surface(
                    shape = ImpalaPillShape,
                    color = BgPanel.copy(alpha = 0.94f),
                    border = BorderStroke(1.dp, Edge),
                    shadowElevation = 6.dp
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        if (!isTabletUi) {
                            Surface(
                                shape = ImpalaPillShape,
                                color = if (isMobileReadOnly) AccentSoft else Color.Transparent,
                                modifier = Modifier
                                    .clip(ImpalaPillShape)
                                    .clickable { onToggleMobileReadOnly() }
                            ) {
                                Text(
                                    text = if (isMobileReadOnly) "👁️ Lesen" else "✏️ Zeichnen",
                                    color = if (isMobileReadOnly) Accent else TextSecondary,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                )
                            }
                        }

                        // ✦ KI-Coach
                        IconButton(
                            onClick = { onOpenAiForPage(pageId) },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.AutoAwesome,
                                contentDescription = "KI-Coach",
                                tint = Accent,
                                modifier = Modifier.size(18.dp)
                            )
                        }

                        // + Seite & Papiervorlage-Menü (`heft-page-popover`)
                        Box {
                            IconButton(
                                onClick = { showPagePopover = true },
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Add,
                                    contentDescription = "Seite & Papiervorlage",
                                    tint = TextPrimary,
                                    modifier = Modifier.size(20.dp)
                                )
                            }

                            DropdownMenu(
                                expanded = showPagePopover,
                                onDismissRequest = { showPagePopover = false },
                                modifier = Modifier
                                    .background(BgPanel)
                                    .border(1.dp, Edge, RoundedCornerShape(14.dp))
                                    .widthIn(min = 250.dp)
                            ) {
                                DropdownMenuItem(
                                    text = { Text("+ Neue Heft-Seite anhängen", color = Success, fontWeight = FontWeight.SemiBold) },
                                    onClick = {
                                        showPagePopover = false
                                        scope.launch(Dispatchers.IO) {
                                            try {
                                                val currentPaper = currentPageData?.paper ?: HeftPaper.LINED.id
                                                val newId = core.heftAddPage(pageId, (currentPageIndex + 1).toUInt(), currentPaper)
                                                onMutation()
                                                withContext(Dispatchers.Main) {
                                                    loadPages(newId)
                                                }
                                            } catch (_: Exception) {}
                                        }
                                    }
                                )

                                HorizontalDivider(color = EdgeSoft, modifier = Modifier.padding(vertical = 4.dp))

                                Text(
                                    text = "PAPIER-VORLAGE",
                                    color = TextMuted,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp)
                                )

                                ExtendedPaperType.entries.forEach { pType ->
                                    val isCurrent = extendedPaper == pType
                                    DropdownMenuItem(
                                        text = {
                                            Text(
                                                text = pType.label,
                                                color = if (isCurrent) Accent else TextPrimary,
                                                fontSize = 13.sp,
                                                fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal
                                            )
                                        },
                                        onClick = {
                                            extendedPaper = pType
                                            showPagePopover = false
                                            currentPageData?.let { data ->
                                                heftPrefs.edit().putString("paper_ext_${data.id}", pType.id).apply()
                                                scope.launch(Dispatchers.IO) {
                                                    try {
                                                        val edit = core.heftSetPaper(pageId, data.id, pType.coreFallback)
                                                        undoStack.add(edit.undo)
                                                        val updated = core.heftPage(pageId, data.id)
                                                        withContext(Dispatchers.Main) { currentPageData = updated }
                                                    } catch (_: Exception) {}
                                                }
                                            }
                                        }
                                    )
                                }

                                HorizontalDivider(color = EdgeSoft, modifier = Modifier.padding(vertical = 4.dp))

                                Text(
                                    text = "PAPIER-FARBE",
                                    color = TextMuted,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp)
                                )

                                PaperTint.entries.forEach { tintOption ->
                                    val isCurrent = paperTint == tintOption
                                    DropdownMenuItem(
                                        text = {
                                            Text(
                                                text = tintOption.label,
                                                color = if (isCurrent) Accent else TextPrimary,
                                                fontSize = 13.sp,
                                                fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal
                                            )
                                        },
                                        onClick = {
                                            paperTint = tintOption
                                            if (currentHeftPageId.isNotEmpty()) {
                                                heftPrefs.edit().putString("paper_tint_$currentHeftPageId", tintOption.hex).apply()
                                            }
                                            showPagePopover = false
                                        }
                                    )
                                }

                                HorizontalDivider(color = EdgeSoft, modifier = Modifier.padding(vertical = 4.dp))

                                DropdownMenuItem(
                                    text = { Text("📷 Dokument scannen (ML Kit)", color = TextPrimary, fontSize = 13.sp) },
                                    onClick = {
                                        showPagePopover = false
                                        showScannerSheet = true
                                    }
                                )

                                DropdownMenuItem(
                                    text = { Text("🔤 Textfeld einfügen", color = TextPrimary, fontSize = 13.sp) },
                                    onClick = {
                                        showPagePopover = false
                                        showTextDialog = true
                                    }
                                )

                                DropdownMenuItem(
                                    text = { Text("📄 Heft als PDF teilen", color = TextPrimary, fontSize = 13.sp) },
                                    onClick = {
                                        showPagePopover = false
                                        if (!isExporting) {
                                            isExporting = true
                                            exportPdf(context, pageId, heftTitle, pageIds, core) {
                                                isExporting = false
                                            }
                                        }
                                    }
                                )
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            // --- MITTE OBEN: Schwebende GoodNotes-Werkzeug-Pill (`heft-pill`) ---
            if (!isMobileReadOnly) {
                Surface(
                    shape = ImpalaPillShape,
                    color = BgPanel.copy(alpha = 0.96f),
                    border = BorderStroke(1.dp, Edge),
                    shadowElevation = 10.dp
                ) {
                    Row(
                        modifier = Modifier
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 8.dp, vertical = 5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        if (!isPillCollapsed) {
                            // ↶ Undo
                            IconButton(
                                onClick = {
                                    val undoOps = undoStack.removeLastOrNull()
                                    if (undoOps != null) {
                                        scope.launch(Dispatchers.IO) {
                                            try {
                                                val edit = core.heftApplyOps(pageId, undoOps)
                                                if (edit.undo.isNotEmpty()) redoStack.add(edit.undo)
                                                val currentId = pageIds.getOrNull(currentPageIndex)
                                                if (currentId != null) {
                                                    val updated = core.heftPage(pageId, currentId)
                                                    withContext(Dispatchers.Main) { currentPageData = updated }
                                                }
                                            } catch (_: Exception) {}
                                        }
                                    }
                                },
                                enabled = undoStack.isNotEmpty(),
                                modifier = Modifier.size(34.dp)
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.Undo,
                                    contentDescription = "Rückgängig",
                                    tint = if (undoStack.isNotEmpty()) TextPrimary else TextMuted,
                                    modifier = Modifier.size(18.dp)
                                )
                            }

                            // ↷ Redo
                            IconButton(
                                onClick = {
                                    val redoOps = redoStack.removeLastOrNull()
                                    if (redoOps != null) {
                                        scope.launch(Dispatchers.IO) {
                                            try {
                                                val edit = core.heftApplyOps(pageId, redoOps)
                                                if (edit.undo.isNotEmpty()) undoStack.add(edit.undo)
                                                val currentId = pageIds.getOrNull(currentPageIndex)
                                                if (currentId != null) {
                                                    val updated = core.heftPage(pageId, currentId)
                                                    withContext(Dispatchers.Main) { currentPageData = updated }
                                                }
                                            } catch (_: Exception) {}
                                        }
                                    }
                                },
                                enabled = redoStack.isNotEmpty(),
                                modifier = Modifier.size(34.dp)
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.Redo,
                                    contentDescription = "Wiederholen",
                                    tint = if (redoStack.isNotEmpty()) TextPrimary else TextMuted,
                                    modifier = Modifier.size(18.dp)
                                )
                            }

                            Box(modifier = Modifier.width(1.dp).height(18.dp).background(Edge))

                            // 3 Stift-Favoriten-Slots (`heft-penfav`)
                            penSlots.forEachIndexed { idx, slot ->
                                val isSlotSelected = !isLaserActive && selectedTool == HeftTool.PEN && activePenSlotIndex == idx
                                val parsedColor = remember(slot.color) {
                                    try {
                                        Color(android.graphics.Color.parseColor(slot.color))
                                    } catch (_: Exception) {
                                        Color.White
                                    }
                                }
                                Box(
                                    modifier = Modifier
                                        .size(36.dp)
                                        .clip(CircleShape)
                                        .background(if (isSlotSelected) AccentSoft else Color.Transparent)
                                        .border(
                                            width = if (isSlotSelected) 1.5.dp else 0.dp,
                                            color = if (isSlotSelected) Accent else Color.Transparent,
                                            shape = CircleShape
                                        )
                                        .clickable {
                                            if (isSlotSelected) {
                                                showStrokeTray = !showStrokeTray
                                                showEraserTray = false
                                            } else {
                                                isLaserActive = false
                                                selectedTool = HeftTool.PEN
                                                activePenSlotIndex = idx
                                                penColor = slot.color
                                                strokeSize = slot.size
                                                showEraserTray = false
                                            }
                                        },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size((slot.size * 2.2f).coerceIn(8f, 22f).dp)
                                            .clip(CircleShape)
                                            .background(parsedColor)
                                            .border(1.dp, Edge, CircleShape)
                                    )
                                }
                            }

                            // Textmarker (`marker`)
                            PillToolButton(
                                icon = Icons.Default.Highlight,
                                label = "Textmarker",
                                isSelected = !isLaserActive && selectedTool == HeftTool.MARKER,
                                onClick = {
                                    if (!isLaserActive && selectedTool == HeftTool.MARKER) {
                                        showStrokeTray = !showStrokeTray
                                        showEraserTray = false
                                    } else {
                                        isLaserActive = false
                                        selectedTool = HeftTool.MARKER
                                        showEraserTray = false
                                    }
                                }
                            )

                            // Radierer (`eraser`)
                            PillToolButton(
                                icon = Icons.Default.AutoFixNormal,
                                label = "Radierer",
                                isSelected = !isLaserActive && selectedTool == HeftTool.ERASER,
                                onClick = {
                                    if (!isLaserActive && selectedTool == HeftTool.ERASER) {
                                        showEraserTray = !showEraserTray
                                        showStrokeTray = false
                                    } else {
                                        isLaserActive = false
                                        selectedTool = HeftTool.ERASER
                                        showStrokeTray = false
                                    }
                                }
                            )

                            // Lasso / Auswahl (`lasso`)
                            PillToolButton(
                                icon = Icons.Default.CropFree,
                                label = "Lasso",
                                isSelected = !isLaserActive && selectedTool == HeftTool.LASSO,
                                onClick = {
                                    isLaserActive = false
                                    selectedTool = HeftTool.LASSO
                                    showStrokeTray = false
                                    showEraserTray = false
                                }
                            )

                            // Formen-Werkzeug (`shape`)
                            PillToolButton(
                                icon = Icons.Default.Category,
                                label = "Formen",
                                isSelected = !isLaserActive && selectedTool == HeftTool.SHAPE,
                                onClick = {
                                    isLaserActive = false
                                    selectedTool = HeftTool.SHAPE
                                    showStrokeTray = false
                                    showEraserTray = false
                                }
                            )

                            // Laserpointer (`laser`)
                            PillToolButton(
                                icon = Icons.Default.Flare,
                                label = "Laserpointer",
                                isSelected = isLaserActive,
                                activeColor = Danger,
                                onClick = {
                                    isLaserActive = !isLaserActive
                                    showStrokeTray = false
                                    showEraserTray = false
                                }
                            )

                            // KI-Handschrift-Erkennung (`OCR / Text erkennen`)
                            PillToolButton(
                                icon = Icons.Default.TextFields,
                                label = "Handschrift erkennen (OCR)",
                                isSelected = isRunningOcr,
                                onClick = {
                                    val data = currentPageData ?: return@PillToolButton
                                    if (!isRunningOcr) {
                                        isRunningOcr = true
                                        scope.launch {
                                            val recognized = ocrManager.recognizeAndSave(
                                                core = core,
                                                pageId = pageId,
                                                heftPageId = data.id,
                                                strokes = data.strokes
                                            )
                                            isRunningOcr = false
                                            val msg = if (!recognized.isNullOrBlank()) {
                                                "Erkannt: ${recognized.take(60)}"
                                            } else {
                                                "Keine Handschrift auf dieser Seite erkannt"
                                            }
                                            Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
                                        }
                                    }
                                }
                            )

                            Box(modifier = Modifier.width(1.dp).height(18.dp).background(Edge))
                        }

                        // Einklapp-Chevron (`▴` / `▾`)
                        IconButton(
                            onClick = {
                                isPillCollapsed = !isPillCollapsed
                                if (isPillCollapsed) {
                                    showStrokeTray = false
                                    showEraserTray = false
                                }
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                imageVector = if (isPillCollapsed) Icons.Default.ExpandMore else Icons.Default.ExpandLess,
                                contentDescription = if (isPillCollapsed) "Werkzeuge ausklappen" else "Werkzeuge einklappen",
                                tint = TextSecondary,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }
            }

            // --- AUSKLAPPBARES SEKUNDÄR-TRAY (`heft-tray`) DIREKT UNTER DER `heft-pill` ---
            AnimatedVisibility(
                visible = !isMobileReadOnly && !isPillCollapsed && showStrokeTray,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = BgPanel.copy(alpha = 0.96f),
                    border = BorderStroke(1.dp, Edge),
                    shadowElevation = 8.dp,
                    modifier = Modifier.padding(top = 6.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        // Zeile 1: 5 Strichstärken-Punkte + 8 Schnellfarben
                        Row(
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            // 5 Strichstärken-Punkte
                            HeftStrokeSizes.forEach { sz ->
                                val isCurrentSize = strokeSize == sz
                                Box(
                                    modifier = Modifier
                                        .size(28.dp)
                                        .clip(CircleShape)
                                        .background(if (isCurrentSize) AccentSoft else BgSidebar)
                                        .border(1.dp, if (isCurrentSize) Accent else EdgeSoft, CircleShape)
                                        .clickable {
                                            strokeSize = sz
                                            if (selectedTool == HeftTool.PEN) {
                                                penSlots[activePenSlotIndex] = penSlots[activePenSlotIndex].copy(size = sz)
                                            }
                                        },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size((sz * 2.0f).coerceIn(4f, 18f).dp)
                                            .clip(CircleShape)
                                            .background(if (isCurrentSize) Accent else TextPrimary)
                                    )
                                }
                            }

                            Box(modifier = Modifier.width(1.dp).height(20.dp).background(Edge))

                            // 8 Schnellfarben
                            HeftQuickColors.forEach { hex ->
                                val parsed = remember(hex) {
                                    Color(android.graphics.Color.parseColor(hex))
                                }
                                val isCurrentColor = activeColor.equals(hex, ignoreCase = true)
                                Box(
                                    modifier = Modifier
                                        .size(26.dp)
                                        .clip(CircleShape)
                                        .background(parsed)
                                        .border(
                                            width = if (isCurrentColor) 2.5.dp else 1.dp,
                                            color = if (isCurrentColor) Accent else Edge,
                                            shape = CircleShape
                                        )
                                        .clickable {
                                            if (selectedTool == HeftTool.MARKER) {
                                                markerColor = hex
                                            } else {
                                                penColor = hex
                                                if (selectedTool == HeftTool.PEN) {
                                                    penSlots[activePenSlotIndex] = penSlots[activePenSlotIndex].copy(color = hex)
                                                }
                                            }
                                        }
                                )
                            }
                        }

                        // Zeile 2: Schalter `✍️ Nur Stift zeichnet (Handballen-Schutz)`
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .clickable {
                                    stylusOnlyMode = !stylusOnlyMode
                                    heftPrefs.edit().putBoolean("stylus_only", stylusOnlyMode).apply()
                                }
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Checkbox(
                                checked = stylusOnlyMode,
                                onCheckedChange = {
                                    stylusOnlyMode = it
                                    heftPrefs.edit().putBoolean("stylus_only", it).apply()
                                },
                                modifier = Modifier.size(18.dp)
                            )
                            Text(
                                text = "✍️ Nur Stift zeichnet (Handballen-Schutz)",
                                color = TextSecondary,
                                fontSize = 12.sp
                            )
                        }
                    }
                }
            }

            // --- RADIERER-TRAY (Größen S/M/L + Ganze Seite leeren) ---
            AnimatedVisibility(
                visible = !isMobileReadOnly && !isPillCollapsed && showEraserTray,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = BgPanel.copy(alpha = 0.96f),
                    border = BorderStroke(1.dp, Edge),
                    shadowElevation = 8.dp,
                    modifier = Modifier.padding(top = 6.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listOf("S", "M", "L").forEach { mode ->
                            Surface(
                                shape = ImpalaPillShape,
                                color = if (eraserSizeMode == mode) AccentSoft else BgSidebar,
                                border = BorderStroke(1.dp, if (eraserSizeMode == mode) Accent else EdgeSoft),
                                modifier = Modifier
                                    .clip(ImpalaPillShape)
                                    .clickable { eraserSizeMode = mode }
                            ) {
                                Text(
                                    text = "Radierer $mode",
                                    color = if (eraserSizeMode == mode) Accent else TextSecondary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                                )
                            }
                        }

                        Surface(
                            shape = ImpalaPillShape,
                            color = Color(0x24E97366),
                            border = BorderStroke(1.dp, Danger),
                            modifier = Modifier
                                .clip(ImpalaPillShape)
                                .clickable {
                                    showEraserTray = false
                                    currentPageData?.let { data ->
                                        val allIds = data.strokes.map { it.id }
                                        if (allIds.isNotEmpty()) {
                                            scope.launch(Dispatchers.IO) {
                                                try {
                                                    core.heftRemoveStrokes(pageId, data.id, allIds)
                                                    val updated = core.heftPage(pageId, data.id)
                                                    withContext(Dispatchers.Main) {
                                                        currentPageData = updated
                                                        onMutation()
                                                    }
                                                } catch (_: Exception) {}
                                            }
                                        }
                                    }
                                }
                        ) {
                            Text(
                                text = "Ganze Seite leeren",
                                color = Danger,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                            )
                        }
                    }
                }
            }

            // --- LASSO-AKTIONSLEISTE ---
            AnimatedVisibility(
                visible = selectedStrokeIds.isNotEmpty(),
                enter = fadeIn() + slideInVertically { -it },
                exit = fadeOut() + slideOutVertically { -it },
                modifier = Modifier.padding(top = 6.dp)
            ) {
                Surface(
                    shape = ImpalaPillShape,
                    color = BgPanel.copy(alpha = 0.96f),
                    shadowElevation = 8.dp,
                    border = BorderStroke(1.dp, AccentBorder)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = "${selectedStrokeIds.size} Striche ausgewählt",
                            fontSize = 12.sp,
                            color = Accent,
                            fontWeight = FontWeight.SemiBold
                        )

                        IconButton(
                            onClick = {
                                currentPageData?.let { data ->
                                    scope.launch(Dispatchers.IO) {
                                        try {
                                            val edit = core.heftDuplicateStrokes(pageId, data.id, selectedStrokeIds)
                                            undoStack.add(edit.undo)
                                            val updated = core.heftPage(pageId, data.id)
                                            withContext(Dispatchers.Main) {
                                                currentPageData = updated
                                                selectedStrokeIds = edit.ids
                                            }
                                        } catch (_: Exception) {}
                                    }
                                }
                            },
                            modifier = Modifier.size(30.dp)
                        ) {
                            Icon(Icons.Default.ContentCopy, contentDescription = "Duplizieren", tint = TextPrimary, modifier = Modifier.size(16.dp))
                        }

                        IconButton(
                            onClick = {
                                currentPageData?.let { data ->
                                    scope.launch(Dispatchers.IO) {
                                        try {
                                            core.heftRemoveStrokes(pageId, data.id, selectedStrokeIds)
                                            val updated = core.heftPage(pageId, data.id)
                                            withContext(Dispatchers.Main) {
                                                currentPageData = updated
                                                selectedStrokeIds = emptyList()
                                            }
                                        } catch (_: Exception) {}
                                    }
                                }
                            },
                            modifier = Modifier.size(30.dp)
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = "Löschen", tint = Danger, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
        }

        // Dual Document Scanner Sheet
        if (showScannerSheet && currentPageData != null) {
            DualDocumentScannerSheet(
                pageId = pageId,
                heftPageId = currentPageData!!.id,
                core = core,
                onDismiss = { showScannerSheet = false },
                onScanComplete = {
                    val curId = currentPageData!!.id
                    scope.launch(Dispatchers.IO) {
                        val updated = core.heftPage(pageId, curId)
                        withContext(Dispatchers.Main) {
                            currentPageData = updated
                            onMutation()
                        }
                    }
                }
            )
        }

        // Dialog: Heft umbenennen
        if (showRenameDialog) {
            AlertDialog(
                onDismissRequest = { showRenameDialog = false },
                containerColor = BgPanel,
                title = { Text("Heft umbenennen", color = TextPrimary) },
                text = {
                    OutlinedTextField(
                        value = renameInput,
                        onValueChange = { renameInput = it },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = Accent,
                            unfocusedBorderColor = Edge
                        )
                    )
                },
                confirmButton = {
                    Button(
                        onClick = {
                            val newName = renameInput.trim().ifEmpty { "Heft" }
                            heftTitle = newName
                            showRenameDialog = false
                            scope.launch(Dispatchers.IO) {
                                try {
                                    core.updatePage(pageId, newName, null)
                                    onMutation()
                                } catch (_: Exception) {}
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Accent)
                    ) {
                        Text("Speichern", color = Color(0xFF081018))
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showRenameDialog = false }) {
                        Text("Abbrechen", color = TextSecondary)
                    }
                }
            )
        }

        // Dialog: Textfeld einfügen
        if (showTextDialog && currentPageData != null) {
            AlertDialog(
                onDismissRequest = { showTextDialog = false },
                containerColor = BgPanel,
                title = { Text("Textfeld einfügen", color = TextPrimary) },
                text = {
                    OutlinedTextField(
                        value = newTextValue,
                        onValueChange = { newTextValue = it },
                        placeholder = { Text("Notiz eingeben…", color = TextMuted) },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = Accent,
                            unfocusedBorderColor = Edge
                        )
                    )
                },
                confirmButton = {
                    Button(
                        onClick = {
                            if (newTextValue.isNotBlank()) {
                                val txt = newTextValue
                                newTextValue = ""
                                showTextDialog = false
                                scope.launch(Dispatchers.IO) {
                                    try {
                                        val edit = core.heftAddText(
                                            pageId = pageId,
                                            heftPageId = currentPageData!!.id,
                                            text = txt,
                                            x = 100.0,
                                            y = 150.0,
                                            w = 500.0,
                                            color = "#1f2937",
                                            size = 18.0
                                        )
                                        undoStack.add(edit.undo)
                                        val updated = core.heftPage(pageId, currentPageData!!.id)
                                        withContext(Dispatchers.Main) { currentPageData = updated }
                                    } catch (_: Exception) {}
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Accent)
                    ) {
                        Text("Einfügen", color = Color(0xFF081018))
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showTextDialog = false }) {
                        Text("Abbrechen", color = TextSecondary)
                    }
                }
            )
        }

        // Seiten-Miniatur-Grid-Popup (`1 / N`)
        if (showPageGridDialog) {
            Dialog(onDismissRequest = { showPageGridDialog = false }) {
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = BgPanel,
                    border = BorderStroke(1.dp, Edge),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Heft-Seiten (${pageIds.size})",
                                fontSize = 17.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextPrimary
                            )
                            Surface(
                                shape = ImpalaPillShape,
                                color = AccentSoft,
                                border = BorderStroke(1.dp, AccentBorder),
                                modifier = Modifier
                                    .clip(ImpalaPillShape)
                                    .clickable {
                                        scope.launch(Dispatchers.IO) {
                                            val currentPaper = currentPageData?.paper ?: HeftPaper.LINED.id
                                            val newId = core.heftAddPage(pageId, pageIds.size.toUInt(), currentPaper)
                                            onMutation()
                                            withContext(Dispatchers.Main) {
                                                loadPages(newId)
                                                showPageGridDialog = false
                                            }
                                        }
                                    }
                            ) {
                                Text(
                                    text = "+ Seite anhängen",
                                    color = Accent,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                                )
                            }
                        }

                        LazyVerticalGrid(
                            columns = GridCells.Adaptive(minSize = 86.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier.heightIn(max = 320.dp)
                        ) {
                            itemsIndexed(pageIds) { index, pid ->
                                val isCurrent = index == currentPageIndex
                                Surface(
                                    shape = RoundedCornerShape(10.dp),
                                    color = if (isCurrent) AccentSoft else BgSidebar,
                                    border = BorderStroke(if (isCurrent) 2.dp else 1.dp, if (isCurrent) Accent else EdgeSoft),
                                    modifier = Modifier
                                        .height(116.dp)
                                        .clip(RoundedCornerShape(10.dp))
                                        .clickable {
                                            currentPageIndex = index
                                            loadPages(pid)
                                            showPageGridDialog = false
                                        }
                                ) {
                                    Box(modifier = Modifier.fillMaxSize()) {
                                        Text(
                                            text = "${index + 1}",
                                            fontSize = 20.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = if (isCurrent) Accent else TextPrimary,
                                            modifier = Modifier.align(Alignment.Center)
                                        )
                                        if (pageIds.size > 1) {
                                            IconButton(
                                                onClick = {
                                                    scope.launch(Dispatchers.IO) {
                                                        try {
                                                            core.heftRemovePage(pageId, pid)
                                                            onMutation()
                                                            withContext(Dispatchers.Main) {
                                                                loadPages()
                                                            }
                                                        } catch (_: Exception) {}
                                                    }
                                                },
                                                modifier = Modifier
                                                    .align(Alignment.TopEnd)
                                                    .size(26.dp)
                                            ) {
                                                Icon(
                                                    Icons.Default.Delete,
                                                    contentDescription = "Seite löschen",
                                                    tint = Danger,
                                                    modifier = Modifier.size(14.dp)
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            TextButton(onClick = { showPageGridDialog = false }) {
                                Text("Schließen", color = TextSecondary)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Zeichnet dezente Vorlagen-Linien für Cornell-Notizen, Musiknoten und Wochenplan sowie
 * eine sanfte Papier-Farbtönung über die Heftseite.
 */
@Composable
private fun ExtendedPaperOverlay(
    extendedPaper: ExtendedPaperType,
    paperTint: PaperTint
) {
    ComposeCanvas(modifier = Modifier.fillMaxSize()) {
        // Dezente Papier-Tönung
        when (paperTint) {
            PaperTint.CREAM -> drawRect(Color(0x14F5E6C8))
            PaperTint.DARK -> drawRect(Color(0x38000000))
            PaperTint.WHITE -> {}
        }

        val lineColor = Color(0x446B8CAE)
        val w = size.width
        val h = size.height

        when (extendedPaper) {
            ExtendedPaperType.CORNELL -> {
                // Kopflinie oben, linke Spaltenlinie, untere Zusammenfassungslinie
                val topY = h * 0.14f
                val bottomY = h * 0.82f
                val leftX = w * 0.30f
                drawLine(lineColor, Offset(w * 0.06f, topY), Offset(w * 0.94f, topY), strokeWidth = 2.5f)
                drawLine(lineColor, Offset(leftX, topY), Offset(leftX, bottomY), strokeWidth = 2.5f)
                drawLine(lineColor, Offset(w * 0.06f, bottomY), Offset(w * 0.94f, bottomY), strokeWidth = 2.5f)
            }
            ExtendedPaperType.MUSIC -> {
                // 5er-Notenlinien-Systeme
                val staves = 6
                val startY = h * 0.15f
                val staffGap = (h * 0.75f) / staves
                val lineSpacing = 9.dp.toPx()
                for (s in 0 until staves) {
                    val base = startY + s * staffGap
                    for (l in 0 until 5) {
                        val y = base + l * lineSpacing
                        drawLine(lineColor, Offset(w * 0.08f, y), Offset(w * 0.92f, y), strokeWidth = 1.4f)
                    }
                }
            }
            ExtendedPaperType.PLANNER -> {
                // Wochenplan-Raster (2 Spalten x 4 Zeilen)
                val padX = w * 0.07f
                val padY = h * 0.12f
                val gridW = w - 2 * padX
                val gridH = h * 0.78f
                for (r in 0..4) {
                    val y = padY + (gridH / 4f) * r
                    drawLine(lineColor, Offset(padX, y), Offset(padX + gridW, y), strokeWidth = 2f)
                }
                for (c in 0..2) {
                    val x = padX + (gridW / 2f) * c
                    drawLine(lineColor, Offset(x, padY), Offset(x, padY + gridH), strokeWidth = 2f)
                }
            }
            else -> {}
        }
    }
}

@Composable
private fun PillToolButton(
    icon: ImageVector,
    label: String,
    isSelected: Boolean,
    activeColor: Color = Accent,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(34.dp)
            .clip(CircleShape)
            .background(if (isSelected) activeColor.copy(alpha = 0.22f) else Color.Transparent)
            .border(
                width = if (isSelected) 1.dp else 0.dp,
                color = if (isSelected) activeColor else Color.Transparent,
                shape = CircleShape
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = if (isSelected) activeColor else TextSecondary,
            modifier = Modifier.size(19.dp)
        )
    }
}

private fun exportPdf(
    context: Context,
    pageId: String,
    heftTitle: String,
    pageIds: List<String>,
    core: ImpalaCore,
    onComplete: () -> Unit
) {
    val scope = kotlinx.coroutines.CoroutineScope(Dispatchers.IO)
    scope.launch {
        try {
            val pdfPages = mutableListOf<HeftPdfPage>()
            val w = 1588
            val h = 2246

            for (pid in pageIds) {
                core.heftPage(pageId, pid)
                val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)
                canvas.drawColor(android.graphics.Color.WHITE)

                val stream = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG, 88, stream)
                val jpegBytes = stream.toByteArray()

                pdfPages.add(
                    HeftPdfPage(
                        jpeg = jpegBytes,
                        width = w.toUInt(),
                        height = h.toUInt()
                    )
                )
            }

            val pdfBytes = heftBuildPdf(pdfPages)
            val exportFileName = "${heftExportFileName(heftTitle)}.pdf"
            val cacheFile = File(context.cacheDir, exportFileName)
            cacheFile.writeBytes(pdfBytes)

            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                cacheFile
            )

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            withContext(Dispatchers.Main) {
                onComplete()
                context.startActivity(Intent.createChooser(shareIntent, "Heft als PDF teilen"))
            }
        } catch (e: Exception) {
            withContext(Dispatchers.Main) {
                onComplete()
                Toast.makeText(context, "PDF-Export fehlgeschlagen: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
