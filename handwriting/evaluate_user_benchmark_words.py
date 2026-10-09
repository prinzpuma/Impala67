import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
import json
import os
import math
import numpy as np
import onnxruntime as ort

from vocabulary import index_to_char, BLANK_IDX
from mathwriting_loader import resample_stroke, strokes_to_normalized_features

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "web", "handwriting-model.onnx")
DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "benchmark_test_strokes.json")

def stroke_bbox(s):
    xs = [p[0] for p in s]
    ys = [p[1] for p in s]
    return min(xs), max(xs), min(ys), max(ys)

def calculate_stroke_height_median(strokes, fallback=10.0):
    if not strokes:
        return fallback
    heights = []
    for s in strokes:
        if not s:
            continue
        ys = [p[1] for p in s]
        h = max(ys) - min(ys)
        if h > 0:
            heights.append(h)
    if not heights:
        return fallback
    return float(np.median(heights))

def segment_line_into_words(strokes, gap_thresh=None, gap_factor=1.1):
    if not strokes:
        return []
    if gap_thresh is None:
        med_h = calculate_stroke_height_median(strokes)
        gap_thresh = max(4.0, gap_factor * med_h)
    words = []
    cur_word = [strokes[0]]
    cur_box = list(stroke_bbox(strokes[0]))

    for s in strokes[1:]:
        b = stroke_bbox(s)
        gap = b[0] - cur_box[1]
        if gap > gap_thresh:
            words.append(cur_word)
            cur_word = [s]
            cur_box = list(b)
        else:
            cur_word.append(s)
            cur_box[1] = max(cur_box[1], b[1])
    words.append(cur_word)
    return words

# Gemeinsame Feature-Funktion (identisch mit Training und handwriting-preprocessor.js)
strokes_to_4features = strokes_to_normalized_features

def levenshtein_distance(s1: str, s2: str) -> int:
    m, n = len(s1), len(s2)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1): dp[i][0] = i
    for j in range(n + 1): dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if s1[i - 1] == s2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[m][n]

def line_distance(pred: str, gt: str, mode: str = "text"):
    """(Fehler, Zeichen) einer Zeile. In Formeln zählen Leerzeichen nicht: "15+27=42" ist inhaltlich richtig."""
    if mode == "math":
        pred, gt = "".join(pred.split()), "".join(gt.split())
    return levenshtein_distance(pred, gt), max(1, len(gt))

def ctc_greedy(logits, mode="text"):
    if mode != "math":
        from vocabulary import MATH_INDICES
        logits = logits.copy()
        for m_idx in MATH_INDICES:
            logits[:, m_idx] = -1e9
    exp_l = np.exp(logits - np.max(logits, axis=-1, keepdims=True))
    probs = exp_l / np.sum(exp_l, axis=-1, keepdims=True)
    preds = np.argmax(probs, axis=-1)
    confs = np.max(probs, axis=-1)
    collapsed = []
    char_confs = []
    prev = None
    for p, c in zip(preds, confs):
        if p != prev:
            if p != BLANK_IDX:
                collapsed.append(index_to_char(int(p)))
                char_confs.append(float(c))
            prev = p
    return "".join(collapsed), (float(np.mean(char_confs)) if char_confs else 0.0)

LINES_GROUND_TRUTH = {
    0: ("wörter", "Apfel, Käse, Größe, Straße, Zukunft, Übung, Physik, Notiz, schnell, blau"),
    1: ("satz", "Das ist ein Test."),
    2: ("satz", "Heute ist schönes Wetter."),
    3: ("satz", "Impala läuft lokal im Browser."),
    4: ("satz", "Wir trainieren auf der GPU."),
    5: ("formel", "a^2 + b^2 = c^2"),
    6: ("formel", "f(x) = 2x + 1"),
    7: ("formel", "E = m * c^2"),
    8: ("rechnung", "15 + 27 = 42"),
    9: ("rechnung", "120 / 4 = 30"),
    10: ("symbole", "A, b, g, x, y, 7, 8, 9, +, -, =, ?"),
}

def evaluate_benchmark(model_path=MODEL_PATH, session=None, verbose=True):
    if session is None:
        session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    data = json.load(open(DATA_PATH, encoding="utf-8"))

    if verbose:
        print("=" * 75)
        print("ERGEBNISSE WIE IN DER APP (ganze Zeile, Greedy-CTC, ohne Wortkorrektur)")
        print("=" * 75)

    total_chars = 0
    total_errors = 0
    test_chars = 0
    test_errors = 0
    sel_chars = 0
    sel_errors = 0

    for row in data:
        l_idx = row["lineIdx"]
        cat, gt = LINES_GROUND_TRUTH.get(l_idx, ("unbekannt", ""))
        line_mode = "math" if cat in ("formel", "rechnung") else "text"
        parsed_strokes = [[(float(p[0]), float(p[1])) for p in s] for s in row["strokes"]]
        feats = strokes_to_normalized_features(parsed_strokes)
        line_pred, conf = "", 0.0
        if len(feats) >= 3:
            inp = np.array(feats, dtype=np.float32).reshape(1, len(feats), 4)
            line_pred, conf = ctc_greedy(session.run(["output"], {"input": inp})[0][:, 0, :], mode=line_mode)
        dist, gt_len = line_distance(line_pred, gt, line_mode)
        acc = max(0.0, (1.0 - dist / gt_len) * 100.0)
        
        total_chars += gt_len
        total_errors += dist
        if l_idx % 2 == 1:
            test_chars += gt_len
            test_errors += dist
        else:
            sel_chars += gt_len
            sel_errors += dist
        
        if verbose:
            split_tag = "TEST" if l_idx % 2 == 1 else "SEL "
            print(f"[{cat:<8}|{split_tag}] Zeile {l_idx:02d} | Genauigkeit: {acc:>5.1f} % | Conf: {conf:.2f}")
            print(f"  Soll: '{gt}'")
            print(f"  Ist : '{line_pred}'")
            print("-" * 75)

    overall_cer = total_errors / max(1, total_chars)
    test_cer = test_errors / max(1, test_chars)
    sel_cer = sel_errors / max(1, sel_chars)
    overall_acc = max(0.0, (1.0 - overall_cer) * 100.0)
    test_acc = max(0.0, (1.0 - test_cer) * 100.0)
    sel_acc = max(0.0, (1.0 - sel_cer) * 100.0)
    if verbose:
        print(f"TEST-CER     (ungerade Zeilen): {test_cer * 100:.1f} % (Genauigkeit: {test_acc:.1f} %)")
        print(f"AUSWAHL-CER    (gerade Zeilen): {sel_cer * 100:.1f} % (Genauigkeit: {sel_acc:.1f} %)")
        print(f"GESAMT-CER       (alle Zeilen): {overall_cer * 100:.1f} % (Genauigkeit: {overall_acc:.1f} %)")
        print("=" * 75)
    return test_cer

if __name__ == "__main__":
    # Optional anderes Modell, z.B. das frisch trainierte model.onnx vor "train.py --publish"
    evaluate_benchmark(sys.argv[1] if len(sys.argv) > 1 else MODEL_PATH)

