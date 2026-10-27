"""Baut web/handwriting-lexicon-de.txt: großes Wörterbuch für die wörterbuchgeführte Suche (core/impala-ink/src/lexicon.rs).

Quelle: dictionary_de.txt plus die 5.000 häufigsten Wörter aus core/impala-ink/src/words-de.txt.
Ausgabe: klein geschrieben, nur Buchstaben aus dem Modell-Vokabular, ab 2 Zeichen, eindeutig, sortiert
(Codepunkt-Reihenfolge, wie JavaScript vergleicht), ein Wort je Zeile.
Aufruf: python build_lexicon.py
"""
import os
import re

from vocabulary import LETTERS_LOWER

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "..", "web")
LETTERS = set(LETTERS_LOWER + "äöüß")


def main():
    words = set()
    with open(os.path.join(HERE, "dictionary_de.txt"), encoding="utf-8") as f:
        words.update(line.strip().lower() for line in f)
    common = os.path.join(HERE, "..", "core", "impala-ink", "src", "words-de.txt")
    words.update(open(common, encoding="utf-8").read().split())
    words = sorted(w for w in words if len(w) >= 2 and all(c in LETTERS for c in w))
    out = os.path.join(WEB, "handwriting-lexicon-de.txt")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(words) + "\n")
    print(f"{len(words)} Wörter -> {out}")


if __name__ == "__main__":
    main()
