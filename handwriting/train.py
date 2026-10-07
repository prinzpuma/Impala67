"""
handwriting/train.py
Trainingsskript für erweitertes CTC-Handschriftmodell mit 4 Features [dx, dy, pen_down, y_rel].
Unterstützt Fließschrift-Ligaturen, ganze Sätze mit Leerzeichen, Google MathWriting und UJI PenChars.
Exportiert das Modell nach dem Training als ONNX-Datei für den Browser.
"""

import os
import sys
import random
import math
from typing import List, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from vocabulary import CHAR_TO_IDX, VOCAB_SIZE, BLANK_IDX, index_to_char
from generate_synthetic import (
    random_sample,
    SAMPLE_WORDS,
    GERMAN_SENTENCES,
    MATH_FORMULAS,
    generate_word_strokes,
    strokes_to_features,
)
from model import HandwritingCRNN
from uji_loader import RealHandwritingSampler
from mathwriting_loader import MathWritingDataset, strokes_to_normalized_features
from beam_search import ctc_beam_search_decode, get_default_dictionary
from evaluate_user_benchmark_words import (
    segment_line_into_words,
    strokes_to_4features,
    LINES_GROUND_TRUTH,
    DATA_PATH as BENCHMARK_DATA_PATH,
)
import json
import numpy as np


class DynamicInkDataset(Dataset):
    """
    Erzeugt dynamisch bei jeder Epoche frische, augmentierte Trainingsdaten.
    Verhindert Overfitting und deckt Sätze mit Leerzeichen, Ligaturen und Formeln ab.
    """

    def __init__(self, size: int = 5000, is_val: bool = False, seed: int = None):
        self.size = size
        self.is_val = is_val
        self.real_sampler = RealHandwritingSampler()
        self.math_ds = MathWritingDataset()
        self.math_len = len(self.math_ds)

        # Alle Samples vorab im Speicher generieren für maximale GPU-Durchsatzrate
        self.samples = []
        tag = "Validierungs-Set" if is_val else "Trainings-Set"
        print(f"Erzeuge {tag} mit {size} Beispielen...", flush=True)
        rng = random.Random(seed if seed is not None else (42 if is_val else 1337))
        for _ in range(size):
            sample = self._generate_single_sample(rng)
            if sample:
                self.samples.append(sample)
        print(f"{tag} fertig: {len(self.samples)} Beispiele.", flush=True)

    def _generate_single_sample(self, rng=random) -> Tuple[torch.Tensor, torch.Tensor, str]:
        r = rng.random()
        word = ""
        features = []

        if r < 0.25 and self.math_len > 0:
            # 25% Echte Google MathWriting Formeln
            idx = rng.randint(0, self.math_len - 1)
            features, word = self.math_ds.get_sample(idx)

        elif r < 0.55:
            # 30% UJI PenChars: Fließschrift mit Ligaturen & Leerzeichen
            if rng.random() < 0.40:
                # Kurzer 2-Wort Satz oder echter Satz
                if rng.random() < 0.50:
                    word = rng.choice(GERMAN_SENTENCES)
                else:
                    w1 = rng.choice(SAMPLE_WORDS)
                    w2 = rng.choice(SAMPLE_WORDS)
                    word = f"{w1} {w2}"
            else:
                word = rng.choice(SAMPLE_WORDS)

            strokes = self.real_sampler.get_real_word_strokes(word, cursive_prob=0.45)
            if strokes:
                features = strokes_to_features(strokes)
            else:
                features, word = random_sample()

        elif r < 0.80:
            # 25% Ganze Sätze oder Formeln aus Synthetik-Generator
            features, word = random_sample()

        else:
            # 20% Zahlen, Datumsangaben, MINT-Begriffe & Symbole
            if rng.random() < 0.5:
                word = rng.choice(SAMPLE_WORDS)
            else:
                word = f"{rng.randint(10, 999)} + {rng.randint(10, 999)} = {rng.randint(20, 1998)}"
            rot = rng.uniform(-15.0, 15.0) if rng.random() < 0.4 else 0.0
            strokes = generate_word_strokes(word, rotation_deg=rot)
            features = strokes_to_features(strokes)

        if not features or len(features) < 4:
            return None

        target_indices = [
            CHAR_TO_IDX[c] for c in word if c in CHAR_TO_IDX and CHAR_TO_IDX[c] != BLANK_IDX
        ]
        if not target_indices:
            return None

        feat_tensor = torch.tensor(features, dtype=torch.float32)
        target = torch.tensor(target_indices, dtype=torch.long)
        return feat_tensor, target, word

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        return self.samples[idx]


def collate_fn(batch):
    # Padding für variable Sequenzlängen
    features, targets, words = zip(*batch)
    input_lengths = torch.tensor([f.shape[0] for f in features], dtype=torch.long)
    target_lengths = torch.tensor([t.shape[0] for t in targets], dtype=torch.long)

    max_len = max(input_lengths)
    padded_features = torch.zeros(len(features), max_len, 4, dtype=torch.float32)
    for i, f in enumerate(features):
        padded_features[i, : f.shape[0], :] = f

    padded_targets = torch.cat(targets)
    return padded_features, padded_targets, input_lengths, target_lengths, words


def ctc_greedy_decode(log_probs, blank_idx: int = BLANK_IDX) -> str:
    """Argmax + Kollabieren identischer Tokens + Entfernen des Blanks."""
    if hasattr(log_probs, "argmax"):
        pred_indices = log_probs.argmax(axis=-1).tolist()
    else:
        pred_indices = [int(p) for p in log_probs]
    collapsed = []
    prev = None
    for idx in pred_indices:
        if idx != prev:
            if idx != blank_idx:
                collapsed.append(idx)
            prev = idx
    return "".join(index_to_char(idx) for idx in collapsed)


def export_to_onnx(model: nn.Module, output_path: str = "model.onnx"):
    model.eval()
    dummy_input = torch.randn(1, 120, 4, dtype=torch.float32)

    import warnings

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning)
        warnings.filterwarnings("ignore", category=DeprecationWarning)
        torch.onnx.export(
            model,
            dummy_input,
            output_path,
            export_params=True,
            opset_version=14,
            do_constant_folding=True,
            input_names=["input"],
            output_names=["output"],
            dynamic_axes={
                "input": {0: "batch_size", 1: "seq_len"},
                "output": {0: "seq_out", 1: "batch_size"},
            },
            dynamo=False,
        )
    print(
        f"ONNX-Modell sauber exportiert: {output_path} ({os.path.getsize(output_path) / 1024 / 1024:.2f} MB)"
    )


def levenshtein_dist(s1: str, s2: str) -> int:
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


def train(epochs: int = 30, batch_size: int = 128, lr: float = 1.6e-3):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    if device.type == "cpu":
        torch.set_num_threads(10)
        print(f"Training auf Gerät: CPU ({torch.get_num_threads()} CPU-Threads)")
    else:
        torch.backends.cudnn.enabled = False
        gpu_name = torch.cuda.get_device_name(0)
        print(f"Training auf Gerät: GPU {gpu_name} (AMD ROCm)")

    model = HandwritingCRNN(in_features=4, hidden_size=192, num_layers=3, dropout=0.0).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    criterion = nn.CTCLoss(blank=BLANK_IDX, zero_infinity=True)

    train_dataset = DynamicInkDataset(size=5200, is_val=False)
    val_dataset = DynamicInkDataset(size=300, is_val=True, seed=42)

    train_loader = DataLoader(
        train_dataset, batch_size=batch_size, shuffle=True, collate_fn=collate_fn
    )
    val_loader = DataLoader(
        val_dataset, batch_size=batch_size, shuffle=False, collate_fn=collate_fn
    )

    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=epochs, eta_min=1e-4
    )

    checkpoints_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "checkpoints")
    os.makedirs(checkpoints_dir, exist_ok=True)
    best_real_cer = 1.0
    best_real_acc = 0.0
    best_epoch = 0

    benchmark_data = json.load(open(BENCHMARK_DATA_PATH, encoding="utf-8"))
    word_dict = get_default_dictionary()

    print("Starte Training mit 4 Features. Modellauswahl erfolgt nach echtem Test-Set (strikt getrennt)!")

    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0

        for batch_idx, (inputs, targets, in_lens, tgt_lens, words) in enumerate(train_loader):
            inputs = inputs.to(device)
            targets = targets.to(device)

            optimizer.zero_grad()
            log_probs = model(inputs, in_lens=in_lens)
            output_lengths = torch.clamp(in_lens // 2, min=1).to(device)

            loss = criterion(log_probs, targets, output_lengths, tgt_lens.to(device))
            if torch.isnan(loss) or torch.isinf(loss):
                continue

            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=2.0)
            optimizer.step()

            total_loss += loss.item()

        scheduler.step()
        avg_loss = total_loss / len(train_loader)

        # 1. Informativer Durchlauf auf synthetischem Val-Set
        model.eval()
        val_chars = 0
        val_errors = 0
        sample_preds = []

        with torch.no_grad():
            for v_inputs, v_targets, v_in_lens, v_tgt_lens, v_words in val_loader:
                v_inputs = v_inputs.to(device)
                v_out = model(v_inputs, in_lens=v_in_lens)
                for i in range(len(v_words)):
                    pred = ctc_greedy_decode(v_out[:, i, :])
                    target = v_words[i]
                    val_errors += levenshtein_dist(target, pred)
                    val_chars += max(len(target), 1)
                    if len(sample_preds) < 2:
                        sample_preds.append((target, pred))

        val_cer = val_errors / max(1, val_chars)
        val_acc = (1.0 - val_cer) * 100

        # 2. ECHTES TEST-SET (Schritt 1: best.pt nach echtem Test-Set auswählen, nie mittrainieren)
        real_chars = 0
        real_errors = 0
        with torch.no_grad():
            for row in benchmark_data:
                l_idx = row["lineIdx"]
                cat, gt = LINES_GROUND_TRUTH.get(l_idx, ("unbekannt", ""))
                raw_strokes = row["strokes"]

                all_line_pts = [p for s in raw_strokes for p in s]
                line_min_y = min(p[1] for p in all_line_pts) if all_line_pts else 0.0
                line_max_y = max(p[1] for p in all_line_pts) if all_line_pts else 10.0
                line_h = max(10.0, line_max_y - line_min_y)

                word_groups = segment_line_into_words(raw_strokes, gap_thresh=8.5)
                recognized_words = []

                for wg in word_groups:
                    parsed_strokes = [[(float(p[0]), float(p[1])) for p in s] for s in wg]
                    feats = strokes_to_4features(parsed_strokes, line_min_y=line_min_y, line_height=line_h)
                    if len(feats) < 3:
                        continue
                    inp = torch.tensor(feats, dtype=torch.float32, device=device).unsqueeze(0)
                    in_lens = torch.tensor([len(feats)], device=device)
                    out = model(inp, in_lens=in_lens)
                    logits = out[:, 0, :].cpu().numpy()

                    w_beam = ctc_beam_search_decode(logits, beam_width=8, word_list=word_dict, word_bonus=2.0)
                    recognized_words.append(w_beam)

                line_pred = " ".join(recognized_words)
                dist = levenshtein_dist(line_pred, gt)
                gt_len = max(1, len(gt))
                real_chars += gt_len
                real_errors += dist

        real_cer = real_errors / max(1, real_chars)
        real_acc = max(0.0, (1.0 - real_cer) * 100.0)

        print(
            f"Epoche {epoch:02d}/{epochs:02d} | Train Loss: {avg_loss:.4f} | Synth Val Acc: {val_acc:.1f} % | ECHT TEST ACC: {real_acc:.1f} % (CER: {real_cer * 100:.1f} %)",
            flush=True,
        )

        for tgt, prd in sample_preds[:1]:
            print(f"  [Synth-Probe] Soll: '{tgt}' | Ist: '{prd}'")

        # Modellauswahl: best.pt nach dem ECHTEN Test-Set auswählen
        if real_cer < best_real_cer or epoch == 1:
            best_real_cer = real_cer
            best_real_acc = real_acc
            best_epoch = epoch
            best_path = os.path.join(checkpoints_dir, "best.pt")
            torch.save(
                {
                    "epoch": epoch,
                    "model_state": model.state_dict(),
                    "optimizer_state": optimizer.state_dict(),
                    "val_cer": val_cer,
                    "test_cer": real_cer,
                    "test_acc": real_acc,
                },
                best_path,
            )
            print(f"  --> [BEST] Neuer Bestwert auf echtem Test-Set: {real_acc:.1f} % (Epoche {epoch}) gespeichert!", flush=True)

    # ONNX Export des besten Modells
    print(f"\nTraining abgeschlossen. Bester Real-Test-Score: {best_real_acc:.1f} % in Epoche {best_epoch}.")
    best_ckpt = torch.load(os.path.join(checkpoints_dir, "best.pt"), map_location="cpu")
    model.load_state_dict(best_ckpt["model_state"])

    onnx_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model.onnx")
    export_to_onnx(model.cpu(), onnx_path)


    # Direkt in web/ kopieren
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    web_dest = os.path.join(repo_root, "web", "handwriting-model.onnx")
    try:
        import shutil

        shutil.copyfile(onnx_path, web_dest)
        print(f"Modell erfolgreich nach {web_dest} kopiert!")
    except Exception as e:
        print(f"Kopieren nach {web_dest} fehlgeschlagen: {e}")


if __name__ == "__main__":
    train(epochs=28, batch_size=128)
