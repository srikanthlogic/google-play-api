'use strict';

import Express from 'express';
import router from './lib/index.js';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import morgan from 'morgan';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

const app = Express();
const port = process.env.PORT || 3000;

const corsOptions = {
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

const getEnvInt = (key, defaultValue, min = 1) => {
  const parsed = parseInt(process.env[key], 10);
  return Number.isNaN(parsed) || parsed < min ? defaultValue : parsed;
};

const getEnvBool = (key, defaultValue) => {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  return val === 'true' ? true : val === 'false' ? false : defaultValue;
};

const windowMs = getEnvInt('RATE_LIMIT_WINDOW_MS', 900000);
const maxRequests = getEnvInt('RATE_LIMIT_MAX_REQUESTS', 100);
const skipSuccessfulRequests = getEnvBool('RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS', false);
const skipFailedRequests = getEnvBool('RATE_LIMIT_SKIP_FAILED_REQUESTS', false);

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
        message: `Too many requests from this IP. Please try again after ${retryAfterSeconds} seconds.`
      }
    });
  }
});

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
  console.log('Logging is enabled');
  app.use(morgan('combined'));
}

const swaggerDocument = JSON.parse(fs.readFileSync('./openapi/swagger.json', 'utf8'));

const options = {
  customCss: '.swagger-ui .topbar { display: none }'
};

app.use('/openapi.json', Express.static('openapi/swagger.json'));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));
app.use('/api/', limiter, router);

app.get('/', function (req, res) {
  res.redirect('/api-docs');
});

app.use((req, res, next) => {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});

app.use((err, req, res) => {
  console.error(err.stack);
  res.status(err.status || 500);
  res.json({
    error: {
      message: err.message,
      ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {})
    }
  });
});

app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
