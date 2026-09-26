import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../desk/desk-core.mjs';
import { rekeyAll, publishedShas } from '../scripts/desk-rekey.mjs';

const AT = '2026-09-26T13:00:00.000Z';
const seed = { commit: 'new1234', receptors: [{ id: 'd2', sources: [] }, { id: 'd1', sources: [] }], sources: {} };

function docs() {
  let a = core.setField(core.emptyChanges('d2', 'old'), 'claim', 'published', AT);
  a = core.markPublished(a, 'sha1');
  a = core.setField(a, 'archive.abstract', 'unpublished', AT);
  let b = core.setReview(core.emptyChanges('d1', 'old'), { mechanism: 1 }, AT);
  b = core.markPublished(b, 'sha2');
  return [a, b];
}

test('publishedShas lists every distinct publishedAs across the documents, predecessors included', () => {
  assert.deepEqual(publishedShas(docs()), ['sha1', 'sha2']);
  const [a, b] = docs();
  assert.deepEqual(publishedShas([core.setField(a, 'claim', 'again', AT), core.setReview(b, { affinity: 1 }, AT)]), ['sha1', 'sha2'], 'shas that survive only as predecessors');
});

test('rekeyAll refuses unless every publish is an ancestor of HEAD', () => {
  const asked = [];
  const r = rekeyAll(seed, docs(), sha => { asked.push(sha); return sha === 'sha1'; });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['sha2']);
  assert.deepEqual(asked, ['sha1', 'sha2']);
});

test('rekeyAll re-keys every document once every publish is in the history', () => {
  const r = rekeyAll(seed, docs(), () => true);
  assert.equal(r.ok, true);
  assert.deepEqual(r.docs.map(d => d.seedCommit), ['new1234', 'new1234']);
  assert.deepEqual(Object.keys(r.docs[0].fields), ['archive.abstract'], 'published records fold into the new seed');
  assert.equal(r.docs[1].review, null);
});

test('rekeyAll refuses while any document holds an unpublished revert or detach', () => {
  const [a, b] = docs();
  const reverted = core.clearField(a, 'claim', AT);                       // a tombstone over the published claim
  const kapur = { kind: 'article', authors: 'K', year: 2003, title: 'T', journal: 'J', pmid: '1', doi: null, url: null, notes: null };
  const added = core.markPublished(core.attachSource(b, { ...seed, receptors: [{ id: 'd1', sources: [] }] }, kapur, { is_primary: 0 }, AT), 'sha2');
  const detached = core.detachSource(added, seed, 'pmid:1', AT);
  let asked = 0;
  const r = rekeyAll(seed, [reverted, detached], () => { asked++; return true; });
  assert.equal(r.ok, false); assert.equal(r.reason, 'unpublished reverts');
  assert.equal(r.message, 'publish or discard 2 unpublished reverts/detaches before re-seeding: d2, d1');
  assert.equal(asked, 0, 'refused before asking git');
  assert.equal(rekeyAll(seed, [core.markPublished(reverted, 'sha3'), core.markPublished(detached, 'sha3')], () => true).ok, true, 'once published, they re-key');
});
