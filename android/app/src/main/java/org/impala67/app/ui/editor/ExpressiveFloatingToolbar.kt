package org.impala67.app.ui.editor

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.FormatIndentDecrease
import androidx.compose.material.icons.automirrored.rounded.FormatIndentIncrease
import androidx.compose.material.icons.automirrored.rounded.FormatListBulleted
import androidx.compose.material.icons.rounded.CheckBox
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.FormatBold
import androidx.compose.material.icons.rounded.FormatItalic
import androidx.compose.material.icons.rounded.FormatListNumbered
import androidx.compose.material.icons.rounded.FormatQuote
import androidx.compose.material.icons.rounded.Highlight
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Title
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.ui.theme.Accent
import org.impala67.app.ui.theme.AccentBorder
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.DangerSoft
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.SurfaceHover
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import uniffi.impala_ffi.MdBlock
import uniffi.impala_ffi.MdBlockKind
import uniffi.impala_ffi.MdHeadingLevel
import uniffi.impala_ffi.MdListStyle

/**
 * Schwebende, animierte Material 3 Expressive Formatierungsleiste über der Bildschirmtastatur.
 * Passt sich dank `imePadding()` nahtlos an die Tastaturhöhe an.
 */
@Composable
fun ExpressiveFloatingToolbar(
    activeBlock: MdBlock?,
    isSpeechListening: Boolean,
    onToggleSpeech: () -> Unit,
    onWrapSelection: (prefix: String, suffix: String) -> Unit,
    onChangeBlockKind: (MdBlockKind) -> Unit,
    onIndentChange: (delta: Int) -> Unit,
    onColorChange: (textColor: String?, bgColor: String?) -> Unit,
    modifier: Modifier = Modifier
) {
    var showHeadingMenu by remember { mutableStateOf(false) }
    var showColorMenu by remember { mutableStateOf(false) }

    val infiniteTransition = rememberInfiniteTransition(label = "mic_pulse")
    val micPulseScale by infiniteTransition.animateFloat(
        initialValue = 1.0f,
        targetValue = 1.25f,
        animationSpec = infiniteRepeatable(
            animation = tween(600),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse_scale"
    )

    AnimatedVisibility(
        visible = activeBlock != null || isSpeechListening,
        enter = slideInVertically { it / 2 } + fadeIn(),
        exit = slideOutVertically { it / 2 } + fadeOut(),
        modifier = modifier
    ) {
        Surface(
            modifier = Modifier
                .imePadding()
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .fillMaxWidth(),
            shape = RoundedCornerShape(22.dp),
            color = BgPanel.copy(alpha = 0.94f),
            shadowElevation = 8.dp,
            border = androidx.compose.foundation.BorderStroke(1.dp, Edge)
        ) {
            Row(
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // --- Mikrofon für natives Diktat ---
                val micColor by animateColorAsState(
                    targetValue = if (isSpeechListening) Danger else TextSecondary,
                    label = "micColor"
                )
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(if (isSpeechListening) DangerSoft else Color.Transparent)
                        .clickable { onToggleSpeech() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Mic,
                        contentDescription = "Spracheingabe",
                        tint = micColor,
                        modifier = Modifier
                            .size(20.dp)
                            .then(if (isSpeechListening) Modifier.scale(micPulseScale) else Modifier)
                    )
                }

                ToolbarDivider()

                // --- Inline-Formatierungen (Fett, Kursiv, Textmarker, Cloze) ---
                ToolbarIconButton(
                    icon = Icons.Rounded.FormatBold,
                    description = "Fett (**)",
                    onClick = { onWrapSelection("**", "**") }
                )

                ToolbarIconButton(
                    icon = Icons.Rounded.FormatItalic,
                    description = "Kursiv (*)",
                    onClick = { onWrapSelection("*", "*") }
                )

                ToolbarIconButton(
                    icon = Icons.Rounded.Highlight,
                    description = "Markierung (==)",
                    onClick = { onWrapSelection("==", "==") }
                )

                ToolbarIconButton(
                    icon = Icons.Rounded.School,
                    description = "Lückentext-Karte ({{c1::...}})",
                    onClick = { onWrapSelection("{{c1::", "}}") },
                    tint = Accent
                )

                ToolbarDivider()

                // --- Block-Typ: Überschriften H1 - H3 ---
                Box {
                    ToolbarIconButton(
                        icon = Icons.Rounded.Title,
                        description = "Überschrift",
                        isActive = activeBlock?.kind is MdBlockKind.Heading,
                        onClick = { showHeadingMenu = true }
                    )

                    DropdownMenu(
                        expanded = showHeadingMenu,
                        onDismissRequest = { showHeadingMenu = false },
                        modifier = Modifier
                            .background(BgPanel)
                            .border(1.dp, Edge, RoundedCornerShape(12.dp))
                    ) {
                        DropdownMenuItem(
                            text = { Text("H1 Hauptüberschrift", color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 16.sp) },
                            onClick = {
                                val currentText = getBlockText(activeBlock?.kind)
                                onChangeBlockKind(MdBlockKind.Heading(MdHeadingLevel.H1, currentText))
                                showHeadingMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("H2 Abschnitt", color = TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 15.sp) },
                            onClick = {
                                val currentText = getBlockText(activeBlock?.kind)
                                onChangeBlockKind(MdBlockKind.Heading(MdHeadingLevel.H2, currentText))
                                showHeadingMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("H3 Unterabschnitt", color = TextPrimary, fontWeight = FontWeight.Medium, fontSize = 14.sp) },
                            onClick = {
                                val currentText = getBlockText(activeBlock?.kind)
                                onChangeBlockKind(MdBlockKind.Heading(MdHeadingLevel.H3, currentText))
                                showHeadingMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Normaler Absatz", color = TextSecondary, fontSize = 14.sp) },
                            onClick = {
                                val currentText = getBlockText(activeBlock?.kind)
                                onChangeBlockKind(MdBlockKind.Paragraph(currentText))
                                showHeadingMenu = false
                            }
                        )
                    }
                }

                // --- Listen: Bullet, Number, Todo ---
                ToolbarIconButton(
                    icon = Icons.AutoMirrored.Rounded.FormatListBulleted,
                    description = "Aufzählungsliste",
                    isActive = (activeBlock?.kind as? MdBlockKind.List)?.style is MdListStyle.Bullet,
                    onClick = {
                        val currentText = getBlockText(activeBlock?.kind)
                        val indent = (activeBlock?.kind as? MdBlockKind.List)?.indent ?: 0u
                        onChangeBlockKind(MdBlockKind.List(MdListStyle.Bullet, indent, currentText))
                    }
                )

                ToolbarIconButton(
                    icon = Icons.Rounded.FormatListNumbered,
                    description = "Nummerierte Liste",
                    isActive = (activeBlock?.kind as? MdBlockKind.List)?.style is MdListStyle.Number,
                    onClick = {
                        val currentText = getBlockText(activeBlock?.kind)
                        val indent = (activeBlock?.kind as? MdBlockKind.List)?.indent ?: 0u
                        onChangeBlockKind(MdBlockKind.List(MdListStyle.Number, indent, currentText))
                    }
                )

                ToolbarIconButton(
                    icon = Icons.Rounded.CheckBox,
                    description = "Todo-Checkbox",
                    isActive = (activeBlock?.kind as? MdBlockKind.List)?.style is MdListStyle.Todo,
                    onClick = {
                        val currentText = getBlockText(activeBlock?.kind)
                        val indent = (activeBlock?.kind as? MdBlockKind.List)?.indent ?: 0u
                        onChangeBlockKind(MdBlockKind.List(MdListStyle.Todo(checked = false), indent, currentText))
                    }
                )

                // --- Zitat, Code, Callout ---
                ToolbarIconButton(
                    icon = Icons.Rounded.FormatQuote,
                    description = "Zitat",
                    isActive = activeBlock?.kind is MdBlockKind.Quote,
                    onClick = {
                        val currentText = getBlockText(activeBlock?.kind)
                        onChangeBlockKind(MdBlockKind.Quote(currentText))
                    }
                )

                ToolbarIconButton(
                    icon = Icons.Rounded.Code,
                    description = "Codeblock",
                    isActive = activeBlock?.kind is MdBlockKind.Code,
                    onClick = {
                        val currentText = getBlockText(activeBlock?.kind)
                        onChangeBlockKind(MdBlockKind.Code("kotlin", currentText))
                    }
                )

                ToolbarIconButton(
                    icon = Icons.Rounded.Info,
                    description = "Callout-Hinweis",
                    isActive = activeBlock?.kind is MdBlockKind.Callout,
                    onClick = {
                        val currentText = getBlockText(activeBlock?.kind)
                        val child = MdBlock(
                            id = java.util.UUID.randomUUID().toString(),
                            kind = MdBlockKind.Paragraph(currentText),
                            textColor = null,
                            bgColor = null
                        )
                        onChangeBlockKind(MdBlockKind.Callout("blue", listOf(child)))
                    }
                )

                ToolbarDivider()

                // --- Einrückung vergrößern / verkleinern ---
                ToolbarIconButton(
                    icon = Icons.AutoMirrored.Rounded.FormatIndentDecrease,
                    description = "Ausrücken",
                    onClick = { onIndentChange(-1) }
                )

                ToolbarIconButton(
                    icon = Icons.AutoMirrored.Rounded.FormatIndentIncrease,
                    description = "Einrücken",
                    onClick = { onIndentChange(1) }
                )

                ToolbarDivider()

                // --- Block-Farbpalette ---
                Box {
                    ToolbarIconButton(
                        icon = Icons.Rounded.Palette,
                        description = "Blockfarbe",
                        isActive = activeBlock?.textColor != null || activeBlock?.bgColor != null,
                        onClick = { showColorMenu = true }
                    )

                    DropdownMenu(
                        expanded = showColorMenu,
                        onDismissRequest = { showColorMenu = false },
                        modifier = Modifier
                            .background(BgPanel)
                            .border(1.dp, Edge, RoundedCornerShape(12.dp))
                            .widthIn(min = 200.dp)
                    ) {
                        Text(
                            text = "Hintergrundfarbe",
                            color = TextMuted,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            ColorSwatch(color = Color.Transparent, label = "Standard") {
                                onColorChange(activeBlock?.textColor, null)
                                showColorMenu = false
                            }
                            ColorSwatch(color = Color(0x336B8CAE), label = "Blau") {
                                onColorChange(activeBlock?.textColor, "blue")
                                showColorMenu = false
                            }
                            ColorSwatch(color = Color(0x3372BC8F), label = "Grün") {
                                onColorChange(activeBlock?.textColor, "green")
                                showColorMenu = false
                            }
                            ColorSwatch(color = Color(0x33E8C65A), label = "Gelb") {
                                onColorChange(activeBlock?.textColor, "yellow")
                                showColorMenu = false
                            }
                            ColorSwatch(color = Color(0x33E97366), label = "Rot") {
                                onColorChange(activeBlock?.textColor, "red")
                                showColorMenu = false
                            }
                        }

                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Textfarbe",
                            color = TextMuted,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            ColorSwatch(color = TextPrimary, label = "Standard") {
                                onColorChange(null, activeBlock?.bgColor)
                                showColorMenu = false
                            }
                            ColorSwatch(color = Accent, label = "Blau") {
                                onColorChange("blue", activeBlock?.bgColor)
                                showColorMenu = false
                            }
                            ColorSwatch(color = Color(0xFF72BC8F), label = "Grün") {
                                onColorChange("green", activeBlock?.bgColor)
                                showColorMenu = false
                            }
                            ColorSwatch(color = Color(0xFFE8C65A), label = "Gelb") {
                                onColorChange("yellow", activeBlock?.bgColor)
                                showColorMenu = false
                            }
                            ColorSwatch(color = Danger, label = "Rot") {
                                onColorChange("red", activeBlock?.bgColor)
                                showColorMenu = false
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolbarIconButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    isActive: Boolean = false,
    tint: Color = TextSecondary
) {
    val bg = if (isActive) AccentSoft else Color.Transparent
    val effectiveTint = if (isActive) Accent else tint

    Box(
        modifier = Modifier
            .size(34.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = description,
            tint = effectiveTint,
            modifier = Modifier.size(19.dp)
        )
    }
}

@Composable
private fun ToolbarDivider() {
    Box(
        modifier = Modifier
            .width(1.dp)
            .height(18.dp)
            .background(Edge)
    )
}

@Composable
private fun ColorSwatch(
    color: Color,
    label: String,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(24.dp)
            .clip(CircleShape)
            .background(color)
            .border(1.dp, Edge, CircleShape)
            .clickable(onClick = onClick)
    )
}

/**
 * Extrahiert den reinen Text eines Blocks für Format-Konvertierungen.
 */
internal fun getBlockText(kind: MdBlockKind?): String {
    return when (kind) {
        is MdBlockKind.Paragraph -> kind.text
        is MdBlockKind.Heading -> kind.text
        is MdBlockKind.List -> kind.text
        is MdBlockKind.Quote -> kind.text
        is MdBlockKind.Code -> kind.text
        is MdBlockKind.Math -> kind.text
        is MdBlockKind.Other -> kind.text
        is MdBlockKind.Toggle -> kind.summary
        else -> ""
    }
}
