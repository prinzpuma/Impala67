@echo off
echo Starte Impala67 Web-Server...

:: Wechsle in das Verzeichnis der Web-Dateien, relativ zu dieser Bat-Datei selbst
:: (%~dp0 = Ordner, in dem start_impala67.bat liegt -> funktioniert egal wie der
:: Projektordner heisst oder wo er auf der Platte liegt, kein manuelles Anpassen mehr noetig)
cd /d "%~dp0web"

:: Öffnet direkt localhost im Standardbrowser
start http://localhost:8000

:: Startet den Python-Server auf Port 8000
python -m http.server 8000