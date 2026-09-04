'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError,
  NotFoundError,
  BadRequestError,
  ValidationError,
  RateLimitError,
  UpstreamParseError,
  UpstreamNetworkError,
  getErrorStatusCode,
  problemDetails
} from '../lib/errors.js';

test('AppError defaults to 500 and error status', () => {
  const err = new AppError('boom');
  assert.equal(err.statusCode, 500);
  assert.equal(err.status, 'error');
  assert.equal(err.isOperational, true);
  assert.equal(err.message, 'boom');
  assert.ok(err instanceof Error);
});

test('AppError with 4xx code gets fail status', () => {
  const err = new AppError('nope', 418);
  assert.equal(err.statusCode, 418);
  assert.equal(err.status, 'fail');
});

test('specialized error classes carry expected status codes', () => {
  assert.equal(new NotFoundError().statusCode, 404);
  assert.equal(new BadRequestError().statusCode, 400);
  assert.equal(new ValidationError().statusCode, 400);
  assert.equal(new RateLimitError().statusCode, 429);
  assert.equal(new UpstreamParseError().statusCode, 502);
  assert.equal(new UpstreamNetworkError().statusCode, 503);
});

test('specialized error classes have default messages', () => {
  assert.equal(new NotFoundError().message, 'Resource not found');
  assert.equal(new BadRequestError().message, 'Bad request');
  assert.equal(new ValidationError().message, 'Validation failed');
  assert.equal(new RateLimitError().message, 'Too many requests');
  assert.equal(new UpstreamParseError().message, 'The upstream response could not be parsed');
  assert.equal(new UpstreamNetworkError().message, 'The upstream service could not be reached');
});

test('getErrorStatusCode returns AppError statusCode', () => {
  assert.equal(getErrorStatusCode(new NotFoundError('x')), 404);
  assert.equal(getErrorStatusCode(new AppError('x', 422)), 422);
});

test('getErrorStatusCode maps UpstreamSchemaDriftError to 502', () => {
  const byName = new Error('drift');
  byName.name = 'UpstreamSchemaDriftError';
  assert.equal(getErrorStatusCode(byName), 502);

  const byCode = new Error('drift');
  byCode.code = 'UPSTREAM_SCHEMA_DRIFT';
  assert.equal(getErrorStatusCode(byCode), 502);
});

test('getErrorStatusCode maps scraper not-found messages to 404', () => {
  assert.equal(getErrorStatusCode(new Error('App not found')), 404);
  assert.equal(getErrorStatusCode(new Error('status code 404')), 404);
});

test('getErrorStatusCode maps network error codes to 503', () => {
  for (const code of ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']) {
    const err = new Error('network');
    err.code = code;
    assert.equal(getErrorStatusCode(err), 503, code);
  }
});

test('getErrorStatusCode maps parse errors to 502', () => {
  const byName = new Error('bad html');
  byName.name = 'HTMLParseError';
  assert.equal(getErrorStatusCode(byName), 502);

  assert.equal(getErrorStatusCode(new Error('Failed to parse response')), 502);
});

test('getErrorStatusCode maps rate limit errors to 429', () => {
  assert.equal(getErrorStatusCode(new Error('rate limit exceeded')), 429);
  assert.equal(getErrorStatusCode(new Error('upstream returned 429')), 429);
});

test('getErrorStatusCode defaults to 500', () => {
  assert.equal(getErrorStatusCode(new Error('mystery')), 500);
});

const mockReq = (url = '/v2/apps/com.foo') => ({ originalUrl: url });

test('problemDetails builds RFC 7807 shape for 4xx', () => {
  const err = new BadRequestError('num must be positive');
  const problem = problemDetails(err, mockReq(), 400);
  assert.equal(problem.type, 'https://api.google-play-api.dev/problems/bad-request');
  assert.equal(problem.title, 'Bad Request');
  assert.equal(problem.status, 400);
  assert.equal(problem.detail, 'num must be positive');
  assert.equal(problem.code, 'HTTP_400');
  assert.equal(problem.instance, '/v2/apps/com.foo');
});

test('problemDetails preserves error code when present', () => {
  const err = new Error('gone');
  err.code = 'APP_GONE';
  const problem = problemDetails(err, mockReq(), 404);
  assert.equal(problem.code, 'APP_GONE');
});

test('problemDetails masks 5xx detail outside development', () => {
  const prev = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  try {
    const problem = problemDetails(new Error('secret stack trace'), mockReq(), 500);
    assert.equal(problem.detail, 'The request could not be completed.');
  } finally {
    if (prev !== undefined) process.env.NODE_ENV = prev;
  }
});

test('problemDetails exposes 5xx detail in development', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const problem = problemDetails(new Error('secret stack trace'), mockReq(), 500);
    assert.equal(problem.detail, 'secret stack trace');
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});

test('problemDetails computes retryAfter for 429 from rateLimit resetTime', () => {
  const req = mockReq();
  req.rateLimit = { resetTime: new Date(Date.now() + 42_000) };
  const problem = problemDetails(new RateLimitError(), req, 429);
  assert.ok(problem.retryAfter >= 41 && problem.retryAfter <= 42);
});

test('problemDetails retryAfter floors at 0 without resetTime', () => {
  const problem = problemDetails(new RateLimitError(), mockReq(), 429);
  assert.equal(problem.retryAfter, 0);
});

test('problemDetails falls back to internal type for unknown status', () => {
  const problem = problemDetails(new Error('teapot'), mockReq(), 418);
  assert.equal(problem.type, 'https://api.google-play-api.dev/problems/internal');
  assert.equal(problem.title, 'Internal Server Error');
});
