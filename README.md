# CI-1T MCP Server

**Version:** 1.0.0  
**Last Updated:** February 25, 2026  
**License:** Apache 2.0

MCP (Model Context Protocol) server for the CI-1T prediction stability engine. Lets AI agents — Claude Desktop, Cursor, Windsurf, VS Code Copilot, and any MCP-compatible client — evaluate model stability, manage fleet sessions, and control API keys directly.

## Tools (13)

| Tool | Description | Auth |
|------|-------------|------|
| `evaluate` | Evaluate prediction stability from Q0.16 scores | API key |
| `fleet_evaluate` | Fleet-wide multi-node evaluation | API key |
| `probe` | Probe an LLM for instability (3x same prompt) | Bearer |
| `health` | Check CI-1T engine status | Bearer |
| `fleet_session_create` | Create a persistent fleet session | Bearer |
| `fleet_session_round` | Submit a scoring round | Bearer |
| `fleet_session_state` | Get session state (read-only) | Bearer |
| `fleet_session_list` | List active fleet sessions | Bearer |
| `fleet_session_delete` | Delete a fleet session | Bearer |
| `list_api_keys` | List user's API keys | Bearer |
| `create_api_key` | Generate and register a new API key | Bearer |
| `delete_api_key` | Delete an API key by ID | Bearer |
| `get_invoices` | Get billing history (Stripe) | Bearer |

## Setup

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CI1T_API_KEY` | For evaluate tools | Your `ci_...` API key |
| `CI1T_TOKEN` | For dashboard tools | PocketBase Bearer token |
| `CI1T_BASE_URL` | No | API base URL (default: `https://collapseindex.org`) |

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ci1t": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "collapseindex/ci1t-mcp"],
      "env": {
        "CI1T_API_KEY": "ci_your_key_here",
        "CI1T_TOKEN": "your_pb_token_here"
      }
    }
  }
}
```

### Cursor / Windsurf

Add to `.cursor/mcp.json` or equivalent:

```json
{
  "mcpServers": {
    "ci1t": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "collapseindex/ci1t-mcp"],
      "env": {
        "CI1T_API_KEY": "ci_your_key_here",
        "CI1T_TOKEN": "your_pb_token_here"
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
        "CI1T_API_KEY": "ci_your_key_here",
        "CI1T_TOKEN": "your_pb_token_here"
      }
    }
  }
}
```

### Run from source (no Docker)

```bash
git clone https://github.com/collapseindex/ci1t-mcp.git
cd ci1t-mcp
npm install
npm run build

# Set env vars and run
CI1T_API_KEY=ci_xxx CI1T_TOKEN=xxx node dist/index.js
```

## Build Docker Image

```bash
docker build -t collapseindex/ci1t-mcp .
```

## Example Usage

Once connected, an AI agent can:

> "Evaluate these prediction scores: 45000, 32000, 51000, 48000, 29000, 55000"

The agent calls `evaluate` with `scores: [45000, 32000, 51000, 48000, 29000, 55000]` and gets back:

```json
{
  "episodes": [
    {
      "ci_out": 28431,
      "ci_ema_out": 14215,
      "al_out": 2,
      "warn": true,
      "fault": false,
      "ghost_suspect": false,
      "ep_count": 1
    }
  ],
  "credits_used": 2,
  "credits_remaining": 4998
}
```

> "Create a fleet session with 4 nodes named GPT-4, Claude, Gemini, Llama"

> "List my API keys"

> "Probe this prompt for stability: What is the capital of France?"

## CI-1T Quick Reference

| Metric | Range | Meaning |
|--------|-------|---------|
| **CI** (Collapse Index) | 0–65535 (Q0.16) | 0 = perfectly stable, 65535 = total collapse |
| **AL** (Authority Level) | 0–4 | 0 = full trust, 4 = override the model |
| **Ghost** | boolean flags | Model appears stable but is silently wrong |
| **Warn** | boolean | Threshold crossed — watch this model |
| **Fault** | boolean | Hard failure — model should be overridden |

| CI (normalized) | Status |
|-----------------|--------|
| < 0.15 | Stable |
| 0.15 – 0.45 | Drifting |
| 0.45 – 0.70 | Unstable |
| > 0.70 | Collapsing |

## Architecture

```
┌──────────────────────┐     stdio      ┌───────────────────────┐
│   Claude Desktop /   │◄──────────────►│   ci1t-mcp server     │
│   Cursor / VS Code   │               │   (Node.js / Docker)  │
└──────────────────────┘               └──────────┬────────────┘
                                                   │ HTTPS
                                    ┌──────────────┼──────────────┐
                                    │              │              │
                               ┌────▼───┐   ┌─────▼────┐  ┌─────▼─────┐
                               │Evaluate│   │Fleet API │  │Dashboard  │
                               │  API   │   │Sessions  │  │API Keys   │
                               │        │   │          │  │Billing    │
                               └────────┘   └──────────┘  └───────────┘
                               collapseindex.org
```

## Changelog

### v1.0.0 (2026-02-25)
- Complete rewrite from Python to TypeScript
- 13 tools: evaluate, fleet_evaluate, probe, health, fleet session CRUD, API key CRUD, invoices
- Docker image distribution
- stdio transport for Claude Desktop, Cursor, VS Code
- Dual auth: API key (X-API-Key) for evaluate, Bearer token for dashboard

---

© 2026 Collapse Index Labs™
