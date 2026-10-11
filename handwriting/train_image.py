"""Feintuning des Bild-Modells (image_model.py, Start: de-htr-web-v2) auf Formeln, ohne Text zu verlernen.

Mischung je Batch (Standard): 35 % Mathe (MathWriting als Bild + synthetische Rechnungen),
65 % Text: ScaDS-Trainingsschreiber + fhswf (Scans, wie bei de-htr) und gezeichnete Sätze mit Leerzeichen.
Der Bild-Teil (ResNet) lernt nur mit 1/10 der Lernrate.

Auswahl von best.pt: Text-CER der ScaDS-Auswahlschreiber (Scans) und der BRUSH-Auswahlschreiber (Striche) darf
je höchstens --max-text-loss (1 Punkt) über dem Startwert liegen, darunter gewinnt die niedrigste Mathe-CER
(MathWriting-Auswahlhälfte). Test-Schreiber und Test-Hälften
werden nur gemeldet, nie zur Auswahl benutzt.

Aufruf (Colab): python train_image.py --dehtr <Ordner mit model-fp32.onnx + config.json> --scads <Ordner> --fhswf <Ordner>
"""

import argparse
import json
import math
import os
import random
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageFilter

from augmentations import apply_augmentations_on_the_fly
from evaluate_user_benchmark_words import LINES_GROUND_TRUTH, ctc_greedy, line_distance, DATA_PATH as BENCHMARK_PATH
from generate_synthetic import MATH_FORMULAS, generate_word_strokes
from image_datasets import load_fhswf, load_scads, normalize_label
from image_model import ImageCRNN, export_image_onnx, load_dehtr_onnx
from brush_loader import BrushDataset
from mathwriting_loader import MathWritingDataset
from rasterize import features_to_strokes, pad_width, render_strokes
from samples_loader import load_user_eval_lines
from text_corpus import random_text
from vocabulary import CHAR_TO_IDX

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")


# ---------- Daten ----------

def augment_image(img: np.ndarray, rng: random.Random) -> np.ndarray:
    """Leichte Bild-Verzerrung: Breite, Strichstärke-Eindruck (Unschärfe), Kontrast, Rauschen. img in [0, 1]."""
    pil = Image.fromarray((img * 255).astype(np.uint8))
    w = max(4, int(pil.width * rng.uniform(0.85, 1.15)))
    pil = pil.resize((w, pil.height), Image.BILINEAR)
    if rng.random() < 0.3:
        pil = pil.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 0.9)))
    out = np.asarray(pil, dtype=np.float32) / 255.0
    if rng.random() < 0.5:
        out = 1.0 - (1.0 - out) * rng.uniform(0.6, 1.0)  # hellere Tinte
    if rng.random() < 0.3:
        out = out + np.random.default_rng(rng.randrange(1 << 30)).normal(0, 0.03, out.shape).astype(np.float32)
    return pad_width(np.clip(out, 0.0, 1.0))


def synthetic_math_text(rng: random.Random) -> str:
    r = rng.random()
    if r < 0.4:
        a, b = rng.randint(1, 999), rng.randint(1, 999)
        op = rng.choice("+-*/")
        res = {"+": a + b, "-": a - b, "*": a * b, "/": round(a / b, 2)}[op]
        return f"{a} {op} {b} = {res}"
    if r < 0.6:
        return f"{rng.choice('abcxyzn')}^{rng.randint(2, 9)} {rng.choice('+-')} {rng.randint(1, 99)} = {rng.randint(0, 999)}"
    return rng.choice(MATH_FORMULAS)


def synthetic_line_text(rng: random.Random) -> str:
    """Mehrwort-Zeile aus dem Wortschatz (text_corpus), nie die Benchmark-Sätze aus GERMAN_SENTENCES."""
    for _ in range(10):
        text = random_text(rng)
        if " " in text:
            return text
    return text


class LineSampler:
    """Erzeugt einzelne Trainingsbeispiele (Bild [64, W] float32, Text) aus der gewichteten Quellen-Mischung."""

    def __init__(self, scads_train, fhswf, mathwriting, math_share: float):
        # Text: Scans (ScaDS, fhswf) plus gezeichnete Sätze mit Leerzeichen. Lauf 1 ohne gezeichneten Text hat
        # Leerzeichen verlernt: MathWriting-Labels haben keine, obwohl im Bild Lücken sind.
        text_share = 1.0 - math_share
        self.sources = [(n, w * text_share) for n, w in (("scads", 0.5), ("fhswf", 0.3), ("synth_text", 0.2))
                        if n == "synth_text" or (scads_train if n == "scads" else fhswf)]
        self.sources += [("mathwriting", 0.8 * math_share), ("synth_math", 0.2 * math_share)]
        self.data = {"scads": scads_train, "fhswf": fhswf, "mathwriting": mathwriting}
        total = sum(w for _, w in self.sources)
        self.sources = [(n, w / total) for n, w in self.sources]
        print("Datenmischung: " + ", ".join(f"{n} {w * 100:.0f} %" for n, w in self.sources))

    def sample(self, rng: random.Random):
        r, acc = rng.random(), 0.0
        name = self.sources[-1][0]
        for n, w in self.sources:
            acc += w
            if r < acc:
                name = n
                break
        if name in ("scads", "fhswf"):
            img, text, _ = rng.choice(self.data[name])
            return augment_image(img.astype(np.float32) / 255.0, rng), text
        if name == "mathwriting":
            feats, text = rng.choice(self.data["mathwriting"])
            strokes = features_to_strokes(feats)
        else:
            text = synthetic_math_text(rng) if name == "synth_math" else synthetic_line_text(rng)
            strokes = generate_word_strokes(text, rotation_deg=rng.uniform(-4, 4))
        if not strokes:
            return None
        if rng.random() < 0.7:
            strokes = apply_augmentations_on_the_fly(strokes)
        img = render_strokes(strokes, stroke_width=rng.uniform(1.5, 3.5))
        return augment_image(img, rng), text


class BatchStream(torch.utils.data.IterableDataset):
    """Endloser Strom fertiger Batches. Je 8 Batches werden nach Breite sortiert gebildet (wenig Auffüllen)."""

    def __init__(self, sampler: LineSampler, batch_size: int, max_pixels: int, seed: int):
        self.sampler, self.batch_size, self.max_pixels, self.seed = sampler, batch_size, max_pixels, seed

    def __iter__(self):
        info = torch.utils.data.get_worker_info()
        rng = random.Random(self.seed * 1000 + (info.id if info else 0))
        while True:
            pool = []
            while len(pool) < self.batch_size * 8:
                s = self.sampler.sample(rng)
                if s and s[0].shape[1] <= 2048:
                    ids = [CHAR_TO_IDX[c] for c in s[1] if c in CHAR_TO_IDX]
                    if ids and len(ids) <= s[0].shape[1] // 4:
                        pool.append((s[0], ids))
            pool.sort(key=lambda s: s[0].shape[1])
            batches, cur = [], []
            for s in pool:
                if cur and (len(cur) >= self.batch_size or (len(cur) + 1) * s[0].shape[1] * 64 > self.max_pixels):
                    batches.append(cur)
                    cur = []
                cur.append(s)
            if cur:
                batches.append(cur)
            rng.shuffle(batches)
            for b in batches:
                yield collate(b)


def collate(batch):
    width = max(img.shape[1] for img, _ in batch)
    x = torch.ones(len(batch), 1, 64, width)
    for i, (img, _) in enumerate(batch):
        x[i, 0, :, : img.shape[1]] = torch.from_numpy(img)
    input_lengths = torch.tensor([img.shape[1] // 4 for img, _ in batch], dtype=torch.long)
    targets = torch.tensor([t for _, ids in batch for t in ids], dtype=torch.long)
    target_lengths = torch.tensor([len(ids) for _, ids in batch], dtype=torch.long)
    return x, targets, input_lengths, target_lengths


# ---------- Messen ----------

def build_eval_sets(scads, mw_test, samples_path):
    """Messzeilen: (Bild, Text, Modus). sel_* wählen best.pt, test_* nur zur Info."""
    split = json.load(open(os.path.join(HERE, "scads_split.json"), encoding="utf-8"))
    as_float = lambda img: pad_width(img.astype(np.float32) / 255.0)
    sets = {
        "sel_text": [(as_float(i), t, "text") for i, t, w in scads if w in split["val"]],
        "test_text": [(as_float(i), t, "text") for i, t, w in scads if w in split["test"]],
    }
    mw = [(f, t) for f, t in mw_test if t]
    mw = mw[:: max(1, len(mw) // 600)][:600]
    render = lambda feats: render_strokes(features_to_strokes(feats))
    sets["sel_math"] = [(render(f), t, "math") for f, t in mw[0::2]]
    sets["test_math"] = [(render(f), t, "math") for f, t in mw[1::2]]
    # Gezeichneter Text fremder Schreiber (BRUSH 150–169, nie trainiert): prüft Leerzeichen und Strich-Bilder
    ink = [(f, t) for f, t in BrushDataset(split="val").samples if " " in t.strip()]
    ink = ink[:: max(1, len(ink) // 400)][:400]
    sets["sel_ink"] = [(render(f), t.strip(), "text") for f, t in ink[0::2]]
    sets["test_ink"] = [(render(f), t.strip(), "text") for f, t in ink[1::2]]
    # Eigene Handschrift: nur zur Info (universelles Modell, nicht darauf optimiert)
    own = []
    if os.path.exists(BENCHMARK_PATH):
        for row in json.load(open(BENCHMARK_PATH, encoding="utf-8")):
            cat, gt = LINES_GROUND_TRUTH.get(row["lineIdx"], ("", ""))
            strokes = [[(float(p[0]), float(p[1])) for p in s] for s in row["strokes"] if s]
            if gt and strokes:
                own.append((render_strokes(strokes), gt, "math" if cat in ("formel", "rechnung") else "text"))
    if samples_path and os.path.exists(samples_path):
        own += [(render_strokes(s), t, "text") for s, t in load_user_eval_lines(samples_path)]
    sets["eigene"] = own
    for k, v in sets.items():
        print(f"Messzeilen {k}: {len(v)}")
    return sets


@torch.no_grad()
def evaluate(model, device, sets) -> dict:
    model.eval()
    out = {}
    for name, items in sets.items():
        err = n = 0
        for img, gt, mode in items:
            logits = model(torch.from_numpy(img)[None, None].to(device))[:, 0].float().cpu().numpy()
            pred = ctc_greedy(logits, mode=mode)[0].strip()
            d, L = line_distance(pred, gt, mode)
            err += d
            n += L
        out[name] = err / max(1, n) if items else float("nan")
    model.train()
    return out


def fmt(r: dict) -> str:
    return " | ".join(f"{k} {v * 100:.2f} %" for k, v in r.items() if isinstance(v, float))


# ---------- Training ----------

def main():
    ap = argparse.ArgumentParser(description="Bild-Modell: Mathe-Feintuning mit Text-Wiederholung")
    ap.add_argument("--dehtr", required=True, help="Ordner mit de-htr model-fp32.onnx und config.json")
    ap.add_argument("--scads", default=os.path.join(DATA, "scads"), help="Entpackter ScaDS-Ordner")
    ap.add_argument("--fhswf", default=os.path.join(DATA, "fhswf"), help="Ordner mit fhswf-Parquet-Dateien")
    ap.add_argument("--samples", default=os.path.join(DATA, "my_handwriting_samples.json"), help="Eigene Messzeilen (nur Info)")
    ap.add_argument("--steps", type=int, default=12000)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--backbone-lr-factor", type=float, default=0.1)
    ap.add_argument("--math-share", type=float, default=0.35)
    ap.add_argument("--eval-every", type=int, default=1000)
    ap.add_argument("--max-text-loss", type=float, default=0.01, help="Erlaubte Text-CER-Verschlechterung (0.01 = 1 Punkt; Lauf 1: +0,6 Text für -48 Mathe)")
    ap.add_argument("--workers", type=int, default=max(0, min(8, (os.cpu_count() or 1) - 1)))
    ap.add_argument("--out", default=os.path.join(HERE, "model.onnx"))
    args = ap.parse_args()

    ckpt_dir = os.environ.get("HW_CHECKPOINT_DIR", os.path.join(HERE, "checkpoints-image"))
    os.makedirs(ckpt_dir, exist_ok=True)
    os.makedirs(DATA, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Gerät: {device}")

    split = json.load(open(os.path.join(HERE, "scads_split.json"), encoding="utf-8"))
    held_out = set(split["val"]) | set(split["test"])
    scads = load_scads(args.scads, DATA)
    scads_train = [s for s in scads if s[2] not in held_out]
    fhswf = load_fhswf(args.fhswf, DATA) if os.path.isdir(args.fhswf) else []
    mw_train = [s for s in MathWritingDataset().samples if s[1]]
    mw_test = MathWritingDataset(split="test").samples
    print(f"Training: ScaDS {len(scads_train)}, fhswf {len(fhswf)}, MathWriting {len(mw_train)}")
    if not scads_train and not fhswf:
        sys.exit("Keine Text-Daten gefunden: ohne Text-Wiederholung würde das Modell Schrift verlernen. Abbruch.")

    sets = build_eval_sets(scads, mw_test, args.samples)
    sampler = LineSampler(scads_train, fhswf, mw_train, args.math_share)
    loader = torch.utils.data.DataLoader(
        BatchStream(sampler, args.batch_size, max_pixels=args.batch_size * 64 * 900, seed=int(time.time()) % 10000),
        batch_size=None, num_workers=args.workers, persistent_workers=args.workers > 0,
    )

    model = load_dehtr_onnx(ImageCRNN(), os.path.join(args.dehtr, "model-fp32.onnx"), os.path.join(args.dehtr, "config.json"))
    model.to(device)
    backbone = [p for m in (model.conv1, model.layer1, model.layer2, model.layer3) for p in m.parameters()]
    backbone_ids = {id(p) for p in backbone}
    head = [p for p in model.parameters() if id(p) not in backbone_ids]
    opt = torch.optim.AdamW([{"params": backbone, "lr": args.lr * args.backbone_lr_factor}, {"params": head, "lr": args.lr}], weight_decay=1e-4)
    warmup = 300
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / warmup) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / args.steps))))
    use_amp = device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
    ctc = nn.CTCLoss(blank=0, zero_infinity=True)

    step, base, best = 0, None, None
    last_path, best_path = os.path.join(ckpt_dir, "last.pt"), os.path.join(ckpt_dir, "best.pt")
    if os.path.exists(last_path):
        ck = torch.load(last_path, map_location=device, weights_only=False)
        model.load_state_dict(ck["model"])
        opt.load_state_dict(ck["opt"])
        sched.load_state_dict(ck["sched"])
        step, base, best = ck["step"], ck["base"], ck["best"]
        print(f"Fortgesetzt bei Schritt {step}")
    if base is None:
        base = evaluate(model, device, sets)
        print(f"[Start = de-htr] {fmt(base)}")
        best = {"step": 0, "sel_math": base["sel_math"], **base}
        torch.save({"model": model.state_dict(), "step": 0, "result": base}, best_path)

    t0, losses = time.time(), []
    for x, targets, in_len, tgt_len in loader:
        if step >= args.steps:
            break
        x = x.to(device, non_blocking=True)
        with torch.autocast(device.type, dtype=torch.float16, enabled=use_amp):
            logits = model(x)
        log_probs = logits.float().log_softmax(-1)
        loss = ctc(log_probs, targets, in_len, tgt_len)
        opt.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        nn.utils.clip_grad_norm_(model.parameters(), 5.0)
        scaler.step(opt)
        scaler.update()
        sched.step()
        step += 1
        losses.append(loss.item())
        if step % 100 == 0:
            print(f"Schritt {step}/{args.steps} | Loss {np.mean(losses):.3f} | {time.time() - t0:.0f} s", flush=True)
            losses = []
        if step % args.eval_every == 0 or step == args.steps:
            r = evaluate(model, device, sets)
            # Beide Text-Prüfungen (Scans und gezeichnete Striche) müssen halten; fehlt BRUSH, zählt nur ScaDS
            ok = all(not (r[k] > base[k] + args.max_text_loss) for k in ("sel_text", "sel_ink"))
            better = ok and r["sel_math"] < best["sel_math"]
            print(f"[Schritt {step}] {fmt(r)} | Text {'ok' if ok else 'ZU SCHLECHT'}" + (" → neues best.pt" if better else ""))
            if better:
                best = {"step": step, **r}
                torch.save({"model": model.state_dict(), "step": step, "result": r}, best_path)
            torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(),
                        "step": step, "base": base, "best": best}, last_path)

    print(f"\nStart (de-htr): {fmt(base)}")
    print(f"Bestes (Schritt {best['step']}): {fmt(best)}")
    if best["step"] == 0:
        print("Kein Zwischenstand hielt Text stabil und war bei Mathe besser: es bleibt das de-htr-Startmodell.")
    model.load_state_dict(torch.load(best_path, map_location=device, weights_only=False)["model"])
    export_image_onnx(model, args.out)


if __name__ == "__main__":
    main()
