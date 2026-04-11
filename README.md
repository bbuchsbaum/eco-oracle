# EcoOracle

EcoOracle is an MCP server plus registry pipeline for answering ecosystem questions across many R/Python packages.
Primary goal: let users build new scripts outside package repos by retrieving canonical usage recipes and API cards.

It is designed so package onboarding is deterministic:
- package repo opts in with `.ecosystem.yml`
- package CI publishes `atlas-pack.tgz` at release tag `eco-atlas`
- `eco-registry` discovery updates `registry.json` nightly
- MCP server loads registry and serves `eco_howto`, `eco_symbol`, `eco_packages`, `eco_where_used`

Canonical registry repository: `https://github.com/bbuchsbaum/eco-registry`.

## What Lives Here

- `packages/eco-oracle-mcp`: MCP server
- `tools/eco_atlas_extract.R`: extract symbols/snippets/edges
- `tools/eco_atlas_distill.mjs`: distill snippets into microcards
- `tools/eco-atlas.yml`: package-side workflow template that builds and publishes `atlas-pack.tgz`
- `eco-registry`: registry repo and nightly discovery workflow
- `schemas`: data contracts for cards, symbols, edges, manifest, registry

## End-to-End Flow

1. Package repo includes `.ecosystem.yml`.
2. Package workflow builds atlas files and publishes `atlas-pack.tgz` to release tag `eco-atlas`.
3. `eco-registry/.github/workflows/discover-registry.yml` runs nightly at `04:00 UTC` (and on manual dispatch).
4. Discovery script scans owner repos, finds `.ecosystem.yml`, resolves release assets, and writes `eco-registry/registry.json`.
5. MCP server refreshes from registry and caches atlas packs locally.
6. Claude/Codex sessions call the MCP tools to generate external scripts.

## Add A New Package (Turnkey)

Do this in the target package repository.

Fastest path with an agent:
- ask: `Add this package to the ecosystem`
- if `eco-join` skill is available, it scaffolds the required files/workflow.

Fastest path from R:

```r
# install.packages("remotes")
remotes::install_github("bbuchsbaum/eco-oracle")
library(ecooracle)

# initial scaffold
ecooracle::use_ecooracle()

# refresh workflow/tool templates later without hand edits
ecooracle::use_ecooracle(overwrite = TRUE)
```

1. Add `.ecosystem.yml` at repo root:

```yaml
ecosystem: true
package: mypkg
language: R
role: transform
tags: [domain-tag, canonicalization]
entrypoints:
  - mypkg::main_fn
  - mypkg::read_input
# optional overrides (defaults shown)
release_tag: eco-atlas
asset: atlas-pack.tgz
```

2. Add atlas tooling to the package repo:
- copy `tools/eco_atlas_extract.R`
- copy `tools/eco_atlas_distill.mjs`
- copy `.github/workflows/eco-atlas.yml` from `tools/eco-atlas.yml`

If you use `ecooracle::use_ecooracle()`, these files are scaffolded for you. Re-run it with `overwrite = TRUE` to refresh an existing package to the current template set.

3. Configure package secrets:
- `OPENAI_API_KEY` for distillation step

4. Push to `main` (or run workflow manually):
- verify release tag `eco-atlas` contains asset `atlas-pack.tgz`

5. Wait for registry discovery (nightly) or trigger `discover-registry` manually in `eco-registry`.
Example manual trigger:

```bash
gh workflow run discover-registry.yml --repo bbuchsbaum/eco-registry
```

6. Verify package is in registry:

```bash
cat eco-registry/registry.json
```

7. Verify MCP can load it:

```bash
node packages/eco-oracle-mcp/dist/index.js
# then call eco_refresh and eco_packages from your MCP client
```

No manual registry edits should be required in normal operation.

## Manual Hints: Exactly Where To Put Them

If you want package-specific guidance to improve retrieval quality, put it in the package repository, not in `eco-registry/registry.json`.

Hard rule:
1. Do not manually edit `eco-registry/registry.json` for package hints.
2. Nightly discovery rewrites `registry.json`.
3. Manual edits there are temporary and will be lost.

Put hints in durable source locations in the package repo:
1. `.ecosystem.yml`
   - set `role`, `tags`, `entrypoints`
2. `R/*.R`
   - add `# ECO:howto ...` markers above canonical snippets
3. `README.Rmd` / `vignettes/*.Rmd`
   - include canonical code fences for real workflows
4. `manual_cards.jsonl` (optional, deterministic overrides)
   - add hand-authored microcards that are merged into final `atlas/cards.jsonl`
   - if `id` collides with generated card id, manual card wins

Manual cards file contract:
1. File path: `manual_cards.jsonl` at package repo root (default; override with `ECO_ATLAS_MANUAL_CARDS_PATH`)
2. One JSON object per line
3. Required fields per record:
   - `q`, `a`, `recipe`, `symbols`
4. Optional fields:
   - `id`, `tags`, `package`, `language`, `sources`

Example `manual_cards.jsonl` line:

```json
{"id":"manual.bidser.load_project","q":"How do I load a BIDS project in R?","a":"Use bidser::bids_project() on the dataset root, then inspect scans with func_scans().","recipe":"library(bidser)\nproj <- bidser::bids_project('/path/to/bids')\nscans <- bidser::func_scans(proj)","symbols":["bidser::bids_project","bidser::func_scans"],"tags":["bids","ingest"]}
```

Example `# ECO:howto` snippet:

```r
# ECO:howto How do I load a BIDS project?
library(bidser)
proj <- bidser::bids_project("/path/to/bids")
scans <- bidser::func_scans(proj)
```

What gets overwritten by automation:
1. `eco-registry/registry.json` is regenerated by discovery.
2. `atlas/cards.jsonl` and release `atlas-pack.tgz` are regenerated by package atlas workflow.

What does not get overwritten:
1. `.ecosystem.yml` committed in the package repo.
2. `# ECO:howto` markers and package docs committed in the package repo.

Operational flow for manual hints:
1. Commit hint changes in the package repo.
2. Run/push package `eco-atlas` workflow so a new `atlas-pack.tgz` is published.
3. Wait for nightly discovery (or trigger it manually).
4. Run `eco_refresh` in client and verify behavior with `eco_howto` / `eco_symbol`.

## Registry Automation Setup (Do Once In `eco-registry`)

Set these in the `eco-registry` GitHub repo:

1. Secret: `GH_ORG_PAT`
- token must read target owner repositories and push to `eco-registry`

2. Variable: `ECO_OWNER`
- owner to scan, org or user (for example `bbuchsbaum`)

3. Optional variable: `ECO_ORG`
- backward-compatible fallback

Discovery supports both GitHub orgs and users.

## Run The MCP Server Locally

From this repo:

```bash
npm install
npm run build --workspace=packages/eco-oracle-mcp
node packages/eco-oracle-mcp/dist/index.js
```

Environment:
- `ECO_REGISTRY_URL` or `ECO_REGISTRY_PATH` (set at least one)
- `ECO_GITHUB_TOKEN` (optional, needed for private release assets)
- `ECO_CACHE_DIR` (optional, default `~/.cache/eco-oracle`)
- `ECO_REFRESH_SECS` (optional, default `600`)

## Use From Claude Code

User scope:

```bash
claude mcp add --transport stdio eco-oracle --scope user -- npx -y eco-oracle-mcp
```

Project scope (`.mcp.json`):

```json
{
  "mcpServers": {
    "eco-oracle": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "eco-oracle-mcp"],
      "env": {
        "ECO_REGISTRY_URL": "https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/registry.json",
        "ECO_GITHUB_TOKEN": "${ECO_GITHUB_TOKEN}"
      }
    }
  }
}
```

## Copy-Paste Directive: Ecosystem-First (Compatible with oh-my-claude)

Use this in `CLAUDE.md`, `AGENTS.md`, or as the first message in a fresh Claude/Codex session:

```md
## Internal package policy (eco-oracle MCP only)

This policy refers only to the `eco-oracle` MCP server.
Do not activate or invoke any other skill/mode (including `oh-my-claudecode:ecomode`) unless the user explicitly asks.

For R code, prefer ecosystem packages discovered via eco-oracle MCP.
Workflow is mandatory:

1. Call `eco_howto` first for each "How do I...?" subtask.
2. Call `eco_symbol` for each function you plan to use.
3. Use ecosystem packages/functions in final code.

Do not introduce non-ecosystem packages (for example `RNifti`, `oro.nifti`, `ANTsR`) unless:
1. eco-oracle returns no viable result, and
2. you explicitly ask for user approval before using external packages.

When answering, include:
1. `Ecosystem packages used: ...`
2. `Functions used: ...`
3. `Fallback needed: yes/no`
```

Quick prompt to reinforce behavior in any new session:

```text
Use eco-oracle MCP as source of truth. Do not enable oh-my-claude modes/skills unless I explicitly request them. Ecosystem-only solution unless no match exists; if no match, ask me before using external packages.
```

Shortcut session opener (equivalent):

```text
Enter ecosystem mode.
```

## Use From Codex

User scope:

```bash
codex mcp add eco-oracle -- npx -y eco-oracle-mcp
```

Or in `~/.codex/config.toml`:

```toml
[[mcp_servers]]
name = "eco-oracle"
command = "npx"
args = ["-y", "eco-oracle-mcp"]

[mcp_servers.env]
ECO_REGISTRY_URL = "https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/registry.json"
ECO_GITHUB_TOKEN = "${ECO_GITHUB_TOKEN}"
```

## MCP Tools

- `eco_howto(query, ...)`
- `eco_symbol(symbol, ...)`
- `eco_packages(...)`
- `eco_where_used(symbol, ...)`
- `eco_refresh()`

## Operational Checklist

For each package:
1. `.ecosystem.yml` present and valid.
2. `eco-atlas` workflow runs on `main`.
3. Release tag `eco-atlas` has `atlas-pack.tgz`.

For registry:
1. Nightly discovery workflow succeeds.
2. `registry.json` updates automatically.
3. New packages appear without manual edits.

For clients:
1. MCP config points at correct registry URL/path.
2. `eco_refresh()` returns expected package/card/symbol counts.
