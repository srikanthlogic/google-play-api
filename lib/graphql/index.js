'use strict';

import { createHandler } from 'graphql-http/lib/use/express';
import { schema } from './schema.js';
import { documentDepth, maxDepth } from './depthLimit.js';
import { sendIde } from './ide.js';

const httpHandler = createHandler({
  schema,
  // Resolvers build absolute REST deep links via cleanUrls(); they always
  // target the /v2 surface regardless of where GraphQL is mounted.
  // graphql-http hands its own request wrapper to context(); the Express
  // request (protocol/header access with proxy support) lives on .raw.
  context: (req) => ({
    reqLike: {
      protocol: req.raw.protocol,
      get: (header) => req.raw.get(header),
      baseUrl: '/v2'
    }
  })
});

/**
 * The /v2/graphql endpoint:
 * - GET with an explicit text/html preference (browsers) → GraphiQL IDE page
 * - otherwise → depth-limit guard, then graphql-http (GraphQL over HTTP)
 */
export default function graphqlEndpoint (req, res, next) {
  try {
    const accept = req.headers.accept || '';
    if (req.method === 'GET' && accept.includes('text/html')) {
      return sendIde(req, res);
    }

    const raw = req.method === 'GET' ? req.query.query : req.body && req.body.query;
    if (typeof raw === 'string' && raw !== '') {
      let depth = 0;
      try {
        depth = documentDepth(raw);
      } catch {
        // Unparseable documents are rejected by the executor with
        // spec-shaped parse errors; depth guarding only applies to valid ones.
      }
      const limit = maxDepth();
      if (depth > limit) {
        return res.status(400).json({
          errors: [{
            message: `Query exceeds the maximum depth of ${limit} (got ${depth}).`,
            extensions: { httpStatus: 400, code: 'GRAPHQL_MAX_DEPTH' }
          }]
        });
      }
    }

    return httpHandler(req, res, next);
  } catch (err) {
    next(err);
  }
}

export { schema };
