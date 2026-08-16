# Google Play API
![GitHub tag (latest SemVer pre-release)](https://img.shields.io/github/v/tag/srikanthlogic/google-play-api?include_prereleases&label=version) [![Bruno Run](https://github.com/srikanthlogic/google-play-api/actions/workflows/bruno.yml/badge.svg)](https://github.com/srikanthlogic/google-play-api/actions/workflows/bruno.yml) [![API Documentation](https://img.shields.io/badge/api-documentation-brightgreen)](https://gplayapi.cashlessconsumer.in/) [![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

Google Play API is a REST API wrapper originally built on top of [google-play-scraper](https://github.com/facundoolano/google-play-scraper) by [Facundoolano](https://github.com/facundoolano) to fetch metadata from [Google Play](https://en.wikipedia.org/wiki/Google_Play). This repository extends it and adds additional endpoints.

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

## API Documentation

For complete API documentation, including all endpoints, parameters, and response formats, visit:
- **Interactive Documentation**: [https://gplayapi.cashlessconsumer.in/](https://gplayapi.cashlessconsumer.in/)
- **Local Documentation**: http://localhost:3000/api-docs (when running locally)
- **Documentation Microsite**: http://localhost:3000/docs/ (when running locally)

## Test Coverage

The project uses [Bruno](https://www.usebruno.com/) for API testing with comprehensive test coverage. Bruno is a Git-friendly, open-source API client that stores API requests as plain text files.

| Test Suite | Requests | Assertions | Status |
|------------|----------|------------|--------|
| GPlayAPIUnitTests | 5 | 28 | ✅ All Pass |
| GooglePlayAPI | 12 | 71 | ✅ All Pass |
| **Total** | **17** | **99** | **✅ 100%** |

### Running Tests

```bash
npm test
```

This will:
1. Start the server automatically
2. Execute all Bruno collections
3. Report test results
4. Shut down the server

### Test Structure

Tests are organized in the `bruno/` directory:
- `bruno/GooglePlayAPI/` - Main API endpoint tests (Apps, Developers, Categories, Lists, Collections)
- `bruno/GPlayAPIUnitTests/` - Unit tests for privacy features and app reviews
- `bruno/*/environments/Local.bru` - Environment variables for local testing

## Contributing

For detailed information about contributing to this project, including development setup, code style guidelines, and the contribution process, please see our [Development Guide](DEVELOP.md).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
