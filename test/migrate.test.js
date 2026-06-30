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

test('migrate loads sources and links the primary article with its status', () => {
  const db = openDb(':memory:');
  migrate(db);
  const m1 = db.prepare(`
    SELECT s.pmid, rs.status FROM receptor_sources rs
    JOIN sources s ON s.id = rs.source_id WHERE rs.receptor_id='m1' AND rs.is_primary=1`).get();
  assert.equal(m1.pmid, '24903776');
  assert.equal(m1.status, 'conflicting');
});

test('migrate seeds blank review_state for every receptor', () => {
  const db = openDb(':memory:');
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM review_state').get().c, RX.length);
});

test('a receptor with no peer-reviewed article gets no primary edge, but keeps its Stahl sources', () => {
  const db = openDb(':memory:');
  migrate(db);
  const primary = db.prepare("SELECT 1 FROM receptor_sources WHERE receptor_id='d3' AND is_primary=1").get();
  assert.equal(primary, undefined, 'd3 has no ref, so it should have no primary edge');
  const stahlEdges = db.prepare(`
    SELECT s.kind FROM receptor_sources rs JOIN sources s ON s.id = rs.source_id
    WHERE rs.receptor_id='d3'`).all();
  assert.ok(stahlEdges.length > 0, 'd3 should still carry its Stahl-chapter sources');
  assert.ok(stahlEdges.every(s => s.kind === 'book'), 'd3 sources should all be book-kind');
});

test('a shared article becomes ONE source row (dedupe by pmid)', () => {
  const db = openDb(':memory:');
  migrate(db);
  // m1 and m3 both cite Kruse 2014 (PMID 24903776) — they must share a source id
  const m1 = db.prepare("SELECT source_id FROM receptor_sources WHERE receptor_id='m1' AND is_primary=1").get();
  const m3 = db.prepare("SELECT source_id FROM receptor_sources WHERE receptor_id='m3' AND is_primary=1").get();
  assert.equal(m1.source_id, m3.source_id);
  const dupRows = db.prepare("SELECT COUNT(*) c FROM sources WHERE pmid='24903776'").get().c;
  assert.equal(dupRows, 1);
});

test('a shared Stahl chapter becomes ONE book source row (dedupe by chapter)', () => {
  const db = openDb(':memory:');
  migrate(db);
  // d1 and d2 both cite Stahl Ch 2 — they must share a source id, not duplicate it
  const ch2Rows = db.prepare(`
    SELECT id FROM sources WHERE kind='book' AND title LIKE 'Stahl 5e — Ch 2:%'`).all();
  assert.equal(ch2Rows.length, 1, 'Ch 2 should be exactly one source row');
});

test('Stahl-chapter edges are attached as non-primary', () => {
  const db = openDb(':memory:');
  migrate(db);
  const rows = db.prepare(`
    SELECT rs.is_primary FROM receptor_sources rs JOIN sources s ON s.id = rs.source_id
    WHERE rs.receptor_id='d1' AND s.kind='book'`).all();
  assert.ok(rows.length > 0);
  assert.ok(rows.every(r => r.is_primary === 0), 'book sources should never be primary');
});

test('re-running migrate is a safe no-op (idempotent, no duplication)', () => {
  const db = openDb(':memory:');
  const first = migrate(db);
  assert.equal(first.skipped, false);
  const counts = () => ({
    receptors: db.prepare('SELECT COUNT(*) c FROM receptors').get().c,
    sources: db.prepare('SELECT COUNT(*) c FROM sources').get().c,
    receptor_sources: db.prepare('SELECT COUNT(*) c FROM receptor_sources').get().c,
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
