#!/usr/bin/env bash
set -euo pipefail

REGISTRY_REPO="${ECO_REGISTRY_REPO:-bbuchsbaum/eco-registry}"
REGISTRY_REF="${ECO_REGISTRY_REF:-main}"
RAW_BASE="https://raw.githubusercontent.com/${REGISTRY_REPO}/${REGISTRY_REF}"

CODEX_SKILL_DIR="${ECO_CODEX_SKILL_DIR:-$HOME/.codex/skills/eco-fill-directives}"
CLAUDE_COMMANDS_DIR="${ECO_CLAUDE_COMMANDS_DIR:-$HOME/.claude/commands}"

fetch_raw_file() {
  local remote_path="$1"
  local out_path="$2"

  if command -v gh >/dev/null 2>&1; then
    if gh api "repos/${REGISTRY_REPO}/contents/${remote_path}?ref=${REGISTRY_REF}" \
      -H "Accept: application/vnd.github.raw" > "${out_path}" 2>/dev/null; then
      return 0
    fi
  fi

  curl -fsSL "${RAW_BASE}/${remote_path}" -o "${out_path}"
}

echo "[install] Installing Codex skill to: ${CODEX_SKILL_DIR}"
mkdir -p "${CODEX_SKILL_DIR}"
fetch_raw_file "skills/eco-fill-directives/SKILL.md" "${CODEX_SKILL_DIR}/SKILL.md"

echo "[install] Installing Claude command helper to: ${CLAUDE_COMMANDS_DIR}/eco-fill.md"
mkdir -p "${CLAUDE_COMMANDS_DIR}"
cat > "${CLAUDE_COMMANDS_DIR}/eco-fill.md" <<'MD'
# eco-fill

Use the `eco-fill-directives` behavior for this task.

Instructions:
1. Parse comment directives flexibly (eco-oracle/ecooracle/eco + howto/use/create/build/load), including minor typos.
2. For each directive:
   - call `eco_howto`
   - call `eco_symbol` for selected functions
   - insert runnable ecosystem code directly below the directive
3. Preserve existing code outside generated blocks.
4. End response with:
   - `Ecosystem packages used: ...`
   - `Functions used: ...`
   - `Fallback needed: yes/no`
MD

cat <<MSG
[install] Done.

Installed:
- Codex skill: ${CODEX_SKILL_DIR}/SKILL.md
- Claude helper command: ${CLAUDE_COMMANDS_DIR}/eco-fill.md

Usage:
- Codex: "Use the eco-fill-directives skill for this file."
- Claude: run /eco-fill, then provide the target script path.
MSG
