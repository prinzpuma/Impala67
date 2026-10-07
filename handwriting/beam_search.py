"""
handwriting/beam_search.py
CTC Beam-Search Decoder mit Wörterbuch-Scoring für Offline- und Online-Evaluation.
Vergleicht CER vor und nach Beam-Search mit Greedy Decoding.
"""

import math
from typing import List, Tuple, Set
import numpy as np

from vocabulary import index_to_char, BLANK_IDX, CHAR_TO_IDX

def softmax(x):
    e_x = np.exp(x - np.max(x, axis=-1, keepdims=True))
    return e_x / np.sum(e_x, axis=-1, keepdims=True)

import os

DEFAULT_DICT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dictionary_de.txt")
_CACHED_DICT: Set[str] = None

def get_default_dictionary() -> Set[str]:
    global _CACHED_DICT
    if _CACHED_DICT is None:
        _CACHED_DICT = set()
        if os.path.exists(DEFAULT_DICT_PATH):
            with open(DEFAULT_DICT_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    w = line.strip().lower()
                    if w and not w.startswith("#"):
                        _CACHED_DICT.add(w)
    return _CACHED_DICT

def ctc_beam_search_decode(
    logits2D: np.ndarray,
    beam_width: int = 15,
    word_list: Set[str] = None,
    word_bonus: float = 2.0,
    blank_idx: int = BLANK_IDX
) -> str:
    """
    Standard CTC Beam Search mit Präfix-Baum und optionalem Wörterbuch-Bonus.
    """
    if word_list is None:
        word_list = get_default_dictionary()

    probs = softmax(logits2D)

    num_steps, vocab_size = probs.shape

    # Beams speichern: { prefix_tuple: (p_blank, p_non_blank) }
    beams = { (): (1.0, 0.0) }

    for t in range(num_steps):
        step_probs = probs[t]
        new_beams = {}

        # Nur signifikante Zeichen für diesen Zeitschritt betrachten (mind. 0.5% Wahrscheinlichkeit)
        cand_indices = [c for c in np.where(step_probs > 5e-3)[0] if c != blank_idx]

        for prefix, (p_b, p_nb) in beams.items():
            p_total = p_b + p_nb

            # 1. Blank-Übergang
            p_b_new = p_total * step_probs[blank_idx]
            if prefix not in new_beams:
                new_beams[prefix] = (p_b_new, 0.0)
            else:
                curr_b, curr_nb = new_beams[prefix]
                new_beams[prefix] = (curr_b + p_b_new, curr_nb)

            # 2. Non-Blank Übergänge
            for c in cand_indices:
                p_c = step_probs[c]


                if len(prefix) > 0 and c == prefix[-1]:
                    # Wiederholung des gleichen Zeichens:
                    # Aus Blank -> neues Zeichen am Ende
                    new_p_nb = p_b * p_c
                    new_prefix = prefix + (c,)
                    if new_prefix not in new_beams:
                        new_beams[new_prefix] = (0.0, new_p_nb)
                    else:
                        b, nb = new_beams[new_prefix]
                        new_beams[new_prefix] = (b, nb + new_p_nb)

                    # Aus Non-Blank -> bleibt das gleiche kollabierte Zeichen
                    same_p_nb = p_nb * p_c
                    curr_b, curr_nb = new_beams[prefix]
                    new_beams[prefix] = (curr_b, curr_nb + same_p_nb)
                else:
                    # Neues Zeichen
                    new_p_nb = p_total * p_c
                    new_prefix = prefix + (c,)
                    if new_prefix not in new_beams:
                        new_beams[new_prefix] = (0.0, new_p_nb)
                    else:
                        b, nb = new_beams[new_prefix]
                        new_beams[new_prefix] = (b, nb + new_p_nb)

        # Beschneiden auf Top beam_width
        sorted_beams = sorted(
            new_beams.items(),
            key=lambda item: item[1][0] + item[1][1],
            reverse=True
        )[:beam_width * 2]
        beams = dict(sorted_beams)

    # Finale Bewertung mit Wörterbuch-Bonus
    best_text = ""
    best_score = -float("inf")

    for prefix, (p_b, p_nb) in beams.items():
        text = "".join(index_to_char(c) for c in prefix)
        total_p = p_b + p_nb
        score = math.log(max(1e-12, total_p))

        if word_list and text.lower() in word_list:
            score += word_bonus

        if score > best_score:
            best_score = score
            best_text = text

    return best_text
