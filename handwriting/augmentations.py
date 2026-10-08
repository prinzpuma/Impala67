"""
handwriting/augmentations.py
On-the-fly Daten-Augmentierung für Handschrift (Digital Ink):
1. Elastische Verzerrung (nicht-rigide Verformung)
2. Neigung (Slant / Kursivierung)
3. Zittern (Mikro-Jitter der Handbewegung)
4. Tempo-Rauschen (nicht-lineare Schreibgeschwindigkeit / Punktabstände)
5. Abstandsvariation (Kerning & Wortabstände)
"""

import math
import random
from typing import List, Tuple
import numpy as np


def apply_slant(strokes: List[List[Tuple[float, float]]], slant: float = None) -> List[List[Tuple[float, float]]]:
    """Neigt die Handschrift nach links oder rechts (x' = x + y * slant)."""
    if slant is None:
        slant = random.uniform(-0.35, 0.35)
    if abs(slant) < 1e-4:
        return strokes
    return [[(p[0] + p[1] * slant, p[1]) for p in s] for s in strokes]


def apply_elastic_distortion(
    strokes: List[List[Tuple[float, float]]],
    intensity: float = 0.04
) -> List[List[Tuple[float, float]]]:
    """Elastische glatte Verzerrung mittels überlagerter niederfrequenter harmonischer Felder."""
    if not strokes or intensity <= 0:
        return strokes

    # Zufällige Frequenzen und Phasen
    f1, f2 = random.uniform(0.5, 2.5), random.uniform(0.5, 2.5)
    f3, f4 = random.uniform(0.5, 2.5), random.uniform(0.5, 2.5)
    p1, p2 = random.uniform(0, 2 * math.pi), random.uniform(0, 2 * math.pi)
    p3, p4 = random.uniform(0, 2 * math.pi), random.uniform(0, 2 * math.pi)

    amp_x = random.uniform(0.01, intensity)
    amp_y = random.uniform(0.01, intensity)

    warped = []
    for s in strokes:
        warped_s = []
        for p in s:
            x, y = p[0], p[1]
            dx = amp_x * (math.sin(y * f1 + p1) + math.cos(x * f2 + p2))
            dy = amp_y * (math.cos(x * f3 + p3) + math.sin(y * f4 + p4))
            warped_s.append((x + dx, y + dy))
        warped.append(warped_s)
    return warped


def apply_jitter(
    strokes: List[List[Tuple[float, float]]],
    sigma: float = 0.012
) -> List[List[Tuple[float, float]]]:
    """Fügt Mikrozittern (Handunruhe) hinzu."""
    if not strokes or sigma <= 0:
        return strokes
    return [[(p[0] + random.gauss(0, sigma), p[1] + random.gauss(0, sigma)) for p in s] for s in strokes]


def apply_speed_noise(
    pts: List[Tuple[float, float]],
    base_step: float,
    speed_noise: float = 0.35
) -> List[Tuple[float, float]]:
    if len(pts) == 0:
        return []
    if len(pts) == 1:
        return [pts[0], pts[0]]
    out = [pts[0]]
    cur_dist = 0.0

    for i in range(len(pts) - 1):
        p0, p1 = pts[i], pts[i + 1]
        seg_dist = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        if seg_dist < 1e-6:
            continue
        walked = 0.0
        # Lokaler Schritt mit Geschwindigkeitsrauschen
        step = max(0.01, base_step * random.uniform(1.0 - speed_noise, 1.0 + speed_noise))
        while cur_dist + (seg_dist - walked) >= step:
            rem = step - cur_dist
            walked += rem
            t = walked / seg_dist
            nx = p0[0] + (p1[0] - p0[0]) * t
            ny = p0[1] + (p1[1] - p0[1]) * t
            out.append((nx, ny))
            cur_dist = 0.0
            step = max(0.01, base_step * random.uniform(1.0 - speed_noise, 1.0 + speed_noise))
        cur_dist += (seg_dist - walked)

    last = pts[-1]
    if len(out) < 2 or math.hypot(last[0] - out[-1][0], last[1] - out[-1][1]) > base_step * 0.5:
        out.append(last)
    return out


def apply_augmentations_on_the_fly(
    strokes: List[List[Tuple[float, float]]],
    slant: bool = True,
    elastic: bool = True,
    jitter: bool = True,
    scale_variation: bool = True
) -> List[List[Tuple[float, float]]]:
    """Kombiniert alle On-the-fly-Augmentierungen zu einer extrem diversen Trainingsinstanz."""
    if not strokes:
        return strokes

    res = strokes

    # 1. Skalierung und Streckung
    if scale_variation and random.random() < 0.85:
        sx = random.uniform(0.85, 1.20)
        sy = random.uniform(0.85, 1.20)
        res = [[(p[0] * sx, p[1] * sy) for p in s] for s in res]

    # 2. Neigung (Slant)
    if slant and random.random() < 0.85:
        slant_val = random.uniform(-0.35, 0.35)
        res = apply_slant(res, slant_val)

    # 3. Elastische Verzerrung
    if elastic and random.random() < 0.80:
        res = apply_elastic_distortion(res, intensity=random.uniform(0.02, 0.06))

    # 4. Zittern
    if jitter and random.random() < 0.75:
        res = apply_jitter(res, sigma=random.uniform(0.005, 0.018))

    return res
