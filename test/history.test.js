'use strict';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as history from '../lib/history.js';

beforeEach(() => {
  history.resetHistoryCache();
  process.env.HISTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'b9-history-'));
});

const app = (over = {}) => Object.assign({
  appId: 'com.example.hist',
  title: 'Example',
  url: 'https://play.google.com/store/apps/details?id=com.example.hist',
  version: '1.0.0',
  score: 4.2,
  price: 0,
  contentRating: 'Everyone'
}, over);

test('B9: first snapshot is written and second identical snapshot is deduped', async () => {
  const wrote = await history.snapshotApp(app());
  assert.equal(wrote, true);
  // identical field values -> no duplicate line
  const dup = await history.snapshotApp(app());
  assert.equal(dup, false);
  const snaps = await history.getHistory('com.example.hist');
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].version, '1.0.0');
  assert.equal(snaps[0].appId, 'com.example.hist');
});

test('B9: changed fields produce a new snapshot and field-level diffs', async () => {
  await history.snapshotApp(app());
  await history.snapshotApp(app({ version: '1.1.0', score: 4.5 }));
  const changes = await history.getChanges('com.example.hist', null);
  assert.equal(changes.length, 2);
  const versionChange = changes.find(c => c.field === 'version');
  assert.deepEqual({ from: versionChange.from, to: versionChange.to }, { from: '1.0.0', to: '1.1.0' });
  const scoreChange = changes.find(c => c.field === 'score');
  assert.equal(scoreChange.to, 4.5);
  assert.ok(versionChange.at && scoreChange.at);
});

test('B9: getChanges filters by ?since= ISO date', async () => {
  await history.snapshotApp(app({ version: '1.0.0', score: 4 }));
  const snaps = await history.getHistory('com.example.hist');
  const mid = new Date(new Date(snaps[0].at).getTime() + 1).toISOString();
  await history.snapshotApp(app({ version: '2.0.0', score: 4 }));
  const all = await history.getChanges('com.example.hist', null);
  assert.equal(all.length, 1);
  const afterMid = await history.getChanges('com.example.hist', mid);
  assert.equal(afterMid.length, 1);
  assert.equal(afterMid[0].to, '2.0.0');
  const beforeAll = await history.getChanges('com.example.hist', new Date(Date.now() + 60_000).toISOString());
  assert.deepEqual(beforeAll, []);
});

test('B9: unknown app returns empty results (200, not 404)', async () => {
  assert.deepEqual(await history.getHistory('com.unknown.app'), []);
  assert.deepEqual(await history.getChanges('com.unknown.app', null), []);
});

test('B9: snapshot ignores apps without an id and tolerates missing optional fields', async () => {
  assert.equal(await history.snapshotApp({ title: 'no id' }), false);
  const ok = await history.snapshotApp({ appId: 'com.example.min', title: 'Min' });
  assert.equal(ok, true);
});
