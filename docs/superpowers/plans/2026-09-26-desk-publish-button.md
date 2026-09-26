# Desk Publish Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Publish button in the browser-mode Desk (`/desk/` on the site, `desk/desk.html` on disk) that commits `db/curator-state.json` to `main` through GitHub's REST API with the owner's fine-grained token, marks the changes published, and re-keys stored changes onto the rebuilt snapshot on the next load.

**Architecture:** Everything pure moves into `desk/desk-core.mjs` (already inlined into the page by `desk:build`): the stale-seed check and edits-file text (`preparePublish`), the commit words (`summariseStates`, `commitSubject`, lifted from `lib/git-publish.js`), the document-shape check and the re-key rules (lifted from `scripts/desk-pull.mjs` / `scripts/desk-rekey.mjs`, which keep their exports by re-importing). The template adds the token dialog, the button, the confirm/refusal dialogs, the receipt, the load-time re-key and an Import button, all gated on `!window.claude`. Only the page talks to GitHub (`fetch` in exactly one helper); Node code is untouched behaviourally. The walkthrough fakes GitHub with Playwright `page.route`.

**Tech Stack:** Node 22 ESM, `node --test`, vanilla HTML/JS template, Playwright (walkthrough only), GitHub REST API (contents, compare), Windows host for git/push via Desktop Commander.

**Spec:** `docs/superpowers/specs/2026-09-26-desk-publish-button-design.md` (and section 6 of the owner's explainer artifact).

## Global Constraints

- `desk/desk-core.mjs` must stay free of `node:` imports, DOM access and any `import`/`export` form other than `export const|let|function|async function|class` (the build strips exactly those; `buildDesk` refuses anything else).
- The page must contain exactly one `fetch(` call, in the `gh()` helper, and its base URL must be `https://api.github.com`. The walkthrough's self-contained check is updated to assert this (Task 3); nothing else may call `fetch`.
- Nothing Publish-related renders while `window.claude` exists (the claude.ai frame). Storage in browser mode stays `localStorage` under the existing key `atlas-desk-changes-v1`.
- `markPublishedFrom` is only called after the PUT returned a commit sha; a failure before that marks nothing.
- The token is sent only to `https://api.github.com`, never logged, never put in a URL, never written anywhere but `localStorage['atlas-desk-github-token']` (and only when "remember" is on).
- All existing tests keep passing: `npm test` (244 today) and `NODE_PATH=$(npm root -g) node scripts/desk-walkthrough.mjs --mode local` (83 checks today). The walkthrough must stay green in both its browser pass and its fake-frame pass.
- Commit messages end with the two attribution lines (`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n`). Work on branch `desk-publish-button` off `main` in `/home/claude/atlas`; no commits to `main` here (Task 6 moves them to the host).
- `db/atlas.db` is never opened by any script or test added here.

**User decisions (already made):**
- "I kinda want to have a button on desk that just saves and updates the site for me. It does the commit or whatever. I would be the only person who knows about the desk anyway so that's fine."
- Approach: "Yes, build it" — button in the site copy and the disk copy; claude.ai copy unchanged; plus an Import changes button.
- Token: "Remember in this browser", with a Forget button.
- Earlier, still binding: the page must work with claude.ai absent; re-seed of the artifact only on request (this plan does not republish the artifact); no `mastery` / `citations verified` gate.

---

### Task 1: Core — ordered converter output, `preparePublish`, commit words

**Goal:** `toCuratorState` output is byte-identical to `canonicalise()`'s; `preparePublish(seed, changes, repoState)` gives the page the stale check, the file text and the commit subject; the commit words live in desk-core and `lib/git-publish.js` re-exports them.

**Files:**
- Modify: `desk/desk-core.mjs` (end of `toCuratorState`, ~line 246; new exports after `summarise`, ~line 268)
- Modify: `lib/git-publish.js:42-123` (`summarise` and `commitMessage` become imports from desk-core)
- Modify: `scripts/desk-pull.mjs:22-45` (`setwise`/`diffKeys`/`pull` use the core functions)
- Test: `test/desk-core.test.js`, `test/desk-pull.test.js`

**Acceptance Criteria:**
- [ ] For two fixtures (below), `JSON.stringify(toCuratorState(seed, changes), null, 1) === JSON.stringify(canonicalise(toCuratorState(seed, changes)), null, 1)`.
- [ ] `preparePublish(seed, changes, seed.baseState)` → `{ ok: true, state, text, subject }` with `text === JSON.stringify(state, null, 1) + '\n'` and `subject` starting `curate: `.
- [ ] `preparePublish` with a `repoState` that differs from both the snapshot's and the page's published state → `{ ok: false, reason: 'seed moved', diff: [...keys] }`.
- [ ] `preparePublish` with `repoState` equal to what the page already published (first publish marked, then a second edit) → `ok: true`.
- [ ] `commitSubject(['3 content edits', '1 source attached'])` → `'curate: 3 content edits, 1 source attached'`; a subject over 72 chars → `'curate: N changes this session'`; `[]` → `'curate: review session'`.
- [ ] `summarise` and `webUrl` from `lib/git-publish.js` still pass `test/git-publish.test.js` unchanged.
- [ ] `pull()` in desk-pull still passes its tests unchanged.

**Verify:** `npm test` → all pass (count grows by the new tests, none fail).

**Steps:**

- [ ] **Step 1: Write the failing tests** (append to `test/desk-core.test.js`; the byte-identity test goes in `test/desk-pull.test.js`, which already imports `canonicalise`, `buildSeed`, `exportState`, `fresh`)

```js
// test/desk-pull.test.js — append
test('converter output is byte-identical to its canonical form (map key order follows the pristine seed)', () => {
  const seed = buildSeed({ baseState: exportState(fresh()), commit: 'x' });
  const order = seed.receptors.map(r => r.id);
  // scenario 1: a few receptors, every kind of record, touched out of seed order
  let a = core.emptyChanges(order[0], 'x');
  a = core.setField(a, 'archive.abstract', 'New abstract text.', AT);
  a = core.setField(a, 'clinical.onset', 'hours', AT);
  a = core.setField(a, 'clinical.over', ['x', 'y'], AT);
  a = core.setField(a, 'claim', 'A claim', AT);
  a = core.attachSource(a, seed, { kind: 'article', authors: 'Doe J', year: 2020, title: 'T', journal: 'J', pmid: '12345678', doi: '10.1000/x', url: null, notes: null }, { is_primary: 1 }, AT);
  a = core.setReview(a, { mechanism: 1, affinity: 0, clinical: 1, note: 'n' }, AT);
  let b = core.emptyChanges(order[1], 'x');
  b = core.setField(b, 'archive.body', ['p1', 'p2'], AT);
  b = core.setField(b, 'clinical.name', 'Renamed', AT);
  const r1 = seed.receptors[1]; if ((r1.sources || []).length) b = core.setSourceFlags(b, seed, r1.sources[0].key, { conflicting: true }, AT);
  for (const changes of [[a, b], [b, a]]) {
    const raw = core.toCuratorState(seed, changes);
    assert.equal(JSON.stringify(raw, null, 1), JSON.stringify(canonicalise(raw), null, 1));
  }
  // scenario 2: six receptors in reverse seed order, each with a claim, an Archive and Ledger field where present, a review and a new source
  const cs = [];
  for (const r of [...seed.receptors].reverse().slice(0, 6)) {
    let c = core.setField(core.emptyChanges(r.id, 'x'), 'claim', 'Claim for ' + r.id, AT);
    if (r.archive) c = core.setField(c, 'archive.effect', 'E ' + r.id, AT);
    if (r.clinicalNo != null) c = core.setField(c, 'clinical.mech', 'M ' + r.id, AT);
    c = core.setReview(c, { affinity: 1 }, AT);
    c = core.attachSource(c, seed, { kind: 'article', authors: 'X', year: 2021, title: 'T' + r.id, journal: 'J', pmid: String(20000000 + order.indexOf(r.id)), doi: null, url: null, notes: null }, {}, AT);
    cs.push(c);
  }
  const raw2 = core.toCuratorState(seed, cs);
  assert.equal(JSON.stringify(raw2, null, 1), JSON.stringify(canonicalise(raw2), null, 1));
});

test('preparePublish: accepts the snapshot file and the page\'s own last publish, refuses a moved file', () => {
  const base = exportState(fresh());
  const seed = buildSeed({ baseState: base, commit: 'x' });
  let c = core.setField(core.emptyChanges('d2', 'x'), 'claim', 'New claim', AT);
  const first = core.preparePublish(seed, [c], base);
  assert.equal(first.ok, true);
  assert.equal(first.text, JSON.stringify(first.state, null, 1) + '\n');
  assert.equal(first.subject, 'curate: 1 claim edit');
  assert.deepEqual(first.state, core.toCuratorState(seed, [c]));
  // the repo now holds that publish; a second edit is accepted against it
  c = core.markPublishedFrom(c, c, 'sha1', AT);
  c = core.setField(c, 'archive.abstract', 'Second.', AT);
  const second = core.preparePublish(seed, [c], first.state);
  assert.equal(second.ok, true);
  assert.equal(second.subject, 'curate: 1 narrative edit');
  // a file that is neither: refused, naming what differs
  const moved = JSON.parse(JSON.stringify(base)); moved.review.d1 = { mechanism: 1, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: 'elsewhere' };
  const no = core.preparePublish(seed, [c], moved);
  assert.equal(no.ok, false); assert.equal(no.reason, 'seed moved'); assert.deepEqual(no.diff, ['review']);
  // nothing to publish is still ok (subject falls back)
  assert.equal(core.preparePublish(seed, [], base).subject, 'curate: review session');
});
```

```js
// test/desk-core.test.js — append
test('commitSubject: curate: + the lines, or a count when over 72 characters', () => {
  assert.equal(core.commitSubject(['3 content edits', '1 source attached']), 'curate: 3 content edits, 1 source attached');
  assert.equal(core.commitSubject([]), 'curate: review session');
  assert.equal(core.commitSubject(['12 specimens reviewed', '9 sources added', '14 citations attached', '3 conflicts noted']), 'curate: 4 changes this session');
});

test('stateDiffKeys compares as data: key order and row order do not count', () => {
  const a = { review: { x: { m: 1 }, y: { m: 0 } }, sources: [{ key: 'a' }, { key: 'b' }], activity: [], bindingReview: [], receptorSources: [], bindingSources: [], content: {} };
  const b = { review: { y: { m: 0 }, x: { m: 1 } }, sources: [{ key: 'b' }, { key: 'a' }], activity: [], bindingReview: [], receptorSources: [], bindingSources: [], content: {} };
  assert.deepEqual(core.stateDiffKeys(a, b), []);
  b.sources.push({ key: 'c' });
  assert.deepEqual(core.stateDiffKeys(a, b), ['sources']);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test test/desk-core.test.js test/desk-pull.test.js`
Expected: FAIL — `core.preparePublish is not a function`, `core.commitSubject is not a function`, `core.stateDiffKeys is not a function`, and the byte-identity assertion fails on key order.

- [ ] **Step 3: Order the converter's maps** — in `desk/desk-core.mjs`, replace the final `return { format: FORMAT, review: out.review, … }` of `toCuratorState` with:

```js
  // Map key order follows the pristine seed (the database's row order), so the file is byte-identical to
  // exportState's: keys the seed does not have (a receptor's first review, say) go last, in the order made.
  const like = (obj, ref) => { const idx = new Map(Object.keys(ref || {}).map((k, i) => [k, i])); const at = k => idx.has(k) ? idx.get(k) : Infinity; return Object.fromEntries(Object.keys(obj).map((k, i) => [k, i]).sort((x, y) => (at(x[0]) - at(y[0])) || (x[1] - y[1])).map(([k]) => [k, obj[k]])); };
  return { format: FORMAT, review: like(out.review, P.review), activity: out.activity, bindingReview: out.bindingReview || [], sources: out.sources, receptorSources: out.receptorSources, bindingSources: out.bindingSources || [],
    content: { claims: like(out.content.claims, P.claims), archive: like(out.content.archive, P.archive), clinical: like(out.content.clinical, P.clinical), bindings: out.content.bindings || [] } };
```

- [ ] **Step 4: Add `stateDiffKeys`, `summariseStates`, `commitSubject`, `preparePublish`** to `desk/desk-core.mjs` after `summarise` (before `records`). `summariseStates` is `summarise(before, after)` from `lib/git-publish.js:42-113` moved verbatim (with its `keys` helper — `const keys = o => Object.keys(o || {});` — check that name is free in desk-core first; rename to `keysOfObj` if not):

```js
// ---------- publishing: the check desk:pull makes, and the words its commit uses ----------
const STATE_KEYS = ['review', 'activity', 'bindingReview', 'sources', 'receptorSources', 'bindingSources', 'content'];
// Compared as data, not bytes: object keys sorted and every array taken as a set of rows. The edits file's
// arrays are row lists (activity, sources, edges, bindings) whose order is only the order rows were written in.
const setwise = v => Array.isArray(v) ? '[' + v.map(setwise).sort().join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + setwise(v[k])).join(',') + '}'
  : JSON.stringify(v === undefined ? null : v);
/** The top-level keys of the edits file on which two states differ as data. */
export function stateDiffKeys(a, b) { return STATE_KEYS.filter(k => setwise((a || {})[k]) !== setwise((b || {})[k])); }

const keysOfObj = o => Object.keys(o || {});
/** The delta between two edits files in a curator's words (the old Desk's commit subjects). [] when nothing of substance moved. */
export function summariseStates(before, after) {
  // … body of lib/git-publish.js summarise(before, after), verbatim, with `keys(` → `keysOfObj(` …
}

/** `curate: ` + the lines; a count when that would not fit a 72-character subject; the old Desk's fallback when there are none. */
export function commitSubject(lines) {
  if (!lines.length) return 'curate: review session';
  const subject = `curate: ${lines.join(', ')}`;
  return subject.length <= 72 ? subject : `curate: ${lines.length} changes this session`;
}

/** What a publish from the page needs: the repo's edits file must be the snapshot's (seed.baseState) or what
 *  this Desk already published (its published records alone, converted); anything else moved by another route.
 *  On ok: the new state, its file text (desk:pull's formatting) and the commit subject. */
export function preparePublish(seed, changes, repoState) {
  const fromSeed = stateDiffKeys(seed.baseState, repoState);
  if (fromSeed.length) {
    const published = changes.map(publishedOnly);
    const anyPublished = published.some(c => countPublished([c]) > 0);
    const fromPublished = anyPublished ? stateDiffKeys(toCuratorState(seed, published), repoState) : fromSeed;
    if (fromPublished.length) return { ok: false, reason: 'seed moved', diff: fromPublished };
  }
  const state = toCuratorState(seed, changes);
  const lines = summariseStates(repoState, state);
  return { ok: true, state, text: JSON.stringify(state, null, 1) + '\n', subject: commitSubject(lines) };
}
```

Note `publishedOnly` and `countPublished` are defined later in the file; function declarations hoist, so this is fine — but `records`, `stable` are `const`s: `preparePublish` only calls functions, so it is safe as long as it runs after module evaluation (it does).

- [ ] **Step 5: Point `lib/git-publish.js` at the core.** Replace its `summarise` (lines 42-113) and `commitMessage` (118-123) with:

```js
import { summariseStates, commitSubject } from '../desk/desk-core.mjs';
export const summarise = summariseStates;
const commitMessage = lines => commitSubject(lines);
```

Keep the explanatory comments above the old `summarise` by moving them to desk-core with the body. Check the rest of `git-publish.js` for a call that passed `lines` already-empty expecting `'curate: review session'` from elsewhere (grep `review session`) and keep behaviour identical.

- [ ] **Step 6: Point `scripts/desk-pull.mjs` at the core.** Delete its `STATE_KEYS`, `setwise`, `diffKeys`; import `stateDiffKeys, preparePublish` from `../desk/desk-core.mjs`; rewrite `pull`:

```js
export function pull({ seed, changes, repoState }) {
  const prep = preparePublish(seed, changes, repoState);
  if (!prep.ok) return prep;
  const state = canonicalise(prep.state);
  return { ok: true, state, summary: summaryOf(repoState, state, changes) };
}
```

Keep `canonicalise` (the DB round trip is still the Node route's guarantee) and everything else in the file.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all pass, including `test/git-publish.test.js` and `test/desk-pull.test.js`; count ≥ 248.

- [ ] **Step 8: Commit**

```bash
git checkout -b desk-publish-button
git add desk/desk-core.mjs lib/git-publish.js scripts/desk-pull.mjs test/desk-core.test.js test/desk-pull.test.js docs/superpowers/specs/2026-09-26-desk-publish-button-design.md docs/superpowers/plans/2026-09-26-desk-publish-button.md docs/superpowers/plans/2026-09-26-desk-publish-button.md.tasks.json
git commit -F - <<'EOF'
feat(desk-core): preparePublish, commit words and pristine-ordered converter output

toCuratorState orders its maps the way exportState does, so the file the page writes is
byte-identical to desk:pull's. preparePublish is desk:pull's stale check plus the file text
and the commit subject, for a publish made from the page. summarise(before, after) and the
subject rule move from lib/git-publish.js into desk-core (git-publish re-exports them).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

---

### Task 2: Core — document shape check and re-key rules move into desk-core

**Goal:** `changeShapeError`, `publishedShas`, `unpublishedReverts`, `rekeyAll` are exported from `desk/desk-core.mjs` (so the page can inline them); `scripts/desk-pull.mjs` and `scripts/desk-rekey.mjs` keep their exports by re-exporting.

**Files:**
- Modify: `desk/desk-core.mjs` (after `rekey`, end of file)
- Modify: `scripts/desk-rekey.mjs:16-50` (delete the three functions; `export { publishedShas, unpublishedReverts, rekeyAll } from '../desk/desk-core.mjs';` and import `rekeyAll` for the CLI)
- Modify: `scripts/desk-pull.mjs` (`shapeError` → `import { changeShapeError }`; `loadChanges` uses it)
- Test: `test/desk-core.test.js`

**Acceptance Criteria:**
- [ ] `core.changeShapeError(x)` returns the same strings `scripts/desk-pull.mjs`'s `shapeError` returned: `'is not a change document (an object)'`, `'has no receptorId'`, `'has no fields object'`, `'has no sources { add: [], set: {} }'`, else `null`.
- [ ] `core.rekeyAll`, `core.publishedShas`, `core.unpublishedReverts` behave exactly as `test/desk-rekey.test.js` already asserts (that file keeps importing from `scripts/desk-rekey.mjs` and passes unchanged).
- [ ] `node scripts/desk-rekey.mjs` CLI still works (`npm run -s desk:rekey -- <file>` on a small fixture prints a JSON array).

**Verify:** `npm test` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test** (append to `test/desk-core.test.js`)

```js
test('changeShapeError names what is wrong with a document, null when it is one', () => {
  assert.equal(core.changeShapeError(null), 'is not a change document (an object)');
  assert.equal(core.changeShapeError([]), 'is not a change document (an object)');
  assert.equal(core.changeShapeError({}), 'has no receptorId');
  assert.equal(core.changeShapeError({ receptorId: 'd2' }), 'has no fields object');
  assert.equal(core.changeShapeError({ receptorId: 'd2', fields: {} }), 'has no sources { add: [], set: {} }');
  assert.equal(core.changeShapeError(core.emptyChanges('d2', 'x')), null);
});

test('rekeyAll is exported from desk-core (the page inlines it)', () => {
  const seed = { commit: 'new1', receptors: [{ id: 'd2', sources: [] }], sources: {} };
  let a = core.setField(core.emptyChanges('d2', 'old'), 'claim', 'p', AT);
  a = core.markPublished(a, 'sha1');
  a = core.setField(a, 'archive.abstract', 'u', AT);
  assert.deepEqual(core.publishedShas([a]), ['sha1']);
  assert.deepEqual(core.unpublishedReverts([a]), []);
  const ok = core.rekeyAll(seed, [a], sha => sha === 'sha1');
  assert.equal(ok.ok, true); assert.equal(ok.docs[0].seedCommit, 'new1'); assert.deepEqual(Object.keys(ok.docs[0].fields), ['archive.abstract']);
  const no = core.rekeyAll(seed, [a], () => false);
  assert.equal(no.ok, false); assert.equal(no.reason, 'not in history'); assert.deepEqual(no.missing, ['sha1']);
});
```

(`AT` is already defined at the top of `test/desk-core.test.js`; check, and add `const AT = '2026-09-26T13:00:00.000Z';` if not.)

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/desk-core.test.js`
Expected: FAIL — `core.changeShapeError is not a function`, `core.rekeyAll is not a function`.

- [ ] **Step 3: Move the functions.** Append to `desk/desk-core.mjs`, verbatim from `scripts/desk-rekey.mjs` lines 16-50 (`publishedShas`, `unpublishedReverts`, `rekeyAll`, with their doc comments) and from `scripts/desk-pull.mjs` `shapeError` renamed:

```js
/** What is wrong with one change document (as a store or a file holds it), or null. */
export function changeShapeError(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'is not a change document (an object)';
  if (typeof d.receptorId !== 'string') return 'has no receptorId';
  if (!d.fields || typeof d.fields !== 'object') return 'has no fields object';
  if (!d.sources || typeof d.sources !== 'object' || !Array.isArray(d.sources.add) || !d.sources.set || typeof d.sources.set !== 'object') return 'has no sources { add: [], set: {} }';
  return null;
}
```

In `scripts/desk-rekey.mjs`: delete the three function bodies; add `import { rekeyAll } from '../desk/desk-core.mjs'; export { publishedShas, unpublishedReverts, rekeyAll } from '../desk/desk-core.mjs';` (the existing `import { rekey }` line goes if `rekey` is no longer used there). In `scripts/desk-pull.mjs`: delete `shapeError`, add `changeShapeError` to the desk-core import, and use it in `loadChanges` (both call sites).

- [ ] **Step 4: Run the suite and the CLI**

Run: `npm test && printf '[]' > /tmp/empty.json && npm run -s desk:rekey -- /tmp/empty.json`
Expected: tests pass; the CLI prints `[]`.

- [ ] **Step 5: Commit**

```bash
git add desk/desk-core.mjs scripts/desk-rekey.mjs scripts/desk-pull.mjs test/desk-core.test.js
git commit -F - <<'EOF'
refactor(desk-core): document shape check and re-key rules live in the core

changeShapeError, publishedShas, unpublishedReverts and rekeyAll move into desk-core.mjs so
the page can inline them; desk-pull and desk-rekey re-export. No behaviour change.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

---

### Task 3: Page — token dialog, Publish button, confirm, refusal, receipt

**Goal:** In browser mode the Desk has a Publish button that runs the spec's steps 1-6 against GitHub's REST API; the walkthrough drives it against a faked GitHub.

**Files:**
- Modify: `desk/desk.template.html` (header markup ~line 218-225; styles ~line 212; script: new section before `// ---------- boot ----------`, boot line, `renderBanner`)
- Modify: `scripts/desk-walkthrough.mjs` (self-contained check ~line 30-34; new checks before the fake-frame section ~line 241; one check inside the fake-frame pass)
- Test: the walkthrough (Playwright); `npm test` must stay green (`desk-build.test.js` reads the template)

**Acceptance Criteria:**
- [ ] Header shows `Publish` (id `pub`, class `btn sm primary`) and `GitHub…` (id `ghset`, class `btn sm`) in browser mode; both carry `hidden` in the fake claude.ai frame.
- [ ] With no token: clicking Publish opens the token dialog (`#modalBg` with `#gh-h` "GitHub token"), which has a password input `[name=token]`, a checked checkbox `[name=remember]`, Save, Forget (only when a token is stored) and Cancel; Save stores under `atlas-desk-github-token` when remember is on and continues the publish.
- [ ] With a token and one unpublished edit, Publish: GETs `https://api.github.com/repos/Fresco-Esio/receptor-atlas/contents/db/curator-state.json?ref=main` with `Authorization: Bearer <token>`; shows a confirm dialog (`#pc-h` "Publish to GitHub") whose text contains the subject `curate: 1 narrative edit`; on Publish, PUTs to `…/contents/db/curator-state.json` with `{ message: subject, content, sha: <the GET's sha>, branch: 'main' }` and `content` base64-decodes to `toCuratorState(SEED, changes)` text byte-for-byte (`JSON.stringify(state, null, 1) + '\n'`).
- [ ] After the PUT answers `{ commit: { sha, html_url } }`: every record of the published documents carries `publishedAs === sha`; `localStorage['atlas-desk-last-publish']` holds `{ sha, at, url }`; the banner ends with `· last published <7 chars> · <date>`; the button reads `Publish` again and is enabled.
- [ ] When the GET's file differs from both the snapshot and the page's published state, a refusal dialog (`#pr-h` "The repo has moved") names the differing keys and no PUT is sent.
- [ ] Cancel in the confirm dialog sends no PUT and marks nothing.
- [ ] A GET answering 401 shows a toast containing `rejected the token` and opens the token dialog; nothing is marked.
- [ ] Nothing unpublished → toast `Nothing to publish.`, no request.
- [ ] Self-contained check: the built page has no `<script src>`, exactly one `fetch(`, and `GH_API = 'https://api.github.com'`.

**Verify:** `npm run desk:build && NODE_PATH=$(npm root -g) node scripts/desk-walkthrough.mjs --mode local` → every line `PASS`, exit code 0; `npm test` → all pass.

**Steps:**

- [ ] **Step 1: Add the failing walkthrough checks.** In `scripts/desk-walkthrough.mjs`, replace the self-contained check with:

```js
const html = readFileSync(FILE, 'utf8');
const external = [...html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/gi)].map(m => m[0]);
const fetches = (html.match(/\bfetch\s*\(/g) || []).length;
ok('build is self-contained (no <script src>, one fetch() to api.github.com, only Google Fonts loaded)',
  !/<script[^>]*\bsrc=/i.test(html) && fetches === 1 && html.includes("GH_API = 'https://api.github.com'") && external.every(u => /fonts\.(googleapis|gstatic)\.com/.test(u)),
  `fetch() × ${fetches}; ` + external.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)).join(', '));
```

Then, just before the `// --- simulated claude.ai frame` section, add a browser-mode Publish pass. It needs a fresh context (so earlier edits do not interfere) and a fake GitHub:

```js
// --- Publish button (browser mode) against a faked GitHub ---
const utf8b64 = t => Buffer.from(t, 'utf8').toString('base64');
async function fakeGitHub(context, cfg) {
  const log = { gets: 0, puts: [], compares: [], auth: [] };
  await context.route('https://api.github.com/**', async route => {
    const req = route.request(); const url = new URL(req.url()); log.auth.push(req.headers()['authorization'] || '');
    const contents = url.pathname === '/repos/Fresco-Esio/receptor-atlas/contents/db/curator-state.json';
    if (contents && req.method() === 'GET') {
      log.gets++;
      if (cfg.status) return route.fulfill({ status: cfg.status, contentType: 'application/json', body: JSON.stringify({ message: 'Bad credentials' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'blob111', encoding: 'base64', content: utf8b64(JSON.stringify(cfg.repoState, null, 1) + '\n').replace(/(.{60})/g, '$1\n') }) });
    }
    if (contents && req.method() === 'PUT') { log.puts.push(JSON.parse(req.postData())); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: 'blob222' }, commit: { sha: 'c0ffee1234567890c0ffee1234567890c0ffee12', html_url: 'https://github.com/Fresco-Esio/receptor-atlas/commit/c0ffee1' } }) }); }
    const m = url.pathname.match(/\/compare\/([^.]+)\.\.\.(.+)$/);
    if (m) { log.compares.push(m[1]); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: (cfg.ancestors || []).includes(m[1]) ? 'ahead' : 'diverged' }) }); }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
  });
  return log;
}
{
  const pctx = await browser.newContext(); const p = await pctx.newPage();
  const perrs = []; p.on('pageerror', e => perrs.push(e.message));
  const gh = await fakeGitHub(pctx, { repoState: SEED.baseState });
  await p.goto(PAGE); await p.waitForFunction(() => window.__desk); await p.selectOption('#rx', 'd2');
  ok('browser mode shows Publish and GitHub…', await p.locator('#pub:not(.hidden)').count() === 1 && await p.locator('#ghset:not(.hidden)').count() === 1);
  await p.locator('#pub').click(); await p.waitForTimeout(200);
  ok('nothing to publish: toast, no request', (await p.locator('.toast').innerText()).includes('Nothing to publish') && gh.gets === 0);
  await p.locator('[data-path="archive.abstract"]').fill('Published from the button.'); await p.waitForTimeout(500);
  await p.locator('#pub').click(); await p.waitForTimeout(200);
  ok('no token: the token dialog opens first', await p.locator('#modalBg #gh-h').count() === 1 && await p.locator('#modalBg [name=token]').getAttribute('type') === 'password' && await p.locator('#modalBg [name=remember]').isChecked());
  await p.locator('#modalBg [name=token]').fill('github_pat_TEST'); await p.locator('#modalBg [data-save]').click(); await p.waitForFunction(() => document.querySelector('#modalBg #pc-h'));
  ok('token remembered in this browser', await p.evaluate(() => localStorage.getItem('atlas-desk-github-token')) === 'github_pat_TEST');
  ok('after Save the publish continues: the repo file was read with the token, confirm shows the subject', gh.gets === 1 && gh.auth[0] === 'Bearer github_pat_TEST' && await p.locator('#modalBg #pc-h').count() === 1 && (await p.locator('#modalBg').innerText()).includes('curate: 1 narrative edit'));
  await p.locator('#modalBg [data-cancel]').click(); await p.waitForTimeout(100);
  ok('cancel sends no PUT and marks nothing', gh.puts.length === 0 && await p.evaluate(() => !window.__desk.store.get('d2').fields['archive.abstract'].publishedAs));
  await p.locator('#pub').click(); await p.waitForFunction(() => document.querySelector('#modalBg #pc-h')); await p.locator('#modalBg [data-go]').click();
  await p.waitForFunction(() => document.querySelector('#pub').textContent === 'Publish' && !document.querySelector('#pub').disabled);
  // marking changes publishedAs only; the converter reads values, so the store still converts to the committed bytes
  const expectedText = await p.evaluate(() => JSON.stringify(window.__desk.toCuratorState(window.__desk.SEED, window.__desk.store.list()), null, 1) + '\n');
  const put = gh.puts[0] || {};
  ok('PUT carries the subject, the blob sha, the branch, and the converter\'s bytes', gh.puts.length === 1 && put.message === 'curate: 1 narrative edit' && put.sha === 'blob111' && put.branch === 'main' && Buffer.from(put.content, 'base64').toString('utf8') === expectedText);
  ok('records marked published with the commit sha; receipt stored; banner shows it', await p.evaluate(() => window.__desk.store.get('d2').fields['archive.abstract'].publishedAs === 'c0ffee1234567890c0ffee1234567890c0ffee12' && JSON.parse(localStorage.getItem('atlas-desk-last-publish')).sha.startsWith('c0ffee1')) && /· last published c0ffee1 · \d{4}-\d{2}-\d{2}$/.test(await p.locator('#banner').innerText()));
  ok('publish pass: no page errors', perrs.length === 0, perrs.join(' | '));
  await pctx.close();
}
{ // the repo moved: refusal, no PUT
  const pctx = await browser.newContext(); const p = await pctx.newPage();
  const moved = JSON.parse(JSON.stringify(SEED.baseState)); moved.review.d1 = { mechanism: 1, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: 'moved elsewhere' };
  const gh = await fakeGitHub(pctx, { repoState: moved });
  await p.goto(PAGE); await p.waitForFunction(() => window.__desk); await p.evaluate(() => localStorage.setItem('atlas-desk-github-token', 't'));
  await p.selectOption('#rx', 'd2'); await p.locator('[data-path="archive.abstract"]').fill('Blocked.'); await p.waitForTimeout(500);
  await p.locator('#pub').click(); await p.waitForFunction(() => document.querySelector('#modalBg #pr-h'));
  ok('a moved repo file is refused, naming the keys, with no PUT', (await p.locator('#modalBg').innerText()).includes('review') && gh.puts.length === 0 && await p.evaluate(() => !window.__desk.store.get('d2').fields['archive.abstract'].publishedAs));
  await pctx.close();
}
{ // a rejected token
  const pctx = await browser.newContext(); const p = await pctx.newPage();
  const gh = await fakeGitHub(pctx, { repoState: SEED.baseState, status: 401 });
  await p.goto(PAGE); await p.waitForFunction(() => window.__desk); await p.evaluate(() => localStorage.setItem('atlas-desk-github-token', 'bad'));
  await p.selectOption('#rx', 'd2'); await p.locator('[data-path="archive.abstract"]').fill('Unauthorised.'); await p.waitForTimeout(500);
  await p.locator('#pub').click(); await p.waitForFunction(() => document.querySelector('#modalBg #gh-h'));
  ok('401 → toast "rejected the token", token dialog, nothing marked, no PUT', (await p.locator('.toast').innerText()).includes('rejected the token') && gh.puts.length === 0 && await p.locator('#modalBg [data-forget]').count() === 1);
  await p.locator('#modalBg [data-forget]').click(); await p.waitForTimeout(100);
  ok('Forget clears the stored token', await p.evaluate(() => localStorage.getItem('atlas-desk-github-token')) === null);
  await pctx.close();
}
```

And inside the existing fake-frame pass (after its first `ready`/load check), add:

```js
ok('frame: Publish, GitHub… and Import are hidden', await f.p.locator('#pub.hidden').count() === 1 && await f.p.locator('#ghset.hidden').count() === 1 && await f.p.locator('#imp.hidden').count() === 1);
```

(`#imp` arrives in Task 4; until then, write the check without the `#imp` clause and extend it in Task 4.)

- [ ] **Step 2: Run the walkthrough to see the new checks fail**

Run: `npm run desk:build && NODE_PATH=$(npm root -g) node scripts/desk-walkthrough.mjs --mode local | grep -c FAIL`
Expected: a non-zero FAIL count (the new checks), the old 83 still PASS.

- [ ] **Step 3: Markup and styles.** In the header (`.top`), after `#dl`:

```html
  <button class="btn sm" id="ghset" type="button" title="GitHub token for the Publish button">GitHub…</button>
  <button class="btn sm primary" id="pub" type="button">Publish</button>
```

Add styles next to `.lsmerge`:

```css
.notice{ flex-basis:100%; color:var(--warn) } .notice .btn{ margin-left:6px }
.modal .tiny.warn{ color:var(--warn) } .modal .check{ display:flex; gap:6px; align-items:center; font-size:.85rem; margin:8px 0 }
```

and a `<div class="banner notice hidden" id="notice"></div>` after `#lsmerge` (Task 4 uses it).

- [ ] **Step 4: The script.** Insert before `// ---------- boot ----------`:

```js
// ---------- Publish (browser mode only: the claude.ai frame cannot reach GitHub) ----------
const GH = { owner: 'Fresco-Esio', repo: 'receptor-atlas', branch: 'main', file: 'db/curator-state.json' };
const GH_API = 'https://api.github.com';
const TOKEN_KEY = 'atlas-desk-github-token', RECEIPT_KEY = 'atlas-desk-last-publish';
let sessionToken = '';   // a token the owner chose not to remember
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
const token = () => sessionToken || readToken();
const readReceipt = () => { try { const r = JSON.parse(localStorage.getItem(RECEIPT_KEY) || 'null'); return r && r.sha ? r : null; } catch (e) { return null; } };
const utf8ToB64 = text => { const b = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToUtf8 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
/** The one call to GitHub. The token goes in the Authorization header and nowhere else; without a token the
 *  call is anonymous (enough for compare on a public repo). Errors carry a code the callers act on. */
async function gh(method, path, body) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token()) headers.Authorization = 'Bearer ' + token();
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(GH_API + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { throw { code: 'network', message: 'GitHub could not be reached (offline?)' }; }
  if (res.ok) return res.json();
  const msg = await res.json().then(j => (j && j.message) || '').catch(() => '');
  if (res.status === 401) throw { code: 'auth', message: 'GitHub rejected the token' };
  if (res.status === 403) throw { code: 'forbidden', message: 'GitHub refused (rate limit, or the token lacks Contents: Read and write)' };
  if (res.status === 404) throw { code: 'access', message: `the token cannot see ${GH.owner}/${GH.repo} (Repository access, and Contents: Read and write)` };
  if (res.status === 409 || res.status === 422) throw { code: 'moved', message: 'the file moved while publishing; try again' };
  throw { code: 'http', message: 'GitHub answered ' + res.status + (msg ? ': ' + msg : '') };
}
const CONTENTS = `/repos/${GH.owner}/${GH.repo}/contents/${GH.file}`;
/** A small dialog; returns what the button clicked resolves to. `buttons`: [{ label, data, primary, value }]. */
function dialog(id, title, bodyHtml, buttons) {
  closeModal();
  return new Promise(resolve => {
    const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modalBg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${id}"><h2 id="${id}">${esc(title)}</h2>${bodyHtml}<div class="actions">${buttons.map(b => `<button type="button" class="btn${b.primary ? ' primary' : ''}" data-${b.data}>${esc(b.label)}</button>`).join('')}</div></div>`;
    const onKey = e => { if (e.key === 'Escape') done(null); };
    const done = v => { document.removeEventListener('keydown', onKey); closeModal(); resolve(v); };
    document.addEventListener('keydown', onKey);   // the global Escape handler removes the element; this settles the promise
    bg.addEventListener('mousedown', e => { if (e.target === bg) done(null); });
    for (const b of buttons) bg.querySelector(`[data-${b.data}]`).addEventListener('click', () => done(typeof b.value === 'function' ? b.value(bg) : b.value));
    document.body.appendChild(bg);
    const first = bg.querySelector('input'); if (first) first.focus();
  });
}
async function openTokenDialog() {
  const stored = !!readToken();
  const body = `<p class="tiny">A fine-grained personal access token (github.com → Settings → Developer settings → Personal access tokens → Fine-grained): Repository access → only <b>${esc(GH.repo)}</b>; Permissions → Contents: <b>Read and write</b>. It is sent only to api.github.com.</p>`
    + `<div class="field"><label for="gh-token">Token</label><input id="gh-token" name="token" type="password" autocomplete="off" placeholder="github_pat_…"></div>`
    + `<label class="check"><input type="checkbox" name="remember" checked> remember in this browser</label>`
    + (stored ? `<p class="tiny">A token is stored in this browser now; Save replaces it.</p>` : '');
  const buttons = [{ label: 'Cancel', data: 'cancel', value: null }];
  if (stored) buttons.push({ label: 'Forget', data: 'forget', value: 'forget' });
  buttons.push({ label: 'Save', data: 'save', primary: true, value: bg => ({ token: bg.querySelector('[name=token]').value.trim(), remember: bg.querySelector('[name=remember]').checked }) });
  const r = await dialog('gh-h', 'GitHub token', body, buttons);
  if (r === 'forget') { sessionToken = ''; try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* nothing stored */ } toast('Token forgotten.'); return false; }
  if (!r || !r.token) return false;
  if (r.remember) { sessionToken = ''; try { localStorage.setItem(TOKEN_KEY, r.token); } catch (e) { sessionToken = r.token; toast('This browser refused to store the token; it is kept for this session only.', 5000); } }
  else { sessionToken = r.token; try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* nothing stored */ } }
  return true;
}
let publishing = false;
async function publish() {
  if (publishing) return;
  flush();
  const changes = store.list();
  if (!countUnpublished(changes)) { toast('Nothing to publish.'); return; }
  if (!token()) { if (!(await openTokenDialog())) return; }
  const btn = $('#pub'); publishing = true; btn.disabled = true; btn.textContent = 'Reading…';
  try {
    const file = await gh('GET', CONTENTS + '?ref=' + GH.branch);
    const repoState = JSON.parse(b64ToUtf8(file.content));
    const prep = preparePublish(SEED, changes, repoState);
    if (!prep.ok) {
      await dialog('pr-h', 'The repo has moved', `<p>The repo's edits file is neither this snapshot's nor what this page already published; it differs in: <b>${esc(prep.diff.join(', '))}</b>. Publishing now would overwrite a change made another way.</p><p class="tiny">Wait for the site to finish rebuilding and reload this page, or (from disk) pull, then run desk:seed and desk:build. Your changes are kept.</p>`, [{ label: 'Close', data: 'cancel', primary: true, value: null }]);
      return;
    }
    btn.textContent = 'Publish';
    const go = await dialog('pc-h', 'Publish to GitHub', `<p>One commit to <b>${esc(GH.owner)}/${esc(GH.repo)}</b> on <b>${esc(GH.branch)}</b>:</p><p class="mono">${esc(prep.subject)}</p><p class="tiny">The site rebuilds by itself afterwards, in a minute or two.</p>`, [{ label: 'Cancel', data: 'cancel', value: false }, { label: 'Publish', data: 'go', primary: true, value: true }]);
    if (!go) return;
    btn.textContent = 'Committing…';
    const res = await gh('PUT', CONTENTS, { message: prep.subject, content: utf8ToB64(prep.text), sha: file.sha, branch: GH.branch });
    const sha = res.commit.sha, at = now();
    for (const pulled of changes) store.put(markPublishedFrom(store.get(pulled.receptorId), pulled, sha, at));
    try { localStorage.setItem(RECEIPT_KEY, JSON.stringify({ sha, at, url: res.commit.html_url || '' })); } catch (e) { /* the banner still shows it this session */ }
    lastReceipt = { sha, at, url: res.commit.html_url || '' };
    renderBanner(); render();
    toast('Published as ' + sha.slice(0, 7) + ' · the site rebuilds in a minute or two.', 6000);
  } catch (e) {
    toast('Publish failed: ' + ((e && e.message) || e), 7000);
    if (e && (e.code === 'auth' || e.code === 'access')) await openTokenDialog();
  } finally { publishing = false; btn.disabled = false; btn.textContent = 'Publish'; }
}
let lastReceipt = readReceipt();
function arrangePublish() {
  const on = !IN_FRAME;
  for (const id of ['#pub', '#ghset']) $(id).classList.toggle('hidden', !on);
  if (!on) return;
  $('#pub').addEventListener('click', publish);
  $('#ghset').addEventListener('click', openTokenDialog);
}
```

And in `renderBanner`, append the receipt to the banner line (browser mode only):

```js
  const receipt = !IN_FRAME && lastReceipt ? ` · last published <b>${esc(lastReceipt.sha.slice(0, 7))}</b> · ${esc(lastReceipt.at.slice(0, 10))}` : '';
  $('#banner').innerHTML = `seed <b>…</b> … store: ${esc(STORE_LABEL[store.mode])}</span>${receipt}`;
```

`IN_FRAME` and `lastReceipt` must be defined before `renderBanner` first runs: move `const IN_FRAME = !!window.claude;` up to the storage section (it is currently defined in the download section, after `renderBanner` is declared but before boot runs — `const` in module scope is fine as long as boot calls come after both declarations; keep the order: all declarations, then the boot line). Boot becomes:

```js
await store.init(); arrangeDownloads(); arrangePublish(); renderPicker(); render(); renderMergeLine();
```

Also expose for the walkthrough: add `preparePublish` and `publish` to `window.__desk`.

- [ ] **Step 5: Build and run the walkthrough**

Run: `npm run desk:build && NODE_PATH=$(npm root -g) node scripts/desk-walkthrough.mjs --mode local`
Expected: every line `PASS`; exit 0. Fix until green. Then `npm test` → all pass (`desk-build.test.js` parses the template).

- [ ] **Step 6: Commit**

```bash
git add desk/desk.template.html desk/desk.html desk/desk.artifact.html scripts/desk-walkthrough.mjs
git commit -F - <<'EOF'
feat(desk): Publish button in browser mode, committing the edits file through GitHub's API

Outside the claude.ai frame the Desk can publish by itself: read the repo's edits file,
run the stale-seed check in the page, confirm the commit subject, PUT the converter's bytes
as one commit on main with the owner's fine-grained token, then mark the changes published
and keep a receipt. The token is kept in this browser (or the session), sent only to
api.github.com. The walkthrough drives it against a faked GitHub.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

(If `desk/desk.html` / `desk.artifact.html` are gitignored or build outputs not tracked, omit them — check `git ls-files desk`.)

---

### Task 4: Page — re-key on load in browser mode, and Import changes

**Goal:** After the site rebuilds, `/desk/` folds published changes into the new snapshot by itself; a changes.json from another copy can be imported.

**Files:**
- Modify: `desk/desk.template.html` (header: Import button + hidden file input; script: `rekeyStale()`, `importChanges()`, `renderNotice()`; boot)
- Modify: `scripts/desk-walkthrough.mjs` (new checks after the Publish pass; extend the frame check with `#imp`)

**Acceptance Criteria:**
- [ ] Browser mode, a stored document with `seedCommit !== SEED.commit`, `publishedAs 'sha1'` on one field and an unpublished second field, and compare answering `ahead` for `sha1`: after load the document has `seedCommit === SEED.commit`, the published field is gone, the unpublished one stays; `#notice` reads `re-keyed 1 document onto seed <SEED.commit>`; a compare request was made for `sha1` only.
- [ ] Same, compare answering `diverged`: the document is unchanged; `#notice` contains `not in the history`.
- [ ] Same with the store holding an unpublished revert (a tombstone with no `publishedAs`): unchanged; `#notice` contains `unpublished revert`.
- [ ] No GitHub reachable (route aborts): unchanged; `#notice` contains `could not be reached`.
- [ ] Documents whose `seedCommit` already equals `SEED.commit` trigger no compare request.
- [ ] `SEED.commit === 'uncommitted'` → nothing happens (assert by evaluating `window.__desk.rekeyStale` after overriding `SEED.commit` is not possible since SEED is a const; instead the walkthrough checks `store.list()` untouched when it seeds a document with `seedCommit: 'uncommitted'` and the page's `SEED.commit` differs — skip this criterion if `SEED.commit` in the built file is a real sha; note it in the report).
- [ ] Import: choosing a file holding `[docA (d2), docB (unknown receptor), 7]`: docA is merged into the store (`mergeChanges(existing, imported)`), docB and `7` are skipped, toast reads `Imported 1 document (2 skipped)`, then `rekeyStale()` runs.
- [ ] `#imp` is hidden in the frame.

**Verify:** `npm run desk:build && NODE_PATH=$(npm root -g) node scripts/desk-walkthrough.mjs --mode local` → all `PASS`; `npm test` → all pass.

**Steps:**

- [ ] **Step 1: Failing walkthrough checks** — after the Publish blocks from Task 3:

```js
// --- re-key on load (browser mode) ---
const staleDoc = (rev) => { let d = core.setField(core.emptyChanges('d2', 'oldseed'), 'claim', 'was published', '2026-09-20T10:00:00.000Z'); d = core.markPublished(d, 'sha1'); d = core.setField(d, 'archive.abstract', 'still unpublished', '2026-09-21T10:00:00.000Z'); if (rev) d = core.clearField(core.markPublished(core.setField(d, 'archive.effect', 'x', '2026-09-20T10:00:00.000Z'), 'sha1'), 'archive.effect', '2026-09-22T10:00:00.000Z'); return d; };
async function loadWith(cfg, doc) {
  const c = await browser.newContext(); const p = await c.newPage();
  const gh = cfg.abort ? null : await fakeGitHub(c, cfg);
  if (cfg.abort) await c.route('https://api.github.com/**', r => r.abort());
  await p.addInitScript(d => { if (!localStorage.getItem('atlas-desk-changes-v1')) localStorage.setItem('atlas-desk-changes-v1', JSON.stringify({ d2: d })); }, doc);
  await p.goto(PAGE); await p.waitForFunction(() => window.__desk && window.__desk.rekeyDone);
  return { c, p, gh, doc: () => p.evaluate(() => window.__desk.store.get('d2')), notice: () => p.locator('#notice').innerText() };
}
{
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'] }, staleDoc(false));
  const d = await t.doc();
  ok('re-key on load: published field dropped, unpublished kept, seedCommit updated, one compare for sha1', d.seedCommit === SEED.commit && !d.fields.claim && d.fields['archive.abstract'] && !d.fields['archive.abstract'].publishedAs && t.gh.compares.length === 1 && t.gh.compares[0] === 'sha1');
  ok('re-key notice', (await t.notice()).includes('re-keyed 1 document'), await t.notice());
  await t.c.close();
}
{
  const t = await loadWith({ repoState: SEED.baseState, ancestors: [] }, staleDoc(false));
  const d = await t.doc();
  ok('a publish not in history: left alone, notice says so', d.seedCommit === 'oldseed' && d.fields.claim && (await t.notice()).includes('not in the history'));
  await t.c.close();
}
{
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'] }, staleDoc(true));
  const d = await t.doc();
  ok('an unpublished revert blocks re-key, notice says so', d.seedCommit === 'oldseed' && (await t.notice()).includes('unpublished revert'));
  await t.c.close();
}
{
  const t = await loadWith({ abort: true }, staleDoc(false));
  const d = await t.doc();
  ok('GitHub unreachable: left alone, notice says so', d.seedCommit === 'oldseed' && (await t.notice()).includes('could not be reached'));
  await t.c.close();
}
{
  const fresh = core.setField(core.emptyChanges('d2', SEED.commit), 'claim', 'current', '2026-09-25T10:00:00.000Z');
  const t = await loadWith({ repoState: SEED.baseState, ancestors: [] }, fresh);
  ok('a document on the current seed makes no compare request and no notice', t.gh.compares.length === 0 && await t.p.locator('#notice.hidden').count() === 1);
  // --- Import changes ---
  ok('browser mode shows Import changes', await t.p.locator('#imp:not(.hidden)').count() === 1);
  const docA = core.setField(core.emptyChanges('d2', SEED.commit), 'archive.abstract', 'imported abstract', '2026-09-25T11:00:00.000Z');
  const docB = core.setField(core.emptyChanges('nope', SEED.commit), 'claim', 'x', '2026-09-25T11:00:00.000Z');
  await t.p.locator('#impfile').setInputFiles({ name: 'changes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([docA, docB, 7])) });
  await t.p.waitForTimeout(400);
  const after = await t.doc();
  ok('import merges the known document, skips the rest, keeps the existing claim', after.fields.claim && after.fields.claim.value === 'current' && after.fields['archive.abstract'] && after.fields['archive.abstract'].value === 'imported abstract' && (await t.p.locator('.toast').innerText()).includes('Imported 1 document (2 skipped)'));
  await t.c.close();
}
```

Extend the frame check from Task 3 to include `await f.p.locator('#imp.hidden').count() === 1`.

- [ ] **Step 2: Run to see them fail**

Run: `npm run desk:build && NODE_PATH=$(npm root -g) node scripts/desk-walkthrough.mjs --mode local | grep FAIL`
Expected: the new checks FAIL (`window.__desk.rekeyDone` never set → the `waitForFunction` will time out; to keep the run useful, set the Playwright default timeout with `p.setDefaultTimeout(8000)` in `loadWith`).

- [ ] **Step 3: Markup.** After `#dl` in the header (before `#ghset`):

```html
  <button class="btn sm" id="imp" type="button" title="Merge a changes.json from another copy of the Desk">Import changes</button>
  <input type="file" id="impfile" accept="application/json,.json" class="hidden">
```

- [ ] **Step 4: Script.** After `arrangePublish` (still before boot):

```js
// ---------- re-keying stored documents onto a newer snapshot (browser mode) ----------
// /desk/ is rebuilt on every push, so after a publish the stored documents are keyed to the older snapshot.
// The same rule as desk:rekey: every publish they record must be in the seed's history (GitHub's compare
// answers that, anonymously on a public repo); then published records drop out and the rest carry over.
function renderNotice(text) { const el = $('#notice'); if (!text) { el.classList.add('hidden'); el.textContent = ''; return; } el.textContent = text; el.classList.remove('hidden'); }
async function rekeyStale() {
  if (IN_FRAME || store.mode !== 'browser' || SEED.commit === 'uncommitted') return;
  const stale = store.list().filter(c => c.seedCommit !== SEED.commit);
  if (!stale.length) { renderNotice(''); return; }
  const shas = publishedShas(stale); const anc = new Set();
  try {
    for (const sha of shas) { const r = await gh('GET', `/repos/${GH.owner}/${GH.repo}/compare/${encodeURIComponent(sha)}...${encodeURIComponent(SEED.commit)}`); if (r.status === 'ahead' || r.status === 'identical') anc.add(sha); }
  } catch (e) { renderNotice(`${stale.length} document${stale.length === 1 ? ' is' : 's are'} keyed to an older snapshot and could not be re-keyed: GitHub could not be reached. Editing continues on them.`); return; }
  const r = rekeyAll(SEED, stale, sha => anc.has(sha));
  if (!r.ok) { renderNotice(`${stale.length} document${stale.length === 1 ? ' is' : 's are'} keyed to an older snapshot and not re-keyed: ${r.message}`); return; }
  for (const d of r.docs) store.put(d);
  renderNotice(`re-keyed ${r.docs.length} document${r.docs.length === 1 ? '' : 's'} onto seed ${SEED.commit}`);
  renderBanner(); render();
}
// ---------- Import changes (browser mode): a changes.json from the claude.ai copy or another browser ----------
function arrangeImport() {
  $('#imp').classList.toggle('hidden', IN_FRAME);
  if (IN_FRAME) return;
  $('#imp').addEventListener('click', () => $('#impfile').click());
  $('#impfile').addEventListener('change', async () => {
    const file = $('#impfile').files[0]; $('#impfile').value = ''; if (!file) return;
    let docs;
    try { docs = JSON.parse(await file.text()); } catch (e) { toast('That file is not JSON.'); return; }
    if (!Array.isArray(docs)) { toast('Expected an array of change documents, as Download changes saves it.'); return; }
    flush();
    let n = 0, skipped = 0;
    for (const d of docs) {
      if (changeShapeError(d) || !KNOWN.has(d.receptorId)) { skipped++; continue; }
      store.put(mergeChanges(store.all[d.receptorId] || null, d)); n++;
    }
    renderBanner(); render();
    toast(`Imported ${n} document${n === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped)` : ''}.`, 5000);
    await rekeyStale();
  });
}
```

Boot line and exposure:

```js
await store.init(); arrangeDownloads(); arrangePublish(); arrangeImport(); renderPicker(); render(); renderMergeLine();
store.subscribe(onRemoteChange);
try { if (window.claude?.use) mcp = await window.claude.use('mcp'); } catch { mcp = null; }
window.__desk = { SEED, BUILT_AT, store, toCuratorState, markPublished, markPublishedFrom, mergeChanges, preparePublish, publish, rekeyStale, flush, view: () => view(), rekeyDone: false };
await rekeyStale(); window.__desk.rekeyDone = true;
```

(`window.__desk` must exist before `rekeyStale` runs so the walkthrough's `waitForFunction(() => window.__desk && window.__desk.rekeyDone)` sees the flag flip.)

- [ ] **Step 5: Build, run, fix**

Run: `npm run desk:build && NODE_PATH=$(npm root -g) node scripts/desk-walkthrough.mjs --mode local && npm test`
Expected: all `PASS`, tests pass.

- [ ] **Step 6: Commit**

```bash
git add desk/desk.template.html desk/desk.html desk/desk.artifact.html scripts/desk-walkthrough.mjs
git commit -F - <<'EOF'
feat(desk): re-key stored changes onto a newer snapshot on load; Import changes

In browser mode the page checks each stored publish against the seed's history with
GitHub's compare and applies desk:rekey's rule, so /desk/ (rebuilt on every push) does not
count published changes forever. Refusals and an unreachable GitHub leave the documents
alone and say why. Import changes merges a changes.json from another copy.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

---

### Task 5: Docs — README, CHANGELOG, and the two rules the button changes

**Goal:** A reader of the README can create the token, use the button, and knows what it changes for the claude.ai copy and the disk copy.

**Files:**
- Modify: `README.md` ("The hosted Desk" section: scripts table unchanged; replace "Publishing from the fallback" with "The Publish button"; add one line to "How 'publish the atlas' runs" and to "re-seed the desk")
- Modify: `CHANGELOG.md` (`## [Unreleased]` → Added / Changed)

**Acceptance Criteria:**
- [ ] README has a "### The Publish button" subsection covering: where it appears (site `/desk/` and `desk/desk.html`; never inside claude.ai), the token (exact github.com path; Repository access → only receptor-atlas; Contents: Read and write; sent only to api.github.com; remembered in that browser under `atlas-desk-github-token`; Forget; the shared `fresco-esio.github.io` origin note), the six steps in one paragraph, the refusal and what to do, re-key on load and its two refusals, Import changes, and the disk-copy rule (`git pull`, then `desk:seed` + `desk:build` before editing there after any publish made elsewhere).
- [ ] "How 'publish the atlas' runs" gains: after a button publish, step 3's check refuses (seed moved) until the artifact is re-seeded — the existing rule, restated for this case.
- [ ] CHANGELOG `[Unreleased]` lists the button, the re-key, Import, and the ordered converter output (Changed: "the edits file written by a publish from the page is byte-identical to `desk:pull`'s").
- [ ] No claim in the docs that the walkthrough or tests do not cover (the docs describe the implemented behaviour only).

**Verify:** `grep -c "The Publish button" README.md` → `1`; `grep -n "Publish button" CHANGELOG.md` → at least one line under `[Unreleased]`; `npm test` still green (nothing else touched).

**Steps:**

- [ ] **Step 1: README.** Replace the "### Publishing from the fallback" subsection with:

```markdown
### The Publish button

Outside claude.ai — at `/desk/` on the public site, or `desk/desk.html` opened from a
clone — the Desk has a **Publish** button that commits the edits file itself. (Inside the
claude.ai frame the page cannot reach GitHub, so there "publish the atlas" stays the route.)

**The token, once per browser.** On github.com: Settings → Developer settings → Personal
access tokens → Fine-grained tokens → Generate new token. Resource owner: your account;
Repository access: *Only select repositories* → `receptor-atlas`; Permissions → Repository
permissions → *Contents: Read and write* (Metadata: Read is added by itself). Copy the
`github_pat_…` string into the Desk's **GitHub…** dialog. With "remember in this browser"
on it is kept in that browser's storage (`atlas-desk-github-token`); off, for the session
only. **Forget** clears it. The page sends it to `https://api.github.com` and nowhere else.
Every site under `fresco-esio.github.io` shares one browser origin, so a remembered token
is readable by any page there; they are all yours, but that is the trade.

**What one click does.** It reads `db/curator-state.json` as it is on `main`; runs the
same stale-seed check as `desk:pull` in the page (the file must be the snapshot's, or what
this page already published); shows the commit subject (`curate: 3 content edits, 1 source
attached`) for a Publish/Cancel; writes the converter's output — byte-identical to what
`desk:pull` writes — as one commit on `main` in your name; and only then marks those
changes published and keeps a receipt (`last published a1b2c3d · 2026-09-26` in the
banner). GitHub Actions rebuilds the site in a minute or two. If anything fails before the
commit, nothing is marked.

**"The repo has moved."** The file on `main` is neither the snapshot's nor what this page
published — something else committed it (the claude.ai copy, the old local Desk, a hand
edit). Nothing is written. Wait for the site to finish rebuilding and reload `/desk/`, which
is always built from the current file; from a clone, `git pull`, then `npm run desk:seed &&
npm run desk:build`. Your changes are kept either way.

**After a publish.** `/desk/` comes back on a new snapshot, and the changes this browser
holds are keyed to the old one. At load the page checks every publish they record against
the new seed's history (GitHub's compare endpoint, anonymous on a public repo) and applies
`desk:rekey`'s rule: published records drop out, unpublished ones carry over. It refuses in
the same two cases as the script — an unpublished revert or detach, or a publish not in the
history — and when GitHub cannot be reached; a line under the header says which, and
editing continues on the old keys.

**Import changes** merges a `changes.json` (Download changes from the claude.ai copy, or
from another browser) into this browser's store, record by record, later `at` winning.
Documents for receptors this snapshot does not have are skipped.

**A clone's `desk/desk.html`** is built from its own checkout: after any publish made
elsewhere (the button on the site, or "publish the atlas"), `git pull`, then `npm run
desk:seed && npm run desk:build` before editing there.
```

Keep the two paragraphs that follow in the current section about `/desk/` being rebuilt on every push and the clone lagging (README lines ~103-110), edited so they do not repeat the new text. In "How 'publish the atlas' runs", after step 3 add: "A publish made with the page's Publish button moves the file too, so this check refuses until the artifact is re-seeded — as for any publish the artifact did not make." In "re-seed the desk", add to step 1: "(the button's publishes are already on `main`)".

- [ ] **Step 2: CHANGELOG** under `## [Unreleased]`:

```markdown
### Added
- The Desk's **Publish** button (outside claude.ai: `/desk/` on the site, `desk/desk.html`
  from a clone) commits `db/curator-state.json` to `main` through GitHub's API with a
  fine-grained token kept in that browser, after the same stale-seed check as `desk:pull`
  and a confirm showing the commit subject; then marks the changes published and shows the
  receipt in the banner.
- At load, `/desk/` re-keys changes stored against an older snapshot onto the current one
  (published records fold in; unpublished carry over), refusing and saying why in the same
  cases as `desk:rekey`.
- **Import changes** merges a `changes.json` from another copy of the Desk.

### Changed
- The edits file the converter writes orders its maps the way the database export does,
  so a publish from the page and one from `desk:pull` are byte-identical.
```

- [ ] **Step 3: Verify and commit**

```bash
grep -c "The Publish button" README.md; npm test
git add README.md CHANGELOG.md
git commit -F - <<'EOF'
docs(desk): the Publish button — token, what one click does, refusals, re-key on load, Import

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

---

### Task 6: Host — move the commits, push, confirm the live button; board update

**Goal:** The branch is on `main` at origin, GitHub Actions is green, `/desk/` on the live site shows the Publish button, and the project board's open item says what the owner does next.

**Files:**
- Transfer: `git format-patch main..desk-publish-button` from `/home/claude/atlas` → `O:\Receptor Museum\atlas-app\` via `device_commit_files`; `git am` on the host via Desktop Commander (PowerShell); `git push origin main`.
- Modify: `/mnt/user-data/outputs/stage/projects.json` (atlas `open[0]`, `done[0]`) and `/mnt/user-data/outputs/stage/dashboard.html` if it inlines the data; commit both to `O:\` (`projects.json`, `dashboard.html`) and republish the board artifact `https://claude.ai/artifact/QXyVycGCjEdgVZ6onQ7d4x`.

**Acceptance Criteria:**
- [ ] `git log --oneline -6 origin/main` on the host shows the five commits from Tasks 1-5 on top of `e14bd39`, and `git status` is clean.
- [ ] `gh run list --limit 1` (host) → the Pages run for the pushed commit `completed success`.
- [ ] `https://fresco-esio.github.io/receptor-atlas/desk/` loaded in the built-in browser shows a `Publish` button and a `GitHub…` button, and the banner names the new seed date; opening GitHub… shows the token dialog (nothing entered).
- [ ] The board's atlas entry: `open[0]` = "Create the fine-grained token (README → The Publish button), make one edit at …/receptor-atlas/desk/, press Publish. The first real commit from the page is the check I could not run for you." (sev `warn`); `done` gains "Publish button: the site Desk commits the edits file itself; re-keys after the rebuild; Import changes." Both copies (O:\ and the artifact) updated.
- [ ] The Desk artifact is NOT republished (no version bump; the button is hidden in the frame anyway) — say so in the report.

**Verify:** the host commands above; a screenshot or `get_page_text` of the live `/desk/` showing "Publish".

**Steps:**

- [ ] **Step 1: Patches.** In `/home/claude/atlas`: `npm test` once more on the branch; then `git format-patch -o /mnt/user-data/outputs/patches main..desk-publish-button` and commit the patch files to the host with `device_commit_files` into `O:\Receptor Museum\atlas-app\.patches\` (create; delete after, or leave — `.patches` is not tracked; add it to `.git/info/exclude` on the host).

- [ ] **Step 2: Apply on the host** (Desktop Commander `start_process`, PowerShell, cwd `O:\Receptor Museum\atlas-app`): `git status --porcelain` must be empty and `git rev-parse --short HEAD` must be `e14bd39`; then `git am .patches\*.patch` (if `git am` complains about whitespace or line endings, `git am --abort` and retry with `git am --ignore-whitespace`); `npm test` on the host; `git log --oneline -6`.

- [ ] **Step 3: Push and watch.** `git push origin main`; then `gh run list --limit 1` until `completed`; `gh run view <id>` if not `success`.

- [ ] **Step 4: See it live.** Built-in browser: open `https://fresco-esio.github.io/receptor-atlas/desk/` (`preview_start`), `get_page_text` → contains "Publish" and "GitHub…"; click GitHub… → dialog text contains "Fine-grained"; Cancel. Report what the page shows.

- [ ] **Step 5: Board.** Edit `projects.json` as above (both `done` and `open`), rebuild/republish `dashboard.html` the way Task 6 of the reorg did (check whether `dashboard.html` fetches `projects.json` or inlines it: `grep -n "projects.json" /mnt/user-data/outputs/stage/dashboard.html`), commit both files to `O:\` with `device_commit_files` (force only if the mtime guard trips because we wrote them earlier this session), and republish the board artifact from the same file path used before.

- [ ] **Step 6: Report** to the coordinator: origin/main sha, Actions run URL and status, what the live `/desk/` showed, that the Desk artifact was left at its current version, and the token steps for the owner.
