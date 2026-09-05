'use strict';

import gplayScraper from '@mradex77/google-play-scraper';
import { withTimeout } from './resilience.js';
import { retryCall } from './retry.js';
import { cachedCall } from './cache.js';
import { proxyFetch, isBlockClass, recordAttempt, recordBlock } from './egress.js';

// C8+C7: every scraper call runs under the upstream timeout budget (C8) and
// is retried with backoff on transient upstream failures (C7). Timeouts
// reject with UpstreamTimeoutError -> 504 + Retry-After via the error
// middleware; retries stay invisible to callers. The breaker (C4) and
// stale-on-error live inside cachedCall. Shared by the REST router
// (lib/index.js) and the GraphQL resolvers (lib/graphql/schema.js) so both
// surfaces get identical cache/retry/timeout/breaker behavior.
const gplay = new Proxy(gplayScraper, {
  get (target, prop) {
    const value = target[prop];
    if (typeof value === 'function') {
      return (...args) => cachedCall(prop, args, () => retryCall(async () => {
        recordAttempt(prop);
        try {
          const callArgs = [...args];
          if (proxyFetch) {
            const base = callArgs[0] && typeof callArgs[0] === 'object' ? { ...callArgs[0] } : {};
            base.requestOptions = Object.assign({}, base.requestOptions, { fetchImpl: proxyFetch });
            callArgs[0] = base;
          }
          return await withTimeout(value.apply(target, callArgs));
        } catch (err) {
          if (isBlockClass(err)) recordBlock(prop);
          throw err;
        }
      }));
    }
    return value;
  }
});

export default gplay;
