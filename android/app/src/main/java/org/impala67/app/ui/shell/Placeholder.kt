package org.impala67.app.ui.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space

/** Platzhalter für noch nicht portierte Bildschirme (siehe android/PORTING.md). */
@Composable
fun Placeholder(title: String, hint: String, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(Space.s8),
        verticalArrangement = Arrangement.spacedBy(Space.s2, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        Text(hint, color = Impala.colors.text2, textAlign = TextAlign.Center)
    }
}
