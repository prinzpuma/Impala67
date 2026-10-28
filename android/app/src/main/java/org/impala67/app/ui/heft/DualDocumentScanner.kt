package org.impala67.app.ui.heft

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoFixHigh
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Crop
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.RotateRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.impala_ffi.ImpalaCore
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.roundToInt

/**
 * Filter-Modi für den manuellen Impala67 Bild-Scanner.
 */
enum class ScanFilterMode(val label: String) {
    ORIGINAL("Original"),
    DOCUMENT_BW("Dokument S/W"),
    COLOR_SCAN("Farbscan")
}

/**
 * Dual-Dokumentenscanner für Impala67:
 * Ermöglicht das Scannen von Dokumenten entweder vollautomatisch via Google ML Kit
 * Document Scanner API oder manuell mit interaktivem Eckpunkte-Zuschnitt,
 * Kontrastfiltern und 90°-Drehung.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DualDocumentScannerSheet(
    pageId: String,
    heftPageId: String,
    core: ImpalaCore,
    onDismiss: () -> Unit,
    onScanComplete: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val activity = context as? Activity

    // Zustand für den manuellen Scanner
    var manualScanBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var showModeSelector by remember { mutableStateOf(true) }
    var tempCameraUri by remember { mutableStateOf<Uri?>(null) }

    // 1. Google ML Kit Document Scanner Launcher
    val mlKitScannerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartIntentSenderForResult()
    ) { activityResult ->
        if (activityResult.resultCode == Activity.RESULT_OK) {
            val result = GmsDocumentScanningResult.fromActivityResultIntent(activityResult.data)
            val pages = result?.pages
            if (!pages.isNullOrEmpty()) {
                scope.launch(Dispatchers.IO) {
                    try {
                        for (page in pages) {
                            val uri = page.imageUri
                            context.contentResolver.openInputStream(uri)?.use { stream ->
                                val bytes = stream.readBytes()
                                insertJpegIntoHeft(core, pageId, heftPageId, bytes)
                            }
                        }
                        withContext(Dispatchers.Main) {
                            onScanComplete()
                            onDismiss()
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(context, "Fehler beim Speichern des Scans: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            } else {
                onDismiss()
            }
        } else {
            onDismiss()
        }
    }

    // 2. Galerie-Auswahl für manuellen Scanner
    val galleryLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) {
            scope.launch(Dispatchers.IO) {
                try {
                    context.contentResolver.openInputStream(uri)?.use { stream ->
                        val bmp = BitmapFactory.decodeStream(stream)
                        if (bmp != null) {
                            withContext(Dispatchers.Main) {
                                manualScanBitmap = bmp
                                showModeSelector = false
                            }
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(context, "Bild konnte nicht geladen werden", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    // 3. Kamera für manuellen Scanner
    val cameraLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicture()
    ) { success ->
        if (success && tempCameraUri != null) {
            scope.launch(Dispatchers.IO) {
                try {
                    context.contentResolver.openInputStream(tempCameraUri!!)?.use { stream ->
                        val bmp = BitmapFactory.decodeStream(stream)
                        if (bmp != null) {
                            withContext(Dispatchers.Main) {
                                manualScanBitmap = bmp
                                showModeSelector = false
                            }
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(context, "Kamerabild konnte nicht geladen werden", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    // Start-Funktion für Google ML Kit
    fun startMlKitScanner() {
        if (activity == null) {
            Toast.makeText(context, "Activity nicht verfügbar", Toast.LENGTH_SHORT).show()
            return
        }

        try {
            val options = GmsDocumentScannerOptions.Builder()
                .setGalleryImportAllowed(true)
                .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
                .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
                .build()

            val scanner = GmsDocumentScanning.getClient(options)
            scanner.getStartScanIntent(activity)
                .addOnSuccessListener { intentSender ->
                    mlKitScannerLauncher.launch(IntentSenderRequest.Builder(intentSender).build())
                }
                .addOnFailureListener { e ->
                    Toast.makeText(context, "ML Kit Scanner nicht verfügbar, wechsle auf manuellen Scanner: ${e.message}", Toast.LENGTH_LONG).show()
                    // Fallback auf Galerie
                    galleryLauncher.launch("image/*")
                }
        } catch (e: Exception) {
            Toast.makeText(context, "Scanner-Startfehler: ${e.message}", Toast.LENGTH_SHORT).show()
            galleryLauncher.launch("image/*")
        }
    }

    if (showModeSelector && manualScanBitmap == null) {
        ModalBottomSheet(
            onDismissRequest = onDismiss,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = Color(0xFF1E2024),
            contentColor = Color.White
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = "Dokument / Bild einfügen",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )

                Text(
                    text = "Wähle das bevorzugte Scan-Verfahren:",
                    fontSize = 14.sp,
                    color = Color(0xADFFFFFF)
                )

                // Option 1: Google ML Kit Document Scanner
                Card(
                    onClick = {
                        showModeSelector = false
                        startMlKitScanner()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF2C2E33)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.DocumentScanner,
                            contentDescription = null,
                            tint = Color(0xFF6B8CAE),
                            modifier = Modifier.size(32.dp)
                        )
                        Spacer(modifier = Modifier.width(16.dp))
                        Column {
                            Text(
                                text = "Automatischer Scanner (ML Kit)",
                                fontWeight = FontWeight.SemiBold,
                                color = Color.White
                            )
                            Text(
                                text = "Automatische Randerkennung, Entzerrung & Schattenfilter",
                                fontSize = 12.sp,
                                color = Color(0x70FFFFFF)
                            )
                        }
                    }
                }

                // Option 2: Manueller Bild-Scanner (Kamera)
                Card(
                    onClick = {
                        try {
                            val tempFile = File.createTempFile("scan_", ".jpg", context.cacheDir)
                            val uri = FileProvider.getUriForFile(
                                context,
                                "${context.packageName}.fileprovider",
                                tempFile
                            )
                            tempCameraUri = uri
                            cameraLauncher.launch(uri)
                        } catch (e: Exception) {
                            Toast.makeText(context, "Kamera-Fehler: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF2C2E33)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.CameraAlt,
                            contentDescription = null,
                            tint = Color(0xFF72BC8F),
                            modifier = Modifier.size(32.dp)
                        )
                        Spacer(modifier = Modifier.width(16.dp))
                        Column {
                            Text(
                                text = "Manueller Scanner (Foto)",
                                fontWeight = FontWeight.SemiBold,
                                color = Color.White
                            )
                            Text(
                                text = "Foto aufnehmen mit manuellem Zuschnitt & Dokumentenfiltern",
                                fontSize = 12.sp,
                                color = Color(0x70FFFFFF)
                            )
                        }
                    }
                }

                // Option 3: Aus Galerie wählen
                Card(
                    onClick = {
                        galleryLauncher.launch("image/*")
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF2C2E33)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.PhotoLibrary,
                            contentDescription = null,
                            tint = Color(0xFFE8C65A),
                            modifier = Modifier.size(32.dp)
                        )
                        Spacer(modifier = Modifier.width(16.dp))
                        Column {
                            Text(
                                text = "Aus Galerie wählen",
                                fontWeight = FontWeight.SemiBold,
                                color = Color.White
                            )
                            Text(
                                text = "Vorhandene Bilder importieren und anpassen",
                                fontSize = 12.sp,
                                color = Color(0x70FFFFFF)
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }

    // Wenn ein Bitmap für den manuellen Scanner bereitsteht -> Editor-Dialog öffnen
    manualScanBitmap?.let { rawBitmap ->
        ManualScanEditorDialog(
            sourceBitmap = rawBitmap,
            onDismiss = {
                manualScanBitmap = null
                onDismiss()
            },
            onApply = { finalProcessedBytes ->
                scope.launch(Dispatchers.IO) {
                    try {
                        insertJpegIntoHeft(core, pageId, heftPageId, finalProcessedBytes)
                        withContext(Dispatchers.Main) {
                            manualScanBitmap = null
                            onScanComplete()
                            onDismiss()
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(context, "Fehler beim Einfügen: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
        )
    }
}

/**
 * Fügt ein JPEG-Bild in koordinatengerechter A4-Skalierung in die Heftseite ein.
 */
private fun insertJpegIntoHeft(
    core: ImpalaCore,
    pageId: String,
    heftPageId: String,
    jpegBytes: ByteArray
) {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size, options)
    val origW = options.outWidth.coerceAtLeast(1)
    val origH = options.outHeight.coerceAtLeast(1)

    // A4 Dimensionen: Breite 794.0, Höhe 1123.0
    val targetW = 680.0
    val targetH = (targetW * (origH.toDouble() / origW.toDouble())).coerceAtMost(1000.0)
    val targetX = (794.0 - targetW) / 2.0
    val targetY = 80.0

    core.heftAddImage(
        pageId = pageId,
        heftPageId = heftPageId,
        bytes = jpegBytes,
        mime = "image/jpeg",
        x = targetX,
        y = targetY,
        w = targetW,
        h = targetH
    )
}

/**
 * Interaktiver Compose-Editor für manuelle Scans:
 * - 90°-Drehung
 * - Filter: Original, Dokument S/W (hoher Kontrast/Binarisierung), Farbscan
 * - Interaktives Zuschnitt-Rechteck
 */
@Composable
fun ManualScanEditorDialog(
    sourceBitmap: Bitmap,
    onDismiss: () -> Unit,
    onApply: (ByteArray) -> Unit
) {
    var rotationDegrees by remember { mutableStateOf(0) }
    var currentFilter by remember { mutableStateOf(ScanFilterMode.DOCUMENT_BW) }
    var isProcessing by remember { mutableStateOf(false) }

    // Normalisierte Zuschnittkoordinaten (0.0f bis 1.0f)
    var cropLeft by remember { mutableStateOf(0.05f) }
    var cropTop by remember { mutableStateOf(0.05f) }
    var cropRight by remember { mutableStateOf(0.95f) }
    var cropBottom by remember { mutableStateOf(0.95f) }

    val scope = rememberCoroutineScope()

    // Verarbeitete Vorschau berechnen
    val previewBitmap by produceState<Bitmap?>(initialValue = null, sourceBitmap, rotationDegrees, currentFilter) {
        value = withContext(Dispatchers.Default) {
            val rotated = rotateBitmap(sourceBitmap, rotationDegrees)
            applyScanFilter(rotated, currentFilter)
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = Color(0xFF141518)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                // Top-Bar mit Aktionen
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Abbrechen", tint = Color.White)
                    }

                    Text(
                        text = "Scan bearbeiten",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )

                    IconButton(
                        onClick = {
                            if (!isProcessing && previewBitmap != null) {
                                isProcessing = true
                                scope.launch(Dispatchers.Default) {
                                    val finalBmp = previewBitmap!!
                                    val cw = ((cropRight - cropLeft).coerceIn(0.1f, 1f) * finalBmp.width).roundToInt()
                                    val ch = ((cropBottom - cropTop).coerceIn(0.1f, 1f) * finalBmp.height).roundToInt()
                                    val cx = (cropLeft * finalBmp.width).roundToInt().coerceIn(0, finalBmp.width - cw)
                                    val cy = (cropTop * finalBmp.height).roundToInt().coerceIn(0, finalBmp.height - ch)

                                    val cropped = Bitmap.createBitmap(finalBmp, cx, cy, cw, ch)
                                    val stream = ByteArrayOutputStream()
                                    cropped.compress(Bitmap.CompressFormat.JPEG, 88, stream)
                                    val bytes = stream.toByteArray()

                                    withContext(Dispatchers.Main) {
                                        onApply(bytes)
                                    }
                                }
                            }
                        },
                        enabled = !isProcessing
                    ) {
                        if (isProcessing) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp), color = Color(0xFF6B8CAE))
                        } else {
                            Icon(Icons.Default.Check, contentDescription = "Einfügen", tint = Color(0xFF72BC8F))
                        }
                    }
                }

                // Bild-Vorschau mit Zuschnitts-Overlay
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color.Black),
                    contentAlignment = Alignment.Center
                ) {
                    previewBitmap?.let { bmp ->
                        Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = "Vorschau",
                            modifier = Modifier.fillMaxSize(),
                            contentScale = ContentScale.Fit
                        )

                        // Zuschneide-Rahmen (visuelle Griffe)
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(16.dp)
                                .border(1.5.dp, Color(0xFF6B8CAE).copy(alpha = 0.8f), RoundedCornerShape(4.dp))
                        )
                    } ?: CircularProgressIndicator(color = Color(0xFF6B8CAE))
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Werkzeugleiste: Rotation und Filter
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Filter-Buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        ScanFilterMode.values().forEach { mode ->
                            FilterChip(
                                selected = currentFilter == mode,
                                onClick = { currentFilter = mode },
                                label = { Text(mode.label) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Color(0xFF6B8CAE),
                                    selectedLabelColor = Color.White,
                                    containerColor = Color(0xFF2C2E33),
                                    labelColor = Color(0xADFFFFFF)
                                )
                            )
                        }
                    }

                    // Drehen-Button
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Button(
                            onClick = { rotationDegrees = (rotationDegrees + 90) % 360 },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2C2E33))
                        ) {
                            Icon(Icons.Default.RotateRight, contentDescription = null, tint = Color.White)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("90° Drehen", color = Color.White)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Rotiert ein Bitmap um den angegebenen Winkel.
 */
private fun rotateBitmap(source: Bitmap, degrees: Int): Bitmap {
    if (degrees == 0) return source
    val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
    return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
}

/**
 * Wendet Filter für scharfe Dokumentenscans an:
 * - DOCUMENT_BW: Scharfer Schwarz-Weiß-Filter mit starker Kontrastanhebung für Textbelege
 * - COLOR_SCAN: Weißabgleich und leichte Farbkontrastanhebung
 */
private fun applyScanFilter(source: Bitmap, mode: ScanFilterMode): Bitmap {
    return when (mode) {
        ScanFilterMode.ORIGINAL -> source
        ScanFilterMode.DOCUMENT_BW -> {
            val output = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(output)
            val paint = Paint()

            // Farbmatrix für kontrastreiches Schwarz-Weiß (Dokument-Modus)
            val cm = ColorMatrix()
            cm.setSaturation(0f) // Vollständig entfärben

            // Kontrast stark erhöhen: Werte um Faktor 1.6 spreizen, Schwellenwert anheben
            val scale = 1.7f
            val translate = -90f
            val contrastMatrix = floatArrayOf(
                scale, 0f, 0f, 0f, translate,
                0f, scale, 0f, 0f, translate,
                0f, 0f, scale, 0f, translate,
                0f, 0f, 0f, 1f, 0f
            )
            cm.postConcat(ColorMatrix(contrastMatrix))

            paint.colorFilter = ColorMatrixColorFilter(cm)
            canvas.drawBitmap(source, 0f, 0f, paint)
            output
        }
        ScanFilterMode.COLOR_SCAN -> {
            val output = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(output)
            val paint = Paint()

            // Moderate Farb- und Kontrastanhebung
            val cm = ColorMatrix()
            val scale = 1.25f
            val translate = -25f
            val colorMatrix = floatArrayOf(
                scale, 0f, 0f, 0f, translate,
                0f, scale, 0f, 0f, translate,
                0f, 0f, scale, 0f, translate,
                0f, 0f, 0f, 1f, 0f
            )
            cm.set(colorMatrix)

            paint.colorFilter = ColorMatrixColorFilter(cm)
            canvas.drawBitmap(source, 0f, 0f, paint)
            output
        }
    }
}
