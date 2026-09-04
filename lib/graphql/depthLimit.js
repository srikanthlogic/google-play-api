'use strict';

import { parse, Kind } from 'graphql';

/**
 * Query depth limiting for the public /v2/graphql endpoint.
 *
 * The endpoint proxies an upstream scraper with no auth, so arbitrarily
 * deep (or cyclic-via-fragments) documents must be rejected before they
 * reach the executor. Depth counts nested field selections — one level per
 * field; fragment spreads and inline fragments resolve transparently (they
 * don't add depth themselves, their selections do).
 */

const DEFAULT_MAX_DEPTH = 10;

const depthOfSelections = (selections, fragments, seen, depth) => {
  let max = depth;
  for (const selection of selections) {
    switch (selection.kind) {
    case Kind.FIELD: {
      let fieldDepth = depth + 1;
      if (selection.selectionSet) {
        fieldDepth = depthOfSelections(selection.selectionSet.selections, fragments, seen, fieldDepth);
      }
      max = Math.max(max, fieldDepth);
      break;
    }
    case Kind.INLINE_FRAGMENT:
      max = Math.max(max, depthOfSelections(selection.selectionSet.selections, fragments, seen, depth));
      break;
    case Kind.FRAGMENT_SPREAD: {
      const definition = fragments.get(selection.name.value);
      if (definition && !seen.has(definition)) {
        seen.add(definition);
        max = Math.max(max, depthOfSelections(definition.selectionSet.selections, fragments, seen, depth));
        seen.delete(definition);
      }
      break;
    }
    default:
      break;
    }
  }
  return max;
};

/**
 * Compute the maximum field depth of a GraphQL document.
 * @param {string} source - GraphQL document text
 * @returns {number} deepest field nesting (top-level fields count as 1)
 * @throws {Error} rethrows parse errors from graphql (callers decide who
 *   reports them — the graphql-http handler produces spec-shaped parse
 *   errors, so the depth middleware treats unparseable queries as depth 0)
 */
export const documentDepth = (source) => {
  const document = parse(source);
  const fragments = new Map();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }
  let max = 0;
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION && definition.selectionSet) {
      max = Math.max(max, depthOfSelections(definition.selectionSet.selections, fragments, new Set(), 0));
    }
  }
  return max;
};

export const maxDepth = () => {
  const parsed = parseInt(process.env.GRAPHQL_MAX_DEPTH || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_DEPTH;
};
