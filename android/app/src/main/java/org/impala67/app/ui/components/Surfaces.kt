package org.impala67.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize

/**
 * Karte der PWA (`.hv-continue`, `.hv-stat`, `.deck-row` … in design.css): Fläche `--panel-solid`,
 * Radius `--radius-xl`, 1-px-Ring `--edge-soft` statt Schatten. Mit [onClick] klickbar (Ripple + 0.99).
 */
@Composable
fun PanelCard(
    modifier: Modifier = Modifier,
    color: Color = Impala.colors.panel,
    border: Color = Impala.colors.edgeSoft,
    padding: PaddingValues = PaddingValues(0.dp),
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(Radius.xl)
    val stroke = BorderStroke(1.dp, border)
    if (onClick == null) {
        Surface(modifier, shape = shape, color = color, border = stroke) { Column(Modifier.padding(padding), content = content) }
    } else {
        val interaction = remember { MutableInteractionSource() }
        Surface(
            onClick = onClick, modifier = modifier.pressScale(interaction), shape = shape, color = color,
            border = stroke, interactionSource = interaction,
        ) { Column(Modifier.padding(padding), content = content) }
    }
}

/**
 * Pillen-Knopf der PWA (`.hv-btn`: Akzent-Tönung, fett; `.hv-pin`: schwächer, normal) als
 * Material-Button mit Expressive-Formwechsel beim Drücken. Höhe 44 dp (Touch-Ziel wie `pointer: coarse`).
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun TintButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    strong: Boolean = true,
    height: Dp = 44.dp,
    content: @Composable RowScope.() -> Unit,
) {
    val c = Impala.colors
    Button(
        onClick = onClick,
        modifier = modifier.defaultMinSize(minHeight = height),
        shapes = ButtonDefaults.shapes(shape = CircleShape, pressedShape = RoundedCornerShape(Radius.md)),
        colors = ButtonDefaults.buttonColors(
            containerColor = (if (strong) c.tint2 else c.tint).compositeOver(c.panel),
            contentColor = c.text,
        ),
        contentPadding = PaddingValues(horizontal = if (strong) 14.dp else 12.dp),
        content = content,
    )
}

/** Beschriftung für [TintButton]. */
@Composable
fun TintLabel(text: String, strong: Boolean = true) {
    Text(text, fontSize = if (strong) TextSize.base else TextSize.sm, fontWeight = if (strong) FontWeight.SemiBold else FontWeight.Medium, maxLines = 1)
}
