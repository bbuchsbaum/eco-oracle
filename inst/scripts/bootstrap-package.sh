#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER_REPO="${ECO_REGISTRY_REPO:-bbuchsbaum/eco-registry}"
REPO_REF="${ECO_REGISTRY_REF:-main}"
REPO_RAW_BASE="${ECO_REGISTRY_RAW_BASE:-https://raw.githubusercontent.com/${REPO_OWNER_REPO}/${REPO_REF}}"
SET_SECRET_DEFAULT="${ECO_SET_OPENAI_SECRET:-1}"          # 1|0
SECRET_SCOPE="${ECO_OPENAI_SECRET_SCOPE:-repo}"           # repo|org
SECRET_NAME="${ECO_OPENAI_SECRET_NAME:-OPENAI_API_KEY}"
TEMPLATE_OVERWRITE="${ECO_TEMPLATE_OVERWRITE:-0}"         # 1 overwrites existing templates

if [[ ! -f "DESCRIPTION" ]]; then
  echo "[bootstrap] ERROR: DESCRIPTION not found. Run this from an R package repo root." >&2
  exit 1
fi

pkg_name="$(awk -F': *' '/^Package:/ {print $2; exit}' DESCRIPTION | tr -d '\r')"
if [[ -z "${pkg_name}" ]]; then
  echo "[bootstrap] ERROR: Could not parse Package from DESCRIPTION." >&2
  exit 1
fi

default_role="${ECO_ROLE:-transform}"
default_tags="${ECO_TAGS:-domain-tag,workflow-tag}"

mkdir -p .github/workflows tools

write_ecosystem_yml() {
  if [[ -f ".ecosystem.yml" ]]; then
    echo "[bootstrap] .ecosystem.yml already exists; leaving as-is."
    return
  fi

  IFS=',' read -r -a tags <<< "${default_tags}"

  {
    echo "ecosystem: true"
    echo "package: ${pkg_name}"
    echo "language: R"
    echo "# REQUIRED: replace placeholders before commit"
    echo "# role examples: ingest, clean, transform, model, io, viz"
    echo "role: ${default_role}"
    echo "tags:"
    for t in "${tags[@]}"; do
      tag_trimmed="$(echo "${t}" | xargs)"
      [[ -n "${tag_trimmed}" ]] && echo "  - ${tag_trimmed}"
    done
    echo "# REQUIRED: add canonical exported functions used by consumers"
    echo "# example: ${pkg_name}::main_fn"
    echo "entrypoints: []"
    echo "release_tag: eco-atlas"
    echo "asset: atlas-pack.tgz"
  } > .ecosystem.yml

  echo "[bootstrap] Wrote .ecosystem.yml"
  echo "[bootstrap] IMPORTANT: update .ecosystem.yml role/tags/entrypoints before commit."
}

fetch_template() {
  local remote_path="$1"
  local local_path="$2"
  if [[ -f "${local_path}" && "${TEMPLATE_OVERWRITE}" != "1" ]]; then
    echo "[bootstrap] ${local_path} already exists; leaving as-is."
    return
  fi
  if command -v gh >/dev/null 2>&1; then
    if gh api "repos/${REPO_OWNER_REPO}/contents/${remote_path}?ref=${REPO_REF}" \
      -H "Accept: application/vnd.github.raw" > "${local_path}" 2>/dev/null; then
      echo "[bootstrap] Wrote ${local_path} (via gh api)"
      return
    fi
  fi

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      "${REPO_RAW_BASE}/${remote_path}" -o "${local_path}"
    echo "[bootstrap] Wrote ${local_path} (via token-auth curl)"
    return
  fi

  curl -fsSL "${REPO_RAW_BASE}/${remote_path}" -o "${local_path}"
  echo "[bootstrap] Wrote ${local_path}"
}

infer_repo_slug() {
  if [[ -n "${ECO_TARGET_REPO:-}" ]]; then
    echo "${ECO_TARGET_REPO}"
    return 0
  fi

  if command -v gh >/dev/null 2>&1; then
    local gh_slug
    gh_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
    if [[ -n "${gh_slug}" ]]; then
      echo "${gh_slug}"
      return 0
    fi
  fi

  local remote
  remote="$(git config --get remote.origin.url 2>/dev/null || true)"
  remote="${remote%.git}"

  if [[ "${remote}" =~ ^git@github.com:(.+/.+)$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "${remote}" =~ ^https://github.com/(.+/.+)$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "${remote}" =~ ^http://github.com/(.+/.+)$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

set_openai_secret() {
  if [[ "${SET_SECRET_DEFAULT}" == "0" ]]; then
    echo "[bootstrap] Skipping secret setup (ECO_SET_OPENAI_SECRET=0)."
    return
  fi

  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    echo "[bootstrap] OPENAI_API_KEY not present in shell; skipping secret setup."
    return
  fi

  if ! command -v gh >/dev/null 2>&1; then
    echo "[bootstrap] gh CLI not found; cannot set ${SECRET_NAME} automatically."
    return
  fi

  local slug
  slug="$(infer_repo_slug || true)"
  if [[ -z "${slug}" ]]; then
    echo "[bootstrap] Could not infer owner/repo; skipping secret setup."
    return
  fi

  local owner repo
  owner="${slug%%/*}"
  repo="${slug#*/}"

  if [[ "${SECRET_SCOPE}" == "org" ]]; then
    printf "%s" "${OPENAI_API_KEY}" | gh secret set "${SECRET_NAME}" --org "${owner}" --repos "${repo}"
    echo "[bootstrap] Set ${SECRET_NAME} at org scope for repo ${slug}."
    return
  fi

  printf "%s" "${OPENAI_API_KEY}" | gh secret set "${SECRET_NAME}" --repo "${slug}"
  echo "[bootstrap] Set ${SECRET_NAME} in repo ${slug}."
}

write_ecosystem_yml
fetch_template "templates/.github/workflows/eco-atlas.yml" ".github/workflows/eco-atlas.yml"
fetch_template "templates/tools/eco_atlas_extract.R" "tools/eco_atlas_extract.R"
fetch_template "templates/tools/eco_atlas_distill.mjs" "tools/eco_atlas_distill.mjs"
set_openai_secret

cat <<MSG

[bootstrap] Done.

Next steps:
1. Edit .ecosystem.yml with package-specific role, tags, and entrypoints.
2. Commit and push these files.
3. Trigger workflow (or push to main/master):
   gh workflow run eco-atlas.yml
4. Trigger registry discovery:
   gh workflow run discover-registry.yml --repo ${REPO_OWNER_REPO}

Definition of done:
- Release tag eco-atlas contains atlas-pack.tgz
- ${REPO_OWNER_REPO} registry.json includes ${pkg_name}
- eco_refresh shows package in MCP clients
MSG
