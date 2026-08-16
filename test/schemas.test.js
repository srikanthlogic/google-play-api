'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UpstreamSchemaDriftError,
  validateApp,
  validateAppList,
  validateReviews,
  validateDataSafety,
  validatePermissions,
  validateSuggest,
  validateStringArray,
  validateDeveloperApps
} from '../lib/schemas.js';

const validApp = { appId: 'com.foo', title: 'Foo', url: 'https://play.google.com/x' };

test('validateApp accepts a minimal app and passes extra fields through', () => {
  const data = { ...validApp, score: 4.2, extra: true };
  const out = validateApp(data, '/v2/apps');
  assert.equal(out.appId, 'com.foo');
  assert.equal(out.extra, true);
});

test('validateApp throws UpstreamSchemaDriftError on missing fields', () => {
  assert.throws(
    () => validateApp({ title: 'no id' }, '/v2/apps'),
    (err) => {
      assert.ok(err instanceof UpstreamSchemaDriftError);
      assert.equal(err.name, 'UpstreamSchemaDriftError');
      assert.equal(err.code, 'UPSTREAM_SCHEMA_DRIFT');
      assert.equal(err.statusCode, 502);
      assert.ok(Array.isArray(err.issues));
      assert.ok(err.issues.length > 0);
      return true;
    }
  );
});

test('drift error issues are capped at 5', () => {
  const bad = Array.from({ length: 10 }, (_, i) => ({ [`f${i}`]: i }));
  try {
    validateAppList({ results: bad }, '/v2/apps');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof UpstreamSchemaDriftError);
    assert.ok(err.issues.length <= 5);
  }
});

test('validateAppList accepts wrapped results', () => {
  const out = validateAppList({ results: [validApp] }, '/v2/apps');
  assert.equal(out.results.length, 1);
});

test('validateAppList rejects non-array results', () => {
  assert.throws(() => validateAppList({ results: 'nope' }, '/v2/apps'), UpstreamSchemaDriftError);
});

test('validateReviews accepts data + optional pagination token', () => {
  const review = {
    id: 'r1',
    date: '2026-01-01',
    score: 5,
    title: null,
    text: 'great',
    thumbsUp: 3
  };
  const out = validateReviews({ results: { data: [review], nextPaginationToken: 'tok' } }, '/v2/reviews');
  assert.equal(out.results.data.length, 1);
  assert.equal(out.results.nextPaginationToken, 'tok');
});

test('validateReviews rejects malformed review entries', () => {
  assert.throws(
    () => validateReviews({ results: { data: [{ id: 'r1' }] } }, '/v2/reviews'),
    UpstreamSchemaDriftError
  );
});

test('validateDataSafety accepts object shape with optional arrays', () => {
  const out = validateDataSafety({ sharedData: [], collectedData: [{ data: 'Location' }] }, '/v2/datasafety');
  assert.equal(out.collectedData.length, 1);
});

test('validatePermissions accepts list wrapper with union type field', () => {
  const out = validatePermissions({ results: [{ type: 'android.permission.CAMERA' }, { type: 1 }] }, '/v2/permissions');
  assert.equal(out.results.length, 2);
});

test('validateSuggest accepts term/url items', () => {
  const out = validateSuggest({ results: [{ term: 'chess', url: 'https://x' }] }, '/v2/suggest');
  assert.equal(out.results[0].term, 'chess');
});

test('validateStringArray accepts plain string arrays', () => {
  assert.deepEqual(validateStringArray(['GAME', 'SOCIAL'], '/v2/categories'), ['GAME', 'SOCIAL']);
  assert.throws(() => validateStringArray([1, 2], '/v2/categories'), UpstreamSchemaDriftError);
});

test('validateDeveloperApps requires devId and apps array', () => {
  const out = validateDeveloperApps({ devId: 'Foo Dev', apps: [validApp] }, '/v2/developers');
  assert.equal(out.devId, 'Foo Dev');
  assert.throws(() => validateDeveloperApps({ apps: [validApp] }, '/v2/developers'), UpstreamSchemaDriftError);
});
