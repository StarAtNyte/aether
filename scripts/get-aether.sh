#!/usr/bin/env bash
# Install or update Aether on this computer and start it.
#
#   curl -fsSL https://raw.githubusercontent.com/StarAtNyte/aether/main/scripts/get-aether.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/StarAtNyte/aether/main/scripts/get-aether.sh | bash -s -- --origin https://aether-studio-lyart.vercel.app
#
# It clones (or updates) the repository into $AETHER_DIR (default ~/aether), runs `npm ci`, then
# `npm run aether -- start`, passing any arguments through (default: --open). The studio then uses
# your own signed-in Claude Code (`claude`) or Codex (`codex`) CLI: your subscription, no API key.
set -euo pipefail

REPO="${AETHER_REPO:-https://github.com/StarAtNyte/aether}"
DIR="${AETHER_DIR:-$HOME/aether}"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is not installed (https://git-scm.com/downloads)."
command -v node >/dev/null 2>&1 || die "Node.js 24 is not installed (https://nodejs.org, or: nvm install 24)."
command -v npm >/dev/null 2>&1 || die "npm is not installed (it ships with Node.js)."
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 24 ] || die "Aether needs Node.js 24 or newer; this is $(node -v) (try: nvm install 24 && nvm use 24)."

if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"
  git -C "$DIR" pull --ff-only || say "Could not fast-forward $DIR; using it as it is."
elif [ -e "$DIR" ]; then
  die "$DIR exists and is not an Aether checkout. Set AETHER_DIR to another folder."
else
  say "Downloading Aether into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"
say "Installing dependencies (first time takes a few minutes)"
npm ci --no-audit --no-fund

found=""
command -v claude >/dev/null 2>&1 && found="Claude Code"
command -v codex >/dev/null 2>&1 && found="${found:+$found and }Codex"
if [ -n "$found" ]; then say "Found $found: Aether will use your own login."
else say "No claude or codex CLI found. Install one and sign in to build with your subscription, or continue offline."; fi

[ "$#" -gt 0 ] || set -- --open
say "Starting Aether"
npm run --silent aether -- start "$@"
echo
say "Next time: cd $DIR && npm run aether -- start --open   (stop: npm run aether -- stop)"
