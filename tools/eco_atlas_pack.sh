#!/usr/bin/env bash
# eco_atlas_pack.sh — Package the atlas directory into atlas-pack.tgz
# Usage: bash tools/eco_atlas_pack.sh [atlas-dir]
set -euo pipefail

ATLAS_DIR="${1:-atlas}"

if [ ! -f "${ATLAS_DIR}/manifest.json" ]; then
  echo "[pack] ERROR: ${ATLAS_DIR}/manifest.json not found" >&2
  exit 1
fi

OUTPUT="atlas-pack.tgz"
tar -czf "${OUTPUT}" -C "$(dirname "${ATLAS_DIR}")" "$(basename "${ATLAS_DIR}")"
echo "[pack] Created ${OUTPUT} ($(du -sh "${OUTPUT}" | cut -f1))"
