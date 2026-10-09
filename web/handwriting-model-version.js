"use strict";

// web/handwriting-model-version.js — Version von handwriting-model.onnx.
// NICHT von Hand pflegen: Der Release-Workflow (.github/scripts/set-version.mjs) ersetzt den Wert
// durch die Prüfsumme der Modelldatei. Neues Modell → neue Version → der Worker umgeht alte
// Cache-Kopien und der Heft-Indexer erkennt alle Seiten einmal mit dem neuen Modell.
// Der Wert hier gilt nur lokal (Entwicklung).
export const HANDWRITING_MODEL_VERSION = "dev";
