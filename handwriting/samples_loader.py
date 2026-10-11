"""
handwriting/samples_loader.py
Lädt in Impala67 gesammelte Handschrift-Beispiele (my_handwriting_samples.json)
und bereitet sie für PyTorch-Training und Fine-Tuning vor.
Garantiert vollständige Isolierung des Test-Benchmarks (Data-Leakage-Schutz).
"""

import json
import os
import hashlib
from typing import List, Tuple
from vocabulary import CHAR_TO_IDX, BLANK_IDX
from mathwriting_loader import calculate_stroke_height_median

BENCHMARK_PROTECTED_TEXTS = {
    "Apfel, Käse, Größe, Straße, Zukunft, Übung, Physik, Notiz, schnell, blau",
    "Das ist ein Test.",
    "Heute ist schönes Wetter.",
    "Impala läuft lokal im Browser.",
    "Wir trainieren auf der GPU.",
    "a^2 + b^2 = c^2",
    "f(x) = 2x + 1",
    "E = m * c^2",
    "15 + 27 = 42",
    "120 / 4 = 30",
    "A, b, g, x, y, 7, 8, 9, +, -, =, ?",
}


def _stroke_fingerprint(stroke: list) -> str:
    """Erzeugt einen deterministischen Hash der ersten Strichpunkte zur Leakage-Erkennung."""
    pts = stroke.get("pts", stroke) if isinstance(stroke, dict) else stroke
    if not pts:
        return ""
    sample_pts = pts[:10]
    raw = ",".join(f"{round(float(p[0]), 1)}:{round(float(p[1]), 1)}" for p in sample_pts)
    return hashlib.md5(raw.encode()).hexdigest()


def _get_benchmark_fingerprints() -> set:
    fps = set()
    bench_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "benchmark_test_strokes.json")
    if os.path.exists(bench_path):
        try:
            with open(bench_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for row in data:
                for s in row.get("strokes", []):
                    fp = _stroke_fingerprint(s)
                    if fp:
                        fps.add(fp)
        except Exception:
            pass
    return fps


Strokes = List[List[Tuple[float, float]]]


def _parse_strokes(strokes_data) -> Strokes:
    parsed = []
    for s in strokes_data:
        pts = s.get("pts", s) if isinstance(s, dict) else s
        if pts:
            parsed.append([(float(p[0]), float(p[1])) for p in pts])
    return parsed


def _in_vocab(text: str) -> bool:
    return all(c in CHAR_TO_IDX and CHAR_TO_IDX[c] != BLANK_IDX for c in text)


def _read_json(json_path: str) -> list:
    if not os.path.exists(json_path):
        return []
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Fehler beim Laden von {json_path}: {e}")
        return []


def _word_in_line_units(word_strokes: Strokes, line_strokes: Strokes) -> Strokes:
    """Normiert ein Wort auf die Maße seiner Zeile: x ab 0, y relativ zur Zeilenmitte, Einheit = Median-Strichhöhe.
    So passen Wörter aus verschiedenen Zeilen in Größe und Grundlinie zusammen."""
    unit = max(1e-6, calculate_stroke_height_median(line_strokes))
    ys = sorted(p[1] for s in line_strokes for p in s)
    mid_y = ys[len(ys) // 2]
    x0 = min(p[0] for s in word_strokes for p in s)
    return [[((p[0] - x0) / unit, (p[1] - mid_y) / unit) for p in s] for s in word_strokes]


def compose_user_line(word_bank: List[Tuple[Strokes, str]], rng, focus=None) -> Tuple[Strokes, str]:
    """Wort-Collage: setzt 2–6 eigene Wörter aus verschiedenen Zeilen zu einer neuen Zeile zusammen.
    Aus wenigen Abschreib-Zeilen entstehen so laufend neue Zeilen in der eigenen Handschrift.
    Mit focus werden bevorzugt Wörter mit oft verwechselten Zeichen gewählt."""
    picked = []
    for _ in range(rng.randint(2, 6)):
        c = focus.pick_char(rng) if focus else None
        options = [w for w in word_bank if c in w[1]] if c else None
        picked.append(rng.choice(options or word_bank))
    strokes: Strokes = []
    cursor = 0.0
    for word_strokes, _ in picked:
        scale = rng.uniform(0.92, 1.08)
        dy = rng.uniform(-0.08, 0.08)
        placed = [[(cursor + x * scale, y * scale + dy) for x, y in s] for s in word_strokes]
        strokes.extend(placed)
        cursor = max(p[0] for s in placed for p in s) + rng.uniform(1.0, 1.8)
    return strokes, " ".join(w for _, w in picked)


def load_user_samples(json_path: str = "my_handwriting_samples.json") -> Tuple[List[Tuple[Strokes, str]], List[Tuple[Strokes, str]]]:
    """
    Lädt die aus Impala67 exportierten Trainingsdaten als rohe Striche (für Augmentierung im Training).
    Liefert (samples, word_bank):
    - samples: jede Zeile plus ihre einzelnen Wörter, wenn die Wort-Segmentierung genau zum Soll-Text passt
    - word_bank: dieselben Wörter auf Zeilenmaße normiert, für compose_user_line
    Prüft strikt gegen Data-Leakage mit dem Benchmark-Testset!
    """
    from evaluate_user_benchmark_words import segment_line_into_words

    path_lower = json_path.lower()
    if "user_eval" in path_lower or "benchmark" in path_lower:
        raise RuntimeError("FATALER DATA-LEAKAGE-FEHLER: Isolierte Testdaten dürfen NIEMALS im Training geladen werden!")

    data = _read_json(json_path)
    bench_fps = _get_benchmark_fingerprints()

    samples = []
    word_bank = []
    rejected_count = 0
    lines = 0

    for item in data:
        text = str(item.get("text", "")).strip()
        strokes_data = item.get("strokes", [])
        if not text or not strokes_data:
            continue

        # 0. Messzeilen aus dem Abschreib-Modus sind nur zum Messen da, nie zum Trainieren
        if item.get("split") == "eval":
            rejected_count += 1
            continue

        # 1. Text-Schutz gegen Benchmark
        if text in BENCHMARK_PROTECTED_TEXTS:
            rejected_count += 1
            print(f"[Schutz] Trainingsbeispiel verworfen (Benchmark-Text match): '{text}'")
            continue

        # 2. Strich-Fingerprint-Schutz gegen Benchmark
        if any(_stroke_fingerprint(s) in bench_fps for s in strokes_data if _stroke_fingerprint(s)):
            rejected_count += 1
            print(f"[Schutz] Trainingsbeispiel verworfen (Benchmark-Strich match): '{text}'")
            continue

        strokes = _parse_strokes(strokes_data)
        if not strokes or not _in_vocab(text):
            continue
        samples.append((strokes, text))
        lines += 1

        words = text.split()
        groups = segment_line_into_words(strokes)
        if len(words) > 1 and len(groups) == len(words):
            samples.extend((g, w) for g, w in zip(groups, words))
            word_bank.extend((_word_in_line_units(g, strokes), w) for g, w in zip(groups, words))

    print(f"{lines} eigene Zeilen + {len(samples) - lines} Einzelwörter aus {json_path} geladen ({rejected_count} verworfen).")
    return samples, word_bank


def load_user_eval_lines(json_path: str = "my_handwriting_samples.json") -> List[Tuple[Strokes, str]]:
    """Messzeilen (split "eval") aus dem Abschreib-Modus. Nur für Modellauswahl/Messung, nie fürs Training."""
    lines = []
    for item in _read_json(json_path):
        text = str(item.get("text", "")).strip()
        if item.get("split") != "eval" or not text or not _in_vocab(text):
            continue
        strokes = _parse_strokes(item.get("strokes", []))
        if strokes:
            lines.append((strokes, text))
    return lines


if __name__ == "__main__":
    samples, word_bank = load_user_samples("my_handwriting_samples.json")
    print(f"Gefundene Samples: {len(samples)}, Wörter für Collagen: {len(word_bank)}")
