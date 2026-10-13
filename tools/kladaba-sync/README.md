# 🎓 Kladaba & NotebookLM Synchronisation

Automatisierte Pipeline zum Abrufen von Klausuren, Übungsblättern und Zusammenfassungen aus der **Kladaba** (Klausurendatenbank der Fachschaft Technische Fakultät, Albert-Ludwigs-Universität Freiburg) und Synchronisation in Google NotebookLM.

## Ziel-Notebooks (Semester 3)

| Fach | Kladaba-Kurs | NotebookLM-ID |
|---|---|---|
| **Nachhaltiges Wirtschaften** | [Kurs #487](https://db.fachschaft.tf/submission/?course=487) | `6633befe-c9ab-4527-a2e4-e57a2363aeff` |
| **Kontinuumsmechanik** | [Kurs #430](https://db.fachschaft.tf/submission/?course=430) | `5fc90f0c-1907-4cdd-b3fe-f85cbfa93c01` |
| **Festkörperphysik** | [Kurs #446](https://db.fachschaft.tf/submission/?course=446) | `0b716b78-f6d6-46cd-b72e-55d65af7c371` |
| **Allgemeine und Anorganische Chemie** | [Kurs #37](https://db.fachschaft.tf/submission/?course=37) | `bfe63718-537f-4041-ac5c-98bb8c2c994e` |
| **Elektronik – Bauelemente und analoge Schaltungen** | [Kurs #48](https://db.fachschaft.tf/submission/?course=48) | `da27ee8e-6d86-4e40-b9e4-d136d3fc7c72` |

## Ablauf & Nutzung

1. **Login bei Kladaba (Janus/Uni-Account):**
   ```bash
   python tools/kladaba-sync/kladaba_login.py
   ```
   Öffnet einen Browser zur Authentifizierung an `db.fachschaft.tf` und speichert die Session-Cookies in `kladaba_cookies.json`.

2. **Schnell-Scan nach neuen Materialien:**
   ```bash
   python tools/kladaba-sync/scan_all_courses.py
   ```

3. **Vollständiger Sync & Upload nach NotebookLM:**
   ```bash
   python tools/kladaba-sync/sync_all_kladaba_to_notebooklm.py
   ```
   Lädt alle PDFs (2018–heute) nach `C:\Users\joshu\Downloads\Kladaba\` herunter und fügt neue Dokumente als Quellen in die jeweiligen Google NotebookLM Notizbücher ein.

## NotebookLM CLI
Voraussetzung für den Upload ist das Python-Paket `notebooklm-py` (`python -m notebooklm`). Bei abgelaufener Google-Sitzung einmalig:
```bash
python -m notebooklm login
```
ausführen.
