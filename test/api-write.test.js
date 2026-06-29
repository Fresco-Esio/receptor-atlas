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

const postJson = (path, obj) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  });

test('GET /api/sources returns all seeded sources', async () => {
  const res = await fetch(`${base}/api/sources`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(Array.isArray(body), true);
  assert.equal(body.length, 20);
  for (const key of ['id', 'authors', 'pmid']) {
    assert.ok(key in body[0], `first item missing ${key}`);
  }
});

test('POST /api/sources inserts a new source', async () => {
  const before = (await (await fetch(`${base}/api/sources`)).json()).length;
  const res = await postJson('/api/sources', {
    authors: 'Test A',
    year: 2025,
    title: 'A brand new paper',
    pmid: '99999999',
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(typeof created.id, 'number');
  assert.equal(created.title, 'A brand new paper');

  const after = await (await fetch(`${base}/api/sources`)).json();
  assert.equal(after.length, before + 1);
  assert.ok(after.find(s => s.id === created.id), 'new source not in list');
});

test('PATCH /api/sources/:id edits a source title', async () => {
  const created = await (await postJson('/api/sources', {
    authors: 'Patch Me',
    year: 2024,
    title: 'Original title',
  })).json();

  const res = await fetch(`${base}/api/sources/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Edited title' }),
  });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.title, 'Edited title');
  assert.equal(updated.authors, 'Patch Me'); // untouched

  const list = await (await fetch(`${base}/api/sources`)).json();
  assert.equal(list.find(s => s.id === created.id).title, 'Edited title');
});

test('PATCH /api/sources/:id returns 404 for unknown id', async () => {
  const res = await fetch(`${base}/api/sources/9999999`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'x' }),
  });
  assert.equal(res.status, 404);
});

test('fix-once: editing a shared source propagates to all citing receptors', async () => {
  const m1Before = await (await fetch(`${base}/api/receptors/m1`)).json();
  assert.equal(m1Before.source.pmid, '24903776');

  const sources = await (await fetch(`${base}/api/sources`)).json();
  const shared = sources.find(s => s.pmid === '24903776');
  assert.ok(shared, 'shared Kruse 2014 source not found');

  const res = await fetch(`${base}/api/sources/${shared.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Kruse 2014 — CORRECTED' }),
  });
  assert.equal(res.status, 200);

  const m1 = await (await fetch(`${base}/api/receptors/m1`)).json();
  const m3 = await (await fetch(`${base}/api/receptors/m3`)).json();
  assert.equal(m1.source.title, 'Kruse 2014 — CORRECTED');
  assert.equal(m3.source.title, 'Kruse 2014 — CORRECTED');
});

test('PUT /api/receptors/:id/citation links a source', async () => {
  const sources = await (await fetch(`${base}/api/sources`)).json();
  const someId = sources[0].id;
  const res = await fetch(`${base}/api/receptors/d3/citation`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_id: someId, status: 'verified' }),
  });
  assert.equal(res.status, 200);

  const d3 = await (await fetch(`${base}/api/receptors/d3`)).json();
  assert.ok(d3.source, 'd3 source should now be set');
  assert.equal(d3.status, 'verified');
});

test('PUT /api/receptors/:id/citation 404 for unknown receptor', async () => {
  const res = await fetch(`${base}/api/receptors/nope/citation`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_id: null, status: 'verified' }),
  });
  assert.equal(res.status, 404);
});

test('PUT /api/receptors/:id/citation 400 for bad status', async () => {
  const res = await fetch(`${base}/api/receptors/m1/citation`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_id: null, status: 'bogus' }),
  });
  assert.equal(res.status, 400);
});

test('PATCH /api/receptors/:id/review persists review fields', async () => {
  const res = await fetch(`${base}/api/receptors/m1/review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mechanism: 1, mastery: 4, note: 'x' }),
  });
  assert.equal(res.status, 200);

  const m1 = await (await fetch(`${base}/api/receptors/m1`)).json();
  assert.equal(m1.review.mechanism, 1);
  assert.equal(m1.review.mastery, 4);
  assert.equal(m1.review.note, 'x');
});

test('POST /api/sources with malformed body returns 400', async () => {
  const res = await fetch(`${base}/api/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  });
  assert.equal(res.status, 400);
});
