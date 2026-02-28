# CI-1T MCP Server

MCP server for the **CI-1T prediction stability engine**. Evaluate model stability, detect ghosts, monitor fleet drift, and probe any LLM for instability. 20 tools + 1 resource for AI agents.

Works with **Claude Desktop**, **Cursor**, **Windsurf**, **VS Code (Copilot)**, and any MCP-compatible client.

## Quick Start

```bash
docker pull collapseindex/ci1t-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ci1t": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "collapseindex/ci1t-mcp"],
      "env": {
        "CI1T_API_KEY": "ci_your_key_here"
      }
    }
  }
}
```

### Cursor / Windsurf

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ci1t": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "collapseindex/ci1t-mcp"],
      "env": {
        "CI1T_API_KEY": "ci_your_key_here"
      }
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "ci1t": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "collapseindex/ci1t-mcp"],
      "env": {
        "CI1T_API_KEY": "ci_your_key_here"
      }
    }
  }
}
```

## Get an API Key

1. Create a free account at [collapseindex.org](https://collapseindex.org)
2. **1,000 free credits on signup** (no credit card required)
3. Copy your `ci_...` API key from the dashboard
4. Set it as `CI1T_API_KEY` in your MCP config

## Tools (20)

### Evaluation
| Tool | Description |
|------|-------------|
| `evaluate` | Evaluate prediction stability (floats or Q0.16) |
| `fleet_evaluate` | Fleet-wide multi-node evaluation |
| `probe` | Probe any LLM for instability (3x same prompt) |
| `health` | Check CI-1T engine status |

### Fleet Sessions
| Tool | Description |
|------|-------------|
| `fleet_session_create` | Create a persistent fleet session |
| `fleet_session_round` | Submit a scoring round |
| `fleet_session_state` | Get session state |
| `fleet_session_list` | List active sessions |
| `fleet_session_delete` | Delete a session |

### Dashboard
| Tool | Description |
|------|-------------|
| `list_api_keys` | List your API keys |
| `create_api_key` | Generate a new API key |
| `delete_api_key` | Delete an API key |
| `get_invoices` | Get billing history |

### Local Utilities (no auth, no credits)
| Tool | Description |
|------|-------------|
| `onboarding` | Welcome guide + setup |
| `interpret_scores` | Statistical breakdown |
| `convert_scores` | Float to Q0.16 conversion |
| `generate_config` | Integration boilerplate |
| `compare_windows` | Drift detection between windows |
| `alert_check` | Threshold alerting |
| `visualize` | Interactive HTML charts |

### BYOM Probe (Bring Your Own Model)

Probe any OpenAI-compatible endpoint directly. No CI-1T auth needed, no credits consumed.

```
"Probe my local Ollama llama3 model with: What is the meaning of life?"
```

Works with Ollama, LM Studio, vLLM, OpenAI, Anthropic, Together, and more.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CI1T_API_KEY` | Yes | Your `ci_...` API key |
| `CI1T_BASE_URL` | No | API base (default: `https://collapseindex.org`) |

## Image Details

- **Base**: `node:22-alpine`
- **Size**: ~61 MB compressed
- **Transport**: stdio (MCP standard)
- **Node**: 22 LTS
- **Security**: Alpine packages upgraded, npm patched, source maps disabled

## Links

- **Website**: [collapseindex.org](https://collapseindex.org)
- **npm**: [@collapseindex/ci1t-mcp](https://www.npmjs.com/package/@collapseindex/ci1t-mcp)
- **MCP listing**: [mcp.so](https://mcp.so)
- **Contact**: [ask@collapseindex.org](mailto:ask@collapseindex.org)

---

© 2026 Collapse Index Labs™ — Alex Kwon
