// Publishing from inside the Desk: commit the curator dump and push it, which is
// what makes the work reach both the other machine and the public site.
//
// SAFETY
//
// Every git call goes through execFile with an argument ARRAY and never a shell
// string, so nothing here can be turned into a shell injection. Nothing the browser
// sends is used as an argument: the commit message is composed here, from the diff
// between the committed dump and the current one. The route has no request body at
// all. The server binds to loopback unless you opt out, so the button is reachable
// only from this machine.
//
// SCOPE
//
// It stages exactly one path: db/curator-state.json. A curation publish commits
// curation. If you also have code or docs edited in the tree, those are reported so
// you know they exist, and deliberately left for you to commit yourself, rather than
// swept into a commit whose message talks about receptors.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeState, STATE_FILE } from '../scripts/curator-state.mjs';
import { summariseStates, commitSubject } from '../desk/desk-core.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRACKED = 'db/curator-state.json';

const git = (...args) => run('git', args, { cwd: ROOT, windowsHide: true });

/** The committed dump, or null when it has never been committed. */
async function committedState() {
  try { return JSON.parse((await git('show', `HEAD:${TRACKED}`)).stdout); }
  catch { return null; }
}

export const summarise = summariseStates;
const commitMessage = lines => commitSubject(lines);

/** Turn a git remote into something a person can click. */
export function webUrl(remote) {
  const s = String(remote || '').trim();
  const m = s.match(/^git@([^:]+):(.+?)(?:\.git)?$/) || s.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  return m ? `https://${m[1]}/${m[2]}` : null;
}

/**
 * Write the dump, commit it, push it. Returns a plain object the Desk can render:
 * never throws for an expected condition (nothing to publish, no remote, remote
 * ahead), because those are answers rather than faults.
 */
export async function publishToGit(db) {
  try { await git('rev-parse', '--git-dir'); }
  catch { return { ok: false, error: 'This folder is not a git repository, so there is nowhere to publish to.' }; }

  writeState(db, STATE_FILE);

  const before = await committedState();
  const after = JSON.parse(readFileSync(STATE_FILE, 'utf8'));

  const { stdout: dirty } = await git('status', '--porcelain');
  const otherChanges = dirty.split('\n').map(l => l.slice(3).trim())
    .filter(p => p && p !== TRACKED && !p.startsWith('db/atlas.db') && p !== 'dist/');

  const staged = (await git('status', '--porcelain', '--', TRACKED)).stdout.trim();
  if (!staged) {
    return { ok: true, published: false, reason: 'Nothing to publish since your last push.', otherChanges };
  }

  const lines = summarise(before, after);
  const message = commitMessage(lines.length ? lines : ['review session']);

  try {
    await git('add', '--', TRACKED);
    await git('commit', '-m', message);
  } catch (e) {
    return { ok: false, error: 'Could not commit: ' + String(e.stderr || e.message).trim().split('\n')[0] };
  }

  let remoteUrl = null;
  try { remoteUrl = webUrl((await git('remote', 'get-url', 'origin')).stdout); }
  catch {
    return { ok: true, published: true, pushed: false, summary: lines, message, otherChanges,
      reason: 'Committed locally. There is no "origin" remote, so nothing was pushed.' };
  }

  try {
    await git('push', 'origin', 'HEAD');
  } catch (e) {
    const err = String(e.stderr || e.message);
    const behind = /non-fast-forward|fetch first|rejected/i.test(err);
    return { ok: true, published: true, pushed: false, summary: lines, message, otherChanges,
      reason: behind
        ? 'Committed, but the push was refused because the remote has work yours does not. Run "git pull" and publish again.'
        : 'Committed, but the push failed: ' + err.trim().split('\n')[0] };
  }

  return { ok: true, published: true, pushed: true, summary: lines, message, otherChanges,
    remote: remoteUrl, build: remoteUrl ? remoteUrl + '/actions' : null };
}
