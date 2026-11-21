#!/usr/bin/env python3
"""
export_rocm_gguf.py — Mergt einen mit train_rocm.py trainierten LoRA-Adapter und exportiert Q4_K_M.gguf.

Aufruf:
  training\\.venv\\Scripts\\python.exe training\\export_rocm_gguf.py --model Qwen/Qwen3.5-4B
"""

import argparse
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = Path(__file__).resolve().parent
DEFAULT_ADAPTER = ROOT / "outputs" / "impala67_rocm_lora" / "final_adapter"
DEFAULT_MERGED = ROOT / "outputs" / "merged_hf"
DEFAULT_GGUF_DIR = ROOT / "outputs" / "gguf"
CONVERT_URL = "https://raw.githubusercontent.com/ggml-org/llama.cpp/master/convert_hf_to_gguf.py"
LOCAL_QUANTIZE = Path(r"C:\Users\joshu\AppData\Local\Capri\brain\engine-b11669\llama-quantize.exe")


def find_quantize():
    in_path = shutil.which("llama-quantize")
    if in_path:
        return Path(in_path)
    if LOCAL_QUANTIZE.exists():
        return LOCAL_QUANTIZE
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3.5-4B")
    ap.add_argument("--adapter", type=Path, default=DEFAULT_ADAPTER)
    ap.add_argument("--merged", type=Path, default=DEFAULT_MERGED)
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_GGUF_DIR)
    ap.add_argument("--quant", default="Q4_K_M")
    ap.add_argument("--skip-merge", action="store_true")
    args = ap.parse_args()

    if not args.skip_merge:
        if not args.adapter.exists():
            raise SystemExit(f"LoRA-Adapter nicht gefunden: {args.adapter}")
        print(f"Lade Basismodell ({args.model}) auf CPU für sauberen BF16-Merge …")
        base = AutoModelForCausalLM.from_pretrained(
            args.model, torch_dtype=torch.bfloat16, low_cpu_mem_usage=True, device_map="cpu"
        )
        tok = AutoTokenizer.from_pretrained(str(args.adapter))
        model = PeftModel.from_pretrained(base, str(args.adapter))
        merged = model.merge_and_unload()
        args.merged.mkdir(parents=True, exist_ok=True)
        merged.save_pretrained(str(args.merged), safe_serialization=True, max_shard_size="2GB")
        tok.save_pretrained(str(args.merged))
        print(f"Gemergtes HF-Modell gespeichert: {args.merged}")

    convert_py = ROOT / "outputs" / "convert_hf_to_gguf.py"
    if not convert_py.exists():
        convert_py.parent.mkdir(parents=True, exist_ok=True)
        print("Lade convert_hf_to_gguf.py aus ggml-org/llama.cpp …")
        urllib.request.urlretrieve(CONVERT_URL, convert_py)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    slug = args.model.split("/")[-1].lower()
    bf16_gguf = args.out_dir / f"{slug}-impala-bf16.gguf"
    quant_gguf = args.out_dir / f"{slug}-impala-{args.quant}.gguf"

    print(f"Konvertiere nach GGUF (bf16): {bf16_gguf} …")
    subprocess.run(
        [sys.executable, str(convert_py), str(args.merged), "--outfile", str(bf16_gguf), "--outtype", "bf16"],
        check=True,
    )

    qbin = find_quantize()
    if not qbin:
        print(f"Hinweis: llama-quantize nicht gefunden. Unkomprimierte GGUF liegt unter: {bf16_gguf}")
        return
    print(f"Quantisiere mit {qbin} → {quant_gguf} ({args.quant}) …")
    subprocess.run([str(qbin), str(bf16_gguf), str(quant_gguf), args.quant], check=True)
    print(f"Fertig! GGUF bereit für LM Studio: {quant_gguf}")


if __name__ == "__main__":
    main()
