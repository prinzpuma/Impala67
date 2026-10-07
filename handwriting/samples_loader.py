"""
handwriting/samples_loader.py
Lädt in Impala67 gesammelte Handschrift-Beispiele (my_handwriting_samples.json)
und bereitet sie für PyTorch-Training und Fine-Tuning vor.
"""

import json
import os
from typing import List, Tuple
import torch
from torch.utils.data import Dataset
from vocabulary import CHAR_TO_IDX
from generate_synthetic import strokes_to_features


def load_user_samples(json_path: str = "my_handwriting_samples.json") -> List[Tuple[List[Tuple[float, float, float]], str]]:
    """Lädt die aus Impala67 exportierten Trainingsdaten."""
    if "user_eval" in json_path.lower():
        raise RuntimeError("FATALER DATA-LEAKAGE-FEHLER: Die isolierten Testdaten (user_eval_*.json) dürfen NIEMALS im Training geladen werden!")

    if not os.path.exists(json_path):
        return []


    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"Fehler beim Laden von {json_path}: {e}")
        return []

    samples = []
    for item in data:
        text = str(item.get("text", "")).strip()
        strokes_data = item.get("strokes", [])
        if not text or not strokes_data:
            continue

        # Format: Liste von Strichen, jeder Strich ist Liste von (x, y) Punkten
        parsed_strokes = []
        for s in strokes_data:
            pts = s.get("pts", [])
            if pts:
                parsed_strokes.append([(float(p[0]), float(p[1])) for p in pts])

        if parsed_strokes:
            feats = strokes_to_features(parsed_strokes)
            if len(feats) >= 5:
                samples.append((feats, text))

    print(f"{len(samples)} nutzereigene Trainingsbeispiele aus {json_path} geladen.")
    return samples


class HybridInkDataset(Dataset):
    """Kombiniert synthetische Daten mit echten Nutzer-Samples aus Impala67."""
    def __init__(self, synthetic_dataset, user_samples_path: str = "my_handwriting_samples.json", user_weight: float = 0.5):
        self.synthetic_dataset = synthetic_dataset
        self.user_samples = load_user_samples(user_samples_path)
        self.user_weight = user_weight if self.user_samples else 0.0

    def __len__(self):
        return len(self.synthetic_dataset)

    def __getitem__(self, idx):
        import random
        if self.user_samples and random.random() < self.user_weight:
            feats, word = random.choice(self.user_samples)
            feat_tensor = torch.tensor(feats, dtype=torch.float32)
            target = torch.tensor([CHAR_TO_IDX.get(c, 0) for c in word], dtype=torch.long)
            return feat_tensor, target, word

        return self.synthetic_dataset[idx]


if __name__ == "__main__":
    samples = load_user_samples("my_handwriting_samples.json")
    print(f"Gefundene Samples: {len(samples)}")
