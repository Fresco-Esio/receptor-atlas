import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../desk/desk-core.mjs';

// A hand-built seed with one receptor, small enough to reason about. Shape as Task 3 emits.
function seed() {
  return {
    format: 1, builtAt: '2026-09-26T12:00:00Z', commit: 'abc1234',
    baseState: { format: 1, review: {}, activity: [], bindingReview: [], sources: [], receptorSources: [], bindingSources: [],
      content: { claims: {}, archive: {}, clinical: {}, bindings: [] } },
    receptors: [{
      id: 'd2', label: 'Dopamine D2', system: 'dopamine', hall: 'dopamine', volumes: ['archive', 'cabinet', 'ledger'],
      archiveAlias: '3', clinicalNo: 3,
      archive: { abstract: 'Old abstract.', presentation: 'p', effect: 'e', receptor_class: 'GPCR', ligand: 'DA', figure_caption: 'Fig',
                 body: ['Para one.', 'Para two.'], tags: ['a', 'b'] },
      claim: 'D2 claim.',
      clinical: { no: 3, sys: 'dopamine', name: 'D2', cls: 'GPCR', baseline: 'b', mech: 'm', stahl: 's',
                  over: ['o1'], under: ['u1'], agonists: [], antagonists: ['haloperidol'],
                  onset: null, time_course: null, risk_factors: [], monitoring: [] },
      sources: [{ key: 'pmid:24463000', is_primary: 1, status: 'verified', correction_note: null }],
      review: { mechanism: 0, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: '' },
      activity: [],
    }],
    pristine: {
      archive: { d2: { abstract: 'Old abstract.', presentation: 'p', effect: 'e', receptor_class: 'GPCR', ligand: 'DA', figure_caption: 'Fig',
                       body_json: JSON.stringify(['Para one.', 'Para two.']), tags_json: JSON.stringify(['a', 'b']) } },
      claims: { d2: 'D2 claim.' },
      clinical: { 3: { sys: 'dopamine', name: 'D2', cls: 'GPCR', baseline: 'b', mech: 'm', over_json: JSON.stringify(['o1']), under_json: JSON.stringify(['u1']),
                       stahl: 's', agonists_json: '[]', antagonists_json: JSON.stringify(['haloperidol']),
                       onset: null, time_course: null, risk_factors_json: null, monitoring_json: null } },
      review: { d2: { mechanism: 0, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: '' } },
      receptorSources: { 'd2|pmid:24463000': { status: 'verified', is_primary: 1, correction_note: null } },
      sources: { 'pmid:24463000': { kind: 'article', authors: 'Beaulieu JM', year: 2011, title: 'Dopamine receptors', journal: 'Pharmacol Rev', pmid: '24463000', doi: null, url: null, notes: null } },
    },
    sources: { 'pmid:24463000': { kind: 'article', authors: 'Beaulieu JM', year: 2011, title: 'Dopamine receptors', journal: 'Pharmacol Rev', pmid: '24463000', doi: null, url: null, notes: null } },
  };
}
const AT = '2026-09-26T13:00:00.000Z';

test('sourceKey matches the repo rule', () => {
  assert.equal(core.sourceKey({ pmid: ' 123 ' }), 'pmid:123');
  assert.equal(core.sourceKey({ doi: '10.1/AB' }), 'doi:10.1/ab');
  assert.equal(core.sourceKey({ url: 'https://x' }), 'url:https://x');
  assert.equal(core.sourceKey({ kind: 'book', authors: 'S', year: 2021, title: 'T' }), 'cite:book|S|2021|T');
});

test('viewOf lays changes over the seed', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.abstract', 'New abstract.', AT);
  c = core.setField(c, 'clinical.over', ['o1', 'o2'], AT);
  const v = core.viewOf(s.receptors[0], c);
  assert.equal(v.archive.abstract, 'New abstract.');
  assert.deepEqual(v.clinical.over, ['o1', 'o2']);
  assert.equal(v.archive.body[0], 'Para one.', 'untouched fields come from the seed');
  assert.equal(s.receptors[0].archive.abstract, 'Old abstract.', 'the seed is not mutated');
});

test('a field edit exports as a content delta; setting it back removes the delta', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.abstract', 'New abstract.', AT);
  let out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.content.archive, { d2: { abstract: 'New abstract.' } });
  c = core.setField(c, 'archive.abstract', 'Old abstract.', AT);
  out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.content.archive, {}, 'equal to pristine means no line in the dump');
});

test('list fields serialise the way the router does', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.tags', ['a', 'b', 'c'], AT);
  c = core.setField(c, 'clinical.monitoring', ['ECG'], AT);
  const out = core.toCuratorState(s, [c]);
  assert.equal(out.content.archive.d2.tags_json, JSON.stringify(['a', 'b', 'c']));
  assert.equal(out.content.clinical['3'].monitoring_json, JSON.stringify(['ECG']));
});

test('claim edits go to content.claims', () => {
  const s = seed(); const c = core.setField(core.emptyChanges('d2', s.commit), 'claim', 'Better claim.', AT);
  assert.deepEqual(core.toCuratorState(s, [c]).content.claims, { d2: 'Better claim.' });
});

test('attaching a new source adds the library row and a verified edge', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  const meta = { kind: 'article', authors: 'Kapur S', year: 2003, title: 'Aberrant salience', journal: 'Am J Psychiatry', pmid: '12505794', doi: null, url: null, notes: null };
  c = core.attachSource(c, s, meta, { is_primary: 0 }, AT);
  const out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.sources, [{ key: 'pmid:12505794', ...meta }]);
  assert.deepEqual(out.receptorSources, [{ receptor_id: 'd2', source: 'pmid:12505794', status: 'verified', is_primary: 0, correction_note: null }]);
});

test('flagging a seeded source as conflicting changes only that edge; unflagging removes the line', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setSourceFlags(c, s, 'pmid:24463000', { conflicting: true, correction_note: 'year is 2011 not 2010' }, AT);
  let out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.receptorSources, [{ receptor_id: 'd2', source: 'pmid:24463000', status: 'conflicting', is_primary: 1, correction_note: 'year is 2011 not 2010' }]);
  assert.deepEqual(out.sources, [], 'the paper itself did not change');
  c = core.setSourceFlags(c, s, 'pmid:24463000', { conflicting: false, correction_note: null }, AT);
  out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.receptorSources, []);
});

test('a seeded source cannot be detached; a change-added one can', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  assert.throws(() => core.detachSource(c, s, 'pmid:24463000', AT), /seeded source/);
  const meta = { kind: 'article', authors: 'X', year: 2020, title: 'T', journal: 'J', pmid: '999', doi: null, url: null, notes: null };
  c = core.attachSource(c, s, meta, { is_primary: 0 }, AT);
  c = core.detachSource(c, s, 'pmid:999', AT);
  const out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.sources, []); assert.deepEqual(out.receptorSources, []);
});

test('review marks export only when something is set, in the repo key order', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setReview(c, { mechanism: 1, note: 'checked Gi coupling' }, AT);
  const out = core.toCuratorState(s, [c]);
  assert.deepEqual(Object.keys(out.review.d2), ['mechanism', 'affinity', 'clinical', 'citation', 'mastery', 'note']);
  assert.deepEqual(out.review.d2, { mechanism: 1, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: 'checked Gi coupling' });
  c = core.setReview(c, { mechanism: 0, note: '' }, AT);
  assert.deepEqual(core.toCuratorState(s, [c]).review, {});
});

test('activity is stamped per volume from the change timestamps', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.abstract', 'A', '2026-09-26T13:00:00.000Z');
  c = core.setField(c, 'clinical.onset', 'days', '2026-09-26T14:00:00.000Z');
  c = core.setReview(c, { clinical: 1 }, '2026-09-26T15:00:00.000Z');
  const a = core.toCuratorState(s, [c]).activity;
  assert.deepEqual(a.find(x => x.volume === 'archive'), { receptor_id: 'd2', volume: 'archive', last_edited_at: '2026-09-26T13:00:00.000Z', last_reviewed_at: '2026-09-26T15:00:00.000Z' });
  assert.deepEqual(a.find(x => x.volume === 'ledger'), { receptor_id: 'd2', volume: 'ledger', last_edited_at: '2026-09-26T14:00:00.000Z', last_reviewed_at: '2026-09-26T15:00:00.000Z' });
  assert.deepEqual(a.find(x => x.volume === 'cabinet'), { receptor_id: 'd2', volume: 'cabinet', last_edited_at: null, last_reviewed_at: '2026-09-26T15:00:00.000Z' });
});

test('baseState entries the changes do not touch are carried through untouched', () => {
  const s = seed();
  s.baseState.content.archive.d2 = { effect: 'Seed-era edit' };
  s.receptors[0].archive.effect = 'Seed-era edit';
  const c = core.setField(core.emptyChanges('d2', s.commit), 'archive.abstract', 'New', AT);
  const out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.content.archive.d2, { abstract: 'New', effect: 'Seed-era edit' });
  assert.deepEqual(Object.keys(out), ['format', 'review', 'activity', 'bindingReview', 'sources', 'receptorSources', 'bindingSources', 'content']);
});

test('summarise, markPublished, countUnpublished, rekey', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.abstract', 'New', AT);
  c = core.setSourceFlags(c, s, 'pmid:24463000', { conflicting: true, correction_note: 'n' }, AT);
  assert.equal(core.summarise([c]), '1 content edit, 1 conflict noted');
  assert.equal(core.countUnpublished([c]), 2);
  const p = core.markPublished(c, 'deadbee');
  assert.equal(core.countUnpublished([p]), 0);
  assert.equal(p.fields['archive.abstract'].publishedAs, 'deadbee');
  const r = core.rekey(p, { ...s, commit: 'new1234' });
  assert.equal(r.seedCommit, 'new1234');
  assert.deepEqual(r.fields, {}, 'published fields fold into the new seed');
  const u = core.rekey(core.setField(p, 'claim', 'x', AT), { ...s, commit: 'new1234' });
  assert.deepEqual(Object.keys(u.fields), ['claim'], 'unpublished ones survive a re-seed');
});

// --- fix round 1 ---

test('setReview merges a partial update over the previous stored partial and over the base on export', () => {
  const s = seed();
  s.baseState.review.d2 = { mechanism: 1, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: 'prior note' };
  s.receptors[0].review = { mechanism: 1, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: 'prior note' };
  const c = core.setReview(core.emptyChanges('d2', s.commit), { affinity: 1 }, AT);
  const out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.review.d2, { mechanism: 1, affinity: 1, clinical: 0, citation: 0, mastery: 0, note: 'prior note' });
  const v = core.viewOf(s.receptors[0], c);
  assert.equal(v.review.note, 'prior note');
});

test('setField rejects an unknown field path', () => {
  const s = seed();
  assert.throws(() => core.setField(core.emptyChanges('d2', s.commit), 'nope', 'x', AT), /unknown field path: nope/);
});

test('a clinical.* edit for a receptor with no Ledger row throws', () => {
  const s = seed(); s.receptors[0].clinicalNo = null;
  const c = core.setField(core.emptyChanges('d2', s.commit), 'clinical.onset', 'days', AT);
  assert.throws(() => core.toCuratorState(s, [c]), /receptor has no Ledger row: d2/);
});

test('toCuratorState rejects an unknown receptorId', () => {
  const s = seed();
  const c = core.emptyChanges('ghost', s.commit);
  assert.throws(() => core.toCuratorState(s, [c]), /unknown receptor: ghost/);
});

test('detachSource on a key that is neither seeded nor added throws "unknown source"', () => {
  const s = seed();
  const c = core.emptyChanges('d2', s.commit);
  assert.throws(() => core.detachSource(c, s, 'pmid:000000', AT), /unknown source: pmid:000000/);
});

test('viewOf clones list values so the view never shares arrays with the store', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'clinical.over', ['o1', 'o2'], AT);
  const v = core.viewOf(s.receptors[0], c);
  v.clinical.over.push('o3');
  assert.deepEqual(c.fields['clinical.over'].value, ['o1', 'o2'], 'mutating the view must not mutate the stored change');
});

test('setSourceFlags on a change-added source: flip conflicting on, then note null clears it', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  const meta = { kind: 'article', authors: 'X', year: 2020, title: 'T', journal: 'J', pmid: '999', doi: null, url: null, notes: null };
  c = core.attachSource(c, s, meta, { is_primary: 0 }, AT);
  c = core.setSourceFlags(c, s, 'pmid:999', { conflicting: true, correction_note: 'flagged' }, AT);
  let out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.receptorSources, [{ receptor_id: 'd2', source: 'pmid:999', status: 'conflicting', is_primary: 0, correction_note: 'flagged' }]);
  c = core.setSourceFlags(c, s, 'pmid:999', { correction_note: null }, AT);
  out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.receptorSources, [{ receptor_id: 'd2', source: 'pmid:999', status: 'conflicting', is_primary: 0, correction_note: null }], 'conflicting untouched, note cleared');
});

test('setSourceFlags: an explicit undefined flag does not overwrite the stored value', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setSourceFlags(c, s, 'pmid:24463000', { conflicting: true, correction_note: 'n' }, AT);
  c = core.setSourceFlags(c, s, 'pmid:24463000', { is_primary: undefined, conflicting: undefined }, AT);
  const out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.receptorSources, [{ receptor_id: 'd2', source: 'pmid:24463000', status: 'conflicting', is_primary: 1, correction_note: 'n' }]);
});

function twoReceptorSeed() {
  const s = seed();
  s.receptors.push({
    id: 'mu', label: 'Mu Opioid Receptor', system: 'opioid', hall: 'opioid', volumes: ['archive', 'cabinet', 'ledger'],
    archiveAlias: '9', clinicalNo: 9,
    archive: { abstract: 'Mu abstract.', presentation: 'p', effect: 'e', receptor_class: 'GPCR', ligand: 'Endorphin', figure_caption: 'Fig',
               body: ['Mu para.'], tags: ['x'] },
    claim: 'Mu claim.',
    clinical: { no: 9, sys: 'opioid', name: 'MOR', cls: 'GPCR', baseline: 'b', mech: 'm', stahl: 's',
                over: [], under: [], agonists: ['morphine'], antagonists: [],
                onset: null, time_course: null, risk_factors: [], monitoring: [] },
    sources: [],
    review: { mechanism: 0, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: '' },
    activity: [],
  });
  s.pristine.archive.mu = { abstract: 'Mu abstract.', presentation: 'p', effect: 'e', receptor_class: 'GPCR', ligand: 'Endorphin', figure_caption: 'Fig',
    body_json: JSON.stringify(['Mu para.']), tags_json: JSON.stringify(['x']) };
  s.pristine.claims.mu = 'Mu claim.';
  s.pristine.clinical[9] = { sys: 'opioid', name: 'MOR', cls: 'GPCR', baseline: 'b', mech: 'm', over_json: '[]', under_json: '[]',
    stahl: 's', agonists_json: JSON.stringify(['morphine']), antagonists_json: '[]',
    onset: null, time_course: null, risk_factors_json: null, monitoring_json: null };
  s.pristine.review.mu = { mechanism: 0, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: '' };
  return s;
}

test('two receptors in one changesList produce entries for both', () => {
  const s = twoReceptorSeed();
  const c1 = core.setField(core.emptyChanges('d2', s.commit), 'archive.abstract', 'D2 new abstract.', AT);
  const c2 = core.setField(core.emptyChanges('mu', s.commit), 'archive.abstract', 'Mu new abstract.', AT);
  const out = core.toCuratorState(s, [c1, c2]);
  assert.deepEqual(out.content.archive, { d2: { abstract: 'D2 new abstract.' }, mu: { abstract: 'Mu new abstract.' } });
});

// --- Task 5 review, fix round 1 ---

test('countPublished mirrors countUnpublished across fields, added sources, flagged sources and review', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.abstract', 'New', AT);
  c = core.attachSource(c, s, { kind: 'article', authors: 'K', year: 2003, title: 'T', journal: 'J', pmid: '12505794', doi: null, url: null, notes: null }, { is_primary: 0 }, AT);
  c = core.setSourceFlags(c, s, 'pmid:24463000', { conflicting: true }, AT);
  c = core.setReview(c, { affinity: 1 }, AT);
  assert.equal(core.countPublished([c]), 0);
  assert.equal(core.countUnpublished([c]), 4);
  const p = core.markPublished(c, 'deadbee');
  assert.equal(core.countPublished([p]), 4);
  assert.equal(core.countUnpublished([p]), 0);
  const q = core.setField(p, 'claim', 'x', AT);
  assert.equal(core.countPublished([q]), 4);
  assert.equal(core.countUnpublished([q]), 1);
});

test('clearField drops the field record and the spans on it, and nothing else', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.abstract', 'New', AT);
  c = core.setField(c, 'archive.body', ['x'], AT);
  c.spans = [{ field: 'archive.abstract', sourceKey: 'k' }, { field: 'archive.body.0', sourceKey: 'k' }, { field: 'archive.abstractish', sourceKey: 'k' }, { field: 'archive.body', sourceKey: 'k' }];
  const a = core.clearField(c, 'archive.abstract');
  assert.deepEqual(Object.keys(a.fields), ['archive.body']);
  assert.deepEqual(a.spans.map(sp => sp.field), ['archive.body.0', 'archive.abstractish', 'archive.body']);
  const b = core.clearField(c, 'archive.body');
  assert.deepEqual(b.spans.map(sp => sp.field), ['archive.abstract', 'archive.abstractish']);
  assert.equal(Object.keys(c.fields).length, 2, 'the input is not mutated');
  assert.deepEqual(core.toCuratorState(s, [a]).content.archive, { d2: { body_json: '["x"]' } });
});

test('an empty list over a pristine null column exports nothing (published-then-reverted list)', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'clinical.monitoring', ['ECG'], AT);
  c = core.markPublished(c, 'deadbee');
  c = core.setField(c, 'clinical.monitoring', [], AT);
  assert.deepEqual(core.toCuratorState(s, [c]).content.clinical, {}, 'monitoring_json pristine null, "[]" is no change');
  c = core.setField(c, 'clinical.risk_factors', null, AT);
  assert.deepEqual(core.toCuratorState(s, [c]).content.clinical, {});
  c = core.setField(c, 'clinical.agonists', [], AT);
  assert.deepEqual(core.toCuratorState(s, [c]).content.clinical, {}, "a pristine '[]' still equals '[]'");
  c = core.setField(c, 'clinical.onset', '', AT);
  assert.deepEqual(core.toCuratorState(s, [c]).content.clinical, { 3: { onset: '' } }, 'scalars keep the strict rule');
});

// --- Task 6 review, fix round 1: a seeded edge keeps its own status unless conflicting is given ---

function providedSeed() {
  const s = seed();
  s.receptors[0].sources.push({ key: 'pmid:111', is_primary: 0, status: 'provided', correction_note: null }, { key: 'pmid:222', is_primary: 0, status: 'conflicting', correction_note: 'wrong year' });
  s.pristine.receptorSources['d2|pmid:111'] = { status: 'provided', is_primary: 0, correction_note: null };
  s.pristine.receptorSources['d2|pmid:222'] = { status: 'conflicting', is_primary: 0, correction_note: 'wrong year' };
  return s;
}

test('primary-only toggle on a seeded provided edge exports provided, with is_primary 1', () => {
  const s = providedSeed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setSourceFlags(c, s, 'pmid:111', { is_primary: 1 }, AT);
  assert.equal(c.sources.set['pmid:111'].conflicting, undefined, 'conflicting is not stored when not given');
  const out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.receptorSources, [{ receptor_id: 'd2', source: 'pmid:111', status: 'provided', is_primary: 1, correction_note: null }]);
  assert.equal(core.viewOf(s.receptors[0], c).sources.find(x => x.key === 'pmid:111').status, 'provided');
  c = core.setSourceFlags(c, s, 'pmid:111', { is_primary: 0 }, AT);
  assert.deepEqual(core.toCuratorState(s, [c]).receptorSources, [], 'back to the seed: no line');
});

test('conflicting true on a seeded provided edge exports conflicting; explicit false returns it to provided', () => {
  const s = providedSeed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setSourceFlags(c, s, 'pmid:111', { conflicting: true, correction_note: 'n' }, AT);
  assert.deepEqual(core.toCuratorState(s, [c]).receptorSources, [{ receptor_id: 'd2', source: 'pmid:111', status: 'conflicting', is_primary: 0, correction_note: 'n' }]);
  assert.equal(core.viewOf(s.receptors[0], c).sources.find(x => x.key === 'pmid:111').status, 'conflicting');
  c = core.setSourceFlags(c, s, 'pmid:111', { conflicting: false, correction_note: null }, AT);
  assert.deepEqual(core.toCuratorState(s, [c]).receptorSources, []);
  assert.equal(core.viewOf(s.receptors[0], c).sources.find(x => x.key === 'pmid:111').status, 'provided');
});

test('explicit false on a seeded conflicting edge exports verified; an untouched one keeps conflicting', () => {
  const s = providedSeed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setSourceFlags(c, s, 'pmid:222', { is_primary: 1 }, AT);
  assert.deepEqual(core.toCuratorState(s, [c]).receptorSources, [{ receptor_id: 'd2', source: 'pmid:222', status: 'conflicting', is_primary: 1, correction_note: 'wrong year' }], 'primary only: still conflicting');
  c = core.setSourceFlags(c, s, 'pmid:222', { conflicting: false, correction_note: null }, AT);
  assert.deepEqual(core.toCuratorState(s, [c]).receptorSources, [{ receptor_id: 'd2', source: 'pmid:222', status: 'verified', is_primary: 1, correction_note: null }]);
  assert.equal(core.viewOf(s.receptors[0], c).sources.find(x => x.key === 'pmid:222').status, 'verified');
});

// --- whole-branch review, fix wave ---

const KAPUR = { kind: 'article', authors: 'Kapur S', year: 2003, title: 'Aberrant salience', journal: 'Am J Psychiatry', pmid: '12505794', doi: null, url: null, notes: null };
const OTHER = { kind: 'article', authors: 'X', year: 2020, title: 'T', journal: 'J', pmid: '999', doi: null, url: null, notes: null };

test('publishedOnly keeps published fields/adds/sets/review and drops the unpublished ones', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.abstract', 'Published.', AT);
  c = core.attachSource(c, s, KAPUR, { is_primary: 0 }, AT);
  c = core.setSourceFlags(c, s, 'pmid:24463000', { conflicting: true, correction_note: 'n' }, AT);
  c = core.setReview(c, { mechanism: 1 }, AT);
  c = core.markPublished(c, 'sha1');
  c = core.setField(c, 'claim', 'Unpublished.', AT);
  c = core.attachSource(c, s, OTHER, { is_primary: 0 }, AT);
  c.spans = [{ field: 'archive.abstract', start: 0, end: 4, text: 'Publ', sourceKey: 'pmid:12505794', at: AT }];
  const p = core.publishedOnly(c);
  assert.deepEqual(Object.keys(p.fields), ['archive.abstract']);
  assert.deepEqual(p.sources.add.map(a => a.key), ['pmid:12505794']);
  assert.deepEqual(Object.keys(p.sources.set), ['pmid:24463000']);
  assert.deepEqual(Object.keys(p.library), ['pmid:12505794'], 'library rows only for published adds');
  assert.equal(p.review.mechanism, 1);
  assert.equal(p.receptorId, 'd2'); assert.equal(p.seedCommit, s.commit);
  assert.equal(c.fields.claim.value, 'Unpublished.', 'the input is not mutated');
  // an unpublished review is dropped
  const q = core.publishedOnly(core.setReview(c, { affinity: 1 }, AT));
  assert.equal(q.review, null);
});

test('publishedOnly of a changes object with nothing published is the empty shape', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.abstract', 'x', AT);
  c = core.attachSource(c, s, KAPUR, { is_primary: 0 }, AT);
  c = core.setSourceFlags(c, s, 'pmid:24463000', { conflicting: true }, AT);
  c = core.setReview(c, { mechanism: 1 }, AT);
  c.spans = [{ field: 'archive.abstract', start: 0, end: 1, text: 'x', sourceKey: 'pmid:12505794', at: AT }];
  assert.deepEqual(core.publishedOnly(c), core.emptyChanges('d2', s.commit));
});
