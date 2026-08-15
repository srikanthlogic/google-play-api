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

  return 500;
};
