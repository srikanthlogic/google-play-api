'use strict';

import Express from 'express';
import gplay from '@mradex77/google-play-scraper';
import qs from 'querystring';
import { query, param, validationResult } from 'express-validator';
import {
  MAX_PAGE_SIZE,
  DEFAULT_START,
  MAX_LIST_RESULTS,
  DEFAULT_REVIEWS_COUNT,
  MAX_REVIEWS_COUNT,
  SORT_HELPFUL,
  SORT_NEWEST,
  SORT_RATED,
  DEFAULT_COUNTRY
} from './constants.js';
import logger from './logger.js';
import { buildUrl, cleanUrls } from './urlUtils.js';
import { getErrorStatusCode, problemDetails } from './errors.js';

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

router.use((req, res, next) => {
  if (!req.query.country) {
    req.query.country = process.env.COUNTRY_OF_QUERY || DEFAULT_COUNTRY;
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
      .then(res.json.bind(res))
      .catch(next);
  });

/* Search suggest */
router.get('/apps/',
  query('suggest').optional().isString().trim().isLength({ min: 1 }).withMessage('suggest must be a non-empty string'),
  handleValidationErrors,
  function (req, res, next) {
    if (!req.query.suggest) {
      return next();
    }

    const toJSON = (term) => ({
      term,
      url: buildUrl(req, '/apps/') + '?' + qs.stringify({ q: term })
    });

    gplay.suggest({ term: req.query.suggest })
      .then((terms) => terms.map(toJSON))
      .then(toList)
      .then(res.json.bind(res))
      .catch(next);
  });

/* App list */
router.get('/apps/', function (req, res, next) {
  // @mradex77/google-play-scraper caps list() at 200 results and has no
  // `start` offset; emulate offset pagination by fetching start + num and
  // slicing, so the existing prev/next API contract is preserved.
  const num = Math.min(parseInt(req.query.num || String(MAX_LIST_RESULTS), 10) || MAX_LIST_RESULTS, MAX_LIST_RESULTS);
  const start = Math.max(parseInt(req.query.start || String(DEFAULT_START), 10) || 0, 0);

  function paginate (apps) {
    if (start - num >= 0) {
      req.query.start = start - num;
      apps.prev = buildUrl(req, '/apps/') + '?' + qs.stringify(req.query);
    }

    if (start + num <= MAX_LIST_RESULTS) {
      req.query.start = start + num;
      apps.next = buildUrl(req, '/apps/') + '?' + qs.stringify(req.query);
    }

    return apps;
  }

  const listOpts = Object.assign({}, req.query, { num: Math.min(start + num, MAX_LIST_RESULTS) });

  gplay.list(listOpts)
    .then((apps) => apps.slice(start, start + num))
    .then((apps) => apps.map(cleanUrls(req)))
    .then(toList).then(paginate)
    .then(res.json.bind(res))
    .catch(next);
});

/* App detail */
router.get('/apps/:appId',
  param('appId').isString().trim().isLength({ min: 1 }).withMessage('appId is required'),
  handleValidationErrors,
  function (req, res, next) {
    const opts = Object.assign({}, req.query, {
      appId: req.params.appId,
      country: req.query.country,
      num: req.query.num ? parseInt(req.query.num, 10) : undefined
    });
    gplay.app(opts)
      .then(cleanUrls(req))
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
    const opts = Object.assign({ term: req.query.q, country: req.query.country }, req.query);

    opts.num = req.query.num ? parseInt(req.query.num, 10) : undefined;

    gplay.list(opts)
      .then((apps) => apps.map(cleanUrls(req)))
      .then(toList)
      .then(res.json.bind(res))
      .catch(next);
  });

/* Category list */
router.get('/categories/', async (req, res, next) => {
  try {
    res.json(Object.keys(gplay.category));
  } catch (error) {
    next(error); // Pass the error to Express's error-handling middleware
  }
});

/* Collection list */
router.get('/collections/', async (req, res, next) => {
  try {
    res.json(Object.keys(gplay.collection));
  } catch (error) {
    next(error); // Pass the error to Express's error-handling middleware
  }
});

function errorHandler (err, req, res, _next) {
  if (!res.headersSent) {
    const status = getErrorStatusCode(err);
    if (req.baseUrl === '/v2') {
      res.status(status).type('application/problem+json').json(problemDetails(err, req, status));
      return;
    }
    const errorType = status === 404 ? 'Not Found' : status === 400 ? 'Bad Request' : 'Internal Server Error';
    res.status(status).json({ error: errorType, message: err.message, url: req.url });
  }
}

router.use(errorHandler);

export default router;
