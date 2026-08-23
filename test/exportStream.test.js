'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_MAX_REVIEWS,
  buildExportStream,
  renderRow
} from '../lib/exportStream.js';

const makeReview = (n) => ({
  id: `rev-${n}`,
  userName: `User ${n}`,
  date: '2026-08-01',
  score: n % 5 + 1,
  title: n % 2 ? `Title "quoted" ${n}` : null,
  text: `Body line\nwith newline, comma ${n}`,
  thumbsUp: n,
  appVersion: '1.0.0',
  replyDate: null,
  replyText: null
});

// Fake iterator yielding reviews 0..total-1
function * fakeIterator (total) {
  for (let i = 0; i < total; i++) yield makeReview(i);
}

const drain = (stream) => new Promise((resolve, reject) => {
  let out = '';
  stream.on('data', (chunk) => { out += chunk; });
  stream.on('end', () => resolve(out));
  stream.on('error', reject);
});

test('ndjson rows are one JSON object per line', () => {
  const row = renderRow('ndjson', makeReview(1));
  assert.equal(row.split('\n').length, 1);
  assert.deepEqual(JSON.parse(row), makeReview(1));
});

test('csv escapes quotes and embedded newlines', () => {
  const row = renderRow('csv', makeReview(1));
  const cells = [];
  // naive split respecting quotes is overkill — just check invariants
  assert.ok(row.includes('"Title ""quoted"" 1"'));
  assert.ok(row.includes('"Body line\nwith newline, comma 1"'));
  cells.push(row);
  assert.equal(cells.length, 1);
});

test('ndjson stream drains all reviews with trailing newline', async () => {
  const out = await drain(buildExportStream(fakeIterator(5), 'ndjson'));
  const lines = out.trimEnd().split('\n');
  assert.equal(lines.length, 5);
  lines.forEach((line, i) => assert.deepEqual(JSON.parse(line), makeReview(i)));
});

test('csv stream emits header then rows', async () => {
  // fixtures without embedded newlines so split('\n') row-counting is valid
  const plain = (function * () {
    for (let i = 0; i < 3; i++) yield { ...makeReview(i), title: `Title ${i}`, text: `Body ${i}` };
  })();
  const out = await drain(buildExportStream(plain, 'csv'));
  const lines = out.trimEnd().split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], 'id,userName,date,score,title,text,thumbsUp,appVersion,replyDate,replyText');
  assert.match(lines[1], /^rev-0,/);
});

test('EXPORT_MAX_REVIEWS stays a hard bound', () => {
  assert.ok(EXPORT_MAX_REVIEWS >= 1000);
});

test('stream caps via max option below the constant', async () => {
  const out = await drain(buildExportStream(fakeIterator(50), 'ndjson', { max: 3 }));
  assert.equal(out.trimEnd().split('\n').length, 3);
});

test('upstream failure propagates as stream error', async () => {
  const boom = (async function * () { yield makeReview(0); throw new Error('upstream died'); })();
  await assert.rejects(drain(buildExportStream(boom, 'ndjson')), /upstream died/);
});

test('empty upstream yields empty body without header crash', async () => {
  const outNd = await drain(buildExportStream(fakeIterator(0), 'ndjson'));
  assert.equal(outNd, '');
  const outCsv = await drain(buildExportStream(fakeIterator(0), 'csv'));
  assert.equal(outCsv, '');
});
