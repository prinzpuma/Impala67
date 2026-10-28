package org.impala67.app.ui.heft

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.data.ImpalaRepository
import uniffi.impala_ffi.*
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Farb-Paletten-Optionen für Stift und Marker.
 */
val HeftPenColors = listOf(
    "#1f2937", // Schwarz/Dunkelgrau
    "#2563eb", // Blau
    "#dc2626", // Rot
    "#16a34a", // Grün
    "#9333ea"  // Violett
)

val HeftMarkerColors = listOf(
    "#facc15", // Textmarker Gelb
    "#4ade80", // Textmarker Grün
    "#f472b6", // Textmarker Pink
    "#38bdf8"  // Textmarker Cyan
)

val HeftSizes = listOf(1.5f, 2.5f, 4.0f, 6.5f)

/**
 * Haupt-Composable der nativen Heft-Ansicht (Notizbuch, Handschrift & Zeichnen).
 * Unterstützt Jetpack Ink, ML Kit Digital Ink Recognition, Undo/Redo,
 * Seitenverwaltung, Dual-Scanner und PDF-/SVG-Export.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HeftScreen(
    pageId: String,
    repository: ImpalaRepository,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Digital Ink OCR Manager
    val ocrManager = remember { DigitalInkOcrManager() }
    DisposableEffect(Unit) {
        onDispose {
            ocrManager.close()
        }
    }

    // Seiten-Zustand
    var pageIds by remember { mutableStateOf<List<String>>(emptyList()) }
    var currentPageIndex by remember { mutableIntStateOf(0) }
    var currentPageData by remember { mutableStateOf<HeftPageData?>(null) }
    var isLoading by remember { mutableStateOf(true) }

    // Werkzeug-Zustand
    var selectedTool by remember { mutableStateOf(HeftTool.PEN) }
    var penColor by remember { mutableStateOf("#1f2937") }
    var markerColor by remember { mutableStateOf("#facc15") }
    var strokeSize by remember { mutableFloatStateOf(2.5f) }
    var showColorMenu by remember { mutableStateOf(false) }
    var showPaperMenu by remember { mutableStateOf(false) }

    // Undo / Redo Stapel
    val undoStack = remember { mutableStateListOf<String>() }
    val redoStack = remember { mutableStateListOf<String>() }

    // Lasso-Auswahl
    var selectedStrokeIds by remember { mutableStateOf<List<String>>(emptyList()) }

    // Scanner-Sheet Dialog
    var showScannerSheet by remember { mutableStateOf(false) }

    // Textfeld hinzufügen Dialog
    var showTextDialog by remember { mutableStateOf(false) }
    var newTextValue by remember { mutableStateOf("") }

    // Seitenübersicht Sheet
    var showPageListSheet by remember { mutableStateOf(false) }

    // Export Dialog
    var isExporting by remember { mutableStateOf(false) }

    // Hilfsfunktion zum Neuladen der Seiten
    fun loadPages(targetPageId: String? = null) {
        scope.launch(Dispatchers.IO) {
            try {
                var ids = repository.core.heftPageIds(pageId)
                if (ids.isEmpty()) {
                    // Neues Heft ohne Seiten -> Initialseite anlegen
                    val firstPageId = repository.core.heftAddPage(pageId, null, HeftPaper.LINED.id)
                    ids = listOf(firstPageId)
                }

                val targetIndex = if (targetPageId != null) {
                    val idx = ids.indexOf(targetPageId)
                    if (idx >= 0) idx else 0
                } else {
                    currentPageIndex.coerceIn(0, ids.size - 1)
                }

                val currentId = ids[targetIndex]
                val data = repository.core.heftPage(pageId, currentId)

                withContext(Dispatchers.Main) {
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

    // Initiales Laden
    LaunchedEffect(pageId) {
        loadPages()
    }

    // Reaktive Aktualisierung bei Änderungen im Rust-Kern
    LaunchedEffect(pageId) {
        repository.changesFlow.collect { changes ->
            if (changes.everything || changes.hefte.contains(pageId) || changes.heftImages.isNotEmpty()) {
                val currentId = pageIds.getOrNull(currentPageIndex)
                loadPages(currentId)
            }
        }
    }

    val activeColor = when (selectedTool) {
        HeftTool.MARKER -> markerColor
        else -> penColor
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = Color(0xFF141518),
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertCenter) {
                        Text(
                            text = if (pageIds.isNotEmpty()) "Seite ${currentPageIndex + 1} / ${pageIds.size}" else "Heft",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White
                        )
                        IconButton(onClick = { showPageListSheet = true }) {
                            Icon(
                                Icons.Default.ViewCarousel,
                                contentDescription = "Seitenübersicht",
                                tint = Color(0xADFFFFFF)
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Zurück",
                            tint = Color.White
                        )
                    }
                },
                actions = {
                    // Undo
                    IconButton(
                        onClick = {
                            val undoOps = undoStack.removeLastOrNull()
                            if (undoOps != null) {
                                scope.launch(Dispatchers.IO) {
                                    try {
                                        val edit = repository.core.heftApplyOps(pageId, undoOps)
                                        if (edit.undo.isNotEmpty()) {
                                            redoStack.add(edit.undo)
                                        }
                                        val currentId = pageIds.getOrNull(currentPageIndex)
                                        if (currentId != null) {
                                            val updated = repository.core.heftPage(pageId, currentId)
                                            withContext(Dispatchers.Main) {
                                                currentPageData = updated
                                            }
                                        }
                                    } catch (_: Exception) {}
                                }
                            }
                        },
                        enabled = undoStack.isNotEmpty()
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Undo,
                            contentDescription = "Rückgängig",
                            tint = if (undoStack.isNotEmpty()) Color.White else Color(0x40FFFFFF)
                        )
                    }

                    // Redo
                    IconButton(
                        onClick = {
                            val redoOps = redoStack.removeLastOrNull()
                            if (redoOps != null) {
                                scope.launch(Dispatchers.IO) {
                                    try {
                                        val edit = repository.core.heftApplyOps(pageId, redoOps)
                                        if (edit.undo.isNotEmpty()) {
                                            undoStack.add(edit.undo)
                                        }
                                        val currentId = pageIds.getOrNull(currentPageIndex)
                                        if (currentId != null) {
                                            val updated = repository.core.heftPage(pageId, currentId)
                                            withContext(Dispatchers.Main) {
                                                currentPageData = updated
                                            }
                                        }
                                    } catch (_: Exception) {}
                                }
                            }
                        },
                        enabled = redoStack.isNotEmpty()
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Redo,
                            contentDescription = "Wiederholen",
                            tint = if (redoStack.isNotEmpty()) Color.White else Color(0x40FFFFFF)
                        )
                    }

                    // Papiermuster wechseln
                    IconButton(onClick = { showPaperMenu = true }) {
                        Icon(
                            Icons.Default.Layers,
                            contentDescription = "Papiermuster",
                            tint = Color.White
                        )
                    }
                    DropdownMenu(
                        expanded = showPaperMenu,
                        onDismissRequest = { showPaperMenu = false },
                        containerColor = Color(0xFF2C2E33)
                    ) {
                        DropdownMenuItem(
                            text = { Text("Liniert", color = Color.White) },
                            onClick = {
                                showPaperMenu = false
                                currentPageData?.let { data ->
                                    scope.launch(Dispatchers.IO) {
                                        val edit = repository.core.heftSetPaper(pageId, data.id, HeftPaper.LINED.id)
                                        undoStack.add(edit.undo)
                                        val updated = repository.core.heftPage(pageId, data.id)
                                        withContext(Dispatchers.Main) { currentPageData = updated }
                                    }
                                }
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Kariert", color = Color.White) },
                            onClick = {
                                showPaperMenu = false
                                currentPageData?.let { data ->
                                    scope.launch(Dispatchers.IO) {
                                        val edit = repository.core.heftSetPaper(pageId, data.id, HeftPaper.GRID.id)
                                        undoStack.add(edit.undo)
                                        val updated = repository.core.heftPage(pageId, data.id)
                                        withContext(Dispatchers.Main) { currentPageData = updated }
                                    }
                                }
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Punktiert", color = Color.White) },
                            onClick = {
                                showPaperMenu = false
                                currentPageData?.let { data ->
                                    scope.launch(Dispatchers.IO) {
                                        val edit = repository.core.heftSetPaper(pageId, data.id, HeftPaper.DOTS.id)
                                        undoStack.add(edit.undo)
                                        val updated = repository.core.heftPage(pageId, data.id)
                                        withContext(Dispatchers.Main) { currentPageData = updated }
                                    }
                                }
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Blanko", color = Color.White) },
                            onClick = {
                                showPaperMenu = false
                                currentPageData?.let { data ->
                                    scope.launch(Dispatchers.IO) {
                                        val edit = repository.core.heftSetPaper(pageId, data.id, HeftPaper.BLANK.id)
                                        undoStack.add(edit.undo)
                                        val updated = repository.core.heftPage(pageId, data.id)
                                        withContext(Dispatchers.Main) { currentPageData = updated }
                                    }
                                }
                            }
                        )
                    }

                    // PDF- / SVG-Export
                    IconButton(
                        onClick = {
                            if (!isExporting) {
                                isExporting = true
                                exportPdf(context, pageId, pageIds, repository) {
                                    isExporting = false
                                }
                            }
                        }
                    ) {
                        if (isExporting) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color(0xFF6B8CAE))
                        } else {
                            Icon(Icons.Default.Share, contentDescription = "Exportieren", tint = Color.White)
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF1E2024)
                )
            )
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            if (isLoading) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Color(0xFF6B8CAE))
                }
            } else if (currentPageData != null) {
                // Der Haupt-Zeichencanvas
                JetpackInkCanvas(
                    pageId = pageId,
                    heftPageId = currentPageData!!.id,
                    pageData = currentPageData!!,
                    core = repository.core,
                    selectedTool = selectedTool,
                    strokeColor = activeColor,
                    strokeSize = strokeSize,
                    ocrManager = ocrManager,
                    onUndoStackChanged = { undoJson ->
                        if (!undoJson.isNullOrEmpty()) {
                            undoStack.add(undoJson)
                            redoStack.clear()
                        }
                        val curId = pageIds.getOrNull(currentPageIndex)
                        if (curId != null) {
                            scope.launch(Dispatchers.IO) {
                                val updated = repository.core.heftPage(pageId, curId)
                                withContext(Dispatchers.Main) { currentPageData = updated }
                            }
                        }
                    },
                    onSelectedStrokesChanged = { selected ->
                        selectedStrokeIds = selected
                    }
                )
            }

            // Lasso-Aktionsleiste bei aktiver Auswahl
            AnimatedVisibility(
                visible = selectedStrokeIds.isNotEmpty(),
                enter = fadeIn() + slideInVertically { -it },
                exit = fadeOut() + slideOutVertically { -it },
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 16.dp)
            ) {
                Surface(
                    shape = RoundedCornerShape(24.dp),
                    color = Color(0xFF2C2E33),
                    shadowElevation = 8.dp,
                    border = BorderStroke(1.dp, Color(0x30FFFFFF))
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertCenter,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = "${selectedStrokeIds.size} Striche",
                            fontSize = 13.sp,
                            color = Color(0xADFFFFFF),
                            modifier = Modifier.padding(horizontal = 6.dp)
                        )

                        // Duplizieren
                        IconButton(
                            onClick = {
                                currentPageData?.let { data ->
                                    scope.launch(Dispatchers.IO) {
                                        val edit = repository.core.heftDuplicateStrokes(pageId, data.id, selectedStrokeIds)
                                        undoStack.add(edit.undo)
                                        val updated = repository.core.heftPage(pageId, data.id)
                                        withContext(Dispatchers.Main) {
                                            currentPageData = updated
                                            selectedStrokeIds = edit.ids
                                        }
                                    }
                                }
                            }
                        ) {
                            Icon(Icons.Default.ContentCopy, contentDescription = "Duplizieren", tint = Color.White)
                        }

                        // Löschen
                        IconButton(
                            onClick = {
                                currentPageData?.let { data ->
                                    scope.launch(Dispatchers.IO) {
                                        repository.core.heftRemoveStrokes(pageId, data.id, selectedStrokeIds)
                                        val updated = repository.core.heftPage(pageId, data.id)
                                        withContext(Dispatchers.Main) {
                                            currentPageData = updated
                                            selectedStrokeIds = emptyList()
                                        }
                                    }
                                }
                            }
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = "Löschen", tint = Color(0xFFE97366))
                        }
                    }
                }
            }

            // Expressive Werkzeugpalette am unteren Rand
            Surface(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 20.dp, start = 16.dp, end = 16.dp),
                shape = RoundedCornerShape(32.dp),
                color = Color(0xFF1E2024).copy(alpha = 0.95f),
                shadowElevation = 12.dp,
                border = BorderStroke(1.dp, Color(0x24FFFFFF))
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(8.dp)
                ) {
                    // Farbauswahl & Strichstärken (aufklappbar)
                    AnimatedVisibility(visible = showColorMenu) {
                        Column(
                            modifier = Modifier.padding(bottom = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            // Farb-Palette
                            val colors = if (selectedTool == HeftTool.MARKER) HeftMarkerColors else HeftPenColors
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertCenter
                            ) {
                                colors.forEach { hex ->
                                    val c = Color(android.graphics.Color.parseColor(hex))
                                    Box(
                                        modifier = Modifier
                                            .size(28.dp)
                                            .clip(CircleShape)
                                            .background(c)
                                            .border(
                                                width = if (activeColor == hex) 2.5.dp else 0.dp,
                                                color = Color.White,
                                                shape = CircleShape
                                            )
                                            .clickable {
                                                if (selectedTool == HeftTool.MARKER) {
                                                    markerColor = hex
                                                } else {
                                                    penColor = hex
                                                }
                                            }
                                    )
                                }
                            }

                            // Strichstärken
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertCenter
                            ) {
                                HeftSizes.forEach { sz ->
                                    Box(
                                        modifier = Modifier
                                            .size(28.dp)
                                            .clip(CircleShape)
                                            .background(if (strokeSize == sz) Color(0xFF6B8CAE) else Color(0xFF2C2E33))
                                            .clickable { strokeSize = sz },
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .size((sz * 2.5).dp)
                                                .clip(CircleShape)
                                                .background(Color.White)
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // Werkzeug-Buttons
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertCenter
                    ) {
                        // Stift
                        ToolIconButton(
                            icon = Icons.Default.Edit,
                            label = "Stift",
                            isSelected = selectedTool == HeftTool.PEN,
                            onClick = {
                                if (selectedTool == HeftTool.PEN) {
                                    showColorMenu = !showColorMenu
                                } else {
                                    selectedTool = HeftTool.PEN
                                }
                            }
                        )

                        // Textmarker
                        ToolIconButton(
                            icon = Icons.Default.Highlight,
                            label = "Marker",
                            isSelected = selectedTool == HeftTool.MARKER,
                            onClick = {
                                if (selectedTool == HeftTool.MARKER) {
                                    showColorMenu = !showColorMenu
                                } else {
                                    selectedTool = HeftTool.MARKER
                                }
                            }
                        )

                        // Formerkennung
                        ToolIconButton(
                            icon = Icons.Default.Category,
                            label = "Formen",
                            isSelected = selectedTool == HeftTool.SHAPE,
                            onClick = { selectedTool = HeftTool.SHAPE }
                        )

                        // Radierer
                        ToolIconButton(
                            icon = Icons.Default.AutoFixNormal,
                            label = "Radierer",
                            isSelected = selectedTool == HeftTool.ERASER,
                            onClick = { selectedTool = HeftTool.ERASER }
                        )

                        // Lasso
                        ToolIconButton(
                            icon = Icons.Default.CropFree,
                            label = "Lasso",
                            isSelected = selectedTool == HeftTool.LASSO,
                            onClick = { selectedTool = HeftTool.LASSO }
                        )

                        // Textfeld
                        ToolIconButton(
                            icon = Icons.Default.TextFields,
                            label = "Text",
                            isSelected = false,
                            onClick = { showTextDialog = true }
                        )

                        // Dual Document Scanner
                        ToolIconButton(
                            icon = Icons.Default.DocumentScanner,
                            label = "Scan",
                            isSelected = false,
                            onClick = { showScannerSheet = true }
                        )

                        // Trennlinie
                        Box(
                            modifier = Modifier
                                .height(24.dp)
                                .width(1.dp)
                                .background(Color(0x30FFFFFF))
                        )

                        // Seite vorherige
                        IconButton(
                            onClick = {
                                if (currentPageIndex > 0) {
                                    currentPageIndex--
                                    loadPages(pageIds[currentPageIndex])
                                }
                            },
                            enabled = currentPageIndex > 0
                        ) {
                            Icon(
                                Icons.Default.ChevronLeft,
                                contentDescription = "Vorherige",
                                tint = if (currentPageIndex > 0) Color.White else Color(0x30FFFFFF)
                            )
                        }

                        // Seite nächste
                        IconButton(
                            onClick = {
                                if (currentPageIndex < pageIds.size - 1) {
                                    currentPageIndex++
                                    loadPages(pageIds[currentPageIndex])
                                }
                            },
                            enabled = currentPageIndex < pageIds.size - 1
                        ) {
                            Icon(
                                Icons.Default.ChevronRight,
                                contentDescription = "Nächste",
                                tint = if (currentPageIndex < pageIds.size - 1) Color.White else Color(0x30FFFFFF)
                            )
                        }

                        // Seite hinzufügen (+)
                        IconButton(
                            onClick = {
                                scope.launch(Dispatchers.IO) {
                                    val currentPaper = currentPageData?.paper ?: HeftPaper.LINED.id
                                    val newId = repository.core.heftAddPage(pageId, (currentPageIndex + 1).toUInt(), currentPaper)
                                    withContext(Dispatchers.Main) {
                                        loadPages(newId)
                                    }
                                }
                            }
                        ) {
                            Icon(Icons.Default.Add, contentDescription = "Neue Seite", tint = Color(0xFF72BC8F))
                        }
                    }
                }
            }

            // Dual Document Scanner Sheet
            if (showScannerSheet && currentPageData != null) {
                DualDocumentScannerSheet(
                    pageId = pageId,
                    heftPageId = currentPageData!!.id,
                    core = repository.core,
                    onDismiss = { showScannerSheet = false },
                    onScanComplete = {
                        val curId = currentPageData!!.id
                        scope.launch(Dispatchers.IO) {
                            val updated = repository.core.heftPage(pageId, curId)
                            withContext(Dispatchers.Main) {
                                currentPageData = updated
                            }
                        }
                    }
                )
            }

            // Dialog für neues Textfeld
            if (showTextDialog && currentPageData != null) {
                AlertDialog(
                    onDismissRequest = { showTextDialog = false },
                    containerColor = Color(0xFF2C2E33),
                    title = { Text("Textfeld einfügen", color = Color.White) },
                    text = {
                        OutlinedTextField(
                            value = newTextValue,
                            onValueChange = { newTextValue = it },
                            placeholder = { Text("Notiz eingeben…", color = Color(0x70FFFFFF)) },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White,
                                focusedBorderColor = Color(0xFF6B8CAE),
                                unfocusedBorderColor = Color(0x30FFFFFF)
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
                                        val edit = repository.core.heftAddText(
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
                                        val updated = repository.core.heftPage(pageId, currentPageData!!.id)
                                        withContext(Dispatchers.Main) { currentPageData = updated }
                                    }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF6B8CAE))
                        ) {
                            Text("Einfügen", color = Color.White)
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { showTextDialog = false }) {
                            Text("Abbrechen", color = Color(0xADFFFFFF))
                        }
                    }
                )
            }

            // Seiten-Navigator Sheet
            if (showPageListSheet) {
                ModalBottomSheet(
                    onDismissRequest = { showPageListSheet = false },
                    containerColor = Color(0xFF1E2024)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Text(
                            text = "Seiten (${pageIds.size})",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )

                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            items(pageIds.indices.toList()) { index ->
                                val pid = pageIds[index]
                                val isCurrent = index == currentPageIndex
                                Card(
                                    onClick = {
                                        currentPageIndex = index
                                        loadPages(pid)
                                        showPageListSheet = false
                                    },
                                    modifier = Modifier
                                        .size(width = 90.dp, height = 130.dp)
                                        .border(
                                            width = if (isCurrent) 2.dp else 1.dp,
                                            color = if (isCurrent) Color(0xFF6B8CAE) else Color(0x20FFFFFF),
                                            shape = RoundedCornerShape(8.dp)
                                        ),
                                    colors = CardDefaults.cardColors(containerColor = Color.White)
                                ) {
                                    Box(
                                        modifier = Modifier.fillMaxSize(),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(
                                            text = "${index + 1}",
                                            fontSize = 20.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = Color.DarkGray
                                        )
                                    }
                                }
                            }
                        }

                        // Seite löschen Button
                        if (pageIds.size > 1 && currentPageData != null) {
                            OutlinedButton(
                                onClick = {
                                    val deleteId = currentPageData!!.id
                                    showPageListSheet = false
                                    scope.launch(Dispatchers.IO) {
                                        repository.core.heftRemovePage(pageId, deleteId)
                                        withContext(Dispatchers.Main) {
                                            loadPages()
                                        }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFE97366))
                            ) {
                                Icon(Icons.Default.Delete, contentDescription = null)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Aktuelle Seite löschen")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolIconButton(
    icon: ImageVector,
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    IconButton(
        onClick = onClick,
        modifier = Modifier
            .size(42.dp)
            .clip(CircleShape)
            .background(if (isSelected) Color(0xFF6B8CAE) else Color.Transparent)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = if (isSelected) Color.White else Color(0xADFFFFFF),
            modifier = Modifier.size(22.dp)
        )
    }
}

/**
 * Rendert alle Heftseiten als hochauflösende A4-JPEGs und erzeugt daraus
 * über die Rust-FFI heftBuildPdf ein kompaktes PDF zum Teilen.
 */
private fun exportPdf(
    context: Context,
    pageId: String,
    pageIds: List<String>,
    repository: ImpalaRepository,
    onComplete: () -> Unit
) {
    val scope = kotlinx.coroutines.CoroutineScope(Dispatchers.IO)
    scope.launch {
        try {
            val pdfPages = mutableListOf<HeftPdfPage>()

            // Jede Seite mit 2-facher Auflösung (1588 x 2246 px) rendern
            val w = 1588
            val h = 2246

            for (pid in pageIds) {
                val pData = repository.core.heftPage(pageId, pid)
                val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)

                // Hintergrund weiß
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

            // FFI PDF Generierung
            val pdfBytes = heftBuildPdf(pdfPages)

            val exportFileName = "${heftExportFileName("Notizen")}.pdf"
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
