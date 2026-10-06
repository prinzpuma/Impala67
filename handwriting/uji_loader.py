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


def normalize_glyph_strokes(strokes: List[List[Tuple[float, float]]]) -> List[List[Tuple[float, float]]]:
    """Normalisiert ein Zeichen auf Bounding Box Höhe 1.0 und zentriert."""
    all_pts = [p for s in strokes for p in s]
    if not all_pts:
        return strokes
    min_x = min(p[0] for p in all_pts)
    min_y = min(p[1] for p in all_pts)
    max_y = max(p[1] for p in all_pts)
    h = max(1.0, max_y - min_y)

    norm = []
    for s in strokes:
        norm.append([((p[0] - min_x) / h, (p[1] - min_y) / h) for p in s])
    return norm


class RealHandwritingSampler:
    """Baut aus echten menschlichen Glyphen ganze Wörter und Sequenzen."""

    def __init__(self, file_path: str = UJI_FILE):
        self.raw_data = parse_uji_dataset(file_path)
        print(f"UJI Pen Characters geladen: {len(self.raw_data)} verschiedene Zeichen, {sum(len(v) for v in self.raw_data.values())} Gesamtexemplare")

    def has_char(self, c: str) -> bool:
        return c in self.raw_data and len(self.raw_data[c]) > 0

    def get_real_word_strokes(self, word: str) -> List[List[Tuple[float, float]]]:
        """Setzt echte menschliche Striche für ein Wort aneinander."""
        word_strokes: List[List[Tuple[float, float]]] = []
        cursor_x = 0.0

        for char in word:
            if char == " ":
                cursor_x += 0.4
                continue

            if self.has_char(char):
                raw_strokes = random.choice(self.raw_data[char])
                norm_strokes = normalize_glyph_strokes(raw_strokes)

                all_pts = [p for s in norm_strokes for p in s]
                char_w = max(p[0] for p in all_pts) if all_pts else 0.5

                # Stochastische Neigung & Skalierung
                slant = random.uniform(-0.15, 0.2)
                scale_y = random.uniform(0.85, 1.15)

                for s in norm_strokes:
                    placed_s = []
                    for p in s:
                        x = cursor_x + p[0] + (p[1] * slant)
                        y = p[1] * scale_y
                        placed_s.append((x, y))
                    word_strokes.append(placed_s)

                cursor_x += char_w + random.uniform(0.08, 0.18)
            else:
                # Fallback für Zeichen die UJI nicht hat (z. B. Umlaute)
                cursor_x += 0.5

        return word_strokes


if __name__ == "__main__":
    sampler = RealHandwritingSampler()
    sample = sampler.get_real_word_strokes("Hallo")
    print(f"'Hallo' mit echten menschlichen Strichen erzeugt: {len(sample)} Striche, {sum(len(s) for s in sample)} Punkte")
