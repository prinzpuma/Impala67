# Impala67

Impala67 ist eine installierbare, local-first Progressive Web App für Notizen, PDFs, Handschrift, Karteikarten und KI-gestütztes Lernen. Die App läuft statisch im Browser und benötigt keinen Desktop-Wrapper oder eigenen Anwendungsserver.

## Impala67 öffnen

[Zur App](https://prinzpuma.github.io/Impala67/)

## Funktionen

- Notizen und Dokumente direkt im Browser verwalten
- Handschrift und PDFs integrieren
- Karteikarten und Lerninhalte erstellen
- Offline arbeiten dank PWA-Unterstützung
- Daten lokal im Browser speichern
- Mehrgeräte-Sync über einen optionalen Cloudflare-Kanal mit Ende-zu-Ende-Verschlüsselung
- Google Drive optional als privates Backup und Langzeitspeicher verwenden
- Notion über einen optionalen Zwei-Wege-Sync anbinden
- KI-Anbieter direkt, lokal oder über den geschützten Groq-Proxy nutzen

Die fachlichen Daten bleiben local-first im Browser (IndexedDB). Cloudflare-Sync und Google Drive sind optionale Dienste; ohne sie funktioniert die lokale App weiterhin. Impala67 funktioniert auf modernen Browsern sowie als installierte PWA.

## Cloudflare-Sync und Server

Der optionale Cloudflare-Dienst unterstützt Echtzeit-Synchronisierung über WebSockets, speichert die synchronisierten Ereignisse ausschließlich verschlüsselt und stellt zusätzlich einen authentifizierten Groq-AI-Proxy bereit. Einrichtung und Deployment des Workers sind in der [Server-Dokumentation](server/README.md) beschrieben.
