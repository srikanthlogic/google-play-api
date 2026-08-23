'use strict';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeToken,
  decodeToken,
  iteratePage
} from '../lib/iterators.js';

const makeApp = (n) => ({ appId: `com.example.app${n}`, title: `App ${n}`, url: `/store/apps/details?id=com.example.app${n}` });

// Fake gplay whose searchIterator yields apps 0..N-1 one at a time.
const fakeGplay = (total, record = []) => ({
  searchIterator: function * (opts) {
    record.push(opts);
    for (let i = 0; i < total; i++) yield makeApp(i);
  },
  developerIterator: function * (opts) {
    record.push(opts);
    for (let i = 0; i < total; i++) yield makeApp(i);
  }
});

beforeEach(() => {});

test('token roundtrip preserves payload', () => {
  const token = encodeToken({ kind: 'search', term: 'vpn', o: 40 });
  assert.deepEqual(decodeToken(token), { kind: 'search', term: 'vpn', o: 40 });
});

test('decodeToken rejects garbage and wrong-kind tokens', () => {
  assert.throws(() => decodeToken('not-a-token!'));
  assert.throws(() => decodeToken(Buffer.from('{"nope":1}').toString('base64url')));
  const searchToken = encodeToken({ kind: 'search', term: 'x', o: 5 });
  assert.throws(() => decodeToken(searchToken, 'developer'));
});

test('first page returns pageSize results and a nextToken', async () => {
  const gplay = fakeGplay(50);
  const { results, nextToken } = await iteratePage(gplay, 'search', { term: 'vpn', pageSize: 10 }, null);
  assert.equal(results.length, 10);
  assert.equal(results[0].appId, 'com.example.app0');
  assert.ok(nextToken);
});

test('three pages are non-overlapping and exhaust cleanly', async () => {
  const gplay = fakeGplay(25);
  const seen = [];
  let cursor = null;
  let pages = 0;
  for (;;) {
     
    const page = await iteratePage(gplay, 'search', { term: 'vpn', pageSize: 10 }, cursor);
    seen.push(...page.results.map((a) => a.appId));
    pages++;
    cursor = page.nextToken;
    if (!cursor) break;
  }
  assert.equal(pages, 3);
  assert.equal(seen.length, 25);
  assert.equal(new Set(seen).size, 25, 'pages must not overlap');
});

test('cursor into exhausted range yields empty final page with null token', async () => {
  const gplay = fakeGplay(10);
  const first = await iteratePage(gplay, 'developer', { devId: 'dev', pageSize: 10 }, null);
  assert.equal(first.results.length, 10);
  // Exact-boundary page still issues an optimistic nextToken; following it
  // fast-forwards past everything and returns the empty final page.
  assert.ok(first.nextToken, 'boundary page must issue a nextToken');
  const beyond = await iteratePage(gplay, 'developer', { devId: 'dev', pageSize: 10 }, first.nextToken);
  assert.equal(beyond.results.length, 0);
  assert.equal(beyond.nextToken, null);
});

test('kind mismatch between cursor and endpoint is rejected', async () => {
  const gplay = fakeGplay(30);
  const searchPage = await iteratePage(gplay, 'search', { term: 'vpn', pageSize: 5 }, null);
  await assert.rejects(
    () => iteratePage(gplay, 'developer', { devId: 'dev', pageSize: 5 }, searchPage.nextToken),
    /Cursor kind/
  );
});
