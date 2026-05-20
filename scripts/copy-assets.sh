#!/usr/bin/env bash
set -euo pipefail
# Copy non-TS assets into dist/ so the compiled JS can find them.
mkdir -p dist/src/db dist/src
cp src/db/schema.sql dist/src/db/schema.sql
cp src/system-prompt.md dist/src/system-prompt.md
chmod +x dist/bin/peer.js
