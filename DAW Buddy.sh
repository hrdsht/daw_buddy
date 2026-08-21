#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ -f "./scripts/DAW Buddy.sh" ]; then
    exec ./scripts/"DAW Buddy.sh"
else
    command -v node >/dev/null 2>&1 || { echo "Node.js is required. Install from https://nodejs.org/"; exit 1; }
    [ -d "node_modules/electron" ] || npm install
    npm start
fi
