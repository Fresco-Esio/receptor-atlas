import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { exportState, importState } from '../scripts/curator-state.mjs';
import { buildSeed } from '../scripts/desk-seed.mjs';
import * as core from '../desk/desk-core.mjs';
import { canonicalise, pull } from '../scripts/desk-pull.mjs';

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
  assert.equal(ok.ok, true); assert.equal(ok.state.content.claims.d2, 'New claim'); assert.equal(ok.summary, '1 content edit');
  const moved = { ...base, content: { ...base.content, claims: { sert: 'Someone edited this at the old Desk' } } };
  const no = pull({ seed, changes: [c], repoState: moved });
  assert.equal(no.ok, false); assert.equal(no.reason, 'seed moved'); assert.deepEqual(no.diff, ['content']);
});
