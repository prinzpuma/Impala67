package org.impala67.app.heft.ink

import android.graphics.BitmapFactory
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/**
 * Liest gedruckten Text eines Seitenhintergrunds (Scan, PDF-Seite ohne Text, Arbeitsblatt) mit ML Kit
 * Text Recognition – wie Apple Vision auf dem iPad und Tesseract in der PWA. Das Modell kommt über
 * die Google-Play-Dienste.
 */
// funktion: heft.hintergrund-text
class BackgroundTextRecognizer : AutoCloseable {
    private val client = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    /** Text des Bildes, Zeilen von oben nach unten; leer, wenn nichts erkannt wurde. */
    suspend fun recognize(bytes: ByteArray): String? {
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
        return try {
            client.process(InputImage.fromBitmap(bitmap, 0)).awaitTask().text.trim()
        } finally {
            bitmap.recycle()
        }
    }

    override fun close() = client.close()
}
