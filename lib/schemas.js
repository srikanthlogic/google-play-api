'use strict';

import { z } from 'zod';

/**
 * Upstream response schemas for @mradex77/google-play-scraper.
 * These validate the *essential* contract fields at the API boundary.
 * Extra fields are allowed via .passthrough() so minor scraper additions
 * don't break the API — only structural drift triggers 502.
 */

// Minimal app object — the fields every consumer relies on.
// Live @mradex77/google-play-scraper output uses `appId` (not `id`).
const AppSchema = z.object({
  appId: z.string(),
  title: z.string(),
  url: z.string()
}).passthrough();

// Review object — matches @mradex77/google-play-scraper output
const ReviewSchema = z.object({
  id: z.string(),
  userName: z.string().optional(),
  date: z.string(),
  url: z.string().optional(),
  score: z.number(),
  title: z.string().nullable(),
  text: z.string(),
  replyDate: z.string().nullable().optional(),
  replyText: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  thumbsUp: z.number(),
  criterias: z.array(z.object({
    criteria: z.string(),
    rating: z.union([z.number(), z.null()]),
    comments: z.array(z.string()).optional()
  })).optional()
}).passthrough();

// Data safety entry (element of sharedData / collectedData arrays)
const DataSafetyEntrySchema = z.object({
  data: z.string().optional(),
  type: z.union([z.string(), z.number()]).optional(),
  purpose: z.string().optional(),
  optional: z.boolean().optional()
}).passthrough();

// Full dataSafety response is an object, not a list wrapper
const DataSafetySchema = z.object({
  sharedData: z.array(DataSafetyEntrySchema).optional(),
  collectedData: z.array(DataSafetyEntrySchema).optional(),
  securityPractices: z.array(z.any()).optional(),
  privacyPolicyUrl: z.string().optional()
}).passthrough();

// Permission entry
const PermissionSchema = z.object({
  type: z.union([z.string(), z.number()])
}).passthrough();

// Suggest term object (mapped by the route to {term, url})
const SuggestItemSchema = z.object({
  term: z.string(),
  url: z.string()
}).passthrough();

// Categories / collections return arrays of strings (keys)
const StringArraySchema = z.array(z.string());

// toList wrapper: { results: [...] }
const ListWrapper = (itemSchema) => z.object({ results: z.array(itemSchema) });

/**
 * Validate upstream scraper output. Returns the data unchanged on success.
 * Throws UpstreamSchemaDriftError on structural mismatch.
 */
export class UpstreamSchemaDriftError extends Error {
  constructor (endpoint, issues) {
    super(`Upstream schema drift detected for ${endpoint}`);
    this.name = 'UpstreamSchemaDriftError';
    this.code = 'UPSTREAM_SCHEMA_DRIFT';
    this.statusCode = 502;
    this.issues = issues;
  }
}

function validate (schema, data, endpoint) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new UpstreamSchemaDriftError(endpoint, result.error.issues.slice(0, 5));
  }
  return result.data;
}

export const validateAppList = (data, endpoint) => validate(ListWrapper(AppSchema), data, endpoint);
export const validateApp = (data, endpoint) => validate(AppSchema, data, endpoint);
export const validateReviews = (data, endpoint) => validate(z.object({
  results: z.object({
    data: z.array(ReviewSchema),
    nextPaginationToken: z.string().optional()
  })
}), data, endpoint);
export const validateDataSafety = (data, endpoint) => validate(DataSafetySchema, data, endpoint);
export const validatePermissions = (data, endpoint) => validate(ListWrapper(PermissionSchema), data, endpoint);
export const validateSuggest = (data, endpoint) => validate(ListWrapper(SuggestItemSchema), data, endpoint);
export const validateStringArray = (data, endpoint) => validate(StringArraySchema, data, endpoint);

// Availability response: { appId, countries: { CC: { status, message? } } }
const CountryAvailabilitySchema = z.object({
  status: z.enum(['available', 'unavailable', 'error']),
  message: z.string().optional()
}).passthrough();

const AvailabilitySchema = z.object({
  appId: z.string(),
  countries: z.record(z.string(), CountryAvailabilitySchema)
});

export const validateAvailability = (data, endpoint) => validate(AvailabilitySchema, data, endpoint);

// Developer apps response: { devId, apps: [...] }
const DeveloperAppsSchema = z.object({
  devId: z.string(),
  apps: z.array(AppSchema)
}).passthrough();

export const validateDeveloperApps = (data, endpoint) => validate(DeveloperAppsSchema, data, endpoint);

// Batch app details response: { results: [{ appId, status: 'fulfilled', app } | { appId, status: 'rejected', error }] }
// Mirrors Promise.allSettled shape returned by @mradex77/google-play-scraper apps().
const BatchSettledSchema = z.discriminatedUnion('status', [
  z.object({
    appId: z.string(),
    status: z.literal('fulfilled'),
    app: AppSchema
  }),
  z.object({
    appId: z.string(),
    status: z.literal('rejected'),
    error: z.string()
  })
]);

const BatchSchema = ListWrapper(BatchSettledSchema);

export const validateBatch = (data, endpoint) => validate(BatchSchema, data, endpoint);
