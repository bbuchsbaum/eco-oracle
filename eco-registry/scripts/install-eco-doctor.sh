#!/usr/bin/env bash
set -euo pipefail

REGISTRY_REPO="${ECO_REGISTRY_REPO:-bbuchsbaum/eco-registry}"
REGISTRY_REF="${ECO_REGISTRY_REF:-main}"
RAW_BASE="https://raw.githubusercontent.com/${REGISTRY_REPO}/${REGISTRY_REF}"
TARGET_PATH="${ECO_DOCTOR_PATH:-$HOME/.local/bin/eco-doctor}"

echo "[install] Installing EcoDoctor at: ${TARGET_PATH}"
mkdir -p "$(dirname "${TARGET_PATH}")"

if command -v gh >/dev/null 2>&1; then
  if gh api "repos/${REGISTRY_REPO}/contents/scripts/eco-doctor.sh?ref=${REGISTRY_REF}" \
    -H "Accept: application/vnd.github.raw" > "${TARGET_PATH}" 2>/dev/null; then
    chmod +x "${TARGET_PATH}"
    echo "[install] Installed via gh api."
    echo "[install] Run: eco-doctor repo"
    exit 0
  fi
fi

curl -fsSL "${RAW_BASE}/scripts/eco-doctor.sh" -o "${TARGET_PATH}"
chmod +x "${TARGET_PATH}"

echo "[install] Installed via curl."
echo "[install] Run: eco-doctor repo"
