#!/bin/bash
# DAW Buddy 1-Click macOS Launcher
# Double-click in Finder to launch DAW Buddy without terminal commands.

cd "$(dirname "$0")"
if [ -f "./scripts/DAW Buddy.command" ]; then
    exec ./scripts/"DAW Buddy.command"
else
    export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:$PATH"
    [ -d "node_modules" ] || npm install
    npm start
fi
