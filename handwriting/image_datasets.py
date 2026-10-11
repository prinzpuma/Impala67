"""Echte Zeilenbilder für das Bild-Modell: ScaDS.AI German Line (CC BY 4.0) und fhswf/german_handwriting (AFL-3.0).

Beide dienen im Mathe-Training als Text-Wiederholung, damit das Modell Schrift nicht verlernt.
Bilder werden einmal auf 64 px Höhe gebracht und als uint8 zwischengespeichert (Cache-Datei, schnell wieder geladen).
"""

import csv
import glob
import io
import os
import pickle
import unicodedata
from typing import List, Optional, Tuple

import numpy as np
from PIL import Image

from vocabulary import CHAR_TO_IDX, BLANK_IDX

IMAGE_HEIGHT = 64
MAX_WIDTH = 1600  # breitere Zeilen auslassen (Speicher, kaum vorhanden)
CACHE_VERSION = 1

# Zeichen außerhalb unseres Vokabulars, die sich ohne Bedeutungsverlust abbilden lassen
CHAR_MAP = {"–": "-", "—": "-", "„": "'", "“": "'", "”": "'", '"': "'", "‚": "'", "‘": "'", "’": "'", "´": "'", "`": "'"}

# (Bild [64, W] uint8, Text, Schreiber-ID oder "")
Line = Tuple[np.ndarray, str, str]


def normalize_label(text: str) -> str:
    """NFC, Leerraum zusammenfassen, Anführungszeichen/Striche abbilden. "" wenn ein Zeichen fehlt:
    sonst lernt das Modell, geschriebene Zeichen zu übergehen."""
    text = " ".join(unicodedata.normalize("NFC", text).split())
    text = "".join(CHAR_MAP.get(c, c) for c in text)
    if not text or any(c not in CHAR_TO_IDX or CHAR_TO_IDX[c] == BLANK_IDX for c in text):
        return ""
    return text


def load_line_image(src) -> Optional[np.ndarray]:
    """Datei oder Bytes → Graustufen, 64 px hoch (Seitenverhältnis bleibt), uint8. None bei Fehler/zu breit."""
    try:
        img = Image.open(io.BytesIO(src) if isinstance(src, (bytes, bytearray)) else src)
        img = img.convert("L")
    except Exception:
        return None
    w = max(4, round(img.width * IMAGE_HEIGHT / max(1, img.height)))
    if w > MAX_WIDTH:
        return None
    return np.asarray(img.resize((w, IMAGE_HEIGHT), Image.BILINEAR), dtype=np.uint8)


def _cached(path: str, build):
    if os.path.exists(path):
        with open(path, "rb") as f:
            data = pickle.load(f)
        print(f"Cache geladen: {path} ({len(data)} Zeilen)")
        return data
    data = build()
    if not data:
        return data  # nichts gefunden: keinen leeren Cache anlegen, der spätere echte Daten verdeckt
    with open(path, "wb") as f:
        pickle.dump(data, f, protocol=4)
    print(f"Cache gespeichert: {path} ({len(data)} Zeilen)")
    return data


def load_scads(root: str, cache_dir: str) -> List[Line]:
    """ScaDS.AI German Line-Level (Zenodo 18301532). root = entpackter Ordner (CSV wird darin gesucht).
    Schreiber = page_id (eine Seite je Schreiber, wie bei de-htr)."""
    def build():
        found = glob.glob(os.path.join(root, "**", "line_annotations.csv"), recursive=True)
        if not found:
            print(f"ScaDS nicht gefunden unter {root}")
            return []
        base = os.path.dirname(os.path.dirname(os.path.dirname(found[0])))
        out, skipped = [], 0
        with open(found[0], encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                text = normalize_label(row["text"])
                img = load_line_image(os.path.join(base, "images", "lines", row["line_file"])) if text else None
                if img is None:
                    skipped += 1
                    continue
                out.append((img, text, row["page_id"]))
        print(f"ScaDS: {len(out)} Zeilen, {skipped} ausgelassen (Zeichen außerhalb des Vokabulars oder Bildfehler)")
        return out
    return _cached(os.path.join(cache_dir, f"scads-lines-v{CACHE_VERSION}.pkl"), build)


def load_fhswf(parquet_dir: str, cache_dir: str) -> List[Line]:
    """fhswf/german_handwriting (Hugging Face, Parquet mit image/text). Keine Schreiber-IDs: nur Training."""
    def build():
        import pyarrow.parquet as pq
        files = sorted(glob.glob(os.path.join(parquet_dir, "**", "*.parquet"), recursive=True))
        out, skipped = [], 0
        for fp in files:
            table = pq.read_table(fp, columns=["image", "text"]).to_pylist()
            for row in table:
                text = normalize_label(row["text"] or "")
                img = load_line_image(row["image"]["bytes"]) if text and row.get("image") else None
                if img is None:
                    skipped += 1
                    continue
                out.append((img, text, ""))
        print(f"fhswf: {len(out)} Zeilen aus {len(files)} Dateien, {skipped} ausgelassen")
        return out
    return _cached(os.path.join(cache_dir, f"fhswf-lines-v{CACHE_VERSION}.pkl"), build)
