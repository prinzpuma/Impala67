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
MAX_SEQ_LENGTH = 8192
DEFAULT_FILES = [ROOT / "data" / "impala_flat_train.jsonl", ROOT / "data" / "impala_flat_val.jsonl"]


def has_none(value):
    if value is None:
        return True
    if isinstance(value, dict):
        return any(has_none(v) for v in value.values())
    if isinstance(value, list):
        return any(has_none(v) for v in value)
    return False


def tool_schemas(tools):
    out = {}
    for t in tools:
        fn = t["function"]
        params = fn.get("parameters") or {}
        out[fn["name"]] = {
            "required": list(params.get("required") or []),
            "props": set((params.get("properties") or {}).keys()),
        }
    return out


def check_sample(i, sample, text, n_tokens, schemas, max_len):
    errs = []
    msgs = sample["messages"]
    if "<tools>" not in text and "# Tools" not in text:
        errs.append("Tools fehlen im gerenderten Prompt")
    if n_tokens > max_len:
        errs.append(f"zu lang: {n_tokens} > {max_len} Tokens")
    for m in msgs:
        if m["role"] != "assistant":
            continue
        if m.get("tool_calls") and (m.get("content") or "").strip():
            errs.append("assistant hat content UND tool_calls (doppelter Aufruf)")
        if not (m.get("reasoning_content") or "").strip():
            errs.append("assistant ohne reasoning_content")
        for tc in m.get("tool_calls") or []:
            fn = tc["function"]
            name = fn["name"]
            if name not in schemas:
                errs.append(f"unbekanntes Tool {name}")
                continue
            raw_args = fn["arguments"]
            args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            if not isinstance(args, dict):
                errs.append(f"Argumente von {name} sind kein Objekt")
                continue
            if has_none(args):
                errs.append(f"null in Argumenten von {name}")
            unknown = set(args.keys()) - schemas[name]["props"]
            if unknown:
                errs.append(f"{name}: unbekannte Felder {sorted(unknown)}")
            for req in schemas[name]["required"]:
                val = args.get(req)
                if val is None or val == "" or val == []:
                    errs.append(f"{name} ohne Pflichtfeld {req}")
    n_asst = sum(1 for m in msgs if m["role"] == "assistant")
    n_tc = sum(len(m.get("tool_calls") or []) for m in msgs if m["role"] == "assistant")
    # Qwen-3.5-Template rendert <think> nur ab dem letzten User-Turn (frühere Runden werden ohne <think> gerendert).
    last_user_idx = max((idx for idx, m in enumerate(msgs) if m["role"] == "user"), default=0)
    n_last_asst = sum(1 for m in msgs[last_user_idx:] if m["role"] == "assistant")
    # Nur den Gesprächsteil zählen: der Systemteil enthält Format-Beispiele mit <tool_call>.
    convo = text.split("<|im_start|>user\n", 1)[-1]
    if convo.count(RESPONSE_PART) != n_asst:
        errs.append(f"{convo.count(RESPONSE_PART)} Assistenten-Marker statt {n_asst}")
    if convo.count("<think>") != n_last_asst:
        errs.append(f"{convo.count('<think>')} <think>-Blöcke statt {n_last_asst}")
    if convo.count("<tool_call>") != n_tc:
        errs.append(f"{convo.count('<tool_call>')} <tool_call> statt {n_tc}")
    if re.search(r">\nnull\n<", convo):
        errs.append("null-Parameterwert im gerenderten Gesprächsteil")
    return [f"#{i}: {e}" for e in errs]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3.5-4B")
    ap.add_argument("--show", type=int, default=1, help="Anzahl vollständig ausgegebener Beispiele")
    ap.add_argument("--max-len", type=int, default=MAX_SEQ_LENGTH)
    ap.add_argument("--files", nargs="*", help="JSONL-Dateien (Standard: impala_flat_train/val.jsonl)")
    args = ap.parse_args()

    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(args.model)
    tools = load_tools()
    schemas = tool_schemas(tools)
    files = [Path(f) for f in args.files] if args.files else [p for p in DEFAULT_FILES if p.exists()]
    if not files:
        raise SystemExit("Keine Datensatz-Dateien gefunden (zuerst generate_trajectories.mjs ausführen).")

    all_errs, lengths, shown = [], [], 0
    for path in files:
        for i, sample in enumerate(load_jsonl(path)):
            text = render(tok, sample["messages"], tools)
            n = len(tok(text, add_special_tokens=False)["input_ids"])
            lengths.append(n)
            all_errs += check_sample(f"{path.stem}:{i}", sample, text, n, schemas, args.max_len)
            if shown < args.show:
                print("=" * 30, f"{path.name} #{i} ({n} Tokens)", "=" * 30)
                print(text[:4000] + ("\n...[gekürzt]..." if len(text) > 4000 else ""))
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
