import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { saveActivity, restoreActivity } from '../scripts/preserve-activity.mjs';

// A full rebuild (rm db/atlas.db + npm run migrate) re-seeds receptor_sources and
// review_state from seed-data.js, but nothing regenerates section_activity — it is
// real user state. These helpers are the only thing standing between a data refresh
// and silently losing it.
test('section_activity survives a save/restore round trip', () => {
  const db = openDb(':memory:');
  migrate(db);
  db.prepare(`INSERT OR REPLACE INTO section_activity
    (receptor_id, volume, last_edited_at, last_reviewed_at) VALUES (?,?,?,?)`)
    .run('d1', 'cabinet', '2026-07-01T10:00:00Z', '2026-07-02T11:00:00Z');

  const saved = saveActivity(db);
  assert.equal(saved.length, 1);

  db.prepare('DELETE FROM section_activity').run();
  assert.equal(db.prepare('SELECT COUNT(*) c FROM section_activity').get().c, 0);

  const n = restoreActivity(db, saved);
  assert.equal(n, 1);
  const row = db.prepare('SELECT * FROM section_activity').get();
  assert.equal(row.receptor_id, 'd1');
  assert.equal(row.volume, 'cabinet');
  assert.equal(row.last_edited_at, '2026-07-01T10:00:00Z');
  assert.equal(row.last_reviewed_at, '2026-07-02T11:00:00Z');
});

test('restoring an empty set is a no-op, not a crash', () => {
  const db = openDb(':memory:');
  migrate(db);
  assert.equal(restoreActivity(db, []), 0);
});
