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
| `generate_synthetic.py`, `font_sampler.py`, `text_corpus.py`, `augmentations.py` | Synthetische Daten, Texte (`dictionary_de.txt`, mit Fokus auf zuletzt oft falsche Zeichen), Augmentierung |
| `label_noise.py` | Sperrliste für vermutlich falsch beschriftete BRUSH-/MathWriting-Beispiele (`data/label_noise_blocklist.json`) |

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

## Bild-Modell (in Arbeit)

Nachfolger des Strich-Modells: Striche werden als Zeilenbild gelesen (`rasterize.py`). Start ist **de-htr-web-v2**
(naeyn, Apache-2.0, trainiert auf ScaDS.AI CC BY 4.0 + fhswf AFL-3.0), nachgebaut in `image_model.py` mit unserem Vokabular.
Ohne Training liest es deutschen Text schon so gut wie das feingetunte Strich-Modell, Formeln aber kaum.

| Datei | Zweck |
| :--- | :--- |
| `image_model.py` | ResNet18-Stamm + 3× BiLSTM-256 + CTC, Gewichts-Import aus de-htr, int8-Export (nur Gewichte, läuft in ONNX Runtime Web) |
| `rasterize.py` | Striche bzw. Punkt-Features → Graustufenbild 64 px hoch |
| `image_datasets.py` | ScaDS- und fhswf-Zeilenbilder laden (Cache) |
| `train_image.py` | Mathe-Feintuning mit Text-Wiederholung; best.pt nur, wenn Text höchstens 1 Punkt schlechter wird |
| `train_image_colab.ipynb` | Colab-Ablauf inkl. Datensatz-Downloads |
| `scads_split.json` | ScaDS-Schreiber für Auswahl/Test, die de-htr nie gesehen hat |

## Trainingsdaten

| Datensatz | Lizenz | Anteil |
| :--- | :--- | :--- |
| BRUSH (170 Schreiber) | Lizenz noch prüfen (vor Weitergabe des Modells) | ~40 % |
| Google MathWriting | CC BY 4.0 | ~20 % |
| Synthetisch + UJI Pen Characters v2 | OFL-Fonts / frei (UCI) | ~10 % |
| Eigene Abschreib-Zeilen (augmentiert, zur Hälfte als Wort-Collage neu zusammengesetzt) | eigene Daten | ~30 % |

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
