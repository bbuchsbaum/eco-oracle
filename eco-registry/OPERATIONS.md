# OPERATIONS

This runbook is for operating `bbuchsbaum/eco-registry`.

## Scope

Use this document when:
- nightly discovery fails
- expected packages do not appear in `registry.json`
- discovery succeeds but entries are incomplete

Canonical repo:
- `https://github.com/bbuchsbaum/eco-registry`

## Critical Inputs

Repository settings required in `bbuchsbaum/eco-registry`:

1. Secret `GH_ORG_PAT`
- must read repos under `ECO_OWNER`
- must push commits to `bbuchsbaum/eco-registry`

2. Variable `ECO_OWNER`
- GitHub owner name (org or user)
- current expected value: `bbuchsbaum`

Optional fallback:
- `ECO_ORG`

## Normal Operations

Nightly schedule:
- workflow: `.github/workflows/discover-registry.yml`
- cron: `04:00 UTC` daily

Manual run:

```bash
gh workflow run discover-registry.yml --repo bbuchsbaum/eco-registry
```

Watch latest run:

```bash
gh run list --repo bbuchsbaum/eco-registry --workflow discover-registry.yml --limit 5
gh run watch --repo bbuchsbaum/eco-registry
```

## Triage Checklist

1. Confirm workflow status and logs.
2. Confirm `ECO_OWNER` and `GH_ORG_PAT` are present.
3. Confirm package has `.ecosystem.yml` on default branch.
4. Confirm package has release tag `eco-atlas` and asset `atlas-pack.tgz`.
5. Re-run discovery manually.
6. Confirm `registry.json` changed and committed.

## Common Incidents

### Incident A: Workflow fails immediately with auth errors

Symptoms:
- GitHub API 401/403
- "Missing GH_TOKEN" style failures

Actions:
1. Rotate/update secret `GH_ORG_PAT` in `bbuchsbaum/eco-registry`.
2. Ensure PAT has repo read for scanned owner and write access to this repo.
3. Re-run discovery manually.

### Incident B: Package missing from registry

Symptoms:
- repo exists but no entry in `registry.json`

Actions:
1. Verify package repo contains `.ecosystem.yml` at root.
2. Verify `.ecosystem.yml` includes `ecosystem: true` and `language: R` or `Python`.
3. Verify package has release `eco-atlas` with `atlas-pack.tgz`.
4. Trigger discovery manually.

### Incident C: Entry appears but `atlas_asset_url` is empty

Symptoms:
- package exists in registry
- direct URL not populated

Meaning:
- release/asset resolution was unavailable at discovery time.
- MCP can still resolve via `repo + release_tag + asset`.

Actions:
1. Verify release tag and asset exist.
2. Re-run discovery.
3. If still empty, inspect workflow logs and asset visibility.

### Incident D: Discovery says success but registry unchanged

Symptoms:
- run green, no `registry.json` diff

Actions:
1. Confirm package actually meets onboarding contract.
2. Confirm package default branch includes latest `.ecosystem.yml`.
3. Confirm discovery scanned expected owner (`ECO_OWNER`).
4. Check logs for "skipped" reasons.

## Local Debug Commands

Run discovery locally from repo root:

```bash
cd /Users/bbuchsbaum/code/eco-oracle/eco-registry
GH_OWNER=bbuchsbaum GH_TOKEN="$(gh auth token)" node .github/scripts/discover.mjs
```

Inspect generated registry:

```bash
cat registry.json
```

Validate specific package entry quickly:

```bash
rg -n "bbuchsbaum/neuroim2" registry.json
```

## MCP Verification After Registry Changes

If registry changed, validate from an MCP client session:

1. call `eco_refresh`
2. call `eco_packages`
3. confirm expected package/card/symbol counts

Registry URL for clients:
- `https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/registry.json`

## Turnkey Installer Operations

Installer script:
- `scripts/install-eco-oracle-mcp.sh`
- public one-liner:
  - `curl -fsSL https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/scripts/install-eco-oracle-mcp.sh | bash`

If users report install failure:
1. Check if `eco-oracle-mcp` exists on npm.
2. If not, instruct them to set `ECO_MCP_EXEC` to a source-built command.
3. Verify launcher exists at `~/.local/bin/eco-oracle-mcp-launch`.
4. Verify MCP registration in Claude/Codex and run `eco_refresh`.

## Package Bootstrap Operations

Bootstrap script for package repos:
- `scripts/bootstrap-package.sh`
- one-liner:
  - `curl -fsSL https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/scripts/bootstrap-package.sh | bash`
 - private-repo one-liner:
   - `gh api "repos/bbuchsbaum/eco-registry/contents/scripts/bootstrap-package.sh?ref=main" -H "Accept: application/vnd.github.raw" | bash`
 - secure turnkey (auto secret setup):
   - `read -s OPENAI_API_KEY; export OPENAI_API_KEY; gh api "repos/bbuchsbaum/eco-registry/contents/scripts/bootstrap-package.sh?ref=main" -H "Accept: application/vnd.github.raw" | bash; unset OPENAI_API_KEY`

It scaffolds package-side onboarding files from `templates/`.
If `OPENAI_API_KEY` is in shell env, bootstrap also configures repo secret automatically via `gh secret set`.
If bootstrap appears incomplete:
1. Confirm run location is package repo root (must contain `DESCRIPTION`).
2. Confirm network access to raw GitHub templates.
3. Re-run script; existing files are left untouched by design.

## Recovery Policy

- Prefer rerunning discovery over manual edits.
- Manual edits to `registry.json` are emergency-only.
- If manual edits are used, run discovery again after underlying issue is fixed.
