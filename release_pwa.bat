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
echo Version automatisch erhoehen...
node .github/scripts/bump-version.mjs
if errorlevel 1 (
  echo FEHLER: Versionserhoehung fehlgeschlagen.
  pause
  exit /b 1
)

for /f "usebackq tokens=*" %%V in (`node -p "require('./package.json').version"`) do set "NEW_VERSION=%%V"
echo Neue Version: v%NEW_VERSION%

echo.
echo Alle Aenderungen vormerken...
git add -A
if errorlevel 1 (
  echo FEHLER: Dateien konnten nicht vorgemerkt werden.
  pause
  exit /b 1
)

set "MESSAGE=%~1"
if not defined MESSAGE set "MESSAGE=release: v%NEW_VERSION%"
echo.
echo Commit: %MESSAGE%
git commit -m "%MESSAGE%"
if errorlevel 1 (
  echo FEHLER: Commit fehlgeschlagen.
  pause
  exit /b 1
)

echo.
echo Erstelle Release-Tag v%NEW_VERSION%...
git tag -a "v%NEW_VERSION%" -m "Release v%NEW_VERSION%"
if errorlevel 1 (
  echo FEHLER: Tag konnte nicht erstellt werden.
  pause
  exit /b 1
)

echo.
echo Lade den Commit und Tag nach GitHub hoch ...
git push origin main
if errorlevel 1 (
  echo FEHLER: Push auf main fehlgeschlagen.
  pause
  exit /b 1
)

git push origin "v%NEW_VERSION%"
if errorlevel 1 (
  echo FEHLER: Push des Tags fehlgeschlagen.
  pause
  exit /b 1
)

echo.
echo ========================================
echo Erfolgreich!
echo Version v%NEW_VERSION% wurde veroeffentlicht.
echo GitHub Actions baut jetzt PWA und APK.
echo ========================================
pause

