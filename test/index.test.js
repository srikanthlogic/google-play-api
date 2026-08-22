'use strict';

import { test, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import Express from 'express';
import { DEFAULT_COUNTRY, DEFAULT_LANG, SORT_HELPFUL, SORT_RATED, SORT_NEWEST } from '../lib/constants.js';
import { config as resilienceConfig } from '../lib/resilience.js';
import { resetCache } from '../lib/cache.js';

// Silence pino-pretty transport in the logger under test
process.env.NODE_ENV = 'production';

// C8: keep the upstream timeout budget tiny so timeout tests run fast.
process.env.UPSTREAM_TIMEOUT_MS = '150';

// C1: reset the response cache between tests so scraper fakes swapped in
// by individual tests are actually exercised.
beforeEach(() => resetCache());

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeApp = (appId = 'com.example.app') => ({
  appId,
  title: 'Example App',
  url: `https://play.google.com/store/apps/details?id=${appId}`,
  developer: 'Example Dev',
  score: 4.5
});

const makeReview = () => ({
  id: 'r1',
  userName: 'John Doe',
  userImage: 'https://img.example.com/john.png',
  date: '2026-01-02T03:04:05Z',
  url: 'https://play.google.com/store/review/r1',
  score: 5,
  title: null,
  text: 'Great app',
  replyDate: '2026-01-03T00:00:00Z',
  replyText: 'Thanks John Doe for the review',
  version: '1.0',
  thumbsUp: 3,
  criterias: [],
  _url: 'internal-url',
  _replyText: 'internal-reply',
  _replyDate: 'internal-date'
});

// Mutable fake scraper — individual tests override single methods.
const fake = {
  category: { GAME: 'Game', FINANCE: 'Finance' },
  collection: { TOP_SELLING: 'Top selling', TOP_GROSSING: 'Top grossing' },
  search: async () => [makeApp()],
  suggest: async () => ['game', 'games'],
  list: async (opts) => Array.from({ length: opts.num || 60 }, (_, i) => makeApp(`com.example.app${i}`)),
  app: async () => makeApp(),
  similar: async () => [makeApp('com.example.similar')],
  dataSafety: async () => ({
    sharedData: [],
    collectedData: [{ data: 'Location', type: 'Precise location', purpose: 'App functionality', optional: false }],
    securityPractices: [],
    privacyPolicyUrl: 'https://example.com/privacy'
  }),
  permissions: async () => [
    { type: 0, permissions: ['Read device history'] },
    { type: 1, permissions: ['Other'] },
    { type: 7, permissions: ['Unknown group'] }
  ],
  reviews: async () => ({ data: [makeReview()], nextPaginationToken: null }),
  developer: async () => [makeApp()],
  availability: async (opts) => ({
    appId: opts.appId,
    countries: Object.fromEntries(opts.countries.map((code, i) => [
      code,
      i === 0 ? { status: 'available' } : i === 1 ? { status: 'unavailable' } : { status: 'error', message: 'storefront fetch failed' }
    ]))
  }),
  apps: async (opts) => opts.appIds.map((appId) => appId === 'com.example.missing'
    ? { appId, status: 'rejected', error: { message: 'App not found (404)' } }
    : { appId, status: 'fulfilled', app: makeApp(appId) })
};

mock.module('@mradex77/google-play-scraper', {
  namedExports: {},
  defaultExport: fake
});

const { default: router, errorHandler } = await import('../lib/index.js');

// ─── Test server ─────────────────────────────────────────────────────────────

const app = Express();
app.use(Express.json());
app.use('/api', router);
app.use('/v2', router);
app.use(errorHandler);

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = async (path, payload) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, headers: res.headers, body };
};

const get = async (path) => {
  const res = await fetch(base + path);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, headers: res.headers, body, text };
};

// ─── Middleware: country / lang defaults and validation ──────────────────────

test('defaults country and lang from single source of truth', async () => {
  let captured;
  fake.app = async (opts) => { captured = opts; return makeApp(); };
  const { status } = await get('/api/apps/com.example.app');
  assert.equal(status, 200);
  assert.equal(captured.country, DEFAULT_COUNTRY);
  assert.equal(captured.lang, DEFAULT_LANG);
  fake.app = async () => makeApp();
});

test('uppercases valid country and lowercases valid lang', async () => {
  let captured;
  fake.app = async (opts) => { captured = opts; return makeApp(); };
  const { status } = await get('/api/apps/com.example.app?country=us&lang=EN');
  assert.equal(status, 200);
  assert.equal(captured.country, 'US');
  assert.equal(captured.lang, 'en');
  fake.app = async () => makeApp();
});

test('rejects invalid country code (v1 shape)', async () => {
  const { status, body } = await get('/api/apps/com.example.app?country=USA');
  assert.equal(status, 400);
  assert.equal(body.error, 'Validation failed');
  assert.match(body.messages[0], /country/);
});

test('rejects invalid lang tag (v1 shape)', async () => {
  const { status, body } = await get('/api/apps/com.example.app?lang=english');
  assert.equal(status, 400);
  assert.equal(body.error, 'Validation failed');
  assert.match(body.messages[0], /lang/);
});

test('rejects invalid country code with problem+json on /v2', async () => {
  const { status, headers, body } = await get('/v2/apps/com.example.app?country=USA');
  assert.equal(status, 400);
  assert.match(headers.get('content-type'), /application\/problem\+json/);
  assert.equal(body.title, 'Bad Request');
  assert.equal(body.status, 400);
  assert.ok(body.type);
  assert.match(body.detail, /country/);
});

// ─── /apps/ search ───────────────────────────────────────────────────────────

test('search returns cleaned app list wrapped in results', async () => {
  const { status, body } = await get('/api/apps/?q=example');
  assert.equal(status, 200);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].appId, 'com.example.app');
  assert.equal(body.results[0].playstoreUrl, 'https://play.google.com/store/apps/details?id=com.example.app');
  assert.match(body.results[0].url, /\/api\/apps\/com\.example\.app$/);
  assert.match(body.results[0].reviews, /\/api\/apps\/com\.example\.app\/reviews$/);
});

test('search passes term, num and country to the scraper', async () => {
  let captured;
  fake.search = async (opts) => { captured = opts; return [makeApp()]; };
  await get('/api/apps/?q=example&num=5&country=GB');
  assert.equal(captured.term, 'example');
  assert.equal(captured.num, 5);
  assert.equal(captured.country, 'GB');
  fake.search = async () => [makeApp()];
});

test('search rejects out-of-range num', async () => {
  const { status, body } = await get('/api/apps/?q=example&num=999');
  assert.equal(status, 400);
  assert.match(body.messages[0], /num/);
});

test('search rejects negative start', async () => {
  const { status } = await get('/api/apps/?q=example&start=-1');
  assert.equal(status, 400);
});

// ─── /apps/ suggest ──────────────────────────────────────────────────────────

test('suggest returns terms with search URLs', async () => {
  const { status, body } = await get('/api/apps/?suggest=game');
  assert.equal(status, 200);
  assert.equal(body.results.length, 2);
  assert.equal(body.results[0].term, 'game');
  assert.match(body.results[0].url, /q=game$/);
});

// ─── /apps/ list (emulated offset pagination) ────────────────────────────────

test('list slices scraper output by start/num and emits prev/next links', async () => {
  let captured;
  fake.list = async (opts) => {
    captured = opts;
    return Array.from({ length: opts.num }, (_, i) => makeApp(`com.example.app${i}`));
  };
  const { status, body } = await get('/api/apps/?num=10&start=20');
  assert.equal(status, 200);
  assert.equal(captured.num, 30); // fetches start + num, no native offset
  assert.equal(body.results.length, 10);
  assert.equal(body.results[0].appId, 'com.example.app20');
  assert.match(body.prev, /start=10/);
  assert.match(body.next, /start=30/);
  fake.list = async (opts) => Array.from({ length: opts.num || 60 }, (_, i) => makeApp(`com.example.app${i}`));
});

test('list omits next link at the end of the capped range', async () => {
  fake.list = async (opts) => Array.from({ length: opts.num }, (_, i) => makeApp(`com.example.app${i}`));
  const { status, body } = await get('/api/apps/?num=10&start=195');
  assert.equal(status, 200);
  assert.equal(body.results.length, 5); // only 200 - 195 apps remain
  assert.ok(body.prev);
  assert.equal(body.next, undefined);
  fake.list = async (opts) => Array.from({ length: opts.num || 60 }, (_, i) => makeApp(`com.example.app${i}`));
});

test('list omits prev link on the first page', async () => {
  const { status, body } = await get('/api/apps/?num=10&start=0');
  assert.equal(status, 200);
  assert.equal(body.prev, undefined);
  assert.ok(body.next);
});

// ─── /apps/:appId ────────────────────────────────────────────────────────────

test('app detail returns cleaned app object', async () => {
  const { status, body } = await get('/api/apps/com.example.app');
  assert.equal(status, 200);
  assert.equal(body.appId, 'com.example.app');
  assert.equal(body.playstoreUrl, 'https://play.google.com/store/apps/details?id=com.example.app');
  assert.match(body.url, /\/api\/apps\/com\.example\.app$/);
  assert.equal(body.developer.devId, 'Example Dev');
  assert.match(body.developer.url, /\/api\/developers\/Example%20Dev$/);
});

test('app detail maps "not found" scraper errors to 404', async () => {
  fake.app = async () => { throw new Error('App not found (404)'); };
  const { status, body } = await get('/api/apps/com.missing.app');
  assert.equal(status, 404);
  assert.equal(body.error, 'Not Found');
  assert.match(body.message, /not found/i);
  fake.app = async () => makeApp();
});

test('app detail returns 502 on upstream schema drift', async () => {
  fake.app = async () => ({ unexpected: 'shape' });
  const { status, body } = await get('/api/apps/com.example.app');
  assert.equal(status, 502);
  assert.equal(body.error, 'Internal Server Error');
  fake.app = async () => makeApp();
});

test('similar maps generic scraper failures to 500', async () => {
  fake.similar = async () => { throw new Error('boom'); };
  const { status, body } = await get('/api/apps/com.example.app/similar');
  assert.equal(status, 500);
  assert.equal(body.error, 'Internal Server Error');
  fake.similar = async () => [makeApp('com.example.similar')];
});

test('similar returns cleaned list', async () => {
  const { status, body } = await get('/api/apps/com.example.app/similar');
  assert.equal(status, 200);
  assert.equal(body.results[0].appId, 'com.example.similar');
});

// ─── /apps/:appId/datasafety ─────────────────────────────────────────────────

test('datasafety returns scraper payload inside results wrapper', async () => {
  const { status, body } = await get('/api/apps/com.example.app/datasafety');
  assert.equal(status, 200);
  assert.deepEqual(body.results.sharedData, []);
  assert.equal(body.results.collectedData[0].data, 'Location');
  assert.equal(body.results.privacyPolicyUrl, 'https://example.com/privacy');
});

// ─── /apps/:appId/permissions ────────────────────────────────────────────────

test('permissions maps numeric type indexes to category names', async () => {
  const { status, body } = await get('/api/apps/com.example.app/permissions');
  assert.equal(status, 200);
  assert.equal(body.results[0].type, 'Device & app history');
  assert.equal(body.results[1].type, 'Other');
  assert.equal(body.results[2].type, '7'); // unknown index falls back to string
});

// ─── /apps/:appId/reviews ────────────────────────────────────────────────────

test('reviews default: strips user data and replies, truncates date', async () => {
  const { status, body } = await get('/api/apps/com.example.app/reviews');
  assert.equal(status, 200);
  const review = body.results.data[0];
  assert.equal(review.date, '2026-01-02');
  assert.equal('userName' in review, false);
  assert.equal('userImage' in review, false);
  assert.equal('replyText' in review, false);
  assert.equal('replyDate' in review, false);
  // public `url` is part of the contract; only the internal `_url` is stripped
  assert.equal(review.url, 'https://play.google.com/store/review/r1');
  assert.equal('_url' in review, false);
  assert.equal(body.results.nextPaginationToken, '');
});

test('reviews with replies=true redacts user name from reply text', async () => {
  const { status, body } = await get('/api/apps/com.example.app/reviews?replies=true');
  assert.equal(status, 200);
  const review = body.results.data[0];
  assert.equal(review.replyText, 'Thanks [REDACTED_USER] [REDACTED_USER] for the review');
  assert.equal(review.replyDate, '2026-01-03T00:00:00Z');
});

test('reviews with userdata=true keeps user fields, drops reply internals', async () => {
  const { status, body } = await get('/api/apps/com.example.app/reviews?userdata=true');
  assert.equal(status, 200);
  const review = body.results.data[0];
  assert.equal(review.userName, 'John Doe');
  assert.equal(review.replyText, 'Thanks John Doe for the review');
  assert.equal('_replyText' in review, false);
  assert.equal('_replyDate' in review, false);
  assert.equal('_url' in review, false);
});

test('reviews with userdata=true&replies=true keeps everything but _url', async () => {
  const { status, body } = await get('/api/apps/com.example.app/reviews?userdata=true&replies=true');
  assert.equal(status, 200);
  const review = body.results.data[0];
  assert.equal(review.userName, 'John Doe');
  assert.equal(review.replyText, 'Thanks John Doe for the review');
  assert.equal(review.url, 'https://play.google.com/store/review/r1');
  assert.equal('_url' in review, false);
});

test('reviews maps sort names to scraper sort constants', async () => {
  const captured = [];
  fake.reviews = async (opts) => { captured.push(opts.sort); return { data: [makeReview()], nextPaginationToken: null }; };
  // Distinct appIds so C1 response-cache keys differ (newest == default sort
  // would otherwise be one identical upstream call served twice from cache).
  await get('/api/apps/com.example.app/reviews?sort=helpful');
  await get('/api/apps/com.example.app2/reviews?sort=rated');
  await get('/api/apps/com.example.app3/reviews?sort=newest');
  await get('/api/apps/com.example.app4/reviews');
  assert.deepEqual(captured, [SORT_HELPFUL, SORT_RATED, SORT_NEWEST, SORT_NEWEST]);
  fake.reviews = async () => ({ data: [makeReview()], nextPaginationToken: null });
});

test('reviews rejects invalid sort and out-of-range num', async () => {
  assert.equal((await get('/api/apps/com.example.app/reviews?sort=bogus')).status, 400);
  assert.equal((await get('/api/apps/com.example.app/reviews?num=0')).status, 400);
  assert.equal((await get('/api/apps/com.example.app/reviews?userdata=yes')).status, 400);
});

// ─── /developers/ ────────────────────────────────────────────────────────────

test('developer apps returns devId plus cleaned apps', async () => {
  const { status, body } = await get('/api/developers/Example%20Dev/');
  assert.equal(status, 200);
  assert.equal(body.devId, 'Example Dev');
  assert.equal(body.apps[0].appId, 'com.example.app');
  assert.match(body.apps[0].url, /\/api\/apps\/com\.example\.app$/);
});

test('developer list without devId returns 400 with example URL', async () => {
  const { status, body } = await get('/api/developers/');
  assert.equal(status, 400);
  assert.match(body.message, /developer id/i);
  assert.match(body.example, /\/api\/developers\/Wikimedia%20Foundation$/);
});

// ─── /lists/ ─────────────────────────────────────────────────────────────────

test('lists requires category and collection', async () => {
  const missing = await get('/api/lists/');
  assert.equal(missing.status, 400);
  assert.ok(missing.body.messages.some((m) => /category/.test(m)));
  assert.ok(missing.body.messages.some((m) => /collection/.test(m)));
});

test('lists forwards category/collection to scraper list()', async () => {
  let captured;
  fake.list = async (opts) => { captured = opts; return [makeApp()]; };
  const { status, body } = await get('/api/lists/?category=GAME&collection=TOP_SELLING&num=5');
  assert.equal(status, 200);
  assert.equal(captured.category, 'GAME');
  assert.equal(captured.collection, 'TOP_SELLING');
  assert.equal(captured.num, 5);
  assert.equal(body.results.length, 1);
  fake.list = async (opts) => Array.from({ length: opts.num || 60 }, (_, i) => makeApp(`com.example.app${i}`));
});
test('lists paginates with start/num slicing and prev/next links', async () => {
  let captured;
  fake.list = async (opts) => { captured = opts; return Array.from({ length: opts.num }, (_, i) => makeApp(`com.example.app${i}`)); };
  const { status, body } = await get('/api/lists/?category=GAME&collection=TOP_SELLING&num=10&start=20');
  assert.equal(status, 200);
  assert.equal(captured.num, 30); // fetches start + num, no native offset
  assert.equal(body.results.length, 10);
  assert.equal(body.results[0].appId, 'com.example.app20');
  assert.match(body.prev, /start=10/);
  assert.match(body.next, /start=30/);
  fake.list = async (opts) => Array.from({ length: opts.num || 60 }, (_, i) => makeApp(`com.example.app${i}`));
});

test('lists omits next link at the end of the capped range', async () => {
  fake.list = async (opts) => Array.from({ length: opts.num }, (_, i) => makeApp(`com.example.app${i}`));
  const { status, body } = await get('/api/lists/?category=GAME&collection=TOP_SELLING&num=10&start=195');
  assert.equal(status, 200);
  assert.equal(body.results.length, 5); // only 200 - 195 apps remain
  assert.ok(body.prev);
  assert.equal(body.next, undefined);
  fake.list = async (opts) => Array.from({ length: opts.num || 60 }, (_, i) => makeApp(`com.example.app${i}`));
});

test('app list omits next link when a full last page reaches exactly 200', async () => {
  fake.list = async (opts) => Array.from({ length: opts.num }, (_, i) => makeApp(`com.example.app${i}`));
  const { status, body } = await get('/api/apps/?num=10&start=190');
  assert.equal(status, 200);
  assert.equal(body.results.length, 10);
  assert.match(body.prev, /start=180/);
  assert.equal(body.next, undefined); // start=200 would be an empty page
  fake.list = async (opts) => Array.from({ length: opts.num || 60 }, (_, i) => makeApp(`com.example.app${i}`));
});

// ─── /categories/ and /collections/ ──────────────────────────────────────────

test('categories returns scraper category keys', async () => {
  const { status, body } = await get('/api/categories/');
  assert.equal(status, 200);
  assert.deepEqual(body, ['GAME', 'FINANCE']);
});

test('collections returns scraper collection keys', async () => {
  const { status, body } = await get('/api/collections/');
  assert.equal(status, 200);
  assert.deepEqual(body, ['TOP_SELLING', 'TOP_GROSSING']);
});

// ─── B1: batch app details on POST /apps/batch ──────────────────────────────

test('batch returns one settled entry per appId, in order', async () => {
  const { status, body } = await post('/api/apps/batch', { appIds: ['com.example.one', 'com.example.two', 'com.example.missing'] });
  assert.equal(status, 200);
  assert.equal(body.results.length, 3);
  assert.deepEqual(body.results.map((r) => r.appId), ['com.example.one', 'com.example.two', 'com.example.missing']);
  assert.equal(body.results[0].status, 'fulfilled');
  assert.equal(body.results[0].app.appId, 'com.example.one');
  assert.equal(body.results[2].status, 'rejected');
  assert.equal(body.results[2].app, undefined);
  assert.equal(body.results[2].error, 'App not found (404)');
});

test('batch forwards country/lang/concurrency to scraper', async () => {
  let captured;
  const original = fake.apps;
  fake.apps = async (opts) => { captured = opts; return original(opts); };
  const { status } = await post('/api/apps/batch?country=US&lang=en', { appIds: ['com.example.app'], concurrency: 4 });
  assert.equal(status, 200);
  assert.deepEqual(captured.appIds, ['com.example.app']);
  assert.equal(captured.country, 'US');
  assert.equal(captured.lang, 'en');
  assert.equal(captured.concurrency, 4);
  fake.apps = original;
});

test('batch rejects a missing appIds array', async () => {
  const { status, body } = await post('/api/apps/batch', {});
  assert.equal(status, 400);
  assert.equal(body.error, 'Validation failed');
});

test('batch rejects a non-array appIds', async () => {
  const { status, body } = await post('/api/apps/batch', { appIds: 'com.example.app' });
  assert.equal(status, 400);
  assert.match(body.messages[0], /appIds must be an array/);
});

test('batch rejects an empty appIds array', async () => {
  const { status, body } = await post('/api/apps/batch', { appIds: [] });
  assert.equal(status, 400);
  assert.match(body.messages[0], /at least one/);
});

test('batch rejects more than 20 appIds', async () => {
  const appIds = Array.from({ length: 21 }, (_, i) => `com.example.app${i}`);
  const { status, body } = await post('/api/apps/batch', { appIds });
  assert.equal(status, 400);
  assert.match(body.messages[0], /at most 20/);
});

test('batch rejects invalid concurrency', async () => {
  const { status, body } = await post('/api/apps/batch', { appIds: ['com.example.app'], concurrency: 21 });
  assert.equal(status, 400);
  assert.match(body.messages[0], /concurrency/);
});

test('batch rejects invalid fields with problem+json on /v2', async () => {
  const { status, headers, body } = await post('/v2/apps/batch?fields=bogus', { appIds: ['com.example.app'] });
  assert.equal(status, 400);
  assert.match(headers.get('content-type'), /application\/problem\+json/);
  assert.match(body.detail, /unknown field/i);
});

test('batch applies fields projection to fulfilled apps only', async () => {
  const { status, body } = await post('/api/apps/batch?fields=appId,title', { appIds: ['com.example.app', 'com.example.missing'] });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body.results[0].app).sort(), ['appId', 'title']);
  assert.equal(body.results[1].status, 'rejected');
});

test('batch rejects malformed JSON body', async () => {
  const res = await fetch(base + '/api/apps/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
});

// ─── B5: GET /suggest promotion ─────────────────────────────────────────────

test('suggest returns terms with search URLs', async () => {
  const { status, body } = await get('/api/suggest?q=spot');
  assert.equal(status, 200);
  assert.equal(body.results.length, 2);
  assert.equal(body.results[0].term, 'game');
  assert.match(body.results[0].url, /\/apps\/\?q=game/);
});

test('suggest rejects a missing q with problem+json on /v2', async () => {
  const { status, headers, body } = await get('/v2/suggest');
  assert.equal(status, 400);
  assert.match(headers.get('content-type'), /application\/problem\+json/);
  assert.match(body.detail, /q is required/);
});

test('suggest rejects an empty q', async () => {
  const { status, body } = await get('/api/suggest?q=');
  assert.equal(status, 400);
  assert.equal(body.error, 'Validation failed');
  assert.match(body.messages[0], /q must be a non-empty string|q is required/);
});

test('legacy /apps/?suggest= works and sets Deprecation header on v1 only', async () => {
  const v1 = await get('/api/apps/?suggest=spot');
  assert.equal(v1.status, 200);
  assert.equal(v1.body.results[0].term, 'game');
  assert.equal(v1.headers.get('deprecation'), 'true');
  assert.match(v1.headers.get('link') || '', /rel="alternate"/);

  const v2 = await get('/v2/apps/?suggest=spot');
  assert.equal(v2.status, 200);
  assert.equal(v2.headers.get('deprecation'), null);
});

// ─── B2: country availability on /apps/:appId/availability ──────────────────

test('availability forwards appId and parsed country codes to scraper', async () => {
  let captured;
  const originalAvailability = fake.availability;
  fake.availability = async (opts) => { captured = opts; return { appId: opts.appId, countries: { US: { status: 'available' } } }; };
  const { status } = await get('/api/apps/com.example.app/availability?countries=in, us ,GB');
  assert.equal(status, 200);
  assert.equal(captured.appId, 'com.example.app');
  assert.deepEqual(captured.countries, ['IN', 'US', 'GB']);
  fake.availability = originalAvailability;
});

test('availability maps statuses to available booleans and keeps error messages', async () => {
  const { status, body } = await get('/api/apps/com.example.app/availability?countries=IN,US,DE');
  assert.equal(status, 200);
  assert.equal(body.appId, 'com.example.app');
  assert.deepEqual(body.countries.IN, { available: true, status: 'available' });
  assert.deepEqual(body.countries.US, { available: false, status: 'unavailable' });
  assert.equal(body.countries.DE.available, false);
  assert.equal(body.countries.DE.status, 'error');
  assert.equal(body.countries.DE.message, 'storefront fetch failed');
});

test('availability rejects invalid country codes (v1 shape)', async () => {
  const { status, body } = await get('/api/apps/com.example.app/availability?countries=IN,USA');
  assert.equal(status, 400);
  assert.equal(body.error, 'Validation failed');
  assert.match(body.messages[0], /USA/);
});

test('availability rejects invalid country codes with problem+json on /v2', async () => {
  const { status, headers, body } = await get('/v2/apps/com.example.app/availability?countries=ZZZ');
  assert.equal(status, 400);
  assert.match(headers.get('content-type'), /application\/problem\+json/);
  assert.equal(body.status, 400);
  assert.match(body.detail, /ZZZ/);
});

test('availability requires the countries parameter', async () => {
  const { status, body } = await get('/api/apps/com.example.app/availability');
  assert.equal(status, 400);
  assert.match(body.messages[0], /countries/);
});

test('availability rejects an empty countries list', async () => {
  const { status, body } = await get('/api/apps/com.example.app/availability?countries=,,');
  assert.equal(status, 400);
  assert.match(body.messages[0], /at least one/);
});

test('availability rejects more than 30 countries', async () => {
  const many = Array.from({ length: 31 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26))).join(',');
  const { status, body } = await get(`/api/apps/com.example.app/availability?countries=${many}`);
  assert.equal(status, 400);
  assert.match(body.messages[0], /at most 30/);
});

// ─── error handler on /v2 ────────────────────────────────────────────────────

test('v2 error handler emits problem+json', async () => {
  fake.app = async () => { throw new Error('App not found (404)'); };
  const { status, headers, body } = await get('/v2/apps/com.missing.app');
  assert.equal(status, 404);
  assert.match(headers.get('content-type'), /application\/problem\+json/);
  assert.equal(body.title, 'Not Found');
  assert.equal(body.status, 404);
  assert.ok(body.instance.endsWith('/v2/apps/com.missing.app'));
  fake.app = async () => makeApp();
});

// ─── B8: field selection on /apps/:appId ────────────────────────────────────

test('fields projection returns only requested fields', async () => {
  const { status, body } = await get('/api/apps/com.example.app?fields=title,score');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['score', 'title']);
  assert.equal(body.title, 'Example App');
  assert.equal(body.score, 4.5);
});

test('fields projection works on /v2', async () => {
  const { status, body } = await get('/v2/apps/com.example.app?fields=appId,title');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['appId', 'title']);
});

test('fields projection is order-preserving', async () => {
  const { body } = await get('/api/apps/com.example.app?fields=score,developer,title');
  assert.deepEqual(Object.keys(body), ['score', 'developer', 'title']);
});

test('unknown field returns 400 with valid field list (v1)', async () => {
  const { status, body } = await get('/api/apps/com.example.app?fields=title,nope');
  assert.equal(status, 400);
  assert.equal(body.error, 'Validation failed');
  assert.match(body.messages[0], /nope/);
  assert.match(body.messages[0], /valid fields/i);
});

test('unknown field returns problem+json on /v2', async () => {
  const { status, headers, body } = await get('/v2/apps/com.example.app?fields=bogus');
  assert.equal(status, 400);
  assert.match(headers.get('content-type'), /application\/problem\+json/);
  assert.match(body.detail, /bogus/);
});

test('whitespace and duplicates in fields are tolerated', async () => {
  const { status, body } = await get('/api/apps/com.example.app?fields=%20title%20,,title,score');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['score', 'title']);
});

test('empty fields value is rejected', async () => {
  const { status } = await get('/api/apps/com.example.app?fields=');
  assert.equal(status, 400);
});

// ─── C2: request coalescing through the router ───────────────────────────────

test('C2: concurrent identical app requests trigger one scraper call', async () => {
  let calls = 0;
  fake.app = () => new Promise((resolve) => {
    calls += 1;
    setTimeout(() => resolve(makeApp()), 30);
  });
  const [r1, r2, r3] = await Promise.all([
    get('/v2/apps/com.example.coalesce'),
    get('/v2/apps/com.example.coalesce'),
    get('/v2/apps/com.example.coalesce')
  ]);
  assert.equal(calls, 1);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.appId, 'com.example.app');
  assert.equal(r1.headers.get('x-cache'), 'MISS');
  assert.equal(r2.headers.get('x-cache'), 'MISS');
  assert.equal(r3.headers.get('x-cache'), 'MISS');
  fake.app = async () => makeApp();
});

test('C2: joined flight responses carry distinct cloned bodies', async () => {
  let calls = 0;
  fake.app = () => new Promise((resolve) => {
    calls += 1;
    setTimeout(() => resolve(makeApp()), 30);
  });
  const [a, b] = await Promise.all([
    get('/v2/apps/com.example.clonecheck'),
    get('/v2/apps/com.example.clonecheck')
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(a.body, b.body);
  assert.notEqual(a.body, b.body);
  fake.app = async () => makeApp();
});

// ─── C8: upstream timeout budget ─────────────────────────────────────────────

test('C8: slow upstream returns 504 problem+json with Retry-After on /v2', async () => {
  fake.app = () => new Promise(() => {}); // never resolves
  const { status, headers, body } = await get('/v2/apps/com.example.app');
  assert.equal(status, 504);
  assert.equal(headers.get('content-type').split(';')[0], 'application/problem+json');
  assert.equal(headers.get('retry-after'), String(resilienceConfig.timeoutRetryAfterSeconds));
  assert.equal(body.status, 504);
  assert.ok(body.type.endsWith('/problems/upstream-timeout'));
  fake.app = async () => makeApp();
});

test('C8: slow upstream returns 504 legacy shape on /api', async () => {
  fake.app = () => new Promise(() => {});
  const { status, headers, body } = await get('/api/apps/com.example.app');
  assert.equal(status, 504);
  assert.equal(headers.get('retry-after'), String(resilienceConfig.timeoutRetryAfterSeconds));
  assert.equal(body.error, 'Gateway Timeout');
  fake.app = async () => makeApp();
});

// ─── C1: response cache ──────────────────────────────────────────────────────

test('C1: second identical request within TTL is served from cache (X-Cache: HIT, one upstream call)', async () => {
  let calls = 0;
  fake.app = async () => { calls += 1; return makeApp(); };
  const first = await get('/v2/apps/com.example.cache?country=IN');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-cache'), 'MISS');
  const second = await get('/v2/apps/com.example.cache?country=IN');
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('x-cache'), 'HIT');
  assert.deepEqual(second.body, first.body);
  assert.equal(calls, 1);
  // Different country => different cache key => upstream called again.
  await get('/v2/apps/com.example.cache?country=US');
  assert.equal(calls, 2);
  fake.app = async () => makeApp();
});
