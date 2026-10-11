"""
handwriting/augmentations.py
On-the-fly Daten-Augmentierung für Handschrift (Digital Ink). Alle Schritte arbeiten in normierten
Einheiten (1 = Median-Strichhöhe), damit sie auf Pixel-Strichen (eigene Zeilen) genauso stark wirken
wie auf Font-Synthese oder UJI-Glyphen:
1. Wortlayout (Abstände, Grundlinie und Größe je Wort)
2. Nachgetragene Striche (i-Punkte, t-Striche, Umlautpunkte erst am Wort- oder Zeilenende)
3. Striche trennen (kurzes Absetzen) und verbinden (Schreibschrift)
4. Skalierung, Neigung, leichte Drehung
5. Elastische Verzerrung und Zittern
Tempo-Rauschen fehlt bewusst: Die Vorverarbeitung resampelt äquidistant und entfernt es wieder.
"""

import math
import random
from typing import List, Tuple

Strokes = List[List[Tuple[float, float]]]


def _median_height(strokes: Strokes) -> float:
    heights = sorted(max(p[1] for p in s) - min(p[1] for p in s) for s in strokes if len(s) >= 2)
    heights = [h for h in heights if h > 1e-6]
    return heights[len(heights) // 2] if heights else 1.0


def _bbox(stroke) -> Tuple[float, float, float, float]:
    xs = [p[0] for p in stroke]
    ys = [p[1] for p in stroke]
    return min(xs), max(xs), min(ys), max(ys)


def _path_length(stroke) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(stroke, stroke[1:]))


def normalize_strokes(strokes: Strokes) -> Strokes:
    """Verschiebt nach (0, 0) und skaliert auf Median-Strichhöhe 1 (wie die Vorverarbeitung der App)."""
    pts = [p for s in strokes for p in s]
    if not pts:
        return strokes
    min_x = min(p[0] for p in pts)
    min_y = min(p[1] for p in pts)
    h = _median_height(strokes)
    if h <= 1e-6:
        h = max(1e-6, max(p[1] for p in pts) - min_y) or 1.0
    return [[((p[0] - min_x) / h, (p[1] - min_y) / h) for p in s] for s in strokes if s]


def split_words(strokes: Strokes, gap: float = 0.9) -> List[Strokes]:
    """Teilt normierte Striche an horizontalen Lücken in Wörter (wie segment_line_into_words)."""
    words: List[Strokes] = []
    right = None
    for s in strokes:
        x0, x1, _, _ = _bbox(s)
        if right is not None and x0 - right > gap:
            words.append([])
            right = None
        if not words:
            words.append([])
        words[-1].append(s)
        right = x1 if right is None else max(right, x1)
    return words


def vary_word_layout(strokes: Strokes) -> Strokes:
    """Verändert Wortabstände, Grundlinie und Größe je Wort: wie dieselbe Zeile, nur anders geschrieben."""
    words = split_words(strokes)
    if len(words) < 2:
        return strokes
    out: Strokes = []
    cursor = 0.0
    prev_right = None
    for w in words:
        x0 = min(p[0] for s in w for p in s)
        x1 = max(p[0] for s in w for p in s)
        if prev_right is not None:
            cursor += max(0.95, (x0 - prev_right) * random.uniform(0.6, 1.5))
        scale = random.uniform(0.92, 1.08)
        dy = random.uniform(-0.08, 0.08)
        out.extend([[(cursor + (p[0] - x0) * scale, p[1] * scale + dy) for p in s] for s in w])
        cursor += (x1 - x0) * scale
        prev_right = x1
    return out


def _is_small(stroke) -> bool:
    x0, x1, y0, y1 = _bbox(stroke)
    return max(x1 - x0, y1 - y0) < 0.4 and _path_length(stroke) < 0.6


def delay_diacritics(strokes: Strokes, line_prob: float = 0.15) -> Strokes:
    """Setzt kleine Striche im oberen Wortbereich (i-Punkte, Umlautpunkte) ans Wortende, manchmal ans
    Zeilenende. Auf dem Tablet tragen viele Punkte erst nach dem Wort nach. Satzzeichen auf der Grundlinie
    bleiben, wo sie sind: CTC braucht sie in Schreibreihenfolge."""
    out: Strokes = []
    line_tail: Strokes = []
    for w in split_words(strokes):
        body = [s for s in w if not _is_small(s)]
        if not body:
            out.extend(w)
            continue
        top = min(p[1] for s in body for p in s)
        bottom = max(p[1] for s in body for p in s)
        limit = top + 0.35 * (bottom - top)
        marks = [s for s in w[1:] if _is_small(s) and (_bbox(s)[2] + _bbox(s)[3]) / 2 < limit]
        out.extend(s for s in w if not any(s is m for m in marks))
        (line_tail if random.random() < line_prob else out).extend(marks)
    return out + line_tail


def split_strokes(strokes: Strokes, prob: float = 0.15) -> Strokes:
    """Trennt lange Striche an einer zufälligen Stelle mit kleiner Lücke (Stift kurz abgesetzt)."""
    out: Strokes = []
    for s in strokes:
        if len(s) >= 8 and _path_length(s) > 1.5 and random.random() < prob:
            cut = random.randint(3, len(s) - 4)
            out.extend([s[:cut], s[cut + 1:]])
        else:
            out.append(s)
    return out


def join_strokes(strokes: Strokes, prob: float = 0.3, max_gap: float = 0.4) -> Strokes:
    """Verbindet aufeinanderfolgende, nahe Striche zu einem (Schreibschrift ohne Absetzen)."""
    out: Strokes = []
    for s in strokes:
        if out:
            a, b = out[-1][-1], s[0]
            if math.hypot(b[0] - a[0], b[1] - a[1]) < max_gap and random.random() < prob:
                out[-1] = out[-1] + s
                continue
        out.append(list(s))
    return out


def apply_slant(strokes: Strokes, slant: float) -> Strokes:
    """Neigt die Handschrift nach links oder rechts (x' = x + (1 - y) * slant, Grundlinie bleibt)."""
    return [[(p[0] + (1.0 - p[1]) * slant, p[1]) for p in s] for s in strokes]


def apply_rotation(strokes: Strokes, degrees: float) -> Strokes:
    pts = [p for s in strokes for p in s]
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    c, si = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    return [[(cx + (p[0] - cx) * c - (p[1] - cy) * si, cy + (p[0] - cx) * si + (p[1] - cy) * c) for p in s] for s in strokes]


def apply_elastic_distortion(strokes: Strokes, intensity: float = 0.04) -> Strokes:
    """Glatte, nicht-rigide Verformung durch überlagerte niederfrequente Sinusfelder."""
    f1, f2, f3, f4 = (random.uniform(0.5, 2.5) for _ in range(4))
    p1, p2, p3, p4 = (random.uniform(0, 2 * math.pi) for _ in range(4))
    amp_x = random.uniform(0.01, intensity)
    amp_y = random.uniform(0.01, intensity)
    return [
        [
            (
                x + amp_x * (math.sin(y * f1 + p1) + math.cos(x * f2 + p2)),
                y + amp_y * (math.cos(x * f3 + p3) + math.sin(y * f4 + p4)),
            )
            for x, y in s
        ]
        for s in strokes
    ]


def apply_jitter(strokes: Strokes, sigma: float = 0.012) -> Strokes:
    """Mikrozittern der Hand."""
    return [[(x + random.gauss(0, sigma), y + random.gauss(0, sigma)) for x, y in s] for s in strokes]


def apply_augmentations_on_the_fly(strokes: Strokes) -> Strokes:
    """Kombiniert alle Augmentierungen zu einer neuen Trainingsinstanz (Ergebnis in normierten Einheiten)."""
    strokes = [s for s in strokes if s]
    if not strokes:
        return strokes
    res = normalize_strokes(strokes)

    if random.random() < 0.5:
        res = vary_word_layout(res)
    if random.random() < 0.3:
        res = delay_diacritics(res)
    if random.random() < 0.25:
        res = split_strokes(res)
    if random.random() < 0.25:
        res = join_strokes(res)
    if random.random() < 0.85:
        sx, sy = random.uniform(0.85, 1.2), random.uniform(0.85, 1.2)
        res = [[(x * sx, y * sy) for x, y in s] for s in res]
    if random.random() < 0.85:
        res = apply_slant(res, random.uniform(-0.35, 0.35))
    if random.random() < 0.4:
        res = apply_rotation(res, random.uniform(-4.0, 4.0))
    if random.random() < 0.8:
        res = apply_elastic_distortion(res, intensity=random.uniform(0.02, 0.06))
    if random.random() < 0.75:
        res = apply_jitter(res, sigma=random.uniform(0.005, 0.018))
    return res
