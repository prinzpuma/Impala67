package org.impala67.app.heft

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import org.json.JSONArray
import org.json.JSONObject

/** Seitenmaße des Kerns (`impala_heft::PAGE_W/PAGE_H`, in der PWA `heft-document-core.js`). */
object HeftPage {
    const val WIDTH = 1000f
    const val HEIGHT = 1414f
    const val RATIO = WIDTH / HEIGHT
}

/** Werkzeuge der Werkzeugleiste (Bilder und Laser folgen später). */
enum class HeftTool { PEN, MARKER, ERASER, LASSO }

/** Papiertypen des Kerns mit ihren Namen aus `heft-tools.js` (`PAPERS`). */
enum class Paper(val id: String, val label: String) {
    LINED("lined", "Liniert"), GRID("grid", "Kariert"), DOTS("dots", "Punkte"), BLANK("blank", "Blanko");

    companion object {
        fun of(id: String) = entries.firstOrNull { it.id == id } ?: LINED
    }
}

/** Farben und Dicken aus `heft-tools.js` (`COLORS`, `SIZES`, Radierergrößen aus `heft-toolbar-ui.js`). */
object HeftPalette {
    val colors = listOf("#1c1c1e", "#2f6fed", "#e0483e", "#1f9d55", "#f5b800", "#8b7cc8")
    val sizes = listOf("Fein" to 1.6, "Mittel" to 3.0, "Breit" to 5.5)
    val eraser = listOf("Klein" to 10.0, "Mittel" to 16.0, "Groß" to 30.0)

    /** CSS-Farbe des Kerns (`#rrggbb`, selten `#rgb`) → Android-ARGB; unlesbares wird Tintenschwarz. */
    fun parse(css: String): Int = runCatching { android.graphics.Color.parseColor(css) }.getOrDefault(0xFF1C1C1E.toInt())

    fun color(css: String) = Color(parse(css))
}

/** Ein Stift der Favoritenleiste (`DEFAULT_PENS`). */
@Immutable
data class PenSlot(val color: String, val size: Double)

/** Werkzeugzustand (in der PWA `tool`, `color`, `size`, `pens`, `penSlot`, `eraserSize`, `onlyPen`). */
@Immutable
data class HeftTools(
    val tool: HeftTool = HeftTool.PEN,
    val pens: List<PenSlot> = listOf(PenSlot("#1c1c1e", 3.0), PenSlot("#2f6fed", 3.0), PenSlot("#e0483e", 1.6)),
    val penSlot: Int = 0,
    /** Aktuelle Farbe und Dicke (`H.color`, `H.size`): Stift und Marker teilen sie wie in der PWA. */
    val color: String = pens[penSlot].color,
    val size: Double = pens[penSlot].size,
    val eraserSize: Double = 16.0,
    /** Standard wie in der PWA: nur der Stift zeichnet, der Finger scrollt und zoomt. */
    val onlyPen: Boolean = true,
    /** Optionsleiste (Farbe/Dicke bzw. Radiergröße) offen. */
    val expanded: Boolean = false,
) {
    /** Gespeicherter Teil wie `saveToolPrefs` (heft-tools.js); das Werkzeug selbst startet immer als Stift. */
    fun toJson(): String = JSONObject()
        .put("color", color).put("size", size).put("onlyPen", onlyPen).put("eraserSize", eraserSize).put("penSlot", penSlot)
        .put("pens", JSONArray(pens.map { JSONObject().put("color", it.color).put("size", it.size) }))
        .toString()

    companion object {
        /** `loadToolPrefs`: fehlende oder kaputte Werte fallen auf den Standard zurück. */
        fun fromJson(json: String): HeftTools {
            val d = HeftTools()
            val o = runCatching { JSONObject(json) }.getOrNull() ?: return d
            val arr = o.optJSONArray("pens")
            val pens = d.pens.mapIndexed { i, p ->
                val e = arr?.optJSONObject(i)
                PenSlot(e?.optString("color")?.ifEmpty { null } ?: p.color, e?.optDouble("size")?.takeUnless { it.isNaN() } ?: p.size)
            }
            val slot = o.optInt("penSlot", 0).takeIf { it in pens.indices } ?: 0
            return HeftTools(
                pens = pens, penSlot = slot,
                color = o.optString("color").ifEmpty { pens[slot].color },
                size = o.optDouble("size").takeUnless { it.isNaN() } ?: pens[slot].size,
                eraserSize = o.optDouble("eraserSize").takeUnless { it.isNaN() } ?: d.eraserSize,
                onlyPen = o.optBoolean("onlyPen", true),
            )
        }
    }
}
