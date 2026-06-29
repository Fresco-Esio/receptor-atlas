import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';

test('schema creates all expected tables', () => {
  const db = openDb(':memory:');
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);
  for (const t of [
    'receptors','receptor_volumes','sources','receptor_sources',
    'stahl_loci','claims','quizzes','review_state','section_activity'
  ]) assert.ok(names.includes(t), `missing table: ${t}`);
});
