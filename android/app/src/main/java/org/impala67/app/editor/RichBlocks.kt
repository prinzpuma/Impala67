package org.impala67.app.editor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color as AndroidColor
import android.view.MotionEvent
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.delay
import org.impala67.app.ui.theme.Impala
import org.json.JSONObject

/** Was die WebView zeichnet: Formelblock (KaTeX), Inline-Formel, Mermaid-Diagramm oder SVG-Grafik (web/diagram.js). */
internal enum class RichKind { Math, InlineMath, Mermaid, Svg }

/** Diagramm-Sprache eines Codeblocks (`diagramLang` in diagram.js), sonst `null`. */
internal fun diagramKind(language: String): RichKind? = when (language.trim().lowercase()) {
    "mermaid" -> RichKind.Mermaid
    "svg" -> RichKind.Svg
    else -> null
}

// Gleiche Versionen und Prüfsummen wie die PWA (web/optional-modules.js); die WebView hält sie im Cache.
private const val KATEX_CSS = "https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css"
private const val KATEX_CSS_SRI = "sha384-3rdsX6e5mueWyoweR9NIVmtEsUkokpBT/0ALqKKIBMr9j4qhHkaIkAcGgsE6uVlp"
private const val KATEX_JS = "https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.js"
private const val KATEX_JS_SRI = "sha384-QFFtAGzvvj+bfgCGxXJlNZZR1nXEZgvG8tDLCCY1F19xl20WlfTYgguB4VcNdxYk"
private const val MERMAID_JS = "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js"
private const val MERMAID_JS_SRI = "sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2"

/**
 * Formel, Mermaid oder SVG als Grafik. Die WebView nimmt keine Berührungen an, damit ein Tipp wie bei
 * jedem Block die Bearbeitung öffnet. [debounceMs] verzögert das Neuzeichnen beim Tippen (Live-Vorschau).
 */
@Composable
internal fun RichBlock(kind: RichKind, source: String, modifier: Modifier = Modifier, debounceMs: Long = 0) {
    val c = Impala.colors
    val shown by produceState(source, source) { if (debounceMs > 0) delay(debounceMs); value = source }
    val html = remember(kind, shown, c.text, c.text2, c.isDark) { richHtml(kind, shown, c.text, c.text2, c.isDark) }
    var heightDp by remember { mutableFloatStateOf(if (kind == RichKind.Math) 56f else 120f) }
    AndroidView(
        factory = { ctx -> PassiveWebView(ctx) { _, h -> heightDp = h } },
        update = { it.show(html) },
        onRelease = { it.destroy() },
        modifier = modifier.fillMaxWidth().height(heightDp.dp),
    )
}

/** Inline-Formel `$…$` im Fließtext; meldet ihre Größe (dp), damit der Platzhalter im Text passt. */
@Composable
internal fun InlineMathView(source: String, onSize: (Float, Float) -> Unit, modifier: Modifier = Modifier) {
    val c = Impala.colors
    val html = remember(source, c.text, c.text2, c.isDark) { richHtml(RichKind.InlineMath, source, c.text, c.text2, c.isDark) }
    AndroidView(
        factory = { ctx -> PassiveWebView(ctx, onSize) },
        update = { it.show(html) },
        onRelease = { it.destroy() },
        modifier = modifier,
    )
}

/** WebView ohne Navigation, Datei- und Inhaltszugriff; meldet ihre Größe über `Impala.size`. */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
private class PassiveWebView(context: Context, onSize: (Float, Float) -> Unit) : WebView(context) {
    private var loaded: String? = null

    init {
        setBackgroundColor(AndroidColor.TRANSPARENT)
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.domStorageEnabled = false
        settings.cacheMode = WebSettings.LOAD_CACHE_ELSE_NETWORK
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
        }
        // Die Seite meldet nur ihre Größe (CSS-Pixel = dp bei `width=device-width`).
        addJavascriptInterface(object {
            @JavascriptInterface
            fun size(w: Float, h: Float) { post { if (h > 0) onSize(w, h) } }
        }, "Impala")
    }

    fun show(html: String) {
        if (html == loaded) return
        loaded = html
        loadDataWithBaseURL("https://impala67.invalid/", html, "text/html", "utf-8", null)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun dispatchTouchEvent(event: MotionEvent?) = false
}

private fun css(c: Color) = String.format("#%06X", c.toArgb() and 0xFFFFFF)

private fun richHtml(kind: RichKind, source: String, text: Color, text2: Color, dark: Boolean): String {
    val src = JSONObject.quote(source) // maskiert auch „</“, das Skript kann nicht vorzeitig enden
    val head = when (kind) {
        RichKind.Math, RichKind.InlineMath -> """<link rel="stylesheet" href="$KATEX_CSS" integrity="$KATEX_CSS_SRI" crossorigin="anonymous">
<script src="$KATEX_JS" integrity="$KATEX_JS_SRI" crossorigin="anonymous"></script>"""
        RichKind.Mermaid -> """<script src="$MERMAID_JS" integrity="$MERMAID_JS_SRI" crossorigin="anonymous"></script>"""
        RichKind.Svg -> ""
    }
    val render = when (kind) {
        RichKind.Math -> """
if (!window.katex) return fail("Formel braucht einmal Internet zum Laden.");
if (!SRC.trim()) return fail("Leere Formel");
try { katex.render(SRC, out, { displayMode: true, throwOnError: false }); done(); }
catch (e) { fail("Formel-Fehler: " + e.message); }"""
        RichKind.InlineMath -> """
if (!window.katex) { out.textContent = SRC; return done(); }
try { katex.render(SRC, out, { displayMode: false, throwOnError: false }); } catch (e) { out.textContent = SRC; }
done();"""
        RichKind.Mermaid -> """
if (!SRC.trim()) return fail("Leeres Diagramm");
if (!window.mermaid) return fail("Diagramm braucht einmal Internet zum Laden.");
mermaid.initialize({ startOnLoad: false, theme: ${if (dark) "\"dark\"" else "\"default\""}, securityLevel: "strict", suppressErrorRendering: true });
mermaid.render("d" + Date.now(), SRC).then(function (r) { out.innerHTML = r.svg; done(); })
  .catch(function (e) { fail("Diagramm-Fehler: " + (e && e.message || e)); });"""
        // Als Bild eingebunden: Skripte und Nachladen im SVG sind damit wirkungslos (statt DOMPurify).
        RichKind.Svg -> """
var s = SRC.trim();
if (!/^<svg[\s>]/i.test(s)) return fail("Kein gültiges SVG");
if (!/xmlns=/.test(s.slice(0, 200))) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
var img = new Image(); img.onload = done; img.onerror = function () { fail("Kein gültiges SVG"); };
img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s); out.appendChild(img);"""
    }
    val outCss = if (kind == RichKind.InlineMath) {
        "#out { display: inline-block; white-space: nowrap; font-size: 16px; line-height: 1.2; }\n.katex { font-size: 1.05em; }"
    } else {
        "#out { padding: 6px 0; text-align: center; overflow-x: auto; }\n.katex { font-size: 1.15em; }"
    }
    return """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html, body { margin: 0; padding: 0; background: transparent; color: ${css(text)}; font-family: sans-serif; overflow: hidden; }
$outCss
#out svg, #out img { max-width: 100%; height: auto; }
.msg { font-size: 13px; color: ${css(text2)}; text-align: left; }
pre { white-space: pre-wrap; text-align: left; font-size: 13px; margin: 4px 0 0; }
</style>$head</head><body><div id="out"></div><script>
var SRC = $src, out = document.getElementById("out");
function done() {
  var r = out.getBoundingClientRect();
  Impala.size(Math.ceil(r.width), Math.ceil(${if (kind == RichKind.InlineMath) "r.height" else "document.documentElement.scrollHeight"}));
}
function fail(msg) {
  out.textContent = "";
  var m = document.createElement("div"); m.className = "msg"; m.textContent = msg; out.appendChild(m);
  if (SRC.trim()) { var p = document.createElement("pre"); p.textContent = SRC; out.appendChild(p); }
  done();
}
new ResizeObserver(done).observe(document.body);
window.addEventListener("load", function () {$render
});
</script></body></html>"""
}
