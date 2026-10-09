# Handschrifterkennung (Digital Ink) für Impala67

Lokale, kostenlose Erkennung der Stift-Vektordaten aus der Heft-Ansicht (`web/heft.js`). Kein Cloud-Dienst, kein API-Schlüssel, läuft offline im Browser.

## Pipeline

```
web/heft.js (Striche)
  → web/handwriting-preprocessor.js  Zeilentrennung (segmentLines, Skizzen-Filter), Resampling,
                                     Normierung auf Median-Strichhöhe, Features [dx, dy, pen_down, y_rel]
  → web/handwriting-worker.js        ONNX Runtime Web (WASM), Modell: web/handwriting-model.onnx
  → web/handwriting-ctc.js           Greedy-CTC + Wörterbuch-Korrektur (handwriting-words-de.js, nicht bei Formeln)
  → web/heft-indexer.js              Hintergrund-Erkennung aller Seiten → Suche/RAG
```

- **Modell** (`model.py`): 1D-CNN + 3× BiLSTM (192) + CTC, ca. 1,8 Mio. Parameter, ~10 MB ONNX.
- **Vokabular** (`vocabulary.py/.json`): 86 Token (a–z, A–Z, Umlaute, ß, Ziffern, Satz- und Mathezeichen, Blank = 0).
- **Neu-Erkennung**: Neues Modell → `web/handwriting-model-version.js`; geänderte Vorverarbeitung → `RECOGNIZER_REVISION` in `web/heft-indexer.js` erhöhen.

## Dateien

| Datei | Zweck |
| :--- | :--- |
| `train.py` | Training + ONNX-Export nach `model.onnx` (nicht in Git); `--publish` kopiert nach `web/` |
| `train_colab.ipynb` | **Empfohlener Weg**: kostenlose T4-GPU, Daten/Checkpoints in Drive (`Impala67-Handschrift/`) |
| `evaluate_user_benchmark_words.py` | Benchmark auf eigener Handschrift (TEST-/AUSWAHL-CER) |
| `evaluate_checkpoints.py` | Vergleich Basis vs. Feintuning (inkl. fremde Schreiber) |
| `samples_loader.py` | Eigene Abschreib-Zeilen (`my_handwriting_samples.json`) laden, Benchmark-Texte schützen |
| `brush_loader.py`, `mathwriting_loader.py`, `uji_loader.py` | Datensatz-Loader |
| `generate_synthetic.py`, `font_sampler.py`, `text_corpus.py`, `augmentations.py` | Synthetische Daten, Texte (`dictionary_de.txt`), Augmentierung |

## Ablauf

1. In der App **Einstellungen → Abschreiben**: Zeilen mit dem Stift abschreiben, `my_handwriting_samples.json` exportieren und in Drive (`Impala67-Handschrift/`) legen. Eigene Handschrift nie auf GitHub.
2. `train_colab.ipynb` ausführen (Standard: Feintuning ab `best.pt`). `best.pt` wird nach AUSWAHL-CER gewählt, nie nach TEST-CER.
3. `model.onnx` lokal nach `handwriting/` legen, prüfen und übernehmen:

```bash
python evaluate_user_benchmark_words.py model.onnx
```

```bash
python train.py --publish
```

Ohne Argument prüft der Benchmark das ausgelieferte App-Modell (`web/handwriting-model.onnx`). Alternativ `model.onnx` von Hand nach `web/handwriting-model.onnx` kopieren.

## Trainingsdaten

| Datensatz | Lizenz | Anteil |
| :--- | :--- | :--- |
| BRUSH (170 Schreiber) | Lizenz noch prüfen (vor Weitergabe des Modells) | ~40 % |
| Google MathWriting | CC BY 4.0 | ~20 % |
| Synthetisch + UJI Pen Characters v2 | OFL-Fonts / frei (UCI) | ~10 % |
| Eigene Abschreib-Zeilen (augmentiert) | eigene Daten | ~30 % |

IAM-OnDB und IBM-UB-1 werden wegen ihrer Lizenzen **nicht** verwendet. Voller MathWriting-Datensatz (3,1 GB) unter `data/mw_download/`:

```bash
curl -L --create-dirs -o data/mw_download/mathwriting-2024.tgz https://storage.googleapis.com/mathwriting_data/mathwriting-2024.tgz
```

```bash
tar -xzf data/mw_download/mathwriting-2024.tgz -C data/mw_download
```

## Messwerte-Verlauf (eigene Handschrift)

| Stand | TEST-CER | Bemerkung |
| :--- | :---: | :--- |
| Basismodell (4 Features seit v2.2.24) | 44,7 % | ohne eigene Handschrift |
| 1. Feintuning (`7c16cc4`) | 21,0 % | eigene Abschreib-Zeilen |
| 2. Feintuning, 206 Zeilen (`cb1f1d1`) | **5,5 %** | AUSWAHL-CER 11,4 %, gesamt 9,7 % |

- TEST = ungerade, unberührte Benchmark-Zeilen; AUSWAHL = gerade Zeilen (Checkpoint-Wahl).
- Ältere Messung (07.10., 3 Features, anderer Testsatz mit 121 Proben): 14,5 % CER – nicht vergleichbar.
- Rest-Fehler: einzelne Buchstaben-Verwechslungen (z. B. „läuft“ → „Läutt“). Echte Heftseiten sind schwerer als Abschreib-Zeilen.
- Nächste Schritte: echte Heftseiten per MCP beschriften (`impala_heft_label_lines`) als Benchmark und Trainingsdaten; erst danach Beam-Search.
