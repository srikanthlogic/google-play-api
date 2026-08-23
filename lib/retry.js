'use strict';

/**
 * C7: Retry with exponential backoff + jitter for transient upstream failures.
 *
 * A single dropped connection or a blip on Google's side should not surface
 * as a 502/504 to API consumers. Each scraper call is retried up to
 * RETRY_MAX_ATTEMPTS total attempts while the failure classifies as an
 * upstream problem (status >= 500); client errors (4xx, e.g. app not found)
 * fail fast because retrying cannot fix them.
 *
 * Backoff is exponential (base * 2^attempt) capped at RETRY_MAX_DELAY_MS,
 * with full jitter to avoid synchronized retry storms across workers.
 *
 * Layering with the other C-series slices:
 *   retryCall(() => withTimeout(upstreamCall))   <- this module wraps the
 *                                                   per-attempt timeout budget,
 *   wrapped again by cachedCall() (C1/C2/C4).
 *
 * Env knobs: RETRY_DISABLED=true, RETRY_MAX_ATTEMPTS (default 3),
 * RETRY_BASE_DELAY_MS (default 200), RETRY_MAX_DELAY_MS (default 5000).
 */

import { getErrorStatusCode } from './errors.js';
import logger from './logger.js';

const envInt = (name, fallback) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const retryConfig = {
  disabled: process.env.RETRY_DISABLED === 'true',
  maxAttempts: envInt('RETRY_MAX_ATTEMPTS', 3),
  baseDelayMs: envInt('RETRY_BASE_DELAY_MS', 200),
  maxDelayMs: envInt('RETRY_MAX_DELAY_MS', 5000)
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Full-jitter exponential backoff: random between 0 and min(cap, base*2^n). */
export const backoffDelay = (attempt, rand = Math.random) => {
  const cap = Math.min(retryConfig.maxDelayMs, retryConfig.baseDelayMs * 2 ** attempt);
  return Math.floor(rand() * cap);
};

const isUpstreamClass = (err) => {
  const status = typeof err?.statusCode === 'number'
    ? err.statusCode
    : getErrorStatusCode(err);
  return status >= 500;
};

/**
 * Run `fn`, retrying upstream-class failures with backoff.
 *
 * @param {Function} fn - () => Promise for a single attempt
 * @param {Object} [deps] - injectable clock for tests ({ sleep, rand })
 * @returns {Promise} the first successful attempt's value, or the last error
 */
export const retryCall = async (fn, deps = {}) => {
  const doSleep = deps.sleep ?? sleep;
  const rand = deps.rand ?? Math.random;

  if (retryConfig.disabled) return fn();

  let lastErr;
  for (let attempt = 0; attempt < retryConfig.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isUpstreamClass(err)) throw err;
      if (attempt < retryConfig.maxAttempts - 1) {
        const delayMs = backoffDelay(attempt, rand);
        logger.warn({ attempt: attempt + 1, delayMs, errMessage: err.message }, 'Upstream call failed, retrying');
        await doSleep(delayMs);
      }
    }
  }
  throw lastErr;
};
