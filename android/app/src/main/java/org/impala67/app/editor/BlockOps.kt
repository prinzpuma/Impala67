package org.impala67.app.editor

import uniffi.impala_ffi.MdBlock
import uniffi.impala_ffi.MdBlockKind
import uniffi.impala_ffi.MdHeadingLevel
import uniffi.impala_ffi.MdListStyle
import java.util.UUID

/** Blocktypen der Werkzeugleiste (SLASH-Liste in web/editor-menus.js, soweit tippbar). */
internal enum class BlockType(val label: String) {
    Text("Text"), H1("Überschrift 1"), H2("Überschrift 2"), H3("Überschrift 3"),
    Bullet("Aufzählung"), Todo("To-do-Liste"), Number("Nummerierte Liste"), Quote("Zitat"), Code("Code"),
}

/** Blöcke mit direkt tippbarem Text; alles andere wird als Ganzes angezeigt bzw. als Rohtext bearbeitet. */
internal fun MdBlock.isText() = kind.let {
    it is MdBlockKind.Paragraph || it is MdBlockKind.Heading || it is MdBlockKind.ListItem ||
        it is MdBlockKind.Quote || it is MdBlockKind.Code
}

internal fun MdBlock.text(): String = when (val k = kind) {
    is MdBlockKind.Paragraph -> k.text
    is MdBlockKind.Heading -> k.text
    is MdBlockKind.ListItem -> k.text
    is MdBlockKind.Quote -> k.text
    is MdBlockKind.Code -> k.text
    else -> ""
}

internal fun MdBlock.withText(t: String): MdBlock = copy(
    kind = when (val k = kind) {
        is MdBlockKind.Paragraph -> k.copy(text = t)
        is MdBlockKind.Heading -> k.copy(text = t)
        is MdBlockKind.ListItem -> k.copy(text = t)
        is MdBlockKind.Quote -> k.copy(text = t)
        is MdBlockKind.Code -> k.copy(text = t)
        else -> k
    },
)

internal fun MdBlock.type(): BlockType? = when (val k = kind) {
    is MdBlockKind.Paragraph -> BlockType.Text
    is MdBlockKind.Heading -> when (k.level) { MdHeadingLevel.H1 -> BlockType.H1; MdHeadingLevel.H2 -> BlockType.H2; MdHeadingLevel.H3 -> BlockType.H3 }
    is MdBlockKind.ListItem -> when (k.style) { MdListStyle.Bullet -> BlockType.Bullet; MdListStyle.Number -> BlockType.Number; is MdListStyle.Todo -> BlockType.Todo }
    is MdBlockKind.Quote -> BlockType.Quote
    is MdBlockKind.Code -> BlockType.Code
    else -> null
}

internal fun newBlock(kind: MdBlockKind) = MdBlock(UUID.randomUUID().toString().take(8), kind, null, null)

internal fun paragraph(text: String = "") = newBlock(MdBlockKind.Paragraph(text))

/** Block in einen anderen Textblock umwandeln; Text, Einzug und Farben bleiben. */
internal fun MdBlock.convertTo(type: BlockType): MdBlock {
    val t = text()
    val indent = (kind as? MdBlockKind.ListItem)?.indent ?: 0u
    val language = (kind as? MdBlockKind.Code)?.language.orEmpty()
    val k: MdBlockKind = when (type) {
        BlockType.Text -> MdBlockKind.Paragraph(t)
        BlockType.H1 -> MdBlockKind.Heading(MdHeadingLevel.H1, t)
        BlockType.H2 -> MdBlockKind.Heading(MdHeadingLevel.H2, t)
        BlockType.H3 -> MdBlockKind.Heading(MdHeadingLevel.H3, t)
        BlockType.Bullet -> MdBlockKind.ListItem(MdListStyle.Bullet, indent, t)
        BlockType.Number -> MdBlockKind.ListItem(MdListStyle.Number, indent, t)
        BlockType.Todo -> MdBlockKind.ListItem(MdListStyle.Todo(false), indent, t)
        BlockType.Quote -> MdBlockKind.Quote(t)
        BlockType.Code -> MdBlockKind.Code(language, t)
    }
    return copy(kind = k)
}

/** Der Block, der beim Enter hinter diesem entsteht: Listen und Zitate setzen sich fort, sonst Absatz. */
internal fun MdBlock.continuation(): MdBlock = when (val k = kind) {
    is MdBlockKind.ListItem -> newBlock(MdBlockKind.ListItem(if (k.style is MdListStyle.Todo) MdListStyle.Todo(false) else k.style, k.indent, ""))
    is MdBlockKind.Quote -> newBlock(MdBlockKind.Quote(""))
    else -> paragraph()
}

internal fun MdBlock.withIndent(delta: Int): MdBlock {
    val k = kind as? MdBlockKind.ListItem ?: return this
    return copy(kind = k.copy(indent = (k.indent.toInt() + delta).coerceIn(0, 6).toUInt()))
}

internal fun MdBlock.withChecked(checked: Boolean): MdBlock {
    val k = kind as? MdBlockKind.ListItem ?: return this
    return if (k.style is MdListStyle.Todo) copy(kind = k.copy(style = MdListStyle.Todo(checked))) else this
}

/** Laufende Nummern nummerierter Listen je Ebene (wie `listNums` in editor.js). */
internal fun listNumbers(blocks: List<MdBlock>): Map<String, Int> {
    val out = HashMap<String, Int>()
    val counters = IntArray(8)
    for (b in blocks) {
        val k = b.kind
        if (k is MdBlockKind.ListItem) {
            val i = k.indent.toInt().coerceIn(0, 7)
            for (d in i + 1..7) counters[d] = 0
            if (k.style is MdListStyle.Number) {
                counters[i]++
                out[b.id] = counters[i]
            } else {
                counters[i] = 0
            }
        } else {
            counters.fill(0)
        }
    }
    return out
}
