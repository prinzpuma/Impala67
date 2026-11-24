package org.impala67.app.heft.scan

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.hardware.display.DisplayManager
import android.net.Uri
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Surface
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.compose.CameraXViewfinder
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceRequest
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.ScanDetection
import uniffi.impala_ffi.scanDetect
import java.time.LocalDate
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Live-Erkennung: Ecken als Bruchteil des Analysebilds (0…1), Seitenverhältnis und Qualität. */
private data class Live(val corners: List<Double>, val aspect: Float, val det: ScanDetection)

/** Qualitätshinweis wie heft-scanner-ui.js `qualityHint`. */
private fun hint(d: ScanDetection?, stable: Int, waiting: Boolean): String = when {
    d == null -> "Kamera wird geprüft…"
    d.full -> "Blatt vollständig ins Bild legen"
    d.check.tooDark -> "Mehr Licht nötig"
    d.check.glare -> "Zu hell / Spiegelung vermeiden"
    d.check.flat -> "Kontrast zu gering"
    d.check.soft -> "Kamera ruhiger halten"
    stable >= STABLE_FRAMES && waiting -> "Aufgenommen · nächstes Blatt hinlegen"
    stable >= STABLE_FRAMES -> "Blatt erkannt · bereit"
    else -> "Dokument wird stabilisiert…"
}

private const val STABLE_FRAMES = 5
private const val AUTO_PAUSE_MS = 1800L

/**
 * Eigener Dokumenten-Scanner (web/heft-scanner-ui.js): Kamera mit Erkennungsrahmen (grün = bereit),
 * Qualitätshinweise, Auto-Scan nach 5 stabilen Bildern, Blitz-Anzeige und Vibration, Taschenlampe,
 * Miniaturen mit Nachbearbeitung, „Als PDF speichern“ und „In Heft einfügen“. Ohne Kamera: Fotos wählen.
 */
@Composable
fun ImpalaScanner(onInsert: (List<ScannedPage>) -> Unit, onToast: (String) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val shots = remember { mutableStateListOf<ScanShot>() }
    var editing by remember { mutableStateOf<Int?>(null) }
    var filter by remember { mutableStateOf(ScanFilter.COLOR) }
    var auto by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var flash by remember { mutableStateOf(false) }
    var hasCamera by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val noCamera = !context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { hasCamera = it }
    LaunchedEffect(Unit) { if (!hasCamera && !noCamera) permission.launch(Manifest.permission.CAMERA) }

    // Ein Arbeits-Thread für alle Scan-Berechnungen: Seiten werden der Reihe nach fertig, und es liegt
    // nie mehr als ein großes Bild gleichzeitig im Speicher – auch wenn man schnell viele Seiten aufnimmt.
    val worker = remember { Dispatchers.Default.limitedParallelism(1) }
    val process: (ScanShot) -> Unit = { s -> scope.launch(worker) { s.ensure() } }
    val addBitmap: (Bitmap) -> Unit = { raw ->
        val f = filter
        scope.launch(worker) {
            val shot = runCatching { ScanShot.of(raw, f) }.getOrNull() ?: return@launch
            withContext(Dispatchers.Main) { shots += shot }
            shot.ensure()
        }
    }
    // Fertige Seiten in Reihenfolge; fehlende werden zuerst berechnet (hinter allem, was schon wartet).
    suspend fun finishedPages(): List<ScannedPage> {
        val list = shots.toList()
        return withContext(worker) { list.mapNotNull { it.ensure(); it.page } }
    }
    val photos = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        scope.launch { uris.forEach { u -> withContext(Dispatchers.IO) { decodeLarge(context, u) }?.let(addBitmap) } }
    }
    val pdf = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        if (uri != null) scope.launch {
            busy = true
            runCatching {
                val pages = finishedPages()
                withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri, "wt")!!.use { writeScanPdf(pages, it) } }
            }.onSuccess { onToast("PDF gespeichert.") }.onFailure { onToast("PDF konnte nicht gespeichert werden.") }
            busy = false
        }
    }
    // Schließen mit noch nicht eingefügten oder gespeicherten Aufnahmen: erst nachfragen (wie die PWA).
    var askClose by remember { mutableStateOf(false) }
    val requestClose = { if (shots.isEmpty()) onClose() else askClose = true }
    BackHandler {
        val i = editing
        if (i == null) requestClose() else { shots.getOrNull(i)?.let(process); editing = null }
    }

    var shootRequest by remember { mutableIntStateOf(0) }
    // Ring um den Auslöser (0 = kein Blatt, 1 = bereit; mit Auto füllt er sich bis zur Aufnahme).
    var readiness by remember { mutableFloatStateOf(0f) }
    val insert: () -> Unit = {
        busy = true
        scope.launch {
            val pages = finishedPages()
            busy = false
            if (pages.isEmpty()) onToast("Keine fertigen Scans zum Einfügen.") else onInsert(pages)
        }
    }
    val ui = ScanUi(
        shots = shots, filter = filter, auto = auto, hasCamera = hasCamera, busy = busy, readiness = readiness,
        // Filter gilt wie in der PWA für neue und vorhandene Seiten.
        onFilter = { f -> filter = f; shots.forEach { s -> if (s.filter != f) { s.filter = f; process(s) } } }, onAuto = { auto = !auto }, onPhotos = { photos.launch("image/*") },
        onShoot = { shootRequest++ }, onPdf = { pdf.launch("scan-${LocalDate.now()}.pdf") }, onInsert = insert,
        onOpen = { editing = it }, onDelete = { shots.removeAt(it) }, onClose = requestClose,
    )

    Dialog(onDismissRequest = requestClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            // movableContentOf: Beim Drehen wandert die Kamera zwischen Zeile und Spalte, ohne neu zu starten.
            val camera = remember { movableContentOf { m: Modifier ->
                Box(m) {
                    if (hasCamera) {
                        CameraPane(auto && editing == null, active = editing == null, shootRequest, onReady = { readiness = it }, onCapture = { bmp ->
                            flash = true
                            vibrate(context)
                            addBitmap(bmp)
                            scope.launch { delay(140); flash = false }
                        }, onToast)
                    } else {
                        Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Kamera nicht verfügbar. Bitte Fotos wählen.", color = Color.White)
                            TextButton({ photos.launch("image/*") }) { Text("Fotos auswählen") }
                        }
                    }
                    if (flash) Box(Modifier.fillMaxSize().background(Color.White.copy(alpha = 0.7f)))
                }
            } }
            // Querformat ist der Normalfall: links Aufnahmen, Mitte Kamera, rechts Leiste mit Auslöser
            // (web/heft-scanner-ui.js). Hochformat: dieselben Teile untereinander. Beim Drehen bleibt alles erhalten.
            BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding()) {
                // Breite der Leiste hier festlegen: maxHeight ist in Row nicht erreichbar (DslMarker).
                val railWidth = if (maxHeight < 430.dp) 208.dp else 232.dp
                if (maxWidth > maxHeight) {
                    Row(Modifier.fillMaxSize()) {
                        ShotStrip(ui, vertical = true, Modifier.width(100.dp).fillMaxHeight())
                        camera(Modifier.weight(1f).fillMaxHeight())
                        ScanRail(ui, Modifier.width(railWidth).fillMaxHeight())
                    }
                } else {
                    Column(Modifier.fillMaxSize()) {
                        ScanHeader(ui.shots.size, ui.onClose, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp))
                        camera(Modifier.weight(1f).fillMaxWidth())
                        ShotStrip(ui, vertical = false, Modifier.fillMaxWidth().height(132.dp))
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally)) {
                            ScanFilter.entries.forEach { f -> RailButton(f.label, ui.filter == f) { ui.onFilter(f) } }
                        }
                        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) { ToolButtons(ui) }
                            if (ui.hasCamera) Shutter(ui.readiness, ui.onShoot) else Box(Modifier.size(68.dp))
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp), horizontalAlignment = Alignment.End) { FinishButtons(ui) }
                        }
                    }
                }
            }
            if (askClose) AlertDialog(
                onDismissRequest = { askClose = false },
                text = { Text(if (shots.size == 1) "1 Scan ist noch nicht gespeichert. Trotzdem schließen?" else "${shots.size} Scans sind noch nicht gespeichert. Trotzdem schließen?") },
                confirmButton = { TextButton({ askClose = false; onClose() }) { Text("Verwerfen", color = Impala.colors.danger) } },
                dismissButton = { TextButton({ askClose = false }) { Text("Weiter scannen") } },
            )
            editing?.let { i ->
                shots.getOrNull(i)?.let { s ->
                    ScanEditor(i, s, onDelete = { shots.removeAt(i); editing = null }) {
                        process(s)
                        editing = null
                    }
                }
            }
        }
    }
}

/** Zustand und Aktionen der Scanner-Bedienung, für Quer- und Hochformat gleich. */
private class ScanUi(
    val shots: List<ScanShot>,
    val filter: ScanFilter,
    val auto: Boolean,
    val hasCamera: Boolean,
    val busy: Boolean,
    val readiness: Float,
    val onFilter: (ScanFilter) -> Unit,
    val onAuto: () -> Unit,
    val onPhotos: () -> Unit,
    val onShoot: () -> Unit,
    val onPdf: () -> Unit,
    val onInsert: () -> Unit,
    val onOpen: (Int) -> Unit,
    val onDelete: (Int) -> Unit,
    val onClose: () -> Unit,
) {
    val canFinish get() = shots.isNotEmpty() && !busy
}

@Composable
private fun ScanHeader(count: Int, onClose: () -> Unit, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Scannen", color = Color.White, fontSize = TextSize.md, fontWeight = FontWeight.SemiBold)
            Text(
                when (count) { 0 -> "Noch keine Seite"; 1 -> "1 Seite"; else -> "$count Seiten" },
                color = Color.White.copy(alpha = 0.55f), fontSize = TextSize.xs2,
            )
        }
        DarkIcon(R.drawable.ic_i_x, "Schließen", onClose)
    }
}

/** Bedienleiste im Querformat: Kopf, Filter 2×2, Auto/Fotos, Auslöser mittig, PDF | Ins Heft. Feste Breite, damit nichts springt. */
@Composable
private fun ScanRail(ui: ScanUi, modifier: Modifier) {
    Column(
        modifier.background(Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.05f), Color.White.copy(alpha = 0.012f)))).verticalScroll(rememberScrollState()).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ScanHeader(ui.shots.size, ui.onClose)
        ScanFilter.entries.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                pair.forEach { f -> RailButton(f.label, ui.filter == f, Modifier.weight(1f)) { ui.onFilter(f) } }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { ToolButtons(ui, Modifier.weight(1f)) }
        Box(Modifier.fillMaxWidth().height(84.dp), contentAlignment = Alignment.Center) {
            if (ui.hasCamera) Shutter(ui.readiness, ui.onShoot)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { FinishButtons(ui, Modifier.weight(1f)) }
    }
}

@Composable
private fun ToolButtons(ui: ScanUi, modifier: Modifier = Modifier) {
    if (ui.hasCamera) RailButton("Auto", ui.auto, modifier, R.drawable.ic_i_zap, onClick = ui.onAuto)
    RailButton("Fotos", false, modifier, R.drawable.ic_i_image, onClick = ui.onPhotos)
}

@Composable
private fun FinishButtons(ui: ScanUi, modifier: Modifier = Modifier) {
    RailButton("PDF", false, modifier, R.drawable.ic_i_file, enabled = ui.canFinish, onClick = ui.onPdf)
    RailButton(if (ui.shots.isEmpty()) "Ins Heft" else "Ins Heft (${ui.shots.size})", true, modifier, R.drawable.ic_i_notebook, enabled = ui.canFinish, onClick = ui.onInsert)
}

/** Knopf der Scanner-Leiste (Filter, Auto, Fotos, Abschluss): aktiv hell, sonst dunkel; mindestens 44 dp hoch. */
@Composable
private fun RailButton(label: String, active: Boolean, modifier: Modifier = Modifier, icon: Int? = null, enabled: Boolean = true, onClick: () -> Unit) {
    val bg = when {
        !enabled -> Color.White.copy(alpha = 0.08f)
        active -> Impala.colors.accent
        else -> Color.White.copy(alpha = 0.14f)
    }
    val fg = when {
        !enabled -> Color.White.copy(alpha = 0.4f)
        active -> Impala.colors.onAccent
        else -> Color.White
    }
    Row(
        modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(14.dp)).background(bg).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            Icon(painterResource(icon), null, Modifier.size(16.dp), tint = fg)
            Spacer(Modifier.width(6.dp))
        }
        Text(label, color = fg, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** Auslöser mit Ring: grau = kein Blatt, grün = bereit; mit Auto füllt sich der Ring bis zur Aufnahme (wie die PWA). */
@Composable
private fun Shutter(readiness: Float, onClick: () -> Unit) {
    val progress by animateFloatAsState(readiness, tween(160), label = "shutter")
    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.93f else 1f, tween(100), label = "shutterPress")
    Canvas(
        Modifier.size(72.dp).graphicsLayer { scaleX = scale; scaleY = scale }.clip(CircleShape)
            .clickable(press, indication = null, onClickLabel = "Seite aufnehmen", onClick = onClick),
    ) {
        val ring = 5.dp.toPx()
        val green = Color(0xFF61D68E)
        if (progress >= 1f) drawCircle(green.copy(alpha = 0.35f), radius = size.minDimension / 2)
        drawCircle(Color.White.copy(alpha = 0.3f), radius = size.minDimension / 2 - ring / 2, style = Stroke(ring))
        drawArc(green, -90f, 360f * progress, useCenter = false, topLeft = Offset(ring / 2, ring / 2), size = Size(size.width - ring, size.height - ring), style = Stroke(ring))
        drawCircle(Color.White, radius = size.minDimension / 2 - ring - 2.dp.toPx())
    }
}

/** Aufnahmen: im Querformat eine Spalte links, im Hochformat eine Zeile; leer mit Platzhalter, feste Größe. */
@Composable
private fun ShotStrip(ui: ScanUi, vertical: Boolean, modifier: Modifier) {
    Box(modifier.background(Color.White.copy(alpha = 0.03f)), contentAlignment = Alignment.Center) {
        if (ui.shots.isEmpty()) {
            Text("Aufnahmen erscheinen hier", Modifier.padding(8.dp), color = Color.White.copy(alpha = 0.45f), fontSize = TextSize.xs2, textAlign = TextAlign.Center)
            return@Box
        }
        val scroll = rememberScrollState()
        // Neue Aufnahme ans Ende scrollen.
        LaunchedEffect(ui.shots.size) { delay(32); scroll.animateScrollTo(scroll.maxValue) }
        val items: @Composable () -> Unit = { ui.shots.forEachIndexed { i, s -> key(s) { Thumb(i, s, { ui.onOpen(i) }) { ui.onDelete(i) } } } }
        if (vertical) {
            Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) { items() }
        } else {
            Row(Modifier.fillMaxSize().horizontalScroll(scroll).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { items() }
        }
    }
}

/** Kamera mit Vorschau, Analyse (Erkennungsrahmen) und Auslöser; Taschenlampe, wenn das Gerät eine hat. */
@Composable
private fun CameraPane(auto: Boolean, active: Boolean, shootRequest: Int, onReady: (Float) -> Unit, onCapture: (Bitmap) -> Unit, onToast: (String) -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var request by remember { mutableStateOf<SurfaceRequest?>(null) }
    var live by remember { mutableStateOf<Live?>(null) }
    var stable by remember { mutableStateOf(0) }
    var camera by remember { mutableStateOf<Camera?>(null) }
    var torch by remember { mutableStateOf(false) }
    var lastShot by remember { mutableStateOf(0L) }
    // Nach einer Aufnahme erst wieder auslösen, wenn das Blatt kurz aus dem Bild war (wie `autoArmed` der PWA).
    var armed by remember { mutableStateOf(true) }
    var missing by remember { mutableStateOf(0) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val analyzing = remember { AtomicBoolean(true) }
    SideEffect { analyzing.set(active) }
    val capture = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build() }
    val preview = remember { Preview.Builder().build() }
    val analysis = remember {
        ImageAnalysis.Builder()
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
    }
    // Die Activity bleibt beim Drehen bestehen (configChanges im Manifest): Vorschau, Analyse und Aufnahme
    // folgen der Bildschirmdrehung deshalb selbst.
    val rotation = rememberDisplayRotation()
    LaunchedEffect(rotation) {
        preview.targetRotation = rotation
        analysis.targetRotation = rotation
        capture.targetRotation = rotation
        // Während der Drehung liefert die Analyse Bilder in alter und neuer Lage: Erkennung neu
        // beginnen und Auto-Scan gut 1 s pausieren, damit kein Bild mitten im Drehen ausgelöst wird.
        stable = 0
        lastShot = max(lastShot, System.currentTimeMillis() - AUTO_PAUSE_MS + 1200)
    }
    var shooting by remember { mutableStateOf(false) }
    val shoot = {
        if (!shooting) {
            shooting = true
            capture.takePicture(executor, object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    // Gleich auf die Arbeitsgröße bringen und drehen (ein Schritt): das volle Sensorbild
                    // wird sofort wieder frei, statt bis zur Aufbereitung im Speicher zu liegen.
                    val bmp = image.use { it.toBitmap().scaledRotated(SCAN_SOURCE_EDGE, it.imageInfo.rotationDegrees) }
                    ContextCompat.getMainExecutor(context).execute { shooting = false; lastShot = System.currentTimeMillis(); stable = 0; armed = false; onCapture(bmp) }
                }
                override fun onError(exception: ImageCaptureException) {
                    ContextCompat.getMainExecutor(context).execute { shooting = false; onToast("Aufnahme fehlgeschlagen.") }
                }
            })
        }
    }
    DisposableEffect(owner) {
        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        future.addListener({
            provider = future.get()
            preview.setSurfaceProvider { request = it }
            var lastRun = 0L
            analysis.setAnalyzer(executor) { proxy ->
                proxy.use { p ->
                    val now = System.currentTimeMillis()
                    // Während der Nachbearbeitung ruht die Erkennung (spart Akku und Rechenzeit).
                    if (!analyzing.get() || now - lastRun < 180) return@use
                    lastRun = now
                    // Analysebild klein gedreht und gleich wieder freigegeben: läuft ~5× je Sekunde.
                    val bmp = p.toBitmap().scaledRotated(640, p.imageInfo.rotationDegrees)
                    val w = bmp.width.toFloat()
                    val h = bmp.height.toFloat()
                    val det = runCatching { scanDetect(bmp.toScanImage(640)) }.getOrNull()
                    bmp.recycle()
                    if (det == null) return@use
                    val norm = det.corners.mapIndexed { i, v -> if (i % 2 == 0) v / w else v / h }
                    ContextCompat.getMainExecutor(context).execute {
                        val prev = live?.corners
                        val ok = !det.full && !det.check.tooDark && !det.check.glare && !det.check.flat && !det.check.soft
                        stable = if (ok && prev != null && norm.zip(prev).all { (a, b) -> abs(a - b) < 0.02 }) stable + 1 else 0
                        missing = if (det.full) missing + 1 else 0
                        if (missing >= 3) armed = true
                        live = Live(norm, w / h, det)
                    }
                }
            }
            runCatching {
                provider?.unbindAll()
                camera = provider?.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis, capture)
            }.onFailure { onToast("Kamera nicht verfügbar. Bitte Foto wählen.") }
        }, ContextCompat.getMainExecutor(context))
        onDispose { provider?.unbindAll(); executor.shutdown() }
    }
    // Auslöser sitzt in der Bedienleiste (ImpalaScanner) und meldet sich hier über den Zähler.
    LaunchedEffect(shootRequest) { if (shootRequest > 0) shoot() }
    // Auto-Scan: nach 5 stabilen, brauchbaren Bildern auslösen, danach 1,8 s Pause und neues Blatt abwarten.
    LaunchedEffect(stable, auto, armed) {
        onReady(if (auto && armed) min(1f, stable / STABLE_FRAMES.toFloat()) else if (stable >= STABLE_FRAMES) 1f else 0f)
        if (auto && armed && stable >= STABLE_FRAMES && System.currentTimeMillis() - lastShot > AUTO_PAUSE_MS) shoot()
    }
    Box(Modifier.fillMaxSize()) {
        request?.let { CameraXViewfinder(surfaceRequest = it, modifier = Modifier.fillMaxSize()) }
        val l = live
        val ready = stable >= STABLE_FRAMES
        if (l != null && !l.det.full) Canvas(Modifier.fillMaxSize()) {
            // Vorschau füllt den Bereich (zentriert beschnitten) – gleiche Abbildung für den Rahmen.
            val viewAspect = size.width / size.height
            val (bw, bh) = if (l.aspect > viewAspect) size.height * l.aspect to size.height else size.width to size.width / l.aspect
            val ox = (size.width - bw) / 2
            val oy = (size.height - bh) / 2
            val pts = (0 until 4).map { Offset(ox + (l.corners[it * 2] * bw).toFloat(), oy + (l.corners[it * 2 + 1] * bh).toFloat()) }
            val path = Path().apply { moveTo(pts[0].x, pts[0].y); pts.drop(1).forEach { lineTo(it.x, it.y) }; close() }
            val color = if (ready) Color(0xFF61D68E) else Color(0xFFE8C65A)
            drawPath(path, color.copy(alpha = 0.18f))
            if (ready) drawPath(path, color.copy(alpha = 0.35f), style = Stroke(8.dp.toPx()))
            drawPath(path, color, style = Stroke(3.dp.toPx()))
        }
        Row(
            Modifier.align(Alignment.TopCenter).padding(top = 12.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(if (ready) Color(0xFF61D68E) else Color(0xFFE8C65A)))
            Spacer(Modifier.width(7.dp))
            Text(hint(l?.det, stable, auto && !armed), color = Color.White, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
        }
        if (camera?.cameraInfo?.hasFlashUnit() == true) {
            Box(Modifier.align(Alignment.BottomStart).padding(12.dp)) {
                DarkIcon(R.drawable.ic_i_flashlight, if (torch) "Licht aus" else "Licht") { torch = !torch; camera?.cameraControl?.enableTorch(torch) }
            }
        }
    }
}

/** Aktuelle Bildschirmdrehung (`Surface.ROTATION_*`), auch bei 180°-Wechseln ohne Konfigurationsänderung. */
@Composable
private fun rememberDisplayRotation(): Int {
    val view = LocalView.current
    var rotation by remember { mutableIntStateOf(view.display?.rotation ?: Surface.ROTATION_0) }
    DisposableEffect(view) {
        val displays = view.context.getSystemService(DisplayManager::class.java)
        val listener = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) {}
            override fun onDisplayRemoved(displayId: Int) {}
            override fun onDisplayChanged(displayId: Int) {
                view.display?.takeIf { it.displayId == displayId }?.let { rotation = it.rotation }
            }
        }
        displays.registerDisplayListener(listener, null)
        view.display?.let { rotation = it.rotation }
        onDispose { displays.unregisterDisplayListener(listener) }
    }
    return rotation
}

/** Miniatur einer Aufnahme: Ladeanzeige, solange die Seite im Hintergrund berechnet wird; neue ploppen kurz auf. */
@Composable
private fun Thumb(i: Int, s: ScanShot, onOpen: () -> Unit, onDelete: () -> Unit) {
    val appear = remember { Animatable(0.6f) }
    LaunchedEffect(Unit) { appear.animateTo(1f, spring(dampingRatio = 0.6f, stiffness = 500f)) }
    Column(Modifier.width(78.dp).graphicsLayer { scaleX = appear.value; scaleY = appear.value; alpha = ((appear.value - 0.6f) / 0.4f).coerceIn(0f, 1f) }) {
        Box(
            Modifier.size(78.dp, 100.dp).shadow(6.dp, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp))
                .background(Color.White.copy(alpha = 0.08f)).border(1.dp, if (s.failed) Color(0xFFE97366) else Color.White.copy(alpha = 0.22f), RoundedCornerShape(10.dp))
                .clickable(onClick = onOpen),
            contentAlignment = Alignment.Center,
        ) {
            val p = s.preview
            when {
                p != null -> Image(p.asImageBitmap(), "Scan ${i + 1}", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                s.failed -> Text("!", color = Color(0xFFF29A8F), fontSize = TextSize.md, fontWeight = FontWeight.Bold)
                else -> CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
            }
            Text("${i + 1}", Modifier.align(Alignment.BottomStart).padding(4.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 6.dp), color = Color.White, fontSize = TextSize.xs2, fontWeight = FontWeight.Bold)
            Box(Modifier.align(Alignment.TopEnd).padding(3.dp).size(24.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.65f)).clickable(onClickLabel = "Seite ${i + 1} löschen", onClick = onDelete), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_i_x), null, Modifier.size(12.dp), tint = Color.White)
            }
        }
        if (s.note.isNotEmpty()) Text(s.note, color = Color(0xFFFFB74D), fontSize = TextSize.xs2, maxLines = 1)
    }
}

@Composable
internal fun Pill(label: String, active: Boolean, onClick: () -> Unit) {
    Text(
        label,
        Modifier.clip(CircleShape).background(if (active) Color.White else Color.White.copy(alpha = 0.14f)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp),
        color = if (active) Color.Black else Color.White, fontSize = TextSize.sm,
    )
}

@Composable
internal fun DarkIcon(icon: Int, label: String, onClick: () -> Unit) {
    Box(Modifier.size(40.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.14f)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), label, Modifier.size(18.dp), tint = Color.White)
    }
}

private fun decodeLarge(context: Context, uri: Uri): Bitmap? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= SCAN_SOURCE_EDGE) sample *= 2
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
}.getOrNull()

@Suppress("DEPRECATION")
private fun vibrate(context: Context) {
    val v = context.getSystemService(Vibrator::class.java) ?: return
    runCatching { v.vibrate(VibrationEffect.createOneShot(35, VibrationEffect.DEFAULT_AMPLITUDE)) }
}
