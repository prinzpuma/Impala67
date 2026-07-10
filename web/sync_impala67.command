#!/bin/bash
cd "$(dirname "$0")"
node sync-notion.js
echo
read -p "Fertig. Enter druecken zum Schliessen..."
