package org.impala67.app.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.impala_ffi.CardInfo
import uniffi.impala_ffi.ChangeListener
import uniffi.impala_ffi.Changes
import uniffi.impala_ffi.ChatData
import uniffi.impala_ffi.ChatInfo
import uniffi.impala_ffi.ConflictInfo
import uniffi.impala_ffi.DeckOverview
import uniffi.impala_ffi.HeftFolder
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.PageDetail
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.SearchHit
import uniffi.impala_ffi.StudyQueue
import uniffi.impala_ffi.WorkspaceInfo
import java.io.File
import java.util.TimeZone

/**
 * Zentrales Repository für die native Android-App von Impala67.
 * Hält die threadsichere ImpalaCore-Instanz, reaktive StateFlows für Compose-Screens
 * und orchestriert Cloudflare Live-Sync, Google Drive und WebView-Migration.
 */
class ImpalaRepository private constructor(
    private val context: Context
) : ChangeListener {

    companion object {
        private const val TAG = "ImpalaRepository"
        private const val RECENT_PAGES_LIMIT: UInt = 50u

        @Volatile
        private var INSTANCE: ImpalaRepository? = null

        fun getInstance(context: Context): ImpalaRepository {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: ImpalaRepository(context.applicationContext).also { INSTANCE = it }
            }
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Datenhaltung & Manager
    val core: ImpalaCore
    val securePrefs: SecurePrefs = SecurePrefs(context)
    val driveAuthManager: DriveAuthManager = DriveAuthManager(context, securePrefs)
    val syncManager: SyncManager

    // --- Reaktive StateFlows für die Compose-Oberfläche ---

    private val _workspaces = MutableStateFlow<List<WorkspaceInfo>>(emptyList())
    val workspaces: StateFlow<List<WorkspaceInfo>> = _workspaces.asStateFlow()

    private val _activeWorkspaceId = MutableStateFlow<String>("")
    val activeWorkspaceId: StateFlow<String> = _activeWorkspaceId.asStateFlow()

    private val _rootPages = MutableStateFlow<List<PageSummary>>(emptyList())
    val rootPages: StateFlow<List<PageSummary>> = _rootPages.asStateFlow()

    private val _recentPages = MutableStateFlow<List<PageSummary>>(emptyList())
    val recentPages: StateFlow<List<PageSummary>> = _recentPages.asStateFlow()

    private val _trashedPages = MutableStateFlow<List<PageSummary>>(emptyList())
    val trashedPages: StateFlow<List<PageSummary>> = _trashedPages.asStateFlow()

    private val _archivedPages = MutableStateFlow<List<PageSummary>>(emptyList())
    val archivedPages: StateFlow<List<PageSummary>> = _archivedPages.asStateFlow()

    private val _decks = MutableStateFlow<List<DeckOverview>>(emptyList())
    val decks: StateFlow<List<DeckOverview>> = _decks.asStateFlow()

    private val _studyQueue = MutableStateFlow<StudyQueue?>(null)
    val studyQueue: StateFlow<StudyQueue?> = _studyQueue.asStateFlow()

    private val _conflicts = MutableStateFlow<List<ConflictInfo>>(emptyList())
    val conflicts: StateFlow<List<ConflictInfo>> = _conflicts.asStateFlow()

    private val _chats = MutableStateFlow<List<ChatInfo>>(emptyList())
    val chats: StateFlow<List<ChatInfo>> = _chats.asStateFlow()

    private val _heftFolders = MutableStateFlow<List<HeftFolder>>(emptyList())
    val heftFolders: StateFlow<List<HeftFolder>> = _heftFolders.asStateFlow()

    private val _changesFlow = MutableSharedFlow<Changes>(extraBufferCapacity = 64)
    val changesFlow: SharedFlow<Changes> = _changesFlow.asSharedFlow()

    init {
        // 1. SQLite-Datenbank des Rust-Kerns öffnen
        val dbFile = File(context.filesDir, "impala67.db")
        core = ImpalaCore.open(dbFile.absolutePath)
        syncManager = SyncManager(core)
        core.setChangeListener(this)

        // 2. Migration aus alter WebView prüfen & ggf. Schlüssel übernehmen
        WebViewMigrator.migrateIfNeeded(context, securePrefs)

        // 3. Initialen Zustand synchron vorbefüllen
        refreshAllInternal()

        // 4. Cloudflare Sync konfigurieren & starten falls Schlüssel hinterlegt
        val syncKey = securePrefs.cfSyncKey
        if (!syncKey.isNullOrBlank()) {
            syncManager.configureCloudSync(syncKey, securePrefs.cfWorkerUrl)
        }

        // 5. Drive Sync initialisieren falls Google-Konto verbunden ist
        if (driveAuthManager.isConfigured()) {
            syncManager.configureDriveSync(driveAuthManager)
        }
    }

    // --- ChangeListener Implementierung ---

    override fun onChanged(changes: Changes) {
        // Schnell zurückkehren: Ereignis asynchron auf IO verarbeiten
        scope.launch {
            _changesFlow.emit(changes)
            handleChanges(changes)
        }
    }

    private fun handleChanges(changes: Changes) {
        if (changes.everything) {
            refreshAllInternal()
            return
        }

        if (changes.workspaces) {
            refreshWorkspaces()
        }

        if (changes.pagesAll || changes.pages.isNotEmpty() || changes.hefte.isNotEmpty() || changes.closedPages.isNotEmpty()) {
            refreshPages()
        }

        if (changes.decks || changes.cardsAll || changes.cards.isNotEmpty() || changes.reviews) {
            refreshDecksAndQueue()
        }

        if (changes.chatsAll || changes.chats.isNotEmpty()) {
            refreshChats()
        }

        if (changes.heftFolders) {
            refreshHeftFolders()
        }

        refreshConflicts()
    }

    // --- Aktualisierungsmethoden für Zustände ---

    /**
     * Lädt alle Datenbestände des Kerns neu.
     */
    fun refreshAll() {
        scope.launch {
            refreshAllInternal()
        }
    }

    private fun refreshAllInternal() {
        try {
            refreshWorkspaces()
            refreshPages()
            refreshDecksAndQueue()
            refreshChats()
            refreshHeftFolders()
            refreshConflicts()
        } catch (e: Exception) {
            Log.e(TAG, "Fehler bei refreshAllInternal", e)
        }
    }

    private fun refreshWorkspaces() {
        val wsList = core.workspaces()
        _workspaces.value = wsList
        if (_activeWorkspaceId.value.isBlank() && wsList.isNotEmpty()) {
            _activeWorkspaceId.value = wsList.first().id
        }
    }

    private fun refreshPages() {
        val activeWs = _activeWorkspaceId.value.ifBlank { null }
        _rootPages.value = core.childrenOf(null, activeWs)
        _recentPages.value = core.recentPages(RECENT_PAGES_LIMIT)
        _trashedPages.value = core.trashedPages()
        _archivedPages.value = core.archivedPages()
    }

    private fun refreshDecksAndQueue() {
        val offsetMinutes = currentUtcOffsetMinutes()
        _decks.value = core.deckOverview(offsetMinutes, false)
        _studyQueue.value = core.studyQueue(null, offsetMinutes, false)
    }

    private fun refreshChats() {
        _chats.value = core.chats()
    }

    private fun refreshHeftFolders() {
        _heftFolders.value = core.heftFolders(null)
    }

    private fun refreshConflicts() {
        _conflicts.value = core.conflicts()
    }

    private fun currentUtcOffsetMinutes(): Int {
        return TimeZone.getDefault().getOffset(System.currentTimeMillis()) / (1000 * 60)
    }

    // --- Öffentliche Hilfsmethoden für UI & ViewModels ---

    /**
     * Wählt einen aktiven Workspace aus und aktualisiert die Wurzelnotizen.
     */
    fun selectWorkspace(id: String) {
        _activeWorkspaceId.value = id
        scope.launch {
            _rootPages.value = core.childrenOf(null, id.ifBlank { null })
        }
    }

    /**
     * Erstellt eine neue Notiz (Markdown-Seite) im aktuellen oder angegebenen Workspace.
     */
    suspend fun createNote(
        title: String,
        content: String = "",
        parentId: String? = null
    ): String = withContext(Dispatchers.IO) {
        val wsId = _activeWorkspaceId.value.ifBlank { null }
        core.createPage(title, content, parentId, wsId)
    }

    /**
     * Erstellt ein neues linierte Heft im aktuellen oder angegebenen Workspace.
     */
    suspend fun createHeft(
        title: String,
        parentId: String? = null
    ): String = withContext(Dispatchers.IO) {
        val wsId = _activeWorkspaceId.value.ifBlank { null }
        core.createHeft(title, parentId, wsId)
    }

    /**
     * Lädt die Details einer Seite (Titel, Inhalt, Metadaten).
     */
    suspend fun getPage(id: String): PageDetail? = withContext(Dispatchers.IO) {
        core.page(id)
    }

    /**
     * Aktualisiert Titel und/oder Inhalt einer Seite.
     */
    suspend fun updatePage(id: String, title: String?, content: String?) = withContext(Dispatchers.IO) {
        core.updatePage(id, title, content)
    }

    /**
     * Verschiebt eine Seite in den Papierkorb.
     */
    suspend fun trashPage(id: String) = withContext(Dispatchers.IO) {
        core.trashPage(id)
    }

    /**
     * Stellt eine Seite aus dem Papierkorb wieder her.
     */
    suspend fun restorePage(id: String) = withContext(Dispatchers.IO) {
        core.restorePage(id)
    }

    /**
     * Löscht eine Seite endgültig aus dem Papierkorb.
     */
    suspend fun deletePageForever(id: String) = withContext(Dispatchers.IO) {
        core.deletePageForever(id)
    }

    /**
     * Sucht Notizen und Handschriften nach dem Suchbegriff.
     */
    suspend fun search(query: String, includeArchived: Boolean = false): List<SearchHit> = withContext(Dispatchers.IO) {
        core.search(query, includeArchived)
    }

    /**
     * Speichert oder aktualisiert einen Chat.
     */
    suspend fun saveChat(chat: ChatData): String = withContext(Dispatchers.IO) {
        core.saveChat(chat)
    }

    /**
     * Löscht einen Chat.
     */
    suspend fun deleteChat(id: String) = withContext(Dispatchers.IO) {
        core.deleteChat(id)
    }

    /**
     * Sichert den aktuellen Zustand der Datenbank als Checkpoint.
     */
    suspend fun saveCheckpoint() = withContext(Dispatchers.IO) {
        try {
            core.saveCheckpoint()
        } catch (e: Exception) {
            Log.e(TAG, "saveCheckpoint fehlgeschlagen", e)
        }
    }
}
