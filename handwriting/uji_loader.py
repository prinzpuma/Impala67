"""
handwriting/uji_loader.py
Parser und Loader für den offenen UJI Pen Characters v2 Datensatz (UCI).
Enthält über 11.000 echte handgeschriebene Zeichen von 60 Personen.
Wandelt sie in standardisierte [dx, dy, pen_down] Sequenzen für unser Modell um.
"""

import os
import random
from typing import Dict, List, Tuple

UJI_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ujipenchars2.txt")


def parse_uji_dataset(file_path: str = UJI_FILE) -> Dict[str, List[List[List[Tuple[float, float]]]]]:
    """
    Parst ujipenchars2.txt und gruppiert die Striche nach Zeichen.
    Rückgabe: Dict[char, List[strokes]] wobei strokes = List[stroke], stroke = List[(x, y)]
    """
    if not os.path.exists(file_path):
        return {}

    dataset: Dict[str, List[List[List[Tuple[float, float]]]]] = {}

    current_char = None
    current_strokes: List[List[Tuple[float, float]]] = []
    num_strokes_expected = 0

    with open(file_path, "r", encoding="latin-1") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("//"):
                continue

            if line.startswith("WORD "):
                # Neues Zeichen
                parts = line.split()
                if len(parts) >= 2:
                    current_char = parts[1]
                    current_strokes = []

            elif line.startswith("NUMSTROKES "):
                num_strokes_expected = int(line.split()[1])

            elif line.startswith("POINTS "):
                # Punkte eines Strichs: POINTS count # x1 y1 x2 y2 ...
                if "#" in line:
                    _, pts_str = line.split("#", 1)
                    raw_coords = pts_str.strip().split()
                    stroke_pts: List[Tuple[float, float]] = []
                    for i in range(0, len(raw_coords) - 1, 2):
                        try:
                            x = float(raw_coords[i])
                            y = float(raw_coords[i + 1])
                            stroke_pts.append((x, y))
                        except ValueError:
                            pass
                    if stroke_pts:
                        current_strokes.append(stroke_pts)

                if current_char and len(current_strokes) == num_strokes_expected and current_strokes:
                    if current_char not in dataset:
                        dataset[current_char] = []
                    dataset[current_char].append(current_strokes)
                    current_strokes = []

    return dataset


import math
from generate_synthetic import interpolate_points, generate_word_strokes

TYPOGRAPHY_BOUNDS = {
    # Kleinbuchstaben (x-Höhe 0.35..0.90)
    "a": (0.35, 0.90), "c": (0.35, 0.90), "e": (0.35, 0.90), "m": (0.35, 0.90),
    "n": (0.35, 0.90), "o": (0.35, 0.90), "r": (0.35, 0.90), "s": (0.35, 0.90),
    "u": (0.35, 0.90), "v": (0.35, 0.90), "w": (0.35, 0.90), "x": (0.35, 0.90),
    "z": (0.35, 0.90),
    # Kleinbuchstaben mit Oberlängen (0.05..0.90)
    "b": (0.05, 0.90), "d": (0.05, 0.90), "f": (0.05, 0.90), "h": (0.05, 0.90),
    "k": (0.05, 0.90), "l": (0.05, 0.90), "t": (0.15, 0.90), "ß": (0.05, 0.90),
    # Kleinbuchstaben mit Punkten (0.15..0.90 / Unterlänge)
    "i": (0.15, 0.90), "j": (0.15, 1.25),
    # Kleinbuchstaben mit Unterlängen (0.35..1.25)
    "g": (0.35, 1.25), "p": (0.35, 1.25), "q": (0.35, 1.25), "y": (0.35, 1.25),
    # Ziffern 0-9 (0.05..0.90)
    "0": (0.05, 0.90), "1": (0.05, 0.90), "2": (0.05, 0.90), "3": (0.05, 0.90),
    "4": (0.05, 0.90), "5": (0.05, 0.90), "6": (0.05, 0.90), "7": (0.05, 0.90),
    "8": (0.05, 0.90), "9": (0.05, 0.90),
    # Satzzeichen & Operatoren
    ".": (0.85, 0.92), ",": (0.85, 1.05), "-": (0.48, 0.54), "=": (0.40, 0.65),
    ":": (0.35, 0.90), ";": (0.35, 1.05), "!": (0.05, 0.92), "?": (0.05, 0.92),
    "+": (0.30, 0.70), "/": (0.05, 0.95), "(": (0.05, 0.95), ")": (0.05, 0.95),
}


def normalize_glyph_strokes(strokes: List[List[Tuple[float, float]]], char: str, step: float = 0.045) -> List[List[Tuple[float, float]]]:
    """Normalisiert ein Zeichen typografisch korrekt auf x-Höhe, Ober-/Unterlängen und resampelt äquidistant."""
    all_pts = [p for s in strokes for p in s]
    if not all_pts:
        return strokes
    min_x = min(p[0] for p in all_pts)
    max_x = max(p[0] for p in all_pts)
    min_y = min(p[1] for p in all_pts)
    max_y = max(p[1] for p in all_pts)
    raw_h = max(1.0, max_y - min_y)
    raw_w = max(1.0, max_x - min_x)

    # Typografische Ziel-Grenzen
    if char in TYPOGRAPHY_BOUNDS:
        tgt_top, tgt_bot = TYPOGRAPHY_BOUNDS[char]
    elif char.isupper():
        tgt_top, tgt_bot = (0.05, 0.90)
    elif char.islower():
        tgt_top, tgt_bot = (0.35, 0.90)
    else:
        tgt_top, tgt_bot = (0.10, 0.90)

    tgt_h = max(0.1, tgt_bot - tgt_top)
    aspect = raw_w / raw_h
    tgt_w = max(0.15, min(0.85, aspect * tgt_h))

    norm = []
    for s in strokes:
        if not s:
            continue
        mapped_s = []
        for p in s:
            nx = ((p[0] - min_x) / raw_w) * tgt_w
            ny = tgt_top + ((p[1] - min_y) / raw_h) * tgt_h
            mapped_s.append((nx, ny))

        # Äquidistantes Resampling für identische Punktdichte mit Browser-Preprocessor
        resampled = []
        for idx, pt in enumerate(mapped_s):
            if idx == 0:
                resampled.append(pt)
            else:
                prev = resampled[-1]
                resampled.extend(interpolate_points(prev, pt, step))
        if resampled:
            norm.append(resampled)

    return norm


class RealHandwritingSampler:
    """Baut aus echten menschlichen Glyphen ganze Wörter und Sequenzen mit natürlichen Proportionen."""

    def __init__(self, file_path: str = UJI_FILE):
        self.raw_data = parse_uji_dataset(file_path)
        print(f"UJI Pen Characters geladen: {len(self.raw_data)} verschiedene Zeichen, {sum(len(v) for v in self.raw_data.values())} Gesamtexemplare")

    def has_char(self, c: str) -> bool:
        return c in self.raw_data and len(self.raw_data[c]) > 0

    def get_real_word_strokes(self, word: str) -> List[List[Tuple[float, float]]]:
        """Setzt echte menschliche Striche für ein Wort typografisch korrekt aneinander."""
        word_strokes: List[List[Tuple[float, float]]] = []
        cursor_x = 0.0

        slant = random.uniform(-0.15, 0.20)
        scale_y = random.uniform(0.90, 1.10)

        for char in word:
            if char == " ":
                cursor_x += 0.40
                continue

            if self.has_char(char):
                raw_strokes = random.choice(self.raw_data[char])
                norm_strokes = normalize_glyph_strokes(raw_strokes, char)
                all_pts = [p for s in norm_strokes for p in s]
                char_w = max(p[0] for p in all_pts) if all_pts else 0.4

                for s in norm_strokes:
                    placed_s = []
                    for p in s:
                        x = cursor_x + p[0] + (p[1] * slant)
                        y = p[1] * scale_y
                        placed_s.append((x, y))
                    word_strokes.append(placed_s)

                cursor_x += char_w + random.uniform(0.06, 0.16)
            else:
                # Fallback für Umlaute oder Zeichen, die UJI nicht hat
                fallback = generate_word_strokes(char)
                all_pts = [p for s in fallback for p in s]
                char_w = max(p[0] for p in all_pts) if all_pts else 0.5
                for s in fallback:
                    placed_s = []
                    for p in s:
                        x = cursor_x + p[0] + (p[1] * slant)
                        y = p[1] * scale_y
                        placed_s.append((x, y))
                    word_strokes.append(placed_s)
                cursor_x += char_w + random.uniform(0.06, 0.16)

        return word_strokes


if __name__ == "__main__":
    sampler = RealHandwritingSampler()
    sample = sampler.get_real_word_strokes("Hallo")
    print(f"'Hallo' mit typografisch korrekten Strichen erzeugt: {len(sample)} Striche, {sum(len(s) for s in sample)} Punkte")

