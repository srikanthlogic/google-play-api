# AGENTS.md - Agentic Coding Guide for Google Play API

## Project Overview

REST API wrapper around the Google Play Store scraper. Express.js application using ES modules. Fork of `facundoolano/google-play-api`, maintained independently because upstream's core dependency (`facundoolano/google-play-scraper`) is abandoned.

**Core dependency:** `@mradex77/google-play-scraper` — actively maintained fork that fixes the scraper breakages flooding upstream with issues. All `gplay.*` calls go through this package.

## Branch Promotion Scheme

```
v2/<feature>  →  v2dev  →  dev  →  main
 (working)     (v2 verify) (CI)    (production)
```

- **`v2/<feature>`** — short-lived feature branches (e.g. `v2/b10-oas31-zod`). All new work lands here first; PRs target `v2dev`.
- **`v2dev`** — v2 coordinating branch. Feature branches must merge here before v2 verification; it deploys to the separate `gplayapiv2` Fly.io app where the post-deploy verification loop runs. Promotion from `v2dev` → `dev` happens after live verification is green.
- **`dev`** — integration branch. CI (Bruno tests + deploy to staging) runs on push/PR.
- **`main`** — production. Only promoted from `dev` after CI is green. Deploys to Fly.io production.
- `migrate/mradex77-scraper` is historical — the scraper migration was promoted to `main` (#104) and the branch is gone.

## Build/Lint/Test Commands

```bash
npm install              # install dependencies
npm start                # start server (port 3000)
npm run dev              # start with nodemon (auto-reload)
npm test                 # unit suite (pretest) + full E2E: starts server, runs Bruno collections
npm run test:unit        # unit suite only (node --test, module-mocked, no network)
npm run test:coverage    # c8 coverage across unit + Bruno suites
npm run generateoas      # regenerate OpenAPI 3.1 spec from zod schemas + live router
npx eslint .             # lint
npx eslint . --fix       # lint + auto-fix
```

`npm test` runs `test:unit` first (172 node:test cases across `test/*.test.js`), then spawns `server.js`, waits for readiness, and runs two Bruno collections:
1. `bruno/GPlayAPIUnitTests` (env: Local) — unit-level endpoint checks
2. `bruno/GooglePlayAPI` (env: Local) — full API collection

`npm run generateoas` introspects the live Express router and derives response schemas from `lib/schemas.js` via `zod.toJSONSchema()` — the spec cannot drift from registered endpoints. Output is `openapi/swagger.json` (gitignored; regenerated locally and in CI).

Husky pre-commit hook runs `lint-staged` (eslint --fix on staged `.js` files). The `prepare` script is Docker-safe (`husky || true`).

## Code Style

- **ESLint flat config** (`eslint.config.js`) — semistandard style, semicolons required
- 2-space indentation, single quotes, no trailing spaces
- ES modules only (`"type": "module"`); group imports: core → external → internal
- `'use strict'` at top of files
- `camelCase` for variables/functions, `UPPER_CASE` for true constants

### Route Pattern

Routes serve both `/api/` and `/v2/` (the same router is mounted at both). Build scraper opts from an explicit whitelist — never spread raw `req.query` (HTTP query values are strings; the scraper's zod schemas declare booleans/numbers, and wrong types 500 once retries are exhausted).

```javascript
router.get('/endpoint',
  handleValidationErrors,           // express-validator chain above
  function (req, res, next) {
    if (!rejectUnknownQueryParams(req, res, ['country', 'lang'])) return; // 400 problem+json on /v2
    const opts = Object.assign(whitelistedQuery(req, ['country', 'lang']), {
      term: req.query.q
    });
    gplay.method(opts)
      .then((apps) => apps.map(cleanUrls(req)))
      .then(toList)                                   // → { results: [...] }
      .then(d => validateAppList(d, '/endpoint'))     // zod contract check (v2)
      .then(res.json.bind(res))
      .catch(next);
  });
```

On the `/v2` base path (`req.baseUrl === '/v2'`), responses are validated against zod schemas (`lib/schemas.js`) before being sent, and the newer endpoints return richer bodies (e.g. cursor `nextToken` pages).

### Error Handling

- Express error middleware in `server.js` maps every error to RFC 9457 `application/problem+json` (`type`, `title`, `status`, `detail`, optional `retryAfter`)
- 404 for "App not found", 400 for validation/unknown params, 504 for upstream timeout (with `Retry-After`)
- Custom error classes in `lib/errors.js` (`AppError`, `getErrorStatusCode`, `problemDetails`)
- On `/api/` (v1), validation errors keep the legacy `{ error, messages }` shape for compatibility

## Project Structure

```
├── server.js              # Express app entry (CORS, rate limiting, /healthz, /api/ + /v2/ mounts, problem+json errors, graceful shutdown)
├── lib/
│   ├── index.js           # API route handlers (all gplay.* calls; mounted at /api/ and /v2/)
│   ├── constants.js       # Limits, MAX_LIST_RESULTS, sort values, DEFAULT_COUNTRY/LANG
│   ├── schemas.js         # zod response schemas (runtime validation + OpenAPI 3.1 source)
│   ├── fields.js          # Sparse ?fields= projection
│   ├── iterators.js       # Cursor-paginated search/developer iteration (nextToken)
│   ├── history.js         # App listing snapshots + field-level change detection (.data/)
│   ├── exportStream.js    # Streaming reviews export (NDJSON/CSV)
│   ├── gplayClient.js     # Resilience-wrapped gplay proxy (cache/retry/timeout/breaker); shared by REST + GraphQL
│   ├── reviewUtils.js     # Review privacy post-processing (userdata/replies rules)
│   ├── graphql/           # GraphQL surface: schema.js (SDL+resolvers), errors.js, depthLimit.js, ide.js, index.js (endpoint)
│   ├── cache.js           # Response caching
│   ├── retry.js           # Upstream retry with backoff
│   ├── breaker.js         # Circuit breaker around upstream calls
│   ├── resilience.js      # Retry + breaker composition (504 + Retry-After on timeout)
│   ├── egress.js          # Upstream egress/proxy handling
│   ├── health.js          # buildHealthReport() for GET /v2/health
│   ├── errors.js          # AppError, getErrorStatusCode(), problemDetails() (RFC 9457)
│   ├── logger.js          # Pino logger
│   └── urlUtils.js        # buildUrl(), cleanUrls() helpers
├── test.js                # E2E runner: spawns server + Bruno collections
├── test/                  # node:test unit suites (one per lib module, module mocks)
├── scripts/               # generate-oas.mjs, smoke.js, ci-summary.js
├── bruno/                 # Bruno API collections (GPlayAPIUnitTests, GooglePlayAPI)
├── docs/                  # Static documentation microsite served at /docs/
├── v2-plan/               # v2 planning docs (DEFICIENCIES.md, ...)
├── PostmanCollections/    # Legacy Postman collection (superseded by scripts/generate-oas.mjs)
├── openapi/               # Generated OpenAPI 3.1 spec (gitignored, regenerated in CI)
├── fly.toml               # Fly.io config (dev instance: gplayapidev)
├── fly.production.toml    # Fly.io production config (used by CI on main)
├── fly.staging.toml       # Fly.io staging config (used by CI on dev)
├── fly.v2dev.toml         # Fly.io v2 verification config (gplayapiv2)
├── Dockerfile             # Container build
├── CHANGELOG.md           # Release notes
└── TECHNICAL_DEBT.md      # Debt assessment + remediation plan
```

## Key Dependencies

| Package | Role |
|---------|------|
| `@mradex77/google-play-scraper` | Core scraping library (replaces abandoned `google-play-scraper`) |
| `express` | Web framework |
| `zod` | Response schemas (runtime validation on /v2) + OpenAPI 3.1 generation |
| `graphql` + `graphql-http` + `@graphql-tools/schema` | GraphQL endpoint at `/v2/graphql` (schema, spec-compliant HTTP handler, SDL assembly) |
| `express-rate-limit` | Rate limiting (scoped to `/api/` routes and `POST /v2/graphql`) |
| `express-validator` | Request validation |
| `pino` | Structured logging |
| `swagger-ui-express` | API docs at `/api-docs` |
| `c8` | Coverage (dev) |
| `@usebruno/cli` | E2E test runner (dev) |
| `husky` + `lint-staged` | Pre-commit linting (dev) |

## API Conventions

- Base paths: `/api/` (v1, deprecated) and `/v2/` — the same router is mounted at both; `req.baseUrl` decides response shape
- JSON responses only; list endpoints wrapped via `toList()` → `{ results: [...] }`
- v2 adds: strict query-param whitelist (400 on unknown), zod-validated responses, RFC 9457 problem+json errors, cursor pagination (`?pageSize=` + `?cursor=` returning `nextToken`)
- `cleanUrls(req)` rewrites relative URLs to absolute API paths (base path aware)
- `country`/`lang` query params for localization (defaults: `COUNTRY_OF_QUERY`/`LANG_OF_QUERY`, built-in fallback `US`/`en`)
- List pagination capped at `MAX_LIST_RESULTS` (200) — scraper has no `start` offset; `/api/apps/?start=` emulates via fetch-and-slice
- Sparse projection via `?fields=` (400 on unknown field)
- `/api/` responses carry `Deprecation: true` + `Sunset` headers (`V1_SUNSET`, default Aug 2027)
- Rate limit defaults: 100 requests per 15-minute window (env-configurable, `/api/` routes and `/v2/graphql`)

## Environment Configuration

Copy `.env.sample` to `.env`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3000 | Server port |
| `COUNTRY_OF_QUERY` | IN (sample) / US (built-in) | Default country for queries |
| `LANG_OF_QUERY` | en | Default language for queries (BCP-47) |
| `LOGGING` | true | Enable HTTP logging |
| `RATE_LIMIT_WINDOW_MS` | 900000 | Rate limit window (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | 100 | Max requests per window |
| `RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS` | false | Only count failed requests against the limit |
| `RATE_LIMIT_SKIP_FAILED_REQUESTS` | false | Only count successful requests against the limit |
| `RATE_LIMIT_DISABLED` | unset | `true` disables rate limiting (gplayapiv2 verification instance only) |
| `V1_SUNSET` | Sat, 16 Aug 2027 00:00:00 GMT | `Sunset` header on /api/ responses |
| `UPSTREAM_TIMEOUT_MS` | 15000 | Per-call timeout budget for scraper calls |
| `UPSTREAM_TIMEOUT_RETRY_AFTER` | 5 | Seconds advertised in `Retry-After` on 504 |
| `GRAPHQL_MAX_DEPTH` | 10 | Max nested field selection depth for `/v2/graphql` queries (over-deep → HTTP 400) |

## Deployment (Fly.io)

- **Dev instance:** `gplayapidev` — deployed manually from working branches for E2E validation. Free tier: 256 MB shared CPU, `sin` region, auto-stop/start.
- **CI pipeline** (`.github/workflows/deploy.yml`): on push to `dev` → staging deploy; on push to `main` → production deploy. Uses `fly.staging.toml` / `fly.production.toml` respectively. PRs to `dev` run build + tests only — the Docker image and Fly deploy steps are gated to push/`workflow_dispatch` events, so staging never receives an unreviewed PR merge snapshot.
- **v2 verification pipeline** (`.github/workflows/deploy-v2dev.yml`): on push to `v2dev` → GHCR image + `gplayapiv2` deploy. This instance sets `RATE_LIMIT_DISABLED=true` for endpoint verification only.
- Node 22 (`.nvmrc`).

## Verification Mandates (v2)

Every change to `v2dev` MUST pass this verification loop before merge. No exceptions.

### Pre-merge gate (local + CI)

1. **Lint clean:** `npx eslint .` exits 0. No warnings tolerated in changed files.
2. **Dependency audit:** `npm audit --omit=dev --audit-level=high` exits 0. New high/critical vulns block merge.
3. **Unit + API suite:** `npm test` exits 0. This runs the full Bruno E2E (unit collection + full API collection) plus the v2 contract tests.
4. **OpenAPI generation:** `npm run generateoas` exits 0 and produces a valid spec. `openapi/swagger.json` is gitignored and regenerated locally/CI — never commit it.
5. **Schema validation:** Every new/changed endpoint must have a zod response schema in `lib/schemas.js` and a contract test asserting the schema holds against live scraper output.

### CI pipeline (`.github/workflows/deploy-v2dev.yml`)

- **`validate` job** runs on every PR to `v2dev`: lint → audit → generateoas → full test suite → JUnit report → GH Actions step summary. Merge is blocked until `validate` is green.
- **`deploy` job** runs only on push to `v2dev` after `validate` passes: builds GHCR image → deploys to `gplayapiv2` Fly app → post-deploy smoke checks (`/healthz`, `/docs/`, one v2 endpoint).
- **Test reporting:** JUnit XML is emitted and parsed into the step summary. Failures must show the failing assertion, not just a red X.
- **Caching:** npm dependencies are cached by `package-lock.json` hash. Cache misses must be investigated, not silently accepted.

### Post-deploy verification (live)

After every `v2dev` deploy, verify against `https://gplayapiv2.fly.dev`:

| Check | Expected |
|-------|----------|
| `GET /healthz` | 200, `{"status":"ok"}` |
| `GET /docs/` | 200, HTML microsite |
| `GET /v2/apps/<known-app>?country=US&lang=en` | 200, app object validated against `AppSchema` (single resources return bare objects — no envelope; list endpoints use `{ results: [...] }`) |
| Error contract | 4xx returns `application/problem+json` with `type`, `title`, `status`, `detail` |
| v1 compat | `/api/` endpoints still return legacy shape |

### Quality bar

- **No silent skips.** If a test is flaky due to upstream scraper instability, mark it explicitly with a comment and a tracking issue — never delete or `skip` without an issue link.
- **Atomic issues.** Each PR addresses exactly one issue number. The PR title must contain the issue number (e.g. `B10: OpenAPI 3.1 from zod schemas (#112)`).
- **Issue hygiene.** Close the issue only after the deploy is verified live. Reference the run ID and the live URL in the closing comment.
- **Docs ship with code.** Any new env var, endpoint, or behavior change must update `/docs` microsite content in the same PR.

## Migration Notes (migrate/mradex77-scraper — completed, promoted to main #104)

- `gplay.list()` no longer supports `start` offset; pagination is emulated by fetching `start + num` and slicing.
- `MAX_LIST_RESULTS = 200` reflects the scraper's hard cap.
- `gplay.dataSafety()` and `gplay.permissions()` are endpoints available in the MrAdex77 fork.
- All upstream `facundoolano/google-play-scraper` imports replaced with `@mradex77/google-play-scraper`.

## v2 Notes (v2dev)

- Single router (`lib/index.js`) mounted at both `/api/` and `/v2/`; v2 behavior keys off `req.baseUrl === '/v2'`.
- Newer endpoints (shared router, served under both base paths): `GET /suggest`, `GET /apps/search` + `GET /developers/:devId/apps` (cursor iteration), `GET /apps/:appId/reviews/export` (NDJSON/CSV stream), `GET /apps/:appId/history` + `/changes` (snapshots in `.data/`), `GET /health` (upstream report; `?probe=true` for live fetch), `POST /apps/batch`, `GET /apps/:appId/availability`.
- Every `/api/` response carries `Deprecation: true` + `Sunset` headers (server.js); the legacy `?suggest=` form additionally sends a `Link` alternate pointing at `GET /suggest` (RFC 9745).
- Unknown query params: ignored on `/api/`, 400 problem+json on `/v2/` (H4 whitelist).
- Upstream calls go through retry + circuit breaker (`lib/gplayClient.js` wrapping `lib/resilience.js`); exhaustion surfaces as 504 + `Retry-After`.
- `POST /v2/graphql` (browsers GET the GraphiQL IDE there) exposes the v2 read surface as GraphQL. Resolvers reuse the same `gplay` proxy + zod validators as REST; errors carry `extensions.{httpStatus, code, type}` mirroring the problem taxonomy; depth-limited via `GRAPHQL_MAX_DEPTH`. Mounted in `server.js` **before** the shared router — never add it to `lib/index.js` or `npm run generateoas` fails CI on the metadata-less route.
- Verified live on `gplayapiv2.fly.dev` (see `OPS-AGENT-PLAN.md` for the verification schedule).
