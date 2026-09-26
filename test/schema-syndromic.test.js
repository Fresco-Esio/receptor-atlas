import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { exportState, importState } from '../scripts/curator-state.mjs';
import { createServer } from '../server.js';

const SYNDROMIC = ['onset', 'time_course', 'risk_factors_json', 'monitoring_json'];
const fresh = () => { const db = openDb(':memory:'); migrate(db); return db; };
const cols = db => db.prepare('PRAGMA table_info(clinical_rows)').all().map(c => c.name);

test('a fresh database has the four syndromic columns', () => {
  const c = cols(fresh());
  for (const k of SYNDROMIC) assert.ok(c.includes(k), `${k} missing`);
});

test('opening a database that already has them is a no-op', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-schema-syndromic-'));
  const file = join(dir, 'atlas.db');
  try {
    const db = openDb(file);
    migrate(db);
    const before = cols(db);
    db.close();

    // Simulate a second open of the same on-disk database (openDb runs schema +
    // ensureColumns every time it opens a file, not just on first creation).
    const again = openDb(file);
    migrate(again);
    assert.deepEqual(cols(again), before);
    for (const k of SYNDROMIC) assert.equal(cols(again).filter(c => c === k).length, 1);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the edits file carries a syndromic edit through a rebuild', () => {
  const a = fresh();
  a.prepare(`UPDATE clinical_rows SET onset='days to weeks', risk_factors_json=? WHERE no=3`).run(JSON.stringify(['elderly', 'high dose']));
  const dump = exportState(a);
  assert.equal(dump.content.clinical['3'].onset, 'days to weeks');
  assert.equal(dump.content.clinical['3'].risk_factors_json, JSON.stringify(['elderly', 'high dose']));
  const b = fresh();
  importState(b, dump);
  const row = b.prepare('SELECT onset, risk_factors_json FROM clinical_rows WHERE no=3').get();
  assert.equal(row.onset, 'days to weeks');
  assert.equal(row.risk_factors_json, JSON.stringify(['elderly', 'high dose']));
});

test('PATCH structured accepts the syndromic fields on a fresh database', async () => {
  const server = createServer(':memory:', { seed: true });
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const rows = await (await fetch(`${base}/api/atlas/ledger/clinical`)).json();
  const id = (await (await fetch(`${base}/api/receptors`)).json()).find(r => r.id === 'd2').id;
  const res = await fetch(`${base}/api/receptors/${id}/structured`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume: 'ledger', clinical: { onset: 'hours', risk_factors: ['x'] } }),
  });
  assert.equal(res.status, 200, await res.text());
  const detail = await (await fetch(`${base}/api/receptors/${id}/structured`)).json();
  assert.equal(detail.clinical.onset, 'hours');
  assert.deepEqual(detail.clinical.risk_factors, ['x']);
  await new Promise(r => server.close(r));
  assert.ok(rows.length > 0);
});
