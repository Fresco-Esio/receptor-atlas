// After "re-seed the desk": re-key the stored change documents onto the new desk/seed.json.
// rekey drops every published record, on the grounds that the new seed already carries it.
// That holds only when each publish is in the history the seed was built from, so this
// refuses (exit 2) unless every distinct publishedAs is an ancestor of HEAD. On success it
// prints the re-keyed documents as a JSON array on stdout, for the session to write back.
//   npm run desk:rekey -- <changes.json | directory of *.json>
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { SEED_FILE } from './desk-seed.mjs';
import { loadChanges } from './desk-pull.mjs';
import { rekey } from '../desk/desk-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every distinct publishedAs in the documents, in first-seen order. */
export function publishedShas(changes) {
  const shas = new Set();
  for (const c of changes) {
    const src = c.sources || {};
    for (const r of [...Object.values(c.fields || {}), ...(src.add || []), ...(src.remove || []), ...Object.values(src.set || {}), ...(c.review ? [c.review] : [])]) if (r && r.publishedAs) shas.add(r.publishedAs);
  }
  return [...shas];
}

/** isAncestor(sha) → boolean is the git seam. */
export function rekeyAll(seed, changes, isAncestor) {
  const missing = publishedShas(changes).filter(sha => !isAncestor(sha));
  if (missing.length) return { ok: false, missing };
  return { ok: true, docs: changes.map(c => rekey(c, seed)) };
}

export function gitIsAncestor(sha) {
  try { execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: ROOT, stdio: 'ignore' }); return true; }
  catch { return false; }   // exit 1 (not an ancestor) or 128 (unknown sha): either way not in this history
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: npm run desk:rekey -- <changes.json | directory of *.json>'); process.exit(1); }
  const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
  let changes;
  try { changes = loadChanges(file, seed); } catch (e) { console.error('desk:rekey: ' + e.message); process.exit(1); }
  const r = rekeyAll(seed, changes, gitIsAncestor);
  if (!r.ok) { console.error(`refusing: published as ${r.missing.join(', ')}, which ${r.missing.length === 1 ? 'is' : 'are'} not in the history of HEAD, so the new seed (${seed.commit}) may not carry ${r.missing.length === 1 ? 'it' : 'them'}. Pull, re-seed, and run this again.`); process.exit(2); }
  process.stdout.write(JSON.stringify(r.docs, null, 1) + '\n');
}
