# CI-1T MCP Server — Security Audit

**Version Audited:** 1.6.0  
**Date:** February 27, 2026  
**Auditor:** GitHub Copilot  
**File:** `src/index.ts` (1,479 lines)

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| **Critical** | 1 | Needs fix |
| **High** | 1 | Needs fix |
| **Medium** | 3 | Needs fix |
| **Low** | 3 | Advisory |
| **Info** | 4 | No action needed |

---

## Critical

### SEC-01: Weak RNG for API Key Generation
**Location:** `src/index.ts` L589–592 (`create_api_key` tool)  
**Issue:** `Math.random()` is a non-cryptographic PRNG. API keys generated with it are predictable if the seed state is known or inferred.

```typescript
// CURRENT — insecure
for (let i = 0; i < 32; i++) {
  raw += chars[Math.floor(Math.random() * chars.length)];
}
```

**Fix:** Use `crypto.getRandomValues()` (available in Node 18+):
```typescript
import { randomBytes } from "crypto";

const bytes = randomBytes(32);
let raw = "ci_";
for (let i = 0; i < 32; i++) {
  raw += chars[bytes[i] % chars.length];
}
```

**Risk:** An attacker who can observe timing or state could predict future API keys. Since this key grants full account access, this is critical.

---

## High

### SEC-02: XSS via Unsanitized Title in Visualization HTML
**Location:** `src/index.ts` L1027, L1173, L1174 (`buildVisualizationHTML`)  
**Issue:** The `title` parameter is interpolated directly into HTML without escaping:

```typescript
const chartTitle = title || "CI-1T Stability Analysis";
return `...
<title>${chartTitle}</title>
...
<h1>${chartTitle}</h1>
```

If a malicious agent or user passes `title: "<img src=x onerror=alert(1)>"`, it executes JavaScript when the HTML file is opened.

**Fix:** Escape HTML entities before interpolation:
```typescript
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const chartTitle = escapeHtml(title || "CI-1T Stability Analysis");
```

**Risk:** The visualization HTML is written to disk and opened in browsers. An AI agent could be tricked into passing a crafted title that runs arbitrary JS in the user's browser context.

---

## Medium

### SEC-03: `toQ16` Ambiguity — Integer Value `1` Misclassified as Float
**Location:** `src/index.ts` L281–286  
**Issue:** `toQ16([0, 1, 0, 1])` treats all values as floats (since every value is 0–1), converting `1` → `65535`. But the user likely intended Q0.16 integers `[0, 1, 0, 1]` (nearly-zero CI scores). There is no way to distinguish `[0.5, 0.9]` (floats) from `[0, 1]` (integers that happen to be ≤1).

```typescript
const isFloat = scores.every((s) => s >= 0 && s <= 1);
```

**Fix:** Add a heuristic — if any value has decimal places, treat as float. Otherwise, treat values ≤1 as likely integers only if mixed with values >1:
```typescript
function toQ16(scores: number[]): number[] {
  const hasDecimals = scores.some((s) => s % 1 !== 0);
  const allInUnit = scores.every((s) => s >= 0 && s <= 1);
  const isFloat = hasDecimals && allInUnit;
  return isFloat
    ? scores.map((s) => Math.round(Math.max(0, Math.min(1, s)) * Q16))
    : scores.map((s) => Math.round(Math.max(0, Math.min(Q16, s))));
}
```

**Risk:** Silent data corruption — scores evaluated at wildly wrong scale, producing incorrect CI classifications.

---

### SEC-04: No Rate Limiting or Request Size Bounds on API Calls
**Location:** `src/index.ts` — `evaluate`, `fleet_evaluate`, `fleet_session_round` tools  
**Issue:** The `scores` parameter for `evaluate` has `.min(1)` but no `.max()`. A user could pass millions of scores, causing:
- Large memory allocation (array in memory + JSON serialization)
- Oversized HTTP request body to the API
- Potential credit drain (1 credit per episode)

**Fix:** Add `.max(10000)` to `scores` and `nodes` arrays:
```typescript
scores: z.array(z.number().min(0).max(65535)).min(1).max(10000)
```

**Risk:** Denial-of-service via memory exhaustion on the MCP server process, or accidental credit drain via large payloads.

---

### SEC-05: `sourceMap: true` in Production Build
**Location:** `tsconfig.json`  
**Issue:** Source maps are generated in the `dist/` folder and shipped in the Docker image. While `dist/` is gitignored, Docker images published to registries include `.js.map` files that reveal the full original TypeScript source.

**Fix:** Disable source maps for production or exclude from Docker:
```jsonc
// tsconfig.json
"sourceMap": false
```
Or add to Dockerfile:
```dockerfile
RUN rm -f dist/*.js.map
```

**Risk:** Information disclosure — full source code structure, variable names, and logic exposed in production deployments.

---

## Low

### SEC-06: Template Literal Bug in `compare_windows`
**Location:** `src/index.ts` L859  
**Issue:** Regular string `"..."` used instead of template literal `` `...` ``, so `${ciDelta}` is printed as literal text instead of the computed value.

```typescript
// CURRENT — bug: regular string, not template literal
if (ciDelta > 0.15) severityFactors.push("CI jumped significantly (+${(ciDelta * 100).toFixed(1)}%)");
```

**Fix:**
```typescript
if (ciDelta > 0.15) severityFactors.push(`CI jumped significantly (+${(ciDelta * 100).toFixed(1)}%)`);
```

**Risk:** Incorrect diagnostic output — agents receive literal `${...}` text instead of actual drift percentages, potentially misinterpreting severity.

---

### SEC-07: Visualization Files Accumulate in Temp Directory
**Location:** `src/index.ts` L1429–1433  
**Issue:** Each `visualize` call writes a new HTML file to `os.tmpdir()/ci1t-mcp/` with a unique timestamp filename. These files are never cleaned up. Over many calls, this grows unboundedly.

**Fix:** Clean up files older than 1 hour on each call, or limit total files:
```typescript
// Cleanup: remove files older than 1 hour
const ONE_HOUR = 60 * 60 * 1000;
const now = Date.now();
for (const f of fs.readdirSync(tmpDir)) {
  const fPath = path.join(tmpDir, f);
  const stat = fs.statSync(fPath);
  if (now - stat.mtimeMs > ONE_HOUR) fs.unlinkSync(fPath);
}
```

**Risk:** Disk space exhaustion on long-running MCP servers.

---

### SEC-08: Version Mismatch in Header Comment
**Location:** `src/index.ts` L3  
**Issue:** File header says `v1.5.0` but `McpServer` version is `1.6.0`.

```typescript
/**
 * CI-1T MCP Server v1.5.0   // ← stale
```

**Fix:** Update to `v1.6.0`.

**Risk:** Cosmetic only, but version confusion during debugging.

---

## Informational (No Action Required)

### INFO-01: npm audit — 0 vulnerabilities
All 3 dependencies (`@modelcontextprotocol/sdk`, `typescript`, `@types/node`) have no known CVEs.

### INFO-02: No hardcoded secrets
Scanned for `ci_[a-z0-9]{10,}` patterns — only placeholder `ci_your_key_here` found. Environment variable pattern is correct.

### INFO-03: `.gitignore` coverage is adequate
`.env`, `.vscode/mcp.json`, `node_modules/`, `dist/` all gitignored. Historical commits of `.vscode/mcp.json` contain only placeholder keys.

### INFO-04: Docker image is well-structured
Multi-stage build, `--ignore-scripts`, `--omit=dev`, `npm cache clean`. `node:22-alpine` is a minimal base. No `USER` directive (runs as root) but acceptable for stdio-only MCP servers with no network listener.

---

## Fix Priority

| ID | Severity | Effort | Recommendation |
|----|----------|--------|----------------|
| SEC-01 | Critical | 5 min | **Fix now** — replace `Math.random()` with `crypto.randomBytes()` |
| SEC-02 | High | 5 min | **Fix now** — add `escapeHtml()` for visualization title |
| SEC-03 | Medium | 5 min | **Fix now** — add decimal heuristic to `toQ16()` |
| SEC-04 | Medium | 2 min | **Fix now** — add `.max(10000)` to score arrays |
| SEC-05 | Medium | 1 min | **Fix now** — disable source maps or strip from Docker |
| SEC-06 | Low | 1 min | **Fix now** — change `"..."` to `` `...` `` |
| SEC-07 | Low | 5 min | **Fix soon** — add temp file cleanup |
| SEC-08 | Low | 1 min | **Fix now** — update header version |
