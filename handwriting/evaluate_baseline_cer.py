"""
handwriting/evaluate_baseline_cer.py
Berechnet die Ausgangswerte (Baseline CER & Genauigkeit) des aktuellen ONNX-Modells
durch die echte Inferenz-Pipeline, aufgeteilt in vier Gruppen:
1. Buchstaben (Letters & Digits)
2. Neue Wörter (Words)
3. Sätze (Sentences)
4. Einzeilige Formeln (Formulas)
"""

import sys
import os
import time
import numpy as np
import onnxruntime as ort

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from generate_synthetic import generate_word_strokes, strokes_to_features
from train import ctc_greedy_decode

def levenshtein(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        curr = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = prev[j + 1] + 1
            deletions = curr[j] + 1
            substitutions = prev[j] + (c1 != c2)
            curr.append(min(insertions, deletions, substitutions))
        prev = curr
    return prev[-1]

# Testdatensatz: 4 Gruppen
TEST_SUITE = {
    "Buchstaben": [
        "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
        "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
        "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
        "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
        "ä", "ö", "ü", "Ä", "Ö", "Ü", "ß",
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"
    ],
    "Wörter": [
        "Notiz", "Aufgabe", "Plan", "Ziel", "Text", "Haus", "Code", "Arbeit",
        "Größe", "Über", "Lösung", "Projekt", "Idee", "Treffen", "Wichtig",
        "Datum", "Schule", "Fehler", "Version", "heute", "morgen", "Farbe",
        "Zeile", "Karte", "Woche", "Monat", "Stunde", "Frage", "Antwort"
    ],
    "Sätze": [
        "Das ist ein Test",
        "Heute neue Notizen schreiben",
        "Wir planen das nächste Release",
        "Aufgabe für Montag erledigen",
        "Gute Ideen sofort aufschreiben",
        "Code testen und verbessern",
        "Wichtige Notiz für das Meeting"
    ],
    "Einzeilige Formeln": [
        "f(x)=x^2", "1+2=3", "a^2+b^2=c^2", "E=mc^2", "y=2x+1",
        "v=s/t", "x>0", "x<5", "1/2", "3/4", "x=y", "A+B",
        "100%", "Nr.1", "2*3=6", "x-y=0"
    ]
}

def evaluate():
    model_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model.onnx")
    if not os.path.exists(model_path):
        print(f"Fehler: Modell nicht gefunden unter {model_path}")
        return

    session = ort.InferenceSession(model_path)
    report_lines = [
        "# Ausgangswert (Baseline): CER des aktuellen Modells",
        "",
        f"- **Modell:** `{os.path.basename(model_path)}` ({os.path.getsize(model_path) / 1024 / 1024:.2f} MB)",
        f"- **Datum:** {time.strftime('%Y-%m-%d %H:%M:%S')}",
        "- **Pipeline:** Vektor-Digital-Ink (äquidistantes Resampling, 3 Delta-Features) -> ONNX -> Greedy CTC",
        "",
        "| Gruppe | Anzahl Samples | Exakt Richtig (Acc) | Gesamt-Distanz | Zeichen gesamt | CER (%) | Ø Latenz (ms) |",
        "| :--- | :---: | :---: | :---: | :---: | :---: | :---: |"
    ]

    total_samples = 0
    total_correct = 0
    total_dist = 0
    total_chars = 0
    total_time = 0.0

    group_details = {}

    for group_name, items in TEST_SUITE.items():
        grp_correct = 0
        grp_dist = 0
        grp_chars = 0
        grp_time = 0.0
        details = []

        for text in items:
            strokes = generate_word_strokes(text)
            features = strokes_to_features(strokes)
            inp = np.array([features], dtype=np.float32)

            t0 = time.perf_counter()
            outputs = session.run(None, {"input": inp})
            dt = (time.perf_counter() - t0) * 1000.0

            logits = outputs[0][:, 0, :]
            pred = ctc_greedy_decode(logits)

            dist = levenshtein(text, pred)
            is_ok = (pred == text)
            if is_ok:
                grp_correct += 1
            grp_dist += dist
            grp_chars += len(text)
            grp_time += dt

            details.append({
                "target": text,
                "pred": pred,
                "dist": dist,
                "ok": is_ok,
                "ms": dt
            })

        cer = (grp_dist / grp_chars * 100.0) if grp_chars > 0 else 0.0
        acc = (grp_correct / len(items) * 100.0) if items else 0.0
        avg_ms = grp_time / len(items) if items else 0.0

        report_lines.append(
            f"| **{group_name}** | {len(items)} | {grp_correct}/{len(items)} ({acc:.1f}%) | {grp_dist} | {grp_chars} | **{cer:.2f}%** | {avg_ms:.2f} ms |"
        )

        total_samples += len(items)
        total_correct += grp_correct
        total_dist += grp_dist
        total_chars += grp_chars
        total_time += grp_time
        group_details[group_name] = details

    total_cer = (total_dist / total_chars * 100.0) if total_chars > 0 else 0.0
    total_acc = (total_correct / total_samples * 100.0) if total_samples > 0 else 0.0
    total_avg_ms = total_time / total_samples if total_samples > 0 else 0.0

    report_lines.append(
        f"| **GESAMT** | **{total_samples}** | **{total_correct}/{total_samples} ({total_acc:.1f}%)** | **{total_dist}** | **{total_chars}** | **{total_cer:.2f}%** | **{total_avg_ms:.2f} ms** |"
    )

    report_lines.append("")
    report_lines.append("## Detailanalyse Abweichungen")
    report_lines.append("")
    for group_name, details in group_details.items():
        diffs = [d for d in details if not d["ok"]]
        report_lines.append(f"### {group_name} ({len(diffs)} Abweichungen von {len(details)})")
        if not diffs:
            report_lines.append("- Alle Proben zu 100 % fehlerfrei erkannt.")
        else:
            report_lines.append("| Soll | Ist | Levenshtein-Distanz | Latenz |")
            report_lines.append("| :--- | :--- | :---: | :---: |")
            for d in diffs:
                report_lines.append(f"| `{d['target']}` | `{d['pred']}` | {d['dist']} | {d['ms']:.1f} ms |")
        report_lines.append("")

    report_text = "\n".join(report_lines)
    baseline_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "BASELINE_CER.md")
    with open(baseline_path, "w", encoding="utf-8") as f:
        f.write(report_text)

    print(report_text)
    print(f"\nBaseline CER erfolgreich gespeichert nach: {baseline_path}")

if __name__ == "__main__":
    evaluate()
