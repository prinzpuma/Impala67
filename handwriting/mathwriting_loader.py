"""
handwriting/mathwriting_loader.py
Lädt und parst echte menschliche Vektor-Handschrift aus dem Google MathWriting Datensatz (CC-BY 4.0).
Konvertiert InkML-Striche in standardisierte [dx, dy, pen_down] Feature-Vektoren für CTC-Training.
"""

import os
import glob
import math
import re
import xml.etree.ElementTree as ET
from typing import List, Tuple, Dict, Optional

from vocabulary import CHAR_TO_IDX, BLANK_IDX

# LaTeX zu Vokabular-Mapping
LATEX_REPLACEMENTS = [
    (r"\\alpha", "α"),
    (r"\\beta", "β"),
    (r"\\lambda", "λ"),
    (r"\\pi", "π"),
    (r"\\sqrt", "√"),
    (r"\\int", "∫"),
    (r"\\sum", "∑"),
    (r"\\cdot", "*"),
    (r"\\times", "*"),
    (r"\\div", "/"),
    (r"\\leq", "<="),
    (r"\\geq", ">="),
    (r"\\neq", "!="),
    (r"\\pm", "+-"),
    (r"\\left\(", "("),
    (r"\\right\)", ")"),
    (r"\\left\[", "["),
    (r"\\right\]", "]"),
    (r"\\left\\{", "{"),
    (r"\\right\\}", "}"),
    (r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r"\1/\2"),
]


def clean_latex_label(raw_label: str) -> str:
    """Wandelt LaTeX-Labels in lesbare Zeichenketten unseres Vokabulars um."""
    if not raw_label:
        return ""
    text = raw_label
    for pattern, repl in LATEX_REPLACEMENTS:
        text = re.sub(pattern, repl, text)

    # Verbleibende LaTeX-Befehle bereinigen (z.B. \mathrm{x} -> x)
    text = re.sub(r"\\[a-zA-Z]+\{([^{}]+)\}", r"\1", text)
    text = re.sub(r"\\[a-zA-Z]+", "", text)
    text = text.replace("{", "").replace("}", "").replace("\\", "").strip()

    # Filter auf Zeichen, die in CHAR_TO_IDX existieren
    filtered = "".join(c for c in text if c in CHAR_TO_IDX and CHAR_TO_IDX[c] != BLANK_IDX)
    return filtered


def resample_stroke(pts: List[Tuple[float, float]], step: float) -> List[Tuple[float, float]]:
    """Resampelt einen Strich äquidistant (exakt wie im Web-Preprocessor)."""
    if len(pts) < 2:
        return pts
    out = [pts[0]]
    cur_dist = 0.0
    for i in range(len(pts) - 1):
        p0, p1 = pts[i], pts[i + 1]
        seg_dist = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        if seg_dist < 1e-6:
            continue
        walked = 0.0
        while cur_dist + (seg_dist - walked) >= step:
            rem = step - cur_dist
            walked += rem
            t = walked / seg_dist
            nx = p0[0] + (p1[0] - p0[0]) * t
            ny = p0[1] + (p1[1] - p0[1]) * t
            out.append((nx, ny))
            cur_dist = 0.0
        cur_dist += (seg_dist - walked)
    last = pts[-1]
    if len(out) < 2 or math.hypot(last[0] - out[-1][0], last[1] - out[-1][1]) > step * 0.5:
        out.append(last)
    return out


def parse_inkml_file(file_path: str) -> Optional[Tuple[List[List[Tuple[float, float]]], str]]:
    """Liest eine einzelne InkML-Datei aus und liefert (traces, label)."""
    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
        ns = {"ink": "http://www.w3.org/2003/InkML"}

        # Label ermitteln
        raw_label = None
        for ann in root.findall("ink:annotation", ns):
            atype = ann.attrib.get("type")
            if atype in ("normalizedLabel", "label") and ann.text:
                raw_label = ann.text
                if atype == "normalizedLabel":
                    break

        if not raw_label:
            return None

        clean_label = clean_latex_label(raw_label)
        if len(clean_label) == 0:
            return None

        traces = []
        for tr in root.findall("ink:trace", ns):
            if not tr.text:
                continue
            pts = []
            for token in tr.text.strip().split(","):
                parts = token.strip().split()
                if len(parts) >= 2:
                    try:
                        x = float(parts[0])
                        y = float(parts[1])
                        pts.append((x, y))
                    except ValueError:
                        pass
            if len(pts) >= 2:
                traces.append(pts)

        if not traces:
            return None

        return traces, clean_label
    except Exception:
        return None


def strokes_to_normalized_features(strokes: List[List[Tuple[float, float]]]) -> List[Tuple[float, float, float, float]]:
    """Wandelt Striche mit äquidistantem Resampling in [dx, dy, pen_down, y_rel] Features um."""
    all_pts = [p for s in strokes for p in s]
    if not all_pts:
        return []
    min_y = min(p[1] for p in all_pts)
    max_y = max(p[1] for p in all_pts)
    raw_h = max(10.0, max_y - min_y)
    step = max(0.6, raw_h * 0.045)

    resampled = [resample_stroke(s, step) for s in strokes]
    resampled = [s for s in resampled if len(s) >= 2]
    if not resampled:
        return []

    scale = 1.0 / raw_h
    feats = []
    last_x, last_y = None, None

    for s in resampled:
        first = s[0]
        first_y_rel = (first[1] - min_y) * scale - 0.5
        if last_x is not None:
            # Pen-Up Übergang
            feats.append(((first[0] - last_x) * scale, (first[1] - last_y) * scale, 0.0, first_y_rel))
        last_x, last_y = first[0], first[1]

        for p in s[1:]:
            # Pen-Down Zeichenschritt
            y_rel = (p[1] - min_y) * scale - 0.5
            feats.append(((p[0] - last_x) * scale, (p[1] - last_y) * scale, 1.0, y_rel))
            last_x, last_y = p[0], p[1]

    return feats


class MathWritingDataset:
    """Verwaltet und lädt die echten Google MathWriting Trainingsdaten."""

    def __init__(self, base_dir: str = None):
        if base_dir is None:
            base_dir = os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "data", "mathwriting", "mathwriting-2024-excerpt"
            )
        self.base_dir = base_dir
        self.samples: List[Tuple[List[Tuple[float, float, float]], str]] = []
        self._load()

    def _load(self):
        if not os.path.exists(self.base_dir):
            print(f"MathWriting Verzeichnis nicht gefunden: {self.base_dir}")
            return

        # Wir laden 'train' und 'synthetic' für das Training
        patterns = [
            os.path.join(self.base_dir, "train", "*.inkml"),
            os.path.join(self.base_dir, "synthetic", "*.inkml"),
            os.path.join(self.base_dir, "symbols", "*.inkml"),
        ]

        files = []
        for pat in patterns:
            files.extend(glob.glob(pat))

        for fp in files:
            res = parse_inkml_file(fp)
            if not res:
                continue
            traces, label = res
            feats = strokes_to_normalized_features(traces)
            if len(feats) >= 5 and len(label) > 0:
                self.samples.append((feats, label))

        print(f"Google MathWriting geladen: {len(self.samples)} echte handgeschriebene Formel- & Symbolbeispiele.")

    def __len__(self):
        return len(self.samples)

    def get_sample(self, idx: int) -> Tuple[List[Tuple[float, float, float]], str]:
        return self.samples[idx]


if __name__ == "__main__":
    ds = MathWritingDataset()
    print(f"Erfolgreich initialisiert: {len(ds)} Samples")
    if len(ds) > 0:
        f, l = ds.get_sample(0)
        print(f"Beispiel 0: Label='{l}', Features={len(f)}")
