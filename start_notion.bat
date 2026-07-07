@echo off
echo Starte Notion Web-Server...

:: Wechsle in das Verzeichnis deiner Web-Dateien (seit der Tauri-Restrukturierung liegen sie in web\)
cd /d "C:\Users\joshu\Documents\Notion\web"

:: Öffnet direkt localhost im Standardbrowser
start http://localhost:8000

:: Startet den Python-Server auf Port 8000
python -m http.server 8000