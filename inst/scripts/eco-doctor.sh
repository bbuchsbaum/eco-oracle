#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REGISTRY_URL="https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/registry.json"

COMMAND="${1:-}"
if [[ $# -gt 0 ]]; then
  shift
fi

REPO="${ECO_TARGET_REPO:-}"
REGISTRY_URL="${ECO_REGISTRY_URL:-$DEFAULT_REGISTRY_URL}"
TAG="${ECO_RELEASE_TAG:-eco-atlas}"
ASSET="${ECO_RELEASE_ASSET:-atlas-pack.tgz}"
JSON=0

pass_count=0
warn_count=0
fail_count=0
checks_file=""

usage() {
  cat <<'MSG'
EcoDoctor: validate package onboarding, release asset health, and registry presence.

Usage:
  eco-doctor repo [--json]
  eco-doctor release --repo <owner/repo> [--tag eco-atlas] [--asset atlas-pack.tgz] [--json]
  eco-doctor registry --repo <owner/repo> [--registry-url <url-or-path>] [--json]

Examples:
  eco-doctor repo
  eco-doctor release --repo bbuchsbaum/fmrihrf
  eco-doctor registry --repo bbuchsbaum/fmrihrf --registry-url https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/registry.json
MSG
}

die_usage() {
  echo "[eco-doctor] $1" >&2
  usage >&2
  exit 2
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[eco-doctor] Missing required command: $1" >&2
    exit 2
  fi
}

init_checks() {
  checks_file="$(mktemp)"
  trap 'rm -f "$checks_file"' EXIT
}

print_check() {
  local status="$1"
  local id="$2"
  local detail="$3"
  local up
  up="$(echo "$status" | tr '[:lower:]' '[:upper:]')"
  printf "[%s] %s - %s\n" "$up" "$id" "$detail"
}

add_check() {
  local status="$1"
  local id="$2"
  local detail="$3"

  if [[ "$JSON" -eq 0 ]]; then
    print_check "$status" "$id" "$detail"
  fi

  jq -nc \
    --arg id "$id" \
    --arg status "$status" \
    --arg detail "$detail" \
    '{id: $id, status: $status, detail: $detail}' >> "$checks_file"

  case "$status" in
    pass) pass_count=$((pass_count + 1)) ;;
    warn) warn_count=$((warn_count + 1)) ;;
    fail) fail_count=$((fail_count + 1)) ;;
  esac
}

finish() {
  local overall="pass"
  if (( fail_count > 0 )); then
    overall="fail"
  elif (( warn_count > 0 )); then
    overall="warn"
  fi

  if [[ "$JSON" -eq 1 ]]; then
    jq -s \
      --arg command "$COMMAND" \
      --arg status "$overall" \
      --argjson pass "$pass_count" \
      --argjson warn "$warn_count" \
      --argjson fail "$fail_count" \
      '{
        command: $command,
        status: $status,
        counts: { pass: $pass, warn: $warn, fail: $fail },
        checks: .
      }' "$checks_file"
  else
    echo
    echo "Summary: PASS=${pass_count} WARN=${warn_count} FAIL=${fail_count}"
  fi

  if (( fail_count > 0 )); then
    exit 1
  fi
}

infer_repo_from_git() {
  local remote
  remote="$(git config --get remote.origin.url 2>/dev/null || true)"
  remote="${remote%.git}"

  if [[ "$remote" =~ ^git@github.com:(.+/.+)$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$remote" =~ ^https://github.com/(.+/.+)$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$remote" =~ ^http://github.com/(.+/.+)$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

yaml_list_items() {
  local key="$1"
  local file="$2"

  awk -v key="$key" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    BEGIN { in_block = 0 }
    {
      line = $0
      if (!in_block && line ~ ("^" key ":[[:space:]]*\\[")) {
        sub("^" key ":[[:space:]]*\\[", "", line)
        sub("\\][[:space:]]*$", "", line)
        n = split(line, parts, ",")
        for (i = 1; i <= n; i++) {
          item = trim(parts[i])
          if (item != "") print item
        }
        exit
      }
      if (!in_block && line ~ ("^" key ":[[:space:]]*$")) {
        in_block = 1
        next
      }
      if (in_block) {
        if (line ~ /^[[:space:]]*-[[:space:]]+/) {
          sub(/^[[:space:]]*-[[:space:]]+/, "", line)
          sub(/[[:space:]]+#.*/, "", line)
          item = trim(line)
          if (item != "") print item
          next
        }
        if (line ~ /^[[:space:]]*$/) next
        if (line !~ /^[[:space:]]/) exit
      }
    }
  ' "$file"
}

strip_quotes() {
  local x="$1"
  x="${x%\"}"
  x="${x#\"}"
  x="${x%\'}"
  x="${x#\'}"
  echo "$x"
}

run_repo_checks() {
  need_cmd jq

  add_check pass "mode" "Running repository-local checks"

  if [[ -f ".ecosystem.yml" ]]; then
    add_check pass "ecosystem_file" ".ecosystem.yml exists"
  else
    add_check fail "ecosystem_file" "Missing .ecosystem.yml"
  fi

  if [[ -f ".github/workflows/eco-atlas.yml" ]]; then
    add_check pass "workflow_file" ".github/workflows/eco-atlas.yml exists"
  else
    add_check fail "workflow_file" "Missing .github/workflows/eco-atlas.yml"
  fi

  if [[ -f "tools/eco_atlas_extract.R" ]]; then
    add_check pass "extractor_file" "tools/eco_atlas_extract.R exists"
  else
    add_check fail "extractor_file" "Missing tools/eco_atlas_extract.R"
  fi

  if [[ -f "tools/eco_atlas_distill.mjs" ]]; then
    add_check pass "distill_file" "tools/eco_atlas_distill.mjs exists"
  else
    add_check fail "distill_file" "Missing tools/eco_atlas_distill.mjs"
  fi

  if [[ ! -f ".ecosystem.yml" ]]; then
    return
  fi

  local role
  role="$(awk -F': *' '/^role:[[:space:]]*/ {sub(/^role:[[:space:]]*/, ""); print; exit}' .ecosystem.yml)"
  role="$(strip_quotes "${role:-}")"
  if [[ -n "${role}" ]]; then
    add_check pass "role" "role=${role}"
  else
    add_check fail "role" "Missing role in .ecosystem.yml"
  fi

  local tags
  tags="$(yaml_list_items "tags" ".ecosystem.yml" || true)"
  local tag_count
  tag_count="$(printf "%s\n" "$tags" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"
  if [[ "${tag_count}" -gt 0 ]]; then
    add_check pass "tags_count" "tags=${tag_count}"
  else
    add_check fail "tags_count" "No tags found in .ecosystem.yml"
  fi

  if grep -Eq 'domain-tag|workflow-tag' .ecosystem.yml; then
    add_check fail "tags_placeholder" "Placeholder tags still present (domain-tag/workflow-tag)"
  else
    add_check pass "tags_placeholder" "No placeholder tags detected"
  fi

  local entrypoints
  entrypoints="$(yaml_list_items "entrypoints" ".ecosystem.yml" || true)"
  local ep_count
  ep_count="$(printf "%s\n" "$entrypoints" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"
  if [[ "${ep_count}" -gt 0 ]]; then
    add_check pass "entrypoints_count" "entrypoints=${ep_count}"
  else
    add_check fail "entrypoints_count" "No entrypoints found in .ecosystem.yml"
  fi

  local not_namespaced=0
  local ep
  while IFS= read -r ep; do
    ep="$(strip_quotes "$ep")"
    [[ -z "$ep" ]] && continue
    if [[ "$ep" != *::* ]]; then
      not_namespaced=$((not_namespaced + 1))
    fi
  done <<< "$entrypoints"
  if [[ "$not_namespaced" -eq 0 ]]; then
    add_check pass "entrypoints_namespace" "All entrypoints are namespaced"
  else
    add_check warn "entrypoints_namespace" "${not_namespaced} entrypoint(s) are not namespaced (expected pkg::fn)"
  fi

  if [[ -f "manual_cards.jsonl" ]]; then
    local line_no=0
    local bad_json=0
    local bad_schema=0
    while IFS= read -r line || [[ -n "$line" ]]; do
      line_no=$((line_no + 1))
      [[ -z "${line//[[:space:]]/}" ]] && continue
      if ! printf "%s\n" "$line" | jq -e . >/dev/null 2>&1; then
        bad_json=$((bad_json + 1))
        continue
      fi
      if ! printf "%s\n" "$line" | jq -e '(.q|type=="string" and length>0) and (.a|type=="string" and length>0) and (.recipe|type=="string" and length>0) and (.symbols|type=="array" and length>0)' >/dev/null 2>&1; then
        bad_schema=$((bad_schema + 1))
      fi
    done < "manual_cards.jsonl"

    if [[ "$bad_json" -gt 0 || "$bad_schema" -gt 0 ]]; then
      add_check fail "manual_cards" "manual_cards.jsonl invalid lines: json=${bad_json} schema=${bad_schema}"
    else
      add_check pass "manual_cards" "manual_cards.jsonl is valid"
    fi
  else
    add_check warn "manual_cards" "manual_cards.jsonl not found (optional)"
  fi
}

run_release_checks() {
  need_cmd jq
  need_cmd curl
  need_cmd tar

  if [[ -z "${REPO}" ]]; then
    REPO="$(infer_repo_from_git || true)"
  fi
  if [[ -z "${REPO}" ]]; then
    add_check fail "repo" "Missing --repo and could not infer from git remote"
    return
  fi
  add_check pass "repo" "repo=${REPO}"

  local api_url="https://api.github.com/repos/${REPO}/releases/tags/${TAG}"
  local headers=("-H" "Accept: application/vnd.github+json")
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    headers+=("-H" "Authorization: Bearer ${GITHUB_TOKEN}")
  fi

  local release_json
  release_json="$(curl -fsSL "${headers[@]}" "$api_url" 2>/dev/null || true)"
  if [[ -z "$release_json" ]]; then
    add_check fail "release_tag" "Release tag not found: ${TAG}"
    return
  fi
  add_check pass "release_tag" "Release tag exists: ${TAG}"

  local asset_url
  asset_url="$(printf "%s" "$release_json" | jq -r --arg asset "$ASSET" '.assets[]? | select(.name==$asset) | .browser_download_url' | head -n1)"
  if [[ -z "$asset_url" || "$asset_url" == "null" ]]; then
    add_check fail "release_asset" "Missing asset ${ASSET} on release ${TAG}"
    return
  fi
  add_check pass "release_asset" "Found asset ${ASSET}"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  local pack_path="${tmp_dir}/${ASSET}"
  local curl_args=(-fsSL -L "$asset_url" -o "$pack_path")
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl_args=(-fsSL -L -H "Authorization: Bearer ${GITHUB_TOKEN}" "$asset_url" -o "$pack_path")
  fi

  if curl "${curl_args[@]}"; then
    add_check pass "asset_download" "Downloaded ${ASSET}"
  else
    add_check fail "asset_download" "Failed to download ${ASSET}"
    rm -rf "$tmp_dir"
    return
  fi

  local tar_list
  tar_list="$(tar -tzf "$pack_path" 2>/dev/null || true)"
  if [[ -z "$tar_list" ]]; then
    add_check fail "asset_tgz" "Asset is not a readable .tgz archive"
    rm -rf "$tmp_dir"
    return
  fi
  add_check pass "asset_tgz" "Archive is readable"

  local required=(
    "atlas/manifest.json"
    "atlas/cards.jsonl"
    "atlas/symbols.jsonl"
  )
  local req
  for req in "${required[@]}"; do
    if printf "%s\n" "$tar_list" | grep -Fxq "$req"; then
      add_check pass "archive_${req##*/}" "Contains ${req}"
    else
      add_check fail "archive_${req##*/}" "Missing ${req}"
    fi
  done

  local cards_count=0
  local symbols_count=0
  local edges_count=0
  cards_count="$(tar -xOf "$pack_path" atlas/cards.jsonl 2>/dev/null | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ' || true)"
  symbols_count="$(tar -xOf "$pack_path" atlas/symbols.jsonl 2>/dev/null | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ' || true)"
  edges_count="$(tar -xOf "$pack_path" atlas/edges.jsonl 2>/dev/null | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ' || true)"

  if [[ "${cards_count:-0}" -gt 0 ]]; then
    add_check pass "cards_count" "cards=${cards_count}"
  else
    add_check fail "cards_count" "cards=0"
  fi
  if [[ "${symbols_count:-0}" -gt 0 ]]; then
    add_check pass "symbols_count" "symbols=${symbols_count}"
  else
    add_check fail "symbols_count" "symbols=0"
  fi
  if [[ "${edges_count:-0}" -gt 0 ]]; then
    add_check pass "edges_count" "edges=${edges_count}"
  else
    add_check warn "edges_count" "edges=0 (optional)"
  fi

  rm -rf "$tmp_dir"
}

run_registry_checks() {
  need_cmd jq
  need_cmd curl

  if [[ -z "${REPO}" ]]; then
    REPO="$(infer_repo_from_git || true)"
  fi
  if [[ -z "${REPO}" ]]; then
    add_check fail "repo" "Missing --repo and could not infer from git remote"
    return
  fi
  add_check pass "repo" "repo=${REPO}"

  local registry_json=""
  if [[ "${REGISTRY_URL}" =~ ^https?:// ]]; then
    registry_json="$(curl -fsSL "$REGISTRY_URL" 2>/dev/null || true)"
  else
    if [[ -f "$REGISTRY_URL" ]]; then
      registry_json="$(cat "$REGISTRY_URL")"
    fi
  fi

  if [[ -z "$registry_json" ]]; then
    add_check fail "registry_fetch" "Failed to read registry from ${REGISTRY_URL}"
    return
  fi
  add_check pass "registry_fetch" "Loaded registry from ${REGISTRY_URL}"

  local entry
  entry="$(printf "%s" "$registry_json" | jq -c --arg repo "$REPO" '.[] | select(.repo==$repo)' | head -n1)"
  if [[ -z "$entry" ]]; then
    add_check fail "registry_entry" "Repo not found in registry: ${REPO}"
    return
  fi
  add_check pass "registry_entry" "Repo present in registry"

  local role tags_count eps_count atlas_url last_updated
  role="$(printf "%s" "$entry" | jq -r '.role // ""')"
  tags_count="$(printf "%s" "$entry" | jq -r '(.tags // []) | length')"
  eps_count="$(printf "%s" "$entry" | jq -r '(.entrypoints // []) | length')"
  atlas_url="$(printf "%s" "$entry" | jq -r '.atlas_asset_url // ""')"
  last_updated="$(printf "%s" "$entry" | jq -r '.last_updated // ""')"

  if [[ -n "$role" ]]; then
    add_check pass "registry_role" "role=${role}"
  else
    add_check fail "registry_role" "role is empty"
  fi

  if [[ "${tags_count:-0}" -gt 0 ]]; then
    add_check pass "registry_tags" "tags=${tags_count}"
  else
    add_check fail "registry_tags" "tags are empty"
  fi

  if [[ "${eps_count:-0}" -gt 0 ]]; then
    add_check pass "registry_entrypoints" "entrypoints=${eps_count}"
  else
    add_check warn "registry_entrypoints" "entrypoints are empty"
  fi

  if [[ -n "$atlas_url" ]]; then
    add_check pass "registry_atlas_url" "atlas_asset_url present"
    if curl -fsSI -L "$atlas_url" >/dev/null 2>&1; then
      add_check pass "registry_atlas_url_reachable" "atlas_asset_url reachable"
    else
      add_check fail "registry_atlas_url_reachable" "atlas_asset_url not reachable"
    fi
  else
    add_check fail "registry_atlas_url" "atlas_asset_url is empty"
  fi

  if [[ -n "$last_updated" ]]; then
    add_check pass "registry_last_updated" "last_updated=${last_updated}"
  else
    add_check warn "registry_last_updated" "last_updated missing"
  fi
}

if [[ -z "${COMMAND}" ]]; then
  usage
  exit 2
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      [[ $# -lt 2 ]] && die_usage "Missing value for --repo"
      REPO="$2"
      shift 2
      ;;
    --registry-url)
      [[ $# -lt 2 ]] && die_usage "Missing value for --registry-url"
      REGISTRY_URL="$2"
      shift 2
      ;;
    --tag)
      [[ $# -lt 2 ]] && die_usage "Missing value for --tag"
      TAG="$2"
      shift 2
      ;;
    --asset)
      [[ $# -lt 2 ]] && die_usage "Missing value for --asset"
      ASSET="$2"
      shift 2
      ;;
    --json)
      JSON=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die_usage "Unknown argument: $1"
      ;;
  esac
done

init_checks

case "$COMMAND" in
  repo)
    run_repo_checks
    ;;
  release)
    run_release_checks
    ;;
  registry)
    run_registry_checks
    ;;
  *)
    die_usage "Unknown command: ${COMMAND}"
    ;;
esac

finish
