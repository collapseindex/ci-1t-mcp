#!/usr/bin/env node

/**
 * CI-1T MCP Server v1.6.1
 *
 * Model Context Protocol server for CI-1T — the prediction stability engine.
 * Exposes 20 tools + 1 resource across evaluation, fleet sessions, API key management, billing, monitoring, visualization, and utilities.
 *
 * Auth:
 *   CI1T_API_KEY  — ci_... API key. Single credential for all authenticated tools.
 *   CI1T_BASE_URL — API base URL (default: https://collapseindex.org)
 *
 * Transport: stdio (for Claude Desktop, Cursor, Windsurf, etc.)
 *
 * © 2026 Alex Kwon — Proprietary. All rights reserved.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomBytes } from "crypto";

// ─── Config ───────────────────────────────────────────────

const BASE_URL = process.env.CI1T_BASE_URL?.replace(/\/+$/, "") || "https://collapseindex.org";
const API_KEY = process.env.CI1T_API_KEY || "";

// ─── HTTP helpers ─────────────────────────────────────────

/** Headers using X-API-Key auth (for all authenticated endpoints) */
function apiKeyHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["X-API-Key"] = API_KEY;
  return { ...h, ...extra };
}

interface ApiResult {
  ok: boolean;
  status: number;
  data: unknown;
}

/** Generic fetch wrapper — returns structured result, never throws */
async function apiFetch(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<ApiResult> {
  const url = `${BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: opts.headers || { "Content-Type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: { error: `Network error: ${message}` } };
  }
}

/** Format an ApiResult into MCP text content */
function formatResult(result: ApiResult): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result.data, null, 2),
      },
    ],
  };
}

// ─── MCP Server ───────────────────────────────────────────

const server = new McpServer({
  name: "ci1t",
  version: "1.6.1",
});

// ─── Resources ────────────────────────────────────────────

server.resource(
  "tools_guide",
  "ci1t://tools-guide",
  {
    description:
      "Comprehensive usage guide for all CI-1T tools — response schemas, chaining patterns, fleet session workflow, classification thresholds, and example pipelines. Read this resource when you need full context beyond tool descriptions.",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: `# CI-1T MCP Tools Guide

## Overview
CI-1T is a prediction stability engine. It computes the Collapse Index (CI) — a Q0.16 fixed-point metric where 0 = perfectly stable and 65535 = total collapse.
All CI/EMA values in responses are Q0.16 integers (0–65535). Divide by 65535 for a 0–1 float or multiply by 100/65535 for a percentage.

## Classification Thresholds
| CI Range (normalized) | Label    | Meaning                          |
|-----------------------|----------|----------------------------------|
| 0.00 – 0.15          | Stable   | Predictions are consistent       |
| 0.16 – 0.45          | Drift    | Minor inconsistency detected     |
| 0.46 – 0.70          | Flip     | Significant instability          |
| 0.71 – 1.00          | Collapse | Model predictions are unreliable |

## Authority Levels (al_out)
| AL | Label          | Meaning                            |
|----|----------------|------------------------------------|
| 0  | Full Authority | Predictions can be trusted         |
| 1  | High Authority | Minor degradation                  |
| 2  | Moderate       | Noticeable instability             |
| 3  | Minimal        | Predictions questionable           |
| 4  | No Authority   | Do not trust predictions           |

## Episode Object Schema
Every evaluate, fleet_evaluate, and fleet_session_round response includes episodes:
\`\`\`json
{
  "ci_out": 1234,           // Q0.16 CI score (0–65535)
  "ci_ema_out": 1100,       // Q0.16 exponential moving average
  "al_out": 0,              // Authority level (0–4)
  "warn": false,            // Warning flag
  "fault": false,           // Fault flag
  "fault_code": 0,          // Fault code (0 = none)
  "ghost_confirmed": false, // Ghost prediction detected
  "ghost_suspect_streak": 0 // Consecutive ghost suspects
}
\`\`\`

## Chaining Patterns

### Pattern 1: Evaluate → Visualize
Best for: Quick visual inspection of model stability
\`\`\`
1. evaluate({ scores: [...] })           → get episodes array
2. visualize({ episodes: result.episodes }) → get HTML file path
\`\`\`

### Pattern 2: Evaluate → Alert Check
Best for: Automated threshold monitoring
\`\`\`
1. evaluate({ scores: [...] })
2. alert_check({ episodes: result.episodes, ci_threshold: 0.30 })
   → { status: "ok"|"warn"|"critical", alerts: [...] }
\`\`\`

### Pattern 3: Evaluate → Compare Windows (Drift Detection)
Best for: Comparing model health over time
\`\`\`
1. evaluate({ scores: baseline_scores })  → baseline_episodes
2. evaluate({ scores: recent_scores })    → recent_episodes
3. compare_windows({ baseline: baseline_episodes, recent: recent_episodes })
   → { trend: "improving"|"stable"|"degrading", delta: {...} }
\`\`\`

### Pattern 4: Probe → Evaluate → Visualize
Best for: Testing an LLM's consistency end-to-end
\`\`\`
1. probe({ prompt: "What is 2+2?" })      → { scores: [u16, u16, u16] }
2. evaluate({ scores: probe_result.scores }) → episodes
3. visualize({ episodes })                  → HTML chart
\`\`\`

### Pattern 5: Fleet Session Workflow
Best for: Persistent multi-round fleet monitoring
\`\`\`
1. fleet_session_create({ node_count: 3, node_names: ["gpt4", "claude", "llama"] })
   → { session_id: "abc123" }
2. fleet_session_round({ session_id: "abc123", scores: [[...], [...], [...]] })
   → per-node episodes + fleet_summary  (repeat for each scoring round)
3. fleet_session_state({ session_id: "abc123" })
   → accumulated state without submitting new scores
4. fleet_session_delete({ session_id: "abc123" })
   → cleanup when done
\`\`\`

## Tool Categories

### Evaluation (requires API key, costs credits)
- **evaluate** — Single-stream stability evaluation (1 credit/episode)
- **fleet_evaluate** — Multi-node evaluation in one call (1 credit/episode/node)
- **probe** — LLM consistency test (sends prompt 3x, compares responses)
- **health** — Engine health check

### Fleet Sessions (requires API key, costs credits per round)
- **fleet_session_create** → **fleet_session_round** (repeat) → **fleet_session_state** → **fleet_session_delete**

### Analysis (local, free, no auth)
- **compare_windows** — Drift detection between two episode windows
- **alert_check** — Threshold-based alerting on episodes
- **visualize** — Interactive HTML chart generation
- **interpret_scores** — Statistical breakdown of raw scores
- **convert_scores** — Float ↔ Q0.16 conversion

### Configuration (local, free, no auth)
- **generate_config** — Integration boilerplate for any framework
- **onboarding** — Setup guide and getting started

### Account Management (requires API key)
- **list_api_keys**, **create_api_key**, **delete_api_key** — API key CRUD
- **get_invoices** — Billing history

## Credits
- 1,000 free credits on signup at https://collapseindex.org/signup
- 1 credit per episode (evaluate), 1 credit per episode per node (fleet_evaluate)
- Local tools (interpret_scores, convert_scores, compare_windows, alert_check, visualize, generate_config) are always free
`,
      },
    ],
  })
);

// ─── Helpers ──────────────────────────────────────────────

const Q16 = 65535;

// ─── Auth guards ──────────────────────────────────────────

const SIGNUP_URL = "https://collapseindex.org";
const DOCS_URL = "https://collapseindex.org/docs";

interface McpToolResult {
  content: { type: "text"; text: string }[];
}

/**
 * Returns a friendly onboarding message if CI1T_API_KEY is not set, otherwise null.
 * Use at the top of any tool that requires authentication.
 */
function requireApiKey(): McpToolResult | null {
  if (API_KEY) return null;
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: "missing_api_key",
            message:
              "No API key configured. You need a CI-1T API key to use this tool.",
            setup_steps: [
              `1. Create a free account at ${SIGNUP_URL} — you get 1,000 free credits on signup`,
              "2. Go to Dashboard → API Keys and create a new key (starts with ci_...)",
              "3. Set the CI1T_API_KEY environment variable in your MCP client config",
              "4. Restart the MCP server — all tools will be unlocked",
            ],
            config_example: {
              claude_desktop: {
                mcpServers: {
                  ci1t: {
                    env: {
                      CI1T_API_KEY: "ci_your_key_here",
                    },
                  },
                },
              },
            },
            free_tools:
              "You can use interpret_scores, convert_scores, generate_config, and onboarding without an API key or credits.",
          },
          null,
          2
        ),
      },
    ],
  };
}

/** Auto-convert: if all values are 0–1 floats with decimals, scale to Q0.16. Otherwise clamp to 0–65535. */
function toQ16(scores: number[]): number[] {
  const hasDecimals = scores.some((s) => s % 1 !== 0);
  const allInUnit = scores.every((s) => s >= 0 && s <= 1);
  const isFloat = hasDecimals && allInUnit;
  return isFloat
    ? scores.map((s) => Math.round(Math.max(0, Math.min(1, s)) * Q16))
    : scores.map((s) => Math.round(Math.max(0, Math.min(Q16, s))));
}

/** Escape HTML entities to prevent XSS in generated HTML */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ━━━━━━━━━ ONBOARDING ━━━━━━━━━

server.tool(
  "onboarding",
  "Welcome guide for new users. Returns setup instructions, available tools, pricing, and links. No auth required. Call this when someone is new to CI-1T or asks how to get started.",
  {},
  async () => {
    const hasApiKey = !!API_KEY;
    const ready = hasApiKey;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              welcome: "Welcome to CI-1T — the prediction stability engine.",
              status: {
                api_key: hasApiKey ? "✓ configured" : "✗ not set",
                ready: hasApiKey,
              },
              what_is_ci1t:
                "CI-1T measures whether ML model predictions are stable or collapsing. It computes the Collapse Index (CI) — a Q0.16 fixed-point metric where 0 = perfectly stable and 65535 = total collapse. Useful for detecting silent failures, ghost predictions (confident but wrong), and model drift.",
              getting_started: [
                `1. Create a free account at ${SIGNUP_URL} — you get 1,000 free credits on signup`,
                "2. Go to Dashboard → API Keys → Create a new key (starts with ci_...)",
                "3. Set CI1T_API_KEY in your MCP client config — that's the only credential you need",
                "4. Start evaluating — your free credits cover 1,000 episodes",
              ],
              environment_variables: {
                CI1T_API_KEY: {
                  required_for: "All authenticated tools",
                  format: "ci_... (32 chars)",
                  description: "Your API key — single credential for evaluations, fleet sessions, API key management, and billing",
                },
                CI1T_BASE_URL: {
                  required_for: "optional",
                  format: "URL",
                  description: `API base URL (default: ${BASE_URL})`,
                },
              },
              config_example: {
                claude_desktop: {
                  mcpServers: {
                    ci1t: {
                      command: "npx",
                      args: ["-y", "@collapseindex/ci1t-mcp"],
                      env: {
                        CI1T_API_KEY: "ci_your_key_here",
                      },
                    },
                  },
                },
              },
              tools_available_now: [
                "onboarding — this guide (no auth)",
                "interpret_scores — statistical breakdown of scores (no auth)",
                "convert_scores — float ↔ Q0.16 conversion (no auth)",
                "generate_config — integration boilerplate (no auth)",
                ...(hasApiKey
                  ? [
                      "evaluate — run stability analysis (API key ✓)",
                      "fleet_evaluate — multi-node fleet analysis (API key ✓)",
                      "probe — test LLM stability (API key ✓)",
                      "health — engine status (API key ✓)",
                      "fleet_session_* — persistent sessions (API key ✓)",
                      "API key management (API key ✓)",
                      "get_invoices — billing (API key ✓)",
                    ]
                  : []),
              ],
              pricing: {
                free_credits: "1,000 credits on signup — no credit card required",
                evaluate: "1 credit per episode",
                fleet_evaluate: "1 credit per episode per node",
                probe: "1 credit per probe",
                utility_tools: "Free — no credits, no auth",
              },
              links: {
                dashboard: SIGNUP_URL,
                docs: DOCS_URL,
                github: "https://github.com/collapseindex",
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ━━━━━━━━━ EVALUATION TOOLS ━━━━━━━━━

server.tool(
  "evaluate",
  "Evaluate prediction stability. Sends scores to the CI-1T engine and returns per-episode stability metrics. Accepts floats (0.0–1.0) or Q0.16 integers (0–65535) — auto-converts. Response: { episodes: [{ ci_out, ci_ema_out, al_out, warn, fault, ghost_confirmed, ghost_suspect_streak, ... }], credits_used, credits_remaining }. CI values are Q0.16 (0–65535; divide by 65535 for %). Classification: ≤0.15=Stable, ≤0.45=Drift, ≤0.70=Flip, >0.70=Collapse. Chain results → visualize (chart), alert_check (threshold alerts), compare_windows (drift detection), or interpret_scores (stats).",
  {
    scores: z.array(z.number().min(0).max(65535)).min(1).max(10000).describe("Array of prediction scores — floats (0.0–1.0) or Q0.16 integers (0–65535), auto-detected. Max 10,000."),
    n: z.number().int().min(2).max(8).optional().describe("Episode length (default: 3)"),
  },
  async ({ scores, n }) => {
    const guard = requireApiKey();
    if (guard) return guard;
    const q16Scores = toQ16(scores);
    const body: Record<string, unknown> = { scores: q16Scores };
    if (n !== undefined) body.config = { n };
    const result = await apiFetch("/api/evaluate", {
      method: "POST",
      headers: apiKeyHeaders(),
      body,
    });
    return formatResult(result);
  }
);

server.tool(
  "fleet_evaluate",
  "Evaluate a fleet of model nodes for prediction stability. Each node provides a score stream. Returns per-node episodes and aggregate fleet stats. Accepts floats (0.0–1.0) or Q0.16 integers (0–65535) — auto-converts per node. Response: { nodes: [{ node_id, episodes: [{ ci_out, ci_ema_out, al_out, warn, fault, ghost_confirmed, ... }] }], fleet_summary, credits_used, credits_remaining }. Chain per-node episodes → visualize, alert_check, or compare_windows. For persistent multi-round fleet monitoring, use fleet_session_create instead.",
  {
    nodes: z.array(z.array(z.number().min(0).max(65535)).min(1).max(10000)).min(1).max(16).describe("Array of node score arrays — each inner array is one node's scores (floats or Q0.16). Max 16 nodes, 10,000 scores per node."),
    n: z.number().int().min(2).max(8).optional().describe("Episode length (default: 3)"),
  },
  async ({ nodes, n }) => {
    const guard = requireApiKey();
    if (guard) return guard;
    const q16Nodes = nodes.map((nodeScores) => toQ16(nodeScores));
    const body: Record<string, unknown> = { nodes: q16Nodes };
    if (n !== undefined) body.config = { n };
    const result = await apiFetch("/api/fleet-evaluate", {
      method: "POST",
      headers: apiKeyHeaders(),
      body,
    });
    return formatResult(result);
  }
);

server.tool(
  "probe",
  "Probe an LLM for prediction instability. Sends the same prompt 3 times and compares responses using the specified similarity method. Response: { scores: [u16, u16, u16], normalized: [f64, f64, f64], responses: [str, str, str], method }. The returned scores array can be passed directly to evaluate for full stability classification. No-code way to test any LLM's consistency.",
  {
    prompt: z.string().min(3).max(500).describe("The prompt to send 3 times to the LLM"),
    method: z.enum(["jaccard", "length", "fingerprint"]).optional().describe("Similarity method (default: jaccard)"),
  },
  async ({ prompt, method }) => {
    const guard = requireApiKey();
    if (guard) return guard;
    const body: Record<string, unknown> = { action: "probe", prompt };
    if (method) body.method = method;
    const result = await apiFetch("/api/lab", {
      method: "POST",
      headers: apiKeyHeaders(),
      body,
    });
    return formatResult(result);
  }
);

server.tool(
  "health",
  "Check CI-1T engine health. Response: { status, version, latency_ms }. Call before evaluate/fleet operations to verify the engine is reachable.",
  {},
  async () => {
    const guard = requireApiKey();
    if (guard) return guard;
    const result = await apiFetch("/api/fleet-session", {
      method: "POST",
      headers: apiKeyHeaders(),
      body: { action: "health" },
    });
    return formatResult(result);
  }
);

// ━━━━━━━━━ FLEET SESSION TOOLS ━━━━━━━━━

server.tool(
  "fleet_session_create",
  "Create a new persistent fleet monitoring session. Returns a session ID for subsequent rounds. Max 16 nodes. Response: { session_id, node_count, node_names, created_at }. Workflow: fleet_session_create → fleet_session_round (repeat) → fleet_session_state (check) → fleet_session_delete (cleanup).",
  {
    node_count: z.number().int().min(1).max(16).describe("Number of nodes in the fleet"),
    node_names: z.array(z.string()).optional().describe("Optional names for each node (must match node_count)"),
  },
  async ({ node_count, node_names }) => {
    const guard = requireApiKey();
    if (guard) return guard;
    const body: Record<string, unknown> = { action: "create", node_count };
    if (node_names) body.node_names = node_names;
    const result = await apiFetch("/api/fleet-session", {
      method: "POST",
      headers: apiKeyHeaders(),
      body,
    });
    return formatResult(result);
  }
);

server.tool(
  "fleet_session_round",
  "Submit a scoring round to an existing fleet session. Each node's scores array is evaluated and the cumulative fleet snapshot is returned. Response: { round, nodes: [{ episodes: [...] }], fleet_summary }. Episodes in the response can be passed to visualize, alert_check, or compare_windows.",
  {
    session_id: z.string().describe("Fleet session ID"),
    scores: z.array(z.array(z.number().int().min(0).max(65535)).min(1).max(10000)).min(1).max(16).describe("Per-node score arrays for this round. Max 16 nodes, 10,000 scores per node."),
  },
  async ({ session_id, scores }) => {
    const guard = requireApiKey();
    if (guard) return guard;
    const result = await apiFetch("/api/fleet-session", {
      method: "POST",
      headers: apiKeyHeaders(),
      body: { action: "round", session_id, scores },
    });
    return formatResult(result);
  }
);

server.tool(
  "fleet_session_state",
  "Get the current state of a fleet session without submitting new scores. Response: { session_id, round_count, nodes: [{ node_id, node_name, episodes: [...] }], fleet_summary }. Use to inspect accumulated results between rounds.",
  {
    session_id: z.string().describe("Fleet session ID"),
  },
  async ({ session_id }) => {
    const guard = requireApiKey();
    if (guard) return guard;
    const result = await apiFetch("/api/fleet-session", {
      method: "POST",
      headers: apiKeyHeaders(),
      body: { action: "state", session_id },
    });
    return formatResult(result);
  }
);

server.tool(
  "fleet_session_list",
  "List all active fleet sessions. Response: { sessions: [{ session_id, node_count, round_count, created_at }] }.",
  {},
  async () => {
    const guard = requireApiKey();
    if (guard) return guard;
    const result = await apiFetch("/api/fleet-session", {
      method: "POST",
      headers: apiKeyHeaders(),
      body: { action: "list" },
    });
    return formatResult(result);
  }
);

server.tool(
  "fleet_session_delete",
  "Delete a fleet session by ID. Response: { deleted: true, session_id }. Call when monitoring is complete to free server resources.",
  {
    session_id: z.string().describe("Fleet session ID to delete"),
  },
  async ({ session_id }) => {
    const guard = requireApiKey();
    if (guard) return guard;
    const result = await apiFetch("/api/fleet-session", {
      method: "POST",
      headers: apiKeyHeaders(),
      body: { action: "delete", session_id },
    });
    return formatResult(result);
  }
);

// ━━━━━━━━━ API KEY MANAGEMENT TOOLS ━━━━━━━━━

server.tool(
  "list_api_keys",
  "List all API keys for the authenticated user. Response: { keys: [{ id, name, masked_key, scope, enabled, created }] }. Use the record id with delete_api_key to revoke.",
  {
    user_id: z.string().describe("Your user ID (shown on your dashboard)"),
  },
  async ({ user_id }) => {
    const guard = requireApiKey();
    if (guard) return guard;
    const result = await apiFetch(`/api/api-keys?userId=${encodeURIComponent(user_id)}`, {
      method: "GET",
      headers: apiKeyHeaders(),
    });
    return formatResult(result);
  }
);

server.tool(
  "create_api_key",
  "Create a new CI-1T API key. Response: { api_key, masked_key, scope, record }. IMPORTANT: Save the returned api_key — it cannot be retrieved again after creation.",
  {
    user_id: z.string().describe("Your user ID (shown on your dashboard)"),
    name: z.string().min(1).max(100).describe("Human-readable name for the key"),
    scope: z.enum(["all", "evaluate", "fleet"]).optional().describe("Endpoint scope (default: all)"),
  },
  async ({ user_id, name, scope }) => {
    const guard = requireApiKey();
    if (guard) return guard;
    // Generate a random API key using cryptographic RNG
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = randomBytes(32);
    let raw = "ci_";
    for (let i = 0; i < 32; i++) {
      raw += chars[bytes[i] % chars.length];
    }
    const masked = raw.slice(0, 6) + "••••••";

    // SHA-256 hash the key
    const encoder = new TextEncoder();
    const data = encoder.encode(raw);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const result = await apiFetch("/api/api-keys", {
      method: "POST",
      headers: apiKeyHeaders(),
      body: {
        user: user_id,
        name,
        key_hash: keyHash,
        masked_key: masked,
        scope: scope || "all",
        enabled: true,
      },
    });

    if (result.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                api_key: raw,
                masked_key: masked,
                scope: scope || "all",
                record: result.data,
                note: "Save this key — it cannot be retrieved again.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
    return formatResult(result);
  }
);

server.tool(
  "delete_api_key",
  "Delete an API key by its PocketBase record ID (from list_api_keys). Response: { deleted: true }.",
  {
    id: z.string().describe("PocketBase record ID of the API key to delete"),
  },
  async ({ id }) => {
    const guard = requireApiKey();
    if (guard) return guard;
    const result = await apiFetch(`/api/api-keys?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: apiKeyHeaders(),
    });
    return formatResult(result);
  }
);

// ━━━━━━━━━ BILLING TOOLS ━━━━━━━━━

server.tool(
  "get_invoices",
  "Get billing history (Stripe invoices). Response: { invoices: [{ amount, credits, date, status }], has_more, cursor }. Pass cursor to paginate.",
  {
    cursor: z.string().optional().describe("Pagination cursor (payment intent ID) for next page"),
  },
  async ({ cursor }) => {
    const guard = requireApiKey();
    if (guard) return guard;
    const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const result = await apiFetch(`/api/stripe-invoices${params}`, {
      method: "GET",
      headers: apiKeyHeaders(),
    });
    return formatResult(result);
  }
);

// ━━━━━━━━━ UTILITY TOOLS (local, no auth) ━━━━━━━━━

server.tool(
  "interpret_scores",
  "Analyze raw prediction scores with statistical breakdown — no API call, no auth, no credits. Response: { count, mean, std, min, max, breakdown: [{ index, raw, normalized }] }. Accepts floats (0.0–1.0) or Q0.16 integers (0–65535) — auto-detects. For full stability classification (Stable/Drift/Flip/Collapse), pass scores to the evaluate tool instead.",
  {
    scores: z.array(z.number().min(0).max(65535)).min(1).max(300).describe("Array of scores — floats (0.0–1.0) or Q0.16 integers (0–65535)"),
  },
  async ({ scores }) => {
    const q16 = toQ16(scores);
    const normalized = q16.map((s) => Math.min(s, Q16) / Q16);
    const mean = normalized.reduce((a, b) => a + b, 0) / normalized.length;
    const std = Math.sqrt(normalized.reduce((a, b) => a + (b - mean) ** 2, 0) / normalized.length);
    const min = Math.min(...normalized);
    const max = Math.max(...normalized);

    const breakdown = normalized.map((n, i) => ({
      index: i,
      raw: q16[i],
      normalized: Number(n.toFixed(4)),
    }));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              count: q16.length,
              mean: Number(mean.toFixed(4)),
              std: Number(std.toFixed(4)),
              min: Number(min.toFixed(4)),
              max: Number(max.toFixed(4)),
              breakdown,
              note: "For stability classification (Stable/Drift/Flip/Collapse), run these through the evaluate tool.",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "convert_scores",
  "Convert between probability floats (0.0–1.0) and Q0.16 fixed-point integers (0–65535) — no API call, no auth, no credits. Response: { direction, count, converted: [{ input, q16|float }] }. Use to_q16 before evaluate, from_q16 to make CI outputs human-readable.",
  {
    scores: z.array(z.number()).min(1).max(300).describe("Array of scores to convert"),
    direction: z.enum(["to_q16", "from_q16"]).describe('"to_q16" converts 0.0–1.0 floats to Q0.16 integers. "from_q16" converts Q0.16 integers to floats.'),
  },
  async ({ scores, direction }) => {
    if (direction === "to_q16") {
      const converted = scores.map((s) => {
        const clamped = Math.max(0, Math.min(1, s));
        const q16 = Math.round(clamped * Q16);
        return { input: s, q16, clamped: s !== clamped };
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ direction, count: scores.length, converted }, null, 2),
          },
        ],
      };
    }

    // from_q16
    const converted = scores.map((s) => {
      const clamped = Math.max(0, Math.min(Q16, Math.round(s)));
      const float_val = Number((clamped / Q16).toFixed(6));
      return { input: s, float: float_val };
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ direction, count: scores.length, converted }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "generate_config",
  "Generate CI-1T integration boilerplate for a specific framework or language — no API call, no auth, no credits. Response: { framework, use_case, api_base, endpoints, score_format, auth, cost, instruction }. The instruction field tells you how to produce complete, production-ready integration code for the user's stack.",
  {
    framework: z.string().min(1).max(50).describe('Target framework or language (e.g. "fastapi", "express", "django", "flask", "nextjs", "python", "typescript", "go", "rust")'),
    use_case: z.enum(["single", "fleet", "guardrail"]).optional().describe('Integration pattern: "single" for single-model monitoring, "fleet" for multi-model fleet evaluation, "guardrail" for CI-as-guardrail (reject/fallback when unstable)'),
  },
  async ({ framework, use_case }) => {
    const useCase = use_case || "single";
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              framework,
              use_case: useCase,
              api_base: "https://collapseindex.org/api",
              endpoints: {
                evaluate: { method: "POST", path: "/api/evaluate", body: '{ "scores": [u16, ...] }' },
                fleet_evaluate: { method: "POST", path: "/api/fleet-evaluate", body: '{ "nodes": [[u16, ...], ...] }' },
                health: { method: "GET", path: "/health", url: `${BASE_URL}/health` },
              },
              score_format: "Q0.16 unsigned 16-bit integers (0-65535). Convert from float: Math.round(probability * 65535)",
              auth: "X-API-Key header with ci_... key. Single credential for all endpoints.",
              cost: "1 credit per episode (evaluate), 1 credit per episode per node (fleet-evaluate). 1,000 free credits on signup.",
              instruction: `Generate a complete, production-ready ${framework} integration for CI-1T using the "${useCase}" pattern. Include: API client setup, score submission, result parsing, error handling with retries, credit tracking from response (credits_used, credits_remaining), and a working example. Use the real endpoint ${BASE_URL}/api.`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ━━━━━━━━━ MONITORING / ANALYSIS TOOLS ━━━━━━━━━

server.tool(
  "compare_windows",
  "Compare two windows of episodes to detect drift or degradation — no API call, no auth, no credits. Takes baseline and recent episode arrays from evaluate or fleet_session_round responses. Response: { comparison: { baseline: stats, recent: stats }, delta: { ci_mean, ema_mean, al_mean, ghost_delta, warn_delta, fault_delta }, trend: 'improving'|'stable'|'degrading', degraded: bool, severity_factors: [...] }. Use after multiple evaluate calls to track model health over time.",
  {
    baseline: z.array(z.record(z.string(), z.unknown())).min(1).describe("Baseline episode array (e.g. last hour, known-good run)"),
    recent: z.array(z.record(z.string(), z.unknown())).min(1).describe("Recent episode array to compare against baseline"),
  },
  async ({ baseline, recent }) => {
    const Q = 65535;

    function windowStats(eps: Array<Record<string, unknown>>) {
      const cis = eps.map(e => ((e.ci_out as number) || 0) / Q);
      const emas = eps.map(e => ((e.ci_ema_out as number) || 0) / Q);
      const als = eps.map(e => (e.al_out as number) || 0);
      const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const max = (arr: number[]) => Math.max(...arr);
      const min = (arr: number[]) => Math.min(...arr);
      const ghosts = eps.filter(e => e.ghost_confirmed).length;
      const warns = eps.filter(e => e.warn).length;
      const faults = eps.filter(e => e.fault).length;

      return {
        episodes: eps.length,
        ci_mean: mean(cis),
        ci_max: max(cis),
        ci_min: min(cis),
        ema_mean: mean(emas),
        al_mean: mean(als),
        al_max: max(als),
        ghosts,
        warns,
        faults,
      };
    }

    function classify(ci: number): string {
      if (ci <= 0.15) return "Stable";
      if (ci <= 0.45) return "Drift";
      if (ci <= 0.70) return "Flip";
      return "Collapse";
    }

    const base = windowStats(baseline as Array<Record<string, unknown>>);
    const curr = windowStats(recent as Array<Record<string, unknown>>);

    const ciDelta = curr.ci_mean - base.ci_mean;
    const emaDelta = curr.ema_mean - base.ema_mean;
    const alDelta = curr.al_mean - base.al_mean;

    // Trend direction
    let trend: "improving" | "stable" | "degrading";
    if (ciDelta < -0.03) trend = "improving";
    else if (ciDelta > 0.03) trend = "degrading";
    else trend = "stable";

    // Severity assessment
    const severityFactors: string[] = [];
    if (ciDelta > 0.15) severityFactors.push(`CI jumped significantly (+${(ciDelta * 100).toFixed(1)}%)`);
    if (curr.ghosts > base.ghosts) severityFactors.push(`Ghost count increased (${base.ghosts} → ${curr.ghosts})`);
    if (curr.faults > base.faults) severityFactors.push(`Fault count increased (${base.faults} → ${curr.faults})`);
    if (curr.al_max > base.al_max) severityFactors.push(`Max authority level rose (AL${base.al_max} → AL${curr.al_max})`);
    if (classify(curr.ci_mean) !== classify(base.ci_mean)) {
      severityFactors.push(`Classification changed: ${classify(base.ci_mean)} → ${classify(curr.ci_mean)}`);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              comparison: {
                baseline: { ...base, ci_mean_pct: +(base.ci_mean * 100).toFixed(2), classification: classify(base.ci_mean) },
                recent: { ...curr, ci_mean_pct: +(curr.ci_mean * 100).toFixed(2), classification: classify(curr.ci_mean) },
              },
              delta: {
                ci_mean: +(ciDelta * 100).toFixed(2),
                ema_mean: +(emaDelta * 100).toFixed(2),
                al_mean: +alDelta.toFixed(2),
                ghost_delta: curr.ghosts - base.ghosts,
                warn_delta: curr.warns - base.warns,
                fault_delta: curr.faults - base.faults,
              },
              trend,
              degraded: trend === "degrading",
              severity_factors: severityFactors.length ? severityFactors : ["No significant changes detected"],
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "alert_check",
  "Check episodes against configurable thresholds and return triggered alerts — no API call, no auth, no credits. Takes an episode array from evaluate or fleet responses. Response: { status: 'ok'|'warn'|'critical', total_alerts, critical, warnings, episodes_checked, thresholds, alerts: [{ episode, type, value, threshold, severity }] }. Alert types: ci_exceeded, ema_exceeded, authority_elevated, ghost_detected, fault.",
  {
    episodes: z.array(z.record(z.string(), z.unknown())).min(1).describe("Episode array from an evaluate or fleet response"),
    ci_threshold: z.number().min(0).max(1).optional().describe("Alert if any episode CI exceeds this (default: 0.45 = Drift boundary)"),
    ema_threshold: z.number().min(0).max(1).optional().describe("Alert if any episode EMA exceeds this (default: 0.45)"),
    al_threshold: z.number().int().min(0).max(4).optional().describe("Alert if any episode authority level >= this (default: 3 = Minimal)"),
    ghost_alert: z.boolean().optional().describe("Alert on ghost detections (default: true)"),
    fault_alert: z.boolean().optional().describe("Alert on faults (default: true)"),
  },
  async ({ episodes, ci_threshold, ema_threshold, al_threshold, ghost_alert, fault_alert }) => {
    const Q = 65535;
    const ciThresh = ci_threshold ?? 0.45;
    const emaThresh = ema_threshold ?? 0.45;
    const alThresh = al_threshold ?? 3;
    const ghostOn = ghost_alert ?? true;
    const faultOn = fault_alert ?? true;

    interface Alert {
      episode: number;
      type: string;
      value: string;
      threshold: string;
      severity: "warn" | "critical";
    }

    const alerts: Alert[] = [];

    (episodes as Array<Record<string, unknown>>).forEach((ep, i) => {
      const ci = ((ep.ci_out as number) || 0) / Q;
      const ema = ((ep.ci_ema_out as number) || 0) / Q;
      const al = (ep.al_out as number) || 0;

      if (ci > ciThresh) {
        alerts.push({
          episode: i + 1,
          type: "ci_exceeded",
          value: `${(ci * 100).toFixed(1)}%`,
          threshold: `${(ciThresh * 100).toFixed(1)}%`,
          severity: ci > 0.70 ? "critical" : "warn",
        });
      }

      if (ema > emaThresh) {
        alerts.push({
          episode: i + 1,
          type: "ema_exceeded",
          value: `${(ema * 100).toFixed(1)}%`,
          threshold: `${(emaThresh * 100).toFixed(1)}%`,
          severity: ema > 0.70 ? "critical" : "warn",
        });
      }

      if (al >= alThresh) {
        alerts.push({
          episode: i + 1,
          type: "authority_elevated",
          value: `AL${al}`,
          threshold: `AL${alThresh}`,
          severity: al >= 4 ? "critical" : "warn",
        });
      }

      if (ghostOn && ep.ghost_confirmed) {
        alerts.push({
          episode: i + 1,
          type: "ghost_detected",
          value: `streak ${ep.ghost_suspect_streak || 0}`,
          threshold: "any",
          severity: "critical",
        });
      }

      if (faultOn && ep.fault) {
        alerts.push({
          episode: i + 1,
          type: "fault",
          value: `code ${ep.fault_code || 0}`,
          threshold: "any",
          severity: "critical",
        });
      }
    });

    const critCount = alerts.filter(a => a.severity === "critical").length;
    const warnCount = alerts.filter(a => a.severity === "warn").length;

    let status: "ok" | "warn" | "critical";
    if (critCount > 0) status = "critical";
    else if (warnCount > 0) status = "warn";
    else status = "ok";

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              status,
              total_alerts: alerts.length,
              critical: critCount,
              warnings: warnCount,
              episodes_checked: episodes.length,
              thresholds: {
                ci: `${(ciThresh * 100).toFixed(0)}%`,
                ema: `${(emaThresh * 100).toFixed(0)}%`,
                al: `AL${alThresh}`,
                ghost: ghostOn,
                fault: faultOn,
              },
              alerts,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ━━━━━━━━━ VISUALIZATION TOOL ━━━━━━━━━

/** Generate self-contained HTML visualization matching Lab dashboard style */
function buildVisualizationHTML(episodes: Array<Record<string, unknown>>, title?: string): string {
  const Q = 65535;
  const eps = JSON.stringify(episodes);
  const chartTitle = escapeHtml(title || "CI-1T Stability Analysis");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${chartTitle}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
    --font-mono: 'IBM Plex Mono', 'SF Mono', SFMono-Regular, ui-monospace, monospace;
    --bg: #111; --surface: rgba(255,255,255,0.03); --border: rgba(255,255,255,0.08);
    --text: #f5f5f5; --muted: #b0b0b0; --faint: #888; --accent: #fff;
    --green: #4ade80; --amber: #fbbf24; --orange: #f97316; --red: #f87171;
    --ghost: #a78bfa; --cyan: #0ea5e9;
    --sidebar-w: 220px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--text); font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased; min-height: 100vh;
  }

  /* ─── Sidebar ─── */
  .sidebar {
    position: fixed; top: 0; left: 0; width: var(--sidebar-w); height: 100vh;
    z-index: 30; display: flex; flex-direction: column; justify-content: space-between;
    background: rgba(17,17,17,0.85); backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-right: 1px solid var(--border); overflow-y: auto; overflow-x: hidden;
  }
  .sidebar-top { flex: 1; overflow-y: auto; }
  .sidebar-brand {
    padding: 20px; border-bottom: 1px solid var(--border);
  }
  .sidebar-brand a {
    font-family: var(--font-mono); font-weight: 700; font-size: 18px;
    color: var(--accent); text-decoration: none; letter-spacing: -0.5px;
  }
  .sidebar-section-label {
    font-family: var(--font-mono); font-size: 10px; color: var(--faint);
    text-transform: uppercase; letter-spacing: 1px; padding: 14px 20px 6px;
  }
  .sidebar-divider { height: 1px; background: var(--border); margin: 10px 12px; }

  /* Gauge cards in sidebar */
  .gauges { display: flex; flex-direction: column; gap: 8px; padding: 8px 12px; }
  .gauge {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 10px 14px;
  }
  .gauge-label {
    font-family: var(--font-mono); font-size: 10px; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;
  }
  .gauge-value {
    font-family: var(--font-mono); font-size: 20px; font-weight: 700;
    font-variant-numeric: tabular-nums; line-height: 1.2;
  }
  .gauge-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }

  /* Legend in sidebar */
  .legend { display: flex; flex-direction: column; gap: 4px; padding: 4px 20px 8px; }
  .legend-item {
    display: flex; align-items: center; gap: 8px;
    font-family: var(--font-mono); font-size: 11px; color: var(--faint);
  }
  .legend-dot { width: 6px; height: 6px; border-radius: 1px; flex-shrink: 0; }

  /* Stats in sidebar */
  .stats { display: flex; flex-direction: column; gap: 3px; padding: 4px 12px 12px; }
  .stat-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 4px 8px; font-family: var(--font-mono); font-size: 11px; color: var(--faint);
    border-radius: 4px;
  }
  .stat-row:hover { background: rgba(255,255,255,0.04); }
  .stat-val { font-weight: 600; color: var(--text); }

  /* Sidebar footer */
  .sidebar-bottom {
    padding: 12px 20px; border-top: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 4px;
  }
  .sidebar-bottom a {
    color: var(--faint); text-decoration: none; font-size: 11px;
    font-family: var(--font-mono); transition: color 0.15s;
  }
  .sidebar-bottom a:hover { color: var(--text); }

  /* ─── Main content ─── */
  main {
    margin-left: var(--sidebar-w);
    padding: clamp(20px, 3vw, 40px); padding-top: clamp(20px, 4vh, 36px);
    max-width: calc(960px + var(--sidebar-w));
    min-height: 100vh;
  }
  .header { margin-bottom: 20px; }
  h1 { font-size: 20px; font-weight: 700; color: var(--text); margin-bottom: 2px; }
  .subtitle { font-size: 12px; color: var(--muted); }

  /* Chart panels */
  .charts { display: flex; flex-direction: column; gap: 14px; }
  .charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 640px) { .charts-row { grid-template-columns: 1fr; } }
  .panel {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px;
  }
  .panel-label {
    font-family: var(--font-mono); font-size: 12px; font-weight: 600;
    color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;
  }
  .canvas-wrap { background: rgba(255,255,255,0.015); border-radius: 4px; overflow: hidden; }
  canvas { width: 100%; display: block; cursor: crosshair; }
  .ep-labels {
    display: flex; justify-content: center; gap: 0; margin-top: 4px;
    font-family: var(--font-mono); font-size: 10px; color: rgba(176,176,176,0.5);
  }
  .ep-labels span { text-align: center; }

  /* Tooltip */
  #tooltip {
    position: fixed; pointer-events: none; opacity: 0; transition: opacity 150ms;
    background: #1f1f1f; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
    padding: 8px 12px; font-family: var(--font-mono); font-size: 12px;
    color: var(--text); z-index: 100; white-space: nowrap;
    box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1);
  }
  #tooltip.visible { opacity: 1; }
  .tt-row { display: flex; justify-content: space-between; gap: 14px; margin: 1px 0; }
  .tt-label { color: var(--muted); }
  .tt-value { font-weight: 500; font-variant-numeric: tabular-nums; }
  .tt-badge {
    display: inline-block; padding: 1px 5px; border-radius: 3px;
    font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; margin-left: 4px;
  }

  /* ─── Mobile: sidebar collapses ─── */
  @media (max-width: 768px) {
    .sidebar { transform: translateX(-100%); transition: transform 0.25s; }
    .sidebar.open { transform: translateX(0); }
    main { margin-left: 0; }
  }
</style>
</head>
<body>

<aside class="sidebar">
  <div class="sidebar-top">
    <div class="sidebar-brand"><a href="https://collapseindex.org" target="_blank">CI-1T</a></div>

    <div class="sidebar-section-label">Metrics</div>
    <div class="gauges" id="gauges"></div>

    <div class="sidebar-divider"></div>
    <div class="sidebar-section-label">Legend</div>
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:var(--green)"></div>Stable \u2264 15%</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--amber)"></div>Drift \u2264 45%</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--orange)"></div>Flip \u2264 70%</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--red)"></div>Collapse > 70%</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--ghost)"></div>Ghost</div>
    </div>

    <div class="sidebar-divider"></div>
    <div class="sidebar-section-label">Summary</div>
    <div class="stats" id="stats"></div>
  </div>

  <div class="sidebar-bottom">
    <a href="https://collapseindex.org" target="_blank">collapseindex.org</a>
  </div>
</aside>

<main>
  <div class="header">
    <h1>${chartTitle}</h1>
    <div class="subtitle">${episodes.length} episode${episodes.length !== 1 ? "s" : ""} \u2022 CI-1T GRM v2</div>
  </div>

  <div class="charts">
    <div class="panel">
      <div class="panel-label">CI per Episode</div>
      <div class="canvas-wrap"><canvas id="ciChart" height="140"></canvas></div>
      <div class="ep-labels" id="ciLabels"></div>
    </div>
    <div class="charts-row">
      <div class="panel">
        <div class="panel-label">CI EMA Trend</div>
        <div class="canvas-wrap"><canvas id="emaChart" height="120"></canvas></div>
        <div class="ep-labels" id="emaLabels"></div>
      </div>
      <div class="panel">
        <div class="panel-label">Authority Level</div>
        <div class="canvas-wrap"><canvas id="alChart" height="120"></canvas></div>
        <div class="ep-labels" id="alLabels"></div>
      </div>
    </div>
  </div>
</main>

<div id="tooltip"></div>

<script>
const Q16 = ${Q};
const episodes = ${eps};
const tooltip = document.getElementById('tooltip');

function classifyCI(n) {
  if (n <= 0.15) return { label: 'Stable',   color: '#4ade80', bg: 'rgba(74,222,128,0.15)' };
  if (n <= 0.45) return { label: 'Drift',    color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' };
  if (n <= 0.70) return { label: 'Flip',     color: '#f97316', bg: 'rgba(249,115,22,0.15)' };
  return              { label: 'Collapse', color: '#f87171', bg: 'rgba(248,113,113,0.15)' };
}

function alColor(al) {
  return ['#4ade80','#0ea5e9','#fbbf24','#f97316','#f87171'][Math.min(al, 4)];
}
function alLabel(al) {
  return ['Full trust','Caution','Reduced','Minimal','No authority'][Math.min(al, 4)];
}

// ─── Bar renderer — adaptive sizing ───
function drawBars(canvasId, values, opts) {
  const canvas = document.getElementById(canvasId);
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  const maxVal = opts.maxVal || Math.max(...values.map(v => v.val), 0.01);
  const pad = 16;
  const plotW = w - pad * 2;
  const plotH = h - 4;

  var n = values.length;
  var gapRatio = 0.3;
  var slotW = plotW / n;
  var barW = Math.max(4, Math.min(48, slotW * (1 - gapRatio)));
  var gap = slotW - barW;
  var totalW = n * barW + (n - 1) * gap;
  var offsetX = pad + (plotW - totalW) / 2;

  // Episode labels
  var labelsId = canvasId.replace('Chart', 'Labels');
  var labelsEl = document.getElementById(labelsId);
  if (labelsEl) {
    labelsEl.innerHTML = values.map(function(_, i) {
      return '<span style="width:' + (barW + gap) + 'px">E' + (i + 1) + '</span>';
    }).join('');
  }

  var barMeta = [];
  values.forEach(function(v, i) {
    var x = offsetX + i * (barW + gap);
    var barH = Math.max(4, (v.val / maxVal) * plotH);
    var y = h - 2 - barH;
    var r = Math.min(2, barW / 4);

    var hex = v.color;
    var cr = parseInt(hex.slice(1,3),16), cg = parseInt(hex.slice(3,5),16), cb = parseInt(hex.slice(5,7),16);
    ctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',0.75)';

    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, r);
    ctx.fill();

    barMeta.push({ x: x, y: y, w: barW, h: barH, idx: i });
  });

  // Threshold lines for CI chart
  if (opts.thresholds) {
    [{ val: 0.15, color: '#4ade80' }, { val: 0.45, color: '#fbbf24' }, { val: 0.70, color: '#f97316' }].forEach(t => {
      if (t.val <= maxVal) {
        var ty = h - 2 - (t.val / maxVal) * plotH;
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = t.color + '40';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(pad, ty); ctx.lineTo(w - pad, ty); ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }

  // Hover
  canvas.addEventListener('mousemove', (e) => {
    const cr = canvas.getBoundingClientRect();
    const mx = e.clientX - cr.left;
    const hit = barMeta.find(b => mx >= b.x - 1 && mx <= b.x + b.w + 1);
    if (hit) {
      const ep = episodes[hit.idx];
      const ci = (ep.ci_out || 0) / Q16;
      const cls = classifyCI(ci);
      tooltip.innerHTML =
        '<div style="font-weight:600;margin-bottom:4px;color:' + cls.color + '">' +
          'Episode ' + (hit.idx + 1) +
          '<span class="tt-badge" style="background:' + cls.bg + ';color:' + cls.color + '">' + cls.label + '</span>' +
          (ep.ghost_confirmed ? '<span class="tt-badge" style="background:rgba(167,139,250,0.15);color:#a78bfa">Ghost</span>' : '') +
          (ep.warn ? '<span class="tt-badge" style="background:rgba(251,191,36,0.15);color:#fbbf24">Warn</span>' : '') +
          (ep.fault ? '<span class="tt-badge" style="background:rgba(248,113,113,0.15);color:#f87171">Fault</span>' : '') +
        '</div>' +
        '<div class="tt-row"><span class="tt-label">CI</span><span class="tt-value" style="color:' + cls.color + '">' + (ep.ci_out || 0) + ' / ${Q} (' + (ci * 100).toFixed(1) + '%)</span></div>' +
        '<div class="tt-row"><span class="tt-label">EMA</span><span class="tt-value">' + (ep.ci_ema_out || 0) + '</span></div>' +
        '<div class="tt-row"><span class="tt-label">Authority</span><span class="tt-value" style="color:' + alColor(ep.al_out || 0) + '">AL' + (ep.al_out || 0) + ' \u2014 ' + alLabel(ep.al_out || 0) + '</span></div>' +
        (ep.ghost_suspect ? '<div class="tt-row"><span class="tt-label">Ghost</span><span class="tt-value" style="color:#a78bfa">Suspect (' + (ep.ghost_suspect_streak || 0) + ')</span></div>' : '');
      tooltip.classList.add('visible');
      tooltip.style.left = Math.min(e.clientX + 12, window.innerWidth - 240) + 'px';
      tooltip.style.top = (e.clientY - 8) + 'px';
    } else {
      tooltip.classList.remove('visible');
    }
  });
  canvas.addEventListener('mouseleave', function() { tooltip.classList.remove('visible'); });

  return barMeta;
}

// ─── Render ───
function render() {
  const lastEp = episodes[episodes.length - 1];
  const lastCI = (lastEp.ci_out || 0) / Q16;
  const lastEMA = (lastEp.ci_ema_out || 0) / Q16;
  const lastAL = lastEp.al_out || 0;
  const ghostCount = episodes.filter(function(e) { return e.ghost_confirmed; }).length;
  const cls = classifyCI(lastCI);

  // Sidebar gauge cards
  document.getElementById('gauges').innerHTML =
    '<div class="gauge"><div class="gauge-label">Collapse Index</div>' +
      '<div class="gauge-value" style="color:' + cls.color + '">' + (lastCI * 100).toFixed(1) + '%</div>' +
      '<div class="gauge-sub">' + cls.label + '</div></div>' +
    '<div class="gauge"><div class="gauge-label">EMA</div>' +
      '<div class="gauge-value" style="color:#0ea5e9">' + (lastEMA * 100).toFixed(1) + '%</div>' +
      '<div class="gauge-sub">Smoothed trend</div></div>' +
    '<div class="gauge"><div class="gauge-label">Authority</div>' +
      '<div class="gauge-value" style="color:' + alColor(lastAL) + '">AL' + lastAL + '</div>' +
      '<div class="gauge-sub">' + alLabel(lastAL) + '</div></div>' +
    '<div class="gauge"><div class="gauge-label">Ghost</div>' +
      '<div class="gauge-value" style="color:' + (ghostCount ? '#a78bfa' : '#b0b0b0') + '">' + ghostCount + '</div>' +
      '<div class="gauge-sub">' + (ghostCount ? 'Detected' : 'None') + '</div></div>';

  // Charts
  var ciVals = episodes.map(function(ep) {
    var ci = (ep.ci_out || 0) / Q16;
    var ghost = ep.ghost_confirmed || false;
    var c = classifyCI(ci);
    return { val: ci, color: ghost ? '#a78bfa' : c.color };
  });
  drawBars('ciChart', ciVals, { maxVal: 1, thresholds: true });

  var emaVals = episodes.map(function(ep) {
    return { val: (ep.ci_ema_out || 0) / Q16, color: '#0ea5e9' };
  });
  drawBars('emaChart', emaVals, { maxVal: 1 });

  var alVals = episodes.map(function(ep) {
    return { val: ep.al_out || 0, color: alColor(ep.al_out || 0) };
  });
  drawBars('alChart', alVals, { maxVal: 4 });

  // Sidebar stats
  var ciNorm = episodes.map(function(ep) { return (ep.ci_out || 0) / Q16; });
  var mean = ciNorm.reduce(function(a, b) { return a + b; }, 0) / ciNorm.length;
  var maxCI = Math.max.apply(null, ciNorm);
  var minCI = Math.min.apply(null, ciNorm);
  var warns = episodes.filter(function(e) { return e.warn; }).length;
  var faults = episodes.filter(function(e) { return e.fault; }).length;
  var mCls = classifyCI(mean);

  document.getElementById('stats').innerHTML =
    '<div class="stat-row"><span>Episodes</span><span class="stat-val">' + episodes.length + '</span></div>' +
    '<div class="stat-row"><span>Mean CI</span><span class="stat-val" style="color:' + mCls.color + '">' + (mean * 100).toFixed(1) + '%</span></div>' +
    '<div class="stat-row"><span>Range</span><span class="stat-val">' + (minCI * 100).toFixed(1) + ' \u2013 ' + (maxCI * 100).toFixed(1) + '%</span></div>' +
    '<div class="stat-row"><span>Verdict</span><span class="stat-val" style="color:' + mCls.color + '">' + mCls.label + '</span></div>' +
    (warns ? '<div class="stat-row"><span>Warns</span><span class="stat-val" style="color:#fbbf24">' + warns + '</span></div>' : '') +
    (faults ? '<div class="stat-row"><span>Faults</span><span class="stat-val" style="color:#f87171">' + faults + '</span></div>' : '') +
    (ghostCount ? '<div class="stat-row"><span>Ghosts</span><span class="stat-val" style="color:#a78bfa">' + ghostCount + '</span></div>' : '');
}

window.addEventListener('resize', render);
render();
</script>
</body>
</html>`;
}

server.tool(
  "visualize",
  "Generate an interactive HTML visualization of CI-1T evaluate results — no API call, no auth, no credits. Takes an episode array from evaluate or fleet responses. Returns a file path to a self-contained HTML chart with sidebar KPIs, color-coded CI bars, EMA trend, authority levels, and hover tooltips. Response: { visualization: filepath, episodes, title, instruction }. Open the file in a browser or VS Code Simple Browser.",
  {
    episodes: z.array(z.record(z.string(), z.unknown())).min(1).describe("Episode array from an evaluate or fleet_evaluate response"),
    title: z.string().optional().describe("Chart title (default: CI-1T Stability Analysis)"),
  },
  async ({ episodes, title }) => {
    const html = buildVisualizationHTML(episodes as Array<Record<string, unknown>>, title);

    // Write to temp file
    const tmpDir = path.join(os.tmpdir(), "ci1t-mcp");
    fs.mkdirSync(tmpDir, { recursive: true });

    // Cleanup: remove viz files older than 1 hour
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();
    try {
      for (const f of fs.readdirSync(tmpDir)) {
        if (!f.startsWith("ci1t_viz_")) continue;
        const fPath = path.join(tmpDir, f);
        const stat = fs.statSync(fPath);
        if (now - stat.mtimeMs > ONE_HOUR) fs.unlinkSync(fPath);
      }
    } catch { /* cleanup is best-effort */ }

    const filename = `ci1t_viz_${Date.now()}.html`;
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, html, "utf-8");

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              visualization: filePath,
              episodes: episodes.length,
              title: title || "CI-1T Stability Analysis",
              instruction: "Open this HTML file in a browser or VS Code Simple Browser to view the interactive chart.",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Start ────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ci1t-mcp] Server started — stdio transport");
  console.error(`[ci1t-mcp] Base URL: ${BASE_URL}`);
  console.error(`[ci1t-mcp] API key: ${API_KEY ? "configured" : "NOT SET"}`);
  console.error(`[ci1t-mcp] 20 tools + 1 resource registered`);

  if (!API_KEY) {
    console.error("");
    console.error("[ci1t-mcp] ⚡ New here? Try asking your AI agent:");
    console.error('[ci1t-mcp]   "Help me get started with CI-1T"');
    console.error("[ci1t-mcp]   This will call the onboarding tool with full setup instructions.");
    console.error(`[ci1t-mcp]   Create a free account at ${SIGNUP_URL} — 1,000 free credits on signup`);
    console.error("");
  }
}

main().catch((err) => {
  console.error("[ci1t-mcp] Fatal:", err);
  process.exit(1);
});
