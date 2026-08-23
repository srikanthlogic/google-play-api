'use strict';

/**
 * C5: Upstream integrity events + health probe.
 *
 * Two halves:
 *  1. recordIntegrity() — modules (cache, breaker, retry, schemas) push
 *     degradation/drift events into a bounded ring buffer. Consumed by
 *     GET /v2/health and mirrored to the process log.
 *  2. probeUpstream() — a real gplay call used to distinguish
 *    "no traffic lately" from "upstream is actually healthy".
 *
 * Alerting: if TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set, critical
 * events (schema drift, breaker open) fire a Telegram message, throttled
 * per event kind so a storm doesn't spam the channel.
 */

import logger from './logger.js';
import gplay from '@mradex77/google-play-scraper';
import { cacheStats, coalesceStats } from './cache.js';
import { breakerStats } from './breaker.js';
import { retryStats } from './retry.js';

const MAX_EVENTS = 50;
const ALERT_THROTTLE_MS = 10 * 60_000; // one alert per kind per 10 min

const events = [];
const lastAlertAt = {}; // kind -> epoch ms

export const recordIntegrity = (event) => {
  const entry = Object.assign({ at: new Date().toISOString() }, event);
  events.push(entry);
  if (events.length > MAX_EVENTS) events.shift();
  logger.warn(entry, 'Integrity event');
  maybeAlert(entry);
};

const CRITICAL_KINDS = new Set(['schema_drift', 'breaker_open']);

const maybeAlert = (entry) => {
  if (!CRITICAL_KINDS.has(entry.kind)) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const now = Date.now();
  if (now - (lastAlertAt[entry.kind] || 0) < ALERT_THROTTLE_MS) return;
  lastAlertAt[entry.kind] = now;

  const text = `🚨 GPlayAPI v2: ${entry.kind}\n${entry.detail || ''}\n${entry.at}`;
  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  }).catch((err) => logger.error({ errMessage: err.message }, 'Telegram alert failed'));
};

/** Real upstream liveness check — bypasses the circuit breaker on purpose. */
const probeUpstream = async () => {
  try {
    await gplay.app({ appId: 'com.google.android.gm', country: 'US', lang: 'en' });
    return true;
  } catch (err) {
    logger.warn({ errMessage: err.message }, 'Health probe upstream call failed');
    return false;
  }
};

/**
 * GET /v2/health — deep health snapshot for monitoring.
 * `?probe=true` performs a live upstream fetch (~1s); without it the
 * endpoint is instant and reflects only observed traffic stats.
 */
export const buildHealthReport = async ({ probe } = {}) => {
  const report = {
    status: 'ok',
    uptimeSec: Math.round(process.uptime()),
    cache: { ...cacheStats },
    coalesce: { joined: coalesceStats.joined },
    breaker: breakerStats(),
    retry: { ...retryStats },
    recentEvents: events.slice(-10).reverse()
  };
  if (!probe) return report;

  const upstreamOk = await probeUpstream();
  report.probe = { ok: upstreamOk };
  report.status = upstreamOk ? 'ok' : 'degraded';
  return report;
};

/** Test helper: drop all recorded events and alert throttle state. */
export const resetIntegrity = () => {
  events.length = 0;
  for (const k of Object.keys(lastAlertAt)) delete lastAlertAt[k];
};
