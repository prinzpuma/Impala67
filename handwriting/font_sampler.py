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
        font_size: int = 56,
    ) -> List[List[Tuple[float, float]]]:
        if not text or not text.strip():
            return []

        if font_path is None:
            font_path = random.choice(self.font_files)

        try:
            font = ImageFont.truetype(font_path, font_size)
        except Exception:
            font = ImageFont.load_default()

        # Canvas-Größe bestimmen
        dummy_img = Image.new("L", (1, 1), 0)
        draw = ImageDraw.Draw(dummy_img)
        bbox = draw.textbbox((10, 10), text, font=font)
        w = max(40, bbox[2] + 20)
        h = max(40, bbox[3] + 20)

        # Rendern
        img = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(img)
        draw.text((10, 10), text, fill=255, font=font)

        # Binarisieren
        arr = np.array(img) > 128
        if not np.any(arr):
            return []

        # Skelettieren mit skimage
        skel = skeletonize(arr)

        # In Striche in Schreibreihenfolge umwandeln
        strokes = skeleton_to_strokes(skel)
        return strokes


if __name__ == "__main__":
    synth = FontHandwritingSynthesizer()
    for word in ["Apfel", "Größe", "Straße", "Physik", "Test", "15 + 27 = 42"]:
        st = synth.render_word_strokes(word)
        pts_cnt = sum(len(s) for s in st)
        print(f"'{word}': {len(st)} Striche, {pts_cnt} Punkte.")
