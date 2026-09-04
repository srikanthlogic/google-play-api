#!/usr/bin/env node
'use strict';

/**
 * B10 (#112): OpenAPI 3.1 generated from the zod schemas in lib/schemas.js.
 * Replaces the Postman-generated pipeline (postman-to-openapi).
 *
 * - Route inventory is introspected from the live Express router, so the
 *   spec cannot drift from registered endpoints.
 * - Response components are derived from zod via z.toJSONSchema()
 *   (JSON Schema 2020-12 — natively valid in OpenAPI 3.1).
 */

import fs from 'node:fs';
import path from 'node:path';

import router from '../lib/index.js';
import {
  AppSchema,
  ReviewSchema,
  DataSafetySchema,
  PermissionSchema,
  SuggestItemSchema,
  AvailabilitySchema,
  DeveloperAppsSchema,
  BatchSettledSchema,
  StringArraySchema,
  IteratorPageSchema,
  HealthReportSchema,
  HistoryListSchema,
  ChangesReportSchema
} from '../lib/schemas.js';
import { z } from 'zod';

// ─── helpers ─────────────────────────────────────────────────────────────────

function componentize (name, schema) {
  const json = schema.toJSONSchema
    ? schema.toJSONSchema({ io: 'output', unrepresentable: 'any' })
    : JSON.parse(JSON.stringify(schema)); // never hit; guards older zod
  return json;
}

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const AppListSchema = z.object({ results: z.array(AppSchema) });
const ReviewsSchema = z.object({
  results: z.object({
    data: z.array(ReviewSchema),
    nextPaginationToken: z.string().optional()
  })
});
const PermissionListSchema = z.object({ results: z.array(PermissionSchema) });
const SuggestListSchema = z.object({ results: z.array(SuggestItemSchema) });
const BatchListSchema = z.object({ results: z.array(BatchSettledSchema) });

const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  retryAfter: z.number().optional()
});

// name -> { schema, register }
const RESPONSES = {
  App: AppSchema,
  AppList: AppListSchema,
  Reviews: ReviewsSchema,
  DataSafety: DataSafetySchema,
  PermissionList: PermissionListSchema,
  SuggestList: SuggestListSchema,
  Availability: AvailabilitySchema,
  DeveloperApps: DeveloperAppsSchema,
  BatchList: BatchListSchema,
  StringArray: StringArraySchema,
  IteratorPageApp: IteratorPageSchema(AppSchema),
  HealthReport: HealthReportSchema,
  HistoryList: HistoryListSchema,
  ChangesReport: ChangesReportSchema,
  Problem: ProblemSchema,
  LegacyError: z.object({ error: z.string(), message: z.string(), url: z.string().optional() }),
  DevHelp: z.object({ message: z.string(), example: z.string() })
};

// ─── route inventory (introspected) ──────────────────────────────────────────

function inventory () {
  const routes = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const methods = Object.keys(layer.route.methods).filter(m => layer.route.methods[m]);
    routes.push({ path: layer.route.path, methods });
  }
  return routes;
}

// express-path → OAS metadata for every endpoint the router serves.
// `ok` names a component in RESPONSES; `raw` documents a non-JSON response.
const META = {
  '/apps/': {
    get: {
      summary: 'List apps by category/collection (paginated)',
      tags: ['apps'],
      ok: 'AppList',
      queryParams: ['category', 'collection', 'num', 'start', 'country', 'lang', 'fullDetail']
    }
  },
  '/apps/:appId': {
    get: { summary: 'Full app detail', tags: ['apps'], ok: 'App', pathParams: ['appId'], queryParams: ['fields', 'country', 'lang', 'fullDetail'] }
  },
  '/apps/:appId/similar': {
    get: { summary: 'Apps similar to the given app', tags: ['apps'], ok: 'AppList', pathParams: ['appId'], queryParams: ['country', 'lang'] }
  },
  '/apps/:appId/datasafety': {
    get: { summary: 'Data safety section', tags: ['apps'], ok: 'DataSafety', pathParams: ['appId'], queryParams: ['country', 'lang'] }
  },
  '/apps/:appId/permissions': {
    get: { summary: 'Requested permissions', tags: ['apps'], ok: 'PermissionList', pathParams: ['appId'], queryParams: ['country', 'lang'] }
  },
  '/apps/:appId/availability': {
    get: { summary: 'Country availability map', tags: ['apps'], ok: 'Availability', pathParams: ['appId'] }
  },
  '/apps/:appId/reviews': {
    get: { summary: 'Reviews (token-paginated upstream)', tags: ['reviews'], ok: 'Reviews', pathParams: ['appId'], queryParams: ['sort', 'num', 'paginate', 'nextPaginationToken', 'country', 'lang'] }
  },
  '/apps/:appId/reviews/export': {
    get: {
      summary: 'Export all reviews as NDJSON or CSV stream',
      tags: ['reviews'],
      ok: null,
      raw: {
        'application/x-ndjson': { description: 'Newline-delimited JSON review stream (format=ndjson)' },
        'text/csv': { description: 'CSV review stream with header row (format=csv, default)' }
      },
      pathParams: ['appId'],
      queryParams: ['format', 'country', 'lang']
    }
  },
  '/apps/search': {
    get: { summary: 'Search apps (cursor-paginated iterator)', tags: ['search'], ok: 'IteratorPageApp', queryParams: ['q', 'pageSize', 'cursor', 'country', 'lang', 'fullDetail'] }
  },
  '/apps/batch': {
    post: { summary: 'Batch app details (allSettled semantics)', tags: ['apps'], ok: 'BatchList' }
  },
  '/developers/': {
    get: { summary: 'Developer id required (help payload)', tags: ['developers'], ok: 'DevHelp' }
  },
  '/developers/:devId/': {
    get: { summary: 'Apps by developer (page)', tags: ['developers'], ok: 'DeveloperApps', pathParams: ['devId'], queryParams: ['num', 'country', 'lang', 'fullDetail'] }
  },
  '/developers/:devId/apps': {
    get: { summary: 'Apps by developer (cursor-paginated iterator)', tags: ['developers'], ok: 'IteratorPageApp', pathParams: ['devId'], queryParams: ['pageSize', 'cursor', 'country', 'lang', 'fullDetail'] }
  },
  '/lists/': {
    get: { summary: 'Top lists by category and collection', tags: ['lists'], ok: 'AppList', queryParams: ['category', 'collection', 'num', 'start', 'country', 'lang'] }
  },
  '/categories/': {
    get: { summary: 'All category keys', tags: ['meta'], ok: 'StringArray' }
  },
  '/collections/': {
    get: { summary: 'All collection keys', tags: ['meta'], ok: 'StringArray' }
  },
  '/suggest': {
    get: { summary: 'Search suggestions', tags: ['search'], ok: 'SuggestList', queryParams: ['term', 'country', 'lang'] }
  },
  '/health': {
    get: { summary: 'Integrity snapshot: cache/coalesce/breaker/retry/egress stats', tags: ['health'], ok: 'HealthReport', queryParams: ['probe'] }
  },
  '/apps/:appId/history': {
    get: { summary: 'Snapshot timeline for an app (B9 change detection)', tags: ['history'], ok: 'HistoryList', pathParams: ['appId'] }
  },
  '/apps/:appId/changes': {
    get: { summary: 'Field-level changes between snapshots since a date', tags: ['history'], ok: 'ChangesReport', pathParams: ['appId'], queryParams: ['since'] }
  }
};

const COMMON_QUERY_DOCS = {
  country: { description: 'ISO 3166-1 alpha-2 country code', schema: { type: 'string', default: 'US' }, example: 'US' },
  lang: { description: 'BCP-47 language tag', schema: { type: 'string', default: 'en' }, example: 'en' },
  fullDetail: { description: 'Fetch full app details (slower)', schema: { type: 'boolean', default: false } },
  num: { description: 'Result page size (max 200)', schema: { type: 'integer', minimum: 1, maximum: 200 } },
  start: { description: 'Pagination start offset (v1 emulation)', schema: { type: 'integer', minimum: 0 } },
  fields: { description: 'Comma-separated projection of app fields', schema: { type: 'string' }, example: 'appId,title,score,version' },
  sort: { description: 'Review sort order', schema: { type: 'integer', enum: [1, 2, 3] }, example: 2 },
  paginate: { description: 'Enable token pagination', schema: { type: 'boolean' } },
  nextPaginationToken: { description: 'Token from a previous reviews response', schema: { type: 'string' } },
  pageSize: { description: 'Iterator page size (1–100)', schema: { type: 'integer', minimum: 1, maximum: 100 } },
  cursor: { description: 'Opaque nextToken from a previous iterator response', schema: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' } },
  q: { description: 'Search term (required)', schema: { type: 'string', minLength: 1 } },
  term: { description: 'Suggestion prefix', schema: { type: 'string', minLength: 1 } },
  category: { description: 'Category key — see GET /categories/', schema: { type: 'string' }, example: 'GAME_ACTION' },
  collection: { description: 'Collection key — see GET /collections/', schema: { type: 'string' }, example: 'TOP_FREE' },
  format: { description: 'Export wire format', schema: { type: 'string', enum: ['ndjson', 'csv'], default: 'csv' } },
  probe: { description: 'Run a live upstream probe (~1s)', schema: { type: 'boolean', default: false } }
};

const PATH_PARAM = (name) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
  example: name === 'devId' ? 'Wikimedia Foundation' : 'com.spotify.music'
});

function buildOperation (method, meta) {
  const op = {
    operationId: `${method}${meta.tags[0]}${Math.abs(hash(meta.summary))}`,
    summary: meta.summary,
    tags: meta.tags,
    responses: {}
  };

  if (meta.pathParams) {
    op.parameters = meta.pathParams.map(PATH_PARAM);
  }
  if (meta.queryParams) {
    op.parameters = [
      ...(op.parameters || []),
      ...meta.queryParams.map(q => ({
        name: q,
        in: 'query',
        ...(COMMON_QUERY_DOCS[q] || { schema: { type: 'string' } })
      }))
    ];
  }

  if (meta.raw) {
    op.responses['200'] = { description: meta.summary.replace(/^\w/, c => c.toLowerCase()), content: meta.raw };
  } else if (meta.ok) {
    op.responses['200'] = {
      description: 'Successful response',
      content: { 'application/json': { schema: ref(meta.ok) } }
    };
  }

  // v2 surfaces use RFC 9457 problem+json; /api keeps the legacy shape.
  if (meta.ok !== 'HealthReport') {
    op.responses['400'] = {
      description: 'Validation error',
      content: {
        'application/problem+json': { schema: ref('Problem') },
        'application/json': { schema: ref('LegacyError') }
      }
    };
  }
  if (!['HealthReport', 'DevHelp'].includes(meta.ok)) {
    op.responses.default = {
      description: 'Upstream failure (502 schema drift / 504 timeout) or not found',
      content: {
        'application/problem+json': { schema: ref('Problem') },
        'application/json': { schema: ref('LegacyError') }
      }
    };
  }
  return op;
}

function hash (s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

// ─── assemble ────────────────────────────────────────────────────────────────

function main () {
  const paths = {};
  const missing = [];

  for (const { path: p, methods } of inventory()) {
    const meta = META[p];
    if (!meta) { missing.push(p); continue; }
    const item = {};
    let documented = 0;
    for (const m of methods) {
      if (META[p][m]) { item[m] = buildOperation(m, META[p][m]); documented++; }
    }
    if (documented > 0) paths[p] = item;
  }

  if (missing.length) {
    console.error('Routes without OAS metadata:', missing.join(', '));
    process.exitCode = 1;
  }

  const components = {};
  for (const [name, schema] of Object.entries(RESPONSES)) {
    components[name] = componentize(name, schema);
  }

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Google Play API',
      version: '2.0.0',
      description: 'REST API over Google Play Store data. Every path below is served under `/v2/` (canonical, RFC 9457 errors) and under `/api/` (v1 legacy shape, deprecated — Sunset header announces retirement). Generated from zod schemas in `lib/schemas.js`.',
      license: { name: 'MIT' }
    },
    servers: [
      { url: '/v2', description: 'v2 canonical envelope + problem+json errors' },
      { url: '/api', description: 'v1 legacy (deprecated)' }
    ],
    paths,
    components: { schemas: components },
    'x-generated-by': 'scripts/generate-oas.mjs (zod schemas)'
  };

  const outPath = path.resolve('openapi/swagger.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
  console.log(`OpenAPI ${spec.openapi}: ${Object.keys(paths).length} paths, ${Object.keys(components).length} schemas -> ${outPath}`);
}

main();
