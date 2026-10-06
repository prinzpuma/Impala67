"""
Vocabulary definition and CTC encoding/decoding utilities for handwriting recognition.

Index 0 is reserved for CTC Blank token.
Characters include:
- Lowercase and uppercase letters: a-z, A-Z
- German umlauts: ä, ö, ü, Ä, Ö, Ü, ß
- Digits: 0-9
- Whitespace: ' '
- Common punctuation: .,!?-+:/*=()@#%
"""

import json
from typing import List, Dict, Optional

BLANK_TOKEN = "<blank>"
BLANK_IDX = 0

# Base character sets
LETTERS_LOWER = "abcdefghijklmnopqrstuvwxyz"
LETTERS_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
GERMAN_UMLAUTS = "äöüÄÖÜß"
DIGITS = "0123456789"
WHITESPACE = " "
PUNCTUATION = ".,!?-+:/*=()@#%'"
MATH_SYMBOLS = "^_<>{}~√∫∑πλαβ"

# Combined ordered character list (starting at index 1, index 0 is blank)
CHARS: List[str] = [BLANK_TOKEN] + list(
    LETTERS_LOWER + LETTERS_UPPER + GERMAN_UMLAUTS + DIGITS + WHITESPACE + PUNCTUATION + MATH_SYMBOLS
)

# Deduplicate while preserving order if any overlap existed
seen = set()
UNIQUE_CHARS: List[str] = []
for c in CHARS:
    if c not in seen:
        seen.add(c)
        UNIQUE_CHARS.append(c)

CHARS = UNIQUE_CHARS
VOCAB_SIZE = len(CHARS)

CHAR_TO_IDX: Dict[str, int] = {char: idx for idx, char in enumerate(CHARS)}
IDX_TO_CHAR: Dict[int, str] = {idx: char for idx, char in enumerate(CHARS)}


def get_vocab_size() -> int:
    return VOCAB_SIZE


def char_to_index(char: str) -> Optional[int]:
    """Return index of character, or None if unknown."""
    return CHAR_TO_IDX.get(char)


def index_to_char(idx: int) -> str:
    """Return character for index. Blank returns empty string or blank token."""
    if idx == BLANK_IDX:
        return ""
    return IDX_TO_CHAR.get(idx, "")


def text_to_indices(text: str, ignore_unknown: bool = True) -> List[int]:
    """Convert text string into CTC target indices (skipping unknown chars)."""
    indices: List[int] = []
    for ch in text:
        if ch in CHAR_TO_IDX:
            idx = CHAR_TO_IDX[ch]
            if idx != BLANK_IDX:
                indices.append(idx)
        elif not ignore_unknown:
            raise ValueError(f"Unknown character in vocabulary: {repr(ch)}")
    return indices


def indices_to_text(indices: List[int]) -> str:
    """Direct conversion from indices to string (without CTC collapsing)."""
    return "".join(index_to_char(idx) for idx in indices)


def decode_ctc(indices: List[int], collapse_repeated: bool = True) -> str:
    """
    Greedy CTC decoding:
    - Collapse contiguous duplicate tokens
    - Remove CTC blank (index 0)
    """
    decoded_chars: List[str] = []
    prev_idx = -1

    for idx in indices:
        if collapse_repeated:
            if idx != prev_idx:
                if idx != BLANK_IDX and idx in IDX_TO_CHAR:
                    decoded_chars.append(IDX_TO_CHAR[idx])
                prev_idx = idx
        else:
            if idx != BLANK_IDX and idx in IDX_TO_CHAR:
                decoded_chars.append(IDX_TO_CHAR[idx])

    return "".join(decoded_chars)


def export_vocab_dict() -> Dict:
    """Export vocabulary metadata and mapping for Web / ONNX Runtime JS."""
    return {
        "blank_token": BLANK_TOKEN,
        "blank_index": BLANK_IDX,
        "vocab_size": VOCAB_SIZE,
        "chars": CHARS,
        "char_to_index": CHAR_TO_IDX,
        "index_to_char": {str(k): v for k, v in IDX_TO_CHAR.items()},
    }


def save_vocab_json(file_path: str):
    """Save vocabulary as a JSON file."""
    data = export_vocab_dict()
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    print(f"Vocabulary initialized with {VOCAB_SIZE} classes (including blank=0).")
    sample_text = "Hallo Welt! Äpfel & Übungen: 123 + 45 = 168 (100%)"
    encoded = text_to_indices(sample_text)
    decoded = decode_ctc(encoded, collapse_repeated=False)
    print(f"Sample test:")
    print(f"  Original: {sample_text}")
    print(f"  Encoded:  {encoded}")
    print(f"  Decoded:  {decoded}")
