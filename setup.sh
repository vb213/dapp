#!/usr/bin/env bash
# Source this file or run: ./setup.sh
set -e
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd "$(dirname "$0")"
nvm install
nvm use
echo "Node: $(node -v) — npm: $(npm -v)"
if [ ! -d node_modules ]; then
  npm install
fi
echo "OK. Run: npm run node  (terminal 1)  |  npm run deploy  (terminal 2)"
