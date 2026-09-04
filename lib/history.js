'use strict';

/**
 * B9: App history / change detection.
 * Captures lightweight snapshots of tracked fields every time an app detail
 * response is validated, and exposes the timeline + field-level diffs.
 * Persistence is append-only JSONL (one file per appId) written via
 * fs.appendFile — never on the request critical path.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import logger from './logger.js';

const TRACKED_FIELDS = ['version', 'score', 'ratings', 'price', 'priceText', 'currency', 'contentRating', 'updated'];

// In-memory last-known snapshot per appId so we skip unchanged writes
// without re-reading the file on every request. Seeded lazily from disk.
const lastSnapshot = new Map();

function snapshotDir () {
  return process.env.HISTORY_DIR || '.data/history';
}

function snapshotFile (appId) {
  return path.join(snapshotDir(), `${encodeURIComponent(appId)}.jsonl`);
}

function extractSnapshot (appId, app) {
  const snap = { at: new Date().toISOString(), appId };
  for (const field of TRACKED_FIELDS) {
    if (app[field] !== undefined && app[field] !== null && typeof app[field] !== 'object') {
      snap[field] = app[field];
    }
  }
  return snap;
}

async function loadLastSnapshot (appId) {
  if (lastSnapshot.has(appId)) return lastSnapshot.get(appId);
  try {
    const raw = await fsp.readFile(snapshotFile(appId), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const last = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
    lastSnapshot.set(appId, last);
    return last;
  } catch {
    return null; // no history yet
  }
}

/**
 * Record a snapshot for an app. Fire-and-forget by design: callers invoke
 * this without await so a slow disk write can never block a response.
 */
export function snapshotApp (app) {
  if (!app || !app.appId) return Promise.resolve(false);
  const appId = app.appId;
  return loadLastSnapshot(appId).then((prev) => {
    if (prev) {
      const changed = TRACKED_FIELDS.some((f) =>
        prev[f] !== undefined && prev[f] !== app[f]);
      if (!changed) return false;
    }
    const snap = extractSnapshot(appId, app);
    lastSnapshot.set(appId, snap);
    return fsp.mkdir(snapshotDir(), { recursive: true })
      .then(() => fsp.appendFile(snapshotFile(appId), `${JSON.stringify(snap)}\n`))
      .then(() => true)
      .catch((err) => {
        logger.warn({ errMessage: err.message }, 'History write failed');
        return false;
      });
  }).catch((err) => {
    logger.warn({ errMessage: err.message }, 'History snapshot failed');
    return false;
  });
}

/** Test helper: forget in-memory last-known snapshots (per HISTORY_DIR). */
export function resetHistoryCache () {
  lastSnapshot.clear();
}

/** Full snapshot timeline for one app (oldest first). */
export async function getHistory (appId) {
  let raw;
  try {
    raw = await fsp.readFile(snapshotFile(appId), 'utf8');
  } catch {
    return [];
  }
  return raw.split('\n').filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/** Field-level diffs between consecutive snapshots after `since` (ISO date). */
export async function getChanges (appId, since) {
  const snaps = await getHistory(appId);
  const sinceMs = since ? Date.parse(since) : NaN;
  const changes = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1];
    const cur = snaps[i];
    if (!Number.isNaN(sinceMs) && Date.parse(cur.at) < sinceMs) continue;
    for (const field of TRACKED_FIELDS) {
      if (field in prev && field in cur && prev[field] !== cur[field]) {
        changes.push({ field, from: prev[field], to: cur[field], at: cur.at });
      }
    }
  }
  return changes;
}
