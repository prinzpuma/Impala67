"""
handwriting/train.py
Trainingsskript für CTC-Handschriftmodell mit synthetischen Daten.
Exportiert das Modell nach dem Training als ONNX-Datei für den Browser.
"""

import os
import sys
import random

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from vocabulary import CHAR_TO_IDX, VOCAB_SIZE, BLANK_IDX, index_to_char
from generate_synthetic import random_sample, SAMPLE_WORDS
from model import HandwritingCRNN


from uji_loader import RealHandwritingSampler
from generate_synthetic import strokes_to_features

class MixedInkDataset(Dataset):
    """Kombiniert echte menschliche Handschrift (UJI Pen Chars) mit Formeln und synthetischen Daten."""
    def __init__(self, size: int = 4000):
        self.samples = []
        real_sampler = RealHandwritingSampler()

        for _ in range(size):
            # 50% echte menschliche Handschrift-Glyphen, 50% mathematische Formeln & synthetische Wörter
            if random.random() < 0.50:
                word = random.choice(SAMPLE_WORDS)
                strokes = real_sampler.get_real_word_strokes(word)
                if not strokes:
                    features, word = random_sample()
                else:
                    features = strokes_to_features(strokes)
            else:
                features, word = random_sample()

            if len(features) < 3:
                continue

            target_indices = [CHAR_TO_IDX[c] for c in word if c in CHAR_TO_IDX and CHAR_TO_IDX[c] != BLANK_IDX]
            if not target_indices:
                continue

            feat_tensor = torch.tensor(features, dtype=torch.float32)
            target = torch.tensor(target_indices, dtype=torch.long)
            self.samples.append((feat_tensor, target, word))

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
    padded_features = torch.zeros(len(features), max_len, 3, dtype=torch.float32)
    for i, f in enumerate(features):
        padded_features[i, :f.shape[0], :] = f

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
    dummy_input = torch.randn(1, 120, 3, dtype=torch.float32)

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
    print(f"ONNX-Modell sauber exportiert: {output_path} ({os.path.getsize(output_path) / 1024 / 1024:.2f} MB)")


from samples_loader import HybridInkDataset

def train(epochs: int = 30, batch_size: int = 32, lr: float = 1.8e-3, user_samples_path: str = "my_handwriting_samples.json"):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cpu":
        torch.set_num_threads(6)
    print(f"Training auf Gerät: {device} ({torch.get_num_threads()} CPU-Threads)")

    model = HandwritingCRNN().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    criterion = nn.CTCLoss(blank=BLANK_IDX, zero_infinity=True)

    base_dataset = MixedInkDataset(size=4500)
    dataset = HybridInkDataset(base_dataset, user_samples_path=user_samples_path)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, collate_fn=collate_fn)

    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-4)

    model.train()
    for epoch in range(1, epochs + 1):
        total_loss = 0.0
        for batch_idx, (inputs, targets, in_lens, tgt_lens, words) in enumerate(loader):
            inputs = inputs.to(device)
            targets = targets.to(device)

            optimizer.zero_grad()
            log_probs = model(inputs)
            output_lengths = torch.clamp(in_lens // 2, min=1).to(device)

            loss = criterion(log_probs, targets, output_lengths, tgt_lens)
            if torch.isnan(loss) or torch.isinf(loss):
                continue

            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=2.0)
            optimizer.step()

            total_loss += loss.item()

        scheduler.step()
        avg_loss = total_loss / len(loader)
        print(f"Epoche {epoch:02d}/{epochs:02d} | Loss: {avg_loss:.4f}")

        if epoch % 5 == 0 or epoch == epochs:
            model.eval()
            with torch.no_grad():
                test_feat, test_word = random_sample()
                test_t = torch.tensor(test_feat, dtype=torch.float32).unsqueeze(0).to(device)
                out = model(test_t)
                decoded = ctc_greedy_decode(out[:, 0, :])
                print(f"  [Probe] Soll: '{test_word}' | Ist: '{decoded}'")
            model.train()

    # ONNX Export
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
    train(epochs=28, batch_size=32)
