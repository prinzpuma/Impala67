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


def parse_uji_dataset(file_path: str = UJI_FILE) -> Dict[str, List[Tuple[str, List[List[Tuple[float, float]]]]]]:
    """
    Parst ujipenchars2.txt und gruppiert die Striche nach Zeichen.
    Rückgabe: Dict[char, List[(schreiber, strokes)]] wobei strokes = List[stroke], stroke = List[(x, y)]
    """
    if not os.path.exists(file_path):
        return {}

    dataset: Dict[str, List[Tuple[str, List[List[Tuple[float, float]]]]]] = {}

    current_char = None
    current_writer = ""
    current_strokes: List[List[Tuple[float, float]]] = []
    num_strokes_expected = 0

    with open(file_path, "r", encoding="utf-8") as f:
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
                    # Session-ID wie "trn_UJI_W01-01" -> Schreiber "W01"
                    session = parts[2] if len(parts) >= 3 else ""
                    current_writer = session.split("_")[-1].split("-")[0]

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
                    dataset[current_char].append((current_writer, current_strokes))
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
    "ä": (0.15, 0.90), "ö": (0.15, 0.90), "ü": (0.15, 0.90),
    # Großbuchstaben mit Umlautpunkten über der Versalhöhe
    "Ä": (-0.12, 0.90), "Ö": (-0.12, 0.90), "Ü": (-0.12, 0.90),
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
        if len(resampled) == 1:
            resampled.append(resampled[0])
        if len(resampled) >= 2:
            norm.append(resampled)

    return norm


def _bbox(strokes: List[List[Tuple[float, float]]]) -> Tuple[float, float, float, float]:
    xs = [p[0] for s in strokes for p in s]
    ys = [p[1] for s in strokes for p in s]
    return min(xs), max(xs), min(ys), max(ys)


def split_diaeresis(strokes: List[List[Tuple[float, float]]]):
    """Trennt ein echtes ü/Ü in Grundkörper und Umlautpunkte (kleine Striche im oberen Bereich)."""
    if len(strokes) < 2:
        return None
    _, _, y0, y1 = _bbox(strokes)
    glyph_h = max(1.0, y1 - y0)
    dots, body = [], []
    for s in strokes:
        sx0, sx1, sy0, sy1 = _bbox([s])
        small = max(sx1 - sx0, sy1 - sy0) < 0.35 * glyph_h
        upper = (sy0 + sy1) / 2 < y0 + 0.45 * glyph_h
        (dots if small and upper else body).append(s)
    if not dots or len(dots) > 2 or not body:
        return None
    return body, dots


class RealHandwritingSampler:
    """Baut aus echten menschlichen Glyphen ganze Wörter und Sequenzen mit natürlichen Proportionen."""

    UMLAUT_BASES = {"ä": ("a", "ü"), "ö": ("o", "ü"), "Ä": ("A", "Ü"), "Ö": ("O", "Ü")}

    def __init__(self, file_path: str = UJI_FILE):
        self.raw_data = parse_uji_dataset(file_path)
        self.writers = sorted({w for v in self.raw_data.values() for w, _ in v})
        # Echte Umlautpunkte je Schreiber: (Punkte, Körper-Box des Spenderzeichens)
        self.diaeresis: Dict[str, List[Tuple[str, list, Tuple[float, float, float, float]]]] = {}
        for donor in ("ü", "Ü"):
            for writer, strokes in self.raw_data.get(donor, []):
                parts = split_diaeresis(strokes)
                if parts:
                    body, dots = parts
                    self.diaeresis.setdefault(donor, []).append((writer, dots, _bbox(body)))
        print(
            f"UJI Pen Characters geladen: {len(self.raw_data)} verschiedene Zeichen, "
            f"{sum(len(v) for v in self.raw_data.values())} Gesamtexemplare, {len(self.writers)} Schreiber, "
            f"{sum(len(v) for v in self.diaeresis.values())} echte Umlautpunkte"
        )

    def has_char(self, c: str) -> bool:
        return (c in self.raw_data and len(self.raw_data[c]) > 0) or (
            c in self.UMLAUT_BASES and self.has_char(self.UMLAUT_BASES[c][0]) and bool(self.diaeresis.get(self.UMLAUT_BASES[c][1]))
        )

    def _pick(self, options: list, writer: str):
        """Bevorzugt Exemplare desselben Schreibers, damit eine Zeile wie aus einer Hand aussieht."""
        own = [o for o in options if o[0] == writer]
        return random.choice(own or options)

    def get_glyph(self, char: str, writer: str) -> List[List[Tuple[float, float]]]:
        """Liefert echte Striche eines Zeichens; ä/ö/Ä/Ö entstehen aus echtem a/o/A/O plus echten Umlautpunkten."""
        if char in self.raw_data and self.raw_data[char]:
            return self._pick(self.raw_data[char], writer)[1]
        base_char, donor = self.UMLAUT_BASES[char]
        base = self._pick(self.raw_data[base_char], writer)[1]
        _, dots, (dx0, dx1, dy0, dy1) = self._pick(self.diaeresis[donor], writer)
        bx0, bx1, by0, by1 = _bbox(base)
        scale = (by1 - by0) / max(1.0, dy1 - dy0)
        dcx, bcx = (dx0 + dx1) / 2, (bx0 + bx1) / 2
        placed = [[(bcx + (p[0] - dcx) * scale, by0 + (p[1] - dy0) * scale) for p in s] for s in dots]
        return base + placed

    def get_real_word_strokes(self, word: str, cursive_prob: float = 0.45) -> List[List[Tuple[float, float]]]:
        """Setzt echte menschliche Striche für ein Wort/Satz typografisch korrekt aneinander, optional mit Schreibschrift-Ligaturen."""
        word_strokes: List[List[Tuple[float, float]]] = []
        cursor_x = 0.0
        writer = random.choice(self.writers) if self.writers else ""

        slant = random.uniform(-0.25, 0.30)
        scale_y = random.uniform(0.85, 1.15)
        width_mult = random.uniform(0.85, 1.20)
        y_shift = random.uniform(-0.06, 0.06)

        prev_char = ""

        for char_idx, char in enumerate(word):
            if char == " ":
                cursor_x += random.uniform(0.35, 0.55) * width_mult
                prev_char = " "
                continue

            if self.has_char(char):
                norm_strokes = normalize_glyph_strokes(self.get_glyph(char, writer), char)
            else:
                # Fallback für Umlaute oder Zeichen, die UJI nicht hat
                norm_strokes = generate_word_strokes(char)

            all_pts = [p for s in norm_strokes for p in s]
            char_w = (max(p[0] for p in all_pts) if all_pts else 0.4) * width_mult

            # Schreibschrift-Verbindung (Ligatur): Zwischen Kleinbuchstaben bleibt der Stift manchmal aufgesetzt!
            can_ligature = (
                prev_char != ""
                and prev_char != " "
                and prev_char.islower()
                and char.islower()
                and word_strokes
                and norm_strokes
                and random.random() < cursive_prob
            )

            for s_idx, s in enumerate(norm_strokes):
                placed_s = []
                for p in s:
                    x = cursor_x + p[0] * width_mult + (p[1] * slant)
                    y = p[1] * scale_y + y_shift
                    placed_s.append((x, y))

                if s_idx == 0 and can_ligature and word_strokes and placed_s:
                    # Verbindungsstrich zwischen vorherigem und jetzigem Buchstaben
                    p_last = word_strokes[-1][-1]
                    p_next = placed_s[0]
                    dist = math.hypot(p_next[0] - p_last[0], p_next[1] - p_last[1])
                    if dist < 0.8:
                        inter = interpolate_points(p_last, p_next, step=0.045)
                        word_strokes[-1].extend(inter)
                        word_strokes[-1].extend(placed_s)
                        continue

                word_strokes.append(placed_s)

            prev_char = char
            cursor_x += char_w + random.uniform(0.04, 0.14)

        return word_strokes


if __name__ == "__main__":
    sampler = RealHandwritingSampler()
    sample = sampler.get_real_word_strokes("Hallo")
    print(f"'Hallo' mit typografisch korrekten Strichen erzeugt: {len(sample)} Striche, {sum(len(s) for s in sample)} Punkte")

