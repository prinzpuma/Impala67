"""
handwriting/font_sampler.py
Font-Synthese Pipeline für Online-Handschrift (Digital Ink):
- Lädt >= 20 freie OFL Handschrift-Fonts (Caveat, Kalam, Patrick Hand, Dancing Script, etc.)
- Rendert Text/Wörter mit Pillow
- Skelettiert die Glyphen mit skimage.morphology.skeletonize
- Wandelt das 1-Pixel-Skelett in geordnete Striche in natürlicher Schreibreihenfolge um
- Unterstützt alle deutschen Zeichen inkl. ß, ä, ö, ü, Ä, Ö, Ü und Satzzeichen
"""

import os
import sys
import glob
import math
import random
import urllib.request
from typing import List, Tuple, Dict, Optional
import numpy as np
from PIL import Image, ImageFont, ImageDraw
from skimage.morphology import skeletonize

FONTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "fonts")

OFL_FONT_URLS: Dict[str, str] = {
    "Caveat": "https://github.com/google/fonts/raw/main/ofl/caveat/Caveat%5Bwght%5D.ttf",
    "Kalam": "https://github.com/google/fonts/raw/main/ofl/kalam/Kalam-Regular.ttf",
    "PatrickHand": "https://github.com/google/fonts/raw/main/ofl/patrickhand/PatrickHand-Regular.ttf",
    "DancingScript": "https://github.com/google/fonts/raw/main/ofl/dancingscript/DancingScript%5Bwght%5D.ttf",
    "ShadowsIntoLight": "https://github.com/google/fonts/raw/main/ofl/shadowsintolight/ShadowsIntoLight.ttf",
    "IndieFlower": "https://github.com/google/fonts/raw/main/ofl/indieflower/IndieFlower-Regular.ttf",
    "Pacifico": "https://github.com/google/fonts/raw/main/ofl/pacifico/Pacifico-Regular.ttf",
    "Courgette": "https://github.com/google/fonts/raw/main/ofl/courgette/Courgette-Regular.ttf",
    "GreatVibes": "https://github.com/google/fonts/raw/main/ofl/greatvibes/GreatVibes-Regular.ttf",
    "Sacramento": "https://github.com/google/fonts/raw/main/ofl/sacramento/Sacramento-Regular.ttf",
    "KaushanScript": "https://github.com/google/fonts/raw/main/ofl/kaushanscript/KaushanScript-Regular.ttf",
    "MarckScript": "https://github.com/google/fonts/raw/main/ofl/marckscript/MarckScript-Regular.ttf",
    "Handlee": "https://github.com/google/fonts/raw/main/ofl/handlee/Handlee-Regular.ttf",
    "BadScript": "https://github.com/google/fonts/raw/main/ofl/badscript/BadScript-Regular.ttf",
    "GochiHand": "https://github.com/google/fonts/raw/main/ofl/gochihand/GochiHand-Regular.ttf",
    "Neucha": "https://github.com/google/fonts/raw/main/ofl/neucha/Neucha.ttf",
    "Pangolin": "https://github.com/google/fonts/raw/main/ofl/pangolin/Pangolin-Regular.ttf",
    "ReenieBeanie": "https://github.com/google/fonts/raw/main/ofl/reeniebeanie/ReenieBeanie.ttf",
    "CoveredByYourGrace": "https://github.com/google/fonts/raw/main/ofl/coveredbyyourgrace/CoveredByYourGrace.ttf",
    "Delius": "https://github.com/google/fonts/raw/main/ofl/delius/Delius-Regular.ttf",
    "SedgwickAve": "https://github.com/google/fonts/raw/main/ofl/sedgwickave/SedgwickAve-Regular.ttf",
    "GloriaHallelujah": "https://github.com/google/fonts/raw/main/ofl/gloriahallelujah/GloriaHallelujah.ttf",
}


def ensure_fonts_downloaded(target_dir: str = FONTS_DIR) -> List[str]:
    os.makedirs(target_dir, exist_ok=True)
    downloaded = []
    for name, url in OFL_FONT_URLS.items():
        dest = os.path.join(target_dir, f"{name}.ttf")
        if not os.path.exists(dest) or os.path.getsize(dest) < 5000:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    with open(dest, "wb") as f:
                        f.write(resp.read())
            except Exception as e:
                continue
        if os.path.exists(dest) and os.path.getsize(dest) >= 5000:
            downloaded.append(dest)
    return downloaded


def skeleton_to_strokes(skel: np.ndarray) -> List[List[Tuple[float, float]]]:
    """Wandelt ein 2D-Binärskelett in geordnete Linienzüge (Striche) in natürlicher Schreibreihenfolge um."""
    ys, xs = np.where(skel)
    if len(xs) == 0:
        return []

    pts_set = set(zip(xs, ys))
    visited = set()

    # Nachbarschaft (8-verbunden)
    NEIGHBORS = [(-1, -1), (0, -1), (1, -1),
                 (-1,  0),          (1,  0),
                 (-1,  1), (0,  1), (1,  1)]

    def get_neighbors(p):
        x, y = p
        return [(x + dx, y + dy) for dx, dy in NEIGHBORS if (x + dx, y + dy) in pts_set]

    # Knotengrade ermitteln
    endpoints = []
    junctions = []
    for p in pts_set:
        deg = len(get_neighbors(p))
        if deg <= 1:
            endpoints.append(p)
        elif deg >= 3:
            junctions.append(p)

    # Sortiere Endpunkte von links nach rechts / oben nach unten
    endpoints.sort(key=lambda p: (p[0], p[1]))

    strokes = []

    # 1. Von Endpunkten ausgehende Pfade verfolgen
    for start in endpoints:
        if start in visited:
            continue
        path = [start]
        visited.add(start)
        cur = start
        while True:
            nbrs = [n for n in get_neighbors(cur) if n not in visited]
            if not nbrs:
                break
            # Wähle den flüssigsten Nachfolger (vorzugsweise nach rechts oder unten)
            nbrs.sort(key=lambda n: (n[0] - cur[0] < 0, n[1] - cur[1] < 0, abs(n[0] - cur[0]) + abs(n[1] - cur[1])))
            nxt = nbrs[0]
            visited.add(nxt)
            path.append(nxt)
            cur = nxt
            # Falls wir an einer Verzweigung ankommen, Pfad abschließen
            if cur in junctions and len(path) > 3:
                break
        if len(path) >= 1:
            strokes.append([(float(p[0]), float(p[1])) for p in path])

    # 2. Verbleibende Schleifen (z. B. 'o', '8', Schlaufen in 'e'/'b')
    remaining = [p for p in pts_set if p not in visited]
    remaining.sort(key=lambda p: (p[0], p[1]))

    for start in remaining:
        if start in visited:
            continue
        path = [start]
        visited.add(start)
        cur = start
        while True:
            nbrs = [n for n in get_neighbors(cur) if n not in visited]
            if not nbrs:
                break
            nxt = nbrs[0]
            visited.add(nxt)
            path.append(nxt)
            cur = nxt
        if len(path) >= 1:
            strokes.append([(float(p[0]), float(p[1])) for p in path])

    # Sortiere Striche in menschlicher Schreibreihenfolge (Primär nach X-Beginn, sekundär Y)
    strokes.sort(key=lambda s: (min(p[0] for p in s), min(p[1] for p in s)))
    return strokes


def _near(a: Tuple[float, float], b: Tuple[float, float], tol: float) -> bool:
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def _length(stroke) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(stroke, stroke[1:]))


def clean_skeleton_strokes(strokes: List[List[Tuple[float, float]]], spur_len: float) -> List[List[Tuple[float, float]]]:
    """Macht aus Skelett-Bruchstücken stiftähnliche Striche:
    1. Sporne entfernen (kurze Äste, die an einem anderen Strich hängen; freie Punkte wie i-Punkte bleiben)
    2. Bruchstücke, die sich an Verzweigungen berühren, zu durchgehenden Strichen verketten
    3. Treppenstufen der Pixel glätten"""
    owners: Dict[Tuple[int, int], set] = {}
    for i, s in enumerate(strokes):
        for p in s:
            owners.setdefault((int(p[0]), int(p[1])), set()).add(i)

    def touches_other(i: int, p) -> bool:
        x, y = int(p[0]), int(p[1])
        return any(owners.get((x + dx, y + dy), {i}) - {i} for dx in (-1, 0, 1) for dy in (-1, 0, 1))

    strokes = [
        s for i, s in enumerate(strokes)
        if _length(s) >= spur_len or not (touches_other(i, s[0]) or touches_other(i, s[-1]))
    ]

    remaining = sorted(strokes, key=lambda s: (min(p[0] for p in s), min(p[1] for p in s)))
    chained = []
    while remaining:
        cur = list(remaining.pop(0))
        extended = True
        while extended:
            extended = False
            for k, o in enumerate(remaining):
                if _near(cur[-1], o[0], 2.0):
                    cur.extend(o[1:])
                elif _near(cur[-1], o[-1], 2.0):
                    cur.extend(list(reversed(o))[1:])
                else:
                    continue
                remaining.pop(k)
                extended = True
                break
        chained.append(cur)

    smoothed = []
    for s in chained:
        if len(s) < 3:
            smoothed.append(s)
            continue
        mid = [((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3) for a, b, c in zip(s, s[1:], s[2:])]
        smoothed.append([s[0]] + mid + [s[-1]])
    return smoothed


class FontHandwritingSynthesizer:
    """Rendert Text in echten OFL-Handschriftfonts, skelettiert und erzeugt Strichsequenzen."""

    def __init__(self, font_dir: str = FONTS_DIR):
        self.font_files = ensure_fonts_downloaded(font_dir)
        if not self.font_files:
            raise RuntimeError(f"Keine Fonts in {font_dir} gefunden!")
        print(f"FontHandwritingSynthesizer initialisiert mit {len(self.font_files)} OFL-Fonts.")

    def render_word_strokes(
        self,
        text: str,
        font_path: Optional[str] = None,
        font_size: Optional[int] = None,
    ) -> List[List[Tuple[float, float]]]:
        if not text or not text.strip():
            return []
        if font_size is None:
            # Unterschiedliche Auflösung ergibt unterschiedlich feine Skelette
            font_size = random.randint(40, 72)

        if font_path is None:
            font_path = random.choice(self.font_files)

        try:
            font = ImageFont.truetype(font_path, font_size)
        except Exception:
            font = ImageFont.load_default()

        # Wörter einzeln rendern: Font-Leerzeichen sind viel schmaler als Wortlücken in echter Handschrift.
        # Gleicher Ursprung je Wort hält die Grundlinie gemeinsam.
        strokes: List[List[Tuple[float, float]]] = []
        cursor = 0.0
        for word in text.split():
            word_strokes = self._render_skeleton(word, font, font_size)
            if not word_strokes:
                continue
            x0 = min(p[0] for s in word_strokes for p in s)
            strokes.extend([[(p[0] - x0 + cursor, p[1]) for p in s] for s in word_strokes])
            cursor = max(p[0] for s in strokes for p in s) + random.uniform(0.35, 0.75) * font_size
        return strokes

    @staticmethod
    def _render_skeleton(text: str, font, font_size: int) -> List[List[Tuple[float, float]]]:
        draw = ImageDraw.Draw(Image.new("L", (1, 1), 0))
        bbox = draw.textbbox((10, 10), text, font=font)
        img = Image.new("L", (max(40, bbox[2] + 20), max(40, bbox[3] + 20)), 0)
        ImageDraw.Draw(img).text((10, 10), text, fill=255, font=font)
        arr = np.array(img) > 128
        if not np.any(arr):
            return []
        return clean_skeleton_strokes(skeleton_to_strokes(skeletonize(arr)), spur_len=0.08 * font_size)


if __name__ == "__main__":
    synth = FontHandwritingSynthesizer()
    for word in ["Apfel", "Größe", "Straße", "Physik", "Test", "15 + 27 = 42"]:
        st = synth.render_word_strokes(word)
        pts_cnt = sum(len(s) for s in st)
        print(f"'{word}': {len(st)} Striche, {pts_cnt} Punkte.")
