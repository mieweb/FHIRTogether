#!/usr/bin/env bash
#
# Reset the local FHIRTogether environment to a clean, freshly-seeded state.
#
# Steps:
#   1. Stop the fhirtogether systemd service.
#   2. Remove the SQLite database files.
#   3. Start the service back up.
#   4. Wait for the server to become healthy, then regenerate test data.
#
# Run manually:   ./scripts/reset.sh
# Run via systemd: see deploy/fhirtogether-reset.service
set -euo pipefail

# Resolve the repo root regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Stopping fhirtogether service"
sudo systemctl stop fhirtogether

echo "==> Removing SQLite database files"
rm -f data/fhirtogether.db*

echo "==> Starting fhirtogether service"
sudo systemctl start fhirtogether

echo "==> Waiting for server to become healthy"
for i in $(seq 1 30); do
  if curl -sf http://localhost:4010/health >/dev/null; then
    break
  fi
  sleep 1
done

echo "==> Regenerating test data"
npm run generate-data

echo "==> Reset complete"
