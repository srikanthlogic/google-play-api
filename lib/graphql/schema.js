'use strict';

import qs from 'querystring';
import { GraphQLScalarType } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import gplayScraper from '@mradex77/google-play-scraper';
import gplay from '../gplayClient.js';
import { iteratePage } from '../iterators.js';
import { cleanUrls, buildUrl } from '../urlUtils.js';
import { ValidationError, UpstreamParseError } from '../errors.js';
import { processReviews } from '../reviewUtils.js';
import { snapshotApp } from '../history.js';
import { resolver } from './errors.js';
import {
  MAX_LIST_RESULTS,
  MAX_PAGE_SIZE,
  MAX_BATCH_APPS,
  MAX_BATCH_CONCURRENCY,
  MAX_AVAILABILITY_COUNTRIES,
  MAX_REVIEWS_COUNT,
  DEFAULT_REVIEWS_COUNT,
  SORT_HELPFUL,
  SORT_NEWEST,
  SORT_RATED,
  PERMISSION_TYPE_NAMES,
  DEFAULT_COUNTRY,
  DEFAULT_LANG,
  COUNTRY_CODE_RE,
  LANG_CODE_RE
} from '../constants.js';
import {
  validateApp,
  validateAppList,
  validateReviews,
  validateDataSafety,
  validatePermissions,
  validateSuggest,
  validateStringArray,
  validateDeveloperApps,
  validateAvailability,
  validateBatch
} from '../schemas.js';

/* ─── Argument helpers (mirrors the REST router's normalization rules) ─────── */

// REST routes attach code 'VALIDATION_ERROR' to 400s so problemDetails
// exposes it; the GraphQL error mapper preserves that contract.
const validationError = (message) => {
  const error = new ValidationError(message);
  error.code = 'VALIDATION_ERROR';
  return error;
};

const normCountry = (raw) => {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_COUNTRY;
  const country = String(raw).toUpperCase();
  if (!COUNTRY_CODE_RE.test(country)) {
    throw validationError('country must be a valid ISO 3166-1 alpha-2 code (e.g. US, IN, GB)');
  }
  return country;
};

const normLang = (raw) => {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LANG;
  const lang = String(raw).toLowerCase();
  if (!LANG_CODE_RE.test(lang)) {
    throw validationError('lang must be a valid BCP-47 language tag (e.g. en, hi, ta-IN)');
  }
  return lang;
};

const geo = (args) => ({ country: normCountry(args.country), lang: normLang(args.lang) });

const requireId = (value, name) => {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) throw validationError(`${name} is required`);
  return id;
};

const intArg = (value, name, min, max) => {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw validationError(`${name} must be between ${min} and ${max}`);
  }
  return value;
};

/* ─── SDL ──────────────────────────────────────────────────────────────────── */

const typeDefs = /* GraphQL */ `
  """
  Arbitrary JSON value passed through from the scraper. Used for fields whose
  upstream shape is polymorphic (histograms, version ceilings, sale dates).
  """
  scalar JSON

  """
  A Play Store app. Mirrors the /v2 REST app shape: url, permissions,
  similar, reviews and datasafety are API deep links, developer is
  { devId, url }, and categories points at /v2/categories/ (set by the same
  cleanUrls step the REST surface uses).
  """
  type App {
    appId: String!
    title: String
    url: String
    playstoreUrl: String
    summary: String
    description: String
    descriptionHTML: String
    installs: String
    minInstalls: JSON
    maxInstalls: JSON
    score: Float
    scoreText: String
    ratings: Float
    histogram: [Float!]
    price: Float
    originalPrice: Float
    discountEndDate: JSON
    free: Boolean
    currency: String
    priceText: String
    available: Boolean
    offersIAP: Boolean
    IAPRange: String
    androidVersion: JSON
    androidVersionText: String
    androidMaxVersion: JSON
    developer: AppDeveloper
    developerId: String
    developerEmail: String
    developerWebsite: String
    developerAddress: String
    developerLegalName: String
    developerLegalEmail: String
    developerLegalAddress: String
    developerLegalPhoneNumber: String
    privacyPolicy: String
    developerInternalID: String
    genre: String
    genreId: String
    categories: String
    icon: String
    headerImage: String
    screenshots: [String!]
    video: String
    videoImage: String
    previewVideo: String
    contentRating: String
    contentRatingDescription: String
    adSupported: Boolean
    released: String
    updated: Int
    version: String
    recentChanges: String
    comments: [String!]
    preregister: Boolean
    earlyAccessEnabled: Boolean
    isAvailableInPlayPass: Boolean
    permissions: String
    similar: String
    reviews: String
    datasafety: String
  }

  type AppDeveloper {
    devId: String
    url: String
  }

  type ReviewCriteria {
    criteria: String
    rating: Float
    comments: [String!]
  }

  type Review {
    id: String
    userName: String
    date: String
    url: String
    score: Int
    title: String
    text: String
    replyDate: String
    replyText: String
    version: String
    thumbsUp: Int
    criterias: [ReviewCriteria!]
  }

  "Cursor page of full-detail apps (search / developerApps)."
  type AppPage {
    results: [App!]!
    "Opaque cursor for the next page; null when the iteration is exhausted."
    nextToken: String
  }

  type ReviewPage {
    data: [Review!]!
    "Opaque nextPaginationToken; empty string when no further page exists."
    nextCursor: String
  }

  type SuggestItem {
    term: String!
    url: String!
  }

  type DataSafetyEntry {
    data: String
    type: String
    purpose: String
    optional: Boolean
  }

  type DataSafety {
    sharedData: [DataSafetyEntry!]
    collectedData: [DataSafetyEntry!]
    securityPractices: [JSON!]
    privacyPolicyUrl: String
  }

  type Permission {
    type: String
    permissions: [String!]
  }

  type Developer {
    devId: String!
    apps: [App!]!
  }

  type CountryAvailability {
    countryCode: String!
    available: Boolean
    status: String!
    message: String
  }

  type Availability {
    appId: String!
    countries: [CountryAvailability!]!
  }

  type AppOk {
    appId: String!
    app: App!
  }

  type AppError {
    appId: String!
    error: String!
  }

  union AppResult = AppOk | AppError

  enum ReviewSort {
    HELPFUL
    NEWEST
    RATED
  }

  type Query {
    "Full app detail. Also records a history snapshot, like GET /v2/apps/:appId."
    app(appId: ID!, country: String, lang: String): App!
    "Batch app details (max 20), mirroring POST /v2/apps/batch per-ID settled results."
    apps(ids: [ID!]!, country: String, lang: String, concurrency: Int): [AppResult!]!
    "Cursor-paginated search, mirroring GET /v2/apps/search."
    search(
      term: String!
      country: String
      lang: String
      pageSize: Int
      cursor: String
      "Defaults to false (shallow results), same as the REST endpoint."
      fullDetail: Boolean
    ): AppPage!
    "Curated list page (collection-backed, hard cap ${MAX_LIST_RESULTS})."
    list(
      collection: String!
      category: String
      age: String
      country: String
      lang: String
      num: Int
      start: Int
    ): [App!]!
    "Apps similar to the given one."
    similar(appId: ID!, country: String, lang: String): [App!]!
    "Reviews with pagination; userdata/replies mirror the REST privacy flags."
    reviews(
      appId: ID!
      country: String
      lang: String
      "1..${MAX_REVIEWS_COUNT}, default ${DEFAULT_REVIEWS_COUNT}."
      num: Int
      sort: ReviewSort
      "Opaque nextPaginationToken from a previous page."
      cursor: String
      "Include reviewer identity (default false)."
      userdata: Boolean
      "Include developer replies, reviewer name redacted (default false)."
      replies: Boolean
    ): ReviewPage!
    "Developer summary by id or name."
    developer(devId: String!, country: String, lang: String, num: Int): Developer!
    "Cursor-paginated developer apps, mirroring GET /v2/developers/:devId/apps."
    developerApps(
      devId: String!
      country: String
      lang: String
      pageSize: Int
      cursor: String
      fullDetail: Boolean
    ): AppPage!
    "Search term completions."
    suggest(term: String!): [SuggestItem!]!
    "Data safety section for an app."
    dataSafety(appId: ID!, country: String, lang: String): DataSafety!
    "Permission groups for an app (type mapped to its group name)."
    permissions(appId: ID!, country: String): [Permission!]!
    "Per-country availability (max ${MAX_AVAILABILITY_COUNTRIES} codes)."
    availability(appId: ID!, countries: [String!]!): Availability!
    "Valid category keys accepted by list()."
    categories: [String!]!
    "Valid collection keys accepted by list()."
    collections: [String!]!
  }
`;

/* ─── Resolvers ────────────────────────────────────────────────────────────── */

const resolvers = {
  JSON: new GraphQLScalarType({
    name: 'JSON',
    description: 'Arbitrary JSON value passed through from the scraper.',
    serialize: (value) => value
  }),

  AppResult: {
    __resolveType: (value) => (value.status === 'fulfilled' ? 'AppOk' : 'AppError')
  },

  Query: {
    app: resolver(async (_parent, args, context) => {
      const appId = requireId(args.appId, 'appId');
      const { country, lang } = geo(args);
      const clean = cleanUrls(context.reqLike);
      const data = await gplay.app({ appId, country, lang });
      const validated = validateApp(clean(data), 'graphql/app');
      // B9: record a history snapshot off the critical path (never awaited),
      // exactly like the REST app-detail route.
      snapshotApp(validated);
      return validated;
    }),

    apps: resolver(async (_parent, args, context) => {
      const ids = Array.isArray(args.ids) ? args.ids.map((id) => String(id).trim()).filter(Boolean) : [];
      const appIds = [...new Set(ids)];
      if (appIds.length === 0) throw validationError('ids must contain at least one app ID');
      if (appIds.length > MAX_BATCH_APPS) {
        throw validationError(`ids supports at most ${MAX_BATCH_APPS} apps per request (got ${ids.length})`);
      }
      const concurrency = intArg(args.concurrency, 'concurrency', 1, MAX_BATCH_CONCURRENCY);
      const { country, lang } = geo(args);

      const settled = await gplay.apps({ appIds, concurrency, country, lang });
      const results = settled.map((entry) => entry.status === 'fulfilled'
        ? { appId: entry.appId, status: entry.status, app: cleanUrls(context.reqLike)(entry.app) }
        : { appId: entry.appId, status: entry.status, error: entry.error?.message ?? String(entry.error) });
      return validateBatch({ results }, 'graphql/apps').results;
    }),

    search: resolver(async (_parent, args, context) => {
      const term = requireId(args.term, 'term');
      const { country, lang } = geo(args);
      const pageSize = intArg(args.pageSize, 'pageSize', 1, MAX_PAGE_SIZE);
      const params = {
        term,
        country,
        lang,
        fullDetail: args.fullDetail === true,
        pageSize
      };
      const page = await iteratePage(gplayScraper, 'search', params, args.cursor || null);
      return { results: page.results.map(cleanUrls(context.reqLike)), nextToken: page.nextToken };
    }),

    list: resolver(async (_parent, args, context) => {
      const collection = requireId(args.collection, 'collection');
      const { country, lang } = geo(args);
      // Mirrors the REST listPage(): fetch start + num within the scraper's
      // 200-item cap, then slice — the scraper has no start offset.
      const num = Number.isInteger(args.num) && args.num > 0
        ? Math.min(args.num, MAX_LIST_RESULTS)
        : MAX_LIST_RESULTS;
      const start = Number.isInteger(args.start) && args.start > 0 ? args.start : 0;

      const listOpts = { collection, country, lang, num: Math.min(start + num, MAX_LIST_RESULTS) };
      if (args.category) listOpts.category = args.category;
      if (args.age) listOpts.age = args.age;

      const apps = await gplay.list(listOpts);
      const sliced = apps.slice(start, start + num).map(cleanUrls(context.reqLike));
      return validateAppList({ results: sliced }, 'graphql/list').results;
    }),

    similar: resolver(async (_parent, args, context) => {
      const appId = requireId(args.appId, 'appId');
      const { country, lang } = geo(args);
      const apps = await gplay.similar({ appId, country, lang });
      return validateAppList({ results: apps.map(cleanUrls(context.reqLike)) }, 'graphql/similar').results;
    }),

    reviews: resolver(async (_parent, args) => {
      const appId = requireId(args.appId, 'appId');
      const { country, lang } = geo(args);
      const num = intArg(args.num, 'num', 1, MAX_REVIEWS_COUNT) ?? DEFAULT_REVIEWS_COUNT;
      const sort = args.sort === 'HELPFUL' ? SORT_HELPFUL : args.sort === 'RATED' ? SORT_RATED : SORT_NEWEST;
      const opts = { appId, country, lang, num, sort };
      if (args.cursor) opts.nextPaginationToken = args.cursor;

      const reviews = await gplay.reviews(opts);
      processReviews(reviews, args.userdata === true, args.replies === true);
      validateReviews({ results: { data: reviews.data, nextPaginationToken: reviews.nextPaginationToken } }, 'graphql/reviews');
      return { data: reviews.data, nextCursor: reviews.nextPaginationToken };
    }),

    developer: resolver(async (_parent, args, context) => {
      const devId = requireId(args.devId, 'devId');
      const { country, lang } = geo(args);
      const num = intArg(args.num, 'num', 1, MAX_PAGE_SIZE);
      const apps = await gplay.developer({ devId, country, lang, num });
      return validateDeveloperApps({ devId, apps: apps.map(cleanUrls(context.reqLike)) }, 'graphql/developer');
    }),

    developerApps: resolver(async (_parent, args, context) => {
      const devId = requireId(args.devId, 'devId');
      const { country, lang } = geo(args);
      const pageSize = intArg(args.pageSize, 'pageSize', 1, MAX_PAGE_SIZE);
      const params = {
        devId,
        country,
        lang,
        fullDetail: args.fullDetail === true,
        pageSize
      };
      const page = await iteratePage(gplayScraper, 'developer', params, args.cursor || null);
      return { results: page.results.map(cleanUrls(context.reqLike)), nextToken: page.nextToken };
    }),

    suggest: resolver(async (_parent, args, context) => {
      const term = requireId(args.term, 'term');
      const terms = await gplay.suggest({ term });
      const items = terms.map((suggestion) => ({
        term: suggestion,
        url: buildUrl(context.reqLike, '/apps/') + '?' + qs.stringify({ q: suggestion })
      }));
      return validateSuggest({ results: items }, 'graphql/suggest').results;
    }),

    dataSafety: resolver(async (_parent, args) => {
      const appId = requireId(args.appId, 'appId');
      const { country, lang } = geo(args);
      const report = await gplay.dataSafety({ appId, country, lang });
      return validateDataSafety(report, 'graphql/dataSafety');
    }),

    permissions: resolver(async (_parent, args) => {
      const appId = requireId(args.appId, 'appId');
      const country = args.country === undefined || args.country === null || args.country === ''
        ? undefined
        : normCountry(args.country);
      const perms = await gplay.permissions({ appId, country });
      if (!Array.isArray(perms)) {
        throw new UpstreamParseError('permissions payload was not a list');
      }
      const results = perms.map((permission) => ({
        ...permission,
        type: PERMISSION_TYPE_NAMES[permission.type] ?? String(permission.type)
      }));
      return validatePermissions({ results }, 'graphql/permissions').results;
    }),

    availability: resolver(async (_parent, args) => {
      const appId = requireId(args.appId, 'appId');
      const codes = (Array.isArray(args.countries) ? args.countries : [])
        .map((code) => String(code).trim().toUpperCase())
        .filter((code) => code.length > 0);

      const badCodes = codes.filter((code) => !COUNTRY_CODE_RE.test(code));
      if (badCodes.length > 0) {
        throw validationError(`countries must be ISO 3166-1 alpha-2 codes; invalid: ${badCodes.join(', ')}`);
      }
      if (codes.length === 0) {
        throw validationError('countries must contain at least one ISO 3166-1 alpha-2 code');
      }
      if (codes.length > MAX_AVAILABILITY_COUNTRIES) {
        throw validationError(`countries supports at most ${MAX_AVAILABILITY_COUNTRIES} codes per request (got ${codes.length})`);
      }

      const result = validateAvailability(await gplay.availability({ appId, countries: codes }), 'graphql/availability');
      const countries = Object.entries(result.countries).map(([code, entry]) => ({
        countryCode: code.toUpperCase(),
        available: entry.status === 'available',
        status: entry.status,
        ...(entry.message !== undefined ? { message: entry.message } : {})
      }));
      return { appId: result.appId, countries };
    }),

    categories: resolver(async () =>
      validateStringArray(Object.keys(gplay.category), 'graphql/categories')),

    collections: resolver(async () =>
      validateStringArray(Object.keys(gplay.collection), 'graphql/collections'))
  }
};

export const schema = makeExecutableSchema({ typeDefs, resolvers });
