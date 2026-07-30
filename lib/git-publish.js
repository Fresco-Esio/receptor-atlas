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

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRACKED = 'db/curator-state.json';

const git = (...args) => run('git', args, { cwd: ROOT, windowsHide: true });

/** The committed dump, or null when it has never been committed. */
async function committedState() {
  try { return JSON.parse((await git('show', `HEAD:${TRACKED}`)).stdout); }
  catch { return null; }
}

const keys = o => Object.keys(o || {});

/** Describe the delta in the words a curator would use, so the history is readable
 *  without opening a diff. Returns [] when nothing of substance moved. */
export function summarise(before, after) {
  const b = before || { review: {}, sources: [], receptorSources: [], bindingSources: [], content: {} };
  const bc = b.content || {}, ac = after.content || {};
  const out = [];

  const reviewed = keys(after.review).filter(id => JSON.stringify(after.review[id]) !== JSON.stringify((b.review || {})[id]));
  if (reviewed.length) out.push(`${reviewed.length} specimen${reviewed.length === 1 ? '' : 's'} reviewed`);

  const beforeSources = new Set((b.sources || []).map(s => s.key));
  const newSources = (after.sources || []).filter(s => !beforeSources.has(s.key));
  if (newSources.length) out.push(`${newSources.length} source${newSources.length === 1 ? '' : 's'} added`);

  // The dump carries only the delta from a fresh seed, so an edge appearing in it
  // for the first time does NOT mean the citation is new: it means something about
  // it stopped matching the seed. Verifying a citation the atlas already shipped
  // makes a row appear here, and calling that "attached" is a lie about what the
  // curator did. The Desk attaches at status 'provided', so that is the tell.
  const edgeKey = e => `${e.receptor_id}|${e.source}`;
  const beforeEdges = new Map((b.receptorSources || []).map(e => [edgeKey(e), e.status]));
  const fresh = (after.receptorSources || []).filter(e => !beforeEdges.has(edgeKey(e)));
  const attached = fresh.filter(e => e.status === 'provided');
  const restatused = [
    ...fresh.filter(e => e.status !== 'provided'),
    ...(after.receptorSources || []).filter(e => beforeEdges.has(edgeKey(e)) && beforeEdges.get(edgeKey(e)) !== e.status),
  ];
  if (attached.length) out.push(`${attached.length} citation${attached.length === 1 ? '' : 's'} attached`);
  if (restatused.length) {
    const verified = restatused.filter(e => e.status === 'verified').length;
    out.push(verified === restatused.length
      ? `${verified} citation${verified === 1 ? '' : 's'} verified`
      : `${restatused.length} citation status${restatused.length === 1 ? '' : 'es'} changed`);
  }

  const bindKey = e => `${e.agent_name}|${e.target_alias}|${e.source}`;
  const beforeBinds = new Map((b.bindingSources || []).map(e => [bindKey(e), e.status]));
  const bindMoved = (after.bindingSources || []).filter(e => beforeBinds.get(bindKey(e)) !== e.status);
  if (bindMoved.length) out.push(`${bindMoved.length} binding citation${bindMoved.length === 1 ? '' : 's'} settled`);

  const contentMoved = [
    ...keys(ac.claims).filter(k => (ac.claims || {})[k] !== (bc.claims || {})[k]).map(() => 'claim'),
    ...keys(ac.archive).filter(k => JSON.stringify((ac.archive || {})[k]) !== JSON.stringify((bc.archive || {})[k])).map(() => 'narrative'),
    ...keys(ac.clinical).filter(k => JSON.stringify((ac.clinical || {})[k]) !== JSON.stringify((bc.clinical || {})[k])).map(() => 'clinical row'),
  ];
  const bindingEdits = (ac.bindings || []).filter(x =>
    !(bc.bindings || []).some(y => y.agent_name === x.agent_name && y.target_alias === x.target_alias && JSON.stringify(y) === JSON.stringify(x)));
  if (contentMoved.length) {
    const kinds = [...new Set(contentMoved)];
    out.push(`${contentMoved.length} ${kinds.length === 1 ? kinds[0] : 'content'} edit${contentMoved.length === 1 ? '' : 's'}`);
  }
  if (bindingEdits.length) out.push(`${bindingEdits.length} affinity value${bindingEdits.length === 1 ? '' : 's'} edited`);

  // Undoing work makes rows LEAVE the dump, because the dump holds only the delta
  // from a fresh seed and undoing puts you back on the seed. Everything above reads
  // what is present, so a session spent reverting summarised to nothing at all and
  // committed as "review session". A revert is a decision worth recording.
  const gone =
    keys(b.review).filter(id => !(after.review || {})[id]).length
    + (b.sources || []).filter(s => !(after.sources || []).some(x => x.key === s.key)).length
    + (b.receptorSources || []).filter(e => !(after.receptorSources || []).some(x => edgeKey(x) === edgeKey(e))).length
    + (b.bindingSources || []).filter(e => !(after.bindingSources || []).some(x => bindKey(x) === bindKey(e))).length
    + keys(bc.claims).filter(k => !(ac.claims || {})[k]).length
    + keys(bc.archive).filter(k => !(ac.archive || {})[k]).length
    + keys(bc.clinical).filter(k => !(ac.clinical || {})[k]).length
    + (bc.bindings || []).filter(x => !(ac.bindings || []).some(y => y.agent_name === x.agent_name && y.target_alias === x.target_alias)).length;
  if (gone) out.push(`${gone} change${gone === 1 ? '' : 's'} returned to what the atlas ships`);

  // Said last and only when it is the whole story, because a timestamp moving is
  // real but is not what a session was about. Without it an activity-only publish
  // fell through to "curate: review session", which tells a future reader nothing.
  if (!out.length && JSON.stringify(b.activity || []) !== JSON.stringify(after.activity || [])) {
    out.push('review timestamps updated');
  }

  return out;
}

function commitMessage(lines) {
  const subject = `curate: ${lines.join(', ')}`;
  // Keep the subject readable; the detail is in the diff either way.
  return subject.length <= 72 ? subject : `curate: ${lines.length} changes this session`;
}

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
