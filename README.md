# Google Play API
![GitHub tag (latest SemVer pre-release)](https://img.shields.io/github/v/tag/srikanthlogic/google-play-api?include_prereleases&label=version) [![Bruno Run](https://github.com/srikanthlogic/google-play-api/actions/workflows/bruno.yml/badge.svg)](https://github.com/srikanthlogic/google-play-api/actions/workflows/bruno.yml) [![API Documentation](https://img.shields.io/badge/api-documentation-brightgreen)](https://gplayapi.cashlessconsumer.in/) [![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

Google Play API is a REST API wrapper originally built on top of [google-play-scraper](https://github.com/facundoolano/google-play-scraper) by [Facundoolano](https://github.com/facundoolano) to fetch metadata from [Google Play](https://en.wikipedia.org/wiki/Google_Play). This repository extends it and adds additional endpoints.

The API is served under two base paths:

- **`/v2/`** — the current API. Strict query-param validation, RFC 9457 `application/problem+json` errors, and responses validated against zod schemas before they are returned. **New integrations should use `/v2/`.**
- **`/api/`** — the legacy v1 surface, same endpoints with the historical response shapes. It is deprecated: responses carry `Deprecation` and `Sunset` headers (default sunset: August 2027, configurable via `V1_SUNSET`).

**Repository**: https://github.com/srikanthlogic/google-play-api

**Development**: For detailed information about contributing to this project, please see our [Development Guide](DEVELOP.md).

## Key Features

- **App Discovery**: Search for apps by name, get suggestions, and browse collections
- **App Details**: Access comprehensive app information including descriptions, ratings, and screenshots
- **Reviews & Ratings**: Fetch app reviews with privacy-friendly options and sorting capabilities
- **Developer Information**: Get all apps published by a specific developer
- **Categories & Collections**: Browse apps by category or collection (top free, trending, etc.)
- **Data Safety & Permissions**: Access app data safety information and required permissions
- **Similar Apps**: Discover apps similar to a specific application
- **v2 capabilities**: Cursor-based pagination, streaming reviews export (NDJSON/CSV), app history snapshots with field-level change detection, batch details, and a live upstream health endpoint
- **GraphQL**: the full v2 read surface at `POST /v2/graphql` with a built-in GraphiQL IDE, exact field selection, and error extensions mirroring the REST problem taxonomy
- **Contract-tested responses**: Every v2 response is validated against zod schemas; OpenAPI 3.1 spec is generated from those same schemas
- **RESTful API**: Clean, consistent REST endpoints with JSON responses
- **Interactive Documentation**: Built-in API documentation for easy exploration

## Quick Start

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/srikanthlogic/google-play-api.git
   cd google-play-api
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Generate OpenAPI specification:
   ```bash
   npm run generateoas
   ```

   This generates `openapi/swagger.json` (OpenAPI 3.1, derived from the zod response schemas and the live router) that powers `/api-docs` and `/openapi.json`.

4. Start the server:
   ```bash
   npm start
   ```

The server will start on port 3000. Interactive API documentation is at http://localhost:3000/api-docs and the static documentation microsite is at http://localhost:3000/docs/

## Usage Examples

### Search for Apps

```bash
# Search for apps
curl "http://localhost:3000/api/apps/?q=facebook"

# Get search suggestions
curl "http://localhost:3000/api/apps/?suggest=photo"
```

### Get App Details

```bash
# Get detailed information about an app
curl "http://localhost:3000/api/apps/com.facebook.katana"

# Get similar apps
curl "http://localhost:3000/api/apps/com.facebook.katana/similar"

# Sparse projection — only requested fields come back (400 on unknown field)
curl "http://localhost:3000/api/apps/com.facebook.katana?fields=title,score,installs"
```

### Reviews and Ratings

```bash
# Get app reviews (privacy-friendly by default)
curl "http://localhost:3000/api/apps/com.facebook.katana/reviews"

# Get reviews with user data and developer replies
curl "http://localhost:3000/api/apps/com.facebook.katana/reviews?userdata=true&replies=true"

# Get reviews sorted by helpfulness
curl "http://localhost:3000/api/apps/com.facebook.katana/reviews?sort=helpful"
```

### Developer and Category Information

```bash
# Get all apps by a developer
curl "http://localhost:3000/api/developers/Wikimedia%20Foundation"

# Get list of all categories
curl "http://localhost:3000/api/categories/"

# Get list of all collections
curl "http://localhost:3000/api/collections/"

# Get apps in a specific collection and category
curl "http://localhost:3000/api/lists/?collection=TOP_FREE&category=PRODUCTIVITY"
```

### Country Availability

```bash
# Check which storefronts carry an app (comma-separated ISO-2 codes, max 30)
curl "http://localhost:3000/api/apps/com.tencent.mm/availability?countries=IN,US,GB"
```

### Batch App Details

```bash
# Fetch details for up to 20 apps in one call (POST JSON body)
# Optional: concurrency (1-20), ?fields= for sparse responses, ?country=/?lang=
curl -X POST "http://localhost:3000/api/apps/batch" \
  -H "Content-Type: application/json" \
  -d '{"appIds": ["in.juspay.nammayatri", "com.duolingo"], "concurrency": 2}'
```

### Search Suggest

```bash
# Autocomplete suggestions for a search term (GET /suggest)
curl "http://localhost:3000/api/suggest?q=spot"

# Legacy form (still works, sends a Deprecation header on /api)
curl "http://localhost:3000/api/apps/?suggest=spot"
```

### Data Safety and Permissions

```bash
# Get app permissions
curl "http://localhost:3000/api/apps/com.facebook.katana/permissions"

# Get data safety information
curl "http://localhost:3000/api/apps/com.facebook.katana/datasafety"
```

The examples above use the legacy `/api/` base path; every endpoint is also available under `/v2/` (see below).

## v2 API

The `/v2/` base path serves the same endpoint inventory as `/api/`, with these differences:

- **Strict query params** — unknown query parameters return `400` instead of being ignored
- **RFC 9457 errors** — failures return `application/problem+json` with `type`, `title`, `status`, `detail` (v1 keeps the legacy `{ error, messages }` shape); upstream timeouts return `504` with a `Retry-After` header
- **Schema-validated responses** — responses are checked against zod schemas before being sent, so the contract is enforced at runtime
- **Deprecation-free** — no `Deprecation`/`Sunset` headers

Newer endpoints — served under both base paths, shown here on `/v2/` per the recommendation above:

### Cursor-Paginated Search and Developer Apps

```bash
# Search with cursor pagination (pageSize up to 100)
curl "http://localhost:3000/v2/apps/search?q=vpn&pageSize=20"
# → { "results": [...], "nextToken": "..." } — pass nextToken back as ?cursor= to fetch the next page
curl "http://localhost:3000/v2/apps/search?q=vpn&cursor=<nextToken>"

# Same iteration for a developer's catalogue
curl "http://localhost:3000/v2/developers/Wikimedia%20Foundation/apps?pageSize=20"
```

### Streaming Reviews Export

```bash
# Export reviews as NDJSON (default) or CSV, streamed while pages are fetched
curl "http://localhost:3000/v2/apps/com.facebook.katana/reviews/export?format=csv" -o reviews.csv
# Response carries an X-Export-Cap header with the maximum number of reviews returned
```

### App History and Change Detection

```bash
# Snapshot timeline of an app's listing metadata
curl "http://localhost:3000/v2/apps/com.facebook.katana/history"

# Field-level changes since a date
curl "http://localhost:3000/v2/apps/com.facebook.katana/changes?since=2026-01-01"
```

### Health

```bash
# Liveness probe (root-level, no base path)
curl "http://localhost:3000/healthz"

# Upstream health snapshot; add ?probe=true for a live upstream fetch
curl "http://localhost:3000/v2/health?probe=true"
```

### Search Suggest (v2 form)

```bash
curl "http://localhost:3000/v2/suggest?q=spot"
```

### GraphQL

The same v2 read surface is also available as GraphQL at `POST /v2/graphql` — one endpoint, exactly the fields you ask for, multiple resources in a single round trip. Opening it in a browser serves the built-in GraphiQL IDE.

```bash
curl -X POST "http://localhost:3000/v2/graphql" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ app(appId: \"com.instagram.android\") { title score installs developer { devId } } }"}'
```

- **Read parity with REST** — `app`, `apps` (batch as an `AppOk | AppError` union), `search`/`developerApps` (cursor pages via `nextToken`), `list`, `similar`, `reviews` (with the same `userdata`/`replies` privacy rules), `developer`, `suggest`, `dataSafety`, `permissions`, `availability`, `categories`, `collections`
- **Shared resilience** — resolvers go through the same cache → retry → timeout → circuit-breaker stack and zod contract validators as the REST endpoints
- **Error contract** — failures return `200` with an `errors` array whose entries carry `extensions.{httpStatus, code, type, retryAfter}` mirroring the REST problem taxonomy; malformed documents and over-deep queries return a real HTTP `400`
- **Depth limit** — queries are capped at 10 levels of nested selection (configurable via `GRAPHQL_MAX_DEPTH`)

See the [GraphQL documentation](http://localhost:3000/docs/graphql.html) for the full query inventory and examples.


## API Documentation

For complete API documentation, including all endpoints, parameters, and response formats, visit:
- **Interactive Documentation**: [https://gplayapi.cashlessconsumer.in/](https://gplayapi.cashlessconsumer.in/)
- **Local Documentation**: http://localhost:3000/api-docs (when running locally)
- **Documentation Microsite**: http://localhost:3000/docs/ (when running locally)

## Test Coverage

Testing happens at two levels:

1. **Unit tests** — `node:test` suites in `test/` covering the lib modules (schemas, retry, breaker, cache, iterators, history, error mapping, URL utils) with module mocks, no network needed.
2. **API tests** — [Bruno](https://www.usebruno.com/) collections that run against a live server. Bruno is a Git-friendly, open-source API client that stores API requests as plain text files.

| Bruno Suite | Requests | Assertions | Status |
|------------|----------|------------|--------|
| GPlayAPIUnitTests | 34 | 163 | ✅ All Pass |
| GooglePlayAPI | 12 | 70 | ✅ All Pass |
| **Total** | **46** | **233** | **✅ 100%** |

### Running Tests

```bash
npm test            # unit suite (pretest) + full E2E via Bruno
npm run test:unit   # unit suite only
npm run test:coverage
```

`npm test` will:
1. Run the unit test suite (`node --test`)
2. Start the server automatically
3. Execute all Bruno collections
4. Report test results
5. Shut down the server

`npm run test:coverage` produces c8 coverage for `lib/` and `server.js` across both the unit and Bruno suites.

### Test Structure

Tests are organized in two directories:
- `test/` — node:test unit suites for the lib modules
- `bruno/GooglePlayAPI/` - Main API endpoint tests (Apps, Developers, Categories, Lists, Collections)
- `bruno/GPlayAPIUnitTests/` - Unit tests for privacy features, app reviews, and every GraphQL query
- `bruno/*/environments/Local.bru` - Environment variables for local testing

## Contributing

For detailed information about contributing to this project, including development setup, code style guidelines, and the contribution process, please see our [Development Guide](DEVELOP.md).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
