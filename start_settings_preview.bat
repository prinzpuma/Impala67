@echo off
echo Starte die isolierte Settings-Preview auf Port 4176...
cd /d "%~dp0web"
start "" http://127.0.0.1:4176/
python -m http.server 4176
