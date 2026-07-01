// A Desk save should, a moment later, refresh the static snapshot on disk with no
// manual step — the whole point of auto-publish. We drive this through the real
// HTTP surface (a PATCH the Desk itself makes) and poll dist/ until it reflects
// the edit, rather than reaching into internals.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.js';

let dir, dbPath, publishDir, server, base;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'atlas-auto-pub-'));
  dbPath = join(dir, 'atlas.db');
  publishDir = join(dir, 'dist');
  server = createServer(dbPath, { seed: true, autoPublish: true, publishDir });
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise(res => (server ? server.close(res) : res()));
  for (let i = 0; ; i++) {
    try { await rm(dir, { recursive: true, force: true }); break; }
    catch (e) {
      if (i >= 10 || (e.code !== 'EBUSY' && e.code !== 'EPERM')) throw e;
      await new Promise(r => setTimeout(r, 50));
    }
  }
});

async function waitForClaim(text, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const rows = JSON.parse(await readFile(join(publishDir, 'data', 'cabinet.json'), 'utf8'));
      const d2 = rows.find(r => r.id === 'd2');
      if (d2 && d2.claim === text) return d2;
    } catch { /* dist/ not written yet */ }
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for dist/data/cabinet.json to show claim: ${text}`);
}

test('saving a claim at the Desk refreshes the published snapshot', async () => {
  const claim = 'AUTO-PUBLISH CHECK: D2 blockade drives antipsychotic efficacy.';
  const res = await fetch(`${base}/api/receptors/d2/structured`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume: 'cabinet', claim }),
  });
  assert.equal(res.status, 200);

  const d2 = await waitForClaim(claim);
  assert.equal(d2.claim, claim);
});

test('a burst of quick edits collapses into snapshots reflecting only the final save', async () => {
  const claims = ['burst 1', 'burst 2', 'burst 3 (final)'];
  for (const claim of claims) {
    await fetch(`${base}/api/receptors/d2/structured`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume: 'cabinet', claim }),
    });
  }
  const d2 = await waitForClaim('burst 3 (final)');
  assert.equal(d2.claim, 'burst 3 (final)');
});

test('a read (GET) never schedules a publish', async () => {
  // Sanity check on the gate itself: hitting a GET-only endpoint on a fresh
  // publishDir must not produce a snapshot.
  const freshDir = join(dir, 'unused-dist');
  const s2 = createServer(':memory:', { seed: true, autoPublish: true, publishDir: freshDir });
  await new Promise(r => s2.listen(0, r));
  const b2 = `http://localhost:${s2.address().port}`;
  await fetch(`${b2}/api/receptors`);
  await new Promise(r => setTimeout(r, 600));
  await assert.rejects(readFile(join(freshDir, 'data', 'cabinet.json')));
  await new Promise(res => s2.close(res));
});
