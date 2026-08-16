# AGENTS.md - Agentic Coding Guide for Google Play API

## Project Overview

REST API wrapper around the Google Play Store scraper. Express.js application using ES modules. Fork of `facundoolano/google-play-api`, maintained independently because upstream's core dependency (`facundoolano/google-play-scraper`) is abandoned.

**Core dependency:** `@mradex77/google-play-scraper` — actively maintained fork that fixes the scraper breakages flooding upstream with issues. All `gplay.*` calls go through this package.

## Branch Promotion Scheme

```
migrate/mradex77-scraper  →  dev  →  main
   (working branch)        (CI)    (production)
```

- **`migrate/mradex77-scraper`** — active working branch for the scraper migration. All new work lands here first.
- **`dev`** — integration branch. PRs from working branches target `dev`; CI (Bruno tests + deploy to staging) runs on push/PR.
- **`main`** — production. Only promoted from `dev` after CI is green. Deploys to Fly.io production.
- **`v2dev`** — v2 coordinating branch. Feature branches must merge here before v2 verification; it deploys to the separate `gplayapiv2` Fly.io app.

## Build/Lint/Test Commands

```bash
npm install          # install dependencies
npm start            # start server (port 3000)
npm run dev          # start with nodemon (auto-reload)
npm test             # full E2E: starts server, runs Bruno collections
npm run generateoas  # regenerate OpenAPI spec from Postman collection
npx eslint .         # lint
npx eslint . --fix   # lint + auto-fix
```

`npm test` spawns `server.js`, waits for readiness, then runs two Bruno collections:
1. `bruno/GPlayAPIUnitTests` (env: Local) — unit-level endpoint checks
2. `bruno/GooglePlayAPI` (env: Local) — full API collection

Husky pre-commit hook runs `lint-staged` (eslint --fix on staged `.js` files). The `prepare` script is Docker-safe (`husky || true`).

## Code Style

- **ESLint flat config** (`eslint.config.js`) — semistandard style, semicolons required
- 2-space indentation, single quotes, no trailing spaces
- ES modules only (`"type": "module"`); group imports: core → external → internal
- `'use strict'` at top of files
- `camelCase` for variables/functions, `UPPER_CASE` for true constants

### Route Pattern

```javascript
router.get('/endpoint', function (req, res, next) {
  const opts = Object.assign({ default: 'value' }, req.query);
  gplay.method(opts)
    .then((apps) => apps.map(cleanUrls(req)))
    .then(toList)
    .then(res.json.bind(res))
    .catch(next);
});
```

### Error Handling

- Express error middleware: `(err, req, res, next) => {...}`
- 404 for "App not found", 400 for other bad requests
- Custom error classes in `lib/errors.js`

## Project Structure

```
├── server.js              # Express app entry (CORS, rate limiting, morgan, swagger)
├── lib/
│   ├── index.js           # API route handlers (all gplay.* calls)
│   ├── constants.js       # Pagination limits, MAX_LIST_RESULTS, sort values
│   ├── errors.js          # Custom error classes
│   ├── logger.js          # Pino logger
│   └── urlUtils.js        # buildUrl(), cleanUrls() helpers
├── test.js                # E2E runner: spawns server + Bruno collections
├── bruno/                 # Bruno API collections (GPlayAPIUnitTests, GooglePlayAPI)
├── PostmanCollections/    # Legacy Postman collection (source for OAS generation)
├── openapi/               # Generated OpenAPI/Swagger specs
├── fly.toml               # Fly.io config (dev instance: gplayapidev)
├── fly.production.toml    # Fly.io production config (used by CI on main)
├── fly.staging.toml       # Fly.io staging config (used by CI on dev)
├── fly.v2dev.toml         # Fly.io v2 verification config (gplayapiv2)
├── Dockerfile             # Container build
└── TECHNICAL_DEBT.md      # Debt assessment + remediation plan
```

## Key Dependencies

| Package | Role |
|---------|------|
| `@mradex77/google-play-scraper` | Core scraping library (replaces abandoned `google-play-scraper`) |
| `express` | Web framework |
| `express-rate-limit` | Rate limiting (scoped to `/api/` routes) |
| `express-validator` | Request validation |
| `pino` | Structured logging |
| `swagger-ui-express` | API docs at `/api-docs` |
| `@usebruno/cli` | E2E test runner (dev) |
| `husky` + `lint-staged` | Pre-commit linting (dev) |

## API Conventions

- Base path: `/api/`
- JSON responses only; list endpoints wrapped via `toList()` → `{ results: [...] }`
- `cleanUrls(req)` rewrites relative URLs to absolute API paths
- `country` query param for localization (default: `IN` via `COUNTRY_OF_QUERY`)
- List pagination capped at `MAX_LIST_RESULTS` (200) — scraper has no `start` offset
- Rate limit defaults: 100 requests per 15-minute window (env-configurable)

## Environment Configuration

Copy `.env.sample` to `.env`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3000 | Server port |
| `COUNTRY_OF_QUERY` | IN | Default country for queries |
| `LOGGING` | true | Enable HTTP logging |
| `RATE_LIMIT_WINDOW_MS` | 900000 | Rate limit window (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | 100 | Max requests per window |

## Deployment (Fly.io)

- **Dev instance:** `gplayapidev` — deployed manually from working branches for E2E validation. Free tier: 256 MB shared CPU, `sin` region, auto-stop/start.
- **CI pipeline** (`.github/workflows/deploy.yml`): on push to `dev` → staging deploy; on push to `main` → production deploy. Uses `fly.staging.toml` / `fly.production.toml` respectively.
- **v2 verification pipeline** (`.github/workflows/deploy-v2dev.yml`): on push to `v2dev` → GHCR image + `gplayapiv2` deploy. This instance sets `RATE_LIMIT_DISABLED=true` for endpoint verification only.
- Node 22 (`.nvmrc`).

## Verification Mandates (v2)

Every change to `v2dev` MUST pass this verification loop before merge. No exceptions.

### Pre-merge gate (local + CI)

1. **Lint clean:** `npx eslint .` exits 0. No warnings tolerated in changed files.
2. **Dependency audit:** `npm audit --omit=dev --audit-level=high` exits 0. New high/critical vulns block merge.
3. **Unit + API suite:** `npm test` exits 0. This runs the full Bruno E2E (unit collection + full API collection) plus the v2 contract tests.
4. **OpenAPI generation:** `npm run generateoas` exits 0 and produces a valid spec. The generated `openapi/swagger.json` must be committed if it changes.
5. **Schema validation:** Every new/changed endpoint must have a zod response schema in `lib/schemas/` and a contract test asserting the schema holds against live scraper output.

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
| `GET /v2/apps/<known-app>?country=US&lang=en` | 200, v2 envelope with `data` key |
| Error contract | 4xx returns `application/problem+json` with `type`, `title`, `status`, `detail` |
| v1 compat | `/api/` endpoints still return legacy shape |

### Quality bar

- **No silent skips.** If a test is flaky due to upstream scraper instability, mark it explicitly with a comment and a tracking issue — never delete or `skip` without an issue link.
- **Atomic issues.** Each PR addresses exactly one issue number. The PR title must contain the issue number (e.g. `B10: OpenAPI 3.1 from zod schemas (#112)`).
- **Issue hygiene.** Close the issue only after the deploy is verified live. Reference the run ID and the live URL in the closing comment.
- **Docs ship with code.** Any new env var, endpoint, or behavior change must update `/docs` microsite content in the same PR.

## Migration Notes (migrate/mradex77-scraper)

- `gplay.list()` no longer supports `start` offset; pagination is emulated by fetching `start + num` and slicing.
- `MAX_LIST_RESULTS = 200` reflects the scraper's hard cap.
- `gplay.dataSafety()` and `gplay.permissions()` are new endpoints available in the MrAdex77 fork.
- All upstream `facundoolano/google-play-scraper` imports replaced with `@mradex77/google-play-scraper`.
- Verified E2E on `gplayapidev.fly.dev`: search, app details, reviews, lists, developer, categories, collections all returning live data.
