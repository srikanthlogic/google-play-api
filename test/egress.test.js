'use strict';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  isBlockClass,
  recordAttempt,
  recordBlock,
  egressStats,
  resetEgress
} from '../lib/egress.js';

beforeEach(() => {
  resetEgress();
});

test('isBlockClass matches throttle statuses', () => {
  assert.equal(isBlockClass({ statusCode: 403 }), true);
  assert.equal(isBlockClass({ statusCode: 429 }), true);
  assert.equal(isBlockClass({ status: 429 }), true);
});

test('isBlockClass matches unusual-traffic message text', () => {
  assert.equal(
    isBlockClass(new Error('our systems have detected unusual traffic from your computer network')),
    true
  );
  assert.equal(isBlockClass(new Error('recaptcha captcha required')), true);
});

test('isBlockClass rejects unrelated errors', () => {
  assert.equal(isBlockClass(new Error('App not found')), false);
  assert.equal(isBlockClass({ statusCode: 404 }), false);
  assert.equal(isBlockClass({}), false);
  assert.equal(isBlockClass(undefined), false);
});

test('block rate math: 1 block in 4 attempts = 0.25', () => {
  recordAttempt('app');
  recordAttempt('app');
  recordAttempt('app');
  recordAttempt('app');
  recordAttempt('search');
  recordBlock('app');

  const stats = egressStats();
  assert.equal(stats.proxyEnabled, false); // no EGRESS_PROXY_URLS in tests
  assert.equal(stats.attempts, 5);
  assert.equal(stats.blocked, 1);
  assert.equal(stats.blockRate, 0.2);
  assert.deepEqual(stats.topBlockedEndpoints[0], { endpoint: 'app', count: 1, rate: 0.2 });
});

test('egressStats with zero attempts reports zero rate, not NaN', () => {
  const stats = egressStats();
  assert.equal(stats.attempts, 0);
  assert.equal(stats.blocked, 0);
  assert.equal(stats.blockRate, 0);
});
