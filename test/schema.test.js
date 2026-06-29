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

test('foreign keys are enforced', () => {
  const db = openDb(':memory:');
  // inserting a child row for a non-existent receptor must be rejected
  assert.throws(
    () => db.prepare("INSERT INTO receptor_volumes (receptor_id, volume) VALUES ('nope','archive')").run(),
    /FOREIGN KEY/
  );
});

test('composite primary keys prevent duplicate rows', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO receptors (id,label) VALUES ('d2','Dopamine D2')").run();
  db.prepare("INSERT INTO receptor_volumes (receptor_id,volume) VALUES ('d2','archive')").run();
  assert.throws(
    () => db.prepare("INSERT INTO receptor_volumes (receptor_id,volume) VALUES ('d2','archive')").run(),
    /UNIQUE|PRIMARY KEY/
  );
});
