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

// Reviews defaults
export const DEFAULT_REVIEWS_COUNT = 100;
export const MAX_REVIEWS_COUNT = 500;

// Sort values for reviews
export const SORT_HELPFUL = 1;
export const SORT_NEWEST = 2;
export const SORT_RATED = 3;

// Default country
export const DEFAULT_COUNTRY = 'US';
