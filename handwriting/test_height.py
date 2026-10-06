import sys
import math
import numpy as np
import onnxruntime as ort
sys.path.insert(0, "handwriting")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from generate_synthetic import generate_word_strokes
from train import ctc_greedy_decode

session = ort.InferenceSession("handwriting/model.onnx")

def resample_js(pts, step):
    out = [[pts[0][0], pts[0][1]]]
    cur = 0
    for i in range(1, len(pts)):
        p0, p1 = pts[i-1], pts[i]
        d = math.hypot(p1[0]-p0[0], p1[1]-p0[1])
        if d == 0: continue
        w = 0
        while cur + (d - w) >= step:
            rem = step - cur
            w += rem
            t = w / d
            out.append([p0[0] + (p1[0]-p0[0])*t, p0[1] + (p1[1]-p0[1])*t])
            cur = 0
        cur += (d - w)
    return out

strokes_raw = generate_word_strokes("Hallo")
all_pts = [p for s in strokes_raw for p in s]
h = max(p[1] for p in all_pts) - min(p[1] for p in all_pts)

print("Teste verschiedene Handschrift-Größen auf Canvas:")
for target_h in [15, 25, 40, 60, 100, 200, 500]:
    scale_ipad = target_h / h
    ipad_strokes = [[(p[0]*scale_ipad, p[1]*scale_ipad) for p in s] for s in strokes_raw]

    # Neuer adaptiver Schritt!
    step_adaptive = max(1.5, target_h * 0.045)
    resampled = [resample_js(s, step_adaptive) for s in ipad_strokes]
    all_r = [p for s in resampled for p in s]
    height_r = max(10.0, max(p[1] for p in all_r) - min(p[1] for p in all_r))
    scale_r = 1.0 / height_r

    features_js = []
    last_x, last_y = None, None
    for s in resampled:
        first = s[0]
        if last_x is not None:
            features_js.append(((first[0]-last_x)*scale_r, (first[1]-last_y)*scale_r, 0.0))
        last_x, last_y = first[0], first[1]
        for p in s[1:]:
            features_js.append(((p[0]-last_x)*scale_r, (p[1]-last_y)*scale_r, 1.0))
            last_x, last_y = p[0], p[1]

    inp = np.array([features_js], dtype=np.float32)
    out = session.run(None, {"input": inp})[0][:, 0, :]
    rec = ctc_greedy_decode(out)
    print(f"Höhe {target_h:3d}px: Erkannt: '{rec:<10}' (Punkte: {len(features_js)})")
