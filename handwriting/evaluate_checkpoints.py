"""
handwriting/evaluate_checkpoints.py
Vergleicht Checkpoints (z. B. best.pt / last.pt) auf echter Handschrift, ohne zu trainieren.
Gewählt wird nach der Auswahl-CER (gerade Benchmark-Zeilen + Abschreib-Messzeilen), nie nach TEST.

  python evaluate_checkpoints.py --samples data/my_handwriting_samples.json a.pt b.pt [--write-best gewaehlt.txt]
"""

import argparse
import json
import sys

import torch

from model import HandwritingCRNN
from samples_loader import load_user_eval_lines
from train import BENCHMARK_DATA_PATH, evaluate_real

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoints", nargs="+")
    parser.add_argument("--samples", default="my_handwriting_samples.json")
    parser.add_argument("--write-best", default=None, help="Pfad des besten Checkpoints in diese Datei schreiben")
    parser.add_argument("--cpu", action="store_true", help="GPU nicht benutzen")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    benchmark_data = json.load(open(BENCHMARK_DATA_PATH, encoding="utf-8"))
    user_eval_lines = load_user_eval_lines(args.samples)
    print(f"{len(user_eval_lines)} Abschreib-Messzeilen, {len(benchmark_data)} Benchmark-Zeilen")

    results = []
    for path in args.checkpoints:
        state = torch.load(path, map_location=device)
        model = HandwritingCRNN(in_features=4, hidden_size=192, num_layers=3, dropout=0.0).to(device)
        model.load_state_dict(state.get("model_state", state))
        r = evaluate_real(model, device, benchmark_data, user_eval_lines)
        results.append((r["sel"], path))
        print(
            f"{path} (Epoche {state.get('epoch', '?')}): Auswahl-CER {r['sel'] * 100:.1f} % "
            f"(Abschreib-Messzeilen {r['own'] * 100:.1f} %) | TEST-CER {r['test'] * 100:.1f} %"
        )

    best = min(results)[1]
    print(f"Gewählt nach Auswahl-CER: {best}")
    if args.write_best:
        with open(args.write_best, "w", encoding="utf-8") as f:
            f.write(best)


if __name__ == "__main__":
    main()
