# Lokale Handschrifterkennung (Digital Ink Recognition)

## 1. Ziel des Projekts

Entwicklung einer **vollständig lokalen, geräteübergreifenden und lizenzfreien Handschrifterkennung** für Impala67 (`web/heft.js`).

Statt teurer oder plattformgebundener Lösungen (wie Google ML Kit auf Android oder Apple Scribble auf iOS) und statt überdimensionierter Cloud-Vision-LLMs nutzen wir die **echten Vektordaten des Stifts** ($x, y, t$, Pen-Down/Up).

---

## 2. Kernprinzipien & Strategie (Pragmatischer Ansatz)

1. **Rechtlich saubere & maßgeschneiderte Trainingsdaten:**
   - **Synthetische Daten:** Generiert aus offenen Vektor-Schriften (OFL / Google Fonts) mit realistischem Strich-Jitter, variablen Strichstärken und Neigung.
   - **In-App Datensammler ("Human-in-the-loop"):** Nutzer können handgeschriebene Wörter/Zeilen in der Heft-Ansicht korrigieren und als Trainingsbeispiel speichern. So lernt das Modell mit der Zeit gezielt die eigene Handschrift.
   - *Kein Lizenzrisiko:* Keine Abhängigkeit von proprietären oder akademisch beschränkten Datensätzen (wie IAM-OnDB) in veröffentlichten Modellen.

2. **Kostenloses Training (Google Colab / Kaggle):**
   - Bereitstellung eines schlüsselfertigen Jupyter Notebooks (`train_colab.ipynb`), das kostenlos auf einer T4/V100-GPU in Colab läuft.
   - Das fertig trainierte Modell (`model.onnx`, ca. 3–6 MB) wird als statische Asset-Datei via GitHub Pages ausgeliefert. **0 € Betriebskosten.**

3. **Einfacher, iterativer Start:**
   - Fokus zuerst auf **Einzelwörter und einzelne Textzeilen** statt chaotischer Ganzseiten-Layouts.
   - **Lazy Loading:** `onnxruntime-web` und die Modelldatei werden erst beim ersten Erkennungsversuch geladen und im Browser-Cache gecacht. Der normale App-Start bleibt 0 ms verzögert.
   - **Wörterbuch-Korrektur:** Post-Processing gleicht erkannte Zeichenfolgen mit einer deutschen Wortliste ab, um geometrisch ähnliche Zeichen (z. B. `rn` vs `m`, `cl` vs `d`, `o` vs `0`) aufzulösen.

---

## 3. Architektur-Übersicht

```
[ web/heft.js (Canvas-Striche: pts [x, y, p]) ]
                      │
                      ▼
        [ web/handwriting-preprocessor.js ]
   (Resampling auf äquidistante Punkte, Delta-Features [dx, dy, pen_down])
                      │
                      ▼
         [ web/handwriting-worker.js ]
   (Lazy Loading von onnxruntime-web & model.onnx via WebAssembly/WebGPU)
                      │
                      ▼
           [ web/handwriting-ctc.js ]
   (Greedy CTC-Decoding + Wörterbuch-Bereinigung)
                      │
                      ▼
         [ Ergebnis: Textnotiz in Impala67 ]
```

---

## 4. Dateien in diesem Verzeichnis

- `vocabulary.py` / `vocabulary.json`: 86 Zeichen (a-z, A-Z, ä, ö, ü, Ä, Ö, Ü, ß, 0-9, Satzzeichen, Blank-Index 0).
- `generate_synthetic.py`: Erzeugt synthetische Vektor-Striche für Wörter und Zeichen.
- `model.py`: 1D-CNN + BiLSTM + CTC-Head (< 5 MB).
- `train.py`: PyTorch CTC-Trainingspipeline mit ONNX-Export. Trainingsdaten werden jede Epoche neu gemischt. Die eigene Benchmark-Handschrift ist geteilt: gerade Zeilen wählen `best.pt`, ungerade bleiben unberührter Test. Ins App-Modell (`web/handwriting-model.onnx`) wird nur mit `python train.py --publish` kopiert. Batches werden nach Länge gebündelt (wenig Padding), die teure Echt-Auswertung läuft nur alle 3 Epochen. Nach einem Abbruch setzt `train.py` automatisch bei `checkpoints/last.pt` fort (für ein neues Training von vorn `last.pt` löschen); `HW_CHECKPOINT_DIR` legt den Ordner fest.
- `train_colab.ipynb`: **Empfohlener Trainingsweg.** Kostenlose T4-GPU in Google Colab, holt Repo und Daten selbst, sichert alles in Google Drive (`Impala67-Handschrift/`). Lokal (`.venv_rocm`, RX 9060 XT) ist das Training unter Windows instabil (MIOpen-Absturz), auf der CPU dauert ein Batch ~40 s.
- `text_corpus.py`: Deutsche Trainingstexte aus `dictionary_de.txt` (Wörter, Zeilen, Zahlen).
- `uji_loader.py`: Setzt echte UJI-Glyphen zu Zeilen zusammen (ein Schreiber pro Zeile). ä/ö/Ä/Ö entstehen aus echtem a/o/A/O plus echten Umlautpunkten aus UJI-ü/Ü.
- `mathwriting_loader.py`: Nutzt den vollen MathWriting-Datensatz unter `data/mw_download/mathwriting-2024/`, sonst den Auszug. Labels, die nicht verlustfrei ins Vokabular passen, werden verworfen.

### Trainingsdaten und Lizenzen

| Datensatz | Lizenz | Verwendung |
| :--- | :--- | :--- |
| Google MathWriting | CC BY 4.0 | Formeln, Ziffern, Buchstabenformen |
| UJI Pen Characters v2 | frei (UCI) | Echte Einzelzeichen von 60 Schreibern |
| IAM-OnDB | nur nicht-kommerziell, Registrierung | **nicht verwendet** |
| IBM-UB-1 | keine öffentliche Lizenz | **nicht verwendet** |

Vollen MathWriting-Datensatz laden (3,1 GB) und entpacken:

```bash
curl -L --create-dirs -o data/mw_download/mathwriting-2024.tgz https://storage.googleapis.com/mathwriting_data/mathwriting-2024.tgz
tar -xzf data/mw_download/mathwriting-2024.tgz -C data/mw_download
```
- `train_colab.ipynb`: Fertiges Notebook für kostenloses GPU-Training in Google Colab.
- `samples_collector.py`: Hilfsskript zum Importieren von In-App gesammelten Trainingsdaten.
