import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';

function cols(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

test('binding provenance tables exist with the stable-pair keys', () => {
  const db = openDb(':memory:');
  assert.deepEqual(cols(db, 'binding_sources'), ['agent_name', 'target_alias', 'source_id', 'status']);
  assert.deepEqual(cols(db, 'binding_review'), ['agent_name', 'target_alias', 'value_status']);
  assert.deepEqual(cols(db, 'binding_source_tags'), ['tag', 'source_id']);
});

test('binding_sources primary key is the stable pair + source', () => {
  const db = openDb(':memory:');
  const pk = db.prepare(`PRAGMA table_info(binding_sources)`).all().filter(c => c.pk).map(c => c.name);
  assert.deepEqual(pk.sort(), ['agent_name', 'source_id', 'target_alias']);
});
