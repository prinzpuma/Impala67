# Settings-Preview testen

Diese Version läuft absichtlich auf einer eigenen lokalen Adresse. Deshalb hat sie eine eigene IndexedDB und startet zunächst ohne die Seiten und geöffneten Seiten-Tabs aus der normalen App. Die normale App wurde dadurch nicht verändert.

## Bestehende Seiten und Tabs übernehmen

1. Normale App öffnen.
2. `Einstellungen → Daten & Backup → Export` wählen und die JSON-Datei speichern.
3. Preview unter `http://127.0.0.1:4177/` öffnen.
4. `Einstellungen → Daten & Backup → Import` wählen und dieselbe Datei laden.
5. Danach werden Seiten, Seitenbaum und der zuletzt gespeicherte Tab-Stand übernommen.

Der Export lässt standardmäßig Tokens und API-Schlüssel weg. Für die Preview ist das der sichere Weg, um deinen echten Inhalt zu testen, ohne geheime Zugangsdaten zu kopieren.

## Token-Sync testen

Unter `Einstellungen → Sync & Dienste → Sync` lässt sich `Tokens über Drive synchronisieren` ein- und ausschalten. Beim Ausschalten bleiben KI-Keys und Notion-Token lokal; beim nächsten manuellen Drive-Sync werden vorhandene Token-Kopien aus dem Drive-Stand bereinigt.

Die Hauptversion bleibt auf ihrem bisherigen Port und ihrer bisherigen Datenbasis separat nutzbar.
