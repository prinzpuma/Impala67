"""
handwriting/test_inference.py
Validiert das trainierte ONNX-Modell mit einem breiten Spektrum an Wörtern, Zahlen und Symbolen.
"""

import time
import numpy as np
import onnxruntime as ort
from generate_synthetic import generate_word_strokes, strokes_to_features
from train import ctc_greedy_decode

def main():
    print("Lade model.onnx...")
    session = ort.InferenceSession("model.onnx")

    test_words = [
        "Notiz", "Aufgabe", "Plan", "Ziel", "Text", "Haus", "Code", "Arbeit",
        "Größe", "Über", "Lösung",
        "123", "2026", "42", "789",
        "x=y", "1+2=3", "Nr.1", "100%", "A+B"
    ]
    print(f"\nTeste {len(test_words)} Wörter & Symbole:\n" + "-" * 40)

    correct = 0
    total_time = 0.0

    for word in test_words:
        strokes = generate_word_strokes(word)
        features = strokes_to_features(strokes)
        inp = np.array([features], dtype=np.float32)

        t0 = time.perf_counter()
        outputs = session.run(None, {"input": inp})
        dt = (time.perf_counter() - t0) * 1000
        total_time += dt

        logits = outputs[0][:, 0, :]
        recognized = ctc_greedy_decode(logits)

        status = "OK" if recognized == word else "DIFF"
        if recognized == word:
            correct += 1

        print(f"[{status:4s}] Soll: '{word:<8}' -> Ist: '{recognized:<8}' ({dt:.1f} ms)")

    print("-" * 40)
    print(f"Gesamt-Genauigkeit: {correct}/{len(test_words)} ({correct / len(test_words) * 100:.1f}%)")
    print(f"Durchschnittliche Latenz: {total_time / len(test_words):.2f} ms")

if __name__ == "__main__":
    main()
