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

test('a shared paper becomes ONE source row (dedupe by pmid)', () => {
  const db = openDb(':memory:');
  migrate(db);
  // m1 and m3 both cite Kruse 2014 (PMID 24903776) — they must share a source id
  const m1 = db.prepare("SELECT source_id FROM receptor_sources WHERE receptor_id='m1'").get();
  const m3 = db.prepare("SELECT source_id FROM receptor_sources WHERE receptor_id='m3'").get();
  assert.equal(m1.source_id, m3.source_id);
  const dupRows = db.prepare("SELECT COUNT(*) c FROM sources WHERE pmid='24903776'").get().c;
  assert.equal(dupRows, 1);
});

test('re-running migrate is a safe no-op (idempotent, no duplication)', () => {
  const db = openDb(':memory:');
  const first = migrate(db);
  assert.equal(first.skipped, false);
  const counts = () => ({
    receptors: db.prepare('SELECT COUNT(*) c FROM receptors').get().c,
    sources: db.prepare('SELECT COUNT(*) c FROM sources').get().c,
    stahl: db.prepare('SELECT COUNT(*) c FROM stahl_loci').get().c,
  });
  const before = counts();
  const second = migrate(db);
  assert.equal(second.skipped, true);          // detected already-seeded
  assert.deepEqual(counts(), before);          // nothing duplicated
});

test('re-running migrate preserves user review data', () => {
  const db = openDb(':memory:');
  migrate(db);
  db.prepare("UPDATE review_state SET mechanism=1, mastery=4, note='mine' WHERE receptor_id='d2'").run();
  migrate(db); // second run must not wipe it
  const rs = db.prepare("SELECT mechanism, mastery, note FROM review_state WHERE receptor_id='d2'").get();
  assert.equal(rs.mechanism, 1);
  assert.equal(rs.mastery, 4);
  assert.equal(rs.note, 'mine');
});
