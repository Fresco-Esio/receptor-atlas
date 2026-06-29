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

test('serves the desk html at its path', async () => {
  const res = await fetch(`${base}/the-conservators-desk.html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
});

test('serves the atlas shell (not just any html) at /', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const body = await res.text();
  // a marker unique to the-receptor-atlas.html, so a wrong mapping would fail
  assert.match(body, /The Receptor Atlas/);
});

test('unknown path returns 404 json', async () => {
  const res = await fetch(`${base}/nope.xyz`);
  assert.equal(res.status, 404);
});

test('path traversal attempts are blocked', async () => {
  for (const attack of ['/../server.js', '/..%2f..%2fserver.js', '/%2e%2e/db/schema.sql']) {
    const res = await fetch(`${base}${attack}`);
    assert.equal(res.status, 404, `should block ${attack}`);
    const body = await res.text();
    assert.doesNotMatch(body, /createServer|CREATE TABLE/, `leaked a file via ${attack}`);
  }
});
