import SwiftUI
import UIKit
import WebKit

/// Was die WebView zeichnet (wie `RichBlocks.kt` / web/diagram.js): Formelblock (KaTeX), Textblock mit
/// Inline-Formeln, Mermaid-Diagramm oder SVG-Grafik.
enum RichKind: Equatable {
    case math
    /// Textblock mit `$…$`: HTML aus `inlineHTML`, Formeln setzt KaTeX; Schrift wie der Block.
    case inline(size: CGFloat, weight: Int, lineHeight: CGFloat)
    case mermaid
    case svg
}

/// Diagramm-Sprache eines Codeblocks (`diagramLang` in diagram.js), sonst nil.
func diagramKind(_ language: String) -> RichKind? {
    switch language.trimmingCharacters(in: .whitespaces).lowercased() {
    case "mermaid": .mermaid
    case "svg": .svg
    default: nil
    }
}

/// Formel, Diagramm oder SVG als Grafik. Nimmt keine Berührungen an, damit ein Tipp wie bei jedem
/// Block die Bearbeitung öffnet. `debounce` verzögert das Neuzeichnen beim Tippen (Live-Vorschau).
struct RichBlock: View {
    let kind: RichKind
    let source: String
    var debounce: Duration = .zero
    @Environment(\.colorScheme) private var scheme
    @State private var shown: String?
    @State private var height: CGFloat = 0

    var body: some View {
        let html = richHTML(kind, shown ?? source, dark: scheme == .dark)
        RichWebView(html: html) { h in
            if abs(h - height) > 0.5 { height = h }
        }
        .frame(height: max(height, minHeight))
        .frame(maxWidth: .infinity)
        .task(id: source) {
            if debounce > .zero, shown != nil { try? await Task.sleep(for: debounce) }
            if !Task.isCancelled { shown = source }
        }
    }

    private var minHeight: CGFloat {
        switch kind {
        case .math: 44
        case .inline(_, _, let lh): lh
        case .mermaid, .svg: 60
        }
    }
}

private struct RichWebView: UIViewRepresentable {
    let html: String
    let onHeight: (CGFloat) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(WeakHandler(context.coordinator), name: "size")
        let v = WKWebView(frame: .zero, configuration: config)
        v.isOpaque = false
        v.backgroundColor = .clear
        v.scrollView.backgroundColor = .clear
        v.scrollView.isScrollEnabled = false
        v.isUserInteractionEnabled = false
        return v
    }

    func updateUIView(_ v: WKWebView, context: Context) {
        context.coordinator.onHeight = onHeight
        guard context.coordinator.loaded != html else { return }
        context.coordinator.loaded = html
        v.loadHTMLString(html, baseURL: URL(string: "https://impala67.invalid/"))
    }

    static func dismantleUIView(_ v: WKWebView, coordinator: Coordinator) {
        v.configuration.userContentController.removeScriptMessageHandler(forName: "size")
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        var loaded: String?
        var onHeight: ((CGFloat) -> Void)?

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            if let h = message.body as? Double, h > 0 { onHeight?(CGFloat(h)) }
            else if let h = message.body as? Int, h > 0 { onHeight?(CGFloat(h)) }
        }

    }
}

/// `WKUserContentController` hält seinen Handler stark; so entsteht kein Kreis zur WebView.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(c, didReceive: message)
    }
}

// Gleiche Versionen und Prüfsummen wie die PWA (web/optional-modules.js); WebKit hält sie im Cache.
private let katexCSS = #"<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css" integrity="sha384-3rdsX6e5mueWyoweR9NIVmtEsUkokpBT/0ALqKKIBMr9j4qhHkaIkAcGgsE6uVlp" crossorigin="anonymous">"#
private let katexJS = #"<script src="https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.js" integrity="sha384-QFFtAGzvvj+bfgCGxXJlNZZR1nXEZgvG8tDLCCY1F19xl20WlfTYgguB4VcNdxYk" crossorigin="anonymous"></script>"#
private let mermaidJS = #"<script src="https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js" integrity="sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2" crossorigin="anonymous"></script>"#

private func cssColor(_ c: Color, dark: Bool) -> String {
    let ui = UIColor(c).resolvedColor(with: UITraitCollection(userInterfaceStyle: dark ? .dark : .light))
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    ui.getRed(&r, green: &g, blue: &b, alpha: &a)
    return String(format: "rgba(%d,%d,%d,%.3f)", Int(r * 255), Int(g * 255), Int(b * 255), a)
}

/// JSON-Zeichenkette für das Skript; maskiert auch „</“, damit das Skript nicht vorzeitig endet.
private func jsString(_ s: String) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: [s], options: [.fragmentsAllowed])) ?? Data("[\"\"]".utf8)
    let arr = String(decoding: data, as: UTF8.self)
    return String(arr.dropFirst().dropLast()).replacingOccurrences(of: "</", with: "<\\/")
}

private func richHTML(_ kind: RichKind, _ source: String, dark: Bool) -> String {
    let text = cssColor(Impala.text, dark: dark), text2 = cssColor(Impala.text2, dark: dark)
    let src = jsString(source)
    var head = "", outCSS = "", render = ""
    switch kind {
    case .math:
        head = katexCSS + katexJS
        outCSS = "#out { padding: 6px 0; text-align: center; overflow-x: auto; } .katex { font-size: 1.15em; }"
        render = """
        if (!window.katex) return fail("Formel braucht einmal Internet zum Laden.");
        if (!SRC.trim()) return fail("Leere Formel");
        try { katex.render(SRC, out, { displayMode: true, throwOnError: false }); done(); }
        catch (e) { fail("Formel-Fehler: " + e.message); }
        """
    case .inline(let size, let weight, let lineHeight):
        head = katexCSS + katexJS
        let colors = ["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"].map { n in
            ".c-\(n){color:\(cssColor(noteColor(n), dark: dark))}.bg-\(n){background:\(cssColor(noteColor(n).opacity(0.28), dark: dark))}"
        }.joined()
        outCSS = """
        #out { font: \(weight) \(size)px/\(lineHeight)px -apple-system, system-ui, sans-serif; text-align: left; }
        code { font-family: ui-monospace, monospace; font-size: 0.92em; color: \(cssColor(noteColor("red"), dark: dark)); }
        .a { color: \(cssColor(Impala.accent, dark: dark)); } .katex { font-size: 1.05em; } \(colors)
        """
        render = """
        out.innerHTML = SRC;
        out.querySelectorAll(".m").forEach(function (el) {
          if (window.katex) try { katex.render(el.getAttribute("data-tex"), el, { displayMode: false, throwOnError: false }); } catch (e) {}
        });
        done();
        """
    case .mermaid:
        head = mermaidJS
        render = """
        if (!SRC.trim()) return fail("Leeres Diagramm");
        if (!window.mermaid) return fail("Diagramm braucht einmal Internet zum Laden.");
        mermaid.initialize({ startOnLoad: false, theme: "\(dark ? "dark" : "default")", securityLevel: "strict", suppressErrorRendering: true });
        mermaid.render("d" + Date.now(), SRC).then(function (r) { out.innerHTML = r.svg; done(); })
          .catch(function (e) { fail("Diagramm-Fehler: " + (e && e.message || e)); });
        """
        outCSS = "#out { padding: 6px 0; text-align: center; }"
    case .svg:
        // Als Bild eingebunden: Skripte und Nachladen im SVG sind damit wirkungslos.
        render = """
        var s = SRC.trim();
        if (!/^<svg[\\s>]/i.test(s)) return fail("Kein gültiges SVG");
        if (!/xmlns=/.test(s.slice(0, 200))) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        var img = new Image(); img.onload = done; img.onerror = function () { fail("Kein gültiges SVG"); };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s); out.appendChild(img);
        """
        outCSS = "#out { padding: 6px 0; text-align: center; }"
    }
    return """
    <!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
    html, body { margin: 0; padding: 0; background: transparent; color: \(text); font-family: -apple-system, sans-serif; overflow: hidden; -webkit-text-size-adjust: 100%; }
    \(outCSS)
    #out svg, #out img { max-width: 100%; height: auto; }
    .msg { font-size: 13px; color: \(text2); text-align: left; }
    pre { white-space: pre-wrap; text-align: left; font-size: 13px; margin: 4px 0 0; }
    </style>\(head)</head><body><div id="out"></div><script>
    var SRC = \(src), out = document.getElementById("out");
    function done() { window.webkit.messageHandlers.size.postMessage(Math.ceil(document.documentElement.scrollHeight)); }
    function fail(msg) {
      out.textContent = "";
      var m = document.createElement("div"); m.className = "msg"; m.textContent = msg; out.appendChild(m);
      if (SRC.trim()) { var p = document.createElement("pre"); p.textContent = SRC; out.appendChild(p); }
      done();
    }
    new ResizeObserver(done).observe(document.body);
    window.addEventListener("load", function () {
    \(render)
    });
    </script></body></html>
    """
}
