#!/usr/bin/env python3
"""
train_rocm.py — LoRA/QLoRA-Finetuning für AMD Radeon (ROCm unter Windows/Linux) und Nvidia.

Nutzt reines transformers + peft + trl (ohne Triton/Unsloth-Zwang), damit es stabil auf
Windows + AMD RX 9060 XT (ROCm 7.2.1) läuft. Loss wird strikt nur auf Assistenten-Turns
(<|im_start|>assistant\n ... <|im_end|>) berechnet.

Vorher:
  node training/generate_trajectories.mjs
  training\\.venv\\Scripts\\python.exe training\\check_dataset.py
Prüfen ohne GPU-Training:
  training\\.venv\\Scripts\\python.exe training\\train_rocm.py --dry-run
Training starten:
  training\\.venv\\Scripts\\python.exe training\\train_rocm.py
"""

import argparse
import gc
import json
import os
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL", "1")

import torch
import transformers.trainer
import transformers.trainer_optimizer
from datasets import Dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    DataCollatorForSeq2Seq,
    Trainer,
    TrainingArguments,
)

from chat_format import RESPONSE_PART, load_jsonl, load_tools, render

ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = "Qwen/Qwen3.5-4B"
DEFAULT_TRAIN = ROOT / "data" / "impala_flat_train.jsonl"
DEFAULT_VAL = ROOT / "data" / "impala_flat_val.jsonl"
DEFAULT_OUT = ROOT / "outputs" / "impala67_rocm_lora"


def find_subsequence(seq, sub, start=0):
    n = len(sub)
    limit = len(seq) - n
    for i in range(start, limit + 1):
        if seq[i : i + n] == sub:
            return i
    return -1


def tokenize_and_mask(samples, tokenizer, tools, max_len):
    """Rendert Chat-Beispiele mit Tools und maskiert alles außer Assistenten-Antworten (-100)."""
    tok = getattr(tokenizer, "tokenizer", tokenizer)
    asst_header_ids = tok.encode(RESPONSE_PART, add_special_tokens=False)
    im_end_ids = tok.encode("<|im_end|>", add_special_tokens=False)
    if not asst_header_ids or not im_end_ids:
        raise RuntimeError("Konnte Qwen <|im_start|>assistant\\n oder <|im_end|> Tokens nicht bestimmen.")

    rows = []
    dropped = 0
    for s in samples:
        text = render(tok, s["messages"], tools)
        ids = tok(text, add_special_tokens=False)["input_ids"]
        if len(ids) > max_len:
            dropped += 1
            continue

        labels = [-100] * len(ids)
        pos = 0
        while True:
            hdr = find_subsequence(ids, asst_header_ids, pos)
            if hdr < 0:
                break
            ans_start = hdr + len(asst_header_ids)
            end = find_subsequence(ids, im_end_ids, ans_start)
            ans_end = (end + len(im_end_ids)) if end >= 0 else len(ids)
            for k in range(ans_start, ans_end):
                labels[k] = ids[k]
            pos = ans_end

        if all(x == -100 for x in labels):
            dropped += 1
            continue
        rows.append({"input_ids": ids, "attention_mask": [1] * len(ids), "labels": labels})

    return rows, dropped


class ChunkedLossTrainer(Trainer):
    """Berechnet lm_head + Cross-Entropy nur auf gültigen Assistenten-Tokens in 256er-Chunks (spart ~10 GB VRAM bei 248k Vocab)."""

    def compute_loss(self, model, inputs, return_outputs=False, num_items_in_batch=None):
        labels = inputs["labels"]
        causal_lm = model.get_base_model() if hasattr(model, "get_base_model") else model
        out = causal_lm.model(
            input_ids=inputs["input_ids"],
            attention_mask=inputs.get("attention_mask"),
            use_cache=False,
        )
        hidden = out.last_hidden_state[:, :-1, :].contiguous()
        shift_labels = labels[:, 1:].contiguous()
        valid_mask = shift_labels.ne(-100)
        valid_hidden = hidden[valid_mask]
        valid_targets = shift_labels[valid_mask]
        if valid_targets.numel() == 0:
            loss = hidden.sum() * 0.0
        else:
            denom = num_items_in_batch if num_items_in_batch is not None else valid_targets.numel()
            total_loss = hidden.new_zeros((), dtype=torch.float32)
            for i in range(0, valid_targets.size(0), 256):
                h_i = valid_hidden[i : i + 256]
                t_i = valid_targets[i : i + 256]
                logits_i = causal_lm.lm_head(h_i).float()
                total_loss = total_loss + torch.nn.functional.cross_entropy(logits_i, t_i, reduction="sum")
            loss = total_loss / denom
        return (loss, out) if return_outputs else loss


def verify_gpu():
    if not torch.cuda.is_available():
        raise RuntimeError("Keine GPU über torch.cuda (ROCm/CUDA) verfügbar! Prüfe ROCm-PyTorch-Installation.")
    name = torch.cuda.get_device_name(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    print(f"GPU erkannt: {name} ({vram_gb:.1f} GB VRAM)")
    # Schneller Matrix-Test auf GPU (prüft, ob HIP/ROCm-Kernel wirklich laufen)
    x = torch.randn((256, 256), device="cuda", dtype=torch.bfloat16)
    y = (x @ x.T).sum().item()
    del x
    torch.cuda.empty_cache()
    print(f"GPU BF16 Kernel-Check OK (sum={y:.2f})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--train", type=Path, default=DEFAULT_TRAIN)
    ap.add_argument("--val", type=Path, default=DEFAULT_VAL)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--max-len", type=int, default=8192)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--quant", choices=["auto", "4bit", "bf16"], default="auto")
    ap.add_argument("--dry-run", action="store_true", help="Nur Tokenisierung & Loss-Masking prüfen, nicht trainieren.")
    args = ap.parse_args()

    if not args.train.exists() or not args.val.exists():
        raise SystemExit(f"Train/Val JSONL fehlt: {args.train} / {args.val}")

    tools = load_tools()
    train_raw = load_jsonl(args.train)
    val_raw = load_jsonl(args.val)
    print(f"Lade Tokenizer: {args.model} …")
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    train_rows, train_drop = tokenize_and_mask(train_raw, tokenizer, tools, args.max_len)
    val_rows, val_drop = tokenize_and_mask(val_raw, tokenizer, tools, args.max_len)
    print(f"Train: {len(train_rows)} Beispiele (verworfen: {train_drop}) | Val: {len(val_rows)} (verworfen: {val_drop})")
    if not train_rows:
        raise SystemExit("Keine Trainingsbeispiele innerhalb von --max-len.")

    sample0 = train_rows[0]
    unmasked = [tok_id for tok_id, lbl in zip(sample0["input_ids"], sample0["labels"]) if lbl != -100]
    print(f"Masking-Check Beispiel #0: {len(unmasked)}/{len(sample0['input_ids'])} Tokens trainiert.")
    print("Erster trainierter Ausschnitt:", repr(tokenizer.decode(unmasked[:80])))

    if args.dry_run:
        verify_gpu()
        print("Dry-Run erfolgreich.")
        return

    verify_gpu()
    use_4bit = False
    if args.quant in ("auto", "4bit"):
        try:
            import bitsandbytes as bnb  # noqa: F401
            use_4bit = True
        except Exception as e:
            if args.quant == "4bit":
                raise
            print(f"bitsandbytes nicht nutzbar ({e}) → weiche auf BF16-LoRA aus.")

    load_kw = dict(low_cpu_mem_usage=True, device_map={"": 0}, attn_implementation="sdpa")
    if use_4bit:
        print("Lade Basismodell in 4-Bit (QLoRA NF4) …")
        load_kw["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
    else:
        print("Lade Basismodell in BF16 (Standard-LoRA) …")
        load_kw["torch_dtype"] = torch.bfloat16

    try:
        model = AutoModelForCausalLM.from_pretrained(args.model, **load_kw)
    except Exception as e:
        if use_4bit and args.quant == "auto":
            print(f"4-Bit-Load fehlgeschlagen ({e}) → Fallback auf BF16-LoRA …")
            use_4bit = False
            load_kw.pop("quantization_config", None)
            load_kw["torch_dtype"] = torch.bfloat16
            gc.collect()
            torch.cuda.empty_cache()
            model = AutoModelForCausalLM.from_pretrained(args.model, **load_kw)
        else:
            raise

    model.config.use_cache = False
    if use_4bit:
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    else:
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        model.enable_input_require_grads()

    lora_cfg = LoraConfig(
        r=args.rank,
        lora_alpha=args.rank,
        lora_dropout=0.0,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()

    train_ds = Dataset.from_list(train_rows)
    has_val = len(val_rows) > 0
    val_ds = Dataset.from_list(val_rows) if has_val else None
    collator = DataCollatorForSeq2Seq(tokenizer=tokenizer, model=model, padding=True, label_pad_token_id=-100)

    args.out.mkdir(parents=True, exist_ok=True)
    t_args = TrainingArguments(
        output_dir=str(args.out),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=1,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=8,
        learning_rate=args.lr,
        warmup_steps=5,
        lr_scheduler_type="cosine",
        weight_decay=0.01,
        bf16=True,
        fp16=False,
        optim="adamw_torch",
        logging_steps=1,
        eval_strategy="epoch" if has_val else "no",
        save_strategy="epoch" if has_val else "no",
        save_total_limit=1,
        load_best_model_at_end=has_val,
        metric_for_best_model="eval_loss" if has_val else None,
        greater_is_better=False,
        dataloader_pin_memory=False,
        report_to="none",
        seed=42,
    )

    trainer = ChunkedLossTrainer(
        model=model,
        args=t_args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        data_collator=collator,
    )

    if not torch.distributed.is_available():
        # Windows-ROCm-PyTorch ist ohne distributed_c10d gebaut; Single-GPU hat keine DTensors.
        transformers.trainer_optimizer.has_mixed_dtensor = lambda _tensors: False
        if hasattr(transformers.trainer, "has_mixed_dtensor"):
            transformers.trainer.has_mixed_dtensor = lambda _tensors: False

    print("Starte Training auf GPU …")
    result = trainer.train()
    print("Training fertig:", json.dumps(result.metrics, indent=2))

    final_dir = args.out / "final_adapter"
    final_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(final_dir))
    tokenizer.save_pretrained(str(final_dir))
    print(f"LoRA-Adapter gespeichert unter: {final_dir}")


if __name__ == "__main__":
    main()
