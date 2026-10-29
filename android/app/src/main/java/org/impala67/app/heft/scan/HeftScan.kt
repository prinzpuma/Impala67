package org.impala67.app.heft.scan

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.heft.Paper
import uniffi.impala_ffi.ImpalaCore

/** Seitenlimit wie `PLATFORM_NATIVE.scanner.scan({ pageLimit: 25 })` in der PWA. */
private const val SCAN_PAGE_LIMIT = 25

private val scannerOptions: GmsDocumentScannerOptions = GmsDocumentScannerOptions.Builder()
    .setGalleryImportAllowed(true)
    .setPageLimit(SCAN_PAGE_LIMIT)
    .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
    .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
    .build()

/**
 * Öffnet den Dokument-Scanner von Google ML Kit und liefert die Scans als JPEG an [onScanned].
 * Abbruch ist still; Fehler gehen als Text an [onError].
 */
@Composable
fun rememberDocumentScan(onScanned: (List<ScannedPage>) -> Unit, onError: (String) -> Unit): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val scanned by rememberUpdatedState(onScanned)
    val failed by rememberUpdatedState(onError)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode != Activity.RESULT_OK) return@rememberLauncherForActivityResult
        val pages = GmsDocumentScanningResult.fromActivityResultIntent(result.data)?.pages.orEmpty()
        scope.launch {
            val scans = withContext(Dispatchers.IO) { pages.mapNotNull { decodeScanPage(context, it.imageUri) } }
            if (scans.isEmpty()) failed("Scan fehlgeschlagen") else scanned(scans)
        }
    }
    return remember(context, launcher) {
        {
            val activity = context.findActivity()
            if (activity == null) {
                failed("Scan fehlgeschlagen")
            } else {
                GmsDocumentScanning.getClient(scannerOptions).getStartScanIntent(activity)
                    .addOnSuccessListener { sender -> launcher.launch(IntentSenderRequest.Builder(sender).build()) }
                    .addOnFailureListener { failed("Scan fehlgeschlagen") }
            }
        }
    }
}

/**
 * Je Scan eine neue Heftseite (Papier „Blanko“) mit dem Bild seitenfüllend, wie `insertScannedPages`
 * in heft.js. Die Seiten stehen ab Position [at] nacheinander. Liefert die erste neue Seiten-ID.
 */
fun ImpalaCore.insertScannedPages(pageId: String, at: Int, scans: List<ScannedPage>): String? {
    var first: String? = null
    scans.forEachIndexed { i, scan ->
        val heftPageId = heftAddPage(pageId, (at + i).toUInt(), Paper.BLANK.id)
        val f = scanFrame(scan)
        heftAddImage(pageId, heftPageId, scan.jpeg, "image/jpeg", f.x, f.y, f.w, f.h)
        if (first == null) first = heftPageId
    }
    return first
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
