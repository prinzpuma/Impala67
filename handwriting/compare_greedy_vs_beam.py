"""
handwriting/compare_greedy_vs_beam.py
Vergleicht CER und Genauigkeit: Greedy CTC vs. Beam Search (mit deutscher Wortliste).
"""

import sys
import os
import time
import numpy as np
import onnxruntime as ort

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from generate_synthetic import generate_word_strokes, strokes_to_features, SAMPLE_WORDS
from train import ctc_greedy_decode
from beam_search import ctc_beam_search_decode
from evaluate_baseline_cer import levenshtein, TEST_SUITE

def main():
    model_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model.onnx")
    session = ort.InferenceSession(model_path)

    word_set = set(w.lower() for w in SAMPLE_WORDS)
    for w in TEST_SUITE["Wörter"]:
        word_set.add(w.lower())

    # Wir testen die Wörter- und Formel-Gruppe
    test_items = TEST_SUITE["Wörter"] + TEST_SUITE["Einzeilige Formeln"]

    greedy_correct = 0
    greedy_dist = 0
    beam_correct = 0
    beam_dist = 0
    total_chars = 0

    print(f"Vergleiche Greedy vs Beam Search an {len(test_items)} Testfällen...")
    print(f"{'Soll':<15} | {'Greedy':<15} | {'Beam Search':<15} | {'Status'}")
    print("-" * 65)

    for item in test_items:
        strokes = generate_word_strokes(item)
        features = strokes_to_features(strokes)
        inp = np.array([features], dtype=np.float32)

        outputs = session.run(None, {"input": inp})
        logits = outputs[0][:, 0, :]

        # 1. Greedy
        pred_greedy = ctc_greedy_decode(logits)
        dist_greedy = levenshtein(item, pred_greedy)
        greedy_dist += dist_greedy
        if pred_greedy == item:
            greedy_correct += 1

        # 2. Beam Search
        pred_beam = ctc_beam_search_decode(logits, beam_width=12, word_list=word_set, word_bonus=2.0)
        dist_beam = levenshtein(item, pred_beam)
        beam_dist += dist_beam
        if pred_beam == item:
            beam_correct += 1

        total_chars += len(item)

        status = "GLEICH" if pred_greedy == pred_beam else ("BEAM +" if dist_beam < dist_greedy else "GREEDY +")
        print(f"{item:<15} | {pred_greedy:<15} | {pred_beam:<15} | {status}")

    cer_greedy = greedy_dist / total_chars * 100
    cer_beam = beam_dist / total_chars * 100

    print("=" * 65)
    print(f"Greedy CER:      {cer_greedy:.2f}% (Acc: {greedy_correct}/{len(test_items)} = {greedy_correct/len(test_items)*100:.1f}%)")
    print(f"Beam Search CER: {cer_beam:.2f}% (Acc: {beam_correct}/{len(test_items)} = {beam_correct/len(test_items)*100:.1f}%)")
    print("=" * 65)

if __name__ == "__main__":
    main()
