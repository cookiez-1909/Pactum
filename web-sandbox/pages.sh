#!/bin/bash
# Builds the GitHub Pages site in web/dist: the in-browser sandbox by default, and the real testnet case at ?live.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if ss -ltn 2>/dev/null | grep -qE ':(8546) '; then
  echo "Port 8546 is in use. Stop make web-local first."
  exit 1
fi
(cd "$ROOT/contracts" && forge build > /dev/null)
(cd "$ROOT/web-sandbox" && npm ci --no-audit --no-fund > /dev/null && npm run build)

# Creates the sample data on Anvil as make web-local does, records the chain, then stops Anvil.
rm -f "$ROOT/web/public/deployment.json"
setsid bash -c "cd '$ROOT/scripts' && exec npx tsx seed.ts" > "$ROOT/web-sandbox/seed.log" 2>&1 &
SEED=$!
trap 'kill -- "-$SEED" 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do
  grep -q '"incidents"' "$ROOT/web/public/deployment.json" 2>/dev/null && break
  sleep 1
done
node "$ROOT/web-sandbox/capture.mjs"
kill -- "-$SEED" 2>/dev/null || true

# The default build reads the real Sepolia case. Rename it to live.json and make the sandbox the default.
(cd "$ROOT/web" && npm run build > /dev/null)
mv "$ROOT/web/dist/deployment.json" "$ROOT/web/dist/live.json"
mv "$ROOT/web/dist/sandbox-deployment.json" "$ROOT/web/dist/deployment.json"
touch "$ROOT/web/dist/.nojekyll"
echo "Site built in web/dist"
