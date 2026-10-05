#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd -- "$SCRIPT_DIR" || exit 1

pause_before_exit() {
  if [[ -t 0 ]]; then
    read -r -p "Drücke Enter zum Beenden ..." _
  fi
}

echo "========================================"
echo "Impala67 PWA veröffentlichen"
echo "========================================"

if ! command -v git >/dev/null 2>&1; then
  echo "FEHLER: Git wurde nicht gefunden."
  pause_before_exit
  exit 1
fi

BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "main" ]]; then
  echo "FEHLER: Dieses Skript veröffentlicht nur den Branch main."
  echo "Aktueller Branch: ${BRANCH:-unbekannt}"
  pause_before_exit
  exit 1
fi

echo
echo "Version automatisch erhöhen..."
if ! node .github/scripts/bump-version.mjs; then
  echo "FEHLER: Versionserhöhung fehlgeschlagen."
  pause_before_exit
  exit 1
fi

NEW_VERSION="$(node -p "require('./package.json').version")"
echo "Neue Version: v$NEW_VERSION"

echo
echo "Alle Änderungen vormerken..."
git add -A
if [[ $? -ne 0 ]]; then
  echo "FEHLER: Dateien konnten nicht vorgemerkt werden."
  pause_before_exit
  exit 1
fi

MESSAGE="${1:-release: v$NEW_VERSION}"
echo
echo "Commit: $MESSAGE"
if ! git commit -m "$MESSAGE"; then
  echo "FEHLER: Commit fehlgeschlagen."
  pause_before_exit
  exit 1
fi

echo
echo "Lade den Commit nach GitHub hoch ..."
if ! git push origin main; then
  echo "FEHLER: Push auf main fehlgeschlagen."
  pause_before_exit
  exit 1
fi

echo
echo "========================================"
echo "Erfolgreich!"
echo "Version v$NEW_VERSION wurde veröffentlicht."
echo "GitHub Pages aktualisiert jetzt die PWA."
echo "(APK-Build bleibt unberührt und kann bei Bedarf in GitHub Actions ausgelöst werden.)"
echo "========================================"
pause_before_exit
