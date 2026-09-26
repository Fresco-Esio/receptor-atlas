// changes.json (from the page's store) + desk/seed.json → db/curator-state.json.
// The converter's output is a valid edits file already; running it through a fresh
// database and exportState makes it byte-identical to what the old Desk would write,
// so a publish from here and a publish from there never show a phantom diff.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from '../db/index.js';
import { migrate } from './migrate.js';
import { exportState, importState, readState, STATE_FILE } from './curator-state.mjs';
import { SEED_FILE } from './desk-seed.mjs';
import { toCuratorState, summarise, publishedOnly, countPublished } from '../desk/desk-core.mjs';
import { summarise as summariseStates } from '../lib/git-publish.js';

export function canonicalise(state) {
  const db = openDb(':memory:'); migrate(db); importState(db, state);
  const out = exportState(db); db.close();
  return out;
}

const STATE_KEYS = ['review', 'activity', 'bindingReview', 'sources', 'receptorSources', 'bindingSources', 'content'];
const diffKeys = (a, b) => STATE_KEYS.filter(k => JSON.stringify((a || {})[k]) !== JSON.stringify((b || {})[k]));

/** The repo's edits file must be the snapshot's (seed.baseState), or what this Desk already published
 *  (the published records alone, converted and canonicalised). Anything else moved by another route. */
export function pull({ seed, changes, repoState }) {
  const fromSeed = diffKeys(seed.baseState, repoState);
  if (fromSeed.length) {
    // (a document can hold no published record yet still carry a published state, as a record's predecessor)
    const published = changes.map(publishedOnly);
    const anyPublished = published.some(c => countPublished([c]) > 0);
    const fromPublished = anyPublished ? diffKeys(canonicalise(toCuratorState(seed, published)), repoState) : fromSeed;
    if (fromPublished.length) return { ok: false, reason: 'seed moved', diff: fromPublished };
  }
  const state = canonicalise(toCuratorState(seed, changes));
  return { ok: true, state, summary: summaryOf(repoState, state, changes) };
}

/** What the publish does to the repo's edits file, in the words the old Desk's commits use (reverts and
 *  detaches included, since those make rows leave the file); the core's count of the changes only when
 *  there is no repo file to compare with. */
export function summaryOf(repoState, state, changes) {
  if (!repoState) return summarise(changes);
  return summariseStates(repoState, state).join(', ') || 'nothing to publish';
}

/** What is wrong with one change document, or null. */
function shapeError(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'is not a change document (an object)';
  if (typeof d.receptorId !== 'string') return 'has no receptorId';
  if (!d.fields || typeof d.fields !== 'object') return 'has no fields object';
  if (!d.sources || typeof d.sources !== 'object' || !Array.isArray(d.sources.add) || !d.sources.set || typeof d.sources.set !== 'object') return 'has no sources { add: [], set: {} }';
  return null;
}

/** The changes to pull: a JSON file holding an array of change documents (the page's Download changes,
 *  or the documents concatenated), or a directory whose every *.json is one document (ArtifactData list
 *  with out_dir). Documents for a receptor the seed does not have are skipped, with a note. */
export function loadChanges(path, seed, note = m => console.error(m)) {
  let docs;
  if (statSync(path).isDirectory()) {
    docs = readdirSync(path).filter(f => f.endsWith('.json')).sort().map(f => {
      const d = JSON.parse(readFileSync(join(path, f), 'utf8'));
      const err = shapeError(d); if (err) throw new Error(`${f} ${err}; each *.json in the directory must be a change document`);
      return d;
    });
  } else {
    docs = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(docs)) throw new Error(`${path} must be an array of change documents ([{ receptorId, fields, sources, ... }]), as Download changes saves it`);
    docs.forEach((d, i) => { const err = shapeError(d); if (err) throw new Error(`${path}: item ${i} ${err}`); });
  }
  const known = new Set(seed.receptors.map(r => r.id));
  return docs.filter(d => known.has(d.receptorId) || (note(`skipping changes for ${d.receptorId}: not a receptor in desk/seed.json`), false));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2); const check = args.includes('--check');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: node scripts/desk-pull.mjs [--check] <changes.json | directory of *.json>'); process.exit(1); }
  const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
  let changes;
  try { changes = loadChanges(file, seed); } catch (e) { console.error('desk:pull: ' + e.message); process.exit(1); }
  const r = pull({ seed, changes, repoState: readState() });
  if (!r.ok) { console.error(`refusing: the repo's edits file is neither the snapshot's (seed ${seed.commit}) nor what this Desk already published; it differs in: ${r.diff.join(', ')}. Re-seed the desk, or reconcile by hand.`); process.exit(2); }
  if (check) { console.log(`ok: ${r.summary}`); process.exit(0); }
  writeFileSync(STATE_FILE, JSON.stringify(r.state, null, 1) + '\n');
  console.log(`wrote db/curator-state.json: ${r.summary}`);
}
