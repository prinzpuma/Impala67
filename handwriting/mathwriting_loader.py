"""
handwriting/mathwriting_loader.py
Lädt und parst echte menschliche Vektor-Handschrift aus dem Google MathWriting Datensatz (CC-BY 4.0).
Konvertiert InkML-Striche in standardisierte [dx, dy, pen_down] Feature-Vektoren für CTC-Training.
"""

import os
import glob
import math
import re
import pickle
import xml.etree.ElementTree as ET
from typing import List, Tuple, Dict, Optional

import numpy as np

from vocabulary import CHAR_TO_IDX, BLANK_IDX

CACHE_VERSION = 4  # v4: Median-Normalisierung (alte v3-Caches haben veraltete Features)

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
    (r"\\le(?![a-zA-Z])", "<="),
    (r"\\ge(?![a-zA-Z])", ">="),
    (r"\\ne(?![a-zA-Z])", "!="),
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
    """
    Wandelt LaTeX-Labels in lesbare Zeichenketten unseres Vokabulars um.
    Gibt "" zurück, wenn das Label nicht verlustfrei abbildbar ist (unbekannte Befehle wie \\theta,
    Zeichen außerhalb des Vokabulars). Sonst stünden geschriebene Zeichen ohne passendes Label im
    Training und das Modell würde lernen, echte Striche zu ignorieren.
    """
    if not raw_label:
        return ""
    text = raw_label
    for pattern, repl in LATEX_REPLACEMENTS:
        text = re.sub(pattern, repl, text)

    # Reine Formatierungs-Hüllen auflösen (z.B. \mathrm{x} -> x)
    text = re.sub(r"\\(?:mathrm|mathbf|mathit|text|operatorname)\{([^{}]+)\}", r"\1", text)
    # Abstands-Befehle haben keine Tinte
    text = re.sub(r"\\[,;:! ]|\\quad|\\qquad", "", text)
    if re.search(r"\\[a-zA-Z]+", text):
        return ""
    # Leerzeichen in LaTeX sind Satzformatierung, keine geschriebenen Lücken
    # Geschriebene Mengenklammern \{ \} behalten, LaTeX-Gruppierungsklammern entfernen
    text = text.replace("\\{", "\x01").replace("\\}", "\x02")
    text = text.replace("{", "").replace("}", "").replace(" ", "")
    text = text.replace("\x01", "{").replace("\x02", "}")

    if any(c not in CHAR_TO_IDX or CHAR_TO_IDX[c] == BLANK_IDX for c in text):
        return ""
    return text


def resample_stroke(pts: List[Tuple[float, float]], step: float) -> List[Tuple[float, float]]:
    """Resampelt einen Strich äquidistant (exakt wie im Web-Preprocessor)."""
    if len(pts) == 0:
        return []
    if len(pts) == 1:
        return [(float(pts[0][0]), float(pts[0][1])), (float(pts[0][0]), float(pts[0][1]))]
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
            if len(pts) >= 1:
                traces.append(pts)

        if not traces:
            return None

        return traces, clean_label
    except Exception:
        return None


def calculate_stroke_height_median(strokes, fallback=10.0) -> float:
    if not strokes:
        return fallback
    heights = []
    for s in strokes:
        pts = s.get("pts", s) if isinstance(s, dict) else s
        if not pts or len(pts) < 2:
            continue
        ys = [p[1] for p in pts]
        h = max(ys) - min(ys)
        if h > 1e-4:
            heights.append(h)
    if not heights:
        return fallback
    heights.sort()
    mid = len(heights) // 2
    return float(heights[mid] if len(heights) % 2 != 0 else (heights[mid - 1] + heights[mid]) / 2.0)


def strokes_to_normalized_features(
    strokes: List[List[Tuple[float, float]]],
    line_min_y: Optional[float] = None,
    line_height: Optional[float] = None,
    step: Optional[float] = None,
) -> List[Tuple[float, float, float, float]]:
    """Wandelt Striche mit äquidistantem Resampling in [dx, dy, pen_down, y_rel] Features um (auf Median-Höhe normiert)."""
    raw_list = [(s.get("pts", s) if isinstance(s, dict) else s) for s in strokes]
    all_pts = [p for s in raw_list for p in s]
    if not all_pts:
        return []
    min_y = min(p[1] for p in all_pts) if line_min_y is None else line_min_y
    max_y = max(p[1] for p in all_pts)
    med_h = calculate_stroke_height_median(strokes, fallback=10.0)
    norm_h = line_height if line_height is not None else (med_h if med_h > 0.1 else max(5.0, max_y - min_y))
    if step is None:
        step = max(0.6 if norm_h > 2.0 else 0.045, norm_h * 0.045)

    resampled = []
    for s in raw_list:
        if not s:
            continue
        r = resample_stroke(s, step)
        if len(r) >= 2:
            resampled.append(r)
    if not resampled:
        return []

    scale = 1.0 / norm_h
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

    def __init__(self, base_dir: str = None, max_samples: int = 250_000):
        if base_dir is None:
            # Voller Datensatz (mathwriting-2024.tgz) hat Vorrang vor dem kleinen Auszug
            data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
            candidates = [
                os.path.join(data_dir, "mw_download", "mathwriting-2024"),
                os.path.join(data_dir, "mathwriting", "mathwriting-2024"),
                os.path.join(data_dir, "mathwriting", "mathwriting-2024-excerpt"),
            ]
            base_dir = next(
                (c for c in candidates if os.path.isdir(c) or glob.glob(f"{c}-{max_samples}-v{CACHE_VERSION}.cache.pkl")),
                candidates[-1],
            )
        self.base_dir = base_dir
        self.max_samples = max_samples
        self.samples: List[Tuple[np.ndarray, str]] = []
        self._load()

    def _cache_path(self) -> str:
        # Versionsnummer erhöhen, wenn sich clean_latex_label oder die Feature-Berechnung ändert
        return os.path.join(os.path.dirname(self.base_dir), f"{os.path.basename(self.base_dir)}-{self.max_samples}-v{CACHE_VERSION}.cache.pkl")

    def _load(self):
        # Cache zuerst: Er reicht allein, die Rohdaten (3 GB) müssen dann nicht mehr vorhanden sein
        cache = self._cache_path()
        if not os.path.exists(cache) and not os.path.exists(self.base_dir):
            print(f"MathWriting Verzeichnis nicht gefunden: {self.base_dir}")
            return

        if os.path.exists(cache):
            with open(cache, "rb") as f:
                # Rohbytes statt numpy-Objekten: Cache funktioniert mit numpy 1 und 2 (.venv vs. .venv_rocm)
                self.samples = [(np.frombuffer(raw, dtype=np.float32).reshape(-1, 4), label) for raw, label in pickle.load(f)]
            print(f"Google MathWriting aus Cache geladen: {len(self.samples)} Beispiele ({cache}).")
            return

        # Echte Handschrift ('train', 'symbols') zuerst, 'synthetic' (aus Bausteinen zusammengesetzt) nur zum Auffüllen
        files = []
        for sub in ("train", "symbols", "synthetic"):
            files.extend(sorted(glob.glob(os.path.join(self.base_dir, sub, "*.inkml"))))

        skipped = 0
        for i, fp in enumerate(files):
            if len(self.samples) >= self.max_samples:
                break
            res = parse_inkml_file(fp)
            if not res:
                skipped += 1
                continue
            traces, label = res
            feats = strokes_to_normalized_features(traces)
            if len(feats) >= 5 and len(label) > 0:
                # float32-Arrays statt Tupel-Listen: ~10x weniger RAM beim vollen Datensatz
                self.samples.append((np.asarray(feats, dtype=np.float32), label))
            if i and i % 20000 == 0:
                print(f"  MathWriting: {i}/{len(files)} Dateien gelesen, {len(self.samples)} übernommen", flush=True)

        with open(cache, "wb") as f:
            pickle.dump([(feats.tobytes(), label) for feats, label in self.samples], f, protocol=4)
        print(
            f"Google MathWriting geladen: {len(self.samples)} echte handgeschriebene Formel- & Symbolbeispiele "
            f"({skipped} nicht verlustfrei abbildbare Labels verworfen)."
        )

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
