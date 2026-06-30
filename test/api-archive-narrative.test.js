import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

let server, base;
before(async () => { server = createServer(':memory:', { seed: true });
  await new Promise(r => server.listen(0, r)); base = `http://localhost:${server.address().port}`; });
after(() => server.close());

test('GET /api/atlas/archive/narrative returns all entries with array list fields', async () => {
  const rows = await (await fetch(`${base}/api/atlas/archive/narrative`)).json();
  assert.equal(rows.length, 23);
  const gabaa = rows.find(r => r.receptor_id === 'gabaa');
  assert.equal(gabaa.alias, '16');
  assert.ok(gabaa.abstract.length > 10);
  assert.ok(Array.isArray(gabaa.body) && gabaa.body.length > 0);
  assert.ok(Array.isArray(gabaa.tags));
});
