'use strict';

/**
 * C3: Proxy / egress IP strategy + block-rate measurement.
 *
 * Google throttles a single egress IP at real SaaS volume. This module:
 *  1. Optionally routes scraper traffic through a pool of HTTP proxies
 *     (EGRESS_PROXY_URLS, comma-separated) injected as the scraper's
 *     `requestOptions.fetchImpl`, backed by undici ProxyAgents.
 *  2. Classifies upstream failures that look like IP blocks (403/429 or
 *     captcha/unusual-traffic messages) and records per-endpoint block
 *     rates, exposed via /v2/health so the enable-proxies decision is
 *     measured, not guessed (see docs/egress-proxy-memo.md).
 */

import logger from './logger.js';
import { recordIntegrity } from './health.js';

let ProxyAgent;
let fetchImpl;
try {
  ({ ProxyAgent } = await import('undici'));
  fetchImpl = (await import('undici')).fetch;
} catch {
  // undici unavailable — proxy support stays off; measurement still works.
}

const envList = (name) => (process.env[name] || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const egressConfig = {
  proxyUrls: envList('EGRESS_PROXY_URLS')
};

/** Round-robin pool of ProxyAgents, one per configured proxy URL. */
let agents = [];
try {
  agents = egressConfig.proxyUrls.map((url) => new ProxyAgent(url));
} catch (err) {
  logger.error({ err: err.message }, 'Invalid EGRESS_PROXY_URLS entry — proxies disabled');
  agents = [];
}

export const proxyFetch = agents.length && fetchImpl
  ? (url, opts = {}) => {
    const agent = agents[rr++ % agents.length];
    return fetchImpl(url, { ...opts, dispatcher: agent });
  }
  : null;

let rr = 0;

/**
 * Block-class failure heuristic: explicit throttle statuses, or the
 * classic Google "unusual traffic" interstitial text.
 */
export const BLOCKED_STATUS = new Set([403, 429]);
const BLOCK_RE = /(captcha|unusual traffic|automated queries|too many requests)/i;

export const isBlockClass = (err) => {
  const status = err?.statusCode ?? err?.status ?? err?.response?.statusCode;
  if (BLOCKED_STATUS.has(status)) return true;
  return BLOCK_RE.test(String(err?.message || ''));
};

/** Aggregate counters — consumed by /v2/health (C5). */
const attemptsByEndpoint = new Map();
const blockedByEndpoint = new Map();

export const recordAttempt = (endpoint) => {
  attemptsByEndpoint.set(endpoint, (attemptsByEndpoint.get(endpoint) || 0) + 1);
};

export const recordBlock = (endpoint) => {
  blockedByEndpoint.set(endpoint, (blockedByEndpoint.get(endpoint) || 0) + 1);
  recordIntegrity({ kind: 'upstream_block', endpoint });
};

const topEntries = (map, total) => [...map.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([endpoint, count]) => ({ endpoint, count, rate: count / total }));

export const egressStats = () => {
  const attempts = [...attemptsByEndpoint.values()].reduce((a, b) => a + b, 0);
  const blocked = [...blockedByEndpoint.values()].reduce((a, b) => a + b, 0);
  return {
    proxyEnabled: Boolean(proxyFetch),
    proxies: egressConfig.proxyUrls.length,
    attempts,
    blocked,
    blockRate: attempts ? Number((blocked / attempts).toFixed(4)) : 0,
    topBlockedEndpoints: topEntries(blockedByEndpoint, Math.max(attempts, 1))
  };
};

export const resetEgress = () => {
  attemptsByEndpoint.clear();
  blockedByEndpoint.clear();
};
