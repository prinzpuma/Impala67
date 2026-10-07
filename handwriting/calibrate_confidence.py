"""
handwriting/calibrate_confidence.py
Eicht die CTC-Konfidenzwerte des Handschriftmodells:
Misst auf Validierungsdaten die Übereinstimmung zwischen vorhergesagter Konfidenz
und tatsächlicher Trefferquote (Calibration Curve / Reliability Diagram).
Ermittelt die optimale Konfidenzschwelle (Threshold), unter der Ausgaben als 'unsicher' gelten.
"""

import sys
import os
import time
import math
import numpy as np
import onnxruntime as ort

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from generate_synthetic import generate_word_strokes, strokes_to_features, SAMPLE_WORDS, random_sample
from vocabulary import index_to_char, BLANK_IDX

def softmax(x):
    e_x = np.exp(x - np.max(x, axis=-1, keepdims=True))
    return e_x / np.sum(e_x, axis=-1, keepdims=True)

def decode_with_confidence(logits2D, blank_idx=BLANK_IDX):
    """
    Greedy CTC Decode inklusive Konfidenzberechnung pro Token und Gesamtsequenz.
    Gibt (text, confidence, token_confidences, blank_ratio) zurück.
    """
    probs = softmax(logits2D) # [T, V]
    pred_indices = np.argmax(probs, axis=-1)
    max_probs = np.max(probs, axis=-1)

    collapsed = []
    char_confs = []
    blank_count = 0
    prev = None

    for idx, p in zip(pred_indices, max_probs):
        if idx == blank_idx:
            blank_count += 1
        if idx != prev:
            if idx != blank_idx:
                collapsed.append(idx)
                char_confs.append(float(p))
            prev = idx

    blank_ratio = blank_count / max(1, len(pred_indices))
    text = "".join(index_to_char(idx) for idx in collapsed)
    seq_conf = float(np.mean(char_confs)) if char_confs else 0.0

    return text, seq_conf, char_confs, blank_ratio

def calibrate(num_samples: int = 500):
    model_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model.onnx")
    session = ort.InferenceSession(model_path)

    bins = {
        "0.00 - 0.50": {"correct": 0, "total": 0},
        "0.50 - 0.70": {"correct": 0, "total": 0},
        "0.70 - 0.80": {"correct": 0, "total": 0},
        "0.80 - 0.90": {"correct": 0, "total": 0},
        "0.90 - 0.95": {"correct": 0, "total": 0},
        "0.95 - 1.00": {"correct": 0, "total": 0},
    }

    results = []

    print(f"Kalibriere Modell an {num_samples} Proben...")
    for _ in range(num_samples):
        features, target_word = random_sample()
        if len(features) < 3:
            continue

        inp = np.array([features], dtype=np.float32)
        outputs = session.run(None, {"input": inp})
        logits = outputs[0][:, 0, :]

        pred_text, conf, _, _ = decode_with_confidence(logits)
        is_correct = (pred_text == target_word)

        results.append((conf, is_correct, target_word, pred_text))

        if conf < 0.50:
            b = "0.00 - 0.50"
        elif conf < 0.70:
            b = "0.50 - 0.70"
        elif conf < 0.80:
            b = "0.70 - 0.80"
        elif conf < 0.90:
            b = "0.80 - 0.90"
        elif conf < 0.95:
            b = "0.90 - 0.95"
        else:
            b = "0.95 - 1.00"

        bins[b]["total"] += 1
        if is_correct:
            bins[b]["correct"] += 1

    print("\n" + "=" * 65)
    print("KALIBRIERUNGSERGEBNIS (Reliability Diagram):")
    print("=" * 65)
    print(f"{'Konfidenzbereich':<16} | {'Proben':<8} | {'Treffer':<8} | {'Genauigkeit':<12}")
    print("-" * 65)

    for b, data in bins.items():
        acc = (data["correct"] / data["total"] * 100.0) if data["total"] > 0 else 0.0
        print(f"{b:<16} | {data['total']:<8} | {data['correct']:<8} | {acc:>6.1f} %")

    print("=" * 65)

    # Schwellenwert-Empfehlung:
    # Finde die Schwelle, ab der die Trefferquote >= 95% ist
    thresholds = [0.60, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95]
    print("\nAuswirkung verschiedener Schwellenwerte (Thresholds):")
    print(f"{'Schwelle':<10} | {'Akzeptiert (%)':<15} | {'Präzision (Kauderwelsch-Schutz)':<30}")
    print("-" * 65)

    best_thresh = 0.80
    for th in thresholds:
        accepted = [r for r in results if r[0] >= th]
        acc_rate = len(accepted) / len(results) * 100.0
        precision = (sum(1 for r in accepted if r[1]) / len(accepted) * 100.0) if accepted else 0.0
        print(f"{th:<10.2f} | {acc_rate:>6.1f} %        | {precision:>6.1f} %")
        if precision >= 95.0 and best_thresh == 0.80:
            best_thresh = th

    print(f"\n-> Empfohlene Schwelle für Impala67: {best_thresh:.2f}")
    return best_thresh

if __name__ == "__main__":
    calibrate(num_samples=600)
