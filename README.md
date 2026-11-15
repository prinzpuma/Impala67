# Impala67

Impala67 ist eine local-first App für Notizen, PDFs, Handschrift, Karteikarten und KI-gestütztes Lernen – als installierbare PWA, native Android-App und native iPad-App. Alle drei teilen sich einen Rust-Kern und dieselben Daten; ein eigener Anwendungsserver ist nicht nötig.

## App öffnen & herunterladen

- 🌐 **Web-App / PWA (Browser, PC, Mac, iPad, Android):** [Impala67 öffnen](https://prinzpuma.github.io/Impala67/)
- 📱 **Android App (APK):** [Impala67.apk herunterladen (Direktlink)](https://github.com/prinzpuma/Impala67/releases/latest/download/Impala67.apk)
- 🍎 **iPad-App (IPA):** unsigniertes Build-Artefakt im GitHub-Actions-Lauf „iPad-App bauen“ ([ios/README.md](ios/README.md))
- 📦 **Alle Releases & Versionshistorie:** [GitHub Releases](https://github.com/prinzpuma/Impala67/releases)

## Funktionen

- Notizen und Dokumente direkt im Browser verwalten
- Handschrift und PDFs integrieren
- Karteikarten und Lerninhalte erstellen
- Offline arbeiten dank PWA-Unterstützung
- Daten lokal im Browser speichern
- Mehrgeräte-Sync über einen optionalen Cloudflare-Kanal mit Ende-zu-Ende-Verschlüsselung
- Google Drive optional als privates Backup und Langzeitspeicher verwenden
- KI-Anbieter direkt, lokal oder über den geschützten Groq-Proxy nutzen

Die fachlichen Daten bleiben local-first im Browser (IndexedDB). Cloudflare-Sync und Google Drive sind optionale Dienste; ohne sie funktioniert die lokale App weiterhin. Aufbau und Regeln für Entwickler: [AGENTS.md](AGENTS.md).

## Cloudflare-Sync und Server

Der optionale Cloudflare-Dienst unterstützt Echtzeit-Synchronisierung über WebSockets, speichert die synchronisierten Ereignisse ausschließlich verschlüsselt und stellt zusätzlich einen authentifizierten Groq-AI-Proxy bereit. Einrichtung und Deployment des Workers sind in der [Server-Dokumentation](server/README.md) beschrieben.
