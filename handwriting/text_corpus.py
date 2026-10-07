"""
handwriting/text_corpus.py
Erzeugt abwechslungsreiche deutsche Trainingstexte (Wörter, Zeilen, Zahlen) aus dictionary_de.txt.
Statt einer kleinen festen Wortliste sieht das Modell so zehntausende verschiedene Buchstabenfolgen.
"""

import os
import random
from typing import List

from vocabulary import CHAR_TO_IDX
from generate_synthetic import SAMPLE_WORDS

DICT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dictionary_de.txt")


def _load_words(path: str = DICT_PATH) -> List[str]:
    if not os.path.exists(path):
        return list(SAMPLE_WORDS)
    with open(path, encoding="utf-8") as f:
        words = [w.strip() for w in f]
    return [w for w in words if 2 <= len(w) <= 16 and all(c in CHAR_TO_IDX for c in w)]


WORDS = _load_words()
PUNCT_END = [".", ".", ",", "?", "!", ":"]


def random_number(rng: random.Random) -> str:
    kind = rng.randint(0, 5)
    if kind == 0:
        return str(rng.randint(0, 9999))
    if kind == 1:
        return f"{rng.randint(1, 31):02d}.{rng.randint(1, 12):02d}.{rng.randint(1990, 2035)}"
    if kind == 2:
        return f"{rng.randint(0, 23)}:{rng.randint(0, 59):02d}"
    if kind == 3:
        return f"{rng.randint(0, 99)},{rng.randint(0, 99)}"
    if kind == 4:
        return f"{rng.randint(1, 100)}%"
    return f"{rng.randint(1, 99)}+{rng.randint(1, 99)}={rng.randint(2, 198)}"


def random_word(rng: random.Random) -> str:
    # Fachwortschatz der App bleibt als kleine Beimischung erhalten
    if rng.random() < 0.1:
        return rng.choice(SAMPLE_WORDS)
    word = rng.choice(WORDS)
    r = rng.random()
    if r < 0.08:
        word = word.lower()
    elif r < 0.16:
        word = word[0].upper() + word[1:]
    return word


def random_text(rng: random.Random) -> str:
    """Einzelwort (40 %), Zeile aus 2–6 Wörtern (50 %) oder Zahl/Datum (10 %)."""
    r = rng.random()
    if r < 0.40:
        return random_word(rng)
    if r < 0.90:
        parts = [random_word(rng) if rng.random() > 0.08 else random_number(rng) for _ in range(rng.randint(2, 6))]
        line = " ".join(parts)
        if rng.random() < 0.5:
            line += rng.choice(PUNCT_END)
        return line
    return random_number(rng)


if __name__ == "__main__":
    rng = random.Random(0)
    print(f"{len(WORDS)} Wörter geladen")
    for _ in range(10):
        print(random_text(rng))
