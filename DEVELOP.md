# Google Play API - Development Guide

This document contains comprehensive information for developers who want to contribute to or deploy the Google Play API project.

## Table of Contents

- [Environment Setup](#environment-setup)
- [Local Development](#local-development)
- [API Configuration](#api-configuration)
  - [CORS Policy](#cors-policy)
  - [Rate Limiting](#rate-limiting)
- [Testing](#testing)
- [Code Style Guidelines](#code-style-guidelines)
- [Contribution Process](#contribution-process)
- [Deployment](#deployment)
- [Roadmap](#roadmap)

## Environment Setup

### Prerequisites

- Node.js 22 or higher
- npm (comes with Node.js)
- Git

### Dependency Details

The project relies on the following main dependencies:

- `express`: Web framework for Node.js
- `google-play-scraper`: Core library for scraping Google Play data
- `cors`: Middleware for enabling CORS
- `express-rate-limit`: Rate limiting middleware
- `morgan`: HTTP request logger
- `swagger-ui-express`: API documentation UI
- `postman-to-openapi`: Tool to convert Postman collections to OpenAPI

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

## Local Development

### Running the Server

To start the development server locally:

```bash
npm start
```

The server will start on port 3000 (or the port specified in the PORT environment variable).

### Environment Variables

Create a `.env` file based on `.env.sample` to configure the application:

```bash
cp .env.sample .env
```

Available environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port on which the server runs |
| `COUNTRY_OF_QUERY` | `IN` | Default country for Play Store queries |
| `LOGGING` | `true` | Enable/disable HTTP request logging |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Maximum requests per IP within the window |
| `RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS` | `false` | Skip counting successful requests |
| `RATE_LIMIT_SKIP_FAILED_REQUESTS` | `false` | Skip counting failed requests |

### API Documentation

Once the server is running, you can access the interactive API documentation at:
- http://localhost:3000/api-docs

## API Configuration

### CORS Policy

The Google Play API server is configured with CORS middleware (`cors` package) to enable cross-origin requests from **any origin** (`Access-Control-Allow-Origin: *`).

#### Key Configuration
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

### Rate Limiting

The API server implements IP-based rate limiting to prevent abuse. Powered by [express-rate-limit](https://www.npmjs.com/package/express-rate-limit).

#### Configuration

Customize via environment variables:

| Environment Variable | Default Value | Description |
|----------------------|---------------|-------------|
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 minutes) | Rate limit window in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Maximum number of requests allowed per IP within the window |
| `RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS` | `false` | If `true`, skips counting successful (2xx, 3xx) responses |
| `RATE_LIMIT_SKIP_FAILED_REQUESTS` | `false` | If `true`, skips counting failed (4xx, 5xx) responses |

#### Behavior

- Applies to **all API endpoints** (`/api/*`).
- Uses in-memory store (Redis upgradable later).
- Includes standard rate limiting headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- On limit exceed (**429 Too Many Requests**):
  - `Retry-After` header with seconds until reset.
  - JSON error: `{ "error": { "message": "Too many requests..." } }`

Fully compatible with the CORS configuration.

## Testing

The project uses Newman for API testing, which runs collections of Postman tests.

### Running Tests

To run the test suite:

```bash
npm test
```

This will execute two test collections:
1. `GooglePlayAPI.postman_collection.json` - Main API tests
2. `GPlayAPIUnitTests.postman_collection.json` - Unit tests

Test results are displayed in the console and generated as HTML reports.

### Test Collections

Test collections are located in the `PostmanCollections/` directory:
- `GooglePlayAPI.postman_collection.json` - Main API endpoint tests
- `GPlayAPIUnitTests.postman_collection.json` - Unit tests for specific functionality
- `postman_environment.json` - Environment variables for tests

## Code Style Guidelines

The project uses ESLint with the semistandard configuration for code style and linting.

### ESLint Configuration

The project extends the `semistandard` style guide with specific rules:
- ES6+ syntax is enabled
- Node.js environment is assumed
- Mocha testing environment is supported
- Unused variables are flagged

### Running Linting

To check code style:

```bash
npx eslint .
```

To automatically fix some linting issues:

```bash
npx eslint . --fix
```

## Contribution Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and ensure they follow the code style guidelines
4. Add tests for new functionality
5. Run the test suite: `npm test`
6. Commit your changes: `git commit -am 'Add some feature'`
7. Push to the branch: `git push origin feature-name`
8. Submit a pull request

## Deployment

### Docker Deployment

The project includes a Dockerfile for containerized deployment:

```bash
# Build the image
docker build -t google-play-api .

# Run the container
docker run -p 3000:3000 google-play-api
```

The Dockerfile uses a multi-stage build to optimize the final image size.

### Environment-Specific Deployments

The project includes configuration files for Fly.io deployments:
- `fly.production.toml` - Production environment configuration
- `fly.staging.toml` - Staging environment configuration

### Production Considerations

For production deployments:
1. Set appropriate environment variables
2. Consider using a reverse proxy (e.g., Nginx)
3. Implement proper logging and monitoring
4. Consider using Redis for rate limiting storage instead of in-memory storage

## Roadmap

* [ ] Expose more endpoints helping towards archiving
* [ ] Support Global options
* [X] Deta Support. [#34](https://github.com/srikanthlogic/google-play-api/issues/34)
* [X] Support Lists [#36](https://github.com/srikanthlogic/google-play-api/issues/36)
* [X] Support privacy friendly reviews extraction [#40](https://github.com/srikanthlogic/google-play-api/issues/40)

## Disclaimer

* Google Play data is bound by terms of Google. We believe - the data in the Play Store ecosystem, belong to people (Users) and hence must be available to them in form that will allow them to make best use of.