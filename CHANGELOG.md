# Changelog

## [1.6.0] - 2025-12-02

### Added
- Rate limiting middleware (`express-rate-limit@^7.4.1`) applied to all endpoints
  - Configurable via environment variables (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS`, `RATE_LIMIT_SKIP_FAILED_REQUESTS`)
  - Default: 100 requests per IP every 15 minutes (900000 ms)
  - Memory store (upgradable to Redis)
  - Standard headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
  - Custom 429 handler with `Retry-After` header and detailed JSON error message
- Environment variables added to `.env.sample`
- Comprehensive rate limiting documentation in `README.md`
- CORS middleware (`cors@^2.8.5`) with `origin: '*'` for public API access
- Proper preflight OPTIONS handling (`optionsSuccessStatus: 204`)
- Security headers middleware (X-Content-Type-Options, X-Frame-Options: DENY, etc.)
- Body parsers: `Express.json()` and `Express.urlencoded()` with 10MB limits
- Global 404 handler and error handler middleware

### Changed
- Updated `google-play-scraper` to `^10.1.2` (fixes 400 Bad Request errors from Google Play)
- Updated `express` to `^4.22.1`, `morgan` to `^1.10.1`, `eslint-plugin-import` to `^2.32.0`, `npm-check-updates` to `^17.1.18`
- Fixed JSON static imports in `server.js` and `test.js` for Node.js v22 compatibility using `fs.readFileSync`
- Updated test script flag removal
- Bumped project version to `1.6.0` (minor release: dependency updates and bug fixes)
- Updated Dockerfile label to `1.6.0`
- Removed duplicate `app.use` for static OpenAPI and Swagger UI routes
- Moved conditional `morgan` logging middleware earlier (after CORS/security)
- Updated `app.listen` callback to arrow function with template literal log

### Fixed
- Google Play API Response code 400 (Bad Request) errors by updating scraper
- Test suite execution failures due to ESM JSON import syntax

### Security
- Ran `npm audit fix` (reduced from 10 to 4 vulnerabilities in devDependencies)
- Remaining: newman-related (moderate/high); recommend `npm audit fix --force` if breaking changes acceptable

### Tests
- Executed full Postman test suite (GooglePlayAPI and GPlayAPIUnitTests)
- 83 requests, 99 assertions, 2 minor failures (datasafety for Wikipedia app)
- HTML reports generated via newman-reporter-htmlextra

### Build
- Docker image built successfully: `google-play-api:1.6.0`

### Notes
- Rate limiting positioned after CORS, before body parsers and security headers for seamless integration
- Compatible with existing error handling and middleware stack