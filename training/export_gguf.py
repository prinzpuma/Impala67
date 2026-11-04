#!/usr/bin/env python3
"""
export_gguf.py — Mergt den trainierten LoRA-Adapter mit dem Basismodell
und exportiert die finale GGUF-Datei (Q4_K_M) für LM Studio, Android und iPadOS.
"""

from pathlib import Path

try:
    from unsloth import FastLanguageModel
except ImportError:
    print("Unsloth ist nicht installiert. Bitte in der Trainingsumgebung ausführen.")
    exit(1)

LORA_DIR = Path(__file__).parent / "outputs" / "impala67_lora"
EXPORT_DIR = Path(__file__).parent / "outputs" / "gguf"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

QUANT_METHOD = "q4_k_m" # Sweet Spot für mobile Geräte & LM Studio

def main():
    if not LORA_DIR.exists():
        print(f"Fehler: LoRA-Adapter {LORA_DIR} nicht gefunden! Erst train_unsloth.py ausführen.")
        return

    print(f"Lade trainierten LoRA-Adapter aus: {LORA_DIR}...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=str(LORA_DIR),
        max_seq_length=4096,
        load_in_4bit=True,
    )

    print(f"\nKonvertiere und exportiere nach GGUF ({QUANT_METHOD})...")
    model.save_pretrained_gguf(
        str(EXPORT_DIR),
        tokenizer,
        quantization_method=QUANT_METHOD
    )

    print(f"\nErfolgreich exportiert nach: {EXPORT_DIR}")
    print("Die erzeugte .gguf Datei kann direkt in LM Studio oder in die native App geladen werden!")

if __name__ == "__main__":
    main()
