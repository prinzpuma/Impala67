@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo Impala67 PWA veroeffentlichen
echo ========================================

where git >nul 2>&1
if errorlevel 1 (
  echo FEHLER: Git wurde nicht gefunden.
  pause
  exit /b 1
)

for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if not "%BRANCH%"=="main" (
  echo FEHLER: Dieses Skript veroeffentlicht nur den Branch main.
  echo Aktueller Branch: %BRANCH%
  pause
  exit /b 1
)

echo.
echo Aktuelle Aenderungen:
git status --short
echo.
echo Alle angezeigten Aenderungen werden veroeffentlicht.
git add -A
if errorlevel 1 (
  echo FEHLER: Dateien konnten nicht vorgemerkt werden.
  pause
  exit /b 1
)

git diff --cached --quiet
if not errorlevel 1 (
  echo Keine neuen Aenderungen vorhanden.
  pause
  exit /b 0
)

set "MESSAGE=%~1"
if not defined MESSAGE set "MESSAGE=PWA release"
echo.
echo Commit: %MESSAGE%
git commit -m "%MESSAGE%"
if errorlevel 1 (
  echo FEHLER: Commit fehlgeschlagen.
  pause
  exit /b 1
)

echo.
echo Lade den Commit nach GitHub hoch ...
git push origin main
if errorlevel 1 (
  echo FEHLER: Push fehlgeschlagen.
  pause
  exit /b 1
)

echo.
echo Fertig. GitHub Actions veroeffentlicht jetzt die PWA.
pause
