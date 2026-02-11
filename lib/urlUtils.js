'use strict';

import path from 'path';

/**
 * Build a URL for the API
 * @param {Object} req - Express request object
 * @param {string} subpath - Path to append to base URL
 * @returns {string} Full URL
 */
export const buildUrl = (req, subpath) =>
  req.protocol + '://' + path.join(req.get('host'), req.baseUrl, subpath);

/**
 * Generate URLs for app-related endpoints
 * @param {Object} req - Express request object
 * @param {Object} app - App data object
 * @returns {Object} App data with additional URLs
 */
export const cleanUrls = (req) => (app) => ({
  ...app,
  playstoreUrl: app.url,
  url: buildUrl(req, 'apps/' + app.appId),
  permissions: buildUrl(req, 'apps/' + app.appId + '/permissions'),
  similar: buildUrl(req, 'apps/' + app.appId + '/similar'),
  reviews: buildUrl(req, 'apps/' + app.appId + '/reviews'),
  datasafety: buildUrl(req, 'apps/' + app.appId + '/datasafety'),
  developer: {
    devId: app.developer,
    url: buildUrl(req, 'developers/' + encodeURIComponent(app.developer))
  },
  categories: buildUrl(req, 'categories/')
});
