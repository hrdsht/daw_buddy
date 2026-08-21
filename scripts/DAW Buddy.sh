#!/usr/bin/env bash
#
# DAW Buddy — Linux launcher
#
# The equivalent of "DAW Buddy.bat". Make it executable once:
#
#     chmod +x "DAW Buddy.sh"
#
# then run it from a file manager or with ./"DAW Buddy.sh".
#
# There is deliberately no platform flag passed to the app. Node already
# knows: process.platform returns 'linux' at runtime, and the code branches
# on that where it needs to. A launcher cannot tell the app anything it
# doesn't already know, and a second set of platform-specific source files
# would drift out of sync with the first.

set -u

# This launcher lives in scripts/; cd to the project root (one level up) so npm
# runs from where package.json is, no matter where it's launched from.
cd "$(dirname "$(readlink -f "$0")")/.." || exit 1

echo
echo "  DAW BUDDY"
echo "  ---------"
echo

# --- Node present? ------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js isn't installed, or the shell can't find it."
  echo
  echo "  Debian/Ubuntu:  sudo apt install nodejs npm"
  echo "  Fedora:         sudo dnf install nodejs"
  echo "  Arch:           sudo pacman -S nodejs npm"
  echo
  echo "  Or use nvm, which avoids the distro's often-outdated packages:"
  echo "    https://github.com/nvm-sh/nvm"
  echo
  read -r -p "  Press return to close."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "  Node $(node -v) is too old — this needs 18 or newer."
  echo
  read -r -p "  Press return to close."
  exit 1
fi

# --- Electron on Linux needs a few system libraries ---------------
# Missing libs produce a linker error at startup that says nothing useful
# about which package to install, so check the common one up front.
if ! ldconfig -p 2>/dev/null | grep -q libgtk-3; then
  echo "  Warning: libgtk-3 wasn't found. Electron needs it to open a window."
  echo
  echo "  Debian/Ubuntu:  sudo apt install libgtk-3-0 libnss3 libasound2"
  echo "  Fedora:         sudo dnf install gtk3 nss alsa-lib"
  echo
  echo "  Continuing anyway — if the window never appears, that's why."
  echo
fi

# --- First run ----------------------------------------------------
if [ ! -d node_modules ]; then
  echo "  First run — downloading Electron. A few minutes, once only."
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

# --- Go -----------------------------------------------------------
echo "  Starting. Keep this window open while you use the app —"
echo "  closing it quits DAW Buddy."
echo
echo "  New bounces get logged here as they're detected."
echo

npm start
status=$?

if [ $status -ne 0 ]; then
  echo
  echo "  DAW Buddy stopped unexpectedly. The error is above."
  echo
  echo "  If it mentions a sandbox or SUID error, this is a known Electron"
  echo "  quirk on some kernels. Try:  npm start -- --no-sandbox"
  echo
  read -r -p "  Press return to close."
fi
