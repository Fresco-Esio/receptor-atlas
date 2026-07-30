import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, webUrl } from '../lib/git-publish.js';

// The Publish button writes the commit message itself, so this text IS the project's
// history. It has to say what happened in the words the work was done in, or the log
// degrades into "curate: changes" and you are back to reading diffs to find anything.
const EMPTY = { format: 1, review: {}, sources: [], receptorSources: [], bindingSources: [],
  content: { claims: {}, archive: {}, clinical: {}, bindings: [] } };
const after = over => ({ ...EMPTY, ...over, content: { ...EMPTY.content, ...(over.content || {}) } });

test('an unchanged session summarises to nothing, so nothing is committed', () => {
  assert.deepEqual(summarise(EMPTY, EMPTY), []);
});

test('a first publish, with no committed dump to compare against, still describes itself', () => {
  const s = summarise(null, after({ review: { m1: { mechanism: 1 } } }));
  assert.deepEqual(s, ['1 specimen reviewed']);
});

test('the summary counts each kind of work separately', () => {
  const s = summarise(EMPTY, after({
    review: { m1: { mechanism: 1 }, d2: { citation: 1 } },
    sources: [{ key: 'pmid:1' }],
    receptorSources: [{ receptor_id: 'm1', source: 'pmid:1', status: 'provided' }],
    content: { claims: { m1: 'rewritten' }, bindings: [{ agent_name: 'Fluoxetine', target_alias: 'sert', ki: 1 }] },
  }));
  assert.deepEqual(s, ['2 specimens reviewed', '1 source added', '1 citation attached', '1 claim edit', '1 affinity value edited']);
});

test('verifying citations is reported as verifying, not as a status change', () => {
  const before = { ...EMPTY, receptorSources: [{ receptor_id: 'm1', source: 'pmid:1', status: 'provided' }] };
  const now = { ...EMPTY, receptorSources: [{ receptor_id: 'm1', source: 'pmid:1', status: 'verified' }] };
  assert.deepEqual(summarise(before, now), ['1 citation verified']);
});

test('a mixed batch of status changes does not claim they were all verified', () => {
  const before = { ...EMPTY, receptorSources: [
    { receptor_id: 'm1', source: 'pmid:1', status: 'provided' },
    { receptor_id: 'm3', source: 'pmid:2', status: 'provided' }] };
  const now = { ...EMPTY, receptorSources: [
    { receptor_id: 'm1', source: 'pmid:1', status: 'verified' },
    { receptor_id: 'm3', source: 'pmid:2', status: 'conflicting' }] };
  assert.deepEqual(summarise(before, now), ['2 citation statuses changed']);
});

test('a source already carried in the dump is not reported as newly added', () => {
  const before = { ...EMPTY, sources: [{ key: 'pmid:1' }] };
  const now = { ...EMPTY, sources: [{ key: 'pmid:1' }, { key: 'pmid:2' }] };
  assert.deepEqual(summarise(before, now), ['1 source added']);
});

test('remote URLs become something a person can click', () => {
  assert.equal(webUrl('git@github.com:Fresco-Esio/receptor-atlas.git'), 'https://github.com/Fresco-Esio/receptor-atlas');
  assert.equal(webUrl('https://github.com/Fresco-Esio/receptor-atlas.git'), 'https://github.com/Fresco-Esio/receptor-atlas');
  assert.equal(webUrl('https://github.com/Fresco-Esio/receptor-atlas\n'), 'https://github.com/Fresco-Esio/receptor-atlas');
  assert.equal(webUrl(''), null, 'no remote is an answer, not a crash');
  assert.equal(webUrl('some-local-path'), null);
});

// Both of these came from watching the button actually run. The first publish said
// "curate: review session" because nothing described a timestamp move; the second
// said "1 citation attached" when the curator had verified a citation the atlas
// already shipped. The dump carries only the delta from a fresh seed, so a row
// appearing in it means something stopped matching the seed, not that it is new.
test('verifying a citation the atlas already shipped is not reported as attaching one', () => {
  // Nothing in the previous dump: the seeded status matched, so there was no row.
  const now = { ...EMPTY, receptorSources: [{ receptor_id: 'm1', source: 'pmid:24903776', status: 'verified' }] };
  assert.deepEqual(summarise(EMPTY, now), ['1 citation verified']);
});

test('a genuinely new citation is still reported as attached', () => {
  const now = { ...EMPTY, receptorSources: [{ receptor_id: 'm1', source: 'pmid:1', status: 'provided' }] };
  assert.deepEqual(summarise(EMPTY, now), ['1 citation attached']);
});

test('a session that only moved timestamps says so instead of falling back to nothing', () => {
  const before = { ...EMPTY, activity: [] };
  const now = { ...EMPTY, activity: [{ receptor_id: 'd2', volume: 'cabinet', last_edited_at: '2026-07-30T10:00:00Z', last_reviewed_at: null }] };
  assert.deepEqual(summarise(before, now), ['review timestamps updated']);
});

test('timestamps are not mentioned when there is real work to report', () => {
  const before = { ...EMPTY, activity: [] };
  const now = { ...EMPTY, review: { m1: { mechanism: 1 } },
    activity: [{ receptor_id: 'm1', volume: 'archive', last_edited_at: 'x', last_reviewed_at: null }] };
  assert.deepEqual(summarise(before, now), ['1 specimen reviewed']);
});

// Undoing work makes rows LEAVE the dump, because it holds only the delta from a
// fresh seed and undoing puts you back on the seed. Every other rule reads what is
// present, so a session spent reverting summarised to nothing and committed as
// "review session". Found by reverting a test edit and watching the message.
test('undoing an edit is reported rather than summarising to nothing', () => {
  const before = { ...EMPTY, receptorSources: [{ receptor_id: 'm1', source: 'pmid:1', status: 'verified' }] };
  assert.deepEqual(summarise(before, EMPTY), ['1 change returned to what the atlas ships']);
});

test('a reverted claim counts too', () => {
  const before = { ...EMPTY, content: { ...EMPTY.content, claims: { m1: 'an edit later undone' } } };
  assert.deepEqual(summarise(before, EMPTY), ['1 change returned to what the atlas ships']);
});

test('reverting one thing while doing another reports both', () => {
  const before = { ...EMPTY, content: { ...EMPTY.content, claims: { m1: 'undone' } } };
  const now = { ...EMPTY, review: { d2: { mechanism: 1 } } };
  assert.deepEqual(summarise(before, now), ['1 specimen reviewed', '1 change returned to what the atlas ships']);
});
