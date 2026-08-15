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
- Node 22 (`.nvmrc`).

## Migration Notes (migrate/mradex77-scraper)

- `gplay.list()` no longer supports `start` offset; pagination is emulated by fetching `start + num` and slicing.
- `MAX_LIST_RESULTS = 200` reflects the scraper's hard cap.
- `gplay.dataSafety()` and `gplay.permissions()` are new endpoints available in the MrAdex77 fork.
- All upstream `facundoolano/google-play-scraper` imports replaced with `@mradex77/google-play-scraper`.
- Verified E2E on `gplayapidev.fly.dev`: search, app details, reviews, lists, developer, categories, collections all returning live data.
