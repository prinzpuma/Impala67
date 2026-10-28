package org.impala67.app.editor

import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import uniffi.impala_ffi.MdBlock
import uniffi.impala_ffi.MdBlockKind

/**
 * Eingabefeld des gerade bearbeiteten Textblocks. Der Text ist der Markdown-Text des Blocks; fett,
 * kursiv, Links usw. werden nur gestaltet, die Zeichen bleiben stehen ([InlineTransformation]).
 * Enter teilt den Block, Rücktaste am Anfang verschmilzt (hier per Tastenereignis: Hardware-Tastatur
 * und Bildschirmtastaturen, die DEL als Taste senden).
 */
@Composable
internal fun BlockTextField(block: MdBlock, a: Active, vm: EditorViewModel, style: TextStyle, modifier: Modifier) {
    val c = Impala.colors
    val isCode = block.kind is MdBlockKind.Code
    val text = block.text()
    var value by remember(a.nonce) { mutableStateOf(TextFieldValue(text, TextRange(a.cursor.coerceIn(0, text.length)))) }
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var hadFocus by remember(a.nonce) { mutableStateOf(false) }

    // Verlauf (Rückgängig) oder Sync ändern den Text von außen.
    LaunchedEffect(text) {
        if (value.text != text) value = TextFieldValue(text, TextRange(value.selection.start.coerceAtMost(text.length)))
    }
    LaunchedEffect(a.nonce) {
        focus.requestFocus()
        keyboard?.show()
    }
    val transformation = remember(c, isCode) {
        if (isCode) VisualTransformation.None else InlineTransformation(InlineStyler(c, keepMarkers = true))
    }
    val placeholder = placeholderFor(block)
    BasicTextField(
        value = value,
        onValueChange = { v ->
            if (!isCode && v.text.contains('\n')) {
                vm.split(block.id, v.text.split('\n'))
            } else {
                value = v
                vm.onCursor(v.selection.start)
                if (v.text != text) vm.setText(block.id, v.text)
            }
        },
        modifier = modifier.fillMaxWidth().focusRequester(focus)
            .onFocusChanged { if (it.isFocused) hadFocus = true else if (hadFocus) vm.blur(a) }
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when {
                    e.key == Key.Backspace && value.selection.collapsed && value.selection.start == 0 -> { vm.backspaceAtStart(block.id); true }
                    e.key == Key.Tab && block.kind is MdBlockKind.ListItem -> { vm.indent(block.id, if (e.isShiftPressed) -1 else 1); true }
                    else -> false
                }
            },
        textStyle = style,
        cursorBrush = SolidColor(c.accent),
        visualTransformation = transformation,
        keyboardOptions = KeyboardOptions(
            capitalization = if (isCode) KeyboardCapitalization.None else KeyboardCapitalization.Sentences,
            autoCorrectEnabled = !isCode,
        ),
        decorationBox = { inner ->
            Box {
                if (value.text.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, style = style.copy(color = c.text2.copy(alpha = 0.45f)))
                inner()
            }
        },
    )
}

/** Komplexe Blöcke (Tabelle, Callout, Toggle, Spalten, Formel …) als Markdown-Rohtext bearbeiten. */
@Composable
internal fun RawBlockEditor(block: MdBlock, a: Active, vm: EditorViewModel, modifier: Modifier = Modifier) {
    val c = Impala.colors
    var value by remember(a.nonce) { mutableStateOf(TextFieldValue(vm.rawOf(block))) }
    val latest by rememberUpdatedState(value.text)
    val focus = remember { FocusRequester() }
    var hadFocus by remember(a.nonce) { mutableStateOf(false) }
    val shape = RoundedCornerShape(Radius.sm)
    LaunchedEffect(a.nonce) { focus.requestFocus() }
    DisposableEffect(a.nonce) { onDispose { vm.commitRaw(block.id, latest) } }
    BasicTextField(
        value = value,
        onValueChange = { value = it },
        modifier = modifier.fillMaxWidth().padding(vertical = 4.dp).clip(shape).background(c.surfaceSubtle)
            .border(1.dp, c.accentBorder, shape).padding(12.dp)
            .focusRequester(focus)
            .onFocusChanged { if (it.isFocused) hadFocus = true else if (hadFocus) { vm.commitRaw(block.id, latest); vm.blur(a) } },
        textStyle = TextStyle(color = c.text, fontFamily = FontFamily.Monospace, fontSize = 13.6.sp, lineHeight = 21.sp),
        cursorBrush = SolidColor(c.accent),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
    )
}
