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

const patch = (id, body) => fetch(`${base}/api/receptors/${id}/structured`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('PATCH structured claim persists and stamps section_activity.last_edited_at', async () => {
  const res = await patch('gabaa', { volume: 'archive', claim: 'edited claim text' });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(out.last_edited_at, 'should return a stamp');

  const detail = await (await fetch(`${base}/api/receptors/gabaa`)).json();
  assert.equal(detail.claim, 'edited claim text');
});

test('PATCH a binding value updates the row and stamps activity', async () => {
  // find a known binding row for gabaa (Diazepam @ gaba_a)
  const before = await (await fetch(`${base}/api/receptors/gabaa/structured`)).json();
  const row = before.binding.find(b => b.agent_name === 'Diazepam');
  assert.ok(row, 'seed should include Diazepam binding');

  const res = await patch('gabaa', { volume: 'cabinet', binding: { id: row.id, ki: 1.23, note: 'recheck' } });
  assert.equal(res.status, 200);

  const after = await (await fetch(`${base}/api/receptors/gabaa/structured`)).json();
  const updated = after.binding.find(b => b.id === row.id);
  assert.equal(updated.ki, 1.23);
  assert.equal(updated.note, 'recheck');
  assert.ok(after.activity.cabinet?.last_edited_at, 'cabinet section stamped');
});

test('PATCH a clinical field updates the row (list field round-trips as array)', async () => {
  const res = await patch('gabaa', { volume: 'ledger', clinical: { baseline: 'NEW baseline', over: ['x', 'y'] } });
  assert.equal(res.status, 200);

  const after = await (await fetch(`${base}/api/receptors/gabaa/structured`)).json();
  assert.equal(after.clinical.baseline, 'NEW baseline');
  assert.deepEqual(after.clinical.over, ['x', 'y']);
  assert.ok(after.activity.ledger?.last_edited_at, 'ledger section stamped');
});

test('PATCH structured rejects unknown receptor and bad volume', async () => {
  assert.equal((await patch('nope', { volume: 'archive', claim: 'x' })).status, 404);
  assert.equal((await patch('gabaa', { volume: 'nonsense', claim: 'x' })).status, 400);
  assert.equal((await patch('gabaa', { volume: 'archive' })).status, 400); // nothing to change
});

test('structured binding rows carry inline sources + value_status (receptor-first provenance)', async () => {
  const s = await (await fetch(`${base}/api/receptors/d2/structured`)).json();
  assert.ok(Array.isArray(s.binding) && s.binding.length, 'd2 has binding rows');
  const halo = s.binding.find(b => b.agent_name === 'Haloperidol');
  assert.ok(halo, 'd2 should include the Haloperidol binding');
  assert.ok(Array.isArray(halo.sources) && halo.sources.length >= 1, 'binding carries its own cited sources');
  assert.equal(halo.value_status, 'unchecked', 'value_status defaults to unchecked');
  assert.ok(['verified', 'provided', 'conflicting', 'needs-source'].includes(halo.citation_status), 'binding carries a rolled-up citation_status');
});
