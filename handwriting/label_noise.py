"""
handwriting/label_noise.py
Findet vermutlich falsch beschriftete Beispiele in BRUSH und MathWriting und sperrt sie fürs Training.

Ein gutes Modell liegt auf korrekt beschrifteten Zeilen selten völlig daneben. Liegt es bei einem Beispiel
fast komplett falsch (hohe CER), passt meist das Label nicht zur Tinte (verrutschte Zuordnung, Tippfehler,
abgeschnittene Striche). Solche Beispiele bringen dem Modell Falsches bei.

Einmalig mit dem besten Checkpoint ausführen, danach filtert train.py die gesperrten Beispiele automatisch:
    python label_noise.py checkpoints/best.pt
Gesperrt wird höchstens --max-fraction je Datensatz (die schlechtesten zuerst), Labels unter 3 Zeichen nie.
"""

import hashlib
import json
import os
import sys
from typing import List, Tuple

import numpy as np

BLOCKLIST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "label_noise_blocklist.json")


def sample_key(feats: np.ndarray, label: str) -> str:
    return hashlib.sha1(label.encode("utf-8") + np.asarray(feats, dtype=np.float32).tobytes()).hexdigest()[:16]


def drop_blocked(samples: List[Tuple[np.ndarray, str]], name: str) -> List[Tuple[np.ndarray, str]]:
    """Entfernt gesperrte Beispiele. Ohne Sperrliste bleibt alles unverändert."""
    if not samples or not os.path.exists(BLOCKLIST_PATH):
        return samples
    with open(BLOCKLIST_PATH, encoding="utf-8") as f:
        blocked = set(json.load(f).get(name, []))
    kept = [s for s in samples if sample_key(*s) not in blocked]
    if len(kept) < len(samples):
        print(f"{name}: {len(samples) - len(kept)} vermutlich falsch beschriftete Beispiele ausgelassen.")
    return kept


def score_samples(model, device, samples, mode: str, max_points: int = 64000) -> List[float]:
    """CER je Beispiel, wie in der App erkannt (Greedy-CTC, ganze Zeile)."""
    import torch
    from evaluate_user_benchmark_words import ctc_greedy, line_distance

    cers = [0.0] * len(samples)
    order = sorted(range(len(samples)), key=lambda i: len(samples[i][0]))
    batch: List[int] = []

    def run(idx: List[int]):
        lens = [len(samples[i][0]) for i in idx]
        inp = torch.zeros(len(idx), max(lens), 4)
        for row, i in enumerate(idx):
            inp[row, : lens[row]] = torch.from_numpy(np.asarray(samples[i][0], dtype=np.float32))
        with torch.no_grad():
            out = model(inp.to(device), in_lens=torch.tensor(lens)).cpu().numpy()
        for row, i in enumerate(idx):
            valid = max(1, lens[row] // 2)
            pred, _ = ctc_greedy(out[:valid, row, :], mode=mode)
            dist, n = line_distance(pred, samples[i][1], mode)
            cers[i] = dist / n

    for k, i in enumerate(order):
        if batch and (len(batch) + 1) * len(samples[i][0]) > max_points:
            run(batch)
            batch = []
        batch.append(i)
        if k and k % 20000 == 0:
            print(f"  {k}/{len(samples)} geprüft", flush=True)
    if batch:
        run(batch)
    return cers


def main():
    import argparse
    import torch
    from model import HandwritingCRNN
    from brush_loader import BrushDataset
    from mathwriting_loader import MathWritingDataset

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    parser = argparse.ArgumentParser(description="Sperrliste für vermutlich falsch beschriftete Trainingsbeispiele")
    parser.add_argument("checkpoint", help="Checkpoint (.pt), z. B. checkpoints/best.pt")
    parser.add_argument("--threshold", type=float, default=0.5, help="Ab dieser CER gilt ein Beispiel als verdächtig")
    parser.add_argument("--max-fraction", type=float, default=0.03, help="Höchstens dieser Anteil je Datensatz wird gesperrt")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = HandwritingCRNN(in_features=4, hidden_size=192, num_layers=3).to(device)
    state = torch.load(args.checkpoint, map_location=device)
    model.load_state_dict(state.get("model_state", state))
    model.eval()

    blocklist = {}
    for name, ds, mode in (
        ("BRUSH", BrushDataset(split="train"), "text"),
        ("MathWriting", MathWritingDataset(), "math"),
    ):
        samples = ds.samples
        if not samples:
            print(f"{name}: keine Daten gefunden, übersprungen.")
            continue
        print(f"{name}: prüfe {len(samples)} Beispiele...", flush=True)
        cers = score_samples(model, device, samples, mode)
        suspects = [
            i for i in sorted(range(len(samples)), key=lambda i: -cers[i])
            if cers[i] >= args.threshold and len("".join(samples[i][1].split())) >= 3
        ][: int(len(samples) * args.max_fraction)]
        blocklist[name] = [sample_key(*samples[i]) for i in suspects]
        print(f"{name}: {len(suspects)} gesperrt ({len(suspects) / len(samples) * 100:.2f} %). Beispiele:")
        for i in suspects[:10]:
            print(f"  CER {cers[i] * 100:5.1f} % | Label: '{samples[i][1]}'")

    os.makedirs(os.path.dirname(BLOCKLIST_PATH), exist_ok=True)
    with open(BLOCKLIST_PATH, "w", encoding="utf-8") as f:
        json.dump(blocklist, f)
    print(f"Sperrliste gespeichert: {BLOCKLIST_PATH}")


if __name__ == "__main__":
    main()
