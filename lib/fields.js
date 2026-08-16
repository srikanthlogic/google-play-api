'use strict';

/**
 * B8: Field selection (?fields= projection).
 *
 * Whitelist-based sparse responses for app-detail payloads. Unknown fields
 * are rejected with a 400 that lists the valid field names, so clients get
 * an actionable error instead of silently-missing keys.
 */

// Every field @mradex77/google-play-scraper returns from app().
// Keep in sync with the scraper's App schema (see test/index.test.js contract tests).
export const APP_FIELDS = Object.freeze([
  'appId',
  'title',
  'url',
  'description',
  'descriptionHTML',
  'summary',
  'installs',
  'minInstalls',
  'maxInstalls',
  'score',
  'scoreText',
  'ratings',
  'reviews',
  'histogram',
  'price',
  'originalPrice',
  'discountEndDate',
  'free',
  'currency',
  'priceText',
  'available',
  'offersIAP',
  'IAPRange',
  'androidVersion',
  'androidVersionText',
  'androidMaxVersion',
  'developer',
  'developerId',
  'developerEmail',
  'developerWebsite',
  'developerAddress',
  'developerLegalName',
  'developerLegalEmail',
  'developerLegalAddress',
  'developerLegalPhoneNumber',
  'privacyPolicy',
  'developerInternalID',
  'genre',
  'genreId',
  'categories',
  'icon',
  'headerImage',
  'screenshots',
  'video',
  'videoImage',
  'previewVideo',
  'contentRating',
  'contentRatingDescription',
  'adSupported',
  'released',
  'updated',
  'version',
  'recentChanges',
  'comments',
  'preregister',
  'earlyAccessEnabled',
  'isAvailableInPlayPass'
]);

const APP_FIELDS_SET = new Set(APP_FIELDS);

/**
 * Parse a comma-separated ?fields= value.
 * @returns {{fields: string[]}|{error: string}} — error message lists valid fields.
 */
export function parseFields (raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { error: 'fields must be a comma-separated list of field names' };
  }

  const requested = raw.split(',').map(f => f.trim()).filter(Boolean);
  if (requested.length === 0) {
    return { error: 'fields must be a comma-separated list of field names' };
  }

  const unknown = [...new Set(requested.filter(f => !APP_FIELDS_SET.has(f)))];
  if (unknown.length > 0) {
    return { error: `unknown field(s): ${unknown.join(', ')}. Valid fields: ${APP_FIELDS.join(', ')}` };
  }

  return { fields: [...new Set(requested)] };
}

/**
 * Project an object down to the requested fields (presence-based, not
 * truthiness-based, so legitimately-null fields survive).
 */
export function projectFields (obj, fields) {
  const out = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(obj, f)) {
      out[f] = obj[f];
    }
  }
  return out;
}
