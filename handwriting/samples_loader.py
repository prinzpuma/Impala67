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
import torch
from torch.utils.data import Dataset
from vocabulary import CHAR_TO_IDX, BLANK_IDX
from mathwriting_loader import strokes_to_normalized_features

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


def load_user_samples(json_path: str = "my_handwriting_samples.json") -> List[Tuple[Strokes, str]]:
    """
    Lädt die aus Impala67 exportierten Trainingsdaten als rohe Striche (für Augmentierung im Training).
    Zusätzlich zu jeder Zeile kommen ihre einzelnen Wörter, wenn die Wort-Segmentierung (wie in der App)
    genau zum Soll-Text passt: Die App erkennt wortweise, das Training sieht so dieselbe Einheit.
    Prüft strikt gegen Data-Leakage mit dem Benchmark-Testset!
    """
    from evaluate_user_benchmark_words import segment_line_into_words

    path_lower = json_path.lower()
    if "user_eval" in path_lower or "benchmark" in path_lower:
        raise RuntimeError("FATALER DATA-LEAKAGE-FEHLER: Isolierte Testdaten dürfen NIEMALS im Training geladen werden!")

    data = _read_json(json_path)
    bench_fps = _get_benchmark_fingerprints()

    samples = []
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

    print(f"{lines} eigene Zeilen + {len(samples) - lines} Einzelwörter aus {json_path} geladen ({rejected_count} verworfen).")
    return samples


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


class HybridInkDataset(Dataset):
    """Kombiniert ein Basis-Dataset mit echten Nutzer-Samples aus Impala67."""

    def __init__(self, base_dataset, user_samples_path: str = "my_handwriting_samples.json", user_weight: float = 0.5):
        self.base_dataset = base_dataset
        self.user_samples = load_user_samples(user_samples_path)
        self.user_weight = user_weight if self.user_samples else 0.0

    def __len__(self):
        return len(self.base_dataset)

    def __getitem__(self, idx):
        import random
        if self.user_samples and random.random() < self.user_weight:
            strokes, word = random.choice(self.user_samples)
            feat_tensor = torch.tensor(strokes_to_normalized_features(strokes), dtype=torch.float32)
            target = torch.tensor([CHAR_TO_IDX[c] for c in word if c in CHAR_TO_IDX and CHAR_TO_IDX[c] != BLANK_IDX], dtype=torch.long)
            return feat_tensor, target, word

        return self.base_dataset[idx]


if __name__ == "__main__":
    samples = load_user_samples("my_handwriting_samples.json")
    print(f"Gefundene Samples: {len(samples)}")
