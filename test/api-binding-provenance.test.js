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

test('GET /api/agents/binding is drug-first with rolled-up provenance', async () => {
  const agents = await (await fetch(`${base}/api/agents/binding`)).json();
  assert.equal(agents.length, 71);
  const halo = agents.find(a => a.name === 'Haloperidol');
  assert.ok(halo && halo.bindings.length === 4);
  const d2 = halo.bindings.find(b => b.target_alias === 'dopamine_d2');
  assert.ok(d2.sources.length >= 1);
  assert.equal(d2.sources[0].status, 'provided');   // migration default
  assert.equal(d2.value_status, 'unchecked');
  assert.ok('src' in d2);                            // as-imported label preserved
});

test('an unattributed binding is needs-source with no edges', async () => {
  const agents = await (await fetch(`${base}/api/agents/binding`)).json();
  const xan = agents.find(a => a.name === 'Xanomeline');
  assert.ok(xan.bindings.every(b => b.sources.length === 0));
  assert.ok(xan.bindings.every(b => b.status === 'needs-source'));
});

test('GET /api/sources/binding-usage counts edges per source', async () => {
  const usage = await (await fetch(`${base}/api/sources/binding-usage`)).json();
  const pdsp = usage.find(u => u.title === 'Ki Database (PDSP)');
  assert.equal(pdsp.count, 41);
  assert.ok(['verified', 'provided', 'conflicting'].includes(pdsp.status));
  assert.equal(usage.reduce((n, u) => n + u.count, 0), 105);
});
