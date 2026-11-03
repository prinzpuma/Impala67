package org.impala67.app.heft.scan

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.hardware.display.DisplayManager
import android.net.Uri
import android.view.Surface
import android.os.VibrationEffect
import android.os.Vibrator
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
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
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
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.ScanDetection
import uniffi.impala_ffi.scanDetect
import java.time.LocalDate
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Live-Erkennung: Ecken als Bruchteil des Analysebilds (0…1), Seitenverhältnis und Qualität. */
private data class Live(val corners: List<Double>, val aspect: Float, val det: ScanDetection)

/** Qualitätshinweis wie heft-scanner-ui.js `qualityHint`. */
private fun hint(d: ScanDetection?, stable: Int): String = when {
    d == null -> "Suche Blatt…"
    d.full -> "Blattrand sichtbar halten"
    d.check.tooDark -> "Mehr Licht nötig"
    d.check.glare -> "Spiegelung"
    d.check.flat -> "Kontrast zu gering"
    d.check.soft -> "Kamera ruhiger halten"
    stable >= STABLE_FRAMES -> "stabil erkannt"
    else -> "Blatt vollständig"
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
    var auto by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var flash by remember { mutableStateOf(false) }
    var hasCamera by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val noCamera = !context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { hasCamera = it }
    LaunchedEffect(Unit) { if (!hasCamera && !noCamera) permission.launch(Manifest.permission.CAMERA) }

    val addBitmap: suspend (Bitmap) -> Unit = { raw ->
        val shot = withContext(Dispatchers.Default) { shotOf(raw, filter) }
        shot.preview = withContext(Dispatchers.Default) { runCatching { shot.render(480) }.getOrNull() }
        shots += shot
    }
    val photos = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        scope.launch { uris.forEach { u -> decodeLarge(context, u)?.let { addBitmap(it) } } }
    }
    val pdf = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        if (uri != null) scope.launch {
            busy = true
            runCatching { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri, "wt")!!.use { writeScanPdf(shots.toList(), it) } } }
                .onSuccess { onToast("PDF gespeichert.") }.onFailure { onToast("PDF konnte nicht gespeichert werden.") }
            busy = false
        }
    }
    BackHandler { if (editing != null) editing = null else onClose() }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Dateien scannen", Modifier.weight(1f), color = Color.White, fontSize = TextSize.md, fontWeight = FontWeight.SemiBold)
                    DarkIcon(R.drawable.ic_i_x, "Schließen", onClose)
                }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    if (hasCamera) {
                        CameraPane(auto, onCapture = { bmp ->
                            flash = true
                            vibrate(context)
                            scope.launch { addBitmap(bmp); delay(140); flash = false }
                        }, onToast)
                    } else {
                        Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Kamera nicht verfügbar. Bitte Fotos wählen.", color = Color.White)
                            TextButton({ photos.launch("image/*") }) { Text("Fotos auswählen") }
                        }
                    }
                    if (flash) Box(Modifier.fillMaxSize().background(Color.White.copy(alpha = 0.7f)))
                }
                if (shots.isNotEmpty()) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    shots.forEachIndexed { i, s -> Thumb(i, s, { editing = i }) { shots.removeAt(i) } }
                }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    ScanFilter.entries.forEach { f -> Pill(f.label, filter == f) { filter = f } }
                    Pill(if (auto) "Auto-Scan an" else "Auto-Scan aus", auto) { auto = !auto }
                    Pill("Fotos", false) { photos.launch("image/*") }
                }
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton({ pdf.launch("scan-${LocalDate.now()}.pdf") }, enabled = shots.isNotEmpty() && !busy) { Text("Als PDF speichern", color = Color.White) }
                    Box(Modifier.weight(1f))
                    TextButton(
                        {
                            busy = true
                            scope.launch {
                                val pages = withContext(Dispatchers.Default) { shots.map { it.toPage() } }
                                busy = false
                                onInsert(pages)
                            }
                        },
                        enabled = shots.isNotEmpty() && !busy,
                    ) { Text("In Heft einfügen (${shots.size})", color = Color.White, fontWeight = FontWeight.SemiBold) }
                }
            }
            editing?.let { i ->
                shots.getOrNull(i)?.let { s ->
                    ScanEditor(i, s, onDelete = { shots.removeAt(i); editing = null }) {
                        scope.launch {
                            s.preview = withContext(Dispatchers.Default) { runCatching { s.render(480) }.getOrNull() }
                            shots[i] = s
                            editing = null
                        }
                    }
                }
            }
        }
    }
}

/** Kamera mit Vorschau, Analyse (Erkennungsrahmen) und Auslöser; Taschenlampe, wenn das Gerät eine hat. */
@Composable
private fun CameraPane(auto: Boolean, onCapture: (Bitmap) -> Unit, onToast: (String) -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var request by remember { mutableStateOf<SurfaceRequest?>(null) }
    var live by remember { mutableStateOf<Live?>(null) }
    var stable by remember { mutableStateOf(0) }
    var camera by remember { mutableStateOf<Camera?>(null) }
    var torch by remember { mutableStateOf(false) }
    var lastShot by remember { mutableStateOf(0L) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val capture = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).build() }
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
    }
    var shooting by remember { mutableStateOf(false) }
    val shoot = {
        if (!shooting) {
            shooting = true
            capture.takePicture(executor, object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    val bmp = image.use { it.toBitmap().rotated(it.imageInfo.rotationDegrees) }
                    ContextCompat.getMainExecutor(context).execute { shooting = false; lastShot = System.currentTimeMillis(); stable = 0; onCapture(bmp) }
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
                    if (now - lastRun < 180) return@use
                    lastRun = now
                    val bmp = p.toBitmap().rotated(p.imageInfo.rotationDegrees)
                    val det = runCatching { scanDetect(bmp.toScanImage(640)) }.getOrNull() ?: return@use
                    val k = min(1f, 640f / max(bmp.width, bmp.height))
                    val w = bmp.width * k
                    val h = bmp.height * k
                    val norm = det.corners.mapIndexed { i, v -> if (i % 2 == 0) v / w else v / h }
                    ContextCompat.getMainExecutor(context).execute {
                        val prev = live?.corners
                        stable = if (!det.full && prev != null && norm.zip(prev).all { (a, b) -> abs(a - b) < 0.02 }) stable + 1 else 0
                        live = Live(norm, bmp.width / bmp.height.toFloat(), det)
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
    // Auto-Scan: nach 5 stabilen Bildern auslösen, danach 1,8 s Pause.
    LaunchedEffect(stable, auto) {
        if (auto && stable >= STABLE_FRAMES && System.currentTimeMillis() - lastShot > AUTO_PAUSE_MS) shoot()
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
            val color = if (ready) Color(0xFF34C759) else Color.White
            drawPath(path, color.copy(alpha = 0.18f))
            drawPath(path, color, style = Stroke(3.dp.toPx()))
        }
        Text(
            hint(l?.det, stable),
            Modifier.align(Alignment.TopCenter).padding(top = 12.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.55f)).padding(horizontal = 12.dp, vertical = 6.dp),
            color = if (ready) Color(0xFF34C759) else Color.White, fontSize = TextSize.sm,
        )
        Row(Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(28.dp)) {
            if (camera?.cameraInfo?.hasFlashUnit() == true) {
                DarkIcon(R.drawable.ic_i_flashlight, "Licht") { torch = !torch; camera?.cameraControl?.enableTorch(torch) }
            } else Box(Modifier.size(40.dp))
            Box(
                Modifier.size(72.dp).clip(CircleShape).border(4.dp, Color.White, CircleShape).padding(6.dp).clip(CircleShape)
                    .background(if (shooting) Color.Gray else Color.White).clickable { shoot() },
            )
            Box(Modifier.size(40.dp))
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

@Composable
private fun Thumb(i: Int, s: ScanShot, onOpen: () -> Unit, onDelete: () -> Unit) {
    Column(Modifier.width(78.dp)) {
        Box(Modifier.size(78.dp, 100.dp).clip(RoundedCornerShape(8.dp)).background(Color.DarkGray).clickable(onClick = onOpen)) {
            (s.preview ?: s.original).let { Image(it.asImageBitmap(), "Scan ${i + 1}", Modifier.fillMaxSize()) }
            Text("${i + 1}", Modifier.align(Alignment.BottomStart).padding(4.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 6.dp), color = Color.White, fontSize = TextSize.xs2)
            Box(Modifier.align(Alignment.TopEnd).padding(2.dp).size(22.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)).clickable(onClick = onDelete), contentAlignment = Alignment.Center) {
                Text("×", color = Color.White, fontSize = TextSize.sm)
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

/** Neues Blatt: Kanten auf einer verkleinerten Kopie suchen, Ecken auf das Original umrechnen, Qualitätsnotiz. */
private fun shotOf(raw: Bitmap, filter: ScanFilter): ScanShot {
    val k0 = min(1f, 4096f / max(raw.width, raw.height))
    val original = if (k0 < 1f) Bitmap.createScaledBitmap(raw, (raw.width * k0).roundToInt(), (raw.height * k0).roundToInt(), true) else raw
    val k = min(1f, 1200f / max(original.width, original.height))
    val det = runCatching { scanDetect(original.toScanImage(1200)) }.getOrNull()
    val corners = det?.corners?.map { it / k } ?: listOf(0.0, 0.0, original.width - 1.0, 0.0, original.width - 1.0, original.height - 1.0, 0.0, original.height - 1.0)
    val note = when {
        det == null -> ""
        det.check.tooDark -> "Mehr Licht nötig"
        det.check.glare -> "Spiegelung"
        det.check.flat -> "Kontrast zu gering"
        det.check.soft -> "Unscharf"
        else -> ""
    }
    return ScanShot(original, corners, filter, 0, note)
}

private fun decodeLarge(context: Context, uri: Uri): Bitmap? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 4096) sample *= 2
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
}.getOrNull()

@Suppress("DEPRECATION")
private fun vibrate(context: Context) {
    val v = context.getSystemService(Vibrator::class.java) ?: return
    runCatching { v.vibrate(VibrationEffect.createOneShot(35, VibrationEffect.DEFAULT_AMPLITUDE)) }
}
