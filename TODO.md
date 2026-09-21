# Impala67 – Backlog & Offene Punkte

## 1. Umgesetzt: Capacitor Android-Integration

- [x] **Capacitor Basis-Setup & Konfiguration**:
  - `capacitor.config.json` eingerichtet mit `appId: org.impala67.app`, `appName: Impala67`, `webDir: web`.
  - Android-Plattformgerüst (`android/`) initialisiert und synchronisiert (`cap sync android`).
- [x] **Native Plattform-Schicht (`web/platform-native.js`)**:
  - Reines ES-Modul ohne Bundler mit Graceful Degradation für Web/PWA.
  - **Hardware Back-Button**: Schließt zuerst Modals/Overlays, dann Mobile Navigation, dann Tab-History, bevor die App minimiert wird.
  - **Haptik**: Taktiles Feedback bei Karteikarten-Bewertungen und UI-Aktionen.
  - **Lokale SRS-Benachrichtigungen**: Tägliche Erinnerung an fällige Karten (100 % lokal ohne Server).
  - **Dateisystem-Backup**: Exportiert Backups unter Android direkt in `Documents/Impala67/` (mit Schalter in den Einstellungen).
  - **Google ML Kit Document Scanner**: Kamera-Dokumentenscan mit automatischer Randerkennung direkt ins Heft.
  - **Offline-Spracheingabe**: Robuste Android-Spracherkennung ohne Timeouts und Cloud-Zwang.
  - **Systemweites Teilen ("Senden an Impala67")**: Empfangen von geteilten PDFs, Bildern und Texten aus anderen Apps via Android Intent-Filter.
- [x] **Automatischer APK-Build (CI)**:
  - GitHub Actions Workflow `.github/workflows/android-build.yml` für automatische Debug-APK bei Push auf `main`.

## 2. Nächste Schritte & Optimierungen

- [ ] **ML Kit OCR → native Digital-Ink-Handschrifterkennung optimieren**:
  - Die aktuelle ML-Kit-TextRecognition-Pipeline funktioniert bereits, wandelt Handschrift aber erst über Canvas → JPEG → temporäre Datei → Bild-OCR um.
  - Prüfen, ob Stroke-Daten direkt über ML Kit Digital Ink verarbeitet werden können, um Bildkonvertierung, temporäre Dateien und unnötigen OCR-Overhead zu vermeiden.
  - Nachteile der aktuellen Lösung: zusätzlicher Canvas/JPEG/I/O-Schritt, Verlust von Stroke-Kontext und potenziell schlechtere Erkennung bei individueller Handschrift; für größere Hefte weniger effizient inkrementell nutzbar.
  - Ziel: schnellere/offline Handschrifterkennung und bessere Grundlage für Heft-RAG/KI-Funktionen wie „Erstelle einen Lernzettel aus diesem Heft“.

- [x] **Stift-Latenz im Heft (`desynchronized: true`)**:
  - Der 2D-Canvas-Context der Live-Ink-Ebene (`wetCanvases`) in `web/heft.js` wird mit `{ desynchronized: true }` initialisiert (reduziert Stiftlatenz auf Android/Chromium durch Umgehung der Compositor-Queue).
- [ ] **Android Home-Screen Widget**:
  - Optionales Widget für den Startbildschirm mit offenen Karteikarten.
- [ ] **Google Drive Login in Android-APK verifizieren**:
  - Prüfen und Testen des OAuth2-Ablaufs in der nativen Capacitor-Umgebung (Webclient-ID vs. Android OAuth-Redirect / Chrome Custom Tabs).
- [ ] **Projekt-Entschlackung & Neustrukturierung (KISS & DRY)**:
  - **Code-Verständnis & Übersicht neu erarbeiten**: Die gesamte Architektur und Zusammenhänge schrittweise selbst wieder durchdringen, da die Übersicht verloren gegangen ist.
  - **Code-Dokumentation komplett neu aufbauen**: Modul-Zusammenspiel, Datenflüsse (State, DB, Cloudflare, Drive) und Kernkomponenten von Grund auf klar, verständlich und aktuell dokumentieren.
  - **Redundanzen abbauen**: Doppelte Helfer, parallele Sonderfälle und überflüssige Abstraktionen bereinigen.
  - **Monolithen aufbrechen & aufräumen**: Große Dateien (`heft.js`, `editor.js`, `render.js`, `state.js`, `settings.js`) auf Altlasten, ungenutzten Code und tote Pfade untersuchen.
  - **Architektur vereinfachen**: Klare Modulverantwortlichkeiten schärfen und unnötige Komplexität konsequent entfernen, um den Arbeitsregeln wieder voll zu entsprechen.
- [x] **Android Transparente Statusleiste**:
  - Statusleiste permanent transparent eingeblendet (Edge-to-Edge); immersiver Vollbild-Schalter restlos entfernt.
