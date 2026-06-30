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

test('GET /api/sources returns all seeded sources, articles and Stahl books alike', async () => {
  const res = await fetch(`${base}/api/sources`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(Array.isArray(body), true);
  assert.equal(body.length, 32); // deduped peer-reviewed articles + deduped Stahl chapters
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

test('POST /api/sources defaults kind to article, but accepts an explicit book kind', async () => {
  const article = await (await postJson('/api/sources', { authors: 'A', title: 'No kind given' })).json();
  assert.equal(article.kind, 'article');

  const book = await (await postJson('/api/sources', { kind: 'book', authors: 'Stahl SM', title: 'Ch 99' })).json();
  assert.equal(book.kind, 'book');
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

test('POST /api/receptors/:id/sources attaches an existing source as primary', async () => {
  const sources = await (await fetch(`${base}/api/sources`)).json();
  const someId = sources[0].id;
  const res = await postJson('/api/receptors/d3/sources', { source_id: someId, status: 'verified', is_primary: true });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.id, someId);
  assert.equal(created.status, 'verified');
  assert.equal(created.is_primary, true);

  const d3 = await (await fetch(`${base}/api/receptors/d3`)).json();
  assert.ok(d3.source, 'd3 source should now be set');
  assert.equal(d3.source.id, someId);
  // a verified primary mixed with d3's existing 'provided' Stahl sources rolls up to 'provided'
  assert.equal(d3.status, 'provided');
});

test('POST /api/receptors/:id/sources creates a new source inline and attaches it', async () => {
  const before = (await (await fetch(`${base}/api/sources`)).json()).length;
  const res = await postJson('/api/receptors/dat/sources', {
    source: { authors: 'Inline A', year: 2026, title: 'Created inline', pmid: '88888888' },
    status: 'provided',
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.title, 'Created inline');
  assert.equal(created.is_primary, false);

  const after = await (await fetch(`${base}/api/sources`)).json();
  assert.equal(after.length, before + 1, 'a new source row should have been inserted');

  const dat = await (await fetch(`${base}/api/receptors/dat`)).json();
  assert.ok(dat.sources.some(s => s.title === 'Created inline'), 'dat should now carry the inline-created source');
});

test('POST /api/receptors/:id/sources 404 for unknown receptor', async () => {
  const res = await postJson('/api/receptors/nope/sources', { source: { authors: 'X', title: 'Y' } });
  assert.equal(res.status, 404);
});

test('POST /api/receptors/:id/sources 400 for bad status', async () => {
  const res = await postJson('/api/receptors/m1/sources', { source: { authors: 'X', title: 'Y' }, status: 'bogus' });
  assert.equal(res.status, 400);
});

test('POST /api/receptors/:id/sources 400 when neither source_id nor source is given', async () => {
  const res = await postJson('/api/receptors/m1/sources', { status: 'provided' });
  assert.equal(res.status, 400);
});

test('POST /api/receptors/:id/sources 400 for an unknown source_id', async () => {
  const res = await postJson('/api/receptors/m1/sources', { source_id: 999999 });
  assert.equal(res.status, 400);
});

test('PATCH /api/receptors/:id/sources/:sid updates status and swaps primary', async () => {
  const m1Before = await (await fetch(`${base}/api/receptors/m1`)).json();
  const bookSource = m1Before.sources.find(s => s.kind === 'book');
  assert.ok(bookSource, 'm1 should have a Stahl book source to promote');

  const res = await fetch(`${base}/api/receptors/m1/sources/${bookSource.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'verified', is_primary: true }),
  });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.status, 'verified');
  assert.equal(updated.is_primary, true);

  const m1 = await (await fetch(`${base}/api/receptors/m1`)).json();
  assert.equal(m1.source.id, bookSource.id, 'the book source should now be primary');
  const oldPrimary = m1.sources.find(s => s.id === m1Before.source.id);
  assert.equal(oldPrimary.is_primary, false, 'the old primary should have been unset');
});

test('PATCH /api/receptors/:id/sources/:sid updates a correction note', async () => {
  const m1Before = await (await fetch(`${base}/api/receptors/m1`)).json();
  const sid = m1Before.source.id;
  const res = await fetch(`${base}/api/receptors/m1/sources/${sid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correction_note: 'updated note' }),
  });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.correction_note, 'updated note');
});

test('PATCH /api/receptors/:id/sources/:sid 404 for an unattached source', async () => {
  const res = await fetch(`${base}/api/receptors/d3/sources/999999`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'verified' }),
  });
  assert.equal(res.status, 404);
});

test('PATCH /api/receptors/:id/sources/:sid 400 for bad status', async () => {
  const m1 = await (await fetch(`${base}/api/receptors/m1`)).json();
  const res = await fetch(`${base}/api/receptors/m1/sources/${m1.source.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'bogus' }),
  });
  assert.equal(res.status, 400);
});

test('DELETE /api/receptors/:id/sources/:sid unlinks a source', async () => {
  const m1Before = await (await fetch(`${base}/api/receptors/m1`)).json();
  const bookSource = m1Before.sources.find(s => s.kind === 'book');
  assert.ok(bookSource, 'm1 should have a Stahl book source to unlink');

  const res = await fetch(`${base}/api/receptors/m1/sources/${bookSource.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.deleted, bookSource.id);

  const m1 = await (await fetch(`${base}/api/receptors/m1`)).json();
  assert.ok(!m1.sources.some(s => s.id === bookSource.id), 'unlinked source should be gone from m1');
  const stillExists = await (await fetch(`${base}/api/sources`)).json();
  assert.ok(stillExists.some(s => s.id === bookSource.id), 'unlinking must not delete the shared source row');
});

test('DELETE /api/receptors/:id/sources/:sid promotes another source to primary if the primary is removed', async () => {
  const m1Before = await (await fetch(`${base}/api/receptors/m1`)).json();
  const primaryId = m1Before.source.id;
  assert.ok(m1Before.sources.length > 1, 'm1 should have more than one source for this test to be meaningful');

  const res = await fetch(`${base}/api/receptors/m1/sources/${primaryId}`, { method: 'DELETE' });
  assert.equal(res.status, 200);

  const m1 = await (await fetch(`${base}/api/receptors/m1`)).json();
  assert.ok(m1.source, 'm1 should still have a primary source — the atlas volumes depend on exactly one');
  assert.notEqual(m1.source.id, primaryId);
  const primaryEdges = m1.sources.filter(s => s.is_primary);
  assert.equal(primaryEdges.length, 1, 'exactly one source should be marked primary after the swap');
});

test('DELETE /api/receptors/:id/sources/:sid 404 for an unattached source', async () => {
  const res = await fetch(`${base}/api/receptors/d3/sources/999999`, { method: 'DELETE' });
  assert.equal(res.status, 404);
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

test('POST with a body past the 1MB cap returns 413 and the server stays responsive', async () => {
  const huge = JSON.stringify({ notes: 'x'.repeat(1_100_000) });
  const res = await fetch(`${base}/api/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: huge,
  });
  assert.equal(res.status, 413);
  // The oversized request must not wedge the server — a normal read still works.
  const still = await fetch(`${base}/api/receptors`);
  assert.equal(still.status, 200);
});

test('PATCH is_primary:false on the sole primary auto-promotes another source', async () => {
  const rid = 'gabab';
  const a = await (await postJson(`/api/receptors/${rid}/sources`, {
    source: { kind: 'article', title: 'Primary A', year: 2020 }, status: 'provided', is_primary: true,
  })).json();
  await postJson(`/api/receptors/${rid}/sources`, {
    source: { kind: 'article', title: 'Other B', year: 2019 }, status: 'provided',
  });

  let r = await (await fetch(`${base}/api/receptors/${rid}`)).json();
  assert.equal(r.sources.filter(s => s.is_primary).length, 1);
  assert.equal(r.source.id, a.id, 'A should be the primary we just set');

  const res = await fetch(`${base}/api/receptors/${rid}/sources/${a.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_primary: false }),
  });
  assert.equal(res.status, 200);

  r = await (await fetch(`${base}/api/receptors/${rid}`)).json();
  const primaries = r.sources.filter(s => s.is_primary);
  assert.equal(primaries.length, 1, 'exactly one primary must remain while sources exist');
  assert.notEqual(primaries[0].id, a.id, 'a different source should have been promoted');
  assert.ok(r.source, 'the atlas-facing primary must not be null');
});
