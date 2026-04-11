# eco-oracle-mcp

EcoOracle MCP server (STDIO transport) for ecosystem retrieval across R/Python packages.

## Install

```bash
npm install -g eco-oracle-mcp
```

## Run

```bash
eco-oracle-mcp
```

## Environment

Set at least one registry source:

- `ECO_REGISTRY_URL` (recommended for shared registry)
- `ECO_REGISTRY_PATH` (local file fallback)

Optional:

- `ECO_GITHUB_TOKEN` for private release assets
- `ECO_CACHE_DIR` (default `~/.cache/eco-oracle`)
- `ECO_REFRESH_SECS` (default `600`)

Default shared registry URL:

`https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/registry.json`

## Tools

- `eco_howto`
- `eco_symbol`
- `eco_packages`
- `eco_where_used`
- `eco_refresh`

## Benchmarks

Run the local benchmark harness against fixed synthetic fixtures:

```bash
npm run bench --workspace=packages/eco-oracle-mcp
```

Useful options:

- `--packages 24`
- `--cards-per-package 40`
- `--symbols-per-package 80`
- `--edges-per-package 120`
- `--iterations 5`
- `--json`

The harness measures:

- registry-only `eco_packages` cold path
- snapshot hydrate + counted `eco_packages`
- full pack refresh
- warm `eco_packages`
- warm symbol lookup
- warm card search
