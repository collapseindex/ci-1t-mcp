# CI-1T MCP Server — Ship Log

**Last Updated:** February 28, 2026  
**Version:** 1.7.1  
**Author:** Alex Kwon / Collapse Index Labs™

---

## Distribution Channels

| Channel | Status | URL | Notes |
|---------|--------|-----|-------|
| **npm** | ✅ Live | [npmjs.com/@collapseindex/ci1t-mcp](https://www.npmjs.com/package/@collapseindex/ci1t-mcp) | v1.7.1, scoped public package |
| **Docker Hub** | ✅ Live | [hub.docker.com/r/collapseindex/ci1t-mcp](https://hub.docker.com/r/collapseindex/ci1t-mcp) | 60.55 MB compressed, 121+ organic pulls |
| **GitHub** | ✅ Public | [github.com/collapseindex/ci-1t-mcp](https://github.com/collapseindex/ci-1t-mcp) | Release v1.7.0 published |
| **MCP Registry** | ✅ Live | [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io) → search "collapseindex" | `io.github.collapseindex/ci1t-mcp` v1.7.1 |
| **mcp.so** | ✅ Live | [mcp.so](https://mcp.so) | "CI-1T Prediction Stability Engine" by @Collapse Index Labs |
| **Glama.ai** | ✅ Live | [glama.ai/mcp/servers/@collapseindex/ci1t-mcp](https://glama.ai/mcp/servers/@collapseindex/ci1t-mcp) | Author verified, Docker inspection pending (their infra was down) |
| **Smithery** | ❌ Skipped | — | Requires HTTP/SSE transport. CI-1T is stdio only. Future work. |

---

## Version History

### v1.7.1 (Feb 28, 2026)
- Added `mcpName` field to `package.json` for MCP Registry verification
- Created `server.json` (MCP Registry metadata)
- Published to official MCP Registry at `registry.modelcontextprotocol.io`
- Committed: `a790c6c`

### v1.7.0 (Feb 27, 2026)
- **BYOM Probe** — Bring Your Own Model mode for `probe` tool
- Works with local models (Ollama, LM Studio, vLLM) and remote APIs
- BYOM mode runs locally: no CI-1T auth needed, no credits consumed
- Local similarity scoring: Jaccard, length ratio, character fingerprint cosine
- 20 tools + 1 resource
- Published to npm + Docker Hub
- GitHub Release v1.7.0 published

---

## Security & Docker Scout

| Severity | Count | Details |
|----------|-------|---------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 1 | busybox (Alpine base image, no patch available) |
| Low | 1 | zlib (Alpine base image, no patch available) |
| **App layer** | **0/0/0/0/0** | Clean |

**CVE remediation:** Went from 15 → 2. All fixable vulns patched via `apk upgrade`, `npm install -g npm@latest`, and minimatch pack/overwrite in Dockerfile.

---

## Files Created/Modified This Sprint

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modified | Added `mcpName`, bumped to v1.7.1 |
| `server.json` | Created | MCP Registry metadata (schema, env vars, transport) |
| `glama.json` | Created | Glama server claiming/metadata |
| `DOCKERHUB.md` | Created | Docker Hub-specific README (needs manual paste) |
| `README.md` | Modified | Added Glama badge |
| `Dockerfile` | Unchanged (prev sprint) | Two-stage build with CVE patches |

---

## TODO / Next Steps

- [ ] **Glama Docker inspection** — Retry. Their build infra was down (ECONNRESET). Config is correct: Node 22, npm build, mcp-proxy CMD.
- [ ] **Glama rename** — Once inspectable, rename from "ci1t-mcp" to "CI-1T Prediction Stability Engine"
- [ ] **Docker Hub description** — Paste `DOCKERHUB.md` content into Docker Hub Settings > Full description. Add short description + categories (Developer Tools, Machine Learning & AI).
- [ ] **mcp.so Overview tab** — Paste the no-em-dashes content draft if not done yet.
- [ ] **Smithery (optional)** — Would need HTTP/SSE transport added to MCP server (~1-2 hrs). MCP SDK supports both transports.
- [ ] **GitHub Release v1.7.1** — Create release for the registry version bump.
- [ ] **GitHub Actions CI** — Automate `mcp-publisher publish` on new releases (see registry docs for OIDC auth).

---

## Git State

- **Repo:** `collapseindex/ci-1t-mcp` (public)
- **Branch:** `master`
- **Latest commit:** `a790c6c` — "chore: add mcpName, server.json for MCP Registry (v1.7.1)"
- **Working tree:** Clean

---

## Infrastructure

```
CI-1T Stack
├── MCP Server (TypeScript)
│   ├── npm: @collapseindex/ci1t-mcp@1.7.1
│   ├── Docker: collapseindex/ci1t-mcp:1.7.0 + :latest
│   └── Transport: stdio
├── API Backend (Rust)
│   ├── Render: ci1t-api.onrender.com
│   └── Tier: Starter ($7/mo)
├── Website (Astro + PocketBase)
│   ├── Render: collapseindex.org
│   └── Tier: Starter ($7/mo)
└── Discovery
    ├── MCP Registry (official)
    ├── mcp.so
    ├── Glama.ai
    └── Docker Hub
```
