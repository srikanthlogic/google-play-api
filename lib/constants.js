'use strict';

/**
 * Application constants
 */

// Pagination defaults
export const DEFAULT_PAGE_SIZE = 60;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_START = 0;
export const MAX_START = 500;

// @mradex77/google-play-scraper caps list() at 200 results and has no start offset
export const MAX_LIST_RESULTS = 200;

// Availability endpoint: one upstream request per country — cap the fan-out
export const MAX_AVAILABILITY_COUNTRIES = 30;

// Reviews defaults
export const DEFAULT_REVIEWS_COUNT = 100;
export const MAX_REVIEWS_COUNT = 500;

// Sort values for reviews
export const SORT_HELPFUL = 1;
export const SORT_NEWEST = 2;
export const SORT_RATED = 3;

// ─── Country / Language defaults (single source of truth) ───────────────────
// Resolution order: env var → constant. The scraper itself defaults to
// country="us", lang="en" when neither is provided, but we always pass
// explicit values so behaviour is deterministic and documented.
export const DEFAULT_COUNTRY = (process.env.COUNTRY_OF_QUERY || 'US').toUpperCase();
export const DEFAULT_LANG = (process.env.LANG_OF_QUERY || 'en').toLowerCase();

// ISO 3166-1 alpha-2 pattern (2 uppercase letters)
export const COUNTRY_CODE_RE = /^[A-Z]{2}$/;

// BCP-47-ish language tag: 2-letter base, optional region subtag
export const LANG_CODE_RE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;
