import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { migrateArchive } from '../scripts/migrate-archive.js';

test('migrate loads archive_entries for every Archive receptor', () => {
  const db = openDb(':memory:');
  migrate(db);
  const n = db.prepare('SELECT COUNT(*) c FROM archive_entries').get().c;
  assert.equal(n, 23);
});

test('archive_entries resolve to receptor ids and keep list fields as JSON', () => {
  const db = openDb(':memory:');
  migrate(db);
  const gabaa = db.prepare('SELECT * FROM archive_entries WHERE receptor_id=?').get('gabaa');
  assert.ok(gabaa && gabaa.abstract && gabaa.abstract.length > 10);
  const body = JSON.parse(gabaa.body_json);
  assert.ok(Array.isArray(body) && body.length > 0);
});

test('migrateArchive is idempotent (clear + reload)', () => {
  const db = openDb(':memory:');
  migrate(db);
  const first = db.prepare('SELECT COUNT(*) c FROM archive_entries').get().c;
  migrateArchive(db); migrateArchive(db);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM archive_entries').get().c, first);
});
