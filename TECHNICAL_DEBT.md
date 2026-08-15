# Technical Debt Assessment & Remediation Plan

## Executive Summary

This document identifies technical debt in the Google Play API project and provides a prioritized plan to address it. The debt spans security vulnerabilities, outdated dependencies, code quality issues, and architectural concerns.

**Last Updated:** 2026-02-11  
**Status:** Phase 1 partially completed - Critical bugs fixed, security audit pending

---

## Current Status Overview

| Category | Items | Completed | Pending |
|----------|-------|-----------|---------|
| Critical Bugs | 2 | 2 | 0 |
| Security | 4 | 0 | 4 |
| Code Quality | 6 | 1 | 5 |
| Architecture | 4 | 0 | 4 |
| Testing | 3 | 2 | 1 |
| **Total** | **19** | **5** | **14** |

---

## 1. Critical Debt (Address Immediately)

### 1.0 Critical Bugs Fixed (2026-02-11)
**Status: COMPLETED**

#### Bug 1: Privacy Filter Not Working
**Issue:** `userImage` field was not being filtered when `userdata=false` query parameter was used in reviews endpoint.

**Root Cause:** Code used `_userImage` (with underscore) in destructuring pattern, but actual field from google-play-scraper is `userImage` (no underscore).

**Fix:** Changed line 198 in `lib/index.js`:
```javascript
// Before (broken):
const { userName, _userImage, replyText, _url, ...rest } = review;

// After (fixed):
const { userName, userImage, replyText, _url, ...rest } = review;
```

**Impact:** Privacy mode now correctly filters user images as intended.

#### Bug 2: Test Runner ECONNREFUSED
**Issue:** Tests failed with `connect ECONNREFUSED 127.0.0.1:3000` because server was not running.

**Fix:** Modified `test.js` to:
- Automatically start server before tests
- Wait for server to be ready (health check)
- Run Newman collections
- Shut down server after tests complete

**Impact:** Tests can now run standalone with `npm test`.

### 1.1 Security Vulnerabilities
**Severity: HIGH | Effort: LOW**

| Package | Severity | Issue | Action |
|---------|----------|-------|--------|
| body-parser | HIGH | qs vulnerability | `npm audit fix` |
| newman | HIGH | Via lodash dependency | Update to 6.2.2 |
| lodash | MODERATE | Prototype pollution | Update dependencies |
| jose | MODERATE | Resource exhaustion | Update via newman |

**Impact:** Production security risk  
**Effort:** 1-2 hours  
**Command:**
```bash
npm audit fix
npm update newman
```

### 1.2 Missing Input Validation
**Severity: HIGH | Effort: MEDIUM | Status: PARTIALLY COMPLETED**

✅ **Completed (2026-02-11):**
- Added basic express-validator validation for query parameters in `lib/index.js`
- Validation for `q`, `num`, `start`, `suggest`, `appId`, `sort`, `userdata`, `replies`, `category`, `collection` parameters
- Centralized error handling with `handleValidationErrors` middleware

**Remaining:**
- More comprehensive validation rules
- Custom validation error messages
- Sanitization of inputs

**Risks:**
- Injection attacks
- Unexpected errors
- Invalid data passing to google-play-scraper

**Solution:** Continue enhancing express-validator rules

---

## 2. High Priority Debt (Address Within 2 Weeks)

### 2.1 Outdated Core Dependencies
**Severity: HIGH | Effort: MEDIUM**

| Package | Current | Latest | Breaking Changes |
|---------|---------|--------|------------------|
| express | 4.22.1 | 5.2.1 | Yes - requires testing |
| express-rate-limit | 7.5.1 | 8.2.1 | Yes - new API |
| eslint | 9.17.0 | 10.0.0 | Yes - flat config |

**Migration Path:**
1. Update express-rate-limit (check middleware API changes)
2. Test thoroughly with current test suite
3. Update eslint configuration to flat config format

### 2.2 Console Logging vs Structured Logging
**Severity: MEDIUM | Effort: LOW**

Found 6 console.log/error statements across the codebase:
- `server.js:60, 86, 97`
- `lib/index.js:18`
- `test.js:24, 26`

**Solution:** Replace with structured logger (pino/winston)
```javascript
// Instead of:
console.log('Logging is enabled');

// Use:
logger.info('Server configuration', { logging: true });
```

### 2.3 Monolithic Route Handler
**Severity: MEDIUM | Effort: MEDIUM**

`lib/index.js` is 269 lines with all routes in one file. No separation of:
- Route definitions
- Business logic (controllers)
- Data transformation

**Recommended Structure:**
```
lib/
├── routes/
│   ├── apps.js
│   ├── developers.js
│   ├── categories.js
│   └── collections.js
├── controllers/
│   ├── appController.js
│   └── developerController.js
├── middleware/
│   ├── errorHandler.js
│   ├── validator.js
│   └── logger.js
└── utils/
    ├── urlBuilder.js
    └── transformers.js
```

---

## 3. Medium Priority Debt (Address Within 1 Month)

### 3.1 Async/Await Modernization
**Severity: MEDIUM | Effort: MEDIUM**

Current pattern uses `.then().catch()` chains:
```javascript
// Current (harder to read, error-prone)
gplay.search(opts)
  .then((apps) => apps.map(cleanUrls(req)))
  .then(toList)
  .then(res.json.bind(res))
  .catch(next);
```

**Modernize to:**
```javascript
// Modern (cleaner, better error handling)
try {
  const apps = await gplay.search(opts);
  const cleanedApps = apps.map(cleanUrls(req));
  res.json(toList(cleanedApps));
} catch (error) {
  next(error);
}
```

### 3.2 ESLint Configuration Legacy Format
**Severity: MEDIUM | Effort: LOW**

Current `.eslintrc` uses deprecated format. ESLint 9+ uses flat config (`eslint.config.js`).

**Migration:**
```javascript
// eslint.config.js
import js from '@eslint/js';
import semistandard from 'eslint-config-semistandard';

export default [
  js.configs.recommended,
  semistandard,
  {
    rules: {
      'no-unused-vars': ['error', { vars: 'all', args: 'after-used' }]
    }
  }
];
```

### 3.3 Inconsistent Code Style
**Severity: LOW | Effort: LOW**

Mixed patterns found:
- Function declarations vs arrow functions
- Double quotes in some strings (should be single)
- Missing trailing commas

**Solution:** Add pre-commit hooks (husky + lint-staged)

### 3.4 Error Handling Improvements
**Severity: MEDIUM | Effort: LOW**

Current error handler in `lib/index.js`:
```javascript
function errorHandler (err, req, res, next) {
  if (!res.headersSent) {
    const status = err.message === "App not found (404)" ? 404 : 400;
    res.status(status).json({ error: status === 404 ? "App not found" : "Bad Request", message: err.message, url: req.url });
  }
  next(err);
}
```

**Issues:**
- String comparison for error types is brittle
- No error categorization
- Missing request ID for tracing

---

## 4. Low Priority Debt (Address When Convenient)

### 4.1 Missing Development Tooling
**Severity: LOW | Effort: LOW**

Add to devDependencies:
- `nodemon` - Auto-restart on changes
- `eslint-plugin-security` - Security linting
- `@types/express` - TypeScript definitions (even for JS projects)

### 4.2 Test Coverage Gap
**Severity: MEDIUM | Effort: HIGH | Status: PARTIALLY COMPLETED**

✅ **Completed (2026-02-11):**
- Fixed all 5 failing assertions (3 privacy-related + 2 DataSafety data changes)
- All 99 assertions now passing (100% success rate)
- Test runner now auto-starts/stops server
- Updated Postman collection for current Google Play data format

**Current Test Coverage:**
| Suite | Requests | Assertions | Pass Rate |
|-------|----------|------------|-----------|
| GPlayAPIUnitTests | 5 | 28 | 100% |
| GooglePlayAPI | 12 | 71 | 100% |
| **Total** | **17** | **99** | **100%** |

**Remaining:**
- Add Jest unit tests for:
  - URL builder functions (`lib/urlUtils.js`)
  - Data transformers
  - Error handlers
  - Input validators
- Add mocking for google-play-scraper
- Add code coverage reporting (nyc/istanbul)

### 4.3 Missing Documentation
**Severity: LOW | Effort: MEDIUM**

- No JSDoc comments on functions
- No architecture decision records (ADRs)
- No API versioning strategy

### 4.4 Hardcoded Configuration
**Severity: LOW | Effort: LOW**

Found in code:
```javascript
const num = parseInt(req.query.num || '60');  // Magic number
const start = parseInt(req.query.start || '0');
if (start + num <= 500) {  // Magic number
```

**Solution:** Move to config/constants file

---

## Remediation Schedule

### Phase 1: Security & Stability (Week 1) - IN PROGRESS
- [x] ~~Fix critical privacy bug (userImage filtering)~~ ✅ 2026-02-11
- [x] ~~Fix test runner (auto-start/stop server)~~ ✅ 2026-02-11
- [x] ~~Add basic request validation middleware~~ ✅ 2026-02-11
- [ ] Run `npm audit fix` to address vulnerabilities
- [ ] Update newman to 6.2.2
- [ ] Add structured logging (pino implemented, needs cleanup)

### Phase 2: Modernization (Weeks 2-3)
- [ ] Migrate to ESLint flat config
- [ ] Update express-rate-limit with API changes
- [ ] Add pre-commit hooks (husky + lint-staged)
- [ ] Refactor: Extract URL builder utilities

### Phase 3: Architecture Improvements (Weeks 4-6)
- [ ] Split routes into separate files
- [ ] Create controller layer
- [ ] Add error categorization
- [ ] Add request ID middleware

### Phase 4: Testing & Documentation (Weeks 7-8)
- [x] ~~Fix all failing tests~~ ✅ 2026-02-11
- [x] ~~Update test documentation~~ ✅ 2026-02-11
- [ ] Add Jest testing framework
- [ ] Write unit tests for utilities
- [ ] Add JSDoc comments
- [ ] Document API versioning strategy

---

## Quick Wins (Can be done today)

1. **Fix security vulnerabilities:**
   ```bash
   npm audit fix
   ```

2. **Update patch versions:**
   ```bash
   npm update
   ```

3. **Add nodemon for development:**
   ```bash
   npm install --save-dev nodemon
   ```
   Add to package.json scripts:
   ```json
   "dev": "nodemon server.js"
   ```

4. **Add .nvmrc file:**
   ```
   22
   ```

---

## Success Metrics

### Current Progress (2026-02-11)
- [x] **All tests passing** - 99/99 assertions (100%)
- [x] **Critical bugs fixed** - Privacy filter + test runner
- [x] **Basic input validation** - express-validator implemented
- [ ] Zero high/critical security vulnerabilities (`npm audit`)
- [ ] All dependencies within 1 major version of latest
- [ ] ESLint passes with zero warnings
- [ ] Code coverage > 70%
- [ ] Routes organized by domain
- [ ] Structured logging in place

### Target State
After full debt remediation:
- [ ] Zero high/critical security vulnerabilities (`npm audit`)
- [ ] All dependencies within 1 major version of latest
- [ ] ESLint passes with zero warnings
- [ ] Code coverage > 70%
- [ ] Routes organized by domain
- [ ] Structured logging in place

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking changes in express 5 | HIGH | Test thoroughly in staging |
| google-play-scraper API changes | MEDIUM | Pin version, test before update |
| Time investment | MEDIUM | Prioritize by severity, do incrementally |
| Test suite gaps | HIGH | Add tests before major refactoring |

---

*Assessment completed: 2026-02-10*  
*Last updated: 2026-02-11*  
*Next review: After Phase 1 completion*
