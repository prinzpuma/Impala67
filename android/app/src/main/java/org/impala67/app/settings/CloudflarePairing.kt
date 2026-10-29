package org.impala67.app.settings

import android.content.ClipData
import android.content.Context
import android.graphics.Bitmap
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.unit.dp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import org.impala67.app.ui.theme.Space
import kotlin.coroutines.resume

/** Verbindungsdaten aus einem Kopplungs-QR-Code. */
data class CfPairing(val url: String, val key: String)

/** Wie die PWA (settings.js `handleCfPairing`): Link auf die PWA mit `#cf-pair=<Base64(JSON)>`. */
fun cfPairingLink(url: String, key: String): String {
    val json = JSONObject(mapOf("url" to url, "key" to key)).toString()
    return PWA_URL + "#cf-pair=" + Base64.encodeToString(json.toByteArray(), Base64.NO_WRAP)
}

/** Wie `parseCfPairingData` (qr-scanner.js): Kopplungs-Link, rohes JSON oder nur die Base64-Daten. */
fun parseCfPairing(scanned: String): CfPairing? {
    val text = scanned.trim()
    val fromJson = { raw: String ->
        runCatching { JSONObject(raw) }.getOrNull()
            ?.let { CfPairing(it.optString("url").trim(), it.optString("key").trim()) }
            ?.takeIf { it.url.isNotEmpty() && it.key.isNotEmpty() }
    }
    val fromBase64 = { raw: String ->
        runCatching { String(Base64.decode(raw, Base64.DEFAULT)) }.getOrNull()?.let(fromJson)
    }
    val hash = text.indexOf("#cf-pair=")
    if (hash >= 0) return fromBase64(text.substring(hash + 9))
    return fromJson(text) ?: fromBase64(text)
}

/** Googles Code-Scanner (eigenes Fenster, keine Kamera-Berechtigung). `null`: abgebrochen/fehlgeschlagen. */
suspend fun scanQrCode(context: Context): String? = suspendCancellableCoroutine { cont ->
    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    GmsBarcodeScanning.getClient(context, options).startScan()
        .addOnSuccessListener { cont.resume(it.rawValue) }
        .addOnCanceledListener { cont.resume(null) }
        .addOnFailureListener { cont.resume(null) }
}

/** „Gerät automatisch koppeln“: QR-Code mit dem Kopplungs-Link und „Kopplungs-Link kopieren“. */
@Composable
fun CfPairingDialog(url: String, key: String, toast: (String) -> Unit, onDismiss: () -> Unit) {
    val link = remember(url, key) { cfPairingLink(url, key) }
    val qr = remember(link) { qrBitmap(link, 640).asImageBitmap() }
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Gerät automatisch koppeln") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    "Scanne diesen QR-Code mit der Impala67-App auf deinem Smartphone/Tablet " +
                        "(unter Einstellungen → Sync → QR-Code scannen).",
                )
                Box(Modifier.padding(top = Space.s4).background(Color.White).padding(Space.s3)) {
                    Image(qr, contentDescription = "Kopplungs-QR-Code", filterQuality = FilterQuality.None, modifier = Modifier.size(220.dp))
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                scope.launch {
                    clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Kopplungs-Link", link)))
                    toast("Kopplungs-Link kopiert! Sende ihn an dein Smartphone (z. B. via Notizen/Mail).")
                }
            }) { Text("Kopplungs-Link kopieren") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Schließen") } },
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun qrBitmap(text: String, size: Int): Bitmap {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
    val pixels = IntArray(size * size) { i -> if (matrix.get(i % size, i / size)) 0xFF000000.toInt() else 0xFFFFFFFF.toInt() }
    return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
}

private const val PWA_URL = "https://prinzpuma.github.io/Impala67/"
