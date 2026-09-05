'use strict';

import { test, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Express from 'express';
import { DEFAULT_COUNTRY, DEFAULT_LANG, SORT_HELPFUL, SORT_NEWEST } from '../lib/constants.js';
import { resetCache } from '../lib/cache.js';
import { encodeToken } from '../lib/iterators.js';

// Silence pino-pretty transport in the logger under test
process.env.NODE_ENV = 'production';

// C8: keep the upstream timeout budget tiny so the timeout test runs fast.
// RETRY_DISABLED keeps the 504 path single-attempt for the same reason.
// Both are read at import time by lib/resilience.js + lib/retry.js.
process.env.UPSTREAM_TIMEOUT_MS = '150';
process.env.RETRY_DISABLED = 'true';

// C1: reset the response cache between tests so scraper fakes swapped in
// by individual tests are actually exercised.
beforeEach(() => {
  resetCache();
  process.env.HISTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gql-'));
});

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
  searchIterator: async function * () {
    for (let i = 0; i < 5; i++) yield makeApp(`com.example.search${i}`);
  },
  developerIterator: async function * () {
    yield makeApp('com.example.devapp0');
    yield makeApp('com.example.devapp1');
  },
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

const { default: graphqlEndpoint } = await import('../lib/graphql/index.js');

// ─── Test server ─────────────────────────────────────────────────────────────

const app = Express();
app.use(Express.json());
app.all('/v2/graphql', graphqlEndpoint);

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const gql = async (query, variables) => {
  const res = await fetch(base + '/v2/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, headers: res.headers, body };
};

// ─── app ─────────────────────────────────────────────────────────────────────

test('app returns the app shape with v2 REST deep links', async () => {
  const { status, body } = await gql('{ app(appId: "com.example.app") { appId title url developer { devId } } }');
  assert.equal(status, 200);
  assert.equal(body.errors, undefined);
  assert.equal(body.data.app.appId, 'com.example.app');
  assert.equal(body.data.app.title, 'Example App');
  assert.ok(body.data.app.url.endsWith('/v2/apps/com.example.app'), `unexpected url: ${body.data.app.url}`);
  assert.equal(body.data.app.developer.devId, 'Example Dev');
});

test('app defaults country/lang from single source of truth', async () => {
  let captured;
  fake.app = async (opts) => { captured = opts; return makeApp(); };
  await gql('{ app(appId: "com.example.app") { appId } }');
  assert.equal(captured.country, DEFAULT_COUNTRY);
  assert.equal(captured.lang, DEFAULT_LANG);
  fake.app = async () => makeApp();
});

test('app normalizes country casing and lang casing', async () => {
  let captured;
  fake.app = async (opts) => { captured = opts; return makeApp(); };
  await gql('{ app(appId: "com.example.app", country: "us", lang: "EN") { appId } }');
  assert.equal(captured.country, 'US');
  assert.equal(captured.lang, 'en');
  fake.app = async () => makeApp();
});

test('app rejects an invalid country with the REST error taxonomy', async () => {
  const { status, body } = await gql('{ app(appId: "com.example.app", country: "USA") { appId } }');
  assert.equal(status, 200, 'GraphQL-over-HTTP answers 200 with errors in the body');
  assert.equal(body.data, null);
  const error = body.errors[0];
  assert.equal(error.extensions.httpStatus, 400);
  assert.equal(error.extensions.code, 'VALIDATION_ERROR');
  assert.match(error.message, /ISO 3166-1 alpha-2/);
});

test('app maps upstream 404 to extensions.httpStatus 404', async () => {
  fake.app = async () => { throw new Error('App not found (404)'); };
  const { body } = await gql('{ app(appId: "com.example.missing") { appId } }');
  const error = body.errors[0];
  assert.equal(error.extensions.httpStatus, 404);
  assert.equal(error.extensions.type, 'https://api.google-play-api.dev/problems/not-found');
  fake.app = async () => makeApp();
});

test('app redacts 5xx messages like the REST surface', async () => {
  fake.app = async () => { throw new Error('secret internal detail'); };
  const { body } = await gql('{ app(appId: "com.example.app") { appId } }');
  const error = body.errors[0];
  assert.equal(error.extensions.httpStatus, 500);
  assert.equal(error.message, 'The request could not be completed.');
  fake.app = async () => makeApp();
});

test('app maps an upstream timeout to 504 with retryAfter', async () => {
  fake.app = async () => new Promise(() => {});
  const { body } = await gql('{ app(appId: "com.example.app") { appId } }');
  const error = body.errors[0];
  assert.equal(error.extensions.httpStatus, 504);
  assert.ok(error.extensions.retryAfter > 0);
  fake.app = async () => makeApp();
});

// ─── apps (batch union) ──────────────────────────────────────────────────────

test('apps returns settled results as a union', async () => {
  const { status, body } = await gql(`
    {
      apps(ids: ["com.example.app", "com.example.missing"]) {
        __typename
        ... on AppOk { appId app { appId title } }
        ... on AppError { appId error }
      }
    }
  `);
  assert.equal(status, 200);
  assert.equal(body.errors, undefined);
  const [ok, failed] = body.data.apps;
  assert.equal(ok.__typename, 'AppOk');
  assert.equal(ok.appId, 'com.example.app');
  assert.equal(ok.app.title, 'Example App');
  assert.equal(failed.__typename, 'AppError');
  assert.equal(failed.error, 'App not found (404)');
});

test('apps rejects more than the batch cap', async () => {
  const ids = Array.from({ length: 21 }, (_, i) => `com.example.app${i}`);
  const { body } = await gql('query ($ids: [ID!]!) { apps(ids: $ids) { __typename } }', { ids });
  assert.equal(body.errors[0].extensions.httpStatus, 400);
  assert.match(body.errors[0].message, /at most 20/);
});

// ─── search (cursor iteration) ───────────────────────────────────────────────

test('search walks the iterator with opaque cursors', async () => {
  const first = await gql('{ search(term: "games", pageSize: 2) { results { appId } nextToken } }');
  assert.equal(first.status, 200);
  assert.equal(first.body.errors, undefined);
  assert.equal(first.body.data.search.results.length, 2);
  assert.ok(first.body.data.search.nextToken);

  const second = await gql(
    'query ($c: String) { search(term: "games", pageSize: 2, cursor: $c) { results { appId } nextToken } }',
    { c: first.body.data.search.nextToken }
  );
  assert.equal(second.body.data.search.results.length, 2);

  const third = await gql(
    'query ($c: String) { search(term: "games", pageSize: 2, cursor: $c) { results { appId } nextToken } }',
    { c: second.body.data.search.nextToken }
  );
  assert.equal(third.body.data.search.results.length, 1);
  assert.equal(third.body.data.search.nextToken, null);
});

test('search rejects a cursor issued for another query', async () => {
  const foreign = encodeToken({ kind: 'search', term: 'other query', o: 2 });
  const { body } = await gql(
    'query ($c: String) { search(term: "games", cursor: $c) { results { appId } } }',
    { c: foreign }
  );
  assert.equal(body.errors[0].extensions.httpStatus, 400);
  assert.match(body.errors[0].message, /different query/);
});

// ─── list ────────────────────────────────────────────────────────────────────

test('list defaults to the full 200-item cap and validates the shape', async () => {
  const { body } = await gql('{ list(collection: "TOP_SELLING") { appId } }');
  assert.equal(body.errors, undefined);
  assert.equal(body.data.list.length, 200);
  assert.equal(body.data.list[0].appId, 'com.example.app0');
  assert.equal(body.data.list[199].appId, 'com.example.app199');
});

test('list forwards num/start as fetch-and-slice bounds', async () => {
  let captured;
  fake.list = async (opts) => {
    captured = opts;
    return Array.from({ length: opts.num }, (_, i) => makeApp(`com.example.app${i}`));
  };
  const { body } = await gql('{ list(collection: "TOP_SELLING", num: 5, start: 10) { appId } }');
  assert.equal(body.errors, undefined);
  assert.equal(body.data.list.length, 5);
  assert.equal(captured.num, 15, 'fetches start + num within the 200 cap');
  fake.list = async (opts) => Array.from({ length: opts.num || 60 }, (_, i) => makeApp(`com.example.app${i}`));
});

// ─── similar / developer / developerApps ─────────────────────────────────────

test('similar returns the app list', async () => {
  const { body } = await gql('{ similar(appId: "com.example.app") { appId title } }');
  assert.equal(body.errors, undefined);
  assert.equal(body.data.similar[0].appId, 'com.example.similar');
});

test('developer returns the devId/apps shape', async () => {
  const { body } = await gql('{ developer(devId: "Example Dev") { devId apps { appId } } }');
  assert.equal(body.errors, undefined);
  assert.equal(body.data.developer.devId, 'Example Dev');
  assert.equal(body.data.developer.apps[0].appId, 'com.example.app');
});

test('developerApps pages the developer iterator', async () => {
  const { body } = await gql('{ developerApps(devId: "Example Dev") { results { appId } nextToken } }');
  assert.equal(body.errors, undefined);
  assert.equal(body.data.developerApps.results.length, 2);
  assert.equal(body.data.developerApps.nextToken, null);
});

// ─── suggest / dataSafety / permissions / availability ──────────────────────

test('suggest returns terms with absolute REST urls', async () => {
  const { body } = await gql('{ suggest(term: "gam") { term url } }');
  assert.equal(body.errors, undefined);
  assert.deepEqual(body.data.suggest.map((item) => item.term), ['game', 'games']);
  assert.ok(body.data.suggest[0].url.includes('/v2/apps/?q=game'));
});

test('dataSafety returns the report object', async () => {
  const { body } = await gql('{ dataSafety(appId: "com.example.app") { privacyPolicyUrl collectedData { data type } } }');
  assert.equal(body.errors, undefined);
  assert.equal(body.data.dataSafety.privacyPolicyUrl, 'https://example.com/privacy');
  assert.equal(body.data.dataSafety.collectedData[0].data, 'Location');
});

test('permissions maps numeric type to the group name', async () => {
  const { body } = await gql('{ permissions(appId: "com.example.app") { type permissions } }');
  assert.equal(body.errors, undefined);
  assert.deepEqual(body.data.permissions.map((p) => p.type), ['Device & app history', 'Other', '7']);
});

test('permissions rejects a non-list upstream payload', async () => {
  fake.permissions = async () => ({ 'Device & app history': ['Read device history'] });
  const { body } = await gql('{ permissions(appId: "com.example.app") { type } }');
  assert.equal(body.errors[0].extensions.httpStatus, 502);
  fake.permissions = async () => [
    { type: 0, permissions: ['Read device history'] }
  ];
});

test('availability reshapes the country record into a list', async () => {
  const { body } = await gql('{ availability(appId: "com.example.app", countries: ["us", "de", "in"]) { appId countries { countryCode available status message } } }');
  assert.equal(body.errors, undefined);
  const byCode = Object.fromEntries(body.data.availability.countries.map((entry) => [entry.countryCode, entry]));
  assert.deepEqual(byCode.US, { countryCode: 'US', available: true, status: 'available', message: null });
  assert.equal(byCode.DE.available, false);
  assert.equal(byCode.IN.message, 'storefront fetch failed');
});

test('availability caps the country fan-out', async () => {
  const first = 'ABCDE';
  const second = 'XYZPQRS';
  const codes = Array.from({ length: 31 }, (_, i) => first[Math.floor(i / 7)] + second[i % 7]);
  const { body } = await gql('query ($c: [String!]!) { availability(appId: "com.example.app", countries: $c) { appId } }', { c: codes });
  assert.equal(body.errors[0].extensions.httpStatus, 400);
  assert.match(body.errors[0].message, /at most 30/);
});

// ─── reviews ─────────────────────────────────────────────────────────────────

test('reviews strips reviewer identity by default and trims dates', async () => {
  let captured;
  fake.reviews = async (opts) => { captured = opts; return { data: [makeReview()], nextPaginationToken: null }; };
  const { body } = await gql('{ reviews(appId: "com.example.app", replies: true) { data { id userName date text replyText thumbsUp } nextCursor } }');
  assert.equal(body.errors, undefined);
  const review = body.data.reviews.data[0];
  assert.equal(review.userName, null, 'reviewer identity is stripped by default');
  assert.equal(review.date, '2026-01-02');
  // identity stripped + replies included → the reply must not leak the name.
  // Each name part is replaced, so "John Doe" yields two redactions.
  assert.equal(review.replyText, 'Thanks [REDACTED_USER] [REDACTED_USER] for the review');
  assert.equal(body.data.reviews.nextCursor, '');
  assert.equal(captured.sort, SORT_NEWEST);
  assert.equal(captured.num, 100);
  fake.reviews = async () => ({ data: [makeReview()], nextPaginationToken: null });
});

test('reviews honors userdata, replies, sort and cursor args', async () => {
  let captured;
  fake.reviews = async (opts) => {
    captured = opts;
    return { data: [makeReview()], nextPaginationToken: 'token-2' };
  };
  const { body } = await gql(
    '{ reviews(appId: "com.example.app", sort: HELPFUL, num: 5, userdata: true, replies: true, cursor: "token-1") { data { id userName replyText } nextCursor } }'
  );
  assert.equal(body.errors, undefined);
  assert.equal(captured.sort, SORT_HELPFUL);
  assert.equal(captured.num, 5);
  assert.equal(captured.nextPaginationToken, 'token-1');
  assert.equal(body.data.reviews.data[0].userName, 'John Doe');
  // userdata=true means the reviewer name is visible anyway — REST does not
  // redact replies in that mode (redaction only masks stripped identities).
  assert.equal(body.data.reviews.data[0].replyText, 'Thanks John Doe for the review');
  assert.equal(body.data.reviews.nextCursor, 'token-2');
  fake.reviews = async () => ({ data: [makeReview()], nextPaginationToken: null });
});

// ─── categories / collections ────────────────────────────────────────────────

test('categories and collections expose the scraper enums', async () => {
  const { body } = await gql('{ categories collections }');
  assert.equal(body.errors, undefined);
  assert.deepEqual(body.data.categories, ['GAME', 'FINANCE']);
  assert.deepEqual(body.data.collections, ['TOP_SELLING', 'TOP_GROSSING']);
});

// ─── HTTP semantics ──────────────────────────────────────────────────────────

test('GraphQL validation errors come back in the errors array', async () => {
  const { status, body } = await gql('{ app(appId: "com.example.app") { noSuchField } }');
  assert.equal(status, 200);
  assert.ok(body.errors[0].message.includes('Cannot query field'));
  // Request-level validation failures are rejected before execution, so the
  // response has no data key at all (unlike field errors, which null it).
  assert.equal(body.data, undefined);
});

test('rejects queries deeper than GRAPHQL_MAX_DEPTH with HTTP 400', async () => {
  process.env.GRAPHQL_MAX_DEPTH = '2';
  try {
    const { status, body } = await gql('{ app(appId: "com.example.app") { appId developer { url } } }');
    assert.equal(status, 400);
    assert.equal(body.errors[0].extensions.code, 'GRAPHQL_MAX_DEPTH');
    assert.match(body.errors[0].message, /maximum depth of 2/);

    const shallow = await gql('{ app(appId: "com.example.app") { appId title } }');
    assert.equal(shallow.status, 200);
  } finally {
    delete process.env.GRAPHQL_MAX_DEPTH;
  }
});

test('GET with a query string executes GraphQL documents', async () => {
  const res = await fetch(base + '/v2/graphql?query=' + encodeURIComponent('{ categories }'), {
    headers: { accept: 'application/json' }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.data.categories, ['GAME', 'FINANCE']);
});

test('browsers GETting /v2/graphql receive the GraphiQL IDE', async () => {
  const res = await fetch(base + '/v2/graphql', {
    headers: { accept: 'text/html,application/xhtml+xml' }
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.ok(html.includes('GraphiQL'));
});
