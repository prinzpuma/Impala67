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
- `train.py`: PyTorch CTC-Trainingspipeline mit ONNX-Export.
- `train_colab.ipynb`: Fertiges Notebook für kostenloses GPU-Training in Google Colab.
- `samples_collector.py`: Hilfsskript zum Importieren von In-App gesammelten Trainingsdaten.
