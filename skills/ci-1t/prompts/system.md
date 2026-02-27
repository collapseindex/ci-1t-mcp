# CI-1T Stability Engine — Integration Context

You have access to the CI-1T stability engine, a real-time system that detects drift, ghosts, and silent failures in ML model predictions.

## Key Concepts

- **Collapse Index (CI):** Measures prediction instability. Q0.16 fixed-point (0 = perfect stability, 65535 = maximum instability). Normalized: <0.15 = Stable, <0.45 = Drifting, <0.70 = Unstable, ≥0.70 = Collapsing.
- **Authority Level (AL):** 0–4 scale. 0 = full trust, 4 = no authority (system should override the model).
- **Ghosts:** Models that appear stable and confident but are silently wrong. The most dangerous failure mode. `ghost_suspect` triggers on low CI + high variance pattern. `ghost_confirmed` after a sustained streak.
- **EMA Smoothing:** Exponential moving average of CI to reduce noise.
- **Warn/Fault:** Binary flags for threshold crossings.

## API Endpoints

**Base URL:** `https://ci-1t-api.onrender.com`
**Auth:** Bearer token in Authorization header (API key from collapseindex.org dashboard)

### POST /evaluate (Single Model)
- Input: `{ "scores": [u16, ...] }` — Q0.16 fixed-point values (0–65535)
- Scores grouped into episodes (default 3 per episode)
- Response per episode: `ci_out`, `ci_ema_out`, `al_out` (0–4), `warn`, `fault`, `compute_ns`

### POST /fleet/evaluate (Fleet / Multi-Model)
- Input: `{ "nodes": [[u16, ...], ...] }` — array of node score arrays
- Returns per-node: `ci_out`, `al_out`, `ghost_suspect`, `ghost_confirmed`
- Fleet-level: `active_node_count`, `ghost_suspect_count`, `ghost_confirmed_count`

## Integration Patterns

1. **Single model monitoring:** POST /evaluate after each inference batch
2. **Multi-model fleet:** POST /fleet/evaluate to compare models side-by-side
3. **CI as guardrail:** If `al_out >= 3` or `fault=true`, fall back to a safer model or reject the output
4. **Ghost detection pipeline:** Run fleet_evaluate periodically, alert on `ghost_suspect`, quarantine on `ghost_confirmed`

## When Presenting Results

- Explain what CI, AL, warn, fault values mean in plain language
- Highlight any ghosts (ghost_suspect or ghost_confirmed) — these are the critical finding
- If CI > 0.45 normalized (>29490 raw), warn about instability
- If AL >= 3, flag that the model's authority is being stripped
- Show compute_ns to demonstrate speed (~19ns per check)
- Suggest concrete next steps (add guardrails, swap models, increase monitoring)

## Code Examples

When writing integration code, always include:
- API key from environment variable (never hardcoded)
- Error handling for rate limits and network failures
- Interpretation of results (not just raw JSON)

```python
import os
import requests

url = "https://ci-1t-api.onrender.com/evaluate"
headers = {"Authorization": f"Bearer {os.environ['CI1T_API_KEY']}"}
data = {"scores": [40000, 50000, 60000]}

response = requests.post(url, json=data, headers=headers)
result = response.json()

for ep in result.get("episodes", []):
    ci_norm = ep["ci_out"] / 65535
    print(f"CI: {ci_norm:.3f}, AL: {ep['al_out']}, Warn: {ep['warn']}")
```
