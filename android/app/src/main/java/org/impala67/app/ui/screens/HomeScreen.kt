package org.impala67.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.Note
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.AutoStories
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.CloudSync
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.WarningAmber
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.data.SyncUiModel
import org.impala67.app.ui.theme.Accent
import org.impala67.app.ui.theme.AccentBorder
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.DangerSoft
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.EdgeSoft
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.Success
import org.impala67.app.ui.theme.SurfaceActive
import org.impala67.app.ui.theme.SurfaceHover
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.Warn
import org.impala67.app.ui.theme.WarnSoft
import uniffi.impala_ffi.DeckOverview
import uniffi.impala_ffi.HomeArticleInfo
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary
import java.util.Calendar
import java.util.TimeZone

/**
 * Startseite (Home) mit Schnellaktionen, zuletzt bearbeiteten Seiten, Lernstand und Sync-Status
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    core: ImpalaCore,
    syncUiModel: SyncUiModel?,
    onOpenNote: (String) -> Unit,
    onOpenHeft: (String) -> Unit,
    onStartStudy: (String?) -> Unit,
    onScanDocument: () -> Unit,
    onOpenSyncAndSettings: () -> Unit,
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()
    var recentPages by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    var decks by remember { mutableStateOf<List<DeckOverview>>(emptyList()) }
    var articles by remember { mutableStateOf<List<HomeArticleInfo>>(emptyList()) }
    var conflictCount by remember { mutableStateOf(0u) }

    val utcOffsetMinutes = remember {
        val tz = TimeZone.getDefault()
        tz.getOffset(System.currentTimeMillis()) / (1000 * 60)
    }

    fun loadData() {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                recentPages = core.recentPages(16u)
                decks = core.deckOverview(utcOffsetMinutes, mix = false)
                articles = core.homeArticles(5u)
                conflictCount = core.conflictCount()
            } catch (e: Exception) {
                // Fehler abfangen
            }
        }
    }

    LaunchedEffect(Unit) {
        loadData()
    }

    // Berechnung fälliger Karten gesamt
    val totalDue = decks.sumOf { (it.learn + it.review).toInt() }
    val totalNew = decks.sumOf { it.new.toInt() }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        // 1. Header mit Impala67-Logo & Sync-Status
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "Impala67",
                        color = TextPrimary,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.5).sp
                    )
                    Text(
                        text = "Local-First Notizen & Lernen",
                        color = TextSecondary,
                        fontSize = 12.sp
                    )
                }

                // Sync-Status & Konflikt-Badge
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (conflictCount > 0u) {
                        Surface(
                            shape = ImpalaPillShape,
                            color = DangerSoft,
                            border = androidx.compose.foundation.BorderStroke(1.dp, Danger),
                            modifier = Modifier
                                .clip(ImpalaPillShape)
                                .clickable { onOpenSyncAndSettings() }
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.WarningAmber,
                                    contentDescription = "Konflikte",
                                    tint = Danger,
                                    modifier = Modifier.size(14.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = "$conflictCount Konflikt${if (conflictCount > 1u) "e" else ""}",
                                    color = Danger,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }
                    }

                    // Sync-Pille
                    val isSyncing = syncUiModel is SyncUiModel.Syncing
                    val hasError = syncUiModel is SyncUiModel.Error
                    val isDisconnected = syncUiModel is SyncUiModel.Disconnected
                    val syncIcon = when {
                        hasError -> Icons.Rounded.CloudOff
                        isSyncing -> Icons.Rounded.CloudSync
                        isDisconnected -> Icons.Rounded.CloudOff
                        else -> Icons.Rounded.CloudDone
                    }
                    val syncColor = when {
                        hasError -> Danger
                        isSyncing -> Accent
                        isDisconnected -> TextMuted
                        else -> Success
                    }
                    val syncText = when (syncUiModel) {
                        is SyncUiModel.Syncing -> syncUiModel.label.ifEmpty { "Synchronisiert…" }
                        is SyncUiModel.Error -> "Sync-Fehler"
                        is SyncUiModel.Disconnected -> "Offline"
                        is SyncUiModel.Idle -> "Bereit"
                        is SyncUiModel.Synced -> "Aktuell"
                        null -> "Aktuell"
                    }

                    Surface(
                        shape = ImpalaPillShape,
                        color = BgSidebar,
                        border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
                        modifier = Modifier
                            .clip(ImpalaPillShape)
                            .clickable { onOpenSyncAndSettings() }
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = syncIcon,
                                contentDescription = "Sync",
                                tint = syncColor,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = syncText,
                                color = TextSecondary,
                                fontSize = 11.sp
                            )
                        }
                    }
                }
            }
        }

        // 2. Schnellaktionen
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "SCHNELLAKTIONEN",
                    color = TextMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.8.sp
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    QuickActionCard(
                        title = "Neue Notiz",
                        icon = Icons.Rounded.EditNote,
                        color = Accent,
                        modifier = Modifier.weight(1f),
                        onClick = {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val id = core.createPage("Neue Notiz", "", null, null)
                                    withContext(Dispatchers.Main) { onOpenNote(id) }
                                } catch (e: Exception) {
                                    // Ignorieren
                                }
                            }
                        }
                    )
                    QuickActionCard(
                        title = "Neues Heft",
                        icon = Icons.Rounded.AutoStories,
                        color = Color(0xFFE8C65A),
                        modifier = Modifier.weight(1f),
                        onClick = {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val id = core.createHeft("Neues Heft", null, null)
                                    withContext(Dispatchers.Main) { onOpenHeft(id) }
                                } catch (e: Exception) {
                                    // Ignorieren
                                }
                            }
                        }
                    )
                    QuickActionCard(
                        title = "Scannen",
                        icon = Icons.Rounded.CameraAlt,
                        color = Success,
                        modifier = Modifier.weight(1f),
                        onClick = onScanDocument
                    )
                }
            }
        }

        // 3. Fällige Karteikarten / FSRS-Lernübersicht
        item {
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BgSidebar),
                border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Rounded.School,
                                contentDescription = null,
                                tint = Accent,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "Karteikarten (FSRS)",
                                color = TextPrimary,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }

                        if (totalDue > 0 || totalNew > 0) {
                            Surface(
                                shape = ImpalaPillShape,
                                color = WarnSoft,
                                border = androidx.compose.foundation.BorderStroke(1.dp, Warn)
                            ) {
                                Text(
                                    text = "$totalDue fällig · $totalNew neu",
                                    color = Warn,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    if (totalDue == 0 && totalNew == 0) {
                        Text(
                            text = "Großartig! Alle Karten für heute wiederholt.",
                            color = TextSecondary,
                            fontSize = 13.sp
                        )
                    } else {
                        Text(
                            text = "Bereit zum Lernen? Vertiefe dein Wissen im Spaced-Repetition-Rhythmus.",
                            color = TextSecondary,
                            fontSize = 13.sp
                        )
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = Accent,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { onStartStudy(null) }
                        ) {
                            Row(
                                modifier = Modifier.padding(vertical = 10.dp),
                                horizontalArrangement = Arrangement.Center,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = if (totalDue > 0) "Jetzt lernen ($totalDue)" else "Stapel üben",
                                    color = Color(0xFF081018),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Icon(
                                    imageVector = Icons.AutoMirrored.Rounded.ArrowForward,
                                    contentDescription = null,
                                    tint = Color(0xFF081018),
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    }
                }
            }
        }

        // 4. Zuletzt bearbeitete Seiten & Hefte
        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "ZULETZT BEARBEITET",
                    color = TextMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.8.sp
                )

                if (recentPages.isEmpty()) {
                    Text(
                        text = "Noch keine Notizen vorhanden. Erstelle deine erste Notiz oben!",
                        color = TextSecondary,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(vertical = 12.dp)
                    )
                } else {
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        maxItemsInEachRow = 2
                    ) {
                        for (page in recentPages) {
                            RecentPageCard(
                                page = page,
                                modifier = Modifier.weight(1f),
                                onClick = {
                                    if (page.kind == PageKind.HEFT) {
                                        onOpenHeft(page.id)
                                    } else {
                                        onOpenNote(page.id)
                                    }
                                }
                            )
                        }
                    }
                }
            }
        }

        // 5. Tagesartikel (Home Articles)
        if (articles.isNotEmpty()) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = "TAGESARTIKEL & IMPULSE",
                        color = TextMuted,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.8.sp
                    )

                    for (article in articles) {
                        ArticleCard(
                            article = article,
                            onMarkRead = {
                                coroutineScope.launch(Dispatchers.IO) {
                                    try {
                                        core.markHomeArticleRead(article.id)
                                        loadData()
                                    } catch (e: Exception) {
                                        // Ignorieren
                                    }
                                }
                            }
                        )
                    }
                }
            }
        }

        // Platzhalter für schwebendes Dock
        item {
            Spacer(modifier = Modifier.height(60.dp))
        }
    }
}

@Composable
private fun QuickActionCard(
    title: String,
    icon: ImageVector,
    color: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = BgSidebar,
        border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
    ) {
        Column(
            modifier = Modifier.padding(vertical = 14.dp, horizontal = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(color.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = title,
                    tint = color,
                    modifier = Modifier.size(20.dp)
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = title,
                color = TextPrimary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun RecentPageCard(
    page: PageSummary,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val isHeft = page.kind == PageKind.HEFT
    val icon = if (isHeft) Icons.Rounded.AutoStories else Icons.AutoMirrored.Rounded.Note
    val iconColor = if (isHeft) Color(0xFFE8C65A) else Accent

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = BgSidebar,
        border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = iconColor,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = page.title.ifEmpty { "Ohne Titel" },
                    color = TextPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = if (isHeft) "Heft" else "Notiz",
                    color = TextMuted,
                    fontSize = 11.sp
                )
            }
        }
    }
}

@Composable
private fun ArticleCard(
    article: HomeArticleInfo,
    onMarkRead: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = BgSidebar,
        border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
        modifier = modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = article.title,
                    color = TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )

                if (article.readAt != null) {
                    Icon(
                        imageVector = Icons.Rounded.CheckCircle,
                        contentDescription = "Gelesen",
                        tint = Success,
                        modifier = Modifier.size(18.dp)
                    )
                } else {
                    IconButton(
                        onClick = onMarkRead,
                        modifier = Modifier.size(24.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.CheckCircle,
                            contentDescription = "Als gelesen markieren",
                            tint = TextMuted,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }

            if (article.body.isNotEmpty()) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = article.body,
                    color = TextSecondary,
                    fontSize = 12.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}
