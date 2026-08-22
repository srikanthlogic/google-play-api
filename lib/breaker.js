'use strict';

/**
 * C4: Circuit breaker / stale-on-error degradation.
 *
 * When upstream starts failing in a storm, hammering it with retries makes
 * things worse and turns every request into a 502/504. This module watches
 * the upstream failure rate (as classified by getErrorStatusCode >= 500):
 *
 *   closed      → normal operation, failures tracked in a sliding window
 *   open        → threshold exceeded; cachedCall serves stale cache entries
 *                 and marks the response X-Data-Stale: true instead of
 *                 calling upstream. A call with no stale copy still passes
 *                 through as a probe.
 *   half-open   → cooldown elapsed; probes are allowed through again.
 *                 A probe success closes the circuit, a probe failure
 *                 re-opens it for another cooldown.
 *
 * Client-visible 5xx storms become degraded-but-useful responses.
 *
 * Env knobs: BREAKER_DISABLED=true, BREAKER_FAILURE_THRESHOLD (default 5),
 * BREAKER_WINDOW_MS (default 60000), BREAKER_COOLDOWN_MS (default 30000).
 */

import { getErrorStatusCode } from './errors.js';

const envInt = (name, fallback) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const breakerConfig = {
  disabled: process.env.BREAKER_DISABLED === 'true',
  failureThreshold: envInt('BREAKER_FAILURE_THRESHOLD', 5),
  windowMs: envInt('BREAKER_WINDOW_MS', 60_000),
  cooldownMs: envInt('BREAKER_COOLDOWN_MS', 30_000)
};

const state = {
  phase: 'closed', // 'closed' | 'open' | 'half-open'
  failures: [], // timestamps of recent upstream failures
  openedAt: 0,
  trips: 0 // lifetime count of times the breaker opened
};

/** Observability snapshot — consumed by /v2/health (C5) later. */
export const breakerStats = () => ({
  state: state.phase,
  recentFailures: state.failures.length,
  openedAt: state.openedAt || undefined,
  trips: state.trips
});

const enabled = () => !breakerConfig.disabled;

/**
 * True when the circuit is open, i.e. callers should degrade to stale data.
 * Transitions open → half-open once the cooldown has elapsed.
 */
export const breakerIsOpen = () => {
  if (!enabled()) return false;
  if (state.phase === 'open' && Date.now() - state.openedAt >= breakerConfig.cooldownMs) {
    state.phase = 'half-open';
  }
  return state.phase === 'open';
};

const pruneWindow = (now = Date.now()) => {
  const cutoff = now - breakerConfig.windowMs;
  state.failures = state.failures.filter((ts) => ts > cutoff);
};

const trip = (now = Date.now()) => {
  if (state.phase !== 'open') state.trips++;
  state.phase = 'open';
  state.openedAt = now;
};

/** A successful upstream call: probe success closes, plain success resets. */
export const recordSuccess = () => {
  if (!enabled()) return;
  state.failures = [];
  state.phase = 'closed';
};

/**
 * An upstream-class failure. Validation/404-style errors (status < 500)
 * are ignored — they say nothing about upstream health.
 */
export const recordFailure = (err) => {
  if (!enabled()) return;
  const status = typeof err?.statusCode === 'number'
    ? err.statusCode
    : getErrorStatusCode(err);
  if (status < 500) return;

  const now = Date.now();
  if (state.phase === 'half-open') {
    trip(now); // probe failed — reopen for another full cooldown
    return;
  }
  state.failures.push(now);
  pruneWindow(now);
  if (state.failures.length >= breakerConfig.failureThreshold) {
    trip(now);
  }
};

/** Test/debug helper. */
export const resetBreaker = () => {
  state.phase = 'closed';
  state.failures = [];
  state.openedAt = 0;
  state.trips = 0;
};
