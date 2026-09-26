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
import { rekeyAll } from '../desk/desk-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export { publishedShas, unpublishedReverts, rekeyAll } from '../desk/desk-core.mjs';

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
  if (!r.ok) { console.error('refusing: ' + r.message); process.exit(2); }
  process.stdout.write(JSON.stringify(r.docs, null, 1) + '\n');
}
