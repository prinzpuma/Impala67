# Impala67 AI – Modell-Finetuning (QLoRA) & Projekt-Log

Dieses Verzeichnis enthält die Werkzeuge, Datensätze, Trainingsskripte und das vollständige Fortschritts- und Diagnose-Protokoll, um kompakte On-Device-Modelle (**Qwen 3.5 4B**) gezielt für Impala67 zu finetunen.

---

## 1. Übersicht & Dateien im Ordner

| Datei | Zweck |
| :--- | :--- |
| **`AGENTS.md`** | Dieses Dokument: Architektur, Zielsetzung, Fortschritts- und Experimente-Log. |
| **`benchmark_suite.py`** | Automatisierte 12-stufige Härtetest-Suite (Long-Context, LaTeX, Patches, Sicherheit, Vision). |
| **`benchmark_report.md`** | Der jeweils zuletzt generierte Messbericht mit detaillierter Tabelle je Szenario. |
| **`generate_dataset.py`** | Erzeugt Trainings- und Validierungsdaten (`data/*.jsonl`, ~150 variierte Beispiele). |
| **`chat_format.py`** | Gemeinsames Rendering mit dem echten Qwen-Template (Tools aus `tool_defs.json`, `arguments` als Dict). |
| **`check_dataset.py`** | Prüft den Datensatz ohne GPU mit dem echten Qwen-Tokenizer (Tools, `<think>`, `<tool_call>`, Länge, Pflichtfelder). |
| **`impala67_qlora_colab.ipynb`** | Google-Colab-Notebook für Unsloth-QLoRA-Training (T4 fp16, A100/L4 bf16). |
| **`train_unsloth.py`** | Lokales Trainingsskript für Nvidia- und AMD-Radeon-GPUs (ROCm unter Windows/Linux). |
| **`export_gguf.py`** | Mergt LoRA-Adapter mit dem Basismodell und exportiert `Q4_K_M.gguf`. |
| **`evaluate.py`** | Schneller 3-Punkte-Funktionstest für Zwischenprüfungen. |
| **`export_fixtures.mjs`** | Holt echte Seiten, Karten und Heftseiten-Bilder nur lesend über die MCP-Bridge nach `data/fixtures/` (gitignored). |
| **`benchmark_agent.py`** | Agenten-Benchmark: mehrstufige Schleife auf echten Daten + Vision, mehrere Läufe je Szenario → `benchmark_agent_report.md`. |

---

## 2. Fortschritts- & Experimente-Log

### Phase 1: Modell-Auswahl & Machbarkeit (2026 Stand)
* **Kandidaten:** Vergleich von *Qwen 3.5 (2B/4B)*, *NVIDIA Nemotron 3.5 Bolt E4B*, *Microsoft Phi-4-mini* und *Ministral 3*.
* **Entscheidung für Qwen 3.5 4B:**
  * Hybrid-Architektur (Gated DeltaNet / Linear Attention) spart bis zu 70 % KV-Cache-RAM bei langen Notizen.
  * Native Multimodalität (Vision/Handschrift direkt im Modell, kein separates Modell nötig).
  * Exzellente deutsche Sprachunterstützung (201 Sprachen) und sehr saubere JSON-Struktur ab Werk.
* **Hardware-Ziele:** Native Android-App (Kotlin/Compose über Rust-Kern) und zukünftige iPadOS-App (M1 / Swift). Kein Web/PWA-Zwang.

### Phase 2: Erste Basismessung & Real-World Stresstests
* **Einfache Tests (300 Tokens Kontext):** 6 von 6 Tests bestanden. Das Basismodell beherrscht Impala-Tools im Kurzkontext fehlerfrei.
* **Stresstest mit echtem Uni-Material:**
  1. *Multimodal-Test (Foto `1755439934431.jpg`):* Das Modell hat alle **21 Modulkarten** auf dem Schreibtisch fehlerfrei entziffert und eine Notiz angelegt. Latenz war mit 818 Thinking-Tokens jedoch spürbar lang (18,1 s).
  2. *Long-Context-Test (4.500 Tokens Festkörperphysik Skript, Prof. Oliver Paul):* **Katastrophaler Schema-Kollaps des Basismodells.** Unter der Textlast vergaß das Modell Pflichtfelder (`title` bei `page.create`), halluzinierte irrelevante Parameter (`limit: 3000000000000000`) und nutzte `card.update` statt `card.create`.
  3. *LaTeX-Test:* Das Modell fiel trotz expliziter Vorgabe auf rohe Unicode-Sonderzeichen (`Σ, δ, q₀`) zurück, statt KaTeX (`$\Sigma, \delta, q_0$`) zu nutzen.
* **Ergebnis der 12-stufigen Benchmark-Suite auf dem Basismodell:** **66,7 % (8 von 12 bestanden)**.

### Phase 3: Colab-Training 1 & Diagnose des EOS-Collapse
* **Training 1:** Ausgeführt in Google Colab auf NVIDIA A100-SXM4-40GB. 120 Schritte auf 17 Beispielen.
* **Ergebnis nach GGUF-Export:** Modell antwortete in LM Studio auf jede Frage in 0,15s mit `finish_reason: "stop"` (Score fiel auf 16,7 %).
* **Ursachen-Analyse (2 fundamentale Fehler):**
  1. *ChatML-Template Bug:* In `make_sample()` war `assistant["content"] = ""`. Standard-ChatML-Jinja ignoriert das Dictionary-Feld `tool_calls` und hat den Assistenten als leeren String formatiert. Das Modell lernte, sofort das Stopp-Token (`<|im_end|>`) zu erzeugen.
  2. *Massives Overfitting:* 120 Schritte mit effektiver Batch-Size 8 = 56 Epochen auf nur 17 Beispielen. Das Modell hat das leere Token unwiderruflich eingebrannt.
* **Umgesetzte Korrekturen:**
  * `generate_dataset.py` formatiert Tool-Calls nun direkt im **Qwen-nativen XML-Format** im Assistenten-Content:
    ```xml
    <tool_call>
    {"name": "change", "arguments": {"operations": [...]}}
    </tool_call>
    ```
  * `max_steps` wurde im Colab-Notebook und in `train_unsloth.py` von 120 auf **35 Schritte** (ca. 3–5 Epochen) herabgesetzt.
  * `impala_tools_train.jsonl` wurde mit dieser sauberen Struktur neu generiert.

### Phase 4: Review vor Training 2 – Template, Masking, Umfang
Die Korrekturen aus Phase 3 reichten nicht. Gefundene Ursachen und Lösungen:
1. **`get_chat_template(..., "chatml")` hat das Qwen-Template ersetzt.** Generisches ChatML rendert das Feld `tools` nicht → das Modell sah im Training nie Tool-Definitionen; außerdem landete das ChatML-Template in der GGUF, sodass LM Studio die Tools falsch formatierte. → Qwen-eigenes Template bleibt; Rendering über `chat_format.render()` mit `tools=`.
2. **Qwen 3.5 nutzt ein XML-Tool-Format** (`<tool_call><function=change><parameter=operations>…`), nicht JSON in `<tool_call>`. Die handgeschriebenen `<tool_call>{json}` aus Phase 3 waren also falsch. → Assistent hat `content: ""` + strukturierte `tool_calls`; `arguments` wird vor dem Rendern zum Dict (das Template iteriert über die Parameter).
3. **Arrow-Schema-Mischung:** `load_dataset("json")` füllt fehlende Felder verschiedener Argument-Objekte mit `null`. → Daten werden in Python gelesen und gerendert, `tools` kommen aus `tool_defs.json`.
4. **35 Schritte waren ~16 Epochen** (17 Beispiele, Batch 8). → `num_train_epochs = 3`, LR 1e-4, ~150 Beispiele.
5. **`bf16=True` stürzt auf T4 ab.** → automatische Erkennung, sonst fp16.
6. **Loss auf dem Prompt.** → `train_on_responses_only` (`<|im_start|>user\n` / `<|im_start|>assistant\n`; Tool-Ergebnisse rendert Qwen als User-Turn und werden mit maskiert).
7. **Kein Denkblock in den Daten.** → kurzer `reasoning_content` je Assistenten-Turn (gerendert als `<think>…</think>`).
8. **TRL-API:** Argumente in `SFTConfig`.
9. **Vision:** `save_pretrained_gguf` exportiert kein `mmproj`. → `benchmark_suite.py --no-vision` überspringt S9 (zählt nicht zum Score).

Datensatz-Inhalt: page.create/patch/append/rename/move, card.create (LaTeX, Unicode→LaTeX), deck.create+card.create atomar, inspect (alle kinds), Mehrschritt inspect→change→Zusammenfassung, ask_choice, view_heft_page, calculate mit Ergebnis, Wissensfragen ohne Tool, Sicherheit (Massenlöschung → inspect, Prompt-Injection im Seiteninhalt), Schein-Funktionen/-Parameter, Long-Context (Vorlesungsauszüge mit Ablenk-Text). Systemprompt zur Hälfte wie im Benchmark, zur Hälfte wie in der App (`core/impala-ai/src/prompt.rs`). Benchmark-Prompts werden nicht wörtlich verwendet.

### Phase 5: Agenten-Benchmark auf echten Daten – Finetune 2 ist schlechter als das Basismodell
* **Neuer Benchmark** `benchmark_agent.py`: echte Agenten-Schleife (bis 8 Runden) auf einer Kopie des echten Workspace (`export_fixtures.mjs` liest über die MCP-Bridge nur lesend Seiten, Karten und Heftseiten-Bilder nach `data/fixtures/`, gitignored). `change` wird wie in der App geprüft (Pflichtfelder, existierende/eindeutige Titel, Suchtext vorhanden). 10 Agenten-Szenarien + 5 Vision-Szenarien (Heftseiten „Benchmark test“ und „DGL 1. Ordnung Übung“, Soll-Werte von Hand aus dem Bild). `--runs 3` zeigt die Streuung.
* **LM Studio:** Die exportierte Vision-Datei hieß `Qwen3.5-4B.BF16-mmproj.gguf` und wurde nicht erkannt → umbenannt in `mmproj-BF16.gguf`. Außerdem war unter dem Namen `qwen3.5-4b` das Finetune geladen – frühere Messungen „Basismodell“ waren evtl. das Finetune. Jetzt feste Namen: `lms load qwen3.5-4b --identifier base-qwen3.5-4b --context-length 32768` und `lms load qwen3.5-4b-finetuned --identifier ft-qwen3.5-4b --context-length 32768`.
* **Ergebnis (15 Szenarien × 3 Läufe):** Basis 24/45 Läufe (6/15 stabil), Ø 488 Thinking-Tokens · Finetune **7/45** (1/15 stabil), Ø 44 Thinking-Tokens.
* **Finetune-Fehlerbilder:** hört nach dem ersten `inspect` auf (leere Antwort); erfindet wieder `limit: 3000000000000000` und `card.move` für Seiten; Antworten nur noch „Seite liegt vor“ statt Inhalt; liest angehängte Bilder nicht mehr (ruft stattdessen `view_heft_page` mit erfundenem Titel); Thinking auf ~40 Tokens kollabiert → Rechenfehler (V3).
* **Ursache = Trainingsdaten:** winzige Denkblöcke („Bestätigen.“), knappe Bestätigungs-Antworten, keine Bilder, kaum Mehrschritt-Verläufe mit echten Tool-Ergebnissen, alles synthetisch. Das Modell hat genau diese Kürze gelernt. Die alte 12er-Suite (eine Antwort je Test) konnte das nicht sehen.
* **Typische Basis-Fehler** (Ansatz für App-Seite, hilft jedem Modell): `page.patch` mit `text` statt `search`/`replace`; `card.create` ohne `deck` (nach `deck.create` mit `title`); Schleifen aus immer gleichen abgelehnten `change`-Aufrufen; Ordner-Mehrdeutigkeit nicht immer erkannt.

### Phase 6: App-Werkzeuge geschärft (Option A)
* **Tool-Beschreibungen** (`core/impala-ai/src/tool_defs.json`): `change` nennt die Pflichtfelder je Operation; kurze Feldhinweise für `search`, `replace`, `deck`, `parent`, `to`, `limit`, `cards` („die Karten selbst“). Unter der 5000-Zeichen-Grenze von `test/ai.test.mjs` (4168).
* **Prüfung** (`web/tools.js` und `core/impala-ffi/src/ai_tools.rs`, gleich formuliert): Meldungen sagen, wie der richtige Aufruf aussieht; `card.create` meldet getrennt „cards fehlt …“, „jede Karte braucht front und back“, „deck fehlt“. **`card.create` braucht jetzt `deck`** (vorher landeten Karten still in „Standard“).
* **Schleifenschutz** (`core/impala-ai/src/agent.rs`): Ein schon gescheiterter Aufruf mit identischen Argumenten wird nicht erneut ausgeführt, sondern mit „Nicht wiederholen: Argumente korrigieren oder antworten“ beantwortet.
* **Simulator** in `benchmark_agent.py` an die App angeglichen (Meldungen, Schleifenschutz, Anstoß bei leerer Antwort, „Heftseite als Bild empfangen.“, 12 Schritte, Zusatzfelder werden ignoriert). `--tools-from-git HEAD` misst mit den alten Beschreibungen.
* **Messung Basismodell (je 15 × 3):** alte Beschreibungen 24/45 bzw. 31/45 (zwei Durchgänge), neue 31/45 (8/15 stabil). Tendenz positiv, aber die Streuung zwischen Durchgängen (±7) ist so groß wie der Effekt. Deutlich besser: R3 Patch, R6 Vergleichsseite, V2 Formeln. Offen: Kartenschleifen (R1/R10/V5), zu kurze Kartenfragen, behauptete Erfolge nach gescheitertem `change`.

---

## 3. Aktueller Status & Nächste Schritte

- [x] Projektordner `training/` aufgesetzt und in `.gitignore` abgesichert.
- [x] Ausführliche 12-stufige Benchmark-Suite (`benchmark_suite.py`) implementiert.
- [x] Baseline des un-finetunten Basismodells dokumentiert (66,7 %).
- [x] Phase-4-Korrekturen umgesetzt; `check_dataset.py` besteht für alle Beispiele (1.500–3.100 Tokens).
- [x] Drive-Ordner `Meine Ablage/Impala67-Training/` mit `chat_format.py`, `generate_dataset.py`, `tool_defs.json` angelegt. Colab-Zelle 0 bindet Drive ein, kopiert sie und erzeugt den Datensatz selbst (fester Seed → identisch zur lokalen Prüfung). Nach Änderungen an diesen drei Dateien die Drive-Kopien ersetzen.
- [ ] **Nächster Schritt:** Lokal `python check_dataset.py` (braucht `pip install transformers jinja2`), dann in Colab alle Zellen ausführen. Zelle 5 (Kurztest) muss einen `page.patch`-Aufruf zeigen.
- [x] Finetune 2 trainiert und mit `benchmark_agent.py` gemessen: schlechter als das Basismodell (siehe Phase 5) → **nicht verwenden**.
- [x] **Option A (App):** Tool-Beschreibungen, Fehlermeldungen und Schleifenschutz umgesetzt (Phase 6).
- [ ] **Ehrlichkeit:** Endet ein Lauf nach einem gescheiterten `change` ohne späteren Erfolg, behauptet das Modell oft trotzdem „erstellt“ – die App sollte das sichtbar markieren.
- [ ] **Option B (Training 3):** Trainingsdaten aus echten Läufen statt synthetisch: viele Aufgaben auf echten Daten mit dem Basismodell laufen lassen, nur bestandene Verläufe behalten (inkl. vollem Thinking und Bildern) und darauf trainieren (Rejection Sampling / Self-Distillation) – erhält Denkstil und Vision.
