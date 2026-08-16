'use strict';

/**
 * Custom error types for the application
 */

export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
  }
}

export class UpstreamParseError extends AppError {
  constructor(message = 'The upstream response could not be parsed') {
    super(message, 502);
  }
}

export class UpstreamNetworkError extends AppError {
  constructor(message = 'The upstream service could not be reached') {
    super(message, 503);
  }
}

/**
 * Determine HTTP status code from error
 * @param {Error} err - Error object
 * @returns {number} HTTP status code
 */
export const getErrorStatusCode = (err) => {
  if (err instanceof AppError) {
    return err.statusCode;
  }

  // Handle specific error messages from google-play-scraper
  if (err.message?.includes('not found') || err.message?.includes('404')) {
    return 404;
  }

  if (['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].includes(err.code)) {
    return 503;
  }

  if (err.name?.toLowerCase().includes('parse') || err.message?.toLowerCase().includes('parse')) {
    return 502;
  }

  if (err.message?.toLowerCase().includes('rate limit') || err.message?.includes('429')) {
    return 429;
  }

  return 500;
};

const ERROR_TYPES = {
  400: 'https://api.google-play-api.dev/problems/bad-request',
  404: 'https://api.google-play-api.dev/problems/not-found',
  429: 'https://api.google-play-api.dev/problems/rate-limit',
  502: 'https://api.google-play-api.dev/problems/upstream-parse',
  503: 'https://api.google-play-api.dev/problems/upstream-unavailable',
  500: 'https://api.google-play-api.dev/problems/internal'
};

export const problemDetails = (err, req, status = getErrorStatusCode(err)) => {
  const titles = {
    400: 'Bad Request',
    404: 'Not Found',
    429: 'Too Many Requests',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    500: 'Internal Server Error'
  };
  const response = {
    type: ERROR_TYPES[status] || ERROR_TYPES[500],
    title: titles[status] || titles[500],
    status,
    detail: status >= 500 && process.env.NODE_ENV !== 'development'
      ? 'The request could not be completed.'
      : err.message,
    code: err.code || `HTTP_${status}`,
    instance: req.originalUrl
  };
  if (status === 429) {
    response.retryAfter = Math.max(0, Math.ceil((req.rateLimit?.resetTime?.getTime?.() - Date.now()) / 1000) || 0);
  }
  return response;
};
