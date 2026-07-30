import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { exportState, importState, sourceKey } from '../scripts/curator-state.mjs';

// db/atlas.db is not in git, and the migrations re-seed content from the committed
// HTML page literals. So a clone on another machine does not show an obviously empty
// desk: it shows a fully populated one carrying the SHIPPED content, with the
// curator's edits silently replaced. This file is what makes the work travel, and
// these tests pin the two properties that make it trustworthy: it carries only the
// delta, and every reference survives a rebuild that renumbers the rows.
const fresh = () => { const db = openDb(':memory:'); migrate(db); return db; };

test('a pristine database exports an empty delta', () => {
  const s = exportState(fresh());
  assert.deepEqual(s.sources, [], 'seeded sources are in the repo already');
  assert.deepEqual(s.receptorSources, [], 'seeded citations are in the repo already');
  assert.deepEqual(s.bindingSources, [], 'all 729 seeded binding citations are in the repo already');
  assert.deepEqual(s.content.claims, {});
  assert.deepEqual(s.content.bindings, []);
  assert.deepEqual(s.review, {}, 'an untouched review is not worth a line of diff');
});

test('review state survives the round trip', () => {
  const a = fresh();
  a.prepare(`UPDATE review_state SET mechanism=1, citation=1, mastery=4, note='check the PMID' WHERE receptor_id='d2'`).run();

  const b = fresh();
  importState(b, exportState(a));

  const got = b.prepare(`SELECT * FROM review_state WHERE receptor_id='d2'`).get();
  assert.equal(got.mechanism, 1);
  assert.equal(got.citation, 1);
  assert.equal(got.affinity, 0, 'an unticked check must not come back ticked');
  assert.equal(got.mastery, 4);
  assert.equal(got.note, 'check the PMID');
});

// The one that matters. sources.id is an autoincrement rowid: on another machine the
// same paper has a different number, so an edge stored as "source 17" is meaningless
// there. Every reference travels as a natural key instead.
test('a citation survives a rebuild that renumbers the sources', () => {
  const a = fresh();
  const id = a.prepare(`INSERT INTO sources (kind, authors, year, title, pmid)
    VALUES ('article', 'Nutt DJ', 2015, 'A paper the curator added', '25904081')`).run().lastInsertRowid;
  a.prepare(`INSERT INTO receptor_sources (receptor_id, source_id, status, is_primary) VALUES ('m1', ?, 'verified', 0)`).run(id);
  a.prepare(`INSERT INTO binding_sources (agent_name, target_alias, source_id, status) VALUES ('Fluoxetine', 'sert', ?, 'verified')`).run(id);

  const state = exportState(a);
  assert.equal(state.sources.length, 1, 'only the added paper travels, not the 33 seeded ones');
  assert.equal(state.sources[0].key, 'pmid:25904081');
  assert.equal(state.receptorSources[0].source, 'pmid:25904081', 'the edge points at the paper, not at a rowid');

  // Rebuild elsewhere, and force the ids apart so a rowid match cannot pass by luck.
  const b = fresh();
  b.prepare(`INSERT INTO sources (kind, title) VALUES ('article', 'a decoy that shifts every id')`).run();
  importState(b, state);

  const moved = b.prepare(`SELECT id FROM sources WHERE pmid = '25904081'`).get();
  assert.ok(moved, 'the added paper is recreated');
  assert.notEqual(moved.id, id, 'and it genuinely landed on a different rowid');
  const edge = b.prepare(`SELECT * FROM receptor_sources WHERE receptor_id='m1' AND source_id=?`).get(moved.id);
  assert.equal(edge.status, 'verified', 'the citation followed the paper to its new id');
  const bind = b.prepare(`SELECT * FROM binding_sources WHERE agent_name='Fluoxetine' AND target_alias='sert' AND source_id=?`).get(moved.id);
  assert.equal(bind.status, 'verified');
});

test('a status change on a seeded citation travels without copying the citation', () => {
  const a = fresh();
  const edge = a.prepare(`SELECT * FROM receptor_sources WHERE status != 'verified' LIMIT 1`).get();
  a.prepare(`UPDATE receptor_sources SET status='verified' WHERE receptor_id=? AND source_id=?`).run(edge.receptor_id, edge.source_id);

  const state = exportState(a);
  assert.equal(state.receptorSources.length, 1, 'only the edge that moved');
  assert.deepEqual(state.sources, [], 'the paper itself is unchanged, so it stays in the repo');

  const b = fresh();
  importState(b, state);
  const got = b.prepare(`SELECT status FROM receptor_sources WHERE receptor_id=? AND source_id=?`).get(edge.receptor_id, edge.source_id);
  assert.equal(got.status, 'verified');
});

test('content edited away from what the pages ship travels; the rest does not', () => {
  const a = fresh();
  a.prepare(`UPDATE claims SET text='A claim the curator rewrote' WHERE receptor_id='d2'`).run();
  a.prepare(`UPDATE archive_entries SET abstract='A rewritten abstract' WHERE receptor_id='d2'`).run();

  const state = exportState(a);
  assert.deepEqual(Object.keys(state.content.claims), ['d2'], 'only the claim that changed');
  assert.deepEqual(Object.keys(state.content.archive), ['d2']);
  assert.deepEqual(Object.keys(state.content.archive.d2), ['abstract'],
    'and only the field that changed, so the diff reads as a sentence');

  const b = fresh();
  importState(b, state);
  assert.equal(b.prepare(`SELECT text FROM claims WHERE receptor_id='d2'`).get().text, 'A claim the curator rewrote');
  assert.equal(b.prepare(`SELECT abstract FROM archive_entries WHERE receptor_id='d2'`).get().abstract, 'A rewritten abstract');
  // A neighbouring receptor must be untouched by the overlay.
  const c = fresh();
  assert.equal(b.prepare(`SELECT text FROM claims WHERE receptor_id='d1'`).get().text,
    c.prepare(`SELECT text FROM claims WHERE receptor_id='d1'`).get().text);
});

test('an edited Ki travels, and an untouched one does not', () => {
  const a = fresh();
  const row = a.prepare(`SELECT * FROM binding_values WHERE ki IS NOT NULL LIMIT 1`).get();
  a.prepare(`UPDATE binding_values SET ki = 42.5, note = 'remeasured' WHERE id = ?`).run(row.id);

  const state = exportState(a);
  assert.equal(state.content.bindings.length, 1, 'one of 729 moved, so one line of diff');
  assert.equal(state.content.bindings[0].agent_name, row.agent_name);
  assert.equal(state.content.bindings[0].ki, 42.5);

  const b = fresh();
  importState(b, state);
  const got = b.prepare(`SELECT ki, note FROM binding_values WHERE agent_name=? AND target_alias=?`).get(row.agent_name, row.target_alias);
  assert.equal(got.ki, 42.5);
  assert.equal(got.note, 'remeasured');
});

// migrate() runs this on every fresh seed, and a curator may also run it by hand.
test('importing twice leaves the same state as importing once', () => {
  const a = fresh();
  a.prepare(`UPDATE review_state SET mastery=3 WHERE receptor_id='d2'`).run();
  a.prepare(`INSERT INTO sources (kind, authors, title, pmid) VALUES ('article','Nutt DJ','Twice','99999')`).run();
  const state = exportState(a);

  const b = fresh();
  importState(b, state);
  const once = exportState(b);
  importState(b, state);
  const twice = exportState(b);

  assert.deepEqual(twice, once, 'the overlay is idempotent');
  assert.equal(b.prepare(`SELECT COUNT(*) c FROM sources WHERE pmid='99999'`).get().c, 1,
    'and does not duplicate the paper it already added');
});

test('a dump from an unknown format is refused rather than half-applied', () => {
  const db = fresh();
  assert.throws(() => importState(db, { format: 99 }), /unsupported curator-state format/);
});

test('an edge naming a source that cannot be resolved is skipped, not guessed', () => {
  const db = fresh();
  const before = db.prepare('SELECT COUNT(*) c FROM receptor_sources').get().c;
  importState(db, { format: 1, receptorSources: [{ receptor_id: 'm1', source: 'pmid:does-not-exist', status: 'verified', is_primary: 0 }] });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM receptor_sources').get().c, before,
    'a citation is never attached to a paper the dump did not carry');
});

test('the natural key prefers what identifies a paper in the world', () => {
  assert.equal(sourceKey({ pmid: '123', doi: '10.1/x', url: 'u' }), 'pmid:123');
  assert.equal(sourceKey({ doi: '10.1/X', url: 'u' }), 'doi:10.1/x', 'DOIs are case-insensitive');
  assert.equal(sourceKey({ url: 'https://example.org/a' }), 'url:https://example.org/a');
  assert.match(sourceKey({ kind: 'book', authors: 'Stahl SM', year: 2021, title: 'Ch 5' }), /^cite:book\|Stahl SM\|2021\|Ch 5$/);
});
