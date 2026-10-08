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
from typing import List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from vocabulary import CHAR_TO_IDX, VOCAB_SIZE, BLANK_IDX, MATH_SYMBOLS as MATH_CHARS, index_to_char
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
from text_corpus import random_text
from mathwriting_loader import MathWritingDataset, strokes_to_normalized_features
from brush_loader import BrushDataset
from samples_loader import load_user_samples, load_user_eval_lines
from evaluate_user_benchmark_words import (
    ctc_greedy,
    line_distance,
    strokes_to_4features,
    LINES_GROUND_TRUTH,
    DATA_PATH as BENCHMARK_DATA_PATH,
)
import json
import numpy as np


class DynamicInkDataset(Dataset):
    """
    Erzeugt dynamisch bei jeder Epoche frische, augmentierte Trainingsdaten.
    Verhindert Overfitting und kombiniert BRUSH-Handschrift (40 %), Google MathWriting (20 %),
    synthetische Handschriftfonts / UJI (30 %) und Formeln/Zahlen.
    """

    def __init__(
        self,
        size: int = 50000,
        is_val: bool = False,
        seed: int = None,
        user_samples: Optional[List[Tuple[List[Tuple[float, float, float, float]], str]]] = None,
    ):
        self.size = size
        self.is_val = is_val
        self.real_sampler = RealHandwritingSampler()
        self.math_ds = MathWritingDataset()
        self.math_len = len(self.math_ds)
        self.brush_ds = BrushDataset(split="val" if is_val else "train")
        self.brush_len = len(self.brush_ds)
        self.user_samples = user_samples or []

        self.samples = []
        self.regenerate(seed if seed is not None else (42 if is_val else 1337))

    def regenerate(self, seed: int):
        """Erzeugt alle Samples neu im Speicher (schnell für die GPU). Fürs Training jede Epoche aufrufen,
        damit das Modell immer neue Kombinationen sieht statt dieselben Beispiele auswendig zu lernen."""
        tag = "Validierungs-Set" if self.is_val else "Trainings-Set"
        print(f"Erzeuge {tag} mit {self.size} Beispielen...", flush=True)
        rng = random.Random(seed)
        random.seed(seed)
        self.samples = []
        for _ in range(self.size):
            sample = self._generate_single_sample(rng)
            if sample:
                self.samples.append(sample)
        print(f"{tag} fertig: {len(self.samples)} Beispiele.", flush=True)

    def _generate_single_sample(self, rng=random) -> Tuple[torch.Tensor, torch.Tensor, str]:
        r = rng.random()
        word = ""
        features = []

        if self.user_samples and rng.random() < 0.3:
            # 30% Eigene Handschrift bei Fine-Tuning, immer leicht verzerrt: wenige Zeilen sonst schnell auswendig gelernt
            strokes, word = rng.choice(self.user_samples)
            from augmentations import apply_augmentations_on_the_fly
            features = strokes_to_normalized_features(apply_augmentations_on_the_fly(strokes))

        elif self.brush_len > 0 and r < 0.40:
            # 40% Echte BRUSH-Handschrift (170 Schreiber)
            idx = rng.randint(0, self.brush_len - 1)
            features, word = self.brush_ds.get_sample(idx)

        elif r < (0.60 if self.brush_len > 0 else 0.25) and self.math_len > 0:
            # 20% (bzw. 25%) Echte Google MathWriting Formeln
            idx = rng.randint(0, self.math_len - 1)
            features, word = self.math_ds.get_sample(idx)

        elif r < (0.90 if self.brush_len > 0 else 0.85):
            # 30% (bzw. 60%) Echte UJI-Glyphen oder Font-Synthese (>=20 OFL Fonts) mit On-the-fly-Augmentierungen
            word = random_text(rng)
            if rng.random() < 0.5:
                strokes = generate_word_strokes(word)
            else:
                strokes = self.real_sampler.get_real_word_strokes(word, cursive_prob=0.45)
            if strokes:
                from augmentations import apply_augmentations_on_the_fly
                strokes = apply_augmentations_on_the_fly(strokes)
                features = strokes_to_features(strokes)
            else:
                features, word = random_sample()

        elif r < (0.97 if self.brush_len > 0 else 0.95):
            # 7% (bzw. 10%) Ganze Sätze oder Formeln aus Synthetik-Generator
            features, word = random_sample()

        else:
            # 3% (bzw. 5%) Zahlen, Datumsangaben, MINT-Begriffe & Symbole
            if rng.random() < 0.5:
                word = rng.choice(SAMPLE_WORDS)
            else:
                word = f"{rng.randint(10, 999)} + {rng.randint(10, 999)} = {rng.randint(20, 1998)}"
            rot = rng.uniform(-15.0, 15.0) if rng.random() < 0.4 else 0.0
            strokes = generate_word_strokes(word, rotation_deg=rot)
            features = strokes_to_features(strokes)

        if features is None or len(features) < 4:
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


class LengthBucketSampler(torch.utils.data.Sampler):
    """Bündelt ähnlich lange Beispiele in einen Batch: viel weniger Auffüll-Padding, deutlich schneller.
    Lange Formeln bekommen kleinere Batches (Punkte-Budget), sonst läuft der GPU-Speicher über."""

    def __init__(self, dataset: "DynamicInkDataset", batch_size: int, max_points: int = 64000):
        self.dataset = dataset
        self.batch_size = batch_size
        self.max_points = max_points

    def _batches(self):
        lengths = [len(s[0]) for s in self.dataset.samples]
        # Leichtes Rauschen auf die Länge, damit die Batches nicht jede Epoche identisch sind
        order = sorted(range(len(lengths)), key=lambda i: lengths[i] * random.uniform(0.95, 1.05))
        batches, cur, cur_max = [], [], 0
        for i in order:
            new_max = max(cur_max, lengths[i])
            if cur and (len(cur) >= self.batch_size or (len(cur) + 1) * new_max > self.max_points):
                batches.append(cur)
                cur, new_max = [], lengths[i]
            cur.append(i)
            cur_max = new_max
        if cur:
            batches.append(cur)
        random.shuffle(batches)
        return batches

    def __iter__(self):
        return iter(self._batches())

    def __len__(self):
        return len(self._batches())


def ctc_greedy_decode(log_probs, blank_idx: int = BLANK_IDX, mode: str = "text") -> str:
    """Argmax + Kollabieren identischer Tokens + Entfernen des Blanks. In mode='text' werden Mathezeichen gesperrt."""
    if mode != "math":
        from vocabulary import MATH_INDICES
        if hasattr(log_probs, "clone"):
            log_probs = log_probs.clone()
            for m_idx in MATH_INDICES:
                log_probs[..., m_idx] = -1e9
        elif hasattr(log_probs, "copy"):
            log_probs = log_probs.copy()
            for m_idx in MATH_INDICES:
                log_probs[..., m_idx] = -1e9
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


def _recognize_features(model, device, feats, mode: str) -> str:
    """Erkennt eine Zeile wie die App (handwriting-worker.js): ganze Zeile, Greedy-CTC mit Mathe-Maskierung.
    Wort-für-Wort-Erkennung ist auf echter Handschrift deutlich schlechter und wird von der App nicht genutzt."""
    if len(feats) < 3:
        return ""
    inp = torch.as_tensor(np.asarray(feats, dtype=np.float32), device=device).unsqueeze(0)
    out = model(inp, in_lens=torch.tensor([len(feats)], device=device))
    return ctc_greedy(out[:, 0, :].cpu().numpy(), mode=mode)[0]


def _recognize_line(model, device, strokes, mode: str) -> str:
    parsed = [[(float(p[0]), float(p[1])) for p in s] for s in strokes]
    return _recognize_features(model, device, strokes_to_normalized_features(parsed), mode)


def load_foreign_eval(limit: int = 300) -> List[Tuple[np.ndarray, str, str]]:
    """Messzeilen fremder Schreiber, die nie im Training sind: BRUSH-Schreiber 150–169 und MathWriting "test".
    Ohne sie würde die Modellauswahl nur die eigene Handschrift bewerten und sich darauf spezialisieren."""
    def pick(samples, mode):
        samples = [(f, t) for f, t in samples if t.strip() and all(c in CHAR_TO_IDX for c in t)]
        if mode == "text":
            # Ganze Sätze bevorzugen, die App erkennt Zeilen
            samples = [s for s in samples if " " in s[1]] or samples
        step = max(1, len(samples) // limit)
        return [(f, t, mode) for f, t in samples[::step][:limit]]
    return pick(BrushDataset(split="val").samples, "text") + pick(MathWritingDataset(split="test").samples, "math")


def evaluate_real(model, device, benchmark_data, user_eval_lines=(), foreign_lines=()) -> dict:
    """Zeichenfehlerrate (CER) auf echter Handschrift.
    sel   = gerade Benchmark-Zeilen + Abschreib-Messzeilen (eigene Handschrift)
    fremd = fremde Schreiber (load_foreign_eval)
    score = Mittel aus sel und fremd: wählt best.pt, damit kein Modell gewinnt, das nur eine Schrift kann
    test  = ungerade Benchmark-Zeilen (nie zur Auswahl, sonst wäre der Testwert geschönt)
    own   = nur die Abschreib-Messzeilen (Teil von sel, zur Info)"""
    chars = {"sel": 0, "test": 0, "own": 0, "fremd": 0}
    errors = {"sel": 0, "test": 0, "own": 0, "fremd": 0}
    model.eval()
    with torch.no_grad():
        for feats, gt, mode in foreign_lines:
            dist, n = line_distance(_recognize_features(model, device, feats, mode), gt, mode)
            chars["fremd"] += n
            errors["fremd"] += dist
        for row in benchmark_data:
            cat, gt = LINES_GROUND_TRUTH.get(row["lineIdx"], ("unbekannt", ""))
            mode = "math" if cat in ("formel", "rechnung") else "text"
            pred = _recognize_line(model, device, row["strokes"], mode)
            split = "sel" if row["lineIdx"] % 2 == 0 else "test"
            dist, n = line_distance(pred, gt, mode)
            chars[split] += n
            errors[split] += dist
        for strokes, gt in user_eval_lines:
            mode = "math" if any(c in MATH_CHARS for c in gt) else "text"
            dist, n = line_distance(_recognize_line(model, device, strokes, mode), gt, mode)
            for split in ("sel", "own"):
                chars[split] += n
                errors[split] += dist
    result = {k: errors[k] / max(1, chars[k]) for k in chars}
    result["score"] = (result["sel"] + result["fremd"]) / 2 if chars["fremd"] else result["sel"]
    return result


def train(
    epochs: int = 30,
    batch_size: int = 128,
    lr: float = 1.6e-3,
    train_size: int = 50000,
    publish: bool = False,
    eval_every: int = 3,
    early_stopping_patience: int = 5,
    finetune_path: Optional[str] = None,
    samples_path: str = "my_handwriting_samples.json",
):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    if device.type == "cpu":
        torch.set_num_threads(10)
        print(f"Training auf Gerät: CPU ({torch.get_num_threads()} CPU-Threads)")
    else:
        if torch.version.hip:
            # MIOpen-LSTM unter Windows/ROCm instabil (kann den Treiber abstürzen lassen)
            torch.backends.cudnn.enabled = False
        backend = "AMD ROCm" if torch.version.hip else "NVIDIA CUDA"
        print(f"Training auf Gerät: GPU {torch.cuda.get_device_name(0)} ({backend})")

    user_samples = []
    if finetune_path:
        print(f"Fine-Tuning Modus aktiviert (Quelle: {finetune_path}).")
        if os.path.exists(samples_path):
            user_samples = load_user_samples(samples_path)
            print(f"Geladene eigene Handschrift-Samples: {len(user_samples)}.")
        else:
            print(f"Hinweis: Keine Datei '{samples_path}' gefunden. Nutze Basistraining.")

    # Abschreib-Messzeilen zählen immer zur Modellauswahl (auch ohne Fine-Tuning), nie zum Training
    user_eval_lines = load_user_eval_lines(samples_path)
    if user_eval_lines:
        print(f"{len(user_eval_lines)} Abschreib-Messzeilen gehen in die Auswahl-CER ein.")

    model = HandwritingCRNN(in_features=4, hidden_size=192, num_layers=3, dropout=0.0).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    criterion = nn.CTCLoss(blank=BLANK_IDX, zero_infinity=True)

    train_dataset = DynamicInkDataset(size=train_size, is_val=False, user_samples=user_samples)
    val_dataset = DynamicInkDataset(size=400, is_val=True, seed=42)

    train_loader = DataLoader(
        train_dataset, batch_sampler=LengthBucketSampler(train_dataset, batch_size), collate_fn=collate_fn
    )
    val_loader = DataLoader(
        val_dataset, batch_size=batch_size, shuffle=False, collate_fn=collate_fn
    )

    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=epochs, eta_min=1e-5 if finetune_path else 1e-4
    )

    # In Colab zeigt HW_CHECKPOINT_DIR auf Google Drive, damit ein Abbruch nichts verliert
    checkpoints_dir = os.environ.get("HW_CHECKPOINT_DIR") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "checkpoints"
    )
    os.makedirs(checkpoints_dir, exist_ok=True)
    last_path = os.path.join(checkpoints_dir, "last.pt")
    best_real_cer = 1.0
    best_real_acc = 0.0
    best_epoch = 0
    start_epoch = 1
    epochs_without_improvement = 0

    if finetune_path and os.path.exists(finetune_path):
        print(f"Lade Basis-Gewichte für Fine-Tuning aus {finetune_path}...")
        ft_state = torch.load(finetune_path, map_location=device)
        model.load_state_dict(ft_state.get("model_state", ft_state))
        print("Vorab-Gewichte erfolgreich geladen.")
    elif os.path.exists(last_path):
        state = torch.load(last_path, map_location=device)
        model.load_state_dict(state["model_state"])
        optimizer.load_state_dict(state["optimizer_state"])
        scheduler.load_state_dict(state["scheduler_state"])
        best_real_cer, best_real_acc, best_epoch = state["best_real_cer"], state["best_real_acc"], state["best_epoch"]
        epochs_without_improvement = state.get("epochs_without_improvement", 0)
        start_epoch = state["epoch"] + 1
        print(f"Setze Training fort ab Epoche {start_epoch} (aus {last_path}).")

    benchmark_data = json.load(open(BENCHMARK_DATA_PATH, encoding="utf-8"))
    foreign_lines = load_foreign_eval()
    print(f"{len(foreign_lines)} Messzeilen fremder Schreiber gehen in die Modellauswahl ein.")

    if finetune_path:
        # Feintuning muss die Basis schlagen, sonst bleibt die Basis das beste Modell
        base = evaluate_real(model, device, benchmark_data, user_eval_lines, foreign_lines)
        best_real_cer, best_real_acc = base["score"], max(0.0, (1.0 - base["score"]) * 100.0)
        torch.save({"epoch": 0, "model_state": model.state_dict(), "select_cer": base["score"], "test_cer": base["test"]},
                   os.path.join(checkpoints_dir, "best.pt"))
        print(f"Basis: Auswahl-Score {base['score'] * 100:.1f} % (eigene {base['sel'] * 100:.1f} %, fremde {base['fremd'] * 100:.1f} %) | TEST-CER {base['test'] * 100:.1f} %")

    print("Starte Training mit 4 Features. Modellauswahl erfolgt nach echtem Test-Set (strikt getrennt)!")

    for epoch in range(start_epoch, epochs + 1):
        if epoch > 1:
            train_dataset.regenerate(seed=1337 + epoch)
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
        avg_loss = total_loss / max(1, batch_idx + 1)

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
                    valid_len = max(1, int(v_in_lens[i]) // 2)
                    pred = ctc_greedy_decode(v_out[:valid_len, i, :])
                    target = v_words[i]
                    val_errors += levenshtein_dist(target, pred)
                    val_chars += max(len(target), 1)
                    if len(sample_preds) < 2:
                        sample_preds.append((target, pred))

        val_cer = val_errors / max(1, val_chars)
        val_acc = (1.0 - val_cer) * 100

        def save_last():
            torch.save(
                {
                    "epoch": epoch,
                    "model_state": model.state_dict(),
                    "optimizer_state": optimizer.state_dict(),
                    "scheduler_state": scheduler.state_dict(),
                    "best_real_cer": best_real_cer,
                    "best_real_acc": best_real_acc,
                    "best_epoch": best_epoch,
                    "epochs_without_improvement": epochs_without_improvement,
                },
                last_path,
            )

        # Echt-Auswertung (Hunderte Zeilen) nur alle eval_every Epochen und in der letzten
        if epoch % eval_every != 0 and epoch != epochs:
            print(
                f"Epoche {epoch:02d}/{epochs:02d} | Train Loss: {avg_loss:.4f} | Synth Val Acc: {val_acc:.1f} %",
                flush=True,
            )
            save_last()
            continue

        # 2. ECHTE HANDSCHRIFT: Auswahl-Score (eigene Auswahlzeilen + fremde Schreiber) wählt best.pt,
        #    ungerade Benchmark-Zeilen bleiben unberührter Test.
        real = evaluate_real(model, device, benchmark_data, user_eval_lines, foreign_lines)
        real_cer, test_cer = real["score"], real["test"]
        real_acc = max(0.0, (1.0 - real_cer) * 100.0)
        own = f" (davon Abschreib-Messzeilen: {real['own'] * 100:.1f} %)" if user_eval_lines else ""

        print(
            f"Epoche {epoch:02d}/{epochs:02d} | Train Loss: {avg_loss:.4f} | Synth Val Acc: {val_acc:.1f} % | "
            f"Auswahl-Score: {real_cer * 100:.1f} % | eigene: {real['sel'] * 100:.1f} %{own} | "
            f"fremde: {real['fremd'] * 100:.1f} % | TEST-CER: {test_cer * 100:.1f} %",
            flush=True,
        )

        for tgt, prd in sample_preds[:1]:
            print(f"  [Synth-Probe] Soll: '{tgt}' | Ist: '{prd}'")

        # Modellauswahl und früher Abbruch nach dem Auswahl-Score
        if real_cer < best_real_cer:
            best_real_cer = real_cer
            best_real_acc = real_acc
            best_epoch = epoch
            epochs_without_improvement = 0
            best_path = os.path.join(checkpoints_dir, "best.pt")
            torch.save(
                {
                    "epoch": epoch,
                    "model_state": model.state_dict(),
                    "optimizer_state": optimizer.state_dict(),
                    "val_cer": val_cer,
                    "select_cer": real_cer,
                    "test_cer": test_cer,
                },
                best_path,
            )
            print(f"  --> [BEST] Auswahl-CER {real_cer * 100:.1f} %, Test-CER {test_cer * 100:.1f} % (Epoche {epoch}) gespeichert!", flush=True)
        else:
            epochs_without_improvement += 1
            print(f"  [Früher Abbruch Check] Keine Verbesserung der Auswahl-CER seit {epochs_without_improvement}/{early_stopping_patience} Auswertungen.")
            if epochs_without_improvement >= early_stopping_patience:
                print(f"\n[Früher Abbruch] Auswahl-CER (gerade Zeilen) hat sich seit {early_stopping_patience} Auswertungen nicht mehr verbessert. Stoppe Training vorzeitig.")
                save_last()
                break
        save_last()

    # ONNX Export des besten Modells
    best_ckpt = torch.load(os.path.join(checkpoints_dir, "best.pt"), map_location="cpu")
    if finetune_path and best_epoch == 0:
        print("\nKeine Feintuning-Epoche war besser als die Basis – exportiert wird die unveränderte Basis.")
    print(
        f"\nTraining abgeschlossen. Bestes Modell aus Epoche {best_epoch}: "
        f"Auswahl-Genauigkeit {best_real_acc:.1f} %, unberührte TEST-CER {best_ckpt['test_cer'] * 100:.1f} %."
    )
    model.load_state_dict(best_ckpt["model_state"])

    onnx_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model.onnx")
    export_to_onnx(model.cpu(), onnx_path)

    # Nur auf ausdrücklichen Wunsch in die App übernehmen (python train.py --publish),
    # damit ein schwächerer Lauf nicht ungeprüft das ausgelieferte Modell ersetzt.
    if not publish:
        print("App-Modell unverändert. Nach Vergleich der TEST-CER mit 'python train.py --publish' übernehmen.")
        return
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    web_dest = os.path.join(repo_root, "web", "handwriting-model.onnx")
    try:
        import shutil

        shutil.copyfile(onnx_path, web_dest)
        print(f"Modell erfolgreich nach {web_dest} kopiert!")
    except Exception as e:
        print(f"Kopieren nach {web_dest} fehlgeschlagen: {e}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Impala67 Handschrift-Training")
    parser.add_argument("--epochs", type=int, default=28, help="Anzahl Trainings-Epochen")
    parser.add_argument("--batch-size", type=int, default=128, help="Batch-Größe")
    parser.add_argument("--lr", type=float, default=None, help="Lernrate (Standard: 1.6e-3, bei Finetune: 2.5e-4)")
    parser.add_argument("--train-size", type=int, default=50000, help="Trainings-Set-Größe pro Epoche")
    parser.add_argument("--publish", action="store_true", help="Neues ONNX-Modell direkt in web/ kopieren")
    parser.add_argument("--eval-every", type=int, default=3, help="Intervall für Benchmark-Auswertung")
    parser.add_argument("--patience", type=int, default=5, help="Early-Stopping-Patience")
    parser.add_argument("--finetune", type=str, default=None, help="Pfad zu Checkpoint für Fine-Tuning (z.B. best.pt)")
    parser.add_argument("--samples", type=str, default="my_handwriting_samples.json", help="Pfad zu nutzereigenen Samples")
    args = parser.parse_args()

    # Lernrate anpassen, falls nicht explizit übergeben
    lr = args.lr if args.lr is not None else (2.5e-4 if args.finetune else 1.6e-3)
    epochs = 10 if (args.finetune and "--epochs" not in sys.argv) else args.epochs

    train(
        epochs=epochs,
        batch_size=args.batch_size,
        lr=lr,
        train_size=args.train_size,
        publish=args.publish,
        eval_every=args.eval_every,
        early_stopping_patience=args.patience,
        finetune_path=args.finetune,
        samples_path=args.samples,
    )
