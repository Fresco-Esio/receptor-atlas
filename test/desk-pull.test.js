import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { exportState, importState } from '../scripts/curator-state.mjs';
import { buildSeed } from '../scripts/desk-seed.mjs';
import * as core from '../desk/desk-core.mjs';
import { canonicalise, pull, summaryOf, loadChanges } from '../scripts/desk-pull.mjs';

const fresh = () => { const db = openDb(':memory:'); migrate(db); return db; };
const AT = '2026-09-26T13:00:00.000Z';

test('round trip: converter output, canonicalised, equals a hand-edited database export', () => {
  const seed = buildSeed({ baseState: exportState(fresh()), commit: 'x' });
  let c = core.emptyChanges('d2', 'x');
  c = core.setField(c, 'archive.abstract', 'Rewritten.', AT);
  c = core.setField(c, 'clinical.onset', 'days', AT);
  c = core.setReview(c, { mechanism: 1, note: 'ok' }, AT);
  const meta = { kind: 'article', authors: 'Kapur S', year: 2003, title: 'Aberrant salience', journal: 'Am J Psychiatry', pmid: '12505794', doi: null, url: null, notes: null };
  c = core.attachSource(c, seed, meta, { is_primary: 0 }, AT);
  const viaDesk = canonicalise(core.toCuratorState(seed, [c]));

  const byHand = fresh();
  byHand.prepare(`UPDATE archive_entries SET abstract='Rewritten.' WHERE receptor_id='d2'`).run();
  const no = byHand.prepare(`SELECT no FROM clinical_rows WHERE receptor_id='d2'`).get().no;
  byHand.prepare(`UPDATE clinical_rows SET onset='days' WHERE no=?`).run(no);
  byHand.prepare(`UPDATE review_state SET mechanism=1, note='ok' WHERE receptor_id='d2'`).run();
  const sid = byHand.prepare(`INSERT INTO sources (kind,authors,year,title,journal,pmid,doi,url,notes) VALUES (?,?,?,?,?,?,?,?,?)`).run('article', 'Kapur S', 2003, 'Aberrant salience', 'Am J Psychiatry', '12505794', null, null, null).lastInsertRowid;
  byHand.prepare(`INSERT INTO receptor_sources (receptor_id, source_id, status, is_primary, correction_note) VALUES ('d2', ?, 'verified', 0, NULL)`).run(sid);
  const expected = exportState(byHand);
  expected.activity = viaDesk.activity;   // timestamps are the Desk's; the hand edit has none
  assert.deepEqual(viaDesk, expected);
  assert.equal(JSON.stringify(viaDesk, null, 1), JSON.stringify(expected, null, 1), 'byte-identical after canonicalisation');
});

test('pull refuses when the repo edits file moved since the seed', () => {
  const base = exportState(fresh());
  const seed = buildSeed({ baseState: base, commit: 'x' });
  const c = core.setField(core.emptyChanges('d2', 'x'), 'claim', 'New claim', AT);
  const ok = pull({ seed, changes: [c], repoState: base });
  assert.equal(ok.ok, true); assert.equal(ok.state.content.claims.d2, 'New claim'); assert.equal(ok.summary, '1 claim edit', 'summarised from the repo file to the new one (lib/git-publish.js)');
  const moved = { ...base, content: { ...base.content, claims: { sert: 'Someone edited this at the old Desk' } } };
  const no = pull({ seed, changes: [c], repoState: moved });
  assert.equal(no.ok, false); assert.equal(no.reason, 'seed moved'); assert.deepEqual(no.diff, ['content']);
});

test('a second publish is accepted: the repo edits file is what this Desk already published', () => {
  const base = exportState(fresh());
  const seed = buildSeed({ baseState: base, commit: 'x' });
  let c = core.setField(core.emptyChanges('d2', 'x'), 'claim', 'First publish', AT);
  const one = pull({ seed, changes: [c], repoState: base });
  assert.equal(one.ok, true);
  const repoState = JSON.parse(JSON.stringify(one.state, null, 1));   // written to db/curator-state.json and committed
  c = core.markPublished(c, 'sha1');
  c = core.setField(c, 'archive.abstract', 'Second publish', AT);
  const two = pull({ seed, changes: [c], repoState });
  assert.equal(two.ok, true, JSON.stringify(two.diff));
  assert.equal(two.state.content.claims.d2, 'First publish');
  assert.equal(two.state.content.archive.d2.abstract, 'Second publish');
  // and a repo file that matches neither the snapshot nor what was published is still refused
  const moved = { ...repoState, content: { ...repoState.content, claims: { ...repoState.content.claims, sert: 'elsewhere' } } };
  const no = pull({ seed, changes: [c], repoState: moved });
  assert.equal(no.ok, false); assert.equal(no.reason, 'seed moved'); assert.deepEqual(no.diff, ['content']);
});

test('pull summarises the repo file against the new one; the core summary only when there is no repo file', () => {
  // The seed carries a claim edited at the old Desk; the hosted Desk sets it back to what the atlas ships.
  const db = fresh(); db.prepare(`UPDATE claims SET text='Seed-era claim' WHERE receptor_id='d2'`).run();
  const base = exportState(db);
  const pristineClaim = fresh().prepare(`SELECT text FROM claims WHERE receptor_id='d2'`).get().text;
  const seed = buildSeed({ baseState: base, commit: 'x' });
  const c = core.setField(core.emptyChanges('d2', 'x'), 'claim', pristineClaim, AT);
  const r = pull({ seed, changes: [c], repoState: base });
  assert.equal(r.ok, true);
  assert.equal(r.state.content.claims.d2, undefined);
  assert.equal(r.summary, '1 change returned to what the atlas ships', 'a revert is counted (the core summary would call it a content edit)');
  assert.equal(summaryOf(null, r.state, [c]), '1 content edit', 'no repo file: the core summary of the changes');
  assert.equal(summaryOf(base, base, [c]), 'nothing to publish');
});

// A record that overwrites a published one keeps the published state as its predecessor, so the check
// still recognises the repo file after a revert, a re-edit or a detach of something published.
function published1() {
  const base = exportState(fresh());
  const seed = buildSeed({ baseState: base, commit: 'x' });
  let c = core.setField(core.emptyChanges('d2', 'x'), 'claim', 'Published claim', AT);
  c = core.setField(c, 'archive.abstract', 'Published abstract', AT);
  c = core.attachSource(c, seed, { kind: 'article', authors: 'Kapur S', year: 2003, title: 'Aberrant salience', journal: 'Am J Psychiatry', pmid: '12505794', doi: null, url: null, notes: null }, { is_primary: 0 }, AT);
  c = core.setReview(c, { mechanism: 1 }, AT);
  const one = pull({ seed, changes: [c], repoState: base });
  assert.equal(one.ok, true);
  return { seed, c: core.markPublished(c, 'sha1'), repoState: JSON.parse(JSON.stringify(one.state)) };
}
const T2 = '2026-09-26T14:00:00.000Z';

test('a revert of a published field is publishable', () => {
  const { seed, c, repoState } = published1();
  const two = pull({ seed, changes: [core.clearField(c, 'claim', T2)], repoState });
  assert.equal(two.ok, true, JSON.stringify(two.diff));
  assert.equal(two.state.content.claims.d2, undefined, 'the published claim is reverted');
  assert.equal(two.summary, '1 change returned to what the atlas ships');
});

test('a published field edited again is publishable, and publish 2 carries the new value', () => {
  const { seed, c, repoState } = published1();
  const two = pull({ seed, changes: [core.setField(c, 'archive.abstract', 'Edited again', T2)], repoState });
  assert.equal(two.ok, true, JSON.stringify(two.diff));
  assert.equal(two.state.content.archive.d2.abstract, 'Edited again');
  assert.equal(two.state.content.claims.d2, 'Published claim');
});

test('a published add, detached, is publishable: the edge and its library row are gone', () => {
  const { seed, c, repoState } = published1();
  const two = pull({ seed, changes: [core.detachSource(c, seed, 'pmid:12505794', T2)], repoState });
  assert.equal(two.ok, true, JSON.stringify(two.diff));
  assert.equal(two.state.receptorSources.some(e => e.receptor_id === 'd2' && e.source === 'pmid:12505794'), false);
  assert.equal(two.state.sources.some(x => x.key === 'pmid:12505794'), false);
});

test('every record kind edited again after a publish; after markPublishedFrom the third publish is accepted too', () => {
  const { seed, c, repoState } = published1();
  const seededKey = seed.receptors.find(r => r.id === 'd2').sources[0].key;
  let e = core.setSourceFlags(c, seed, 'pmid:12505794', { is_primary: 1 }, T2);
  e = core.setSourceFlags(e, seed, seededKey, { conflicting: true, correction_note: 'n' }, T2);
  e = core.setReview(e, { affinity: 1 }, T2);
  e = core.setField(e, 'claim', 'Claim 2', T2);
  const two = pull({ seed, changes: [e], repoState });
  assert.equal(two.ok, true, JSON.stringify(two.diff));
  const marked = core.markPublishedFrom(e, e, 'sha2');
  assert.equal(JSON.stringify(marked).includes('"published"'), false, 'the predecessors are dropped once marked');
  const three = pull({ seed, changes: [core.setField(marked, 'claim', 'Claim 3', '2026-09-26T15:00:00.000Z')], repoState: JSON.parse(JSON.stringify(two.state)) });
  assert.equal(three.ok, true, JSON.stringify(three.diff));
  assert.equal(three.state.content.claims.d2, 'Claim 3');
});

test('loadChanges reads an array file or a directory of documents, skips unknown receptors, and rejects other shapes', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const seed = { receptors: [{ id: 'd2' }, { id: 'd1' }] };
  const doc = id => core.setField(core.emptyChanges(id, 'x'), 'claim', 'c ' + id, AT);
  const dir = mkdtempSync(join(tmpdir(), 'desk-pull-'));
  writeFileSync(join(dir, 'd2.json'), JSON.stringify(doc('d2')));
  writeFileSync(join(dir, 'd1.json'), JSON.stringify(doc('d1')));
  writeFileSync(join(dir, 'zz.json'), JSON.stringify(doc('zz')));
  writeFileSync(join(dir, 'notes.txt'), 'not json');
  const notes = [];
  const fromDir = loadChanges(dir, seed, n => notes.push(n));
  assert.deepEqual(fromDir.map(c => c.receptorId), ['d1', 'd2'], 'every *.json, in name order, unknown receptors skipped');
  assert.equal(notes.length, 1); assert.match(notes[0], /zz/);
  const file = join(dir, 'changes.array');
  writeFileSync(file, JSON.stringify([doc('d2'), doc('zz')]));
  assert.deepEqual(loadChanges(file, seed, () => {}).map(c => c.receptorId), ['d2']);
  writeFileSync(file, JSON.stringify({ d2: doc('d2') }));
  assert.throws(() => loadChanges(file, seed, () => {}), /must be an array of change documents/);
  writeFileSync(file, JSON.stringify([{ receptorId: 'd2' }]));
  assert.throws(() => loadChanges(file, seed, () => {}), /item 0.*fields/);
  const bad = mkdtempSync(join(tmpdir(), 'desk-pull-'));
  writeFileSync(join(bad, 'd2.json'), JSON.stringify([doc('d2')]));
  assert.throws(() => loadChanges(bad, seed, () => {}), /d2\.json.*a change document/);
});
