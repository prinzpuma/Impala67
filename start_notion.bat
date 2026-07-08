@echo off
echo Starte Impala67 Web-Server...

:: Wechsle in das Verzeichnis deiner Web-Dateien (seit der Tauri-Restrukturierung liegen sie in web\)
:: Pfad ggf. anpassen, falls dein Projektordner (noch) anders heisst
cd /d "C:\Users\joshu\Documents\Impala67\web"

:: Öffnet direkt localhost im Standardbrowser
start http://localhost:8000

:: Startet den Python-Server auf Port 8000
python -m http.server 8000