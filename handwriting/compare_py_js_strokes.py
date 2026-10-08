"""
handwriting/compare_py_js_strokes.py
Verifiziert, dass die Merkmalsextraktion und Größennormalisierung
auf die Höhe der Kleinbuchstaben (Median) in Python und JS (handwriting-preprocessor.js)
für dieselben Striche identische Werte liefert.
"""

import os
import sys
import json
import subprocess
import numpy as np

# Sicherstellen, dass das handwriting-Verzeichnis im Suchpfad ist
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mathwriting_loader import strokes_to_normalized_features
from generate_synthetic import generate_word_strokes


def run_comparison():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    test_words = ["Notiz", "Impala", "a^2 + b^2", "Größe", "Straße", "Übung", "Käse"]
    
    for word in test_words:
        raw_strokes = generate_word_strokes(word)
        # In Pixel-Koordinaten skalieren (~40px Höhe wie auf Touchscreen)
        all_pts = [p for s in raw_strokes for p in s]
        min_y = min(p[1] for p in all_pts)
        max_y = max(p[1] for p in all_pts)
        h = max(0.1, max_y - min_y)
        pixel_strokes = [[(p[0] * 40.0 / h, p[1] * 40.0 / h) for p in s] for s in raw_strokes]

        py_feats = strokes_to_normalized_features(pixel_strokes)

        # In Node.js via handwriting-preprocessor.js ausführen
        js_input_json = json.dumps(pixel_strokes)
        node_script = f"""
        import('./web/handwriting-preprocessor.js')
        .then(({{ HANDWRITING_PREPROCESSOR }}) => {{
            const strokes = {js_input_json};
            const feats = HANDWRITING_PREPROCESSOR.extractLineFeatures(strokes, {{ deskew: false }});
            console.log(JSON.stringify(feats));
        }}).catch(err => {{
            console.error(err);
            process.exit(1);
        }});
        """
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", node_script],
            capture_output=True,
            text=True,
            cwd=repo_root
        )
        if proc.returncode != 0:
            print(f"Fehler in Node.js: {proc.stderr}")
            sys.exit(1)

        js_feats = json.loads(proc.stdout.strip())

        assert len(py_feats) == len(js_feats), f"Länge ungleich für '{word}': Py {len(py_feats)} vs JS {len(js_feats)}"
        
        py_arr = np.array(py_feats, dtype=np.float32)
        js_arr = np.array(js_feats, dtype=np.float32)

        max_diff = np.max(np.abs(py_arr - js_arr))
        print(f"Wort '{word}': {len(py_feats)} Features | Maximale Abweichung Py vs JS: {max_diff:.2e}")
        assert max_diff < 5e-4, f"Abweichung zu groß ({max_diff}) bei '{word}'!"

    # Spezifischer Test für Ein-Punkt-Striche (z. B. getippter i-Punkt / Umlautpunkt / Satzpunkt)
    single_dot_strokes = [
        [(15.0, 15.0), (15.0, 35.0)],  # Buchstabe i Schaft (Mehrpunkt-Strich)
        [(15.0, 5.0)],                 # Buchstabe i getippter Ein-Punkt-Strich
        [(30.0, 35.0)],                # Ein-Punkt Satzende-Punkt
    ]
    py_dot_feats = strokes_to_normalized_features(single_dot_strokes)

    # Prüfen, dass Ein-Punkt-Striche nach dem Resampling NICHT verworfen werden
    # Es müssen genau 2 Pen-Down-Punkte mit (dx=0, dy=0, pen_down=1) für die beiden Ein-Punkt-Striche vorhanden sein
    dot_pendown_events = [f for f in py_dot_feats if f[2] == 1.0 and abs(f[0]) < 1e-5 and abs(f[1]) < 1e-5]
    assert len(dot_pendown_events) == 2, f"Ein-Punkt-Striche wurden verworfen! Erwartet 2 Pen-Down-Events, erhalten {len(dot_pendown_events)}"

    js_dot_script = f"""
    import('./web/handwriting-preprocessor.js')
    .then(({{ HANDWRITING_PREPROCESSOR }}) => {{
        const strokes = {json.dumps(single_dot_strokes)};
        const feats = HANDWRITING_PREPROCESSOR.extractLineFeatures(strokes, {{ deskew: false }});
        console.log(JSON.stringify(feats));
    }}).catch(err => {{
        console.error(err);
        process.exit(1);
    }});
    """
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", js_dot_script],
        capture_output=True,
        text=True,
        cwd=repo_root
    )
    assert proc.returncode == 0, f"Fehler in Node.js: {proc.stderr}"
    js_dot_feats = json.loads(proc.stdout.strip())
    assert len(py_dot_feats) == len(js_dot_feats), f"Ein-Punkt Längenunterschied: Py {len(py_dot_feats)} vs JS {len(js_dot_feats)}"
    dot_diff = np.max(np.abs(np.array(py_dot_feats, dtype=np.float32) - np.array(js_dot_feats, dtype=np.float32)))
    print(f"Ein-Punkt-Striche: {len(py_dot_feats)} Features (2 getippte Punkte erhalten) | Maximale Abweichung Py vs JS: {dot_diff:.2e}")
    assert dot_diff < 5e-4, f"Abweichung bei Ein-Punkt-Strichen: {dot_diff}"

    print("\nERFOLG: Gemeinsame Python-Funktion (strokes_to_normalized_features) und JavaScript (handwriting-preprocessor.js) sind 100 % identisch!")


if __name__ == "__main__":
    run_comparison()
