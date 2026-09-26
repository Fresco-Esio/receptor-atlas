import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { importState, exportState, sourceKey } from '../scripts/curator-state.mjs';
import { archiveNarrative, ledgerClinical } from '../lib/queries.js';
import { buildSeed } from '../scripts/desk-seed.mjs';

const fresh = () => { const db = openDb(':memory:'); migrate(db); return db; };

test('seed carries every receptor, with the archive and ledger the API serves', () => {
  const db = fresh();
  db.prepare(`UPDATE archive_entries SET abstract='Edited abstract' WHERE receptor_id='sert'`).run();
  const baseState = exportState(db);
  const seed = buildSeed({ baseState, commit: 'abc1234' });
  assert.equal(seed.format, 1); assert.equal(seed.commit, 'abc1234'); assert.ok(seed.builtAt);
  assert.equal(seed.receptors.length, 24);
  assert.deepEqual(seed.baseState, baseState);
  const sert = seed.receptors.find(r => r.id === 'sert');
  assert.equal(sert.archive.abstract, 'Edited abstract', 'current state includes the edits file');
  assert.equal(seed.pristine.archive.sert.abstract !== 'Edited abstract', true, 'pristine is what the pages ship');
  // field-for-field against the API queries on an equivalent database
  const current = fresh(); importState(current, baseState);
  for (const row of archiveNarrative(current)) {
    const r = seed.receptors.find(x => x.id === row.receptor_id);
    assert.deepEqual(r.archive, { abstract: row.abstract, presentation: row.presentation, effect: row.effect, receptor_class: row.receptor_class, ligand: row.ligand, figure_caption: row.figure_caption, body: row.body, tags: row.tags });
    assert.equal(r.archiveAlias, row.alias);
  }
  for (const row of ledgerClinical(current)) {
    const r = seed.receptors.find(x => x.clinicalNo === row.no);
    assert.ok(r, `row ${row.no} has a receptor`);
    for (const k of ['sys', 'name', 'cls', 'baseline', 'mech', 'stahl', 'over', 'under', 'agonists', 'antagonists']) assert.deepEqual(r.clinical[k], row[k], k);
    assert.deepEqual(r.clinical.risk_factors, []); assert.equal(r.clinical.onset, null);
  }
});

test('seed sources are keyed by natural key and edges carry status, primary and note', () => {
  const seed = buildSeed({ baseState: exportState(fresh()), commit: 'x' });
  const d2 = seed.receptors.find(r => r.id === 'd2');
  assert.ok(d2.sources.length >= 1);
  for (const s of d2.sources) { assert.match(s.key, /^(pmid|doi|url|cite):/); assert.ok(seed.sources[s.key], 'library has the paper'); assert.ok('is_primary' in s && 'status' in s && 'correction_note' in s); }
  assert.deepEqual(seed.pristine.receptorSources[`d2|${d2.sources[0].key}`], { status: d2.sources[0].status, is_primary: d2.sources[0].is_primary, correction_note: d2.sources[0].correction_note });
  const db = fresh();
  const anyRow = db.prepare('SELECT * FROM sources LIMIT 1').get();
  assert.ok(seed.pristine.sources[sourceKey(anyRow)]);
});

test('review and volumes come through', () => {
  const db = fresh();
  db.prepare(`UPDATE review_state SET mechanism=1, note='n' WHERE receptor_id='d2'`).run();
  const seed = buildSeed({ baseState: exportState(db), commit: 'x' });
  const d2 = seed.receptors.find(r => r.id === 'd2');
  assert.deepEqual(d2.review, { mechanism: 1, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: 'n' });
  assert.deepEqual(d2.volumes, ['archive', 'cabinet', 'ledger']);
  assert.deepEqual(seed.pristine.review.d2, { mechanism: 0, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: '' });
});
