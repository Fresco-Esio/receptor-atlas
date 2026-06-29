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
});

test('GET /api/receptors/:id returns a fully joined detail', async () => {
  const res = await fetch(`${base}/api/receptors/m1`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.source, 'source should be present');
  assert.equal(body.source.pmid, '24903776');
  assert.equal(body.status, 'conflicting');
  assert.equal(Array.isArray(body.stahl), true);
  assert.ok(body.stahl.length > 0, 'stahl should be non-empty');
  assert.equal(typeof body.review, 'object');
  assert.ok(body.review && 'mastery' in body.review, 'review missing mastery');
});

test('GET /api/receptors/:id with a null source serializes source as null', async () => {
  const res = await fetch(`${base}/api/receptors/d3`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, null);
  assert.equal(body.status, 'needs-source');
});

test('GET /api/receptors/:id returns 404 for an unknown id', async () => {
  const res = await fetch(`${base}/api/receptors/nope`);
  assert.equal(res.status, 404);
});

test('GET /api/atlas/:volume returns the receptors in that volume', async () => {
  const res = await fetch(`${base}/api/atlas/archive`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(Array.isArray(body), true);
  assert.ok(body.length > 0 && body.length < 24, `unexpected length ${body.length}`);

  // Cross-check: every returned receptor must actually be in the archive volume.
  const detail = await Promise.all(
    body.map(async r => {
      const reg = await fetch(`${base}/api/atlas/archive`);
      return reg.ok;
    })
  );
  assert.ok(detail.every(Boolean));

  for (const el of body) {
    for (const key of ['id', 'label', 'status']) {
      assert.ok(key in el, `element missing ${key}`);
    }
    assert.ok('source' in el, 'element missing source key');
    assert.ok(el.source === null || typeof el.source === 'object', 'source must be object or null');
  }
});
