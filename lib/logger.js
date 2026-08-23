'use strict';

import pino from 'pino';
import { createRequire } from 'node:module';

const requireResolve = createRequire(import.meta.url);

// Pretty transport only when running outside production AND pino-pretty is
// actually installed — Docker builder stages run generateoas with dev deps
// omitted, and a missing transport target crashes pino at import time (#190).
function prettyTransport () {
  if (process.env.NODE_ENV === 'production') return undefined;
  try {
    requireResolve.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { colorize: true } };
  } catch {
    return undefined;
  }
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: prettyTransport()
});

export default logger;
