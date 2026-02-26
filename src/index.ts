#!/usr/bin/env node

/**
 * CI-1T MCP Server v1.0.0
 *
 * Model Context Protocol server for CI-1T — the prediction stability engine.
 * Exposes 13 tools across evaluation, fleet sessions, API key management, and billing.
 *
 * Auth:
 *   CI1T_API_KEY  — ci_... API key for evaluate + fleet-evaluate (X-API-Key header)
 *   CI1T_TOKEN    — PocketBase Bearer token for dashboard endpoints (api-keys, sessions, lab)
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
const PB_TOKEN = process.env.CI1T_TOKEN || "";

// ─── HTTP helpers ─────────────────────────────────────────

/** Headers using X-API-Key auth (for evaluate endpoints) */
function apiKeyHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["X-API-Key"] = API_KEY;
  return { ...h, ...extra };
}

/** Headers using Bearer token auth (for dashboard endpoints) */
function bearerHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (PB_TOKEN) h["Authorization"] = `Bearer ${PB_TOKEN}`;
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
  version: "1.0.0",
});

// ━━━━━━━━━ EVALUATION TOOLS ━━━━━━━━━

server.tool(
  "evaluate",
  "Evaluate prediction stability. Sends an array of Q0.16 scores (0–65535) to the CI-1T engine and returns Collapse Index, authority level, ghost detection, and fault flags for each episode.",
  {
    scores: z.array(z.number().int().min(0).max(65535)).min(1).describe("Array of Q0.16 prediction scores (0–65535)"),
    n: z.number().int().min(2).max(8).optional().describe("Episode length (default: 3)"),
  },
  async ({ scores, n }) => {
    const body: Record<string, unknown> = { scores };
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
  "Evaluate a fleet of model nodes for prediction stability. Each node provides a score stream. Returns per-node Collapse Index, fleet-wide ghost detection, and aggregate statistics.",
  {
    nodes: z.array(z.array(z.number().int().min(0).max(65535)).min(1)).min(1).describe("Array of node score arrays — each inner array is one node's Q0.16 scores"),
    n: z.number().int().min(2).max(8).optional().describe("Episode length (default: 3)"),
  },
  async ({ nodes, n }) => {
    const body: Record<string, unknown> = { nodes };
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
  "Probe an LLM for prediction instability. Sends the same prompt 3 times and compares responses using the specified similarity method. Returns Q0.16 scores, normalized scores (0–1), and truncated responses. Requires Bearer token auth.",
  {
    prompt: z.string().min(3).max(500).describe("The prompt to send 3 times to the LLM"),
    method: z.enum(["jaccard", "length", "fingerprint"]).optional().describe("Similarity method (default: jaccard)"),
  },
  async ({ prompt, method }) => {
    const body: Record<string, unknown> = { action: "probe", prompt };
    if (method) body.method = method;
    const result = await apiFetch("/api/lab", {
      method: "POST",
      headers: bearerHeaders(),
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
    const result = await apiFetch("/api/fleet-session", {
      method: "POST",
      headers: bearerHeaders(),
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
    const body: Record<string, unknown> = { action: "create", node_count };
    if (node_names) body.node_names = node_names;
    const result = await apiFetch("/api/fleet-session", {
      method: "POST",
      headers: bearerHeaders(),
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
    const result = await apiFetch("/api/fleet-session", {
      method: "POST",
      headers: bearerHeaders(),
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
    const result = await apiFetch("/api/fleet-session", {
      method: "POST",
      headers: bearerHeaders(),
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
    const result = await apiFetch("/api/fleet-session", {
      method: "POST",
      headers: bearerHeaders(),
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
    const result = await apiFetch("/api/fleet-session", {
      method: "POST",
      headers: bearerHeaders(),
      body: { action: "delete", session_id },
    });
    return formatResult(result);
  }
);

// ━━━━━━━━━ API KEY MANAGEMENT TOOLS ━━━━━━━━━

server.tool(
  "list_api_keys",
  "List all API keys for the authenticated user. Requires Bearer token auth.",
  {
    user_id: z.string().describe("Your PocketBase user ID"),
  },
  async ({ user_id }) => {
    const result = await apiFetch(`/api/api-keys?userId=${encodeURIComponent(user_id)}`, {
      method: "GET",
      headers: bearerHeaders(),
    });
    return formatResult(result);
  }
);

server.tool(
  "create_api_key",
  "Create a new CI-1T API key. Returns the key record (the raw key is generated client-side — use the masked_key for display). Requires Bearer token auth.",
  {
    user_id: z.string().describe("Your PocketBase user ID"),
    name: z.string().min(1).max(100).describe("Human-readable name for the key"),
    scope: z.enum(["all", "evaluate", "fleet"]).optional().describe("Endpoint scope (default: all)"),
  },
  async ({ user_id, name, scope }) => {
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
      headers: bearerHeaders(),
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
  "Delete an API key by record ID. Requires Bearer token auth.",
  {
    id: z.string().describe("PocketBase record ID of the API key to delete"),
  },
  async ({ id }) => {
    const result = await apiFetch(`/api/api-keys?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: bearerHeaders(),
    });
    return formatResult(result);
  }
);

// ━━━━━━━━━ BILLING TOOLS ━━━━━━━━━

server.tool(
  "get_invoices",
  "Get billing history (Stripe invoices). Returns recent payments with credit amounts. Requires Bearer token auth.",
  {
    cursor: z.string().optional().describe("Pagination cursor (payment intent ID) for next page"),
  },
  async ({ cursor }) => {
    const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const result = await apiFetch(`/api/stripe-invoices${params}`, {
      method: "GET",
      headers: bearerHeaders(),
    });
    return formatResult(result);
  }
);

// ─── Start ────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ci1t-mcp] Server started — stdio transport");
  console.error(`[ci1t-mcp] Base URL: ${BASE_URL}`);
  console.error(`[ci1t-mcp] API key: ${API_KEY ? "configured" : "NOT SET"}`);
  console.error(`[ci1t-mcp] PB token: ${PB_TOKEN ? "configured" : "NOT SET"}`);
  console.error(`[ci1t-mcp] 13 tools registered`);
}

main().catch((err) => {
  console.error("[ci1t-mcp] Fatal:", err);
  process.exit(1);
});
