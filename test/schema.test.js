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
    'claims','quizzes','review_state','section_activity'
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

test('a receptor can cite more than one source, each independently statused', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO receptors (id,label) VALUES ('d2','Dopamine D2')").run();
  const s1 = db.prepare("INSERT INTO sources (kind,authors,year,title) VALUES ('article','A',2020,'Paper one')").run().lastInsertRowid;
  const s2 = db.prepare("INSERT INTO sources (kind,authors,year,title) VALUES ('book','Stahl SM',2021,'Ch 5')").run().lastInsertRowid;
  db.prepare("INSERT INTO receptor_sources (receptor_id,source_id,status,is_primary) VALUES ('d2',?,'verified',1)").run(s1);
  db.prepare("INSERT INTO receptor_sources (receptor_id,source_id,status,is_primary) VALUES ('d2',?,'provided',0)").run(s2);
  const rows = db.prepare("SELECT source_id, status, is_primary FROM receptor_sources WHERE receptor_id='d2'").all();
  assert.equal(rows.length, 2);
});

test('the same source cannot be attached to a receptor twice', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO receptors (id,label) VALUES ('d2','Dopamine D2')").run();
  const s1 = db.prepare("INSERT INTO sources (authors,year,title) VALUES ('A',2020,'Paper one')").run().lastInsertRowid;
  db.prepare("INSERT INTO receptor_sources (receptor_id,source_id) VALUES ('d2',?)").run(s1);
  assert.throws(
    () => db.prepare("INSERT INTO receptor_sources (receptor_id,source_id) VALUES ('d2',?)").run(s1),
    /UNIQUE|PRIMARY KEY/
  );
});

test('sources.kind defaults to article and accepts book', () => {
  const db = openDb(':memory:');
  const id = db.prepare("INSERT INTO sources (authors,year,title) VALUES ('A',2020,'Paper one')").run().lastInsertRowid;
  assert.equal(db.prepare("SELECT kind FROM sources WHERE id=?").get(id).kind, 'article');
  const bookId = db.prepare("INSERT INTO sources (kind,authors,year,title) VALUES ('book','Stahl SM',2021,'Ch 5')").run().lastInsertRowid;
  assert.equal(db.prepare("SELECT kind FROM sources WHERE id=?").get(bookId).kind, 'book');
});

test('receptors carries its own search_query column', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO receptors (id,label,search_query) VALUES ('d3','Dopamine D3','test query')").run();
  assert.equal(db.prepare("SELECT search_query FROM receptors WHERE id='d3'").get().search_query, 'test query');
});
