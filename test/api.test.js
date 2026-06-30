import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

let server, base;
before(async () => {
  server = createServer(':memory:', { seed: true });
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('GET /api/receptors returns the full registry', async () => {
  const res = await fetch(`${base}/api/receptors`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(Array.isArray(body), true);
  assert.equal(body.length, 24);
  for (const key of ['id', 'label', 'status']) {
    assert.ok(key in body[0], `first item missing ${key}`);
  }
  const m1 = body.find(r => r.id === 'm1');
  assert.ok(m1, 'm1 not in registry');
  assert.equal(m1.status, 'conflicting');
  // a receptor with zero attached sources must roll up to 'needs-source' in the
  // list; d3 has no primary article but does carry Stahl sources, so it rolls
  // up to 'provided' instead — a true sourceless receptor is covered below.
  const d3 = body.find(r => r.id === 'd3');
  assert.ok(d3, 'd3 not in registry');
  assert.equal(d3.status, 'provided');
});

test('GET /api/receptors/:id returns a fully joined detail', async () => {
  const res = await fetch(`${base}/api/receptors/m1`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.source, 'source should be present');
  assert.equal(body.source.pmid, '24903776');
  assert.equal(body.status, 'conflicting');
  assert.equal(Array.isArray(body.sources), true);
  assert.ok(body.sources.length > 1, 'm1 should carry its primary article plus its Stahl-chapter sources');
  assert.ok(body.sources.some(s => s.kind === 'book'), 'm1 should carry at least one Stahl book source');
  assert.equal(typeof body.review, 'object');
  assert.ok(body.review && 'mastery' in body.review, 'review missing mastery');
});

test('GET /api/receptors/:id with no primary article serializes source as null', async () => {
  const res = await fetch(`${base}/api/receptors/d3`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, null); // no peer-reviewed article is set as primary
  assert.ok(body.sources.length > 0, 'd3 should still carry its Stahl-chapter sources');
  assert.equal(body.status, 'provided'); // Stahl sources exist, so it's not "needs-source"
});

test('GET /api/receptors/:id returns 404 for an unknown id', async () => {
  const res = await fetch(`${base}/api/receptors/nope`);
  assert.equal(res.status, 404);
});

test('detail includes volumes and the deferred note/note2/search fields', async () => {
  const m1 = await (await fetch(`${base}/api/receptors/m1`)).json();
  assert.ok(Array.isArray(m1.volumes), 'volumes should be an array');
  assert.ok(m1.volumes.includes('archive') && m1.volumes.includes('cabinet'), 'm1 volume membership');
  assert.match(m1.note2, /24445063|corrected/, 'm1 should carry the citation-correction note');
  assert.equal(typeof m1.note, 'string'); // the Stahl note is present

  const d3 = await (await fetch(`${base}/api/receptors/d3`)).json();
  assert.ok(d3.volumes.includes('archive'), 'd3 in archive volume');
  assert.match(d3.search, /dopamine D3/i, 'd3 should carry a PubMed search recipe');
  assert.equal(d3.note2, null); // d3 has no correction note
});

test('GET /api/atlas/:volume returns the receptors in that volume', async () => {
  const res = await fetch(`${base}/api/atlas/archive`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(Array.isArray(body), true);
  assert.ok(body.length > 0 && body.length < 24, `unexpected length ${body.length}`);

  // Real membership check: d1 is an Archive receptor and must appear; m3 is
  // Cabinet-only and must NOT — proves the volume filter actually filters.
  const ids = body.map(r => r.id);
  assert.ok(ids.includes('d1'), 'archive should include d1');
  assert.ok(!ids.includes('m3'), 'archive must exclude cabinet-only m3');

  for (const el of body) {
    for (const key of ['id', 'label', 'status']) {
      assert.ok(key in el, `element missing ${key}`);
    }
    assert.ok('source' in el, 'element missing source key');
    assert.ok(el.source === null || typeof el.source === 'object', 'source must be object or null');
  }
});
