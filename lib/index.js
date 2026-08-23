'use strict';

import Express from 'express';
import gplayScraper from '@mradex77/google-play-scraper';
import qs from 'querystring';
import { query, param, body, validationResult } from 'express-validator';
import {
  MAX_PAGE_SIZE,
  DEFAULT_START,
  MAX_LIST_RESULTS,
  MAX_BATCH_APPS,
  MAX_BATCH_CONCURRENCY,
  MAX_AVAILABILITY_COUNTRIES,
  DEFAULT_REVIEWS_COUNT,
  MAX_REVIEWS_COUNT,
  SORT_HELPFUL,
  SORT_NEWEST,
  SORT_RATED,
  DEFAULT_COUNTRY,
  DEFAULT_LANG,
  COUNTRY_CODE_RE,
  LANG_CODE_RE
} from './constants.js';
import logger from './logger.js';
import { buildUrl, cleanUrls } from './urlUtils.js';
import { getErrorStatusCode, problemDetails } from './errors.js';
import { parseFields, projectFields } from './fields.js';
import {
  validateAppList,
  validateApp,
  validateReviews,
  validateDataSafety,
  validatePermissions,
  validateSuggest,
  validateStringArray,
  validateDeveloperApps,
  validateAvailability,
  validateBatch
} from './schemas.js';
import { withTimeout } from './resilience.js';
import { retryCall } from './retry.js';
import { cachedCall, cacheMiddleware } from './cache.js';

// C8+C7: every scraper call runs under the upstream timeout budget (C8) and
// is retried with backoff on transient upstream failures (C7). Timeouts
// reject with UpstreamTimeoutError -> 504 + Retry-After via the error
// middleware; retries stay invisible to callers.
const gplay = new Proxy(gplayScraper, {
  get (target, prop) {
    const value = target[prop];
    if (typeof value === 'function') {
      return (...args) => cachedCall(prop, args, () => retryCall(() => withTimeout(value.apply(target, args))));
    }
    return value;
  }
});

const router = Express.Router();

// Permission category-name mapping — restores the string group name that
// facundoolano/google-play-scraper returned natively (e.g. "Device & app
// history"), which @mradex77/google-play-scraper returns as a numeric index.
const PERMISSION_TYPE_NAMES = {
  0: 'Device & app history',
  1: 'Other'
};

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = new Error(errors.array().map(err => err.msg).join('; '));
    error.code = 'VALIDATION_ERROR';
    if (req.baseUrl === '/v2') {
      res.status(400).type('application/problem+json').json(problemDetails(error, req, 400));
      return;
    }
    return res.status(400).json({
      error: 'Validation failed',
      messages: errors.array().map(err => err.msg)
    });
  }
  next();
};

const toList = (apps) => ({ results: apps });

router.use(cacheMiddleware);

router.use((req, res, next) => {
  // Country: default from single source of truth, validate format
  if (!req.query.country) {
    req.query.country = DEFAULT_COUNTRY;
  } else {
    req.query.country = req.query.country.toUpperCase();
    if (!COUNTRY_CODE_RE.test(req.query.country)) {
      const error = new Error('country must be a valid ISO 3166-1 alpha-2 code (e.g. US, IN, GB)');
      error.code = 'VALIDATION_ERROR';
      if (req.baseUrl === '/v2') {
        return res.status(400).type('application/problem+json').json(problemDetails(error, req, 400));
      }
      return res.status(400).json({ error: 'Validation failed', messages: [error.message] });
    }
  }

  // Language: default from single source of truth, validate format
  if (!req.query.lang) {
    req.query.lang = DEFAULT_LANG;
  } else {
    req.query.lang = req.query.lang.toLowerCase();
    if (!LANG_CODE_RE.test(req.query.lang)) {
      const error = new Error('lang must be a valid BCP-47 language tag (e.g. en, hi, ta-IN)');
      error.code = 'VALIDATION_ERROR';
      if (req.baseUrl === '/v2') {
        return res.status(400).type('application/problem+json').json(problemDetails(error, req, 400));
      }
      return res.status(400).json({ error: 'Validation failed', messages: [error.message] });
    }
  }

  if (process.env.LOGGING || false) {
    logger.info({ url: req.url, baseUrl: req.baseUrl, params: req.params, statusCode: res.statusCode }, 'GPlayAPI request');
  }

  next();
});

/* App search */
router.get('/apps/',
  query('q').optional().isString().trim().isLength({ min: 1 }).withMessage('Search query must be a non-empty string'),
  query('num').optional().isInt({ min: 1, max: MAX_PAGE_SIZE }).withMessage(`num must be between 1 and ${MAX_PAGE_SIZE}`),
  query('start').optional().isInt({ min: 0 }).withMessage('start must be a non-negative integer'),
  handleValidationErrors,
  function (req, res, next) {
    if (!req.query.q) {
      return next();
    }

    const opts = Object.assign({}, req.query, {
      term: req.query.q,
      country: req.query.country,
      num: req.query.num ? parseInt(req.query.num, 10) : undefined
    });

    gplay.search(opts)
      .then((apps) => apps.map(cleanUrls(req)))
      .then(toList)
      .then(d => validateAppList(d, '/apps/search'))
      .then(res.json.bind(res))
      .catch(next);
  });

/* Search suggest (legacy: ?suggest= on /apps/) */
router.get('/apps/',
  query('suggest').optional().isString().trim().isLength({ min: 1 }).withMessage('suggest must be a non-empty string'),
  handleValidationErrors,
  function (req, res, next) {
    if (!req.query.suggest) {
      return next();
    }

    // Deprecated in favor of GET /suggest — signal on v1 per RFC 9745.
    if (req.baseUrl === '/api') {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Link', `<${buildUrl(req, '/suggest')}?${qs.stringify({ q: req.query.suggest, country: req.query.country, lang: req.query.lang })}>; rel="alternate"`);
    }

    const toJSON = (term) => ({
      term,
      url: buildUrl(req, '/apps/') + '?' + qs.stringify({ q: term })
    });

    gplay.suggest({ term: req.query.suggest })
      .then((terms) => terms.map(toJSON))
      .then(toList)
      .then(d => validateSuggest(d, '/apps/suggest'))
      .then(res.json.bind(res))
      .catch(next);
  });

/* Search suggest (v2 promotion of the legacy ?suggest= param) */
router.get('/suggest',
  query('q').exists().withMessage('q is required (the partial search term to complete, e.g. q=spot)')
    .isString().trim().isLength({ min: 1 }).withMessage('q must be a non-empty string'),
  handleValidationErrors,
  function (req, res, next) {
    const toJSON = (term) => ({
      term,
      url: buildUrl(req, '/apps/') + '?' + qs.stringify({ q: term })
    });

    gplay.suggest({ term: req.query.q })
      .then((terms) => terms.map(toJSON))
      .then(toList)
      .then(d => validateSuggest(d, '/suggest'))
      .then(res.json.bind(res))
      .catch(next);
  });

// Shared offset-pagination for list()-backed endpoints. The scraper has no
// `start` offset and hard-caps results at MAX_LIST_RESULTS (200), so pages
// are emulated by fetching start + num and slicing. `next` is only emitted
// when another full page can exist within the cap — never a dangling link to
// an empty page at/after 200.
const listPage = (req) => {
  const num = Math.min(parseInt(req.query.num || String(MAX_LIST_RESULTS), 10) || MAX_LIST_RESULTS, MAX_LIST_RESULTS);
  const start = Math.max(parseInt(req.query.start || String(DEFAULT_START), 10) || 0, 0);
  return { num, start };
};

function paginateList (req, path, num, start) {
  return function paginate (apps) {
    if (start - num >= 0 && start - num < MAX_LIST_RESULTS) {
      req.query.start = start - num;
      apps.prev = buildUrl(req, path) + '?' + qs.stringify(req.query);
    }

    if (start + num < MAX_LIST_RESULTS) {
      req.query.start = start + num;
      apps.next = buildUrl(req, path) + '?' + qs.stringify(req.query);
    }

    return apps;
  };
}

/* App list */
router.get('/apps/', function (req, res, next) {
  const { num, start } = listPage(req);
  const listOpts = Object.assign({}, req.query, { num: Math.min(start + num, MAX_LIST_RESULTS) });

  gplay.list(listOpts)
    .then((apps) => apps.slice(start, start + num))
    .then((apps) => apps.map(cleanUrls(req)))
    .then(toList).then(paginateList(req, '/apps/', num, start))
    .then(res.json.bind(res))
    .catch(next);
});

/* App detail */
router.get('/apps/:appId',
  param('appId').isString().trim().isLength({ min: 1 }).withMessage('appId is required'),
  query('fields').optional().isString().trim().isLength({ min: 1 }).withMessage('fields must be a comma-separated list of field names'),
  handleValidationErrors,
  function (req, res, next) {
    let projection = null;
    if (req.query.fields) {
      const parsed = parseFields(req.query.fields);
      if (parsed.error) {
        const error = new Error(parsed.error);
        error.code = 'VALIDATION_ERROR';
        if (req.baseUrl === '/v2') {
          return res.status(400).type('application/problem+json').json(problemDetails(error, req, 400));
        }
        return res.status(400).json({ error: 'Validation failed', messages: [parsed.error] });
      }
      projection = parsed.fields;
    }

    const opts = Object.assign({}, req.query, {
      appId: req.params.appId,
      country: req.query.country,
      num: req.query.num ? parseInt(req.query.num, 10) : undefined
    });
    gplay.app(opts)
      .then(cleanUrls(req))
      .then(d => validateApp(d, '/apps/:appId'))
      .then(d => (projection ? projectFields(d, projection) : d))
      .then(res.json.bind(res))
      .catch(next);
  });

/* Batch app details */
router.post('/apps/batch',
  body('appIds').exists().withMessage('appIds is required (array of app IDs, e.g. ["com.duolingo","com.spotify.music"])'),
  body('appIds').isArray().withMessage('appIds must be an array of app IDs'),
  body('appIds').notEmpty().withMessage('appIds must contain at least one app ID'),
  body('appIds.*').isString().trim().isLength({ min: 1 }).withMessage('appIds entries must be non-empty strings'),
  body('concurrency').optional().isInt({ min: 1, max: MAX_BATCH_CONCURRENCY }).withMessage(`concurrency must be between 1 and ${MAX_BATCH_CONCURRENCY}`),
  query('fields').optional().isString().trim().isLength({ min: 1 }).withMessage('fields must be a comma-separated list of field names'),
  handleValidationErrors,
  function (req, res, next) {
    let projection = null;
    if (req.query.fields) {
      const parsed = parseFields(req.query.fields);
      if (parsed.error) {
        const error = new Error(parsed.error);
        error.code = 'VALIDATION_ERROR';
        if (req.baseUrl === '/v2') {
          return res.status(400).type('application/problem+json').json(problemDetails(error, req, 400));
        }
        return res.status(400).json({ error: 'Validation failed', messages: [parsed.error] });
      }
      projection = parsed.fields;
    }

    const appIds = [...new Set(req.body.appIds.map((id) => id.trim()))];
    if (appIds.length === 0) {
      const error = new Error('appIds must contain at least one app ID');
      error.code = 'VALIDATION_ERROR';
      if (req.baseUrl === '/v2') {
        return res.status(400).type('application/problem+json').json(problemDetails(error, req, 400));
      }
      return res.status(400).json({ error: 'Validation failed', messages: [error.message] });
    }
    if (appIds.length > MAX_BATCH_APPS) {
      const error = new Error(`appIds supports at most ${MAX_BATCH_APPS} apps per request (got ${req.body.appIds.length})`);
      error.code = 'VALIDATION_ERROR';
      if (req.baseUrl === '/v2') {
        return res.status(400).type('application/problem+json').json(problemDetails(error, req, 400));
      }
      return res.status(400).json({ error: 'Validation failed', messages: [error.message] });
    }

    gplay.apps({
      appIds,
      concurrency: req.body.concurrency ? parseInt(req.body.concurrency, 10) : undefined,
      country: req.query.country,
      lang: req.query.lang
    })
      .then((settled) => settled.map((entry) => entry.status === 'fulfilled'
        ? { appId: entry.appId, status: entry.status, app: cleanUrls(req)(entry.app) }
        : { appId: entry.appId, status: entry.status, error: entry.error?.message ?? String(entry.error) }))
      .then(toList)
      .then(d => validateBatch(d, '/apps/batch'))
      .then((d) => {
        if (!projection) return d;
        d.results = d.results.map((entry) => entry.status === 'fulfilled'
          ? { ...entry, app: projectFields(entry.app, projection) }
          : entry);
        return d;
      })
      .then(res.json.bind(res))
      .catch(next);
  });

/* Similar apps */
router.get('/apps/:appId/similar',
  param('appId').isString().trim().isLength({ min: 1 }).withMessage('appId is required'),
  handleValidationErrors,
  function (req, res, next) {
    const opts = Object.assign({}, req.query, {
      appId: req.params.appId,
      country: req.query.country,
      num: req.query.num ? parseInt(req.query.num, 10) : undefined
    });
    gplay.similar(opts)
      .then((apps) => apps.map(cleanUrls(req)))
      .then(toList)
      .then(d => validateAppList(d, '/apps/:appId/similar'))
      .then(res.json.bind(res))
      .catch(next);
  });

/* Data Safety */
router.get('/apps/:appId/datasafety',
  param('appId').isString().trim().isLength({ min: 1 }).withMessage('appId is required'),
  handleValidationErrors,
  function (req, res, next) {
    const opts = Object.assign({ appId: req.params.appId, country: req.query.country }, req.query);
    gplay.dataSafety(opts)
      .then(toList)
      .then(d => validateDataSafety(d, '/apps/:appId/datasafety'))
      .then(res.json.bind(res))
      .catch(next);
  });

/* App permissions */
router.get('/apps/:appId/permissions',
  param('appId').isString().trim().isLength({ min: 1 }).withMessage('appId is required'),
  handleValidationErrors,
  function (req, res, next) {
    const opts = Object.assign({ appId: req.params.appId, country: req.query.country }, req.query);
    gplay.permissions(opts)
      .then((perms) => {
        if (Array.isArray(perms)) {
          return { results: perms.map((p) => ({
            ...p,
            type: PERMISSION_TYPE_NAMES[p.type] ?? String(p.type)
          })) };
        }
        return { results: perms };
      })
      .then(d => validatePermissions(d, '/apps/:appId/permissions'))
      .then(res.json.bind(res))
      .catch(next);
  });

/* Country availability */
router.get('/apps/:appId/availability',
  param('appId').isString().trim().isLength({ min: 1 }).withMessage('appId is required'),
  query('countries').exists().withMessage('countries parameter is required (comma-separated ISO 3166-1 alpha-2 codes, e.g. countries=IN,US,GB)'),
  handleValidationErrors,
  function (req, res, next) {
    const codes = req.query.countries
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => code.length > 0);

    const badCodes = codes.filter((code) => !COUNTRY_CODE_RE.test(code));
    if (badCodes.length > 0) {
      const error = new Error(`countries must be comma-separated ISO 3166-1 alpha-2 codes; invalid: ${badCodes.join(', ')}`);
      error.code = 'VALIDATION_ERROR';
      if (req.baseUrl === '/v2') {
        return res.status(400).type('application/problem+json').json(problemDetails(error, req, 400));
      }
      return res.status(400).json({ error: 'Validation failed', messages: [error.message] });
    }

    if (codes.length === 0) {
      const error = new Error('countries must contain at least one ISO 3166-1 alpha-2 code');
      error.code = 'VALIDATION_ERROR';
      if (req.baseUrl === '/v2') {
        return res.status(400).type('application/problem+json').json(problemDetails(error, req, 400));
      }
      return res.status(400).json({ error: 'Validation failed', messages: [error.message] });
    }

    if (codes.length > MAX_AVAILABILITY_COUNTRIES) {
      const error = new Error(`countries supports at most ${MAX_AVAILABILITY_COUNTRIES} codes per request (got ${codes.length})`);
      error.code = 'VALIDATION_ERROR';
      if (req.baseUrl === '/v2') {
        return res.status(400).type('application/problem+json').json(problemDetails(error, req, 400));
      }
      return res.status(400).json({ error: 'Validation failed', messages: [error.message] });
    }

    gplay.availability({ appId: req.params.appId, countries: codes })
      .then((result) => validateAvailability(result, '/apps/:appId/availability'))
      .then((result) => {
        const countries = {};
        for (const [code, entry] of Object.entries(result.countries)) {
          countries[code.toUpperCase()] = {
            available: entry.status === 'available',
            status: entry.status,
            ...(entry.message !== undefined ? { message: entry.message } : {})
          };
        }
        return { appId: result.appId, countries };
      })
      .then(res.json.bind(res))
      .catch(next);
  });

/* App reviews */
router.get('/apps/:appId/reviews',
  param('appId').isString().trim().isLength({ min: 1 }).withMessage('appId is required'),
  query('num').optional().isInt({ min: 1, max: MAX_REVIEWS_COUNT }).withMessage(`num must be between 1 and ${MAX_REVIEWS_COUNT}`),
  query('sort').optional().isIn(['helpful', 'rated', 'newest']).withMessage('sort must be helpful, rated, or newest'),
  query('userdata').optional().isIn(['true', 'false']).withMessage('userdata must be true or false'),
  query('replies').optional().isIn(['true', 'false']).withMessage('replies must be true or false'),
  handleValidationErrors,
  function (req, res, next) {
    const opts = Object.assign({}, req.query, {
      appId: req.params.appId,
      country: req.query.country,
      num: req.query.num ? parseInt(req.query.num, 10) : DEFAULT_REVIEWS_COUNT
    });

    const includeUserData = req.query.userdata === 'true';
    const includeReplies = req.query.replies === 'true';

    const processReviews = (reviews, includeUserData, includeReplies) => {
      const sanitizeReplyText = (text, userName) => {
        const userNameParts = userName.split(' ');

        function escapeRegExp (string) {
          return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        const userNamePatterns = userNameParts.map(part => new RegExp(escapeRegExp(part), 'gi'));

        return userNamePatterns.reduce(
          (sanitizedText, pattern) => sanitizedText.replace(pattern, '[REDACTED_USER]'),
          text
        );
      };

      if (!includeUserData) {
        reviews.data = reviews.data.map(review => {
          const { userName, userImage: _userImage, replyText, _url, ...rest } = review;
          rest.date = rest.date.split('T')[0];
          if (!includeReplies) {
            delete rest.replyText;
            delete rest.replyDate;
          } else if (includeReplies && replyText) {
            const sanitizedReplyText = sanitizeReplyText(replyText, userName);
            rest.replyText = sanitizedReplyText;
          }
          return rest;
        });
      } else {
        if (!includeReplies) {
          reviews.data = reviews.data.map(review => {
            const { _replyText, _replyDate, _url, ...rest } = review;
            rest.date = rest.date.split('T')[0];
            return rest;
          });
        } else {
          reviews.data = reviews.data.map(review => {
            const { _url, ...rest } = review;
            rest.date = rest.date.split('T')[0];
            return rest;
          });
        }
      }
      if (reviews.nextPaginationToken === null) reviews.nextPaginationToken = '';
      return reviews;
    };

    // Sort criteria - Helpful, Most rated, and Newest reviews
    // https://github.com/facundoolano/google-play-scraper/blob/89202849f6054f6ac64790a385abc3c18ae98df1/lib/constants.js#L69C7-L69C7
    opts.sort = req.query.sort === 'helpful' ? SORT_HELPFUL : req.query.sort === 'rated' ? SORT_RATED : SORT_NEWEST;

    gplay.reviews(opts)
      .then(reviews => processReviews(reviews, includeUserData, includeReplies))
      .then(toList)
      .then(d => validateReviews(d, '/apps/:appId/reviews'))
      .then(res.json.bind(res))
      .catch(next);
  });
/* Apps by developer */
router.get('/developers/:devId/',
  param('devId').isString().trim().isLength({ min: 1 }).withMessage('devId is required'),
  handleValidationErrors,
  function (req, res, next) {
    const opts = Object.assign({}, req.query, {
      devId: req.params.devId,
      country: req.query.country,
      num: req.query.num ? parseInt(req.query.num, 10) : undefined
    });

    gplay.developer(opts)
      .then((apps) => apps.map(cleanUrls(req)))
      .then((apps) => ({
        devId: req.params.devId,
        apps
      }))
      .then(d => validateDeveloperApps(d, '/developers/:devId/'))
      .then(res.json.bind(res))
      .catch(next);
  });

/* Developer list (not supported) */
router.get('/developers/', (req, res) =>
  res.status(400).json({
    message: 'Please specify a developer id.',
    example: buildUrl(req, '/developers/' + qs.escape('Wikimedia Foundation'))
  }));

/* List of apps by category and collection */
router.get('/lists/',
  query('category').notEmpty().withMessage('category parameter is required'),
  query('collection').notEmpty().withMessage('collection parameter is required'),
  query('num').optional().isInt({ min: 1, max: MAX_PAGE_SIZE }).withMessage(`num must be between 1 and ${MAX_PAGE_SIZE}`),
  query('start').optional().isInt({ min: 0 }).withMessage('start must be a non-negative integer'),
  handleValidationErrors,
  function (req, res, next) {
    const { num, start } = listPage(req);
    const opts = Object.assign({ term: req.query.q, country: req.query.country }, req.query);

    opts.num = Math.min(start + num, MAX_LIST_RESULTS);

    gplay.list(opts)
      .then((apps) => apps.slice(start, start + num))
      .then((apps) => apps.map(cleanUrls(req)))
      .then(toList)
      .then(d => validateAppList(d, '/lists/'))
      .then(paginateList(req, '/lists/', num, start))
      .then(res.json.bind(res))
      .catch(next);
  });

/* Category list */
router.get('/categories/', async (req, res, next) => {
  try {
    res.json(validateStringArray(Object.keys(gplay.category)));
  } catch (error) {
    next(error); // Pass the error to Express's error-handling middleware
  }
});

/* Collection list */
router.get('/collections/', async (req, res, next) => {
  try {
    res.json(validateStringArray(Object.keys(gplay.collection)));
  } catch (error) {
    next(error); // Pass the error to Express's error-handling middleware
  }
});

function errorHandler (err, req, res, _next) {
  if (!res.headersSent) {
    const status = getErrorStatusCode(err);
    if (req.baseUrl === '/v2') {
      const problem = problemDetails(err, req, status);
      if (problem.retryAfter !== undefined) {
        res.setHeader('Retry-After', problem.retryAfter);
      }
      res.status(status).type('application/problem+json').json(problem);
      return;
    }
    const errorType = status === 404
      ? 'Not Found'
      : status === 400
        ? 'Bad Request'
        : status === 504
          ? 'Gateway Timeout'
          : 'Internal Server Error';
    if (status === 504) {
      res.setHeader('Retry-After', problemDetails(err, req, status).retryAfter);
    }
    res.status(status).json({ error: errorType, message: err.message, url: req.url });
  }
}

router.use(errorHandler);

export { errorHandler };
export default router;
