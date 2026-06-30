import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate, seedAliases } from '../scripts/migrate.js';
import { ALIASES } from '../scripts/seed-data.js';
import { createServer } from '../server.js';

test('migrate seeds the cross-volume aliases', () => {
  const db = openDb(':memory:');
  migrate(db);
  const n = db.prepare('SELECT COUNT(*) c FROM receptor_aliases').get().c;
  assert.equal(n, ALIASES.length);
});

test('seedAliases is idempotent (INSERT OR IGNORE, no duplication)', () => {
  const db = openDb(':memory:');
  migrate(db);
  seedAliases(db); seedAliases(db);          // extra runs must not duplicate
  const n = db.prepare('SELECT COUNT(*) c FROM receptor_aliases').get().c;
  assert.equal(n, ALIASES.length);
});

let server, base;
before(async () => {
  server = createServer(':memory:', { seed: true });
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('GET /api/atlas/cabinet carries each volume\'s own alias', async () => {
  const rows = await (await fetch(`${base}/api/atlas/cabinet`)).json();
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(byId.m1.alias, 'muscarinic_m1');
  assert.equal(byId.m3.alias, 'muscarinic_m3');
  assert.equal(byId.d2.alias, 'dopamine_d2');
  assert.equal(byId.mor.alias, 'mu_opioid');
});

test('GET /api/atlas/ledger uses the Ledger canonical ids as aliases', async () => {
  const rows = await (await fetch(`${base}/api/atlas/ledger`)).json();
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(byId.mor.alias, 'mu');
  assert.equal(byId.b1.alias, 'beta1');
  assert.equal(byId.ht2a.alias, '5ht2a');
  assert.equal(byId.a1.alias, 'alpha1');
});

test('the corrected M1/M3 PMID is what the Cabinet would now read', async () => {
  const rows = await (await fetch(`${base}/api/atlas/cabinet`)).json();
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(byId.m1.source.pmid, '24903776');   // not the stale 24445063
  assert.equal(byId.m3.source.pmid, '24903776');
});
