// Save and restore section_activity around a destructive database rebuild.
//
//   node scripts/preserve-activity.mjs save      # before: rm db/atlas.db && npm run migrate
//   node scripts/preserve-activity.mjs restore   # after
//
// Everything else in the database re-seeds: receptor_sources statuses come back from
// seed-data.js, review_state is re-created blank per receptor, binding_values is rebuilt
// from the dashboard literal. section_activity does not — it records when a curator last
// edited or reviewed a section, and nothing else knows those timestamps.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDb } from '../db/index.js';

const BACKUP = new URL('../db/.section-activity.bak.json', import.meta.url);

export function saveActivity(db) {
  return db.prepare('SELECT receptor_id, volume, last_edited_at, last_reviewed_at FROM section_activity').all();
}

export function restoreActivity(db, rows) {
  const ins = db.prepare(`INSERT OR REPLACE INTO section_activity
    (receptor_id, volume, last_edited_at, last_reviewed_at) VALUES (?,?,?,?)`);
  let n = 0;
  for (const r of rows) { ins.run(r.receptor_id, r.volume, r.last_edited_at, r.last_reviewed_at); n++; }
  return n;
}

// Run directly, but not when imported by tests. pathToFileURL keeps the comparison
// correct on Windows (backslashes/drive letters), matching scripts/migrate.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode === 'save') {
    const rows = saveActivity(openDb());
    writeFileSync(BACKUP, JSON.stringify(rows, null, 1));
    console.log(`saved ${rows.length} section_activity rows`);
  } else if (mode === 'restore') {
    if (!existsSync(BACKUP)) { console.log('no backup present, nothing to restore'); process.exit(0); }
    const rows = JSON.parse(readFileSync(BACKUP, 'utf8'));
    console.log(`restored ${restoreActivity(openDb(), rows)} section_activity rows`);
  } else {
    console.error('usage: preserve-activity.mjs <save|restore>');
    process.exit(1);
  }
}
