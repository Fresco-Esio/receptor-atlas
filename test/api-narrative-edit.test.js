import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

let server, base;
before(async () => { server = createServer(':memory:', { seed: true });
  await new Promise(r => server.listen(0, r)); base = `http://localhost:${server.address().port}`; });
after(() => server.close());

test('GET structured includes the narrative block', async () => {
  const s = await (await fetch(`${base}/api/receptors/gabaa/structured`)).json();
  assert.ok(s.narrative && typeof s.narrative.abstract === 'string');
  assert.ok(Array.isArray(s.narrative.body));
});

test('PATCH narrative persists fields, round-trips lists, stamps archive activity', async () => {
  const res = await fetch(`${base}/api/receptors/gabaa/structured`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume: 'archive', narrative: { abstract: 'NEW abstract', body: ['p1', 'p2'], tags: ['t1'] } }),
  });
  assert.equal(res.status, 200);
  const s = await (await fetch(`${base}/api/receptors/gabaa/structured`)).json();
  assert.equal(s.narrative.abstract, 'NEW abstract');
  assert.deepEqual(s.narrative.body, ['p1', 'p2']);
  assert.deepEqual(s.narrative.tags, ['t1']);
  assert.ok(s.activity.archive?.last_edited_at, 'archive section stamped');
});
