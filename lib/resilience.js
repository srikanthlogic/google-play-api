'use strict';

/**
 * Upstream resilience layer — C-series.
 *
 * C8 (this file, first slice): per-call timeout budget. Every scraper call is
 * raced against a timer; if the upstream does not respond within the budget
 * the call rejects with UpstreamTimeoutError, which the error middleware maps
 * to 504 + Retry-After. A slow upstream can no longer hold a worker hostage.
 *
 * Later slices build on this module:
 *   C7 retry/backoff, C1 response cache, C2 request coalescing,
 *   C4 circuit breaker, C5 health probe / drift alerting.
 *
 * All knobs are env-configurable; see docs/throttling.html.
 */

import { UpstreamTimeoutError } from './errors.js';

const envInt = (name, fallback) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const config = {
  timeoutMs: envInt('UPSTREAM_TIMEOUT_MS', 15000),
  timeoutRetryAfterSeconds: envInt('UPSTREAM_TIMEOUT_RETRY_AFTER', 5)
};

/**
 * Race a promise against the timeout budget.
 * Rejects with UpstreamTimeoutError when the budget is exceeded.
 * The timer is always cleared in the finally block, so it never leaks.
 *
 * @param {Promise} promise - the upstream call
 * @param {number} [ms] - timeout in ms (defaults to config.timeoutMs)
 * @returns {Promise} resolves/rejects with the original promise's outcome
 */
export const withTimeout = (promise, ms = config.timeoutMs) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new UpstreamTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
