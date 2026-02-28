# CI-1T MCP Server

**Version:** 1.6.1  
**Last Updated:** February 27, 2026  
**License:** Proprietary

MCP (Model Context Protocol) server for the CI-1T prediction stability engine. Lets AI agents — Claude Desktop, Cursor, Windsurf, VS Code Copilot, and any MCP-compatible client — evaluate model stability, manage fleet sessions, and control API keys directly.

**One credential. One env var. That's it.**

## Tools (20) + Resources (1)

| Tool | Description | Auth |
|------|-------------|------|
| `evaluate` | Evaluate prediction stability (floats or Q0.16) | API key |
| `fleet_evaluate` | Fleet-wide multi-node evaluation (floats or Q0.16) | API key |
| `probe` | Probe an LLM for instability (3x same prompt) | API key |
| `health` | Check CI-1T engine status | API key |
| `fleet_session_create` | Create a persistent fleet session | API key |
| `fleet_session_round` | Submit a scoring round | API key |
| `fleet_session_state` | Get session state (read-only) | API key |
| `fleet_session_list` | List active fleet sessions | API key |
| `fleet_session_delete` | Delete a fleet session | API key |
| `list_api_keys` | List user's API keys | API key |
| `create_api_key` | Generate and register a new API key | API key |
| `delete_api_key` | Delete an API key by ID | API key |
| `get_invoices` | Get billing history (Stripe) | API key |
| `onboarding` | Welcome guide + setup instructions | None |
| `interpret_scores` | Statistical breakdown of scores | None |
| `convert_scores` | Convert between floats and Q0.16 | None |
| `generate_config` | Integration boilerplate for any framework | None |
| `compare_windows` | Compare baseline vs recent episodes for drift detection | None |
| `alert_check` | Check episodes against custom thresholds, return alerts | None |
| `visualize` | Interactive HTML visualization of evaluate results | None |

| Resource | URI | Description |
|----------|-----|-------------|
| `tools_guide` | `ci1t://tools-guide` | Full usage guide: response schemas, chaining patterns, fleet workflow, thresholds, example pipelines |

## Onboarding

New users get guided setup automatically. If no API key is configured:

- **Startup log** prints a hint: *"Create a free account at collapseindex.org — 1,000 free credits on signup"*
- **`onboarding` tool** returns a full welcome guide with account status, setup steps, config examples, available tools, and pricing
- **Auth-guarded tools** return a friendly error with specific setup instructions instead of a raw 401
- **Utility tools** (`interpret_scores`, `convert_scores`, `generate_config`) always work — no auth, no credits

Every new account gets **1,000 free credits** (no credit card required), enough for 1,000 evaluation episodes.

## Setup

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CI1T_API_KEY` | Yes | Your `ci_...` API key — single credential for all tools |
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
        "CI1T_API_KEY": "ci_your_key_here"
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

### Run from source (no Docker)

```bash
git clone https://github.com/collapseindex/ci1t-mcp.git
cd ci1t-mcp
npm install
npm run build

# Set env var and run
CI1T_API_KEY=ci_xxx node dist/index.js
```

## Build Docker Image

```bash
docker build -t collapseindex/ci1t-mcp .
```

## Example Usage

Once connected, an AI agent can:

> "Evaluate these prediction scores: 45000, 32000, 51000, 48000, 29000, 55000"

The agent calls `evaluate` with `scores: [45000, 32000, 51000, 48000, 29000, 55000]` and gets back stability metrics per episode, including credits used and remaining.

> "Create a fleet session with 4 nodes named GPT-4, Claude, Gemini, Llama"

> "List my API keys"

> "Probe this prompt for stability: What is the capital of France?"

> "Interpret these scores: 0.12, 0.45, 0.88, 0.03, 0.67"

The agent calls `interpret_scores` locally (no API call, no credits) and returns mean, std, min/max, and normalized values. For full stability classification, use `evaluate`.

> "Convert these probabilities to Q0.16: 0.5, 0.95, 0.01"

> "Generate a FastAPI integration for CI-1T with guardrail pattern"

## CI-1T Quick Reference

| Metric | Description |
|--------|-------------|
| **CI** (Collapse Index) | Primary stability metric (Q0.16: 0–65535). Lower = more stable |
| **AL** (Authority Level) | Engine trust level for the model (0–4) |
| **Ghost** | Model appears stable but may be silently wrong |
| **Warn / Fault** | Threshold and hard-failure flags |

Classification labels (Stable / Drift / Flip / Collapse) are determined by the engine. Use the `evaluate` tool to get exact classifications — thresholds are configurable via the API.

## Architecture

```
┌──────────────────────┐     stdio      ┌───────────────────────┐
│   Claude Desktop /   │◄──────────────►│   ci1t-mcp server     │
│   Cursor / VS Code   │               │   (Node.js / Docker)  │
└──────────────────────┘               └──────────┬────────────┘
                                                   │ HTTPS
                                                   │ X-API-Key
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

### v1.6.1 (2026-02-27)
- **SEC-01** (Critical): API key generation now uses `crypto.randomBytes()` instead of `Math.random()`
- **SEC-02** (High): Visualization title is HTML-escaped to prevent XSS
- **SEC-03** (Medium): `toQ16()` decimal heuristic prevents integer arrays `[0, 1]` from being misclassified as floats
- **SEC-04** (Medium): Score arrays capped at 10,000 per stream, 16 nodes max on fleet tools
- **SEC-05** (Medium): Source maps disabled in production build
- **SEC-06** (Low): Fixed template literal bug in `compare_windows` severity message
- **SEC-07** (Low): Visualization temp files auto-cleaned after 1 hour
- **SEC-08** (Low): Header version comment updated

### v1.6.0 (2026-02-27)
- **AI Discoverability**: All 20 tool descriptions now include response schemas and chaining hints
- `tools_guide` MCP resource (`ci1t://tools-guide`): comprehensive usage guide with response schemas, chaining patterns, fleet session workflow, classification thresholds, and example pipelines
- Agents can now read the resource for full context beyond individual tool descriptions
- 20 tools + 1 resource

### v1.5.0 (2026-02-27)
- `compare_windows` tool: compare baseline vs recent episodes — drift delta, trend direction, degradation detection
- `alert_check` tool: check episodes against custom thresholds (CI, EMA, AL, ghost, fault) with severity levels
- Both tools are local computation — no API call, no auth, no credits
- 20 tools total

### v1.4.0 (2026-02-27)
- `visualize` tool: generates self-contained interactive HTML with Canvas 2D bar charts
- Fixed sidebar layout matching CI-1T Lab dashboard style (KPIs, legend, stats in sidebar)
- EMA Trend + Authority Level charts side-by-side
- Adaptive bar sizing, hover tooltips, color-coded classifications
- Links to collapseindex.org in sidebar
- 18 tools total

### v1.3.0 (2026-02-27)
- **Single credential**: All tools now use `CI1T_API_KEY` — no Bearer token needed
- Removed `CI1T_TOKEN` env var entirely
- Backend auth unified: all API routes accept X-API-Key (resolves user via key hash)
- Simpler config: one env var to set, one credential to manage
- 17 tools total

### v1.2.0 (2026-02-27)
- `onboarding` tool: welcome guide with account status, setup steps, config examples, pricing, and available tools
- Auth guards on all credentialed tools — returns a structured onboarding message instead of failing at the API level
- Enhanced startup log: new-user hint when no credentials are configured
- 17 tools total

### v1.1.0 (2026-02-27)
- 3 new utility tools: `interpret_scores`, `convert_scores`, `generate_config` (local, no auth, no credits)
- `evaluate` and `fleet_evaluate` now auto-detect floats (0–1) vs Q0.16 (0–65535) — no manual conversion needed
- Dashboard parity: all Ask AI tools now available via MCP

### v1.0.0 (2026-02-25)
- Complete rewrite from Python to TypeScript
- 13 tools: evaluate, fleet_evaluate, probe, health, fleet session CRUD, API key CRUD, invoices
- Docker image distribution
- stdio transport for Claude Desktop, Cursor, VS Code
- Dual auth: API key (X-API-Key) for evaluate, Bearer token for dashboard

---

© 2026 Collapse Index Labs™ — Alex Kwon  
[collapseindex.org](https://collapseindex.org) · [ask@collapseindex.org](mailto:ask@collapseindex.org)
