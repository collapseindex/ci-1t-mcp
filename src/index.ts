#!/usr/bin/env node

/**
 * CI-1T MCP Server v1.3.0
 *
 * Model Context Protocol server for CI-1T — the prediction stability engine.
 * Exposes 17 tools across evaluation, fleet sessions, API key management, billing, and utilities.
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
  version: "1.3.0",
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

// ─── Start ────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ci1t-mcp] Server started — stdio transport");
  console.error(`[ci1t-mcp] Base URL: ${BASE_URL}`);
  console.error(`[ci1t-mcp] API key: ${API_KEY ? "configured" : "NOT SET"}`);
  console.error(`[ci1t-mcp] 17 tools registered`);

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
