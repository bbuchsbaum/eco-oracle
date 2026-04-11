# EcoOracle Setup Guide

## 1. Install the MCP server

### Claude Code (user scope)
```bash
claude mcp add eco-oracle -- npx -y eco-oracle-mcp
```

### Claude Code (project scope via .mcp.json)
```json
{
  "mcpServers": {
    "eco-oracle": {
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

### Codex (user scope)
```bash
codex mcp add eco-oracle -- npx -y eco-oracle-mcp
```

Or add to `~/.codex/config.toml`:
```toml
[[mcp_servers]]
name = "eco-oracle"
command = "npx"
args = ["-y", "eco-oracle-mcp"]

[mcp_servers.env]
ECO_REGISTRY_URL = "https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/registry.json"
ECO_GITHUB_TOKEN = "${ECO_GITHUB_TOKEN}"
```

## 2. Available MCP tools

| Tool | Description |
|------|-------------|
| `eco_howto(query, ...)` | How-to microcard search (JSON payload) |
| `eco_symbol(symbol, ...)` | Compact API card lookup (`pkg::fn` or bare `fn`) |
| `eco_packages(...)` | List ecosystem packages |
| `eco_where_used(symbol, ...)` | Find where a symbol is used |
| `eco_refresh()` | Force registry + pack refresh |

## 3. Add a package to the ecosystem

From the package repo, ask your agent:
> "Add this package to the ecosystem"

The `eco-join` skill will scaffold all required files.

Or from R:

```r
# install.packages("remotes")
remotes::install_github("bbuchsbaum/eco-oracle")
library(ecooracle)
ecooracle::use_ecooracle()

# later, refresh an existing repo to the latest templates
ecooracle::use_ecooracle(overwrite = TRUE)

# or run the rest of the onboarding flow directly
ecooracle::use_ecooracle(
  commit = TRUE,
  push = TRUE,
  run_workflow = TRUE,
  run_discovery = TRUE
)

# local readiness checks
ecooracle::check_health()
```

Or manually:
1. Create `.ecosystem.yml` (see template below)
2. Copy `tools/` files from this repo
3. Copy `.github/workflows/eco-atlas.yml` from `tools/eco-atlas.yml`
4. Set `OPENAI_API_KEY` in repo/org secrets
5. Push to main — the CI workflow publishes the atlas pack automatically

## 4. .ecosystem.yml template

```yaml
ecosystem: true
package: mypkg
language: R
role: ingest          # ingest | transform | model | report
tags: [transactions]
entrypoints: [mypkg::main_fn]
howto_seeds:
  - "How do I process a transaction file?"
```

## 5. Environment variables (MCP server)

| Variable | Default | Description |
|----------|---------|-------------|
| `ECO_REGISTRY_URL` | unset | URL to `registry.json` |
| `ECO_REGISTRY_PATH` | `./eco-registry/registry.json` (if present) | Local registry file path |
| `ECO_GITHUB_TOKEN` | unset | Optional token for private GitHub release assets |
| `ECO_CACHE_DIR` | `~/.cache/eco-oracle` | Local atlas pack cache |
| `ECO_REFRESH_SECS` | `600` | Cache freshness TTL (seconds) |
| `ECO_REFRESH_INTERVAL_MS` | legacy | Backward-compatible refresh interval override |

Set at least one of `ECO_REGISTRY_URL` or `ECO_REGISTRY_PATH`.

## 6. Hint markers in R source

Add these comments to guide extraction (all optional):

```r
# ECO:entrypoint          <- marks this function as a key export
# ECO:howto How do I ...? <- seeds a specific how-to card
# ECO:invariant ...       <- records a contract/invariant
```
