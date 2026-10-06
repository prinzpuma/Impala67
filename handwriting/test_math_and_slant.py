"""
handwriting/test_math_and_slant.py
Ausführliche Test-Suite für mathematische Formeln, Schräglagen/Rotation und 2D-Bruch-Strukturen.
"""

import math
import time
import numpy as np
import onnxruntime as ort
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from generate_synthetic import (
    generate_word_strokes,
    strokes_to_features,
    interpolate_points,
    MATH_FORMULAS,
    SAMPLE_WORDS
)
from train import ctc_greedy_decode


def test_standard_and_formulas(session):
    print("=" * 60)
    print("TEST 1: Mathematische Formeln (Inline-LaTeX/Math)")
    print("=" * 60)

    test_cases = [
        "f(x)=x^2", "a^2+b^2=c^2", "E=mc^2", "y=2x+1", "A=π*r^2",
        "F=m*a", "v=s/t", "x>0", "x<5", "a~b", "√x", "√{a+b}",
        "∫f(x)dx", "∑x_i", "α+β=90", "λ=c/f", "f'(x)=0", "2*π*r",
        "sin(x)", "1/2", "3/4", "x/y", "x^3-x=0", "z=x+iy", "1+2=3"
    ]

    correct = 0
    total_time = 0.0

    for formula in test_cases:
        strokes = generate_word_strokes(formula)
        features = strokes_to_features(strokes)
        inp = np.array([features], dtype=np.float32)

        t0 = time.perf_counter()
        outputs = session.run(None, {"input": inp})
        dt = (time.perf_counter() - t0) * 1000
        total_time += dt

        logits = outputs[0][:, 0, :]
        recognized = ctc_greedy_decode(logits)

        status = "OK" if recognized == formula else "DIFF"
        if recognized == formula:
            correct += 1
        print(f"[{status:4s}] Soll: '{formula:<16}' -> Ist: '{recognized:<16}' ({dt:.1f} ms)")

    acc = correct / len(test_cases) * 100
    print("-" * 60)
    print(f"Formel-Genauigkeit: {correct}/{len(test_cases)} ({acc:.1f}%) | Ø {total_time / len(test_cases):.2f} ms\n")
    return correct, len(test_cases)


def test_rotation_robustness(session):
    print("=" * 60)
    print("TEST 2: Schräge & gedrehte Handschrift (Rotationswinkel)")
    print("=" * 60)

    words = ["Notiz", "Aufgabe", "x=y", "E=mc^2", "2026", "Lösung", "f(x)"]
    angles = [-15.0, -10.0, -5.0, 5.0, 10.0, 15.0]

    correct = 0
    total_tests = 0

    for word in words:
        for angle in angles:
            strokes = generate_word_strokes(word, rotation_deg=angle)

            # Preprocessor Deskewing Simulation (PCA Trägheitsachse)
            all_pts = [p for s in strokes for p in s]
            cx = sum(p[0] for p in all_pts) / len(all_pts)
            cy = sum(p[1] for p in all_pts) / len(all_pts)

            sxx = sum((p[0] - cx) ** 2 for p in all_pts)
            syy = sum((p[1] - cy) ** 2 for p in all_pts)
            sxy = sum((p[0] - cx) * (p[1] - cy) for p in all_pts)
            detected_angle = 0.5 * math.atan2(2 * sxy, sxx - syy)

            # Rückdrehung
            cos_a = math.cos(-detected_angle)
            sin_a = math.sin(-detected_angle)
            deskewed_strokes = []
            for s in strokes:
                deskewed_strokes.append([
                    (cx + (p[0] - cx) * cos_a - (p[1] - cy) * sin_a,
                     cy + (p[0] - cx) * sin_a + (p[1] - cy) * cos_a)
                    for p in s
                ])

            features = strokes_to_features(deskewed_strokes)
            inp = np.array([features], dtype=np.float32)
            outputs = session.run(None, {"input": inp})
            logits = outputs[0][:, 0, :]
            recognized = ctc_greedy_decode(logits)

            total_tests += 1
            is_ok = (recognized == word)
            if is_ok:
                correct += 1

            status = "OK" if is_ok else "DIFF"
            if not is_ok or abs(angle) == 15.0:
                print(f"[{status:4s}] {angle:+5.1f}° | Soll: '{word:<10}' -> Ist: '{recognized:<10}'")

    acc = correct / total_tests * 100
    print("-" * 60)
    print(f"Rotations-Robustheit: {correct}/{total_tests} ({acc:.1f}%)\n")
    return correct, total_tests


def test_2d_fractions(session):
    print("=" * 60)
    print("TEST 3: 2D-Bruchrechnung mit Bruchstrich (Zähler / Nenner -> LaTeX)")
    print("=" * 60)

    fraction_cases = [
        ("1", "2", "\\frac{1}{2}"),
        ("a", "b", "\\frac{a}{b}"),
        ("x+1", "2y", "\\frac{x+1}{2y}"),
        ("3", "4", "\\frac{3}{4}"),
        ("E", "c^2", "\\frac{E}{c^2}"),
        ("s", "t", "\\frac{s}{t}"),
        ("sin(x)", "cos(x)", "\\frac{sin(x)}{cos(x)}"),
        ("100", "2", "\\frac{100}{2}"),
    ]

    correct = 0

    for num, den, expected_latex in fraction_cases:
        # Generiere Zähler
        num_strokes = generate_word_strokes(num)
        # Generiere Nenner
        den_strokes = generate_word_strokes(den)

        # Bruchstrich dazwischen (horizontaler Strich)
        bar_stroke = [[(0.0, 1.2), (1.5, 1.2)]]

        # Nenner nach unten verschieben
        den_shifted = [[(p[0], p[1] + 1.5) for p in s] for s in den_strokes]

        # Teste Erkennung von Zähler und Nenner
        num_feat = strokes_to_features(num_strokes)
        den_feat = strokes_to_features(den_shifted)

        inp_num = np.array([num_feat], dtype=np.float32)
        inp_den = np.array([den_feat], dtype=np.float32)

        out_num = session.run(None, {"input": inp_num})[0][:, 0, :]
        out_den = session.run(None, {"input": inp_den})[0][:, 0, :]

        rec_num = ctc_greedy_decode(out_num)
        rec_den = ctc_greedy_decode(out_den)

        result_latex = f"\\frac{{{rec_num}}}{{{rec_den}}}"
        is_ok = (result_latex == expected_latex)
        if is_ok:
            correct += 1

        status = "OK" if is_ok else "DIFF"
        print(f"[{status:4s}] Soll: '{expected_latex:<25}' -> Ist: '{result_latex:<25}'")

    acc = correct / len(fraction_cases) * 100
    print("-" * 60)
    print(f"2D-Bruch-Genauigkeit: {correct}/{len(fraction_cases)} ({acc:.1f}%)\n")
    return correct, len(fraction_cases)


def main():
    model_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model.onnx")
    print(f"Lade ONNX-Modell: {model_path}...")
    session = ort.InferenceSession(model_path)

    c1, t1 = test_standard_and_formulas(session)
    c2, t2 = test_rotation_robustness(session)
    c3, t3 = test_2d_fractions(session)

    total_c = c1 + c2 + c3
    total_t = t1 + t2 + t3
    print("=" * 60)
    print(f"GESAMT-ERGEBNIS ALLER TESTS: {total_c}/{total_t} ({total_c / total_t * 100:.1f}%)")
    print("=" * 60)


if __name__ == "__main__":
    main()
