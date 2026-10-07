# Machbarkeitsstudie: 2D-Mathematik & MathWriting-Datensatz

## 1. Lizenz & Herkunft
- **Datensatz:** Google Research *MathWriting* (2024)
- **Lizenz:** Creative Commons Attribution 4.0 International (CC-BY 4.0)
- **Rechtliche Konsequenz:** 100 % freie Nutzung für Open-Source-Projekte und PWA-Distribution ohne Lizenzkonflikte.

## 2. Architektonischer Vergleich für Impala67
| Kriterium | 1D-CRNN + Geometrischer Zerleger (Aktuell) | Volles 2D-Seq2Seq / Encoder-Decoder (Vision/Tree) |
| :--- | :--- | :--- |
| **Modellgröße** | **< 3 MB (WebAssembly/ONNX)** | 35–150 MB (Transformers / Attention) |
| **Inferenzzeit** | **< 2 ms auf Mobilgeräten** | 150–800 ms (hoher Akkuverbrauch) |
| **Einzeilig & Brüche** | Sehr präzise (Bruchstrich teilt Zähler/Nenner) | Unterstützt beliebige Schachtelungen |
| **Browser-Tauglichkeit** | Sofort einsatzbereit in Web Worker | Benötigt WebGPU / große Download-Menge |

## 3. Empfohlene Roadmap für Impala67
1. **Phase 1 (Bereits aktiv & produktionsreif):**
   - Einzeilige Mathematik (Formeln wie `f(x)=x^2`, `a+b=c`, `1+2=3`, `v=s/t`) direkt über das 1D-Netz.
   - 2D-Brüche (`\frac{Zähler}{Nenner}`) über den geometrischen Bruch-Detektor in `handwriting-preprocessor.js`.
2. **Phase 2 (Erweiterung mit MathWriting Excerpt):**
   - Extraktion der Wurzel- (`\sqrt{...}`) und Exponenten-Klassen aus dem MathWriting-Subset.
   - Heuristisches Bounding-Box-Clustering für Überstriche und Hoch-/Tiefstellung analog zum Bruchstrich-Splitter.
   - Modell bleibt ultrakompakt (< 3.5 MB) und offline fähig.