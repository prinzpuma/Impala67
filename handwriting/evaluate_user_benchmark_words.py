import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
import json
import os
import math
import numpy as np
import onnxruntime as ort

from vocabulary import index_to_char, BLANK_IDX
from mathwriting_loader import resample_stroke
from beam_search import ctc_beam_search_decode, get_default_dictionary

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.onnx")
DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "benchmark_test_strokes.json")

def stroke_bbox(s):
    xs = [p[0] for p in s]
    ys = [p[1] for p in s]
    return min(xs), max(xs), min(ys), max(ys)

def segment_line_into_words(strokes, gap_thresh=8.5):
    if not strokes:
        return []
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

def strokes_to_4features(strokes, line_min_y=None, line_height=None):
    all_pts = [p for s in strokes for p in s]
    if not all_pts:
        return []
    if line_min_y is None or line_height is None:
        min_y = min(p[1] for p in all_pts)
        max_y = max(p[1] for p in all_pts)
        raw_h = max(10.0, max_y - min_y)
    else:
        min_y = line_min_y
        raw_h = max(10.0, line_height)

    step = max(0.6, raw_h * 0.045)
    resampled = [resample_stroke(s, step) for s in strokes]
    resampled = [s for s in resampled if len(s) >= 2]
    if not resampled:
        return []

    scale = 1.0 / raw_h
    feats = []
    last_x, last_y = None, None

    for s in resampled:
        first = s[0]
        first_y_rel = (first[1] - min_y) * scale - 0.5
        if last_x is not None:
            feats.append(((first[0] - last_x) * scale, (first[1] - last_y) * scale, 0.0, first_y_rel))
        last_x, last_y = first[0], first[1]

        for p in s[1:]:
            y_rel = (p[1] - min_y) * scale - 0.5
            feats.append(((p[0] - last_x) * scale, (p[1] - last_y) * scale, 1.0, y_rel))
            last_x, last_y = p[0], p[1]

    return feats

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

def ctc_greedy(logits):
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
    word_dict = get_default_dictionary()

    if verbose:
        print("=" * 75)
        print("ERGEBNISSE MIT 4-FEATURE-MODELL, LIGATUREN & GROSSEM WÖRTERBUCH")
        print("=" * 75)

    total_chars = 0
    total_errors = 0

    for row in data:
        l_idx = row["lineIdx"]
        cat, gt = LINES_GROUND_TRUTH.get(l_idx, ("unbekannt", ""))
        raw_strokes = row["strokes"]
        
        # Zeilen-Bounding-Box für Grundlinien-Referenz
        all_line_pts = [p for s in raw_strokes for p in s]
        line_min_y = min(p[1] for p in all_line_pts) if all_line_pts else 0.0
        line_max_y = max(p[1] for p in all_line_pts) if all_line_pts else 10.0
        line_h = max(10.0, line_max_y - line_min_y)

        word_groups = segment_line_into_words(raw_strokes, gap_thresh=8.5)
        recognized_words = []
        avg_confs = []
        
        for wg in word_groups:
            parsed_strokes = [[(float(p[0]), float(p[1])) for p in s] for s in wg]
            feats = strokes_to_4features(parsed_strokes, line_min_y=line_min_y, line_height=line_h)
            if len(feats) < 3:
                continue
            inp = np.array(feats, dtype=np.float32).reshape(1, len(feats), 4)
            out = session.run(["output"], {"input": inp})[0]
            logits = out[:, 0, :]
            
            # Beam search mit Wörterbuch
            w_beam = ctc_beam_search_decode(logits, beam_width=8, word_list=word_dict, word_bonus=2.0)
            _, conf = ctc_greedy(logits)
            
            recognized_words.append(w_beam)
            avg_confs.append(conf)
            
        line_pred = " ".join(recognized_words)
        dist = levenshtein_distance(line_pred, gt)
        gt_len = max(1, len(gt))
        acc = max(0.0, (1.0 - dist / gt_len) * 100.0)
        
        total_chars += gt_len
        total_errors += dist
        
        if verbose:
            conf_mean = float(np.mean(avg_confs)) if avg_confs else 0.0
            print(f"[{cat:<8}] Zeile {l_idx:02d} | Genauigkeit: {acc:>5.1f} % | Conf: {conf_mean:.2f}")
            print(f"  Soll: '{gt}'")
            print(f"  Ist : '{line_pred}'")
            print("-" * 75)

    overall_acc = max(0.0, (1.0 - total_errors / total_chars) * 100.0)
    if verbose:
        print(f"GESAMT-GENAUIGKEIT ÜBER ALLE ZEILEN: {overall_acc:.1f} %")
        print("=" * 75)
    return overall_acc

if __name__ == "__main__":
    evaluate_benchmark()

