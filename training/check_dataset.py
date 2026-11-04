#!/usr/bin/env python3
"""
check_dataset.py — Prüft den Datensatz VOR dem Training mit dem echten Qwen-Tokenizer (ohne GPU).

  pip install transformers jinja2
  python check_dataset.py [--model unsloth/Qwen3.5-4B] [--show N]

Prüft je Beispiel:
- Tools stehen im gerenderten Systemteil, kein "null" in Tool-Aufrufen, kein doppeltes <tool_call>.
- Jeder Assistenten-Turn hat genau einen <think>-Block; Tool-Turns enthalten <tool_call>.
- change-Operationen haben die Pflichtfelder aus der App (core/impala-ffi/src/ai_tools.rs).
- Länge <= MAX_SEQ_LENGTH (sonst würde die Antwort abgeschnitten).
Gibt das erste Beispiel (oder N Beispiele) vollständig gerendert aus.
"""

import argparse
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from chat_format import RESPONSE_PART, load_jsonl, load_tools, render

ROOT = Path(__file__).resolve().parent
MAX_SEQ_LENGTH = 4096
FILES = [ROOT / "data" / "impala_tools_train.jsonl", ROOT / "data" / "impala_tools_val.jsonl"]

TOOL_NAMES = {"inspect", "change", "view_heft_page", "ask_choice", "calculate", "send_to_notebooklm"}
REQUIRED = {  # vereinfachte Pflichtfelder je Operation
    "page.create": ["title"], "page.append": ["title"], "page.replace": ["title"],
    "page.patch": ["title", "search", "replace"], "page.rename": ["title", "to"],
    "page.move": ["title"], "page.trash": ["title"], "page.archive": ["title"],
    "heft.append": ["title", "text"], "card.create": ["cards"], "deck.create": ["deck"],
    "deck.rename": ["deck", "to"], "card.move": ["to"],
}


def has_none(value):
    if value is None:
        return True
    if isinstance(value, dict):
        return any(has_none(v) for v in value.values())
    if isinstance(value, list):
        return any(has_none(v) for v in value)
    return False


def check_sample(i, sample, text, n_tokens, valid_ops):
    errs = []
    msgs = sample["messages"]
    if "<tools>" not in text and "# Tools" not in text:
        errs.append("Tools fehlen im gerenderten Prompt")
    if n_tokens > MAX_SEQ_LENGTH:
        errs.append(f"zu lang: {n_tokens} Tokens")
    for m in msgs:
        if m["role"] != "assistant":
            continue
        if m.get("tool_calls") and m.get("content"):
            errs.append("assistant hat content UND tool_calls (doppelter Aufruf)")
        if not m.get("reasoning_content"):
            errs.append("assistant ohne reasoning_content")
        for tc in m.get("tool_calls") or []:
            fn = tc["function"]
            if fn["name"] not in TOOL_NAMES:
                errs.append(f"unbekanntes Tool {fn['name']}")
            args = json.loads(fn["arguments"])
            if has_none(args):
                errs.append(f"null in Argumenten von {fn['name']}")
            if fn["name"] == "change":
                for op in args.get("operations", []):
                    if op.get("op") not in valid_ops:
                        errs.append(f"unbekannte Operation {op.get('op')}")
                    for key in REQUIRED.get(op.get("op"), []):
                        if not op.get(key):
                            errs.append(f"{op.get('op')} ohne {key}")
    n_asst = sum(1 for m in msgs if m["role"] == "assistant")
    n_tc = sum(len(m.get("tool_calls") or []) for m in msgs if m["role"] == "assistant")
    # Nur den Gesprächsteil zählen: der Systemteil enthält Format-Beispiele mit <tool_call>.
    convo = text.split("<|im_start|>user\n", 1)[-1]
    if convo.count(RESPONSE_PART) != n_asst:
        errs.append(f"{convo.count(RESPONSE_PART)} Assistenten-Marker statt {n_asst}")
    if convo.count("<think>") != n_asst:
        errs.append(f"{convo.count('<think>')} <think>-Blöcke statt {n_asst}")
    if convo.count("<tool_call>") != n_tc:
        errs.append(f"{convo.count('<tool_call>')} <tool_call> statt {n_tc}")
    if re.search(r">\nnull\n<|\":\s*null\b", convo):
        errs.append("null-Wert im gerenderten Gesprächsteil")
    return [f"#{i}: {e}" for e in errs]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="unsloth/Qwen3.5-4B")
    ap.add_argument("--show", type=int, default=1, help="Anzahl vollständig ausgegebener Beispiele")
    args = ap.parse_args()

    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(args.model)
    tools = load_tools()
    change = next(t["function"] for t in tools if t["function"]["name"] == "change")
    valid_ops = set(change["parameters"]["properties"]["operations"]["items"]["properties"]["op"]["enum"])

    all_errs, lengths, shown = [], [], 0
    for path in FILES:
        for i, sample in enumerate(load_jsonl(path)):
            text = render(tok, sample["messages"], tools)
            n = len(tok(text, add_special_tokens=False)["input_ids"])
            lengths.append(n)
            all_errs += check_sample(f"{path.stem}:{i}", sample, text, n, valid_ops)
            if shown < args.show:
                print("=" * 30, f"{path.name} #{i} ({n} Tokens)", "=" * 30)
                print(text)
                shown += 1

    print("=" * 80)
    print(f"Beispiele: {len(lengths)} | Tokens min/mittel/max: {min(lengths)}/{sum(lengths) // len(lengths)}/{max(lengths)}")
    if all_errs:
        print(f"{len(all_errs)} Problem(e):")
        for e in all_errs[:50]:
            print(" -", e)
        raise SystemExit(1)
    print("Alle Prüfungen bestanden.")


if __name__ == "__main__":
    main()
