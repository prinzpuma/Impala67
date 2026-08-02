@echo off
echo Starte Impala67 PWA...
cd /d "%~dp0web"
start "" http://localhost:8000/
python -m http.server 8000
