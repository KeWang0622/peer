#!/usr/bin/env bash
# peer installer — one line: curl -fsSL https://peer.pika.me/install.sh | sh
set -euo pipefail

REPO="https://github.com/KeWang0622/peer.git"
DEST="${PEER_INSTALL_DIR:-$HOME/.peer-src}"
NODE_MIN=22

color() { printf "\033[%sm%s\033[0m" "$1" "$2"; }
ok()    { color "32" "✓ "; printf "%s\n" "$1"; }
note()  { color "36" "→ "; printf "%s\n" "$1"; }
warn()  { color "33" "⚠ "; printf "%s\n" "$1" >&2; }
die()   { color "31" "✗ "; printf "%s\n" "$1" >&2; exit 1; }

note "peer installer · researcher-friendly AI agent for your terminal"

# 1. Node
command -v node >/dev/null || die "node not found. Install Node.js 22+ first (https://nodejs.org)"
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_VER" -ge "$NODE_MIN" ] || die "node $NODE_MIN+ required (you have $(node -v))"
ok "node $(node -v)"

# 2. Git
command -v git >/dev/null || die "git not found"
ok "git $(git --version | awk '{print $3}')"

# 3. Clone / update
if [ -d "$DEST/.git" ]; then
  note "updating existing checkout at $DEST"
  git -C "$DEST" fetch --tags --quiet
  git -C "$DEST" pull --ff-only --quiet
else
  note "cloning into $DEST"
  git clone --depth=1 --quiet "$REPO" "$DEST"
fi
ok "source ready"

# 4. Build
( cd "$DEST" && npm install --silent && npm run build --silent )
ok "built"

# 5. Link
( cd "$DEST" && npm link --silent )
ok "linked as 'peer' in your PATH"

# 6. Doctor
echo
note "running peer doctor:"
echo
peer doctor || warn "some checks failed — set ANTHROPIC_API_KEY and OPENAI_API_KEY and re-run 'peer doctor'"

echo
ok "installed. Try: peer onboard"
echo
note "set up: https://github.com/KeWang0622/peer#install"
