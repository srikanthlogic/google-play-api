'use strict';

import Express from 'express';
import router from './lib/index.js';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import morgan from 'morgan';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import logger from './lib/logger.js';
import { getErrorStatusCode, problemDetails } from './lib/errors.js';

const app = Express();
const port = process.env.PORT || 3000;

app.set('trust proxy', 1);

const corsOptions = {
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
const skipSuccessfulRequests = process.env.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS === 'true';
const skipFailedRequests = process.env.RATE_LIMIT_SKIP_FAILED_REQUESTS === 'true';
const rateLimitDisabled = process.env.RATE_LIMIT_DISABLED === 'true';
const v1Sunset = process.env.V1_SUNSET || 'Sat, 16 Aug 2027 00:00:00 GMT';

const limiter = rateLimit({
  windowMs,
  max: maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests,
  skipFailedRequests,
  handler: (req, res) => {
    const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
    res.set('Retry-After', retryAfterSeconds);
    res.status(429).json({
      error: {
        message: `Too many requests from this IP (${maxRequests} requests per ${Math.round(windowMs / 60000)} minutes). Please try again after ${retryAfterSeconds} seconds.`
      }
    });
  }
});
if (!rateLimitDisabled) {
  app.use('/api/', limiter);
}

app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(Express.json({ limit: '10mb' }));
app.use(Express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.LOGGING || false) {
  logger.info('Logging is enabled');
  app.use(morgan('combined'));
}

const swaggerDocument = JSON.parse(fs.readFileSync('./openapi/swagger.json', 'utf8'));

const options = {
  customCss: '.swagger-ui .topbar { display: none }'
};

app.use('/openapi.json', Express.static('openapi/swagger.json'));
app.use('/docs', Express.static('docs', { index: 'index.html' }));

app.get('/healthz', function (req, res) {
  res.json({ status: 'ok' });
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));
app.use('/api/', (req, res, next) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', v1Sunset);
  next();
});
app.use('/api/', router);
app.use('/v2/', router);

app.get('/', function (req, res) {
  res.redirect('/api-docs');
});

app.use((req, res, next) => {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});

app.use((err, req, res, _next) => {
  const status = getErrorStatusCode(err);
  logger.error({ error: err.message, stack: err.stack, code: err.code, status }, 'Request error');
  if (err.issues) {
    logger.error({ schemaIssues: err.issues }, 'Schema validation failure');
  }
  const problem = problemDetails(err, req, status);
  res.status(status);
  res.setHeader('Content-Type', 'application/problem+json');
  if (problem.retryAfter !== undefined) {
    res.setHeader('Retry-After', problem.retryAfter);
  }
  res.json(problem);
});

const server = app.listen(port, () => {
  logger.info(`Server started on port ${port}`);
});

const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  // Force exit after 5 seconds if connections don't close
  setTimeout(() => {
    logger.warn('Forcing shutdown after timeout');
    process.exit(0);
  }, 5000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
