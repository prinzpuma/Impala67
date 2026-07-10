# Impala67 - Notion-Sync (Doppelklick-Datei)

Diese kleine Skript-Sammlung liest alle Datei-Unterseiten aus deiner Notion-Seite
"Impala67 - Notion-Klon (Local-First Web-App)" per offizieller Notion-API und
schreibt sie als lokale Dateien in deinen Projektordner. Danach kannst du wie
gewohnt in VS Code weiterarbeiten, ohne Code manuell zu kopieren.

## Einmalige Einrichtung

1. Gehe zu https://www.notion.so/my-integrations und klicke auf "+ New integration".
   - Typ: Internal
   - Capabilities: nur "Read content" wird benoetigt.
2. Kopiere den angezeigten Internal Integration Secret.
3. Oeffne in Notion die Seite "Impala67 - Notion-Klon (Local-First Web-App)".
   Klicke oben rechts auf "..." -> Connections / Verbindungen -> waehle
   deine neue Integration aus. Das gibt ihr automatisch Lesezugriff auf diese
   Seite und alle ~35 Datei-Unterseiten darunter.
4. In diesem Ordner: kopiere .env.example zu .env und trage deinen Secret
   bei NOTION_TOKEN= ein.
5. Stelle sicher, dass Node.js 18 oder neuer installiert ist
   (https://nodejs.org, node -v zum Pruefen).
6. Lege diesen ganzen Ordnerinhalt (sync-notion.js, .env, sync_impala67.bat,
   README.md) in deinen echten Projektordner, dorthin wo die Dateien wie
   boot.js, state.js, db.js etc. am Ende landen sollen (z.B.
   C:\Users\joshu\Documents\Impala67\web, falls dein Quellcode dort liegt).

## Benutzung

- Windows: Doppelklick auf sync_impala67.bat.
- Mac/Linux: einmalig chmod +x sync_impala67.command, danach Doppelklick
  (bei erster Ausfuehrung ggf. "Trotzdem oeffnen" bestaetigen), oder im Terminal:
  node sync-notion.js.

Das Skript listet dann alle Datei-Seiten, ordnet sie per im Text hinterlegtem
impala67/<dateiname>-Hinweis lokalen Pfaden zu, und schreibt/ueberschreibt
die jeweiligen Dateien direkt in deinem Ordner. Am Ende siehst du eine
Zusammenfassung (geschriebene / uebersprungene Seiten).

## Wichtige Hinweise

- Ueberschreibt ohne Rueckfrage. Es gibt keinen Diff/Merge - lokale
  Aenderungen, die noch nicht in Notion stehen, werden von der Notion-Version
  ueberschrieben. Committe/sichere lokale Aenderungen vorher, falls noetig.
- config.local.js enthaelt laut Notion-Seite lokale, nicht versionierte
  Geheimnisse. Falls du nicht willst, dass diese Datei ueberschrieben wird,
  trage in .env ein: IMPALA_SKIP_PATTERNS=config.local.js
- Falls dein Quellcode in einem Unterordner liegt (z.B. Impala67\web), lege
  die Sync-Dateien direkt dort ab, oder setze in .env z.B.
  IMPALA_OUTPUT_DIR=web
- Neue Seiten, die du spaeter unter der Impala67-Projektseite in Notion
  anlegst, werden beim naechsten Doppelklick automatisch mit erfasst -
  du musst das Skript nicht anpassen.
- Das Skript nutzt nur Node-Bordmittel (kein npm install noetig).

## Unterordner-Struktur (mehrere Zielordner)

Das Skript kann grundsaetzlich beliebig tiefe Unterordner anlegen (es nutzt
mkdir -p intern). Das Problem ist nur die Datenquelle: die Notion-Seiten
enthalten aktuell fast alle einen flachen Hinweis wie "impala67/boot.js",
auch wenn dein echtes Projekt z.B. "web/boot.js" oder "web/js/boot.js"
erwartet - Notion-Unterseiten kennen selbst keine Ordner.

Loesung: kopiere file-map.example.json zu file-map.json und trage dort
fuer einzelne Dateien den gewuenschten Zielpfad ein, z.B.:

```json
{
  "boot.js": "web/boot.js",
  "styles.css": "web/styles.css"
}
```

Alles, was nicht in file-map.json steht, landet weiterhin direkt im
Ausgabeordner (IMPALA_OUTPUT_DIR).

Um mir (Notion AI) die komplette Struktur deines lokalen Projektordners zu
zeigen, damit ich dir eine vollstaendige file-map.json erstellen kann, fuehre
einen der folgenden Befehle in deinem Projektordner aus und schicke mir die
Ausgabe:

- Windows (cmd), im Projektordner ausfuehren:
  ```
  dir /s /b
  ```
- Windows (PowerShell):
  ```
  Get-ChildItem -Recurse -File | ForEach-Object { $_.FullName }
  ```
- Mac/Linux:
  ```
  find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*'
  ```

