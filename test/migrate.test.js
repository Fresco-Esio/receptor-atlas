import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { RX } from '../scripts/seed-data.js';

test('migrate loads every receptor', () => {
  const db = openDb(':memory:');
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM receptors').get().c, RX.length);
});

test('migrate loads sources and links them with status', () => {
  const db = openDb(':memory:');
  migrate(db);
  const m1 = db.prepare(`
    SELECT s.pmid, rs.status FROM receptor_sources rs
    JOIN sources s ON s.id = rs.source_id WHERE rs.receptor_id='m1'`).get();
  assert.equal(m1.pmid, '24903776');
  assert.equal(m1.status, 'conflicting');
});

test('migrate seeds blank review_state for every receptor', () => {
  const db = openDb(':memory:');
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM review_state').get().c, RX.length);
});

test('needs-source receptors are linked with null source', () => {
  const db = openDb(':memory:');
  migrate(db);
  const d3 = db.prepare("SELECT source_id, status FROM receptor_sources WHERE receptor_id='d3'").get();
  assert.equal(d3.source_id, null);
  assert.equal(d3.status, 'needs-source');
});
