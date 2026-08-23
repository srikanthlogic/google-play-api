# Decision Memo: Egress Proxy Strategy (C3)

**Status:** Measured-first (instrumentation shipped, proxies optional)
**Issue:** #162
**Date:** 2026-08-23

## Context

At SaaS volume, a single Fly.io egress IP will get throttled or blocked by
Google. Buying proxy infrastructure before measuring the actual block rate
would be premature spend; shipping without any plan would be negligence.

## What shipped in C3

1. **Block-class classification** (`lib/egress.js`): upstream failures that
   look like IP blocks — HTTP 403/429, or "unusual traffic / captcha /
   automated queries" interstitial text — are counted per endpoint.
2. **Block-rate metrics on `/v2/health`**: `egress.attempts`,
   `egress.blocked`, `egress.blockRate`, and the top 5 blocked endpoints.
3. **Optional proxy pool**: set `EGRESS_PROXY_URLS` (comma-separated HTTP(S)
   proxy URLs) and every scraper call is routed through an undici
   `ProxyAgent` round-robin, injected as the scraper's
   `requestOptions.fetchImpl`. No code change needed to enable or disable.

## Decision rule

| Condition | Action |
|-----------|--------|
| `blockRate < 0.01` (< 1%) | No proxies. Revisit at next traffic doubling. |
| `0.01 ≤ blockRate < 0.05` | Watch weekly; consider per-country egress split. |
| `blockRate ≥ 0.05` for 3 consecutive days, OR any single endpoint > 10% | Enable `EGRESS_PROXY_URLS` with ≥ 5 residential/mobile exits. |

Rationale: below 1% the retries + breaker already absorb blocks invisibly;
above 5% the latency cost of retry storms starts degrading p95s even when
requests eventually succeed.

## Measurement plan

- `/v2/health?probe=true` is scraped by the status agent (E4/G4) once usage
  logging exists; until then check manually during load tests.
- Record block rate before/after enabling proxies to validate the pool.

## Explicitly deferred

- Per-country egress routing (needs traffic pattern data first).
- Multiple Fly regions (only helps if Google blocks by IP prefix, unproven).
- Paid proxy vendor selection (do not buy until threshold trips).
