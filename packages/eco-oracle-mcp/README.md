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
