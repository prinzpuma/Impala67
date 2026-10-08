"""
handwriting/brush_loader.py
Lädt und parst echte menschliche Vektor-Handschrift aus dem BRUSH-Datensatz
(Brown University, Decoupled Style Descriptors, ECCV 2020).
170 Schreiber, 27.649 Beispiele in Vektor-Strichen.

Nutzung: Nur für nicht-kommerzielle Forschung. Rohdaten verbleiben in
handwriting/data/brush/ (gitignored) bzw. Google Drive.
"""

import os
import glob
import pickle
import numpy as np
from typing import List, Tuple, Optional

from vocabulary import CHAR_TO_IDX, BLANK_IDX
from mathwriting_loader import strokes_to_normalized_features

CACHE_VERSION = 1
BRUSH_CHARACTERS = ' !"#$%&\'()*+,-./0123456789:;<=>?ABCDEFGHIJKLMNOPQRSTUVWXYZ[]abcdefghijklmnopqrstuvwxyz'


def raw_points_to_strokes(raw_points) -> List[List[Tuple[float, float]]]:
    """Wandelt die BRUSH [x, y, t] Punktesequenz in separate Striche um (t=1.0 startet neuen Strich)."""
    strokes = []
    cur = []
    for p in raw_points:
        x, y, t = float(p[0]), float(p[1]), float(p[2])
        if t == 1.0:
            if cur:
                strokes.append(cur)
            cur = [(x, y)]
        else:
            cur.append((x, y))
    if cur:
        strokes.append(cur)
    return strokes


def is_valid_vocab_text(text: str) -> bool:
    """Prüft, ob alle Zeichen verlustfrei im Vokabular liegen (kein Blank, keine unbekannten Zeichen)."""
    if not text or len(text.strip()) == 0:
        return False
    for ch in text:
        if ch not in CHAR_TO_IDX or CHAR_TO_IDX[ch] == BLANK_IDX:
            return False
    return True


def parse_brush_npy(file_path: str) -> List[Tuple[List[List[Tuple[float, float]]], str]]:
    """
    Liest eine BRUSH .npy-Datei aus und liefert gültige (strokes, text)-Paare.
    Extrahiert sowohl die Gesamtsätze als auch die einzelnen segmentierten Wörter,
    sofern alle Zeichen im Vokabular liegen.
    """
    try:
        data = np.load(file_path, allow_pickle=True, encoding="latin1")
        results = []

        # 1. Satz-Ebene (data[0], data[3], data[4])
        raw_sentence_pts = data[0]
        sent_term = data[3]
        sent_chars = data[4]
        sent_text = "".join([BRUSH_CHARACTERS[c] for c, t in zip(sent_chars, sent_term) if t == 1]).strip()

        if is_valid_vocab_text(sent_text):
            strokes = raw_points_to_strokes(raw_sentence_pts)
            if strokes:
                results.append((strokes, sent_text))

        # 2. Wort-Ebene (data[5], data[8], data[9])
        word_raw_strokes = data[5]
        word_terms = data[8]
        word_chars = data[9]

        for w_i in range(len(word_raw_strokes)):
            w_pts = word_raw_strokes[w_i]
            w_term = word_terms[w_i]
            w_c = word_chars[w_i]
            w_text = "".join([BRUSH_CHARACTERS[c] for c, t in zip(w_c, w_term) if t == 1]).strip()

            if is_valid_vocab_text(w_text):
                w_strokes = raw_points_to_strokes(w_pts)
                if w_strokes:
                    results.append((w_strokes, w_text))

        return results
    except Exception:
        return []


class BrushDataset:
    """
    Dataset für den BRUSH-Handschriftdatensatz.
    Unterstützt writer-getrennte Splits:
      - 'train': Schreiber 0 bis 149 (150 Schreiber)
      - 'val':   Schreiber 150 bis 169 (20 Schreiber)
      - 'all':   alle Schreiber
    """

    def __init__(
        self,
        base_dir: Optional[str] = None,
        split: str = "train",
        max_samples: Optional[int] = None,
    ):
        self.split = split
        self.max_samples = max_samples

        if base_dir is None:
            data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
            candidates = [
                os.path.join(data_dir, "brush", "writers"),
                os.path.join(data_dir, "brush"),
                os.path.join(data_dir, "writers"),
            ]
            base_dir = next((c for c in candidates if os.path.isdir(c)), candidates[0])

        self.base_dir = base_dir
        self.samples: List[Tuple[np.ndarray, str]] = []
        self._load()

    def _cache_path(self) -> str:
        cache_dir = os.path.dirname(self.base_dir) if "writers" in self.base_dir else self.base_dir
        # Auch Colab HW_CHECKPOINT_DIR / Drive-Ordner prüfen
        drive_dir = os.environ.get("HW_CHECKPOINT_DIR")
        if drive_dir:
            parent_drive = os.path.dirname(drive_dir)
            if os.path.isdir(parent_drive):
                cache_dir = parent_drive
        return os.path.join(cache_dir, f"brush-{self.split}-v{CACHE_VERSION}.cache.pkl")

    def _load(self):
        cache = self._cache_path()
        if os.path.exists(cache):
            try:
                with open(cache, "rb") as f:
                    raw_items = pickle.load(f)
                    self.samples = [
                        (np.frombuffer(raw, dtype=np.float32).reshape(-1, 4), label)
                        for raw, label in raw_items
                    ]
                print(f"BRUSH ({self.split}) aus Cache geladen: {len(self.samples)} Beispiele ({cache}).")
                if self.max_samples and len(self.samples) > self.max_samples:
                    self.samples = self.samples[: self.max_samples]
                return
            except Exception as e:
                print(f"Fehler beim Laden des BRUSH-Caches ({cache}): {e}. Erzeuge neu...")

        # Prüfe, ob writers-Verzeichnis existiert
        search_dir = self.base_dir
        if not os.path.isdir(search_dir):
            if os.path.isdir(os.path.join(self.base_dir, "writers")):
                search_dir = os.path.join(self.base_dir, "writers")
            else:
                print(f"BRUSH Verzeichnis nicht gefunden: {self.base_dir}")
                return

        writer_folders = [
            f for f in os.listdir(search_dir) if os.path.isdir(os.path.join(search_dir, f))
        ]

        def get_writer_id(folder_name: str) -> Optional[int]:
            try:
                return int(folder_name)
            except ValueError:
                return None

        # Writer-Split: 0..149 Train (150 Schreiber), 150..169 Val (20 Schreiber)
        selected_folders = []
        for wf in writer_folders:
            wid = get_writer_id(wf)
            if wid is None:
                continue
            if self.split == "train" and wid < 150:
                selected_folders.append(os.path.join(search_dir, wf))
            elif self.split == "val" and wid >= 150:
                selected_folders.append(os.path.join(search_dir, wf))
            elif self.split == "all":
                selected_folders.append(os.path.join(search_dir, wf))

        if not selected_folders:
            print(f"Keine Schreiber-Ordner für BRUSH Split '{self.split}' in {search_dir} gefunden.")
            return

        print(
            f"Lade BRUSH Split '{self.split}' aus {len(selected_folders)} Schreibern...",
            flush=True,
        )

        all_files = []
        for sf in selected_folders:
            all_files.extend(sorted(glob.glob(os.path.join(sf, "*.npy"))))

        skipped = 0
        for i, fp in enumerate(all_files):
            if self.max_samples and len(self.samples) >= self.max_samples:
                break
            items = parse_brush_npy(fp)
            if not items:
                skipped += 1
                continue
            for strokes, text in items:
                feats = strokes_to_normalized_features(strokes)
                if len(feats) >= 4 and len(text) > 0:
                    self.samples.append((np.asarray(feats, dtype=np.float32), text))
            if i and i % 2000 == 0:
                print(
                    f"  BRUSH ({self.split}): {i}/{len(all_files)} Dateien gelesen, {len(self.samples)} Beispiele",
                    flush=True,
                )

        print(
            f"BRUSH ({self.split}) geladen: {len(self.samples)} Beispiele aus {len(selected_folders)} Schreibern "
            f"({skipped} Dateien übersprungen).",
            flush=True,
        )

        # Cache speichern, wenn Beispiele gefunden wurden
        if self.samples:
            try:
                os.makedirs(os.path.dirname(cache), exist_ok=True)
                with open(cache, "wb") as f:
                    pickle.dump(
                        [(feats.tobytes(), label) for feats, label in self.samples],
                        f,
                        protocol=4,
                    )
                print(f"BRUSH-Cache gespeichert: {cache} ({len(self.samples)} Beispiele).")
            except Exception as e:
                print(f"Konnte BRUSH-Cache nicht speichern: {e}")

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Tuple[np.ndarray, str]:
        return self.samples[idx]

    def get_sample(self, idx: int) -> Tuple[np.ndarray, str]:
        return self.samples[idx]


if __name__ == "__main__":
    import sys

    print("Teste BrushDataset...")
    ds = BrushDataset(split="train")
    print(f"Train-Samples: {len(ds)}")
    if len(ds) > 0:
        f, l = ds.get_sample(0)
        print(f"Probe 0: Label='{l}', Features={len(f)}")
