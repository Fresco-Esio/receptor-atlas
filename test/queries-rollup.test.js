import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { rollupStatus, receptorStatuses, receptorSources } from '../lib/queries.js';

test('rollupStatus: no sources is needs-source', () => {
  assert.equal(rollupStatus([]), 'needs-source');
});

test('rollupStatus: any conflicting wins outright', () => {
  assert.equal(rollupStatus(['verified', 'conflicting', 'provided']), 'conflicting');
});

test('rollupStatus: all verified rolls up to verified', () => {
  assert.equal(rollupStatus(['verified', 'verified']), 'verified');
});

test('rollupStatus: a mix of verified and provided rolls up to provided', () => {
  assert.equal(rollupStatus(['verified', 'provided']), 'provided');
});

function seedReceptorWithSources(db) {
  db.prepare("INSERT INTO receptors (id,label) VALUES ('d2','Dopamine D2')").run();
  const article = db.prepare("INSERT INTO sources (kind,authors,year,title,pmid) VALUES ('article','A',2020,'Paper one','111')").run().lastInsertRowid;
  const book = db.prepare("INSERT INTO sources (kind,authors,year,title,url,notes) VALUES ('book','Stahl SM',2021,'Ch 5','http://x','pp 1-2')").run().lastInsertRowid;
  db.prepare("INSERT INTO receptor_sources (receptor_id,source_id,status,is_primary,correction_note) VALUES ('d2',?,'verified',1,'fixed a typo')").run(article);
  db.prepare("INSERT INTO receptor_sources (receptor_id,source_id,status,is_primary) VALUES ('d2',?,'provided',0)").run(book);
  return { article, book };
}

test('receptorStatuses rolls up per receptor across its sources', () => {
  const db = openDb(':memory:');
  seedReceptorWithSources(db);
  const statuses = receptorStatuses(db);
  assert.equal(statuses.get('d2'), 'provided'); // verified + provided -> provided
});

test('receptorStatuses omits receptors with zero attached sources', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO receptors (id,label) VALUES ('d3','Dopamine D3')").run();
  const statuses = receptorStatuses(db);
  assert.equal(statuses.has('d3'), false);
});

test('receptorSources returns every attached source with its own status and primary flag', () => {
  const db = openDb(':memory:');
  const { article, book } = seedReceptorWithSources(db);
  const sources = receptorSources(db, 'd2');
  assert.equal(sources.length, 2);
  const a = sources.find(s => s.id === article);
  const b = sources.find(s => s.id === book);
  assert.equal(a.is_primary, true);
  assert.equal(a.status, 'verified');
  assert.equal(a.correction_note, 'fixed a typo');
  assert.equal(b.kind, 'book');
  assert.equal(b.is_primary, false);
  assert.equal(b.status, 'provided');
});

test('receptorSources returns an empty array for a sourceless receptor', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO receptors (id,label) VALUES ('d3','Dopamine D3')").run();
  assert.deepEqual(receptorSources(db, 'd3'), []);
});
