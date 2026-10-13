"""
Misst ein Modell an echten Heft-Mitschriften (benchmark_notizen.json: [{text, strokes, source}]).
Nur Messung, nie Training. Aufruf: python evaluate_notes_benchmark.py [model.onnx] [daten.json]
"""
import sys
import json
import os
import onnxruntime as ort

from rasterize import render_strokes
from evaluate_user_benchmark_words import MODEL_PATH, ctc_greedy, line_distance

DATA_PATH = os.path.join(os.path.dirname(__file__), "benchmark_notizen.json")


def evaluate_notes(model_path=MODEL_PATH, data_path=DATA_PATH, show_worst=15):
    session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    rows = []
    for item in json.load(open(data_path, encoding="utf-8")):
        gt = str(item.get("text", "")).strip()
        strokes = [[(float(p[0]), float(p[1])) for p in (s.get("pts", s) if isinstance(s, dict) else s)] for s in item.get("strokes", [])]
        strokes = [s for s in strokes if s]
        if not gt or not strokes:
            continue
        logits = session.run(["output"], {"input": render_strokes(strokes)[None, None]})[0][:, 0, :]
        pred = ctc_greedy(logits)[0].strip()
        dist, n = line_distance(pred, gt)
        rows.append((dist / n, dist, n, item.get("source", ""), gt, pred))

    errors = sum(r[1] for r in rows)
    chars = sum(r[2] for r in rows)
    print(f"Zeilen: {len(rows)} | Zeichen: {chars} | CER: {errors / max(1, chars) * 100:.1f} % | perfekt: {sum(1 for r in rows if r[1] == 0)}")
    print(f"\nSchlechteste {show_worst} Zeilen:")
    for cer, _, _, src, gt, pred in sorted(rows, reverse=True)[:show_worst]:
        print(f"  {cer * 100:5.1f} %  {src}\n    Soll: {gt}\n    Ist : {pred}")
    return errors / max(1, chars)


if __name__ == "__main__":
    evaluate_notes(*(sys.argv[1:3]))
