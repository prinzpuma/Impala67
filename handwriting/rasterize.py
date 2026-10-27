"""Striche → Zeilenbild für das Bild-Modell (image_model.py).

Gleiche Regeln wie core/impala-ink/src/raster.rs: Zeile auf 64 px Höhe skalieren (Bounding-Box mit Rand),
runde Strichenden, schwarz auf weiß, Werte in [0, 1], Breite auf ein Vielfaches von 4 aufgefüllt.
"""

from typing import List, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw

Strokes = List[List[Tuple[float, float]]]

IMAGE_HEIGHT = 64
PADDING = 6
STROKE_WIDTH = 2.5  # px im fertigen Bild
SUPERSAMPLE = 4


def features_to_strokes(feats) -> Strokes:
    """[dx, dy, pen_down, ...]-Features (mathwriting_loader) zurück in Striche: aufsummieren, bei pen_down = 0
    beginnt ein neuer Strich. So lassen sich die vorhandenen Punkt-Caches (MathWriting, BRUSH) als Bild nutzen."""
    strokes: Strokes = []
    x = y = 0.0
    cur = [(x, y)]
    for f in feats:
        x += float(f[0])
        y += float(f[1])
        if f[2] < 0.5:
            if len(cur) > 1:
                strokes.append(cur)
            cur = [(x, y)]
        else:
            cur.append((x, y))
    if len(cur) > 1:
        strokes.append(cur)
    return strokes


def pad_width(img: np.ndarray) -> np.ndarray:
    """Rechts mit Weiß auf ein Vielfaches von 4 auffüllen (Ausgabe-Schrittweite des Netzes)."""
    w = img.shape[1]
    target = max(4, (w + 3) // 4 * 4)
    if target == w:
        return img
    out = np.ones((img.shape[0], target), dtype=np.float32)
    out[:, :w] = img
    return out


def render_strokes(strokes: Strokes, stroke_width: Optional[float] = None, height: int = IMAGE_HEIGHT,
                   padding: int = PADDING) -> np.ndarray:
    """Gibt ein Graustufenbild [height, width] als float32 in [0, 1] zurück (1 = weiß)."""
    strokes = [s for s in strokes if s]
    if not strokes:
        return np.ones((height, 4), dtype=np.float32)
    ss = SUPERSAMPLE
    xs = [p[0] for s in strokes for p in s]
    ys = [p[1] for s in strokes for p in s]
    x0, y0 = min(xs), min(ys)
    h = max(max(ys) - y0, 1e-6)
    scale = (height - 2 * padding) * ss / h
    w = int((max(xs) - x0) * scale) + 2 * padding * ss + 1
    img = Image.new("L", (w, height * ss), 255)
    draw = ImageDraw.Draw(img)
    lw = max(1, int(round((stroke_width or STROKE_WIDTH) * ss)))
    r = lw / 2
    for s in strokes:
        pts = [((x - x0) * scale + padding * ss, (y - y0) * scale + padding * ss) for x, y in s]
        if len(pts) > 1:
            draw.line(pts, fill=0, width=lw, joint="curve")
        for x, y in (pts[0], pts[-1]):
            draw.ellipse([x - r, y - r, x + r, y + r], fill=0)
    img = img.resize((max(4, w // ss), height), Image.LANCZOS)
    return pad_width(np.asarray(img, dtype=np.float32) / 255.0)
