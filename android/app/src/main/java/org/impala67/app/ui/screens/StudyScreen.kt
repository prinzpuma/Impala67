package org.impala67.app.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Flip
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Undo
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.ui.theme.Accent
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgDeep
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.DangerSoft
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.EdgeSoft
import org.impala67.app.ui.theme.ImpalaBouncySpringFloat
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.Success
import org.impala67.app.ui.theme.SuccessSoft
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.Warn
import org.impala67.app.ui.theme.WarnSoft
import uniffi.impala_ffi.CardInfo
import uniffi.impala_ffi.DeckOverview
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.StudyQueue
import java.util.TimeZone

/**
 * Karteikarten- & FSRS-5-Lernansicht mit Karten-Flip-Animation, Intervall-Vorschau und Stapel-Verwaltung
 */
@Composable
fun StudyScreen(
    core: ImpalaCore,
    initialDeck: String?,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()
    var selectedDeck by remember { mutableStateOf<String?>(initialDeck) }
    var decks by remember { mutableStateOf<List<DeckOverview>>(emptyList()) }
    var queue by remember { mutableStateOf<StudyQueue?>(null) }
    var isFlipped by remember { mutableStateOf(false) }
    var reviewIntervals by remember { mutableStateOf<List<String>>(emptyList()) }
    var canUndo by remember { mutableStateOf(false) }
    var isDeckDropdownOpen by remember { mutableStateOf(false) }
    var showNewCardDialog by remember { mutableStateOf(false) }
    var showNewDeckDialog by remember { mutableStateOf(false) }

    val utcOffsetMinutes = remember {
        val tz = TimeZone.getDefault()
        tz.getOffset(System.currentTimeMillis()) / (1000 * 60)
    }

    val currentCard = queue?.dueNow?.firstOrNull()

    fun loadStudyData() {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val allDecks = core.deckOverview(utcOffsetMinutes, mix = false)
                val q = core.studyQueue(selectedDeck, utcOffsetMinutes, mix = false)
                val undoPossible = core.canUndoReview()

                val intervals = q.dueNow.firstOrNull()?.let { card ->
                    core.reviewPreview(card.id)
                } ?: emptyList()

                withContext(Dispatchers.Main) {
                    decks = allDecks
                    queue = q
                    reviewIntervals = intervals
                    canUndo = undoPossible
                    isFlipped = false
                }
            } catch (e: Exception) {
                // Fehler abfangen
            }
        }
    }

    LaunchedEffect(selectedDeck) {
        loadStudyData()
    }

    fun submitRating(grade: UByte) {
        val cardId = currentCard?.id ?: return
        coroutineScope.launch(Dispatchers.IO) {
            try {
                core.reviewCard(cardId, grade)
                loadStudyData()
            } catch (e: Exception) {
                // Fehler ignorieren
            }
        }
    }

    fun undoReview() {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                core.undoReview()
                loadStudyData()
            } catch (e: Exception) {
                // Fehler ignorieren
            }
        }
    }

    // 3D-Karten-Flip-Animation
    val rotation by animateFloatAsState(
        targetValue = if (isFlipped) 180f else 0f,
        animationSpec = ImpalaBouncySpringFloat,
        label = "cardFlip"
    )

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel)
            .padding(16.dp)
    ) {
        // Kopfzeile: Zurück, Stapel-Wahl, Rückgängig, Neue Karte
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                        contentDescription = "Zurück",
                        tint = TextPrimary
                    )
                }

                // Stapel-Auswahl
                Box {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = BgSidebar,
                        border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { isDeckDropdownOpen = true }
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = selectedDeck ?: "Alle Stapel",
                                color = TextPrimary,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Icon(
                                imageVector = Icons.Rounded.ExpandMore,
                                contentDescription = null,
                                tint = TextSecondary,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }

                    DropdownMenu(
                        expanded = isDeckDropdownOpen,
                        onDismissRequest = { isDeckDropdownOpen = false },
                        modifier = Modifier.background(BgSidebar)
                    ) {
                        DropdownMenuItem(
                            text = { Text("Alle Stapel", color = if (selectedDeck == null) Accent else TextPrimary) },
                            onClick = {
                                selectedDeck = null
                                isDeckDropdownOpen = false
                            }
                        )
                        HorizontalDivider(color = EdgeSoft)
                        for (d in decks) {
                            DropdownMenuItem(
                                text = {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Text(d.name, color = if (selectedDeck == d.name) Accent else TextPrimary)
                                        Text(
                                            "${d.due} fällig",
                                            color = if (d.due > 0u) Warn else TextMuted,
                                            fontSize = 11.sp
                                        )
                                    }
                                },
                                onClick = {
                                    selectedDeck = d.name
                                    isDeckDropdownOpen = false
                                }
                            )
                        }
                        HorizontalDivider(color = EdgeSoft)
                        DropdownMenuItem(
                            text = { Text("+ Neuer Stapel", color = Accent) },
                            onClick = {
                                isDeckDropdownOpen = false
                                showNewDeckDialog = true
                            }
                        )
                    }
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                if (canUndo) {
                    IconButton(onClick = { undoReview() }) {
                        Icon(
                            imageVector = Icons.Rounded.Undo,
                            contentDescription = "Bewertung rückgängig",
                            tint = Accent
                        )
                    }
                }
                IconButton(onClick = { showNewCardDialog = true }) {
                    Icon(
                        imageVector = Icons.Rounded.Add,
                        contentDescription = "Neue Karte",
                        tint = TextPrimary
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // FSRS Zähler-Balken (Neu, Lernen, Wiederholen)
        val q = queue
        if (q != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                CountChip(label = "Neu", count = q.new.toString(), color = Accent)
                CountChip(label = "Lernen", count = q.learn.toString(), color = Danger)
                CountChip(label = "Wiederholen", count = q.review.toString(), color = Success)
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Hauptbereich: Karte oder Fertig-Meldung
        if (currentCard == null) {
            // Stapel ist fertig gelernt
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(24.dp)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.CheckCircle,
                        contentDescription = null,
                        tint = Success,
                        modifier = Modifier.size(64.dp)
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Für heute alles gelernt!",
                        color = TextPrimary,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Großartige Leistung. Dein Gedächtnis festigt nun die gelernten Inhalte nach dem FSRS-Algorithmus.",
                        color = TextSecondary,
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = BgSidebar,
                        border = androidx.compose.foundation.BorderStroke(1.dp, Edge),
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { loadStudyData() }
                    ) {
                        Text(
                            text = "Aktualisieren",
                            color = Accent,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)
                        )
                    }
                }
            }
        } else {
            // Karte anzeigen (mit 3D-Flip)
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                Card(
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = BgSidebar),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Edge),
                    elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            rotationY = rotation
                            cameraDistance = 14f * density
                        }
                        .clickable {
                            if (!isFlipped) isFlipped = true
                        }
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(24.dp)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.SpaceBetween
                    ) {
                        if (rotation <= 90f) {
                            // Vorderseite
                            Column {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Surface(
                                        shape = ImpalaPillShape,
                                        color = AccentSoft
                                    ) {
                                        Text(
                                            text = currentCard.deck,
                                            color = Accent,
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Medium,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                        )
                                    }

                                    if (currentCard.leech) {
                                        Surface(
                                            shape = ImpalaPillShape,
                                            color = DangerSoft
                                        ) {
                                            Row(
                                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Rounded.Warning,
                                                    contentDescription = "Leech",
                                                    tint = Danger,
                                                    modifier = Modifier.size(12.dp)
                                                )
                                                Spacer(modifier = Modifier.width(3.dp))
                                                Text("Leech", color = Danger, fontSize = 10.sp)
                                            }
                                        }
                                    }
                                }

                                Spacer(modifier = Modifier.height(24.dp))

                                Text(
                                    text = currentCard.front,
                                    color = TextPrimary,
                                    fontSize = 18.sp,
                                    lineHeight = 26.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }

                            Text(
                                text = "Tippen, um Antwort aufzudecken",
                                color = TextMuted,
                                fontSize = 12.sp,
                                textAlign = TextAlign.Center,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 16.dp)
                            )
                        } else {
                            // Rückseite (Spiegelung korrigieren per graphicsLayer)
                            Column(modifier = Modifier.graphicsLayer { rotationY = 180f }) {
                                Text(
                                    text = currentCard.front,
                                    color = TextSecondary,
                                    fontSize = 14.sp,
                                    lineHeight = 20.sp
                                )

                                HorizontalDivider(
                                    color = EdgeSoft,
                                    modifier = Modifier.padding(vertical = 16.dp)
                                )

                                Text(
                                    text = currentCard.back,
                                    color = TextPrimary,
                                    fontSize = 18.sp,
                                    lineHeight = 26.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }

                            Spacer(modifier = Modifier.height(8.dp))
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Bewertungs-Aktionen unten
            if (!isFlipped) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = Accent,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .clickable { isFlipped = true }
                ) {
                    Text(
                        text = "Antwort anzeigen",
                        color = Color(0xFF081018),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(vertical = 14.dp)
                    )
                }
            } else {
                // 4 FSRS-Knöpfe: Nochmal, Schwer, Gut, Einfach
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    val intervals = reviewIntervals
                    RatingButton(
                        label = "Nochmal",
                        sub = intervals.getOrNull(0) ?: "10m",
                        color = Danger,
                        modifier = Modifier.weight(1f),
                        onClick = { submitRating(1u) }
                    )
                    RatingButton(
                        label = "Schwer",
                        sub = intervals.getOrNull(1) ?: "1d",
                        color = Warn,
                        modifier = Modifier.weight(1f),
                        onClick = { submitRating(2u) }
                    )
                    RatingButton(
                        label = "Gut",
                        sub = intervals.getOrNull(2) ?: "3d",
                        color = Accent,
                        modifier = Modifier.weight(1f),
                        onClick = { submitRating(3u) }
                    )
                    RatingButton(
                        label = "Einfach",
                        sub = intervals.getOrNull(3) ?: "7d",
                        color = Success,
                        modifier = Modifier.weight(1f),
                        onClick = { submitRating(4u) }
                    )
                }
            }
        }
    }

    // Dialog: Neue Karte anlegen
    if (showNewCardDialog) {
        var frontText by remember { mutableStateOf("") }
        var backText by remember { mutableStateOf("") }
        var targetDeck by remember { mutableStateOf(selectedDeck ?: "Standard") }

        AlertDialog(
            onDismissRequest = { showNewCardDialog = false },
            title = { Text("Neue Karteikarte", color = TextPrimary) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Vorderseite (Frage):", color = TextSecondary, fontSize = 12.sp)
                    BasicTextField(
                        value = frontText,
                        onValueChange = { frontText = it },
                        textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp),
                        cursorBrush = SolidColor(Accent),
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 60.dp)
                            .background(BgBubble, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    )
                    Text("Rückseite (Antwort):", color = TextSecondary, fontSize = 12.sp)
                    BasicTextField(
                        value = backText,
                        onValueChange = { backText = it },
                        textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp),
                        cursorBrush = SolidColor(Accent),
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 60.dp)
                            .background(BgBubble, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val f = frontText.trim()
                        val b = backText.trim()
                        if (f.isNotEmpty() && b.isNotEmpty()) {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    core.createCard(f, b, targetDeck, null)
                                    loadStudyData()
                                } catch (e: Exception) {
                                    // Ignorieren
                                }
                            }
                        }
                        showNewCardDialog = false
                    }
                ) {
                    Text("Speichern", color = Accent)
                }
            },
            dismissButton = {
                TextButton(onClick = { showNewCardDialog = false }) {
                    Text("Abbrechen", color = TextSecondary)
                }
            },
            containerColor = BgSidebar
        )
    }

    // Dialog: Neuer Stapel
    if (showNewDeckDialog) {
        var deckName by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showNewDeckDialog = false },
            title = { Text("Neuer Stapel", color = TextPrimary) },
            text = {
                BasicTextField(
                    value = deckName,
                    onValueChange = { deckName = it },
                    textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp),
                    cursorBrush = SolidColor(Accent),
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BgBubble, RoundedCornerShape(8.dp))
                        .padding(12.dp)
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val name = deckName.trim()
                        if (name.isNotEmpty()) {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val cleaned = core.createDeck(name)
                                    withContext(Dispatchers.Main) {
                                        selectedDeck = cleaned
                                        loadStudyData()
                                    }
                                } catch (e: Exception) {
                                    // Ignorieren
                                }
                            }
                        }
                        showNewDeckDialog = false
                    }
                ) {
                    Text("Anlegen", color = Accent)
                }
            },
            dismissButton = {
                TextButton(onClick = { showNewDeckDialog = false }) {
                    Text("Abbrechen", color = TextSecondary)
                }
            },
            containerColor = BgSidebar
        )
    }
}

@Composable
private fun CountChip(label: String, count: String, color: Color) {
    Surface(
        shape = ImpalaPillShape,
        color = BgSidebar,
        border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(color)
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(text = "$label: $count", color = TextSecondary, fontSize = 11.sp)
        }
    }
}

@Composable
private fun RatingButton(
    label: String,
    sub: String,
    color: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = BgSidebar,
        border = androidx.compose.foundation.BorderStroke(1.dp, color.copy(alpha = 0.5f)),
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
    ) {
        Column(
            modifier = Modifier.padding(vertical = 10.dp, horizontal = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = label,
                color = color,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = sub,
                color = TextSecondary,
                fontSize = 11.sp,
                maxLines = 1
            )
        }
    }
}
