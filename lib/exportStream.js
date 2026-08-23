'use strict';

/**
 * B3: Streaming reviews export. Wraps the scraper's reviewsIterator in a
 * Readable that emits NDJSON (one review per line) or RFC 4180 CSV rows,
 * bounded by a hard cap so a runaway app can't hold the connection (or the
 * upstream) open forever. The route pipes this straight to the response —
 * no intermediate array of every review in memory.
 *
 * Built on Readable.from(asyncGenerator) — the documented Node streaming
 * API. Generator rejection surfaces as a stream 'error' event, which
 * destroys the response mid-flight (status headers are already sent).
 */

import { Readable } from 'node:stream';

export const EXPORT_MAX_REVIEWS = 10_000;

const CSV_FIELDS = [
  'id', 'userName', 'date', 'score', 'title', 'text',
  'thumbsUp', 'appVersion', 'replyDate', 'replyText'
];

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row WITHOUT its trailing newline — the stream adds separators. */
export const renderRow = (format, review) => {
  if (format === 'csv') {
    return CSV_FIELDS.map((f) => csvCell(review[f])).join(',');
  }
  return JSON.stringify(review);
};

/**
 * @param {AsyncGenerator} iterator - yields review objects
 * @param {'ndjson'|'csv'} format
 * @param {{max?: number}} [opts] - override the cap (tests)
 * @returns {Readable}
 */
export const buildExportStream = (iterator, format, { max = EXPORT_MAX_REVIEWS } = {}) =>
  Readable.from((async function * generate () {
    let count = 0;
    let headerSent = false;
    while (count < max) {
      const { value, done } = await iterator.next();
      if (done) return;
      // CSV header is lazy: an empty upstream must produce an empty body.
      let chunk = '';
      if (!headerSent) {
        headerSent = true;
        if (format === 'csv') chunk += CSV_FIELDS.join(',') + '\n';
      }
      chunk += renderRow(format, value) + '\n';
      count++;
      yield chunk;
    }
  })());
