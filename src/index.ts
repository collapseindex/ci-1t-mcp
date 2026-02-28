#!/usr/bin/env node

/**
 * CI-1T MCP Server v1.4.0
 *
 * Model Context Protocol server for CI-1T — the prediction stability engine.
 * Exposes 18 tools across evaluation, fleet sessions, API key management, billing, visualization, and utilities.
 *
 * Auth:
 *   CI1T_API_KEY  — ci_... API key. Single credential for all authenticated tools.
 *   CI1T_BASE_URL — API base URL (default: https://collapseindex.org)
 *
 * Transport: stdio (for Claude Desktop, Cursor, Windsurf, etc.)
 *
 * © 2026 Collapse Index Labs — Apache 2.0
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

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
  version: "1.4.0",
});

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

/** Auto-convert: if all values are 0–1 floats, scale to Q0.16. Otherwise clamp to 0–65535. */
function toQ16(scores: number[]): number[] {
  const isFloat = scores.every((s) => s >= 0 && s <= 1);
  return isFloat
    ? scores.map((s) => Math.round(Math.max(0, Math.min(1, s)) * Q16))
    : scores.map((s) => Math.round(Math.max(0, Math.min(Q16, s))));
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
  "Evaluate prediction stability. Sends scores to the CI-1T engine and returns stability metrics for each episode. Accepts floats (0.0–1.0) or Q0.16 integers (0–65535) — auto-converts.",
  {
    scores: z.array(z.number().min(0).max(65535)).min(1).describe("Array of prediction scores — floats (0.0–1.0) or Q0.16 integers (0–65535), auto-detected"),
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
  "Evaluate a fleet of model nodes for prediction stability. Each node provides a score stream. Returns per-node stability metrics and aggregate statistics. Accepts floats (0.0–1.0) or Q0.16 integers (0–65535) — auto-converts per node.",
  {
    nodes: z.array(z.array(z.number().min(0).max(65535)).min(1)).min(1).describe("Array of node score arrays — each inner array is one node's scores (floats or Q0.16)"),
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
  "Probe an LLM for prediction instability. Sends the same prompt 3 times and compares responses using the specified similarity method. Returns Q0.16 scores, normalized scores (0–1), and truncated responses.",
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
  "Check CI-1T engine health. Returns engine version, status, and latency.",
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
  "Create a new persistent fleet monitoring session. Returns a session ID for subsequent rounds. Max 16 nodes.",
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
  "Submit a scoring round to an existing fleet session. Each node's scores array is evaluated, and the cumulative fleet snapshot is returned.",
  {
    session_id: z.string().describe("Fleet session ID"),
    scores: z.array(z.array(z.number().int().min(0).max(65535)).min(1)).min(1).describe("Per-node score arrays for this round"),
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
  "Get the current state of a fleet session without submitting new scores.",
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
  "List all active fleet sessions.",
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
  "Delete a fleet session by ID.",
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
  "List all API keys for the authenticated user.",
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
  "Create a new CI-1T API key. Returns the key value and record. Save the key — it cannot be retrieved again.",
  {
    user_id: z.string().describe("Your user ID (shown on your dashboard)"),
    name: z.string().min(1).max(100).describe("Human-readable name for the key"),
    scope: z.enum(["all", "evaluate", "fleet"]).optional().describe("Endpoint scope (default: all)"),
  },
  async ({ user_id, name, scope }) => {
    const guard = requireApiKey();
    if (guard) return guard;
    // Generate a random API key client-side
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let raw = "ci_";
    for (let i = 0; i < 32; i++) {
      raw += chars[Math.floor(Math.random() * chars.length)];
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
  "Delete an API key by record ID.",
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
  "Get billing history (Stripe invoices). Returns recent payments with credit amounts.",
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
  "Analyze raw prediction scores with statistical breakdown. Computes mean, standard deviation, min/max, and normalized values. Accepts floats (0.0–1.0) or Q0.16 integers (0–65535) — auto-detects. No API call, no auth, no credits. For full stability classification, use the evaluate tool.",
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
  "Convert between probability floats (0.0–1.0) and Q0.16 fixed-point integers (0–65535). No API call, no auth, no credits. Use when users have model confidence or probability outputs that need converting before evaluation, or want to interpret raw Q0.16 values.",
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
  "Generate CI-1T integration boilerplate for a specific framework or language. Returns structured config with API endpoints, auth pattern, score format, and a generation instruction so you can produce complete, production-ready integration code. No API call, no auth, no credits.",
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

// ━━━━━━━━━ VISUALIZATION TOOL ━━━━━━━━━

/** Generate self-contained HTML visualization matching Lab dashboard style */
function buildVisualizationHTML(episodes: Array<Record<string, unknown>>, title?: string): string {
  const Q = 65535;
  const eps = JSON.stringify(episodes);
  const chartTitle = title || "CI-1T Stability Analysis";

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
  "Generate an interactive HTML visualization of CI-1T evaluate results. Returns a file path to a self-contained HTML chart with color-coded CI bars, EMA trend, authority levels, hover tooltips, and summary stats — same style as the CI-1T dashboard Lab. Open the returned file in a browser to view.",
  {
    episodes: z.array(z.record(z.string(), z.unknown())).min(1).describe("Episode array from an evaluate or fleet_evaluate response"),
    title: z.string().optional().describe("Chart title (default: CI-1T Stability Analysis)"),
  },
  async ({ episodes, title }) => {
    const html = buildVisualizationHTML(episodes as Array<Record<string, unknown>>, title);

    // Write to temp file
    const tmpDir = path.join(os.tmpdir(), "ci1t-mcp");
    fs.mkdirSync(tmpDir, { recursive: true });
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
  console.error(`[ci1t-mcp] 18 tools registered`);

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
