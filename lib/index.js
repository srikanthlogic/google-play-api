'use strict';

import Express from 'express';
import gplay from 'google-play-scraper';
import path from 'path';
import qs from 'querystring';

const router = Express.Router();

const toList = (apps) => ({ results: apps });

router.use((req, res, next) => {

  if (!req.query.country) {
    req.query.country = process.env.COUNTRY_OF_QUERY || 'US';;
  }

  if (process.env.LOGGING || false) {
    console.log("GPlayAPI", req.url, req.baseUrl, req.params, "Status: ", res.statusCode)
  }

  next();
});


const cleanUrls = (req) => (app) => Object.assign({}, app, {
  playstoreUrl: app.url,
  url: buildUrl(req, 'apps/' + app.appId),
  permissions: buildUrl(req, 'apps/' + app.appId + '/permissions'),
  similar: buildUrl(req, 'apps/' + app.appId + '/similar'),
  reviews: buildUrl(req, 'apps/' + app.appId + '/reviews'),
  datasafety: buildUrl(req, 'apps/' + app.appId + '/datasafety'),
  developer: {
    devId: app.developer,
    url: buildUrl(req, 'developers/' + qs.escape(app.developer))
  },
  categories: buildUrl(req, 'categories/')
});

const buildUrl = (req, subpath) =>
  req.protocol + '://' + path.join(req.get('host'), req.baseUrl, subpath);

/* App search */
router.get('/apps/', function (req, res, next) {
  if (!req.query.q) {
    return next();
  }

  const opts = Object.assign({ term: req.query.q, country: req.query.country }, req.query);

  gplay.search(opts)
    .then((apps) => apps.map(cleanUrls(req)))
    .then(toList)
    .then(res.json.bind(res))
    .catch(next);
});

/* Search suggest */
router.get('/apps/', function (req, res, next) {
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
  function paginate(apps) {
    const num = parseInt(req.query.num || '60');
    const start = parseInt(req.query.start || '0');

    if (start - num >= 0) {
      req.query.start = start - num;
      apps.prev = buildUrl(req, '/apps/') + '?' + qs.stringify(req.query);
    }

    if (start + num <= 500) {
      req.query.start = start + num;
      apps.next = buildUrl(req, '/apps/') + '?' + qs.stringify(req.query);
    }

    return apps;
  }

  gplay.list(req.query)
    .then((apps) => apps.map(cleanUrls(req)))
    .then(toList).then(paginate)
    .then(res.json.bind(res))
    .catch(next);
});

/* App detail */
router.get('/apps/:appId', function (req, res, next) {
  const opts = Object.assign({ appId: req.params.appId, country: req.query.country }, req.query);
  gplay.app(opts)
    .then(cleanUrls(req))
    .then(res.json.bind(res))
    .catch(next);
});

/* Similar apps */
router.get('/apps/:appId/similar', function (req, res, next) {
  const opts = Object.assign({ appId: req.params.appId, country: req.query.country }, req.query);
  gplay.similar(opts)
    .then((apps) => apps.map(cleanUrls(req)))
    .then(toList)
    .then(res.json.bind(res))
    .catch(next);
});

/* Data Safety */
router.get('/apps/:appId/datasafety', function (req, res, next) {
  const opts = Object.assign({ appId: req.params.appId, country: req.query.country }, req.query);
  gplay.datasafety(opts)
    .then(toList)
    .then(res.json.bind(res))
    .catch(next);
});

/* App permissions */
router.get('/apps/:appId/permissions', function (req, res, next) {
  const opts = Object.assign({ appId: req.params.appId, country: req.query.country }, req.query);
  gplay.permissions(opts)
    .then(toList)
    .then(res.json.bind(res))
    .catch(next);
});

/* App reviews */
router.get('/apps/:appId/reviews', function (req, res, next) {
  const opts = Object.assign({ appId: req.params.appId, country: req.query.country }, req.query);
  const includeUserData = req.query.userdata === 'true';
  const includeReplies = req.query.replies == 'true'

  const processReviews = (reviews, includeUserData, includeReplies) => {
    const sanitizeReplyText = (text, userName) => {
      const userNameParts = userName.split(' ');

      function escapeRegExp(string) {
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
        const { userName, userImage, replyText, url, ...rest } = review;
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
          const { replyText, replyDate, url, ...rest } = review;
          rest.date = rest.date.split('T')[0];
          return rest;
        });
      } else {
        reviews.data = reviews.data.map(review => {
          const { url, ...rest } = review;
          rest.date = rest.date.split('T')[0];
          return rest;
        });
      }
    }
    return reviews;
  };

  // Check if nextPaginationToken is present and not null
  if (req.query.nextPaginationToken !== null) {
    opts.paginate = true;
    opts.nextPaginationToken = req.query.nextPaginationToken;
  }

  // Sort criteria - Helpful, Most rated, and Newest reviews
  // https://github.com/facundoolano/google-play-scraper/blob/89202849f6054f6ac64790a385abc3c18ae98df1/lib/constants.js#L69C7-L69C7
  opts.sort = req.query.sort === 'helpful' ? 1 : req.query.sort === 'rated' ? 3 : 2;

  gplay.reviews(opts)
    .then(reviews => processReviews(reviews, includeUserData, includeReplies))
    .then(toList)
    .then(res.json.bind(res))
    .catch(next);
});
/* Apps by developer */
router.get('/developers/:devId/', function (req, res, next) {
  const opts = Object.assign({ devId: req.params.devId, country: req.query.country }, req.query);

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
router.get('/lists/', function (req, res, next) {
  const opts = Object.assign({ term: req.query.q, country: req.query.country }, req.query);
  if (!req.query.category || !req.query.collection) {
    return res.status(400).json({ message: 'Both category and collection parameters are required.' });
  }

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

function anonymizeReplyText(replyText, userName) {
  const userPlaceholder = '<<USER>>';
  return replyText.replace(new RegExp(userName, 'g'), userPlaceholder);
}

function errorHandler(err, req, res, next) {
  if (!res.headersSent) {
    const status = err.message === "App not found (404)" ? 404 : 400;
    res.status(status).json({ error: status === 404 ? "App not found" : "Bad Request", message: err.message, url: req.url });
  }
  next(err);
}

router.use(errorHandler);

export default router;