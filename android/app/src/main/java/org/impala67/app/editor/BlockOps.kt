package org.impala67.app.editor

import uniffi.impala_ffi.MdBlock
import uniffi.impala_ffi.MdBlockKind
import uniffi.impala_ffi.MdHeadingLevel
import uniffi.impala_ffi.MdListStyle
import uniffi.impala_ffi.mdContinuationBlock
import uniffi.impala_ffi.mdConvertBlock
import uniffi.impala_ffi.mdIndentBlock
import uniffi.impala_ffi.mdListNumbers
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
    val target = when (type) {
        BlockType.Text -> "text"
        BlockType.H1 -> "h1"
        BlockType.H2 -> "h2"
        BlockType.H3 -> "h3"
        BlockType.Bullet -> "bullet"
        BlockType.Number -> "number"
        BlockType.Todo -> "todo"
        BlockType.Quote -> "quote"
        BlockType.Code -> "code"
    }
    return mdConvertBlock(this, target)
}

/** Der Block, der beim Enter hinter diesem entsteht: Listen und Zitate setzen sich fort, sonst Absatz. */
internal fun MdBlock.continuation(): MdBlock {
    val newId = UUID.randomUUID().toString().take(8)
    return mdContinuationBlock(this, newId)?.lastOrNull() ?: paragraph()
}

internal fun MdBlock.withIndent(delta: Int): MdBlock =
    mdIndentBlock(this, delta)

internal fun MdBlock.withChecked(checked: Boolean): MdBlock {
    val k = kind as? MdBlockKind.ListItem ?: return this
    return if (k.style is MdListStyle.Todo) copy(kind = k.copy(style = MdListStyle.Todo(checked))) else this
}

/** Wendet [f] auf den Block mit [id] an, auch wenn er in Callout, Toggle oder Spalten steckt. */
internal fun List<MdBlock>.mapDeep(id: String, f: (MdBlock) -> MdBlock): List<MdBlock> = map { b ->
    if (b.id == id) return@map f(b)
    when (val k = b.kind) {
        is MdBlockKind.Callout -> b.copy(kind = k.copy(children = k.children.mapDeep(id, f)))
        is MdBlockKind.Toggle -> b.copy(kind = k.copy(children = k.children.mapDeep(id, f)))
        is MdBlockKind.Columns -> b.copy(kind = k.copy(columns = k.columns.map { it.mapDeep(id, f) }))
        else -> b
    }
}

/** Laufende Nummern nummerierter Listen je Ebene (wie `listNums` in editor.js). */
internal fun listNumbers(blocks: List<MdBlock>): Map<String, Int> =
    mdListNumbers(blocks).mapValues { it.value.toInt() }
