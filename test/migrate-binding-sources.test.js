import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';

test('migration seeds 13 sources, 105 edges, 31 needs-source', () => {
  const db = openDb(':memory:');
  migrate(db);
  const sources = db.prepare('SELECT COUNT(*) c FROM binding_source_tags').get().c;
  const edges   = db.prepare('SELECT COUNT(*) c FROM binding_sources').get().c;
  const total   = db.prepare('SELECT COUNT(*) c FROM binding_values').get().c;
  const withEdge = db.prepare(`
    SELECT COUNT(*) c FROM binding_values bv
    WHERE EXISTS (SELECT 1 FROM binding_sources bs
                  WHERE bs.agent_name = bv.agent_name AND bs.target_alias = bv.target_alias)
  `).get().c;
  assert.equal(sources, 13);
  assert.equal(edges, 105);
  assert.equal(total, 136);
  assert.equal(total - withEdge, 31);   // needs-source
});

test('PDSP Ki DB (incl. "PDSP / literature") owns 41 edges', () => {
  const db = openDb(':memory:');
  migrate(db);
  const sid = db.prepare(`SELECT source_id FROM binding_source_tags WHERE tag = 'PDSP Ki DB'`).get().source_id;
  const n = db.prepare('SELECT COUNT(*) c FROM binding_sources WHERE source_id = ?').get(sid).c;
  assert.equal(n, 41);
});

test('re-run is idempotent and preserves a curator-set status', () => {
  const db = openDb(':memory:');
  migrate(db);
  const edge = db.prepare('SELECT * FROM binding_sources LIMIT 1').get();
  db.prepare('UPDATE binding_sources SET status = ? WHERE agent_name = ? AND target_alias = ? AND source_id = ?')
    .run('verified', edge.agent_name, edge.target_alias, edge.source_id);
  migrate(db);   // restart
  assert.equal(db.prepare('SELECT COUNT(*) c FROM binding_sources').get().c, 105);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM binding_source_tags').get().c, 13);
  const after = db.prepare('SELECT status FROM binding_sources WHERE agent_name = ? AND target_alias = ? AND source_id = ?')
    .get(edge.agent_name, edge.target_alias, edge.source_id).status;
  assert.equal(after, 'verified');   // NOT reset to 'provided'
});
