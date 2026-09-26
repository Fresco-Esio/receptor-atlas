// changes.json (from the page's store) + desk/seed.json → db/curator-state.json.
// The converter's output is a valid edits file already; running it through a fresh
// database and exportState makes it byte-identical to what the old Desk would write,
// so a publish from here and a publish from there never show a phantom diff.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from '../db/index.js';
import { migrate } from './migrate.js';
import { exportState, importState, readState, STATE_FILE } from './curator-state.mjs';
import { SEED_FILE } from './desk-seed.mjs';
import { toCuratorState, summarise } from '../desk/desk-core.mjs';

export function canonicalise(state) {
  const db = openDb(':memory:'); migrate(db); importState(db, state);
  const out = exportState(db); db.close();
  return out;
}

export function pull({ seed, changes, repoState }) {
  const diff = ['review', 'activity', 'bindingReview', 'sources', 'receptorSources', 'bindingSources', 'content']
    .filter(k => JSON.stringify(seed.baseState[k]) !== JSON.stringify((repoState || {})[k]));
  if (diff.length) return { ok: false, reason: 'seed moved', diff };
  const state = canonicalise(toCuratorState(seed, changes));
  return { ok: true, state, summary: summarise(changes) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2); const check = args.includes('--check');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: node scripts/desk-pull.mjs [--check] <changes.json>'); process.exit(1); }
  const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
  const changes = JSON.parse(readFileSync(file, 'utf8'));
  const r = pull({ seed, changes: Array.isArray(changes) ? changes : Object.values(changes), repoState: readState() });
  if (!r.ok) { console.error(`refusing: the repo's edits file moved since the seed (${seed.commit}) in: ${r.diff.join(', ')}. Re-seed the desk, or reconcile by hand.`); process.exit(2); }
  if (check) { console.log(`ok: ${r.summary}`); process.exit(0); }
  writeFileSync(STATE_FILE, JSON.stringify(r.state, null, 1) + '\n');
  console.log(`wrote db/curator-state.json: ${r.summary}`);
}
