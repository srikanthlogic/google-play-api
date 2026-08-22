'use strict';

/**
 * C1: Response cache with per-endpoint TTLs.
 *
 * Same app details hammered by many users burn credits and attract Google
 * blocks. This module sits in front of every scraper call (see the gplay
 * proxy in lib/index.js): identical (fn, params) calls inside their TTL are
 * served from an in-memory LRU without touching upstream.
 *
 * - Cache key includes country/lang because they are part of the scraper
 *   options object that forms the key.
 * - Per-endpoint TTLs follow the C1 spec: app 15m, reviews 5m, lists 30m.
 *   Unlisted functions fall back to DEFAULT_TTL_MS.
 * - Every JSON response carries X-Cache: HIT|MISS via the ALS-backed
 *   middleware so consumers can tell where the data came from.
 *
 * Env knobs: CACHE_DISABLED=true, CACHE_MAX_ENTRIES (default 500),
 * CACHE_TTL_<FN>_MS (e.g. CACHE_TTL_APP_MS=60000).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const MINUTE = 60_000;

const envInt = (name, fallback) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const config = {
  disabled: process.env.CACHE_DISABLED === 'true',
  maxEntries: envInt('CACHE_MAX_ENTRIES', 500),
  ttlByFnMs: {
    app: envInt('CACHE_TTL_APP_MS', 15 * MINUTE),
    apps: envInt('CACHE_TTL_APPS_MS', 15 * MINUTE),
    reviews: envInt('CACHE_TTL_REVIEWS_MS', 5 * MINUTE),
    search: envInt('CACHE_TTL_SEARCH_MS', 30 * MINUTE),
    list: envInt('CACHE_TTL_LIST_MS', 30 * MINUTE),
    similar: envInt('CACHE_TTL_SIMILAR_MS', 30 * MINUTE),
    developer: envInt('CACHE_TTL_DEVELOPER_MS', 30 * MINUTE),
    suggest: envInt('CACHE_TTL_SUGGEST_MS', 30 * MINUTE),
    datasafety: envInt('CACHE_TTL_DATASAFETY_MS', 30 * MINUTE),
    permissions: envInt('CACHE_TTL_PERMISSIONS_MS', 30 * MINUTE),
    availability: envInt('CACHE_TTL_AVAILABILITY_MS', 30 * MINUTE)
  },
  defaultTtlMs: envInt('CACHE_TTL_DEFAULT_MS', 15 * MINUTE)
};

/** Functions whose results are safe to cache (all read-only GET semantics). */
const CACHEABLE_FNS = new Set(Object.keys(config.ttlByFnMs));

/**
 * LRU + TTL store. Map insertion order doubles as recency order: get()
 * re-inserts the entry so the oldest key is always map.keys().first().
 */
class LRUTTLCache {
  constructor (maxEntries) {
    this.max = maxEntries;
    this.map = new Map();
  }

  get (key) {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set (key, value, ttlMs) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value);
    }
  }

  get size () {
    return this.map.size;
  }
}

const store = new LRUTTLCache(config.maxEntries);

/** Aggregate counters — consumed by logging and later health/metrics slices. */
export const cacheStats = { hits: 0, misses: 0 };

/** Per-request cache outcome, used to stamp the X-Cache response header. */
const cacheContext = new AsyncLocalStorage();

// Stable key materialization: sort object keys recursively so
// {a:1,b:2} and {b:2,a:1} share one cache entry.
const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
};

export const buildKey = (fnName, args) => `${fnName}:${stableStringify(args)}`;

/**
 * Entry point used by the gplay proxy in lib/index.js.
 *
 * @param {string} fnName - scraper function being called
 * @param {Array} args - call arguments
 * @param {Function} fetcher - () => Promise producing the uncached value
 * @returns {Promise}
 */
export const cachedCall = (fnName, args, fetcher) => {
  if (config.disabled || !CACHEABLE_FNS.has(fnName)) {
    return fetcher();
  }

  const reqState = cacheContext.getStore();
  const key = buildKey(fnName, args);

  const hit = store.get(key);
  if (hit !== undefined) {
    cacheStats.hits++;
    if (reqState) reqState.hit = true;
    // Clone so downstream handlers can mutate their copy freely.
    return Promise.resolve(structuredClone(hit));
  }

  cacheStats.misses++;
  return fetcher().then((value) => {
    try {
      store.set(key, structuredClone(value), config.ttlByFnMs[fnName] ?? config.defaultTtlMs);
    } catch {
      // Non-cloneable payloads are simply not cached.
    }
    return value;
  });
};

/**
 * Router middleware: opens a per-request cache context and stamps
 * X-Cache: HIT|MISS onto every JSON response.
 */
export const cacheMiddleware = (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const reqState = cacheContext.getStore();
    res.setHeader('X-Cache', reqState?.hit ? 'HIT' : 'MISS');
    return originalJson(body);
  };
  cacheContext.run({ hit: false }, next);
};

/** Test/debug helper: drop everything and reset counters. */
export const resetCache = () => {
  store.map.clear();
  cacheStats.hits = 0;
  cacheStats.misses = 0;
};
