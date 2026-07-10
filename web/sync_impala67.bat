@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
	echo Node.js wurde nicht gefunden. Bitte installiere Node.js 18+ von https://nodejs.org
	pause
	exit /b 1
)

node sync-notion.js

echo.
pause
