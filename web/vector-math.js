"use strict";

// Kleine Vektor-Helfer für Wissenslandkarte und Fach-Zuordnung (wenige Vektoren, kein Index).
export const norm = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s) || 1; };
export const dot = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };
