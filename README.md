# Google Play API
![GitHub tag (latest SemVer pre-release)](https://img.shields.io/github/v/tag/srikanthlogic/google-play-api?include_prereleases&label=version) [![Newman Run](https://github.com/srikanthlogic/google-play-api/actions/workflows/newman.yml/badge.svg)](https://github.com/srikanthlogic/google-play-api/actions/workflows/newman.yml) [![API Documentation](https://img.shields.io/badge/api-documentation-brightgreen)](https://gplayapi.cashlessconsumer.in/)

Google Play API is a REST API wrapper originally built on top of [google-play-scraper](https://github.com/facundoolano/google-play-scraper) by [Facundoolano](https://github.com/facundoolano) to fetch metadata from [Google Play](https://en.wikipedia.org/wiki/Google_Play). This repository extends it and adds additional endpoints.

## API Server
The API Server is built on ExpressJS and includes self-contained API documentation.

### To Run Locally:
1. Clone the repository.
2. Run the following commands:
   ```bash
   npm install
   npm run generateoas # Generates the OpenAPI specification
   npm start
   ```

## CORS Policy

The Google Play API server is configured with CORS middleware (`cors` package) to enable cross-origin requests from **any origin** (`Access-Control-Allow-Origin: *`).

### Key Configuration
- **Methods**: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- **Allowed Headers**: Content-Type, Authorization, X-Requested-With, Accept
- **Preflight Handling**: OPTIONS requests return 204 with appropriate headers
- **Security Headers**:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: no-referrer`
  - `X-Powered-By` removed

This setup balances openness for public API use with basic security measures.
## Rate Limiting

The API server implements IP-based rate limiting to prevent abuse. Powered by [express-rate-limit](https://www.npmjs.com/package/express-rate-limit).

### Configuration

Customize via environment variables:

| Environment Variable | Default Value | Description |
|----------------------|---------------|-------------|
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 minutes) | Rate limit window in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Maximum number of requests allowed per IP within the window |
| `RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS` | `false` | If `true`, skips counting successful (2xx, 3xx) responses |
| `RATE_LIMIT_SKIP_FAILED_REQUESTS` | `false` | If `true`, skips counting failed (4xx, 5xx) responses |

### Behavior

- Applies to **all API endpoints** (`/api/*`).
- Uses in-memory store (Redis upgradable later).
- Includes standard rate limiting headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- On limit exceed (**429 Too Many Requests**):
  - `Retry-After` header with seconds until reset.
  - JSON error: `{ "error": { "message": "Too many requests..." } }`

Fully compatible with the CORS configuration.
### Roadmap
* [ ] Expose more endpoints helping towards archiving.
* [ ] Support Global options
* [X] Deta Support. [#34](https://github.com/srikanthlogic/google-play-api/issues/34)
* [X] Support Lists [#36](https://github.com/srikanthlogic/google-play-api/issues/36)
* [X] Support privacy friendly reviews extraction  [#40](https://github.com/srikanthlogic/google-play-api/issues/40)

## Disclaimer
* Google Play data is bound by terms of Google. We believe - the data in the Play Store ecosystem, belong to people (Users) and hence must be available to them in form that will allow them to make best use of.