# Handschrifterkennung (Bild-Modell) für Impala67

Lokale, kostenlose Erkennung der Stift-Striche aus der Heft-Ansicht (`web/heft.js`). Jede Zeile wird als Bild gelesen.
Kein Cloud-Dienst, kein API-Schlüssel, läuft offline im Browser.

## Pipeline

```
web/heft.js (Striche)
  → web/handwriting-preprocessor.js  Zeilentrennung (segmentLines, Skizzen-Filter), Begradigung (deskewLine)
  → web/handwriting-rasterizer.js    Zeile → Graustufenbild, 64 px hoch (gleiche Regeln wie rasterize.py)
  → web/handwriting-worker.js        ONNX Runtime Web (WASM), Modell: web/handwriting-model.onnx
  → web/handwriting-ctc.js           Leerzeichen an großen Strich-Lücken, CTC-Beam-Search + Wörterbuch (nicht bei Formeln)
  → web/handwriting-lexicon.js       jedes Wort zusätzlich entlang echter Wörter lesen (handwriting-lexicon-de.txt, 233.000 Wörter + Endungen)
  → web/heft-indexer.js              Hintergrund-Erkennung aller Seiten → Suche/RAG, Fortschritt in den Einstellungen
```

- **Modell** (`image_model.py`): ResNet18-Stamm (bis layer3) + 1×1-Projektion + 3× BiLSTM-256 + CTC, ca. 10 Mio. Parameter,
  9,7 MB ONNX (Gewichte int8, gerechnet wird in float, daher in ONNX Runtime Web lauffähig).
- **Start**: [de-htr-web-v2](https://huggingface.co/naeyn/de-htr-web-v2) (naeyn, Apache-2.0, trainiert auf ScaDS.AI + fhswf),
  Gewichte per `load_dehtr_onnx` übernommen und auf unser Vokabular abgebildet (`^ ~ √ ∫ ∑ π λ α β` neu).
- **Vokabular** (`vocabulary.py`, `web/handwriting-vocab.js`): 101 Token (Buchstaben, Umlaute, ß, Ziffern, Satz- und Mathezeichen, Blank = 0).
- **Wörterbuch** (`build_lexicon.py` → `web/handwriting-lexicon-de.txt`): aus `dictionary_de.txt` plus den 5.000 häufigsten
  Wörtern; ersetzt eine Lesung nur, wenn das Modell die Wörterbuch-Lesung nicht viel unwahrscheinlicher findet.
- **Neu-Erkennung**: Neues Modell oder Wörterbuch → Version setzt der Release-Workflow automatisch; geänderte Vorverarbeitung →
  `RECOGNIZER_REVISION` in `web/heft-indexer.js` erhöhen.

## Dateien

| Datei | Zweck |
| :--- | :--- |
| `image_model.py` | Modell, Gewichts-Import aus de-htr, int8-Export (`export_image_onnx`) |
| `rasterize.py` | Striche bzw. Punkt-Features → Zeilenbild (muss zu `web/handwriting-rasterizer.js` passen) |
| `train_image.py` | Feintuning: Formeln lernen, Text behalten; best.pt nur, wenn Text höchstens 1 Punkt schlechter wird |
| `train_image_colab.ipynb` | **Empfohlener Weg**: Colab (L4), Datensätze und Zwischenstände in Drive (`Impala67-Handschrift/`) |
| `image_datasets.py` | ScaDS- und fhswf-Zeilenbilder laden (Cache) |
| `mathwriting_loader.py`, `brush_loader.py` | MathWriting (Training + Messung) und BRUSH (nur Messung: gezeichneter Text fremder Schreiber) |
| `generate_synthetic.py`, `font_sampler.py`, `text_corpus.py`, `augmentations.py` | Gezeichnete Sätze und Rechnungen aus Handschrift-Fonts, Verzerrungen |
| `samples_loader.py` | Eigene Abschreib-Zeilen (`my_handwriting_samples.json`) – nur zum Messen |
| `build_lexicon.py` | Baut `web/handwriting-lexicon-de.txt` (klein geschrieben, sortiert) |
| `evaluate_user_benchmark_words.py` | Benchmark auf eigener Handschrift (TEST-/AUSWAHL-CER) |
| `scads_split.json` | ScaDS-Schreiber für Auswahl/Test, die de-htr nie gesehen hat |

## Ablauf

1. `train_image_colab.ipynb` in Colab öffnen (Datei → Notebook öffnen → GitHub → `handwriting/train_image_colab.ipynb`), L4 wählen, **Alle ausführen**.
   Neuer Lauf: `LAUF` in der Trainingszelle ändern.
2. `best.pt` aus `Impala67-Handschrift/checkpoints-bild/<LAUF>/` nach `checkpoints-image/` legen und exportieren:

```bash
python -c "import torch; from image_model import ImageCRNN, export_image_onnx; m = ImageCRNN(); m.load_state_dict(torch.load('checkpoints-image/best.pt', map_location='cpu', weights_only=False)['model']); export_image_onnx(m, 'model-bild.onnx')"
```

3. Prüfen und übernehmen (ohne Argument misst der Benchmark das ausgelieferte App-Modell):

```bash
python evaluate_user_benchmark_words.py model-bild.onnx
```

```bash
cp model-bild.onnx ../web/handwriting-model.onnx
```

## Trainingsdaten

| Datensatz | Lizenz | Rolle |
| :--- | :--- | :--- |
| ScaDS.AI German Lines (Zenodo 18301532) | CC BY 4.0 | Text (Scans), ~32 % |
| fhswf/german_handwriting | AFL-3.0 | Text (Scans), ~20 % |
| Gezeichnete Sätze aus OFL-Handschrift-Fonts | OFL | Text mit Leerzeichen, ~13 % |
| Google MathWriting | CC BY 4.0 | Formeln, ~28 % |
| Synthetische Rechnungen (Fonts) | OFL | Formeln, ~7 % |
| BRUSH (Schreiber 150–169) | Lizenz noch prüfen | nur Messung |
| Eigene Abschreib-Zeilen | eigene Daten (nie auf GitHub) | nur Messung |

Die Weitergabe des Modells braucht Namensnennung für de-htr-web-v2 (Apache-2.0), ScaDS.AI (CC BY 4.0), fhswf (AFL-3.0) und MathWriting (CC BY 4.0).
IAM, IAM-OnDB, CVL, GoBo und IBM-UB-1 werden wegen ihrer Lizenzen **nicht** verwendet.

## Messwerte

| Stand | TEST-CER (eigene) | Formeln fremd | Text fremd (Scan / Strich) |
| :--- | :---: | :---: | :---: |
| Strich-Modell, 2. Feintuning (`cb1f1d1`, abgelöst) | 5,5 % | – | – |
| de-htr-web-v2 unverändert | – | 62,8 % | 8,38 % / 19,7 % |
| Bild-Modell Lauf 1 (50 % Mathe, ohne gezeichneten Text) | 1,4 % | 14,9 % | 8,79 % / – (Leerzeichen verlernt) |
| **Bild-Modell Lauf 3** | **0,0 %** | **16,0 %** | **8,42 % / 18,0 %** |

- TEST = ungerade Benchmark-Zeilen; „fremd“ = Test-Schreiber, die nie trainiert oder zur Auswahl benutzt wurden.
- Lauf 3 auf den Abschreib-Messzeilen: 5,3 % CER (Strich-Modell mit Feintuning auf genau diese Handschrift: 6,7 %).
- Ohne Training (Okt. 2026, Lauf 3, Decoder der App): großes Wörterbuch und Lücken-Leerzeichen senken die CER.
  Einstellungen nur übernommen, wenn sie auch bei fremden Schreibern helfen oder dort neutral sind
  (Wörterbuch-Vorrang 12 auf ScaDS-Auswahl gewählt, Lücke 32 px auf ScaDS neutral):
  ScaDS-Test-Schreiber 8,1 → 6,3 %, Heft-Mitschriften (`benchmark_notizen.json`) 5,1 → 3,1 %, Abschreib-Zeilen 5,2 → 4,8 %.
  Geprüft und verworfen: Mindesthöhe der Zeile (eigene Schrift besser, fremde Formeln 17 → 21 %), dickere Striche,
  Mittelung über mehrere Renderings, fp32 statt int8 (gleich gut), Ensemble mit Lauf 1 (viel schlechter),
  Komposita-Zerlegung, Schutzregeln für Endungen/Abkürzungen/sichere Zeichen.
- Das frühere Strich-Modell (Punktfolgen, `train.py`) steht im Git-Verlauf bis `269e442`.
