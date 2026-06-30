import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';

test('schema creates archive_entries', () => {
  const db = openDb(':memory:');
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(names.includes('archive_entries'), 'archive_entries table should exist');
});
