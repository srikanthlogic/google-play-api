# AGENTS.md - Agentic Coding Guide for Google Play API

## Project Overview
REST API wrapper around google-play-scraper for fetching Google Play Store data. Express.js application using ES modules.

## Build/Lint/Test Commands

```bash
# Install dependencies
npm install

# Start development server (port 3000)
npm start

# Run all tests (Newman Postman collections)
npm test

# Generate OpenAPI spec from Postman collections
npm run generateoas

# Lint code (semistandard style)
npx eslint .

# Auto-fix linting issues
npx eslint . --fix
```

**Note**: No single test runner available. Tests use Newman with Postman collections in `PostmanCollections/`.

## Code Style Guidelines

### ESLint Configuration
- **Extends**: `semistandard` (semicolons required)
- **Environment**: ES6, Node.js, Mocha
- **Key Rule**: `no-unused-vars` flags all unused variables

### Formatting
- Use semicolons at end of statements
- 2-space indentation
- Single quotes for strings
- No trailing spaces

### Naming Conventions
- Variables/functions: `camelCase`
- Constants: `UPPER_CASE` for true constants
- Files: `kebab-case.js` (e.g., `index.js`)

### Imports/Modules
- ES modules only (`"type": "module"` in package.json)
- Use single quotes: `import Express from 'express'`
- Group imports: core modules → external → internal

### Error Handling
- Use Express error middleware: `(err, req, res, next) => {...}`
- Pass errors with `next(err)`
- 404 for "App not found", 400 for other bad requests
- Include error message in JSON response

### Code Patterns
- Use `'use strict'` at top of files
- Prefer `const` and `let` over `var`
- Use arrow functions: `(req, res, next) => {...}`
- Promise chains: `.then().catch(next)` pattern
- Destructuring: `const { param1, param2 } = req.query`

### Route Patterns
```javascript
router.get('/endpoint', function (req, res, next) {
  const opts = Object.assign({ default: 'value' }, req.query);
  gplay.method(opts)
    .then(transformData)
    .then(toList)
    .then(res.json.bind(res))
    .catch(next);
});
```

## Environment Configuration
Copy `.env.sample` to `.env`:
- `PORT`: Server port (default: 3000)
- `COUNTRY_OF_QUERY`: Default country for queries (default: IN)
- `LOGGING`: Enable HTTP logging (default: true)
- `RATE_LIMIT_*`: Rate limiting configuration

## Project Structure
```
├── server.js          # Express app entry point
├── lib/
│   └── index.js       # API route handlers
├── test.js            # Newman test runner
├── PostmanCollections/# Test collections
├── openapi/           # Swagger/OpenAPI specs
├── .eslintrc          # Linting config
└── Dockerfile         # Container config
```

## Key Dependencies
- `express`: Web framework
- `google-play-scraper`: Core scraping library
- `cors`: CORS middleware
- `express-rate-limit`: Rate limiting
- `newman`: Postman test runner

## API Conventions
- Base path: `/api/`
- JSON responses only
- Use `toList()` wrapper: `{ results: [...] }`
- `cleanUrls()` helper for consistent URL generation
- Support `country` query param for localization
