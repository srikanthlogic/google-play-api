'use strict';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.RETRY_MAX_ATTEMPTS = '3';
process.env.RETRY_BASE_DELAY_MS = '100';
process.env.RETRY_MAX_DELAY_MS = '400';

const { retryConfig, retryCall, backoffDelay } =
  await import('../lib/retry.js');

const boom = (status) =>
  Object.assign(new Error(`upstream ${status}`), { statusCode: status });

beforeEach(() => {
  retryConfig.disabled = false;
});

test('returns immediately when the first attempt succeeds', async () => {
  let calls = 0;
  const sleeps = [];
  const value = await retryCall(() => {
    calls++;
    return Promise.resolve({ ok: true });
  }, { sleep: (ms) => sleeps.push(ms) });
  assert.deepEqual(value, { ok: true });
  assert.equal(calls, 1);
  assert.equal(sleeps.length, 0);
});

test('retries an upstream 5xx failure and returns the eventual success', async () => {
  let calls = 0;
  const sleeps = [];
  const value = await retryCall(() => {
    calls++;
    return calls < 2 ? Promise.reject(boom(503)) : Promise.resolve({ n: calls });
  }, { sleep: (ms) => sleeps.push(ms), rand: () => 0.5 });
  assert.deepEqual(value, { n: 2 });
  assert.equal(calls, 2);
  assert.equal(sleeps.length, 1);
});

test('does not retry client-error (4xx-class) responses', async () => {
  let calls = 0;
  await assert.rejects(
    () => retryCall(() => {
      calls++;
      return Promise.reject(boom(404));
    }, { sleep: () => assert.fail('must not sleep') }),
    /upstream 404/
  );
  assert.equal(calls, 1);
});

test('gives up after max attempts and throws the last error', async () => {
  let calls = 0;
  await assert.rejects(
    () => retryCall(() => {
      calls++;
      return Promise.reject(boom(502));
    }, { sleep: () => {}, rand: () => 0 }),
    /upstream 502/
  );
  assert.equal(calls, 3);
});

test('backoff grows exponentially and never exceeds the cap', () => {
  const delays = [0, 1, 2, 3].map((n) => backoffDelay(n, () => 1));
  // rand=1 → delay == cap of that round
  assert.equal(delays[0], 100);
  assert.equal(delays[1], 200);
  assert.equal(delays[2], 400);
  assert.equal(delays[3], 400); // capped at RETRY_MAX_DELAY_MS
});

test('full jitter keeps delays within [0, cap)', () => {
  for (let i = 0; i < 20; i++) {
    const d = backoffDelay(2);
    assert.ok(d >= 0 && d <= 400, `delay ${d} out of range`);
  }
});

test('RETRY_DISABLED=true makes exactly one attempt regardless of failures', async () => {
  retryConfig.disabled = true;
  let calls = 0;
  await assert.rejects(
    () => retryCall(() => {
      calls++;
      return Promise.reject(boom(503));
    }),
    /upstream 503/
  );
  assert.equal(calls, 1);
});
