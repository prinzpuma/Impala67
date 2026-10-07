@AGENTS.md

# Claude-Code-Ergänzungen

- **Sprache**: Mit dem Nutzer auf Deutsch kommunizieren.
- **Shell**: Hauptrechner ist Windows 11. Bash (Git Bash) und PowerShell sind verfügbar; Befehle in Doku/Skripten plattformneutral halten (`node`-Skripte statt `.bat`/`.sh`).
- **Dev-Server**: `python -m http.server 8000 --directory web` → `http://localhost:8000` (in Claude Code über `.claude/launch.json` als `impala67` startbar).
- **Einzeltests**: `node --test test/<name>.test.mjs` (ai, editor, heft, state, sync). Danach bei Bedarf `npm run verify`.
- **Live-Prüfung**: Der MCP-Server `impala67` (`.mcp.json`) verbindet sich mit der offenen App im Browser. Ohne offenen Tab arbeitet er nur auf `mcp/.storage.json`.
- **Skills**: Projekt-Skills liegen in `.claude/skills/` (z. B. `cloudflare-sync-v4` vor Sync-Arbeiten laden).
- **Größte Dateien** (immer gezielt per Grep/Zeilenausschnitt lesen): `heft.js`, `editor.js`, `app.js`, `render.js`, `state.js`, `settings.js`, `ai.js`.
- **Token-Effizienz / Delegation**: Kleine Aufgaben selbst erledigen (Subagents starten ohne Kontext und kosten dann mehr). Breite Suchen über viele Dateien → Agent `scout` (Haiku). Fertig geplante, mechanische Mehrdatei-Änderungen → Agent `worker` (Sonnet). Kein Agent für Einzeiler oder Dinge, deren Kontext schon im Gespräch steht.
- **Handschrift-ML** (`handwriting/`): Python-Training mit eigenem `.venv`; erzeugtes Modell landet als `web/handwriting-model.onnx`.
