'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, cleanUrls } from '../lib/urlUtils.js';

const mockReq = ({
  protocol = 'https',
  host = 'api.example.com',
  baseUrl = '/api'
} = {}) => ({
  protocol,
  baseUrl,
  get: (name) => (name.toLowerCase() === 'host' ? host : undefined)
});

test('buildUrl joins protocol, host, baseUrl and subpath', () => {
  assert.equal(buildUrl(mockReq(), 'apps/com.foo'), 'https://api.example.com/api/apps/com.foo');
});

test('buildUrl handles empty baseUrl', () => {
  assert.equal(buildUrl(mockReq({ baseUrl: '' }), 'apps/com.foo'), 'https://api.example.com/apps/com.foo');
});

test('cleanUrls rewrites app URLs to API paths and preserves other fields', () => {
  const app = {
    appId: 'com.foo',
    title: 'Foo',
    url: 'https://play.google.com/store/apps/details?id=com.foo',
    developer: 'Foo Dev & Co',
    score: 4.5
  };
  const cleaned = cleanUrls(mockReq())(app);

  assert.equal(cleaned.playstoreUrl, app.url);
  assert.equal(cleaned.url, 'https://api.example.com/api/apps/com.foo');
  assert.equal(cleaned.permissions, 'https://api.example.com/api/apps/com.foo/permissions');
  assert.equal(cleaned.similar, 'https://api.example.com/api/apps/com.foo/similar');
  assert.equal(cleaned.reviews, 'https://api.example.com/api/apps/com.foo/reviews');
  assert.equal(cleaned.datasafety, 'https://api.example.com/api/apps/com.foo/datasafety');
  assert.equal(cleaned.categories, 'https://api.example.com/api/categories/');
  assert.equal(cleaned.score, 4.5);
});

test('cleanUrls encodes developer names in URLs', () => {
  const cleaned = cleanUrls(mockReq())({ appId: 'com.foo', url: 'x', developer: 'Foo Dev & Co' });
  assert.equal(cleaned.developer.devId, 'Foo Dev & Co');
  assert.equal(cleaned.developer.url, 'https://api.example.com/api/developers/Foo%20Dev%20%26%20Co');
});
