'use strict';

/**
 * Live-store smoke test.
 *
 * Spawns the API server, waits for readiness, then hits a small set of
 * endpoints that exercise the live Play Store via @mradex77/google-play-scraper.
 * Exits non-zero if any endpoint fails, so CI can alert on scraper breakage.
 *
 * Usage: node scripts/smoke.js
 */

import { spawn } from 'node:child_process';

const PORT = process.env.SMOKE_PORT || 3199;
const BASE = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

const CHECKS = [
  {
    name: 'app details',
    path: '/api/apps/com.whatsapp',
    validate: (data) => typeof data.title === 'string' && data.title.length > 0
  },
  {
    name: 'search',
    path: '/api/apps/?q=whatsapp',
    validate: (data) => Array.isArray(data.results) && data.results.length > 0
  },
  {
    name: 'top free list',
    path: '/api/lists/?category=GAME&collection=TOP_FREE&num=5',
    validate: (data) => Array.isArray(data.results) && data.results.length > 0
  }
];

function waitForServer (proc) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    const timer = setInterval(async () => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error(`Server did not become ready within ${READY_TIMEOUT_MS}ms`));
        return;
      }
      try {
        const res = await fetch(`${BASE}/api-docs/`, { signal: AbortSignal.timeout(2000) });
        if (res.ok || res.status === 301 || res.status === 302) {
          clearInterval(timer);
          resolve();
        }
      } catch {
        // not ready yet
      }
    }, 500);
    proc.on('exit', (code) => {
      clearInterval(timer);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });
}

async function runCheck (check) {
  const url = `${BASE}${check.path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status} for ${check.path}`);
  }
  const data = await res.json();
  if (!check.validate(data)) {
    throw new Error(`Empty or malformed response for ${check.path}`);
  }
}

async function main () {
  console.log(`Starting server on port ${PORT}...`);
  const server = spawn('node', ['server.js'], {
    env: { ...process.env, PORT, LOGGING: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(d));

  let failures = 0;
  try {
    await waitForServer(server);
    console.log('Server ready. Running smoke checks...\n');

    for (const check of CHECKS) {
      try {
        await runCheck(check);
        console.log(`  ✓ ${check.name} (${check.path})`);
      } catch (err) {
        failures++;
        console.error(`  ✗ ${check.name} (${check.path}): ${err.message}`);
      }
    }
  } finally {
    server.kill('SIGTERM');
  }

  console.log(failures === 0 ? '\nSmoke test PASSED' : `\nSmoke test FAILED (${failures} check(s))`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke test error:', err.message);
  process.exit(1);
});
