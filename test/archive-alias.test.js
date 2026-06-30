import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';

test('archive aliases map entry numbers to receptor ids', () => {
  const db = openDb(':memory:');
  migrate(db);
  const get = (alias) => db.prepare(
    "SELECT receptor_id FROM receptor_aliases WHERE volume='archive' AND alias=?").get(alias)?.receptor_id;
  assert.equal(get('16'), 'gabaa');  // entry 16 = GABA-A
  assert.equal(get('21'), 'mor');    // entry 21 = μ-Opioid
  assert.equal(get('1'),  'ht1a');   // entry 1  = 5-HT1A
});
