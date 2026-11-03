package org.impala67.app.editor

import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.ui.theme.Impala

private val CELL_BR = Regex("<br\\s*/?>", RegexOption.IGNORE_CASE)

/**
 * Tabelle mit direkt bearbeitbaren Zellen (web/editor-table.js): Tab/Shift+Tab zur Nachbarzelle,
 * Tab in der letzten Zelle legt eine Zeile an, Enter springt in die Zelle darunter, ↑/↓ wechseln
 * die Zeile, Rücktaste in leerer Zelle geht zurück. Darunter „+ Zeile“ und „+ Spalte“.
 */
@Composable
internal fun TableEditor(id: String, rows: List<List<String>>, onChange: (List<List<String>>) -> Unit) {
    val c = Impala.colors
    val cols = rows.maxOfOrNull { it.size } ?: 0
    val grid = remember(rows) { rows.map { r -> List(cols) { r.getOrElse(it) { "" } } } }
    val focus = remember(id) { mutableMapOf<Pair<Int, Int>, FocusRequester>() }
    var pending by remember(id) { mutableStateOf<Pair<Int, Int>?>(null) }
    LaunchedEffect(pending, grid) {
        pending?.let { p -> focus[p]?.let { runCatching { it.requestFocus() } }; pending = null }
    }

    fun set(r: Int, col: Int, text: String) = onChange(grid.mapIndexed { i, row -> if (i == r) row.mapIndexed { j, v -> if (j == col) text else v } else row })
    fun addRow(): Int { onChange(grid + listOf(List(cols) { "" })); return grid.size }
    fun addCol() = onChange(grid.map { it + "" })
    fun go(r: Int, col: Int) {
        when {
            col >= cols && r + 1 < grid.size -> pending = (r + 1) to 0
            col >= cols -> pending = addRow() to 0
            col < 0 && r > 0 -> pending = (r - 1) to (cols - 1)
            col < 0 -> Unit
            r >= grid.size -> pending = addRow() to col
            r >= 0 -> pending = r to col
        }
    }

    Column(Modifier.padding(vertical = 4.dp)) {
        Column(Modifier.horizontalScroll(rememberScrollState()).border(1.dp, c.edge)) {
            grid.forEachIndexed { r, row ->
                Row(Modifier.height(IntrinsicSize.Min)) {
                    row.forEachIndexed { col, cell ->
                        val req = focus.getOrPut(r to col) { FocusRequester() }
                        val shown = cell.replace(CELL_BR, "\n")
                        Box(Modifier.width(150.dp).fillMaxHeight().border(0.5.dp, c.edge).padding(horizontal = 10.dp, vertical = 5.dp)) {
                            BasicTextField(
                                value = shown,
                                onValueChange = { v ->
                                    // Enter der Bildschirmtastatur kommt als Zeilenumbruch: wie Enter → Zelle darunter.
                                    if (v.count { it == '\n' } > shown.count { it == '\n' }) {
                                        go(r + 1, col)
                                    } else {
                                        set(r, col, v.replace("\n", "<br>"))
                                    }
                                },
                                modifier = Modifier.focusRequester(req).onPreviewKeyEvent { e ->
                                    if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                                    when (e.key) {
                                        Key.Tab -> { go(r, if (e.isShiftPressed) col - 1 else col + 1); true }
                                        Key.Enter, Key.NumPadEnter -> { go(r + 1, col); true }
                                        Key.DirectionUp -> { if (r > 0) go(r - 1, col); r > 0 }
                                        Key.DirectionDown -> { if (r + 1 < grid.size) go(r + 1, col); r + 1 < grid.size }
                                        Key.Backspace -> if (cell.isEmpty() && (col > 0 || r > 0)) { go(r, col - 1); true } else false
                                        else -> false
                                    }
                                },
                                textStyle = TextStyle(color = c.text, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = if (r == 0) FontWeight.SemiBold else null),
                                cursorBrush = SolidColor(c.accent),
                                visualTransformation = remember(c) { InlineTransformation(InlineStyler(c, keepMarkers = true)) },
                            )
                        }
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(onClick = { pending = addRow() to 0 }) { Text("+ Zeile", color = c.text2, fontSize = 13.sp) }
            TextButton(onClick = { addCol(); pending = 0 to cols }) { Text("+ Spalte", color = c.text2, fontSize = 13.sp) }
        }
    }
}
