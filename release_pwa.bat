@echo off
rem Doppelklick-Starter: veroeffentlicht die PWA (Logik in .github/scripts/release.mjs)
cd /d "%~dp0"
call npm run release -- %*
pause
