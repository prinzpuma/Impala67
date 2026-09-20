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

- [ ] **Stift-Latenz im Heft (`desynchronized: true`)**:
  - Prüfen, ob der 2D-Canvas-Context in `web/heft.js` mit `{ desynchronized: true }` initialisiert werden kann (reduziert Stiftlatenz auf Android/Chromium).
- [ ] **Android Home-Screen Widget**:
  - Optionales Widget für den Startbildschirm mit offenen Karteikarten.
- [ ] **Android Vollbild**:
  - Wird wie besprochen erst am Ende separat gelöst.
