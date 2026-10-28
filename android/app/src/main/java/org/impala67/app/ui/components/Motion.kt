package org.impala67.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/** --ease-out der PWA. */
val EaseOut = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

/**
 * Sanftes Einblenden beim ersten Aufbau (`hv-in` in home.css): 6 dp von unten, 420 ms,
 * gestaffelt um 40 ms je [index]. Spätere Neuzeichnungen animieren nicht erneut.
 */
fun Modifier.riseIn(index: Int): Modifier = composed {
    val progress = remember { Animatable(0f) }
    val rise = with(LocalDensity.current) { 6.dp.toPx() }
    LaunchedEffect(Unit) { progress.animateTo(1f, tween(420, delayMillis = 40 * index.coerceAtMost(4), easing = EaseOut)) }
    graphicsLayer {
        alpha = progress.value
        translationY = (1f - progress.value) * rise
    }
}

/** Drücken: große Flächen 0.99, Knöpfe 0.97 (design.css); Feder aus dem Expressive-MotionScheme. */
fun Modifier.pressScale(interaction: InteractionSource, pressed: Float = 0.99f): Modifier = composed {
    val isPressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (isPressed) pressed else 1f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "press")
    graphicsLayer { scaleX = scale; scaleY = scale }
}
