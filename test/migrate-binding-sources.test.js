import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';

// The catalogue now rests on a single source spine: every binding affinity is a PDSP
// human median, so the seed produces one source cited by every binding and no gaps.
test('migration seeds one PDSP source cited by every binding', () => {
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
  assert.equal(sources, 1, 'a single source spine');
  assert.equal(total, 282, 'PDSP human coverage');
  assert.equal(edges, 282, 'every binding cites it');
  assert.equal(total - withEdge, 0, 'no needs-source gaps');
});

test('the spine is the PDSP human Ki database', () => {
  const db = openDb(':memory:');
  migrate(db);
  const tag = db.prepare(`SELECT tag, source_id FROM binding_source_tags`).get();
  assert.equal(tag.tag, 'PDSP KiDB (human)');
  const src = db.prepare('SELECT kind, authors, title FROM sources WHERE id = ?').get(tag.source_id);
  assert.equal(src.kind, 'database');
  assert.equal(src.authors, 'NIMH PDSP');
  assert.match(src.title, /PDSP/);
  const n = db.prepare('SELECT COUNT(*) c FROM binding_sources WHERE source_id = ?').get(tag.source_id).c;
  assert.equal(n, 282, 'the whole matrix cites the one source');
});

test('re-run is idempotent and preserves a curator-set status', () => {
  const db = openDb(':memory:');
  migrate(db);
  const edge = db.prepare('SELECT * FROM binding_sources LIMIT 1').get();
  db.prepare('UPDATE binding_sources SET status = ? WHERE agent_name = ? AND target_alias = ? AND source_id = ?')
    .run('verified', edge.agent_name, edge.target_alias, edge.source_id);
  migrate(db);   // restart
  assert.equal(db.prepare('SELECT COUNT(*) c FROM binding_sources').get().c, 282);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM binding_source_tags').get().c, 1);
  const after = db.prepare('SELECT status FROM binding_sources WHERE agent_name = ? AND target_alias = ? AND source_id = ?')
    .get(edge.agent_name, edge.target_alias, edge.source_id).status;
  assert.equal(after, 'verified');   // NOT reset to 'provided'
});
