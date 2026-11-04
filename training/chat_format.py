"""
chat_format.py — Gemeinsame Aufbereitung der Trainingsdaten für Training, Colab und Prüfung.

- Nutzt das EIGENE Chat-Template des Qwen-Tokenizers (kein Überschreiben mit "chatml"),
  damit Tools, <tool_call>-Format und <think>-Blöcke exakt wie in LM Studio / llama.cpp aussehen
  und das Template unverändert in die GGUF-Datei wandert.
- Tool-Definitionen kommen aus tool_defs.json, nicht aus dem Datensatz (kein Arrow-Schema-Mischen).
- tool_calls[].function.arguments wird von JSON-String zu Dict, weil das Qwen-3.5-Template
  die Parameter einzeln aus dem Objekt rendert.
"""

import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOOL_DEFS_CANDIDATES = [
    ROOT.parent / "core" / "impala-ai" / "src" / "tool_defs.json",  # im Repo
    ROOT / "tool_defs.json",                                         # neben dem Skript (Colab-Upload)
    Path("tool_defs.json"),                                          # aktuelles Verzeichnis
]

# Qwen (ChatML-basiert): Nutzer- und Tool-Antworten beginnen mit "<|im_start|>user\n",
# Assistenten-Turns mit "<|im_start|>assistant\n". Für train_on_responses_only.
INSTRUCTION_PART = "<|im_start|>user\n"
RESPONSE_PART = "<|im_start|>assistant\n"


def load_tools(path=None):
    candidates = [Path(path)] if path else TOOL_DEFS_CANDIDATES
    for p in candidates:
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    raise FileNotFoundError("tool_defs.json nicht gefunden (gesucht: " + ", ".join(map(str, candidates)) + ")")


def load_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def prepare_messages(messages):
    """Kopie der Nachrichten mit arguments als Dict (für das Qwen-Template)."""
    out = copy.deepcopy(messages)
    for m in out:
        for tc in m.get("tool_calls") or []:
            fn = tc["function"]
            if isinstance(fn.get("arguments"), str):
                fn["arguments"] = json.loads(fn["arguments"])
    return out


def base_tokenizer(tok):
    """Unsloth liefert bei Vision-Modellen u. U. einen Processor; das Template hängt am Tokenizer."""
    return getattr(tok, "tokenizer", tok)


def render(tokenizer, messages, tools):
    return base_tokenizer(tokenizer).apply_chat_template(
        prepare_messages(messages), tools=tools, tokenize=False, add_generation_prompt=False
    )


def build_texts(tokenizer, jsonl_path, tools, max_len=None):
    """Rendert alle Beispiele; zu lange werden verworfen statt still abgeschnitten (sonst fehlt die Antwort)."""
    tok = base_tokenizer(tokenizer)
    texts, dropped = [], 0
    for sample in load_jsonl(jsonl_path):
        text = render(tok, sample["messages"], tools)
        if max_len and len(tok(text, add_special_tokens=False)["input_ids"]) > max_len:
            dropped += 1
            continue
        texts.append(text)
    if dropped:
        print(f"Warnung: {dropped} Beispiel(e) aus {Path(jsonl_path).name} länger als {max_len} Tokens – verworfen.")
    return texts
