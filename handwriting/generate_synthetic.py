"""
handwriting/generate_synthetic.py
Synthetischer Strichgenerator für Online-Handschrift (Digital Ink).
Erzeugt Vektorpunkte [dx, dy, pen_down] für Buchstaben, Ziffern und Wörter.
Nutzt Vektor-Glyphen-Pfade mit stochastischem Jitter, Strichstärkenvariation und Neigung.
Rechtlich 100 % sauber ohne externe proprietäre Datensätze.
"""

import math
import random
from typing import List, Tuple
from vocabulary import CHAR_TO_IDX, VOCAB_SIZE, BLANK_IDX

# Grundlegende Strichprimitiven für Zeichen (Linienzüge im Normalraum [0..1, 0..1])
# Jeder Strich ist eine Liste von (x, y) Kontrollpunkten.
GLYPH_STROKES = {
    # Kleinbuchstaben
    "a": [[(0.8, 0.3), (0.4, 0.2), (0.1, 0.5), (0.3, 0.9), (0.7, 0.8), (0.8, 0.3)], [(0.8, 0.2), (0.8, 0.9)]],
    "b": [[(0.2, 0.0), (0.2, 0.9)], [(0.2, 0.5), (0.7, 0.4), (0.8, 0.7), (0.5, 0.9), (0.2, 0.9)]],
    "c": [[(0.8, 0.3), (0.4, 0.2), (0.1, 0.5), (0.4, 0.9), (0.8, 0.8)]],
    "d": [[(0.8, 0.4), (0.4, 0.3), (0.2, 0.6), (0.5, 0.9), (0.8, 0.8)], [(0.8, 0.0), (0.8, 0.9)]],
    "e": [[(0.1, 0.6), (0.8, 0.5), (0.6, 0.2), (0.2, 0.4), (0.2, 0.8), (0.7, 0.9)]],
    "f": [[(0.7, 0.1), (0.4, 0.0), (0.3, 0.4), (0.3, 0.9)], [(0.1, 0.4), (0.6, 0.4)]],
    "g": [[(0.8, 0.3), (0.4, 0.2), (0.1, 0.5), (0.4, 0.9), (0.8, 0.8), (0.8, 0.3)], [(0.8, 0.3), (0.8, 1.2), (0.3, 1.3)]],
    "h": [[(0.2, 0.0), (0.2, 0.9)], [(0.2, 0.4), (0.5, 0.3), (0.8, 0.5), (0.8, 0.9)]],
    "i": [[(0.4, 0.3), (0.4, 0.9)], [(0.4, 0.1), (0.42, 0.12)]],
    "j": [[(0.5, 0.3), (0.5, 1.2), (0.2, 1.3)], [(0.5, 0.1), (0.52, 0.12)]],
    "k": [[(0.2, 0.0), (0.2, 0.9)], [(0.7, 0.3), (0.2, 0.6)], [(0.3, 0.5), (0.8, 0.9)]],
    "l": [[(0.3, 0.0), (0.3, 0.9)]],
    "m": [[(0.1, 0.3), (0.1, 0.9)], [(0.1, 0.4), (0.4, 0.3), (0.5, 0.9)], [(0.5, 0.4), (0.8, 0.3), (0.9, 0.9)]],
    "n": [[(0.2, 0.3), (0.2, 0.9)], [(0.2, 0.4), (0.5, 0.3), (0.8, 0.5), (0.8, 0.9)]],
    "o": [[(0.5, 0.25), (0.2, 0.4), (0.2, 0.7), (0.5, 0.85), (0.8, 0.7), (0.8, 0.4), (0.5, 0.25)]],
    "p": [[(0.2, 0.3), (0.2, 1.3)], [(0.2, 0.4), (0.7, 0.3), (0.8, 0.7), (0.5, 0.9), (0.2, 0.8)]],
    "q": [[(0.8, 0.4), (0.4, 0.3), (0.2, 0.6), (0.5, 0.9), (0.8, 0.8)], [(0.8, 0.3), (0.8, 1.3)]],
    "r": [[(0.2, 0.3), (0.2, 0.9)], [(0.2, 0.5), (0.5, 0.3), (0.8, 0.4)]],
    "s": [[(0.8, 0.3), (0.4, 0.2), (0.2, 0.4), (0.6, 0.6), (0.8, 0.8), (0.4, 0.9), (0.1, 0.8)]],
    "t": [[(0.4, 0.1), (0.4, 0.9)], [(0.2, 0.3), (0.7, 0.3)]],
    "u": [[(0.2, 0.3), (0.2, 0.8), (0.5, 0.9), (0.8, 0.8)], [(0.8, 0.3), (0.8, 0.9)]],
    "v": [[(0.1, 0.3), (0.5, 0.9)], [(0.5, 0.9), (0.9, 0.3)]],
    "w": [[(0.1, 0.3), (0.3, 0.9)], [(0.3, 0.9), (0.5, 0.4)], [(0.5, 0.4), (0.7, 0.9)], [(0.7, 0.9), (0.9, 0.3)]],
    "x": [[(0.2, 0.3), (0.8, 0.9)], [(0.8, 0.3), (0.2, 0.9)]],
    "y": [[(0.15, 0.3), (0.45, 0.85)], [(0.75, 0.3), (0.15, 1.25)]],
    "z": [[(0.2, 0.3), (0.8, 0.3), (0.2, 0.9), (0.8, 0.9)]],
    "ä": [[(0.8, 0.3), (0.4, 0.2), (0.1, 0.5), (0.3, 0.9), (0.7, 0.8), (0.8, 0.3)], [(0.8, 0.2), (0.8, 0.9)], [(0.3, 0.05), (0.32, 0.07)], [(0.7, 0.05), (0.72, 0.07)]],
    "ö": [[(0.5, 0.2), (0.2, 0.4), (0.2, 0.7), (0.5, 0.9), (0.8, 0.7), (0.8, 0.4), (0.5, 0.2)], [(0.35, 0.05), (0.37, 0.07)], [(0.65, 0.05), (0.67, 0.07)]],
    "ü": [[(0.2, 0.3), (0.2, 0.8), (0.5, 0.9), (0.8, 0.8)], [(0.8, 0.3), (0.8, 0.9)], [(0.35, 0.05), (0.37, 0.07)], [(0.65, 0.05), (0.67, 0.07)]],
    "ß": [[(0.2, 0.9), (0.2, 0.0)], [(0.2, 0.0), (0.6, 0.1), (0.6, 0.4), (0.2, 0.4)], [(0.2, 0.4), (0.7, 0.5), (0.6, 0.8), (0.2, 0.8)]],

    # Großbuchstaben
    "A": [[(0.1, 1.0), (0.5, 0.0), (0.9, 1.0)], [(0.25, 0.6), (0.75, 0.6)]],
    "B": [[(0.2, 1.0), (0.2, 0.0)], [(0.2, 0.0), (0.7, 0.15), (0.6, 0.45), (0.2, 0.45)], [(0.2, 0.45), (0.8, 0.65), (0.6, 1.0), (0.2, 1.0)]],
    "C": [[(0.8, 0.2), (0.4, 0.0), (0.1, 0.5), (0.4, 1.0), (0.8, 0.8)]],
    "D": [[(0.2, 1.0), (0.2, 0.0)], [(0.2, 0.0), (0.8, 0.4), (0.7, 0.8), (0.2, 1.0)]],
    "E": [[(0.8, 0.0), (0.2, 0.0), (0.2, 1.0), (0.8, 1.0)], [(0.2, 0.5), (0.65, 0.5)]],
    "F": [[(0.2, 1.0), (0.2, 0.0), (0.8, 0.0)], [(0.2, 0.5), (0.65, 0.5)]],
    "G": [[(0.8, 0.2), (0.4, 0.0), (0.1, 0.5), (0.4, 1.0), (0.8, 0.9), (0.8, 0.5), (0.5, 0.5)]],
    "H": [[(0.2, 0.0), (0.2, 1.0)], [(0.8, 0.0), (0.8, 1.0)], [(0.2, 0.5), (0.8, 0.5)]],
    "I": [[(0.5, 0.0), (0.5, 1.0)], [(0.25, 0.0), (0.75, 0.0)], [(0.25, 1.0), (0.75, 1.0)]],
    "J": [[(0.3, 0.0), (0.8, 0.0)], [(0.6, 0.0), (0.6, 0.8), (0.3, 1.0), (0.1, 0.8)]],
    "K": [[(0.2, 0.0), (0.2, 1.0)], [(0.8, 0.0), (0.2, 0.5)], [(0.35, 0.4), (0.8, 1.0)]],
    "L": [[(0.2, 0.0), (0.2, 1.0), (0.8, 1.0)]],
    "M": [[(0.1, 1.0), (0.1, 0.0), (0.5, 0.6), (0.9, 0.0), (0.9, 1.0)]],
    "N": [[(0.2, 1.0), (0.2, 0.0), (0.8, 1.0), (0.8, 0.0)]],
    "O": [[(0.5, 0.0), (0.1, 0.4), (0.1, 0.6), (0.5, 1.0), (0.9, 0.6), (0.9, 0.4), (0.5, 0.0)]],
    "P": [[(0.2, 1.0), (0.2, 0.0)], [(0.2, 0.0), (0.8, 0.2), (0.7, 0.5), (0.2, 0.5)]],
    "Q": [[(0.5, 0.0), (0.1, 0.4), (0.1, 0.6), (0.5, 1.0), (0.9, 0.6), (0.9, 0.4), (0.5, 0.0)], [(0.6, 0.8), (0.9, 1.0)]],
    "R": [[(0.2, 1.0), (0.2, 0.0)], [(0.2, 0.0), (0.8, 0.2), (0.7, 0.5), (0.2, 0.5)], [(0.4, 0.5), (0.8, 1.0)]],
    "S": [[(0.8, 0.2), (0.4, 0.0), (0.2, 0.3), (0.8, 0.7), (0.6, 1.0), (0.2, 0.9)]],
    "T": [[(0.5, 0.0), (0.5, 1.0)], [(0.1, 0.0), (0.9, 0.0)]],
    "U": [[(0.2, 0.0), (0.2, 0.8), (0.5, 1.0), (0.8, 0.8), (0.8, 0.0)]],
    "V": [[(0.1, 0.0), (0.5, 1.0), (0.9, 0.0)]],
    "W": [[(0.1, 0.0), (0.3, 1.0), (0.5, 0.4), (0.7, 1.0), (0.9, 0.0)]],
    "X": [[(0.2, 0.0), (0.8, 1.0)], [(0.8, 0.0), (0.2, 1.0)]],
    "Y": [[(0.2, 0.0), (0.5, 0.5), (0.8, 0.0)], [(0.5, 0.5), (0.5, 1.0)]],
    "Z": [[(0.2, 0.0), (0.8, 0.0), (0.2, 1.0), (0.8, 1.0)]],
    "Ä": [[(0.1, 1.0), (0.5, 0.0), (0.9, 1.0)], [(0.25, 0.6), (0.75, 0.6)], [(0.35, -0.15), (0.37, -0.13)], [(0.65, -0.15), (0.67, -0.13)]],
    "Ö": [[(0.5, 0.0), (0.1, 0.4), (0.1, 0.6), (0.5, 1.0), (0.9, 0.6), (0.9, 0.4), (0.5, 0.0)], [(0.35, -0.15), (0.37, -0.13)], [(0.65, -0.15), (0.67, -0.13)]],
    "Ü": [[(0.2, 0.0), (0.2, 0.8), (0.5, 1.0), (0.8, 0.8), (0.8, 0.0)], [(0.35, -0.15), (0.37, -0.13)], [(0.65, -0.15), (0.67, -0.13)]],

    # Ziffern 0-9 mit deutlicher Unterscheidung (3 vs 6 etc.)
    "0": [[(0.5, 0.0), (0.1, 0.4), (0.1, 0.6), (0.5, 1.0), (0.9, 0.6), (0.9, 0.4), (0.5, 0.0)], [(0.3, 0.7), (0.7, 0.3)]],
    "1": [[(0.25, 0.25), (0.5, 0.0), (0.5, 1.0)], [(0.25, 1.0), (0.75, 1.0)]],
    "2": [[(0.2, 0.2), (0.5, 0.0), (0.8, 0.2), (0.2, 0.9), (0.8, 0.9)]],
    "3": [[(0.2, 0.0), (0.8, 0.0), (0.4, 0.4), (0.8, 0.6), (0.7, 1.0), (0.2, 0.9)]],
    "4": [[(0.7, 0.0), (0.15, 0.65), (0.9, 0.65)], [(0.7, 0.0), (0.7, 1.0)]],
    "5": [[(0.8, 0.0), (0.25, 0.0), (0.2, 0.45), (0.7, 0.5), (0.8, 0.8), (0.3, 1.0)]],
    "6": [[(0.7, 0.0), (0.2, 0.5), (0.2, 0.85), (0.5, 1.0), (0.8, 0.85), (0.8, 0.55), (0.2, 0.55)]],
    "7": [[(0.1, 0.0), (0.85, 0.0), (0.4, 1.0)], [(0.25, 0.5), (0.65, 0.5)]],
    "8": [[(0.5, 0.45), (0.25, 0.2), (0.5, 0.0), (0.75, 0.2), (0.5, 0.45), (0.2, 0.75), (0.5, 1.0), (0.8, 0.75), (0.5, 0.45)]],
    "9": [[(0.5, 0.5), (0.2, 0.3), (0.5, 0.0), (0.8, 0.25), (0.8, 0.8), (0.4, 1.0), (0.2, 0.9)]],

    # Satzzeichen & Symbole
    " ": [],
    ".": [[(0.45, 0.9), (0.5, 0.92)]],
    ",": [[(0.5, 0.85), (0.4, 1.05)]],
    "!": [[(0.5, 0.0), (0.5, 0.7)], [(0.5, 0.9), (0.52, 0.92)]],
    "?": [[(0.2, 0.2), (0.5, 0.0), (0.8, 0.2), (0.5, 0.5), (0.5, 0.7)], [(0.5, 0.9), (0.52, 0.92)]],
    "-": [[(0.2, 0.5), (0.8, 0.5)]],
    "+": [[(0.5, 0.2), (0.5, 0.8)], [(0.2, 0.5), (0.8, 0.5)]],
    "=": [[(0.2, 0.4), (0.8, 0.4)], [(0.2, 0.65), (0.8, 0.65)]],
    ":": [[(0.5, 0.3), (0.52, 0.32)], [(0.5, 0.85), (0.52, 0.87)]],
    "/": [[(0.2, 1.0), (0.8, 0.0)]],
    "*": [[(0.5, 0.3), (0.5, 0.7)], [(0.3, 0.4), (0.7, 0.6)], [(0.3, 0.6), (0.7, 0.4)]],
    "(": [[(0.6, 0.0), (0.3, 0.5), (0.6, 1.0)]],
    ")": [[(0.4, 0.0), (0.7, 0.5), (0.4, 1.0)]],
    "@": [[(0.7, 0.7), (0.5, 0.8), (0.3, 0.5), (0.5, 0.3), (0.7, 0.5), (0.7, 0.8), (0.3, 1.0), (0.1, 0.5), (0.4, 0.1), (0.8, 0.2)]],
    "#": [[(0.35, 0.1), (0.35, 0.9)], [(0.65, 0.1), (0.65, 0.9)], [(0.15, 0.35), (0.85, 0.35)], [(0.15, 0.65), (0.85, 0.65)]],
    "%": [[(0.2, 0.9), (0.8, 0.1)], [(0.3, 0.25), (0.35, 0.27)], [(0.65, 0.75), (0.7, 0.77)]],
    "^": [[(0.2, 0.4), (0.5, 0.1), (0.8, 0.4)]],
    "_": [[(0.1, 0.95), (0.9, 0.95)]],
    "<": [[(0.8, 0.2), (0.2, 0.5), (0.8, 0.8)]],
    ">": [[(0.2, 0.2), (0.8, 0.5), (0.2, 0.8)]],
    "{": [[(0.7, 0.1), (0.4, 0.2), (0.4, 0.45), (0.2, 0.5), (0.4, 0.55), (0.4, 0.8), (0.7, 0.9)]],
    "}": [[(0.3, 0.1), (0.6, 0.2), (0.6, 0.45), (0.8, 0.5), (0.6, 0.55), (0.6, 0.8), (0.3, 0.9)]],
    "'": [[(0.5, 0.05), (0.45, 0.25)]],
    "β": [[(0.2, 1.2), (0.2, 0.1)], [(0.2, 0.1), (0.7, 0.25), (0.6, 0.55), (0.2, 0.55)], [(0.2, 0.55), (0.8, 0.75), (0.6, 1.0), (0.2, 1.0)]],
    "~": [[(0.2, 0.5), (0.4, 0.35), (0.6, 0.65), (0.8, 0.5)]],
    "√": [[(0.1, 0.6), (0.25, 0.9), (0.45, 0.1), (0.9, 0.1)]],
    "∫": [[(0.7, 0.1), (0.5, 0.1), (0.4, 0.4), (0.4, 0.7), (0.3, 0.9), (0.1, 0.9)]],
    "∑": [[(0.8, 0.1), (0.2, 0.1), (0.5, 0.5), (0.2, 0.9), (0.8, 0.9)]],
    "π": [[(0.15, 0.3), (0.85, 0.3)], [(0.3, 0.3), (0.3, 0.9)], [(0.7, 0.3), (0.7, 0.9)]],
    "λ": [[(0.2, 0.9), (0.7, 0.1)], [(0.5, 0.4), (0.8, 0.9)]],
    "α": [[(0.8, 0.3), (0.3, 0.9), (0.1, 0.6), (0.3, 0.3), (0.8, 0.9)]],
}

# Stark erweiterter Grundwortschatz für Notizen, Studium, Wissenschaft, Alltag und Technik
SAMPLE_WORDS = [
    # Allgemeine Begriffe & Notizen
    "Notiz", "Aufgabe", "Projekt", "Idee", "Treffen", "Wichtig", "Datum", "Ziel",
    "Haus", "Buch", "Schule", "Arbeit", "Code", "Test", "Fehler", "Version",
    "heute", "morgen", "gestern", "gut", "sehr", "machen", "sehen", "haben", "sein",
    "und", "oder", "aber", "wenn", "dann", "nicht", "ein", "eine", "das", "der", "die",
    "Plan", "Zeile", "Stift", "Farbe", "Text", "Karte", "Wort", "Seite", "Skizze",
    "Thema", "Kapitel", "Frage", "Antwort", "Woche", "Monat", "Jahr", "Stunde",
    "Lösung", "Größe", "Häuser", "Straße", "Über", "Öl", "Bäume", "schön", "Punkt",
    # Wochentage & Monate
    "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag",
    "Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September",
    "Oktober", "November", "Dezember", "Prüfung", "Lernen", "Übung", "Formel",
    # MINT / Naturwissenschaft & Technik
    "Physik", "Chemie", "Biologie", "Mathe", "Informatik", "Energie", "Masse", "Kraft",
    "Druck", "Geschwindigkeit", "Beschleunigung", "Strom", "Spannung", "Widerstand",
    "Frequenz", "Temperatur", "Molekül", "Atom", "Elektron", "Proton", "Neutron",
    "Funktion", "Gleichung", "Variable", "Konstante", "Ableitung", "Integral", "Vektor",
    "Matrix", "System", "Algorithmus", "Daten", "Speicher", "Prozessor", "Netzwerk",
    "Tabelle", "Diagramm", "Kurve", "Graph", "Achse", "Maximum", "Minimum", "Grenzwert",
    # Zahlen, Einheiten & Abkürzungen
    "123", "456", "789", "2026", "100%", "Nr.1", "A+B", "x=y", "1+2=3", "10:30",
    "z.B.", "bzw.", "ca.", "Dr.", "Prof.", "Status:OK", "#1", "@Home",
    "sin", "cos", "tan", "lim", "log", "exp", "dx", "dt", "f(x)", "y=mx+b",
    "kg", "km/h", "m/s", "kW", "MHz", "GHz", "GB", "MB", "EUR", "USD",
]

MATH_FORMULAS = [
    "f(x)=x^2", "a^2+b^2=c^2", "E=mc^2", "y=2x+1", "x_1,2", "A=π*r^2",
    "F=m*a", "v=s/t", "x>0", "x<5", "a~b", "√x", "√{a+b}", "∫f(x)dx",
    "∑x_i", "α+β=90", "λ=c/f", "x={1,2}", "f'(x)=0", "2*π*r", "sin(x)",
    "cos(α)", "lim_{x->0}", "1/2", "3/4", "x/y", "a/b=c/d", "x^3-x=0",
    "N={0,1,2}", "V=a*b*c", "U=2πr", "pH=-log[H+]", "T_1<T_2", "z=x+iy",
    "P=U*I", "W=F*s", "p*V=n*R*T", "F_G=m*g", "c=√(a^2+b^2)", "e^(i*π)+1=0"
]


# Alternative Glyphen-Varianten (z. B. Einstrich-Schrift, Schreibschrift-Elemente, verschiedene Ziffernstile)
GLYPH_VARIANTS = {
    "w": [
        [[(0.1, 0.3), (0.3, 0.9), (0.5, 0.4), (0.7, 0.9), (0.9, 0.3)]],
    ],
    "a": [
        [[(0.8, 0.3), (0.4, 0.2), (0.1, 0.5), (0.3, 0.9), (0.7, 0.8), (0.8, 0.3), (0.8, 0.9)]],
    ],
    "d": [
        [[(0.8, 0.0), (0.8, 0.9), (0.5, 0.9), (0.2, 0.6), (0.4, 0.3), (0.8, 0.4)]],
    ],
    "u": [
        [[(0.2, 0.3), (0.2, 0.8), (0.5, 0.9), (0.8, 0.8), (0.8, 0.3), (0.8, 0.9)]],
    ],
    "t": [
        [[(0.4, 0.1), (0.4, 0.85), (0.6, 0.9)], [(0.2, 0.3), (0.7, 0.3)]],
    ],
    "1": [
        [[(0.5, 0.0), (0.5, 1.0)]],
    ],
    "7": [
        [[(0.1, 0.0), (0.85, 0.0), (0.4, 1.0)]],
    ],
    "l": [
        [[(0.3, 0.0), (0.3, 0.85), (0.55, 0.9)]],
    ],
}


def interpolate_points(p0: Tuple[float, float], p1: Tuple[float, float], step: float) -> List[Tuple[float, float]]:
    dx = p1[0] - p0[0]
    dy = p1[1] - p0[1]
    dist = math.hypot(dx, dy)
    if dist < step:
        return [p1]
    count = max(1, int(dist / step))
    pts = []
    for i in range(1, count + 1):
        t = i / count
        pts.append((p0[0] + dx * t, p0[1] + dy * t))
    return pts


def rotate_point(x: float, y: float, angle_rad: float, cx: float, cy: float) -> Tuple[float, float]:
    """Rotiert Punkt um ein Zentrum (cx, cy)."""
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)
    nx = cx + (x - cx) * cos_a - (y - cy) * sin_a
    ny = cy + (x - cx) * sin_a + (y - cy) * cos_a
    return nx, ny


def generate_word_strokes(
    word: str,
    step: float = 0.05,
    jitter: float = 0.02,
    rotation_deg: float = 0.0,
    speed_factor: float = 1.0,
) -> List[List[Tuple[float, float]]]:
    """Generiert stochastisch variierte Striche für ein Wort oder eine Formel mit hoher Diversität."""
    strokes = []
    cursor_x = 0.0
    # Breitere Spanne für Handschrift-Stile: von stark nach links bis stark nach rechts geneigt
    slant = random.uniform(-0.25, 0.3)
    # Höhen- und Breiten-Dehnung pro Schreibinstanz
    scale_y = random.uniform(0.75, 1.25)
    width_mult = random.uniform(0.8, 1.2)
    # Dynamischer Punktabstand (Schreibgeschwindigkeit)
    step_actual = step * random.uniform(0.8, 1.3) * speed_factor

    for char in word:
        if char in GLYPH_VARIANTS and random.random() < 0.45:
            glyph = random.choice(GLYPH_VARIANTS[char])
        else:
            glyph = GLYPH_STROKES.get(char, GLYPH_STROKES.get("c"))
        char_width = (0.6 if char != " " else 0.4) * width_mult
        char_jitter = jitter * random.uniform(0.6, 1.4)

        for raw_stroke in glyph:
            if not raw_stroke:
                continue
            stroke_pts = []
            for idx, pt in enumerate(raw_stroke):
                x = cursor_x + pt[0] * char_width + (pt[1] * slant) + random.gauss(0, char_jitter)
                y = pt[1] * scale_y + random.gauss(0, char_jitter)
                if idx == 0:
                    stroke_pts.append((x, y))
                else:
                    prev = stroke_pts[-1]
                    stroke_pts.extend(interpolate_points(prev, (x, y), step_actual))
            if stroke_pts:
                strokes.append(stroke_pts)

        cursor_x += char_width + random.uniform(0.03, 0.16)

    if abs(rotation_deg) > 0.01 and strokes:
        all_pts = [p for s in strokes for p in s]
        if all_pts:
            cx = sum(p[0] for p in all_pts) / len(all_pts)
            cy = sum(p[1] for p in all_pts) / len(all_pts)
            rad = math.radians(rotation_deg)
            rotated_strokes = []
            for s in strokes:
                rotated_strokes.append([rotate_point(p[0], p[1], rad, cx, cy) for p in s])
            strokes = rotated_strokes

    return strokes


def strokes_to_features(strokes: List[List[Tuple[float, float]]]) -> List[Tuple[float, float, float]]:
    """Wandelt Striche in [dx, dy, pen_down] Sequenz um (identisch zum Web-Preprocessor)."""
    if not strokes:
        return []

    all_pts = [pt for s in strokes for pt in s]
    if not all_pts:
        return []
    min_y = min(p[1] for p in all_pts)
    max_y = max(p[1] for p in all_pts)
    height = max(0.1, max_y - min_y)
    scale = 1.0 / height

    features = []
    last_x, last_y = None, None

    for stroke in strokes:
        if not stroke:
            continue
        first_pt = stroke[0]
        if last_x is not None and last_y is not None:
            dx = (first_pt[0] - last_x) * scale
            dy = (first_pt[1] - last_y) * scale
            features.append((dx, dy, 0.0))

        last_x, last_y = first_pt[0], first_pt[1]

        for pt in stroke[1:]:
            dx = (pt[0] - last_x) * scale
            dy = (pt[1] - last_y) * scale
            features.append((dx, dy, 1.0))
            last_x, last_y = pt[0], pt[1]

    return features


def random_sample() -> Tuple[List[Tuple[float, float, float]], str]:
    """Erzeugt ein zufälliges Sample (Wort, Zahl, Symbolkombination oder mathematischer Ausdruck)."""
    mode = random.random()
    if mode < 0.45:
        # Normales Wort
        text = random.choice(SAMPLE_WORDS)
    elif mode < 0.70:
        # Mathematische Formel / Ausdruck
        text = random.choice(MATH_FORMULAS)
    elif mode < 0.88:
        # Reines Zahlen- oder Datums-Sample (stärkt Ziffernerkennung!)
        num_type = random.randint(1, 4)
        if num_type == 1:
            text = str(random.randint(0, 9999))
        elif num_type == 2:
            text = f"{random.randint(1, 31)}.{random.randint(1, 12)}."
        elif num_type == 3:
            text = f"{random.randint(10, 99)}%"
        else:
            text = f"{random.randint(1, 9)}+{random.randint(1, 9)}={random.randint(2, 18)}"
    else:
        # Kurze Wortkombination oder Satzzeichen
        w1 = random.choice(SAMPLE_WORDS)
        punct = random.choice([".", "!", "?", ":", ""])
        text = f"{w1}{punct}"

    # Zufällige Drehung/Schräglage (-15° bis +15°) zur Robustheitssteigerung
    rot = random.uniform(-15.0, 15.0) if random.random() < 0.5 else 0.0
    strokes = generate_word_strokes(text, rotation_deg=rot)
    features = strokes_to_features(strokes)
    return features, text


if __name__ == "__main__":
    feat, text = random_sample()
    print(f"Sample erzeugt für '{text}': {len(feat)} Zeitschritte")
