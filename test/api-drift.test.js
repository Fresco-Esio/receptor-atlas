import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { reviewDrift } from '../lib/queries.js';
import { createServer } from '../server.js';

test('reviewDrift returns only sections edited after (or without) their review', () => {
  const db = openDb(':memory:');
  migrate(db);
  const ins = db.prepare(
    'INSERT INTO section_activity (receptor_id, volume, last_edited_at, last_reviewed_at) VALUES (?,?,?,?)'
  );
  ins.run('gabaa', 'cabinet', '2026-06-29T10:00:00Z', '2026-06-29T09:00:00Z'); // edited AFTER reviewed → drift
  ins.run('d2',    'cabinet', '2026-06-29T08:00:00Z', '2026-06-29T09:00:00Z'); // reviewed AFTER edited → no drift
  ins.run('ht2a',  'ledger',  '2026-06-29T08:00:00Z', null);                   // edited, never reviewed → drift

  const ids = reviewDrift(db).map(d => `${d.receptor_id}:${d.volume}`);
  assert.ok(ids.includes('gabaa:cabinet'));
  assert.ok(ids.includes('ht2a:ledger'));
  assert.ok(!ids.includes('d2:cabinet'));
});

let server, base;
before(async () => {
  server = createServer(':memory:', { seed: true });
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('GET /api/review/drift exposes the drift list and reflects a fresh edit', async () => {
  // a freshly seeded DB has no activity → empty drift
  let drift = await (await fetch(`${base}/api/review/drift`)).json();
  assert.equal(drift.length, 0);

  // editing structured data stamps last_edited_at with no review → becomes drift
  await fetch(`${base}/api/receptors/gabaa/structured`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume: 'cabinet', claim: 'touched' }),
  });
  drift = await (await fetch(`${base}/api/review/drift`)).json();
  assert.ok(drift.some(d => d.receptor_id === 'gabaa' && d.volume === 'cabinet'));
});
