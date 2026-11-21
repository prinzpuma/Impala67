// v4-Aufgaben (natürliche Nutzersprache, Schwerpunkt inhaltliche Richtigkeit). Regeln: BRIEF.md
import erklaeren from "./erklaeren.mjs";
import gedaechtnis from "./gedaechtnis.mjs";
import orga from "./orga.mjs";
import rechnen from "./rechnen.mjs";
import schreiben from "./schreiben.mjs";
import tutor from "./tutor.mjs";
import verzeichnis from "./verzeichnis.mjs";

export const V4_TASKS = [...orga, ...erklaeren, ...tutor, ...schreiben, ...verzeichnis, ...rechnen, ...gedaechtnis];
