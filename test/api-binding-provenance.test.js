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
  // How many drugs PDSP covers in human moves with every refresh and every column
  // added; what must hold is that the feed only carries drugs that actually have
  // bindings, so an empty agent never reaches the Desk.
  assert.ok(agents.length > 0);
  assert.ok(agents.every(a => a.bindings.length > 0), 'no agent is listed without bindings');
  const halo = agents.find(a => a.name === 'Haloperidol');
  assert.ok(halo && halo.bindings.length > 0);
  const d2 = halo.bindings.find(b => b.target_alias === 'dopamine_d2');
  assert.ok(d2.sources.length >= 1);
  assert.equal(d2.sources[0].status, 'provided');   // migration default
  assert.equal(d2.value_status, 'unchecked');
  assert.ok('src' in d2);                            // as-imported label preserved
});

test('every binding rests on the single PDSP spine — no needs-source gaps', async () => {
  const agents = await (await fetch(`${base}/api/agents/binding`)).json();
  const all = agents.flatMap(a => a.bindings);
  assert.ok(all.length > 0);
  assert.ok(all.every(b => b.sources.length >= 1), 'every binding cites a source');
  assert.ok(all.every(b => b.status !== 'needs-source'), 'nothing is unsourced');
  assert.ok(all.every(b => b.src === 'PDSP KiDB (human)'), 'one source for all of them');
});

test('GET /api/sources/binding-usage counts edges per source', async () => {
  const usage = await (await fetch(`${base}/api/sources/binding-usage`)).json();
  assert.equal(usage.length, 1, 'a single cited source');
  const pdsp = usage[0];
  assert.match(pdsp.title, /PDSP/);
  // must agree with the drug-first feed rather than with a number typed in 2026
  const agents = await (await fetch(`${base}/api/agents/binding`)).json();
  assert.equal(pdsp.count, agents.flatMap(a => a.bindings).length);
  assert.ok(['verified', 'provided', 'conflicting'].includes(pdsp.status));
});
