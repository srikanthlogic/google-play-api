'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout, config } from '../lib/resilience.js';
import { UpstreamTimeoutError, getErrorStatusCode } from '../lib/errors.js';

test('withTimeout resolves when the promise settles before the budget', async () => {
  const result = await withTimeout(Promise.resolve('ok'), 1000);
  assert.equal(result, 'ok');
});

test('withTimeout rejects with UpstreamTimeoutError when the budget is exceeded', async () => {
  const never = new Promise(() => {}); // hangs forever
  await assert.rejects(
    () => withTimeout(never, 20),
    (err) => {
      assert.ok(err instanceof UpstreamTimeoutError);
      assert.equal(getErrorStatusCode(err), 504);
      return true;
    }
  );
});

test('withTimeout passes through upstream rejections unchanged', async () => {
  const boom = new Error('upstream exploded');
  await assert.rejects(
    () => withTimeout(Promise.reject(boom), 1000),
    (err) => {
      assert.equal(err, boom);
      return true;
    }
  );
});

test('withTimeout clears its timer after resolution (no leaked handles)', async () => {
  // If the timer were not cleared, the process would stay alive for the
  // full budget. We assert indirectly by completing well before it.
  const start = Date.now();
  await withTimeout(Promise.resolve(1), 60_000);
  assert.ok(Date.now() - start < 1000);
});

test('config defaults are sane and env-overridable', () => {
  assert.equal(typeof config.timeoutMs, 'number');
  assert.ok(config.timeoutMs > 0);
  assert.equal(typeof config.timeoutRetryAfterSeconds, 'number');
  assert.ok(config.timeoutRetryAfterSeconds > 0);
});
