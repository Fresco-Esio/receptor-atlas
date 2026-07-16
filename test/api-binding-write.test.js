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

const j = (method, path, body) => fetch(`${base}${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
});
const enc = encodeURIComponent;

test('attach an existing library source to a binding', async () => {
  const agent = 'Xanomeline', target = 'muscarinic_m1';
  const res = await j('POST', `/api/bindings/${enc(agent)}/${enc(target)}/sources`, { source_id: 1, status: 'provided' });
  assert.equal(res.status, 201);
  const agents = await (await fetch(`${base}/api/agents/binding`)).json();
  const b = agents.find(a => a.name === agent).bindings.find(x => x.target_alias === target);
  assert.equal(b.sources.length, 1);
  assert.equal(b.status, 'provided');
});

test('create-inline + attach, then update status, then unlink', async () => {
  const agent = 'Benztropine', target = 'muscarinic_m1';
  const post = await j('POST', `/api/bindings/${enc(agent)}/${enc(target)}/sources`,
    { source: { kind: 'article', authors: 'New A', year: 2024, title: 'Fresh' }, status: 'provided' });
  assert.equal(post.status, 201);
  const created = await post.json();
  const sid = created.id;

  const patch = await j('PATCH', `/api/bindings/${enc(agent)}/${enc(target)}/sources/${sid}`, { status: 'verified' });
  assert.equal(patch.status, 200);

  const bad = await j('PATCH', `/api/bindings/${enc(agent)}/${enc(target)}/sources/${sid}`, { status: 'nonsense' });
  assert.equal(bad.status, 400);

  const del = await j('DELETE', `/api/bindings/${enc(agent)}/${enc(target)}/sources/${sid}`);
  assert.equal(del.status, 200);
  assert.equal((await fetch(`${base}/api/sources/${sid}`)).status, 200);
});

test('value_status upsert with whitelist', async () => {
  const agent = 'Diazepam', target = 'gaba_a';
  assert.equal((await j('PATCH', `/api/bindings/${enc(agent)}/${enc(target)}/review`, { value_status: 'confirmed' })).status, 200);
  assert.equal((await j('PATCH', `/api/bindings/${enc(agent)}/${enc(target)}/review`, { value_status: 'bogus' })).status, 400);
  const agents = await (await fetch(`${base}/api/agents/binding`)).json();
  const b = agents.find(a => a.name === agent).bindings.find(x => x.target_alias === target);
  assert.equal(b.value_status, 'confirmed');
});

test('bulk: verify a source sets all its binding edges', async () => {
  const usage = await (await fetch(`${base}/api/sources/binding-usage`)).json();
  const pdsp = usage.find(u => u.title === 'Ki Database (PDSP)');
  const res = await j('PATCH', `/api/sources/${pdsp.id}/binding-status`, { status: 'verified' });
  assert.equal(res.status, 200);
  const after = await (await fetch(`${base}/api/sources/binding-usage`)).json();
  assert.equal(after.find(u => u.id === pdsp.id).status, 'verified');
});

test('unknown binding pair is 404', async () => {
  assert.equal((await j('POST', `/api/bindings/Nobody/nowhere/sources`, { source_id: 1 })).status, 404);
});
