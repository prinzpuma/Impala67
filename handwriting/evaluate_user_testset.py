"""
handwriting/evaluate_user_testset.py
Test-Suite ausschließlich basierend auf echten handschriftlichen Nutzer-Daten aus der App.
Untersucht:
  - Greedy vs. Beam-Search CER
  - Aufschlüsselung nach den 4 Gruppen: Buchstaben/Symbole, Wörter, Sätze, Formeln
  - Konfidenz & Unsicherheit
"""

import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import os
import json
import math
import numpy as np
import onnxruntime as ort

from vocabulary import IDX_TO_CHAR, BLANK_IDX, index_to_char
from generate_synthetic import strokes_to_features
from beam_search import ctc_beam_search_decode


from mathwriting_loader import strokes_to_normalized_features

TESTSET_PATH = os.path.join(os.path.dirname(__file__), "data", "user_eval_testset.json")
MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.onnx")



def levenshtein_distance(s1: str, s2: str) -> int:
    """Berechnet die Levenshtein-Distanz zwischen zwei Zeichenketten."""
    m, n = len(s1), len(s2)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if s1[i - 1] == s2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[m][n]


def ctc_greedy_decode_with_confidence(logits, blank_idx=BLANK_IDX):
    """Greedy CTC Decoding mit Softmax und mittlerer Konfidenz."""
    # logits shape: (seq_len, vocab_size)
    exp_l = np.exp(logits - np.max(logits, axis=-1, keepdims=True))
    probs = exp_l / np.sum(exp_l, axis=-1, keepdims=True)

    pred_indices = np.argmax(probs, axis=-1)
    max_probs = np.max(probs, axis=-1)

    collapsed_chars = []
    char_confs = []
    prev = None

    for idx, conf in zip(pred_indices, max_probs):
        if idx != prev:
            if idx != blank_idx:
                c = index_to_char(int(idx))
                collapsed_chars.append(c)
                char_confs.append(float(conf))
            prev = idx

    text = "".join(collapsed_chars)
    avg_conf = float(np.mean(char_confs)) if char_confs else 0.0
    return text, avg_conf


def run_user_benchmark():
    if not os.path.exists(TESTSET_PATH):
        print(f"Fehler: Testset nicht gefunden unter {TESTSET_PATH}")
        return

    if not os.path.exists(MODEL_PATH):
        print(f"Fehler: ONNX-Modell nicht gefunden unter {MODEL_PATH}")
        return

    with open(TESTSET_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    samples = data.get("samples", [])
    print("=" * 70)
    print("IMPALA67 — NUTZER-BENCHMARK (ECHTE APP-HANDSCHRIFT)")
    print(f"Datensatz: {TESTSET_PATH}")
    print(f"Anzahl Test-Samples: {len(samples)}")
    print("=" * 70)

    session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])

    categories = ["symbol", "wort", "satz", "formel"]
    results_by_cat = {c: {"total_chars": 0, "greedy_errors": 0, "beam_errors": 0, "count": 0, "exact_match": 0} for c in categories}
    overall = {"total_chars": 0, "greedy_errors": 0, "beam_errors": 0, "exact_match": 0}

    detailed_rows = []

    for item in samples:
        cid = item["id"]
        cat = item["category"]
        gt = item["ground_truth"]
        raw_strokes = item["strokes"]

        # Vektorstriche vorverarbeiten
        # raw_strokes Format: [ [[x, y], [x, y]], ... ]
        parsed_strokes = []
        for s in raw_strokes:
            if isinstance(s, list) and len(s) > 0:
                pts = [(float(p[0]), float(p[1])) for p in s if len(p) >= 2]
                if len(pts) >= 2:
                    parsed_strokes.append(pts)

        if not parsed_strokes:
            continue

        feats = strokes_to_normalized_features(parsed_strokes)
        if len(feats) < 3:
            continue


        inp = np.array(feats, dtype=np.float32).reshape(1, len(feats), 3)
        out = session.run(["output"], {"input": inp})[0]
        # out shape: (seq_len, 1, vocab_size)
        logits = out[:, 0, :]

        # 1. Greedy CTC mit Konfidenz
        greedy_text, conf = ctc_greedy_decode_with_confidence(logits)

        # 2. Beam Search CTC
        beam_text = ctc_beam_search_decode(logits, beam_width=8)
        print(f"[{len(detailed_rows) + 1:02d}/{len(samples)}] {cat:<6} | Soll: '{gt}' -> Greedy: '{greedy_text}'", flush=True)


        # Fehler berechnen
        g_dist = levenshtein_distance(greedy_text, gt)
        b_dist = levenshtein_distance(beam_text, gt)
        gt_len = max(1, len(gt))

        results_by_cat[cat]["count"] += 1
        results_by_cat[cat]["total_chars"] += gt_len
        results_by_cat[cat]["greedy_errors"] += g_dist
        results_by_cat[cat]["beam_errors"] += b_dist
        if greedy_text == gt:
            results_by_cat[cat]["exact_match"] += 1

        overall["total_chars"] += gt_len
        overall["greedy_errors"] += g_dist
        overall["beam_errors"] += b_dist
        if greedy_text == gt:
            overall["exact_match"] += 1

        detailed_rows.append({
            "id": cid,
            "category": cat,
            "source": item.get("source_doc", ""),
            "ground_truth": gt,
            "greedy_pred": greedy_text,
            "beam_pred": beam_text,
            "confidence": conf,
            "greedy_dist": g_dist,
            "beam_dist": b_dist,
        })

    # Ausgabe der Ergebnisse
    print(f"\n{'Kategorie':<12} | {'Anzahl':<6} | {'Greedy CER':<12} | {'Beam CER':<12} | {'Exakt (Greedy)':<14}")
    print("-" * 65)

    for cat in categories:
        res = results_by_cat[cat]
        cnt = res["count"]
        if cnt == 0:
            continue
        g_cer = (res["greedy_errors"] / res["total_chars"]) * 100
        b_cer = (res["beam_errors"] / res["total_chars"]) * 100
        exact_pct = (res["exact_match"] / cnt) * 100
        print(f"{cat:<12} | {cnt:<6} | {g_cer:>8.2f} %   | {b_cer:>8.2f} %   | {exact_pct:>9.1f} %")

    print("-" * 65)
    tot_g_cer = (overall["greedy_errors"] / overall["total_chars"]) * 100
    tot_b_cer = (overall["beam_errors"] / overall["total_chars"]) * 100
    tot_exact = (overall["exact_match"] / len(detailed_rows)) * 100
    print(f"{'GESAMT':<12} | {len(detailed_rows):<6} | {tot_g_cer:>8.2f} %   | {tot_b_cer:>8.2f} %   | {tot_exact:>9.1f} %")
    print("=" * 70)

    # Detaillierte Proben-Ausgabe
    print("\nEINZELERGEBNISSE AUS DEN NUTZER-NOTIZEN:")
    for row in detailed_rows:
        status = "OK" if row["greedy_dist"] == 0 else f"Err={row['greedy_dist']}"
        print(f"[{row['category']:<6}] Soll: {row['ground_truth']:<30} | Greedy: {row['greedy_pred']:<25} | Conf: {row['confidence']:.2f} | {status}")

    return {
        "overall_greedy_cer": tot_g_cer,
        "overall_beam_cer": tot_b_cer,
        "by_category": results_by_cat,
        "rows": detailed_rows
    }


if __name__ == "__main__":
    run_user_benchmark()
