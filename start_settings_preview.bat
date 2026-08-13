@echo off
echo Starte die isolierte Settings-Preview auf Port 4257...
cd /d "%~dp0web"
start "" http://127.0.0.1:4257/
node ..\scripts\preview-server.mjs . 4257
