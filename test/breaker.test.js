'use strict';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Small TTLs so stale-fallback scenarios don't need fake timers.
process.env.CACHE_TTL_APP_MS = '30';
process.env.BREAKER_FAILURE_THRESHOLD = '3';
process.env.BREAKER_WINDOW_MS = '60000';
process.env.BREAKER_COOLDOWN_MS = '150';

const { cachedCall, cacheMiddleware, resetCache, config, cacheStats } =
  await import('../lib/cache.js');
const { breakerConfig, breakerStats, resetBreaker } =
  await import('../lib/breaker.js');

const boom = (status) =>
  Object.assign(new Error(`upstream ${status}`), { statusCode: status });

/** Reject with an upstream-class error n times using distinct keys. */
const tripBreaker = async (n, status = 503) => {
  for (let i = 0; i < n; i++) {
    await assert.rejects(
      () => cachedCall('app', [{ appId: `trip-${status}-${i}` }], () =>
        Promise.reject(boom(status))),
      () => true
    );
  }
};

beforeEach(() => {
  resetCache();
  resetBreaker();
  config.disabled = false;
  breakerConfig.disabled = false;
});

test('failures below threshold never open the circuit', async () => {
  let calls = 0;
  for (let i = 0; i < 2; i++) {
    await assert.rejects(
      () => cachedCall('app', [{ appId: `x${i}` }], () => {
        calls++;
        return Promise.reject(boom(502));
      }),
      () => true
    );
  }
  assert.equal(breakerStats().state, 'closed');
  assert.equal(calls, 2);
});

test('reaching the failure threshold opens the circuit', async () => {
  await tripBreaker(3);
  assert.equal(breakerStats().state, 'open');
});

test('client errors (4xx) do not count toward the threshold', async () => {
  await tripBreaker(5, 404);
  assert.equal(breakerStats().state, 'closed');
});

test('C4: open circuit serves expired cache entries without calling upstream', async () => {
  let calls = 0;
  const value = { appId: 'com.example.app', title: 'Example' };

  await cachedCall('app', [{ appId: 'com.example.app' }], () => {
    calls++;
    return Promise.resolve(value);
  });
  assert.equal(calls, 1);
  await new Promise((r) => setTimeout(r, 40)); // TTL was 30ms → entry expires

  await tripBreaker(3);
  assert.equal(breakerStats().state, 'open');

  const served = await cachedCall('app', [{ appId: 'com.example.app' }], () => {
    calls++;
    return Promise.resolve({ wrong: true });
  });

  assert.deepEqual(served, value); // stale copy, not the fresh fetch result
  assert.equal(calls, 1); // fetcher never invoked
  assert.ok(cacheStats.staleServes >= 1);
});

test('middleware stamps X-Data-Stale: true on degraded responses', async () => {
  let calls = 0;
  await cachedCall('app', [{ appId: 'com.stale.app' }], () =>
    Promise.resolve({ ok: true }));
  await new Promise((r) => setTimeout(r, 40));
  await tripBreaker(3);

  const resHeaders = {};
  const req = { method: 'GET', url: '/v2/apps/com.stale.app' };
  const res = {
    setHeader (k, v) { resHeaders[k] = v; },
    json (body) {
      resHeaders.body = body;
      setImmediate(resolveRun);
    }
  };
  let resolveRun;
  const done = new Promise((r) => { resolveRun = r; });

  cacheMiddleware(req, res, () => {
    cachedCall('app', [{ appId: 'com.stale.app' }], () => {
      calls++;
      return Promise.resolve({ wrong: true });
    }).then((value) => res.json(value));
  });
  await done;

  assert.equal(resHeaders['X-Data-Stale'], 'true');
  assert.deepEqual(resHeaders.body, { ok: true });
  assert.equal(calls, 0); // stale serve — fetcher never invoked
});

test('fresh (unexpired) responses do not get X-Data-Stale', async () => {
  const resHeaders = {};
  const req = { method: 'GET', url: '/v2/apps/com.fresh.app' };
  const res = {
    setHeader (k, v) { resHeaders[k] = v; },
    json () { setImmediate(resolveRun); }
  };
  let resolveRun;
  const done = new Promise((r) => { resolveRun = r; });

  cacheMiddleware(req, res, () => {
    cachedCall('app', [{ appId: 'com.fresh.app' }], () =>
      Promise.resolve({ ok: true })).then(() => res.json({}));
  });
  await done;

  assert.equal(resHeaders['X-Data-Stale'], undefined);
  assert.equal(resHeaders['X-Cache'], 'MISS');
});

test('after cooldown a successful probe closes the circuit', async () => {
  await tripBreaker(3);
  assert.equal(breakerStats().state, 'open');

  await new Promise((r) => setTimeout(r, 170)); // cooldown 150ms

  const result = await cachedCall('app', [{ appId: 'probe-app' }], () =>
    Promise.resolve({ recovered: true }));
  assert.equal(result.recovered, true);
  assert.equal(breakerStats().state, 'closed');
});

test('a failing half-open probe reopens the circuit', async () => {
  await tripBreaker(3, 504);
  await new Promise((r) => setTimeout(r, 170)); // now half-open

  await assert.rejects(
    () => cachedCall('app', [{ appId: 'half-open-call' }], () =>
      Promise.reject(boom(504))),
    () => true
  );
  assert.equal(breakerStats().state, 'open');
  assert.ok(breakerStats().trips >= 2);
});

test('BREAKER_DISABLED=true keeps the circuit closed regardless of failures', async () => {
  breakerConfig.disabled = true;
  await tripBreaker(6);
  assert.equal(breakerStats().state, 'closed');
});
