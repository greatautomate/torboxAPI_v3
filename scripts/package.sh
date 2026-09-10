#!/usr/bin/env bash
# Builds a distributable zip of the project (sources + docs, no node_modules/dist/.env).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="${1:-$ROOT/../newtorboxapi.zip}"
cd "$ROOT/.."
rm -f "$OUT"
zip -qr "$OUT" "$(basename "$ROOT")" -x "*/node_modules/*" "*/dist/*" "*/.env" "*/.env.local" "*/.env.production" "*/.env.development" "*/coverage/*" "*/.DS_Store" "*/.vite/*"
echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
