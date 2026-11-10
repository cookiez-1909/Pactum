#!/bin/bash
# Builds the sample data and the interface, runs the Chromium tests, then stops the processes it started.
# Uses CHROMIUM_PATH if Chromium is already installed, otherwise Playwright's build.
E2E="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$E2E")"
OUT="$E2E/screenshots"
mkdir -p "$OUT"

stop_all() {
  [ -n "$SEED" ] && kill -- "-$SEED" 2>/dev/null
  [ -n "$WEB" ] && kill -- "-$WEB" 2>/dev/null
  sleep 1
}
trap stop_all EXIT

if ss -ltn 2>/dev/null | grep -qE ':(5173|8546) '; then
  echo "Ports 5173 or 8546 are in use. Stop make web-local first."
  exit 1
fi

rm -f "$ROOT/web/public/deployment.json" "$ROOT/web/.env.local"
(cd "$ROOT/contracts" && forge build > /dev/null)
[ -d "$E2E/node_modules/playwright" ] || (cd "$E2E" && npm ci --no-audit --no-fund --ignore-scripts > /dev/null)

setsid bash -c "cd '$ROOT/scripts' && exec npx tsx seed.ts" > "$OUT/seed.log" 2>&1 &
SEED=$!
# Fake keys for the real guardian names, to check which buttons appear for whom. The test never presses these buttons.
export VITE_DEMO_GUARDIANS="$(node -e "const n=require('$ROOT/deployments/sepolia.json').near;console.log(JSON.stringify(n.guardians.map(accountId=>({accountId,secretKey:'ed25519:unused'}))))")"
setsid bash -c "cd '$ROOT/web' && exec npx vite --port 5173 --strictPort" > "$OUT/vite.log" 2>&1 &
WEB=$!

for _ in $(seq 1 120); do
  [ -f "$ROOT/web/public/deployment.json" ] && curl -sf http://localhost:5173/ > /dev/null && break
  sleep 1
done
if [ ! -f "$ROOT/web/public/deployment.json" ]; then
  echo "The seed script did not finish:"
  tail -15 "$OUT/seed.log"
  exit 1
fi

cd "$E2E" && node product.mjs "$OUT"
CODE=$?
rm -f "$ROOT/web/public/deployment.json"
exit $CODE
