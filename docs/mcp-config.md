# MCP Server Configuration

## Claude Code (project scope — .mcp.json)

```json
{
  "mcpServers": {
    "eco-oracle": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "eco-oracle-mcp"],
      "env": {
        "ECO_REGISTRY_URL": "https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/registry.json",
        "ECO_GITHUB_TOKEN": "${ECO_GITHUB_TOKEN}",
        "ECO_CACHE_DIR": "${ECO_CACHE_DIR}"
      }
    }
  }
}
```

Local-registry variant (same file):

```json
{
  "mcpServers": {
    "eco-oracle": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "eco-oracle-mcp"],
      "env": {
        "ECO_REGISTRY_PATH": "/absolute/path/to/eco-registry/registry.json"
      }
    }
  }
}
```

## Claude Code (user scope)

```bash
claude mcp add eco-oracle -- npx -y eco-oracle-mcp
```

## Codex (project scope — .codex/config.toml)

```toml
[mcp_servers.eco-oracle]
command = "npx"
args = ["-y", "eco-oracle-mcp"]

[mcp_servers.eco-oracle.env]
ECO_REGISTRY_URL = "https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/registry.json"
```

Optional for private package assets:

```toml
[mcp_servers.eco-oracle.env]
ECO_REGISTRY_URL = "https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/registry.json"
ECO_GITHUB_TOKEN = "${ECO_GITHUB_TOKEN}"
```

## Codex (user scope)

```bash
codex mcp add eco-oracle -- npx -y eco-oracle-mcp
```

Set at least one of `ECO_REGISTRY_URL` or `ECO_REGISTRY_PATH`.
