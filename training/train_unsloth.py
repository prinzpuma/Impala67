#!/usr/bin/env python3
"""
train_unsloth.py — QLoRA-Finetuning für Impala67 mit Unsloth (lokal, Nvidia/ROCm).

Vorher:  python generate_dataset.py   und   python check_dataset.py
Danach:  python export_gguf.py
"""

from pathlib import Path

try:
    import torch
    from unsloth import FastLanguageModel
    from unsloth.chat_templates import train_on_responses_only
    from trl import SFTTrainer, SFTConfig
    from datasets import Dataset
except ImportError:
    print("Unsloth ist nicht installiert. Installiere es mit:")
    print('pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"')
    raise SystemExit(1)

from chat_format import INSTRUCTION_PART, RESPONSE_PART, build_texts, load_tools

ROOT = Path(__file__).resolve().parent
BASE_MODEL = "unsloth/Qwen3.5-4B"  # Alternativ: "unsloth/Qwen3.5-2B"
MAX_SEQ_LENGTH = 4096
EPOCHS = 3
OUTPUT_DIR = ROOT / "outputs" / "impala67_lora"
DATA_TRAIN = ROOT / "data" / "impala_tools_train.jsonl"
DATA_VAL = ROOT / "data" / "impala_tools_val.jsonl"


def main():
    print("=== Impala67 QLoRA Training ===")
    print(f"Lade Basismodell: {BASE_MODEL} ...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=BASE_MODEL,
        max_seq_length=MAX_SEQ_LENGTH,
        load_in_4bit=True,
    )

    # LoRA-Adapter (Rank 16). Das Chat-Template des Tokenizers bleibt unverändert (Qwen-eigenes Format).
    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha=16,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )

    tools = load_tools()
    print("Rendere Trainingsdaten mit dem Qwen-Template ...")
    train_ds = Dataset.from_dict({"text": build_texts(tokenizer, DATA_TRAIN, tools, MAX_SEQ_LENGTH)})
    val_ds = Dataset.from_dict({"text": build_texts(tokenizer, DATA_VAL, tools, MAX_SEQ_LENGTH)})
    print(f"Training: {len(train_ds)} | Validierung: {len(val_ds)}")

    bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        args=SFTConfig(
            dataset_text_field="text",  # Länge: kommt aus from_pretrained; zu lange Beispiele filtert build_texts
            packing=False,
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            num_train_epochs=EPOCHS,
            warmup_ratio=0.05,
            learning_rate=1e-4,
            bf16=bf16,
            fp16=not bf16,
            logging_steps=5,
            eval_strategy="epoch",
            optim="adamw_8bit",
            weight_decay=0.01,
            lr_scheduler_type="linear",
            seed=42,
            output_dir=str(OUTPUT_DIR),
            save_strategy="no",
            report_to="none",
        ),
    )

    # Loss nur auf Assistenten-Antworten (Systemprompt, Tools, Skripte und Tool-Ergebnisse werden maskiert).
    trainer = train_on_responses_only(trainer, instruction_part=INSTRUCTION_PART, response_part=RESPONSE_PART)

    print("\nStarte QLoRA-Training ...")
    trainer.train()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"\nTraining abgeschlossen. Speichere LoRA-Adapter nach: {OUTPUT_DIR}")
    model.save_pretrained(str(OUTPUT_DIR))
    tokenizer.save_pretrained(str(OUTPUT_DIR))
    print("Fertig! Als Nächstes 'python export_gguf.py' ausführen.")


if __name__ == "__main__":
    main()
