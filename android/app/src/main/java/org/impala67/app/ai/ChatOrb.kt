package org.impala67.app.ai

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.LocalAppearance

/** Leucht-Kugel mit ✦ über der Begrüßung (chat-start.css `.cs-orb`): dreht langsam und atmet; ruhig bei reduzierter Bewegung. */
@Composable
fun ChatOrb() {
    val c = Impala.colors
    val still = LocalAppearance.current.reduceMotion
    val t = rememberInfiniteTransition(label = "orb")
    val turn = t.animateFloat(0f, 360f, infiniteRepeatable(tween(18_000, easing = LinearEasing)), label = "turn")
    val breath = t.animateFloat(0.94f, 1.04f, infiniteRepeatable(tween(3_200), RepeatMode.Reverse), label = "breath")
    Box(Modifier.size(56.dp), contentAlignment = Alignment.Center) {
        Canvas(
            Modifier.size(56.dp)
                .scale(if (still) 1f else breath.value)
                .rotate(if (still) 0f else turn.value),
        ) {
            drawCircle(Brush.sweepGradient(listOf(c.accent, c.accent.copy(alpha = 0.35f), Color.White.copy(alpha = 0.5f), c.accent)))
            drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.35f), Color.Transparent)), radius = size.minDimension / 2.4f)
        }
        Text("✦", color = Color.White, fontSize = 20.sp)
    }
}
