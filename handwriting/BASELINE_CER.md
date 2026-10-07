# Ausgangswert (Baseline): CER des aktuellen Modells

- **Modell:** `model.onnx` (2.97 MB)
- **Datum:** 2026-10-07 11:40:14
- **Pipeline:** Vektor-Digital-Ink (äquidistantes Resampling, 3 Delta-Features) -> ONNX -> Greedy CTC

| Gruppe | Anzahl Samples | Exakt Richtig (Acc) | Gesamt-Distanz | Zeichen gesamt | CER (%) | Ø Latenz (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Buchstaben** | 69 | 34/69 (49.3%) | 36 | 69 | **52.17%** | 0.44 ms |
| **Wörter** | 29 | 28/29 (96.6%) | 1 | 156 | **0.64%** | 1.61 ms |
| **Sätze** | 7 | 0/7 (0.0%) | 30 | 188 | **15.96%** | 7.42 ms |
| **Einzeilige Formeln** | 16 | 13/16 (81.2%) | 4 | 77 | **5.19%** | 1.22 ms |
| **GESAMT** | **121** | **75/121 (62.0%)** | **71** | **490** | **14.49%** | **1.23 ms** |

## Detailanalyse Abweichungen

### Buchstaben (35 Abweichungen von 69)
| Soll | Ist | Levenshtein-Distanz | Latenz |
| :--- | :--- | :---: | :---: |
| `c` | `C` | 1 | 0.3 ms |
| `i` | `T` | 1 | 0.3 ms |
| `j` | `∫` | 1 | 0.4 ms |
| `k` | `K` | 1 | 0.4 ms |
| `o` | `U` | 1 | 0.3 ms |
| `p` | `B` | 1 | 0.6 ms |
| `q` | `a` | 1 | 0.6 ms |
| `r` | `v` | 1 | 0.3 ms |
| `s` | `S` | 1 | 0.4 ms |
| `t` | `T` | 1 | 0.3 ms |
| `x` | `k` | 1 | 0.3 ms |
| `z` | `Z` | 1 | 0.3 ms |
| `D` | `M` | 1 | 0.4 ms |
| `K` | `k` | 1 | 0.4 ms |
| `O` | `U` | 1 | 0.6 ms |
| `P` | `B` | 1 | 0.4 ms |
| `Q` | `U` | 1 | 0.6 ms |
| `R` | `B` | 1 | 0.8 ms |
| `S` | `g` | 1 | 0.5 ms |
| `X` | `W` | 1 | 0.5 ms |
| `Y` | `k` | 1 | 0.3 ms |
| `ä` | `w` | 1 | 0.4 ms |
| `ö` | `Ö` | 1 | 0.3 ms |
| `ü` | `L` | 1 | 0.3 ms |
| `Ä` | `A` | 1 | 0.5 ms |
| `Ö` | `Ö%` | 1 | 0.4 ms |
| `Ü` | `U%` | 2 | 0.5 ms |
| `ß` | `B` | 1 | 0.6 ms |
| `0` | `6` | 1 | 0.5 ms |
| `1` | `k` | 1 | 0.3 ms |
| `3` | `J` | 1 | 0.5 ms |
| `5` | `g` | 1 | 0.4 ms |
| `6` | `G` | 1 | 0.5 ms |
| `7` | `Z` | 1 | 0.5 ms |
| `9` | `D` | 1 | 0.4 ms |

### Wörter (1 Abweichungen von 29)
| Soll | Ist | Levenshtein-Distanz | Latenz |
| :--- | :--- | :---: | :---: |
| `Idee` | `Tdee` | 1 | 1.0 ms |

### Sätze (7 Abweichungen von 7)
| Soll | Ist | Levenshtein-Distanz | Latenz |
| :--- | :--- | :---: | :---: |
| `Das ist ein Test` | `Dasisteintest` | 4 | 2.7 ms |
| `Heute neue Notizen schreiben` | `Heuteneuerotizenschreiben` | 4 | 9.6 ms |
| `Wir planen das nächste Release` | `Wirplanendasnächsteßelease` | 5 | 8.5 ms |
| `Aufgabe für Montag erledigen` | `Aufgabefürnontagerledigen` | 4 | 7.2 ms |
| `Gute Ideen sofort aufschreiben` | `Gutetdeensofortaufschreiben` | 4 | 7.5 ms |
| `Code testen und verbessern` | `Codetestenundverbessern` | 3 | 6.0 ms |
| `Wichtige Notiz für das Meeting` | `Wichtigewotizfürdasneeting` | 6 | 10.4 ms |

### Einzeilige Formeln (3 Abweichungen von 16)
| Soll | Ist | Levenshtein-Distanz | Latenz |
| :--- | :--- | :---: | :---: |
| `y=2x+1` | `y=2x+(` | 1 | 1.6 ms |
| `x<5` | `xcg` | 2 | 0.8 ms |
| `2*3=6` | `2*3=U` | 1 | 1.2 ms |
