'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, getErrorStatusCode } from '../lib/errors.js';

test('getErrorStatusCode honors Express-style err.status', () => {
  const err = new Error('Not Found');
  err.status = 404;
  assert.equal(getErrorStatusCode(err), 404);
});

test('err.status does not override AppError statusCode', () => {
  // AppError branch runs first; its statusCode wins over a stray .status
  const err = new AppError('teapot', 418);
  err.status = 500;
  assert.equal(getErrorStatusCode(err), 418);
});

test('non-numeric err.status is ignored', () => {
  const err = new Error('mystery');
  err.status = 'not-a-number';
  assert.equal(getErrorStatusCode(err), 500);
});
