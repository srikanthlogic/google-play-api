'use strict';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  cachedCall,
  cacheMiddleware,
  cacheStats,
  buildKey,
  resetCache,
  config
} from '../lib/cache.js';


beforeEach(() => {
  resetCache();
  config.disabled = false;
});

test('second identical call is served from cache without re-invoking fetcher', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return { title: 'WhatsApp', country: 'US' };
  };

  const first = await cachedCall('app', [{ appId: 'com.whatsapp', country: 'US' }], fetcher);
  const second = await cachedCall('app', [{ appId: 'com.whatsapp', country: 'US' }], fetcher);

  assert.equal(calls, 1);
  assert.deepEqual(second, first);
});

test('different params produce distinct cache entries', async () => {
  let calls = 0;
  const fetcher = async () => ({ n: ++calls });

  await cachedCall('app', [{ appId: 'a' }], fetcher);
  const other = await cachedCall('app', [{ appId: 'b', country: 'IN' }], fetcher);

  assert.equal(calls, 2);
  assert.equal(other.n, 2);
});

test('key includes country/lang via stable param serialization', () => {
  const a = buildKey('app', [{ appId: 'x', country: 'US', lang: 'en' }]);
  const b = buildKey('app', [{ lang: 'en', country: 'US', appId: 'x' }]);
  assert.equal(a, b);
  assert.notEqual(a, buildKey('app', [{ appId: 'x', country: 'GB', lang: 'en' }]));
});

test('expired entries are refetched (TTL respected)', async () => {
  let calls = 0;
  const fetcher = async () => ({ n: ++calls });
  const originalTtl = config.ttlByFnMs.reviews;

  // Shrink reviews TTL to 10ms for the test window.
  config.ttlByFnMs.reviews = 10;
  try {
    const args = [{ appId: 'com.x' }];
    await cachedCall('reviews', args, fetcher);
    await new Promise((r) => setTimeout(r, 30));
    await cachedCall('reviews', args, fetcher);
  } finally {
    config.ttlByFnMs.reviews = originalTtl;
  }

  assert.equal(calls, 2);
});

test('upstream failures are not cached', async () => {
  let attempts = 0;
  const failing = async () => {
    attempts++;
    throw new Error('upstream boom');
  };
  const args = [{ appId: 'com.y' }];

  await assert.rejects(() => cachedCall('app', args, failing));
  await assert.rejects(() => cachedCall('app', args, failing));
  assert.equal(attempts, 2);
});

test('CACHE_DISABLED=true bypasses the cache entirely', async () => {
  config.disabled = true;
  let calls = 0;
  const fetcher = async () => ({ n: ++calls });
  const args = [{ appId: 'com.z' }];

  await cachedCall('app', args, fetcher);
  await cachedCall('app', args, fetcher);
  assert.equal(calls, 2);
  assert.deepEqual(cacheStats, { hits: 0, misses: 0 });
});

test('non-cacheable functions pass through uncached', async () => {
  let calls = 0;
  const fetcher = async () => ({ n: ++calls });

  await cachedCall('memoPad', [{}], fetcher);
  await cachedCall('memoPad', [{}], fetcher);
  assert.equal(calls, 2);
  assert.deepEqual(cacheStats, { hits: 0, misses: 0 });
});

test('cached values are deep clones — handler mutations never poison the cache', async () => {
  const fetcher = async () => ({ data: [{ score: 5 }] });
  const args = [{ appId: 'com.c' }];

  const first = await cachedCall('app', args, fetcher);
  first.data[0].score = 999;

  const second = await cachedCall('app', args, fetcher);
  assert.equal(second.data[0].score, 5);
});

// ─── X-Cache header middleware ───────────────────────────────────────────────

const fakeRes = () => {
  const res = {
    headers: {},
    setHeader (k, v) { this.headers[k] = v; },
    json (body) { return body; }
  };
  return res;
};

test('X-Cache: MISS on first request, HIT on second', async () => {
  const fetcher = async () => ({ ok: true });

  // First request through middleware -> MISS
  const res1 = fakeRes();
  await new Promise((resolve) => cacheMiddleware({}, res1, async () => {
    await cachedCall('app', [{ appId: 'com.h' }], fetcher);
    res1.json({});
    resolve();
  }));
  assert.equal(res1.headers['X-Cache'], 'MISS');

  // Second identical request -> HIT
  const res2 = fakeRes();
  await new Promise((resolve) => cacheMiddleware({}, res2, async () => {
    await cachedCall('app', [{ appId: 'com.h' }], fetcher);
    res2.json({});
    resolve();
  }));
  assert.equal(res2.headers['X-Cache'], 'HIT');
});

test('stats count hits and misses across calls', async () => {
  const fetcher = async () => ({ v: 1 });
  const args = [{ appId: 'com.s' }];
  await cachedCall('app', args, fetcher);
  await cachedCall('app', args, fetcher);
  await cachedCall('app', args, fetcher);
  assert.equal(cacheStats.misses >= 1, true);
  assert.equal(cacheStats.hits >= 2, true);
});

// ─── C2: request coalescing ──────────────────────────────────────────────────

test('C2: concurrent identical calls share one upstream fetch', async () => {
  let calls = 0;
  const fetcher = () => new Promise((resolve) => {
    calls += 1;
    setTimeout(() => resolve({ value: calls }), 25);
  });
  const [a, b, c] = await Promise.all([
    cachedCall('app', [{ appId: 'com.coalesce' }], fetcher),
    cachedCall('app', [{ appId: 'com.coalesce' }], fetcher),
    cachedCall('app', [{ appId: 'com.coalesce' }], fetcher)
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(a, { value: 1 });
  assert.deepEqual(b, { value: 1 });
  assert.deepEqual(c, { value: 1 });
  resetCache();
});

test('C2: flight failure clears so next caller retries upstream', async () => {
  let calls = 0;
  const flaky = () => {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error('boom'));
    return Promise.resolve({ ok: true });
  };
  await assert.rejects(() => cachedCall('app', [{ appId: 'com.flaky' }], flaky));
  const recovered = await cachedCall('app', [{ appId: 'com.flaky' }], flaky);
  assert.deepEqual(recovered, { ok: true });
  assert.equal(calls, 2);
});

test('C2: COALESCE_DISABLED=true lets every call through', async () => {
  process.env.COALESCE_DISABLED = 'true';
  try {
    let calls = 0;
    const fetcher = () => new Promise((resolve) => {
      calls += 1;
      setTimeout(() => resolve({ n: calls }), 20);
    });
    await Promise.all([
      cachedCall('app', [{ appId: 'com.nocoalesce' }], fetcher),
      cachedCall('app', [{ appId: 'com.nocoalesce' }], fetcher)
    ]);
    assert.equal(calls, 2);
  } finally {
    delete process.env.COALESCE_DISABLED;
  }
});
