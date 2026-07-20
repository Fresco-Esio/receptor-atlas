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

test('GET /api/atlas/cabinet/binding rebuilds the agent×target matrix', async () => {
  const agents = await (await fetch(`${base}/api/atlas/cabinet/binding`)).json();
  const diazepam = agents.find(a => a.name === 'Diazepam');
  assert.ok(diazepam, 'Diazepam present');
  // Values now come from the single PDSP spine (human, median), shown in the UI as pKi.
  assert.equal(diazepam.b.gaba_a.ki, 16.2);
  assert.equal(diazepam.b.gaba_a.kiText, 'median of 15 human values');
  assert.equal(diazepam.b.gaba_a.src, 'PDSP KiDB (human)');
});

test('GET /api/atlas/ledger/clinical returns the 16 rows with array list fields', async () => {
  const rows = await (await fetch(`${base}/api/atlas/ledger/clinical`)).json();
  assert.equal(rows.length, 16);
  const gaba = rows.find(r => r.no === 1);
  assert.match(gaba.name, /GABA-A/);
  assert.ok(Array.isArray(gaba.over) && gaba.over.length > 0);
  assert.ok(Array.isArray(gaba.agonists));
});

test('a binding value edited via the desk shows up in the cabinet binding feed', async () => {
  // find Diazepam's binding row id for gabaa, edit its Ki via /structured
  const struct = await (await fetch(`${base}/api/receptors/gabaa/structured`)).json();
  const row = struct.binding.find(b => b.agent_name === 'Diazepam');
  await fetch(`${base}/api/receptors/gabaa/structured`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume: 'cabinet', binding: { id: row.id, ki: 2.5 } }),
  });
  const agents = await (await fetch(`${base}/api/atlas/cabinet/binding`)).json();
  const diazepam = agents.find(a => a.name === 'Diazepam');
  assert.equal(diazepam.b.gaba_a.ki, 2.5);   // the edit is reflected in the volume feed
});
