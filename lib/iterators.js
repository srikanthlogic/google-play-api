'use strict';

/**
 * B4: Cursor-paginated exposure of the scraper's search/developer
 * iterators. The upstream generators yield one app at a time and have no
 * offset support, so a page request rebuilds the iterator and fast-forwards
 * past already-consumed items. The cursor is an opaque base64url token that
 * records {kind, identity, offset}; filter values always come from the
 * current request's query string, so changing filters mid-iteration is
 * either honored (harmless) or rejected on identity mismatch.
 */

class InvalidCursorError extends Error {
  constructor (message) {
    super(message);
    this.name = 'InvalidCursorError';
    this.statusCode = 400;
    this.status = 400;
  }
}

export const ITERATOR_PAGE_DEFAULT = 20;
export const ITERATOR_PAGE_MAX = 100;

/** Fast-forward batch size handed to the underlying iterator fetches. */
const FFWD_BATCH = 50;

export const encodeToken = (payload) =>
  Buffer.from(JSON.stringify(payload)).toString('base64url');

export const decodeToken = (token, expectedKind) => {
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(String(token), 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError('cursor is not a valid nextToken');
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) ||
      typeof decoded.kind !== 'string' ||
      !Number.isInteger(decoded.o) || decoded.o < 0) {
    throw new InvalidCursorError('cursor is not a valid nextToken');
  }
  if (expectedKind !== undefined && decoded.kind !== expectedKind) {
    throw new InvalidCursorError(
      `Cursor kind ${decoded.kind} does not match endpoint kind ${expectedKind}`);
  }
  return decoded;
};

/**
 * Fetch one page through an upstream iterator.
 *
 * @param {Object} gplay - raw scraper module (NOT the cached proxy)
 * @param {'search'|'developer'} kind
 * @param {Object} params - validated scraper options (term/devId, country…)
 * @param {string|null} cursor - opaque nextToken from a previous page
 * @returns {Promise<{results: Array, nextToken: string|null}>}
 */
export const iteratePage = async (gplay, kind, params, cursor) => {
  let offset = 0;
  if (cursor) {
    const decoded = decodeToken(cursor, kind);
    const identity = kind === 'search' ? String(params.term ?? '') : String(params.devId ?? '');
    const cursorIdentity = String(decoded.term ?? decoded.devId ?? '');
    if (cursorIdentity && cursorIdentity !== identity) {
      throw new InvalidCursorError('cursor was issued for a different query');
    }
    offset = decoded.o;
  }

  const pageSize = Math.min(
    Number.isInteger(params?.pageSize) ? params.pageSize : ITERATOR_PAGE_DEFAULT,
    ITERATOR_PAGE_MAX
  );

  const iter = kind === 'search'
    ? gplay.searchIterator({ ...params, num: FFWD_BATCH })
    : gplay.developerIterator(params);

  const results = [];
  let skipped = 0;
  for (;;) {
     
    const { value, done } = await iter.next();
    if (done) break;
    if (skipped < offset) {
      skipped++;
      continue;
    }
    results.push(value);
    if (results.length >= pageSize) {
      // Optimistic boundary token: the stream may or may not hold more
      // items; following it costs one fast-forward and yields an empty
      // final page when exhausted.
      const identity = kind === 'search' ? params.term : params.devId;
      const token = encodeToken({ kind, [kind === 'search' ? 'term' : 'devId']: identity, o: offset + results.length });
      return { results, nextToken: token };
    }
  }
  return { results, nextToken: null };
};
