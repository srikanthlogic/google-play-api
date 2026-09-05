'use strict';

import { GraphQLError } from 'graphql';
import { getErrorStatusCode, problemDetails } from '../errors.js';

/**
 * GraphQL error contract — mirrors the REST problem+json taxonomy.
 *
 * Any error thrown by a resolver is mapped to a GraphQLError carrying:
 * - `message`: the problem `detail` (5xx messages redacted exactly like
 *   problemDetails does on /v2, unless NODE_ENV=development)
 * - `extensions.httpStatus`: the equivalent HTTP status the REST surface
 *   would have answered with (404 app-not-found, 504 upstream timeout, …)
 * - `extensions.code` / `extensions.type`: same codes and problem-type URIs
 *   as RFC 9457 responses
 * - `extensions.retryAfter`: present for 429/504, same values as REST
 */
export const toGraphQLError = (err) => {
  const status = getErrorStatusCode(err);
  const problem = problemDetails(err, { originalUrl: '/v2/graphql' }, status);
  const extensions = {
    httpStatus: status,
    code: problem.code,
    type: problem.type
  };
  if (problem.retryAfter !== undefined) extensions.retryAfter = problem.retryAfter;
  return new GraphQLError(problem.detail, {
    extensions,
    originalError: err
  });
};

/**
 * Resolver wrapper: runs the resolver and converts thrown errors into the
 * mapped GraphQLError so clients get one consistent error shape.
 */
export const resolver = (fn) => async (parent, args, context, info) => {
  try {
    return await fn(parent, args, context, info);
  } catch (err) {
    throw toGraphQLError(err);
  }
};
