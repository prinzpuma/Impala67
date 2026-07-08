# Impala67

Impala67 ist eine lokale Lern-App im Stil von Notion, die Notizen, PDFs, Karteikarten (Anki-Prinzip mit FSRS) und einen KI-Coach in einer Oberfläche vereint. Sie läuft als Desktop-App über Tauri v2 oder optional als Web-App/PWA im Browser.

## Features

- **Workspaces & Notizen:** Notion-artiger Editor mit Markdown-Unterstützung, Slash-Befehlen, Toggle-Blöcken, Drag & Drop und LaTeX-Rendering.
- **KI-Coach:** Integrierter Assistent mit Support für verschiedene Modelle (Gemini, OpenAI, LM Studio für lokale Modelle), Tool-Calling (Seiten verwalten/suchen), Reasoning-Ansicht und adaptivem Feedback.
- **Spaced Repetition (Anki):** Karteikarten-System mit FSRS-lite (Free Spaced Repetition Scheduler) zur intelligenten Wiedervorlage.
- **PDF-Verarbeitung:** Automatischer Text-Import, Tagging und Zusammenfassungen durch KI.
- **Backup & Sync:** Lokale Speicherung in IndexedDB (Event-Log-basiert), Import/Export und Google-Drive-Synchronisation.

## Setup & Entwicklung

Um das Projekt lokal zu starten, müssen Node.js und Rust (für Tauri v2) auf dem System installiert sein.

### 1. Abhängigkeiten installieren
Führe im Root-Verzeichnis aus:
```bash
npm install
```

### 2. Entwicklungsserver starten
Starte den Tauri-Entwicklungsmodus (öffnet die Desktop-App):
```bash
npx tauri dev
```

### 3. Konfiguration (`config.local.js`)
Für die Google-Drive-Synchronisation muss eine `config.local.js` im Verzeichnis `web/` existieren. Eine Vorlage findest du unter `web/config.local.example.js`.
Erstelle die Datei mit deinen eigenen Google OAuth Client-Daten:
```javascript
window.APP_CONFIG = {
  GOOGLE_DESKTOP_CLIENT_ID: "DEINE_GOOGLE_CLIENT_ID"
};
```

## Build & Release

Um ein produktionsbereites Paket für dein System zu bauen:
```bash
npx tauri build
```
Die erzeugten Installer befinden sich anschließend im Verzeichnis `src-tauri/target/release/bundle/`.
