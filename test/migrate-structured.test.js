import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { migrateStructured, extractLiteral } from '../scripts/migrate-structured.js';

test('extractLiteral pulls a balanced array literal with strings containing brackets', () => {
  const src = `const X = [ {a:'has ] bracket', b:[1,2]}, {a:"two"} ];`;
  const out = extractLiteral(src, 'X');
  assert.equal(out.length, 2);
  assert.equal(out[0].a, 'has ] bracket');
  assert.deepEqual(out[0].b, [1, 2]);
});

test('migrate populates binding_values and clinical_rows', () => {
  const db = openDb(':memory:');
  migrate(db);                       // runs structuredBestEffort internally
  const bv = db.prepare('SELECT COUNT(*) c FROM binding_values').get().c;
  const cr = db.prepare('SELECT COUNT(*) c FROM clinical_rows').get().c;
  assert.ok(bv > 100, `expected many binding values, got ${bv}`);
  assert.equal(cr, 16);              // the Ledger's 16 DATA rows
});

test('binding_values resolve to canonical receptor_ids via the cabinet alias', () => {
  const db = openDb(':memory:');
  migrate(db);
  // Diazepam @ GABA-A: target_alias gaba_a -> receptor_id gabaa; Ki is the PDSP human median
  const row = db.prepare(`
    SELECT * FROM binding_values WHERE agent_name = 'Diazepam' AND target_alias = 'gaba_a'
  `).get();
  assert.equal(row.receptor_id, 'gabaa');
  assert.equal(row.ki, 16.2);
  assert.equal(row.src, 'PDSP KiDB (human)');
});

test('clinical_rows resolve to canonical receptor_ids and keep list fields as JSON', () => {
  const db = openDb(':memory:');
  migrate(db);
  // Row 1 = GABA-A; ledger canon gaba_a -> receptor_id gabaa
  const row = db.prepare('SELECT * FROM clinical_rows WHERE no = 1').get();
  assert.equal(row.receptor_id, 'gabaa');
  assert.match(row.name, /GABA-A/);
  const over = JSON.parse(row.over_json);
  assert.ok(Array.isArray(over) && over.length > 0);
});

test('migrateStructured is seed-only: a re-run preserves rows, edits, and row ids', () => {
  const db = openDb(':memory:');
  migrate(db);
  const first = db.prepare('SELECT COUNT(*) c FROM binding_values').get().c;

  // A curator edits a binding value in place (as the Desk's PATCH does).
  const row = db.prepare("SELECT id FROM binding_values WHERE agent_name='Diazepam' AND target_alias='gaba_a'").get();
  db.prepare('UPDATE binding_values SET ki = ?, note = ? WHERE id = ?').run(9.99, 'edited', row.id);

  migrateStructured(db);   // a "restart" re-migrate must not rebuild
  migrateStructured(db);

  assert.equal(db.prepare('SELECT COUNT(*) c FROM binding_values').get().c, first, 'row count unchanged');
  const after = db.prepare("SELECT id, ki, note FROM binding_values WHERE agent_name='Diazepam' AND target_alias='gaba_a'").get();
  assert.equal(after.ki, 9.99, 'edited Ki not clobbered');
  assert.equal(after.note, 'edited', 'edited note not clobbered');
  assert.equal(after.id, row.id, 'row id is stable (no delete + re-insert)');
});
