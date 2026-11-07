package org.impala67.app.heft

import androidx.annotation.DrawableRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.TextSize

/**
 * Aktionsleiste der Lasso-Auswahl (heft-lasso.js `updateLassoBarUI`): Duplizieren, Löschen, Auswahl
 * aufheben. Handschrift liest die KI (Seitenbild), nicht das Lasso.
 */
@Composable
fun HeftLassoBar(vm: HeftViewModel, modifier: Modifier = Modifier) {
    val c = Impala.colors
    Row(modifier.heftFloat().padding(horizontal = 6.dp, vertical = 4.dp), Arrangement.spacedBy(4.dp), Alignment.CenterVertically) {
        LassoButton(R.drawable.ic_i_copy, "Duplizieren", onClick = vm::lassoDuplicate)
        LassoButton(R.drawable.ic_i_trash, "Löschen", onClick = vm::lassoDelete)
        Icon(
            painterResource(R.drawable.ic_i_x),
            "Auswahl aufheben",
            Modifier.size(30.dp, 32.dp).clip(CircleShape)
                .clickable(role = Role.Button, onClick = vm::clearLasso)
                .padding(horizontal = 9.dp, vertical = 10.dp),
            c.text2,
        )
    }
}

@Composable
private fun LassoButton(@DrawableRes icon: Int, label: String, onClick: () -> Unit) {
    val color = Impala.colors.text
    Row(
        Modifier.height(32.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 10.dp),
        Arrangement.spacedBy(6.dp),
        Alignment.CenterVertically,
    ) {
        Icon(painterResource(icon), null, Modifier.size(13.dp), color)
        Text(label, color = color, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}
