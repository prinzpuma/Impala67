import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
import json
import os

RAW_PATH = os.path.join(os.path.dirname(__file__), "data", "user_eval_raw.json")
OUT_PATH = os.path.join(os.path.dirname(__file__), "data", "user_eval_testset.json")

with open(RAW_PATH, "r", encoding="utf-8") as f:
    raw = json.load(f)

items = raw.get("items", [])

# Zuordnung von verifizierten Ground-Truth-Labels für die echten Nutzer-Notizen
MAPPINGS = [
    # 1. Sätze & Aussagen
    (0, "satz", "Hi was geht ?"),
    (1, "satz", "Ok hallo."),
    (28, "satz", "DGL 1. Ordnung — Übungen"),
    (29, "satz", "Trennung der Variablen & Variation der Konstanten"),
    (30, "satz", "A. Trennung der Variablen"),
    (31, "satz", "Löse die DGL:"),
    (41, "satz", "steht auf dem Zettel"),
    (46, "satz", "Aufgabe 1.1:"),
    (127, "satz", "Eigenwerte bestimmen"),

    # 2. Wörter
    (4, "wort", "Hallo"),
    (9, "wort", "lernen"),
    (11, "wort", "offen"),
    (18, "wort", "Leitwert"),
    (19, "wort", "Leitfähigkeit"),
    (171, "wort", "Nullstelle"),
    (193, "wort", "Eigenwerte"),

    # 3. Formeln & Gleichungen
    (5, "formel", "3 + 3 = 6"),
    (17, "formel", "R = rho * l / A"),
    (32, "formel", "y' = 2xy"),
    (90, "formel", "x + y + z = 4"),
    (91, "formel", "3x - y + z = 1"),
    (96, "formel", "z = 2"),
    (100, "formel", "y = -3"),
    (128, "formel", "det(A - lambda E) = 0"),
    (168, "formel", "lambda = 1"),

    # 4. Einzelzeichen & Symbole
    (6, "symbol", "S."),
    (7, "symbol", "v"),
    (10, "symbol", "V"),
    (14, "symbol", "3."),
    (134, "symbol", "45"),
    (187, "symbol", "+"),
]

testset = []
for idx, cat, gt in MAPPINGS:
    if idx < len(items):
        it = items[idx]
        testset.append({
            "id": f"user_eval_{idx:03d}",
            "source_doc": it.get("docTitle", ""),
            "page_idx": it.get("pageIdx", 0),
            "line_idx": it.get("lineIdx", 0),
            "category": cat,
            "ground_truth": gt,
            "strokes": it.get("strokes", []),
            "stroke_count": len(it.get("strokes", [])),
        })

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump({
        "description": "Exklusives Benchmark-Testset ausschließlich aus echten Tablet-Strichen des Nutzers.",
        "leakage_protection": "STRIKT GETRENNT: Darf niemals im Training (train.py, samples_loader.py) geladen werden!",
        "count": len(testset),
        "by_category": {
            "wort": sum(1 for x in testset if x["category"] == "wort"),
            "satz": sum(1 for x in testset if x["category"] == "satz"),
            "formel": sum(1 for x in testset if x["category"] == "formel"),
            "symbol": sum(1 for x in testset if x["category"] == "symbol"),
        },
        "samples": testset
    }, f, ensure_ascii=False, indent=2)

print(f"Benutzer-Testset erfolgreich erstellt: {OUT_PATH}")
print(f"Gesamtanzahl Test-Samples: {len(testset)}")
for cat in ["symbol", "wort", "satz", "formel"]:
    c = sum(1 for x in testset if x["category"] == cat)
    print(f"  - Kategorie '{cat}': {c} Samples")
