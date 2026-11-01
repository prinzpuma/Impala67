package org.impala67.app.heft

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.heft.scan.ScannedPage
import org.impala67.app.heft.scan.decodeScanPage
import java.io.File

/** Längste Kante eingefügter Bilder (heft-import.js `fileToImageData(f, 1400)`). */
private const val IMAGE_MAX_EDGE = 1400

/** „Bild hinzufügen“ (Galerie) und „Bild aufnehmen“ (Kamera) des „Bilder“-Menüs. */
class HeftImagePick(val pick: () -> Unit, val photo: () -> Unit)

/**
 * Bild aus der Galerie (Photo Picker, ohne Speicher-Berechtigung) oder von der Kamera holen und als
 * JPEG (längste Kante 1400) an [onImage] geben. Die Kamera fragt vorher nach ihrer Berechtigung.
 */
@Composable
fun rememberHeftImagePick(onImage: (ScannedPage) -> Unit, onError: (String) -> Unit): HeftImagePick {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val image by rememberUpdatedState(onImage)
    val error by rememberUpdatedState(onError)
    val photoUri = remember {
        val file = File(context.cacheDir, "heft-photo.jpg")
        FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
    }

    fun load(uri: Uri) {
        scope.launch {
            val img = withContext(Dispatchers.IO) { runCatching { decodeScanPage(context, uri, IMAGE_MAX_EDGE) }.getOrNull() }
            if (img != null) image(img) else error("Bild konnte nicht eingefügt werden")
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let(::load) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) load(photoUri) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) camera.launch(photoUri) else error("Ohne Kamera-Berechtigung kein Foto.")
    }
    return remember {
        HeftImagePick(
            pick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            photo = {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) camera.launch(photoUri)
                else permission.launch(Manifest.permission.CAMERA)
            },
        )
    }
}
