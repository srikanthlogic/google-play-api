# google-play-api v2 — Upstream Deficiencies & Atomic Issue Log

**Date:** 2026-08-16
**Scope:** Gap analysis of `facundoolano/google-play-scraper` (abandoned upstream), `@mradex77/google-play-scraper` v1.1.0 (active fork, our core dep), and the current `google-play-api` v1.6.0 surface. Each item is an atomic, issue-ready unit for the v2 milestone.

## Context

- Upstream `facundoolano/google-play-scraper`: **100+ open issues, unmaintained** (last meaningful fixes pre-2024). We already migrated off it (PR #97).
- `@mradex77/google-play-scraper` v1.1.0 (2026-07-31): TypeScript strict mode, zod runtime validation, typed errors, ESM+CJS, daily live contract tests in CI, 21★, actively maintained.
- Current API v1.6.0: 13 routes, Express 4, IP rate limiting only, no auth, no cache, Fly.io (`googleplayapi` prod / `gplayapidev` dev).
- Prior Rust v2 attempts exist locally (`Projects/google-play-api-v2` ~928 LOC, `Projects/google-play-rust` ~1508 LOC) — both incomplete skeletons, never built. Decision needed: revive vs. evolve Node.

---

## A. Upstream scraper deficiencies (why we can't go back; informs v2 hardening)

| # | Deficiency | Upstream evidence |
|---|-----------|-------------------|
| A1 | Search breaks repeatedly with no maintainer response | issues #553, #577, #734 (search only shows free apps) |
| A2 | `country`/`gl` param silently ignored in search | #729, #700 |
| A3 | Reviews: country not applied, sort+num combo returns wrong reviews, duplicate pages | #707, #594, #40, #456 |
| A4 | `list()` hard-capped at 200 results, no `start` offset | #450, #625, #403 |
| A5 | Crashes on undefined/null parse paths (`fantasy-land/map`, `.length`, `.map`) | #730, #701, #613 |
| A6 | 404s for apps that exist in browser (consent wall / bot detection) | #749, #735 |
| A7 | `VARY` version for App Bundle apps; no versionCode; no device-specific version | #727, #620, #595 |
| A8 | No signal when data-safety info is absent vs. scrape failure | #602, #106 (API repo) |
| A9 | ESM-only broke CommonJS consumers | #691, #723 |
| A10 | No breakage detection; mapping drift goes unnoticed | #550 (feature request, never built) |
| A11 | Throttling hangs on errors; no maxRetries | #520, #392 |
| A12 | No proxy support for IP rotation / geo-routing | #665 |
| A13 | Missing fields users want: release notes per version, game-vs-app flag, Windows installability, xapk detection | #538, #417, #639, #405 |

**v2 implication:** the mradex77 fork fixes A5/A8/A9/A10/A11/A12 and adds zod-validated outputs. v2 must still defend against A1–A4, A6, A7 at the API layer (see B/C).

## B. API-surface deficiencies (v1 vs. what the scraper now offers)

| # | Atomic issue | Type | Notes |
|---|-------------|------|-------|
| B1 | ✅ Fixed — `POST /apps/batch` | feature | Shipped: JSON body `{appIds: [...]}` (max 20, deduped), optional `concurrency` 1-20 and `?fields=` projection. Returns settled entries in request order; per-app failures are reported, not fatal. |
| B2 | ✅ Fixed — `GET /apps/:appId/availability?countries=` | feature | Shipped: comma-separated ISO-2 codes, max 30, maps scraper statuses to `{available, status, message?}`. |
| B3 | No streaming/bulk reviews export | feature | Scraper `reviewsAll` / `reviewsIterator`. Add `GET /api/apps/:appId/reviews/export` (NDJSON or CSV stream) as a premium-credit endpoint. |
| B4 | No search/developer iterators exposed | feature | Scraper `searchIterator`, `developerIterator` for >200 results. Add cursor-paginated `GET /api/apps/search/all`. |
| B5 | ✅ Fixed — `GET /suggest?q=` | refactor | Shipped: dedicated endpoint; legacy `/apps/?suggest=` still works and returns `Deprecation: true` + `Link` (rel=alternate) headers on /api. |
| B6 | List pagination emulated via fetch-and-slice | bug-perf | `start+num` fetched then sliced; wasteful. Use scraper iterators; document 200-cap honestly. |
| B7 | `fullDetail` on search causes errors | bug | Upstream API issue #107. Validate/limit interaction in v2. |
| B8 | ✅ Fixed — `?fields=` projection on app details | feature | Shipped as whitelist-validated projection (see lib/fields.js). Upstream API issue #22 ("take only a few fields"). |
| B9 | No app-history / change detection | feature | Upstream #388. Requires caching layer (D1) — v2.1 candidate. |
| B10 | OpenAPI spec generated from Postman, stale vs. Bruno | debt | Switch to hand-maintained OpenAPI 3.1 or zod→OpenAPI (scraper exports zod schemas — single source of truth). |
| B11 | No response schema validation at API boundary | hardening | Scraper validates its output; API should validate+serialize too, so Google-side drift returns 502 with diagnostics, not malformed JSON. |
| B12 | `cleanUrls` rewrites only some relative URLs | bug | Audit all link fields (reviews `url`, developer links, icon URLs). |
| B13 | No `lang`+`country` matrix docs / defaults inconsistent | docs | `COUNTRY_OF_QUERY=IN` env vs. `DEFAULT_COUNTRY='US'` constant conflict in code. |

## C. Reliability & anti-block deficiencies (SaaS-critical)

| # | Atomic issue | Type | Notes |
|---|-------------|------|-------|
| C1 | No response cache | feature | Same app details hammered by many users = fast Google block + wasted credits. Add TTL cache (in-mem LRU → Redis/Fly Replays/KV). Per-endpoint TTLs: app 15m, reviews 5m, lists 30m, categories 24h. |
| C2 | No request coalescing | feature | N concurrent requests for same appId should trigger 1 upstream fetch. Pairs with C1. |
| C3 | No proxy / egress IP rotation | feature | Scraper supports `requestOptions` proxy + per-country fetch. Fly single-IP egress will get blocked at SaaS scale. Design: optional proxy pool env config. |
| C4 | No circuit breaker / degradation mode | feature | On upstream failure storm, fail fast with cached-stale data (`X-Data-Stale: true`) instead of 502 storm. |
| C5 | No upstream health probe / drift alerting | feature | Scraper emits integrity/degradation events (`optional-section-parse`, `pagination-token-cycle`). Wire to metrics + Telegram alert. |
| C6 | Rate limit is per-IP only, global | hardening | Behind Fly proxy needs `trust proxy`; per-IP limit punishes serverless consumers sharing egress IPs. Superseded by per-key limits in D-tier. |
| C7 | No retry/backoff at API layer | hardening | Scraper has retries internally; API should add idempotent-request retry with jitter for `ETIMEDOUT` class errors (upstream #82). |
| C8 | No request timeout budget | hardening | Slow upstream can exhaust worker; set per-call timeout + 504 with `Retry-After`. |

## D. Auth / SaaS / credits deficiencies (the v2 core ask)

| # | Atomic issue | Type | Notes |
|---|-------------|------|-------|
| D1 | No authentication at all | feature | API-key auth: `Authorization: Bearer gpa_...` or `X-API-Key`. Anonymous tier optional (see Q3). |
| D2 | No user/org accounts | feature | Signup (email+password or OAuth), org/workspace model. Decide scope — see questions. |
| D3 | No API-key management | feature | Create/revoke/rotate keys, name, per-key scope (read-only), optional IP allowlist. |
| D4 | No credit ledger | feature | Atomic credit deduction per request with per-endpoint cost table (e.g., search=1, app=1, batch=N, reviews-export=5). Idempotent deduction, transactional with request success (don't charge for 5xx). |
| D5 | No credit pricing/cost model | product | Define cost table + free tier (e.g., 100 credits/day anon, 1k/month free account), paid packs. |
| D6 | No payments integration | feature | Stripe checkout for credit packs (one-time) and/or subscriptions. Webhook → ledger top-up. |
| D7 | No usage dashboard | feature | Per-key usage over time, remaining credits, cost by endpoint. Needs usage log store. |
| D8 | No quota/rate tiers | feature | Per-plan RPM limits (free 10 rpm, pro 120 rpm...) on top of credits. Redis or in-memory token bucket keyed by API key. |
| D9 | No usage/billing API | feature | `GET /v2/me/usage`, `GET /v2/me/credits` for programmatic access. |
| D10 | No webhooks/outbound events | feature | Optional: notify consumers on watched-app changes (depends on B9). v2.1 candidate. |
| D11 | No ToS/abuse controls | product | Scraping-resale ToS, abuse detection (credit-card testing, key sharing), key suspension flow. |
| D12 | No audit log | feature | Auth events, key creation, billing events — needed for dispute resolution. |

## E. Backend / data-layer deficiencies ("light backend")

| # | Atomic issue | Type | Notes |
|---|-------------|------|-------|
| E1 | No persistence layer | feature | Pick: SQLite (Turso/LiteFS on Fly) vs. Postgres (Neon/Supabase) vs. DuckDB. Users, keys, ledger, usage. Recommendation pending Q answers. |
| E2 | No cache store | feature | In-proc LRU for v2.0; optional Redis (Upstash) when multi-instance. Fly machines auto-stop complicates shared state — see Q5. |
| E3 | No background jobs | feature | Credit-pack expiry emails, usage rollups, cache warm for popular apps. Light scheduler (in-proc cron) first. |
| E4 | No structured usage logs | feature | Every request: key, endpoint, credits charged, latency, cache hit, upstream status → DB + Loki. |
| E5 | No admin surface | feature | Minimal admin API/UI: user lookup, credit adjust, key suspend, live upstream health. |
| E6 | No migrations story | debt | Add drizzle/kysely migrations from day one. |

## F. API design & DX deficiencies

| # | Atomic issue | Type | Notes |
|---|-------------|------|-------|
| F1 | No API versioning | design | v2 under `/v2/` prefix; v1 kept frozen with sunset header. |
| F2 | Error shape inconsistent | design | Standardize RFC 9457 problem+json: `{type,title,status,detail,code,retryAfter}`. Map scraper typed errors (NotFound/Parse/Network/RateLimit) → 404/502/503/429. |
| F3 | No ETag/conditional requests | feature | Cache-friendly; pairs with C1. Cheap win for consumers. |
| F4 | No pagination envelope standard | design | Standardize `{results, nextToken}` across search/list/developer/reviews (scraper already token-based for reviews). |
| F5 | No SDKs / code samples | dx | TypeScript SDK first (types derive from scraper zod schemas), then Python. |
| F6 | Docs are Swagger UI only | dx | Add landing page + guides + credit-pricing table (zo.space or in-app). |
| F7 | No changelog/deprecation policy | dx | SemVer the API; `Sunset`/`Deprecation` headers. |

## G. Ops, security & legal

| # | Atomic issue | Type | Notes |
|---|-------------|------|-------|
| G1 | npm audit debt (body-parser, lodash via newman, jose) | security | From TECHNICAL_DEBT.md — still open. Fix or drop newman (Bruno already replaced it). |
| G2 | CORS `origin: *` with no auth | security | Fine for public API; tighten for authenticated dashboard origins. |
| G3 | No secrets management for DB/Stripe keys | security | Fly secrets + document rotation. |
| G4 | No uptime/status page | ops | status.zo.space or BetterStack; upstream-health surfaced publicly. |
| G5 | Legal positioning | legal | Scraping ToS risk: Google Play ToS prohibits automated access; API resale amplifies it. Mitigations: rate limits, no APK/distribution content, only public metadata, ToS page. Document risk acceptance. |
| G6 | No license/commercialization note | legal | Repo is ISC; SaaS on top is fine. Add commercial terms page. |
| G7 | CI lacks live smoke against staging | ops | Add scheduled Bruno smoke on deployed staging + alert (live-store smoke test exists locally). |

## H. Test coverage & quality deficiencies

| # | Atomic issue | Type | Notes |
|---|-------------|------|-------|
| H1 | No unit tests for `lib/` or `server.js`; coverage not enforced | debt | Add node:test unit suite (mocked scraper) + c8 coverage in CI. Baseline: lib/index.js 97%, logger.js 70%, server.js 0% (untestable — calls `app.listen()` at import). Extract `createApp()` factory. Done: PR #171 (72 tests, 97.66% stmts), merged e0922ec. |
| H2 | Unknown routes return 500 instead of 404 | bug | Catchall sets `err.status = 404` but `getErrorStatusCode()` never reads `.status`; message `'Not Found'` fails the lowercase `'not found'` check. Verified live: `GET /definitely-not-a-route` → 500 problem+json. Fix: honor `err.status`/`err.statusCode` in `getErrorStatusCode`. PR #170. |

---

## Suggested v2 milestone slicing (draft, pending answers)---

## Suggested v2 milestone slicing (draft, pending answers)

- **M0 — Foundation (1 wk):** F1 versioning, F2 errors, B10 OpenAPI-from-zod, B11 validation, G1 audit fixes, B13 defaults.
- **M1 — New endpoints (1 wk):** B1 batch, B2 availability, B5 suggest, B8 fields, B6 iterator pagination, B3 reviews export.
- **M2 — Reliability (1 wk):** C1 cache, C2 coalescing, C4 breaker, C5 drift alerts, C7/C8 timeouts, F3 ETag.
- **M3 — Auth & credits (2 wk):** D1–D5, D8, D9, E1/E2/E4/E6, D7 dashboard.
- **M4 — Monetization (1 wk):** D6 Stripe, D11/D12, E5 admin, G4 status.
- **M5 — DX & growth:** F5 SDKs, F6 docs site, B9/D10 watch webhooks (v2.1).
