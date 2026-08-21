#!/bin/bash

# ---------------------------------------------------------------
#  The macOS equivalent of DAW Buddy.bat — double-click to run.
#
#  One extra step on a Mac: the file needs permission to execute.
#  Open Terminal once and run:
#
#      chmod +x "DAW Buddy.command"
#
#  You only do this once.
# ---------------------------------------------------------------

# cd to the project root directory where this script sits
cd "$(dirname "$0")" || exit 1

echo
echo "  DAW BUDDY"
echo "  ---------------"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js isn't installed, or the shell can't find it."
  echo
  echo "  Install the LTS version from https://nodejs.org"
  echo "  then close this window, open a new one, and try again."
  echo
  read -r -p "  Press return to close."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "  First run — downloading Electron. This takes a few minutes"
  echo "  and only happens once."
  echo
  if ! npm install; then
    echo
    echo "  Install failed. Check your internet connection."
    echo
    read -r -p "  Press return to close."
    exit 1
  fi
  echo
fi

echo "  Starting. Keep this window open while you use the app —"
echo "  closing it quits DAW Buddy."
echo
echo "  New bounces get logged here as they're detected."
echo
echo "  Opening DAW Buddy..."
echo

npm start

status=$?
if [ $status -ne 0 ]; then
  echo
  echo "  DAW Buddy stopped unexpectedly. The error is above."
  echo
  read -r -p "  Press return to close."
fi
