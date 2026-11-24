package org.impala67.app.study

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala

/** Posen des Leerlauf-Tiers (lernzeit.js `POSES`), bei jeder Pause die nächste. */
enum class IdlePose { PEEK, SLEEP, SIDE, BADGE }

/**
 * Leerlauf-Tier (`.lz-tier`, Zeichnung aus tools/lernzeit-tier.mjs): ein kleines Impala unten rechts, je Pause in
 * einer anderen Pose. Es fängt keine Berührungen ab – jede Eingabe setzt die Lernzeit fort, das Tier geht kurz danach.
 * Android hat unten rechts keinen KI-Knopf; die Plakette sitzt deshalb selbst in der Ecke.
 */
@Composable
fun IdleAnimal(visible: Boolean, pose: IdlePose, modifier: Modifier = Modifier) {
    val enter = when (pose) {
        IdlePose.SIDE -> slideInHorizontally { it }
        IdlePose.BADGE -> scaleIn()
        else -> slideInVertically { it }
    }
    val exit = when (pose) {
        IdlePose.SIDE -> slideOutHorizontally { it }
        IdlePose.BADGE -> scaleOut()
        else -> slideOutVertically { it }
    }
    AnimatedVisibility(
        visible,
        modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))
            .semantics { contentDescription = "Lernzeit pausiert – jede Eingabe setzt sie fort" },
        enter = enter, exit = exit,
    ) {
        when (pose) {
            IdlePose.PEEK, IdlePose.SLEEP -> Peek(sleep = pose == IdlePose.SLEEP)
            IdlePose.SIDE -> Image(
                painterResource(R.drawable.lz_tier), null,
                Modifier.padding(bottom = 44.dp).offset(x = 14.dp).size(72.dp, 66.dp).graphicsLayer { rotationZ = -62f },
            )
            IdlePose.BADGE -> Badge()
        }
    }
}

/** Kopf lugt über den unteren Rand (wach oder dösend mit „z z“). */
@Composable
private fun Peek(sleep: Boolean) {
    Box(Modifier.padding(end = 28.dp)) {
        Image(
            painterResource(if (sleep) R.drawable.lz_tier_schlaf else R.drawable.lz_tier), null,
            Modifier.size(72.dp, 54.dp), contentScale = ContentScale.FillWidth, alignment = Alignment.TopCenter,
        )
        if (sleep) {
            val t by rememberInfiniteTransition(label = "z").animateFloat(
                0f, 1f, infiniteRepeatable(tween(2400, easing = LinearEasing), RepeatMode.Restart), label = "z",
            )
            SleepZ(t, Modifier.align(Alignment.TopEnd).offset(x = 6.dp, y = (-8).dp), 13)
            SleepZ((t + 0.5f) % 1f, Modifier.align(Alignment.TopEnd).offset(x = 16.dp, y = (-18).dp), 11)
        }
    }
}

@Composable
private fun SleepZ(t: Float, modifier: Modifier, size: Int) {
    Text(
        "z", color = Impala.colors.text2, fontSize = size.sp, fontWeight = FontWeight.SemiBold,
        modifier = modifier.graphicsLayer {
            alpha = if (t < 0.3f) t / 0.3f else 1f - (t - 0.3f) / 0.7f
            translationX = t * 10.dp.toPx()
            translationY = -t * 20.dp.toPx()
        },
    )
}

/** Runde Plakette mit Impala und kleinem Pausezeichen in der Ecke. */
@Composable
private fun Badge() {
    val c = Impala.colors
    Box(Modifier.padding(end = 22.dp, bottom = 22.dp)) {
        Box(Modifier.size(42.dp).clip(CircleShape).background(c.menu).border(1.dp, c.edge, CircleShape)) {
            Image(
                painterResource(R.drawable.lz_tier), null,
                Modifier.requiredWidth(50.dp).offset(y = 5.dp).align(Alignment.TopCenter), contentScale = ContentScale.FillWidth,
            )
        }
        Icon(
            painterResource(R.drawable.ic_i_pause), null, tint = c.text2,
            modifier = Modifier.offset((-6).dp, (-6).dp).size(18.dp).background(c.menu, CircleShape).border(1.dp, c.edge, CircleShape).padding(4.dp),
        )
    }
}
