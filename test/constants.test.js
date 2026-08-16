'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_LIST_RESULTS,
  DEFAULT_REVIEWS_COUNT,
  MAX_REVIEWS_COUNT,
  SORT_HELPFUL,
  SORT_NEWEST,
  SORT_RATED,
  DEFAULT_COUNTRY,
  DEFAULT_LANG,
  COUNTRY_CODE_RE,
  LANG_CODE_RE
} from '../lib/constants.js';

test('pagination bounds are sane', () => {
  assert.ok(DEFAULT_PAGE_SIZE > 0);
  assert.ok(MAX_PAGE_SIZE >= DEFAULT_PAGE_SIZE);
  assert.equal(MAX_LIST_RESULTS, 200); // scraper hard cap
});

test('reviews bounds and sort values', () => {
  assert.ok(MAX_REVIEWS_COUNT >= DEFAULT_REVIEWS_COUNT);
  assert.deepEqual([SORT_HELPFUL, SORT_NEWEST, SORT_RATED], [1, 2, 3]);
});

test('country/lang defaults resolve from env or fallback', () => {
  assert.equal(typeof DEFAULT_COUNTRY, 'string');
  assert.equal(DEFAULT_COUNTRY, DEFAULT_COUNTRY.toUpperCase());
  assert.equal(DEFAULT_LANG, DEFAULT_LANG.toLowerCase());
});

test('COUNTRY_CODE_RE matches ISO 3166-1 alpha-2 only', () => {
  assert.ok(COUNTRY_CODE_RE.test('US'));
  assert.ok(COUNTRY_CODE_RE.test('IN'));
  assert.ok(!COUNTRY_CODE_RE.test('USA'));
  assert.ok(!COUNTRY_CODE_RE.test('us'));
  assert.ok(!COUNTRY_CODE_RE.test('U'));
  assert.ok(!COUNTRY_CODE_RE.test('U1'));
  assert.ok(!COUNTRY_CODE_RE.test(''));
});

test('LANG_CODE_RE matches BCP-47-ish tags', () => {
  assert.ok(LANG_CODE_RE.test('en'));
  assert.ok(LANG_CODE_RE.test('en-US'));
  assert.ok(LANG_CODE_RE.test('zh-Hans'));
  assert.ok(!LANG_CODE_RE.test('english'));
  assert.ok(!LANG_CODE_RE.test('EN'));
  assert.ok(!LANG_CODE_RE.test('e'));
  assert.ok(!LANG_CODE_RE.test(''));
});
