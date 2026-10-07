@AGENTS.md

# Claude-Code-Ergänzungen

- **Sprache**: Mit dem Nutzer auf Deutsch kommunizieren.
- **Shell**: Hauptrechner ist Windows 11. Bash (Git Bash) und PowerShell sind verfügbar; Befehle in Doku/Skripten plattformneutral halten (`node`-Skripte statt `.bat`/`.sh`).
- **Dev-Server**: `python -m http.server 8000 --directory web` → `http://localhost:8000` (in Claude Code über `.claude/launch.json` als `impala67` startbar).
- **Einzeltests**: `node --test test/<name>.test.mjs` (ai, editor, heft, state, sync). Danach bei Bedarf `npm run verify`.
- **Live-Prüfung**: Der MCP-Server `impala67` (`.mcp.json`) verbindet sich mit der offenen App im Browser. Ohne offenen Tab arbeitet er nur auf `mcp/.storage.json`.
- **Skills**: Projekt-Skills liegen in `.claude/skills/` (z. B. `cloudflare-sync-v4` vor Sync-Arbeiten laden).
- **Delegation**: Kleine Aufgaben selbst erledigen. Breite Suchen über viele Dateien → Agent `scout`. Fertig geplante Mehrdatei-Änderungen → Agent `worker`. Kein Agent für Einzeiler.
- **Handschrift-ML** (`handwriting/`): Python-Training mit eigenem `.venv`; erzeugtes Modell landet als `web/handwriting-model.onnx`.
