#!/usr/bin/env bash
set -euo pipefail

SERVER_NAME="${ECO_MCP_SERVER_NAME:-eco-oracle}"
INSTALL_TARGET="${ECO_INSTALL_TARGET:-both}" # claude|codex|both
CLAUDE_SCOPE="${ECO_CLAUDE_SCOPE:-user}"     # user|project

REGISTRY_REPO="${ECO_REGISTRY_REPO:-bbuchsbaum/eco-registry}"
REGISTRY_REF="${ECO_REGISTRY_REF:-main}"
REGISTRY_URL_DEFAULT="https://raw.githubusercontent.com/${REGISTRY_REPO}/${REGISTRY_REF}/registry.json"
REGISTRY_URL="${ECO_REGISTRY_URL:-$REGISTRY_URL_DEFAULT}"

# Default runtime command (works once eco-oracle-mcp is published to npm).
MCP_EXEC="${ECO_MCP_EXEC:-npx -y eco-oracle-mcp}"

WRAPPER_PATH="${ECO_WRAPPER_PATH:-$HOME/.local/bin/eco-oracle-mcp-launch}"

echo "[install] Installing EcoOracle MCP launcher at: ${WRAPPER_PATH}"
mkdir -p "$(dirname "${WRAPPER_PATH}")"

# If user keeps default npm command, verify package availability up front.
if [[ "${MCP_EXEC}" == "npx -y eco-oracle-mcp" ]]; then
  if ! npm view eco-oracle-mcp version >/dev/null 2>&1; then
    cat >&2 <<'ERR'
[install] eco-oracle-mcp is not currently available on npm.

Use one of these options:
1) Set ECO_MCP_EXEC to a source-built server command, e.g.
   ECO_MCP_EXEC='node /absolute/path/to/eco-oracle/packages/eco-oracle-mcp/dist/index.js'
2) Publish eco-oracle-mcp to npm, then rerun this installer.
ERR
    exit 1
  fi
fi

cat > "${WRAPPER_PATH}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export ECO_REGISTRY_URL="${REGISTRY_URL}"
if [[ -n "\${ECO_GITHUB_TOKEN:-}" ]]; then
  export ECO_GITHUB_TOKEN
fi
exec ${MCP_EXEC} "\$@"
EOF

chmod +x "${WRAPPER_PATH}"
echo "[install] Wrote launcher script."

register_claude() {
  if ! command -v claude >/dev/null 2>&1; then
    echo "[install] Claude CLI not found; skipping Claude registration."
    return 0
  fi
  echo "[install] Registering with Claude (${CLAUDE_SCOPE} scope)..."
  claude mcp add --transport stdio "${SERVER_NAME}" --scope "${CLAUDE_SCOPE}" -- "${WRAPPER_PATH}"
}

register_codex() {
  if ! command -v codex >/dev/null 2>&1; then
    echo "[install] Codex CLI not found; skipping Codex registration."
    return 0
  fi
  echo "[install] Registering with Codex..."
  codex mcp add "${SERVER_NAME}" -- "${WRAPPER_PATH}"
}

case "${INSTALL_TARGET}" in
  claude) register_claude ;;
  codex) register_codex ;;
  both)
    register_claude
    register_codex
    ;;
  *)
    echo "[install] Invalid ECO_INSTALL_TARGET: ${INSTALL_TARGET} (expected claude|codex|both)" >&2
    exit 1
    ;;
esac

cat <<MSG
[install] Done.

Server name: ${SERVER_NAME}
Registry URL: ${REGISTRY_URL}
Launcher: ${WRAPPER_PATH}

Quick check from client:
- call eco_refresh
- call eco_packages
MSG
