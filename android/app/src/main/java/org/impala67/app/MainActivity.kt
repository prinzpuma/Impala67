package org.impala67.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.impala67.app.data.ImpalaRepository
import org.impala67.app.ui.navigation.ImpalaAppShell
import org.impala67.app.ui.navigation.NavTarget
import org.impala67.app.ui.theme.ImpalaTheme

/**
 * Haupteinstiegspunkt für die Benutzeroberfläche von Impala67.
 * Initialisiert SplashScreen, Edge-to-Edge Darstellung und verarbeitet
 * System-Shortcuts sowie Intents zum Teilen von Texten und Dateien.
 */
class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "MainActivity"
        const val ACTION_NEW_NOTE = "org.impala67.app.ACTION_NEW_NOTE"
        const val ACTION_NEW_HEFT = "org.impala67.app.ACTION_NEW_HEFT"
        const val ACTION_STUDY_CARDS = "org.impala67.app.ACTION_STUDY_CARDS"
    }

    private val repository: ImpalaRepository by lazy {
        (application as ImpalaApp).repository
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // 1. Splash-Screen installieren vor super.onCreate()
        installSplashScreen()
        super.onCreate(savedInstanceState)

        // 2. Vollflächiges Edge-to-Edge Design aktivieren
        enableEdgeToEdge()

        // 3. Eingehenden Intent (Shortcuts oder Teilen) analysieren
        val initialTarget = handleIncomingIntent(intent)

        // 4. Compose UI aufsetzen
        setContent {
            ImpalaTheme {
                ImpalaAppShell(
                    repository = repository,
                    initialTarget = initialTarget,
                    onScanDocumentRequested = {
                        // Bei Bedarf externen Scanner-Intent oder Heft-Scan starten
                    }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val target = handleIncomingIntent(intent)
        if (target != null) {
            setContent {
                ImpalaTheme {
                    ImpalaAppShell(
                        repository = repository,
                        initialTarget = target
                    )
                }
            }
        }
    }

    /**
     * Verarbeitet App-Shortcuts und ACTION_SEND / ACTION_SEND_MULTIPLE Intents.
     */
    private fun handleIncomingIntent(intent: Intent?): NavTarget? {
        if (intent == null) return null

        val action = intent.action ?: return null

        return try {
            when (action) {
                ACTION_NEW_NOTE -> {
                    // Shortcut: Neue Notiz erstellen
                    val newId = runBlocking(Dispatchers.IO) {
                        repository.core.createPage("Neue Notiz", "", null, null)
                    }
                    NavTarget.NoteEditor(newId)
                }

                ACTION_NEW_HEFT -> {
                    // Shortcut: Neues Heft anlegen
                    val newId = runBlocking(Dispatchers.IO) {
                        repository.core.createHeft("Neues Heft", null, null)
                    }
                    NavTarget.Heft(newId)
                }

                ACTION_STUDY_CARDS -> {
                    // Shortcut: Karteikarten lernen
                    NavTarget.Study(null)
                }

                Intent.ACTION_SEND -> {
                    val mimeType = intent.type ?: ""
                    if (mimeType.startsWith("text/")) {
                        // Text geteilt
                        val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""
                        if (sharedText.isNotBlank()) {
                            val title = sharedText.lineSequence().firstOrNull()?.take(40)?.trim()
                                ?: "Geteilte Notiz"
                            val newId = runBlocking(Dispatchers.IO) {
                                repository.core.createPage(title, sharedText, null, null)
                            }
                            NavTarget.NoteEditor(newId)
                        } else null
                    } else {
                        // Bild oder Datei geteilt
                        val streamUri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                        } else {
                            @Suppress("DEPRECATION")
                            intent.getParcelableExtra(Intent.EXTRA_STREAM)
                        }

                        if (streamUri != null) {
                            importUriToNewNote(listOf(streamUri))
                        } else null
                    }
                }

                Intent.ACTION_SEND_MULTIPLE -> {
                    val streamUris = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
                    }

                    if (!streamUris.isNullOrEmpty()) {
                        importUriToNewNote(streamUris)
                    } else null
                }

                else -> null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Fehler beim Verarbeiten des Intents: $action", e)
            null
        }
    }

    /**
     * Liest geteilte Mediendateien (Bilder/PDFs) aus und legt sie als neue Notiz an.
     */
    private fun importUriToNewNote(uris: List<Uri>): NavTarget? {
        return runBlocking(Dispatchers.IO) {
            try {
                val markdownBuilder = StringBuilder()
                var firstTitle: String? = null

                for (uri in uris) {
                    val mime = contentResolver.getType(uri) ?: "application/octet-stream"
                    val fileName = queryFileName(uri) ?: "datei"
                    if (firstTitle == null) {
                        firstTitle = fileName
                    }

                    val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    if (bytes != null && bytes.isNotEmpty()) {
                        val fileId = repository.core.addFile(bytes, mime, fileName)
                        if (mime.startsWith("image/")) {
                            markdownBuilder.append("![$fileName]($fileId)\n\n")
                        } else {
                            markdownBuilder.append("[$fileName]($fileId)\n\n")
                        }
                    }
                }

                val title = firstTitle ?: "Geteilte Dateien"
                val newPageId = repository.core.createPage(title, markdownBuilder.toString(), null, null)
                NavTarget.NoteEditor(newPageId)
            } catch (e: Exception) {
                Log.e(TAG, "Import von Uris fehlgeschlagen", e)
                null
            }
        }
    }

    private fun queryFileName(uri: Uri): String? {
        return try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex != -1 && cursor.moveToFirst()) {
                    cursor.getString(nameIndex)
                } else null
            }
        } catch (e: Exception) {
            null
        }
    }
}
