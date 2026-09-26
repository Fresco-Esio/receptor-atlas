# Hosted Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-file, Provenance-style editor for the Receptor Atlas that runs as a private claude.ai page or from disk, keeps only changes since a dated snapshot, and emits `db/curator-state.json` through one converter shared with a repo script, so publishing is a normal commit and nothing depends on a server.

**Architecture:** Two repo scripts produce `desk/seed.json` (what the Atlas currently is, plus the pristine values it is a delta from, plus the edits file it was built from) and inline it with a DOM-free core module into `desk/desk.html`. The page renders seed + changes, stores only changes (claude.ai `db` when present, else `localStorage`), and the core's converter turns changes into a `format: 1` edits file. `desk:pull` canonicalises that file through a fresh database so it is byte-identical to what the old Desk's `writeState` would produce.

**Tech Stack:** Node 22 ESM, `better-sqlite3`, `node --test`, vanilla HTML/CSS/JS (no framework, no build tool beyond one inlining script), Playwright (dev-only, for the walkthrough), claude.ai Artifact runtime contract 0.2.54 (`db`, `mcp`, `downloads`).

**Spec:** `docs/superpowers/specs/2026-09-26-hosted-desk-design.md`

## Global Constraints

- The edits file format stays `format: 1` and `scripts/curator-state.mjs` `importState` is not changed except for `CLINICAL_COLS`. The converter emits what `importState` already accepts.
- `db/atlas.db` is never opened by any new script. `desk:seed` builds its databases in memory.
- Every new module runs in the browser AND in Node: no `node:` imports in `desk/desk-core.mjs`, no DOM access in it either.
- Object key order in the emitted edits file follows `exportState` exactly (top level: `format, review, activity, bindingReview, sources, receptorSources, bindingSources, content`; `content`: `claims, archive, clinical, bindings`). `desk:pull` guarantees byte-identity by importing into a fresh in-memory database and calling `exportState`; the page's Download is a valid import that may differ in row order (documented, see Task 4).
- The page uses Provenance's visual system (black on white, Inter, per-source hue), never the Atlas's `DESIGN.md` tokens. `test/design-conformance.test.js` scans `public/` only; `desk/` stays outside it.
- Reference for lifted code: `/home/claude/atlas-ref/provenance.html` (the owner's Provenance artifact, saved read-only in this environment). Lift the named functions verbatim where a task says so; do not lift its storage layer or project model.
- Working tree for this plan: the cloud clone at `/home/claude/atlas` (origin = `Fresco-Esio/receptor-atlas`, 176/176 tests green with `scripts/sourcing/cache/pdsp-rows.json` staged). This environment cannot push. Commits are made here; Task 9 moves them to the owner's machine with `git format-patch` → `device_commit_files` → `git am` → `git push` on the host, where credentials exist.
- Commit messages end with the two attribution lines given in the session's system reminder.

**User decisions (already made):**
- Approach A: hosted Desk built from Provenance's parts; repo seed + edits file remain the source of truth; old Node Desk stays, untouched.
- Scope: Archive prose + sources, and the Ledger's 14 clinical fields. Cabinet bindings stay script-driven. Review marks: mechanism, affinity, clinical, note only.
- "Attaching a source means I have read it": every attached source exports as `verified`; the reading checks, `citations verified` and `mastery` are removed from the UI. Reinstate the gate if a second author ever edits (recorded in the spec).
- Sentence-level spans are an editing aid stored in `changes`, never exported; kept in a shape a later project can render.
- Publish loop: Claude on request ("publish the atlas"); a Download button exists as fallback.
- A publish marks changes as published, never clears them; re-seed (and the page republish that moves the artifact version) happens only when the owner asks.
- The page must work with claude.ai's features absent: same file, browser storage, hand-entered sources, Download.

---

## File structure

```
db/index.js                      MODIFY  ensureColumns(): idempotent ALTER for the four syndromic columns
scripts/curator-state.mjs        MODIFY  CLINICAL_COLS gains onset, time_course, risk_factors_json, monitoring_json
desk/desk-core.mjs               CREATE  change store model, view merge, converter, summariser. No DOM, no node:.
desk/desk.template.html          CREATE  the editor: markup, styles, DOM layer, storage adapters, cloud adapters
desk/seed.json                   GENERATED, committed
desk/desk.html                   GENERATED, committed (published as the artifact; copied to dist/desk/index.html)
scripts/desk-seed.mjs            CREATE  npm run desk:seed
scripts/desk-build.mjs           CREATE  npm run desk:build
scripts/desk-pull.mjs            CREATE  npm run desk:pull [--check] <changes.json>
scripts/desk-walkthrough.mjs     CREATE  dev-only Playwright walkthrough, both modes
scripts/publish.js               MODIFY  copy desk/desk.html to dist/desk/index.html
test/schema-syndromic.test.js    CREATE
test/desk-core.test.js           CREATE
test/desk-seed.test.js           CREATE
test/desk-pull.test.js           CREATE
test/publish.test.js             MODIFY  one assertion for dist/desk/index.html
package.json                     MODIFY  scripts
README.md, CHANGELOG.md          MODIFY  section + Unreleased entries
```

Vocabulary used by every task below (fixed here so tasks agree):

- **field path**: a string naming one editable value. Archive scalars `archive.abstract`, `archive.presentation`, `archive.effect`, `archive.receptor_class`, `archive.ligand`, `archive.figure_caption`; archive lists `archive.body`, `archive.tags` (arrays of strings); `claim`; clinical scalars `clinical.sys`, `clinical.name`, `clinical.cls`, `clinical.baseline`, `clinical.mech`, `clinical.stahl`, `clinical.onset`, `clinical.time_course`; clinical lists `clinical.over`, `clinical.under`, `clinical.agonists`, `clinical.antagonists`, `clinical.risk_factors`, `clinical.monitoring` (arrays of strings).
- **source key**: `sourceKey()` from `scripts/curator-state.mjs` (`pmid:…`, `doi:…`, `url:…`, `cite:…`). The core re-implements the same function so the page can compute it without `node:` imports.
- **seed**: the object in `desk/seed.json` (shape in Task 3).
- **changes**: one object per receptor (shape in Task 2).

---

### Task 1: The four syndromic columns become real everywhere

**Goal:** A fresh database has `onset`, `time_course`, `risk_factors_json`, `monitoring_json` on `clinical_rows`, and the edits file carries them, so a Desk edit of any of them survives a rebuild.

**Files:**
- Modify: `db/index.js`
- Modify: `scripts/curator-state.mjs:48`
- Test: `test/schema-syndromic.test.js`
- Modify: `CHANGELOG.md` (Unreleased → Fixed)

**Acceptance Criteria:**
- [ ] `openDb(':memory:')` followed by `migrate()` yields `PRAGMA table_info(clinical_rows)` containing the four columns.
- [ ] Opening a database that already has the columns (the owner's `db/atlas.db`) does not throw and does not duplicate columns.
- [ ] `exportState` of a database where `onset` was edited contains `content.clinical[no].onset`; `importState` of that dump into a fresh database sets the column.
- [ ] A `PATCH /api/receptors/:id/structured` with `{ volume: 'ledger', clinical: { onset: 'days', risk_factors: ['x'] } }` returns 200 on a fresh in-memory server and the row reads back with both.
- [ ] `npm test` → 176 + new tests, 0 fail.

**Verify:** `node --test test/schema-syndromic.test.js test/curator-state.test.js test/api-structured.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing tests**

```js
// test/schema-syndromic.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { exportState, importState } from '../scripts/curator-state.mjs';
import { createServer } from '../server.js';

const SYNDROMIC = ['onset', 'time_course', 'risk_factors_json', 'monitoring_json'];
const fresh = () => { const db = openDb(':memory:'); migrate(db); return db; };
const cols = db => db.prepare('PRAGMA table_info(clinical_rows)').all().map(c => c.name);

test('a fresh database has the four syndromic columns', () => {
  const c = cols(fresh());
  for (const k of SYNDROMIC) assert.ok(c.includes(k), `${k} missing`);
});

test('opening a database that already has them is a no-op', () => {
  const db = fresh();
  const before = cols(db);
  db.exec(`SELECT 1`);
  // openDb runs schema + ensureColumns every time; simulate a second open on the same file
  const again = openDb(':memory:'); migrate(again);
  assert.deepEqual(cols(again), before);
  assert.equal(before.filter(k => k === 'onset').length, 1);
});

test('the edits file carries a syndromic edit through a rebuild', () => {
  const a = fresh();
  a.prepare(`UPDATE clinical_rows SET onset='days to weeks', risk_factors_json=? WHERE no=3`).run(JSON.stringify(['elderly', 'high dose']));
  const dump = exportState(a);
  assert.equal(dump.content.clinical['3'].onset, 'days to weeks');
  assert.equal(dump.content.clinical['3'].risk_factors_json, JSON.stringify(['elderly', 'high dose']));
  const b = fresh();
  importState(b, dump);
  const row = b.prepare('SELECT onset, risk_factors_json FROM clinical_rows WHERE no=3').get();
  assert.equal(row.onset, 'days to weeks');
  assert.equal(row.risk_factors_json, JSON.stringify(['elderly', 'high dose']));
});

test('PATCH structured accepts the syndromic fields on a fresh database', async () => {
  const server = createServer(':memory:', { seed: true });
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const rows = await (await fetch(`${base}/api/atlas/ledger/clinical`)).json();
  const id = (await (await fetch(`${base}/api/receptors`)).json()).find(r => r.id === 'd2').id;
  const res = await fetch(`${base}/api/receptors/${id}/structured`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume: 'ledger', clinical: { onset: 'hours', risk_factors: ['x'] } }),
  });
  assert.equal(res.status, 200, await res.text());
  const detail = await (await fetch(`${base}/api/receptors/${id}/structured`)).json();
  assert.equal(detail.clinical.onset, 'hours');
  assert.deepEqual(detail.clinical.risk_factors, ['x']);
  await new Promise(r => server.close(r));
  assert.ok(rows.length > 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/schema-syndromic.test.js`
Expected: the first and third tests FAIL (`onset missing` / `no such column: onset`); the PATCH test FAILS with a 500 or SQL error.

- [ ] **Step 3: Add `ensureColumns` to `db/index.js`**

```js
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// Columns added after the table shipped. schema.sql is CREATE TABLE IF NOT EXISTS, so a
// new column there never reaches an existing database; this does, idempotently. The
// Ledger's four syndromic columns were reachable from the Desk since 1.2.0 but existed
// only on the machine where they had been added by hand.
const LATE_COLUMNS = {
  clinical_rows: [
    ['onset', 'TEXT'], ['time_course', 'TEXT'],
    ['risk_factors_json', 'TEXT'], ['monitoring_json', 'TEXT'],
  ],
};
export function ensureColumns(db) {
  for (const [table, cols] of Object.entries(LATE_COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const [name, type] of cols) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

export function openDb(path = join(HERE, 'atlas.db')) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));
  ensureColumns(db);
  return db;
}
```

- [ ] **Step 4: Extend `CLINICAL_COLS` in `scripts/curator-state.mjs`**

Replace line 48 with:

```js
const CLINICAL_COLS = ['sys', 'name', 'cls', 'baseline', 'mech', 'over_json', 'under_json', 'stahl', 'agonists_json', 'antagonists_json',
  'onset', 'time_course', 'risk_factors_json', 'monitoring_json'];
```

- [ ] **Step 5: Run the new tests and the whole suite**

Run: `node --test test/schema-syndromic.test.js` → 4 pass. Then `npm test` → `# fail 0`.

- [ ] **Step 6: CHANGELOG entry under `## [Unreleased]` → `### Fixed`** (create the headings if absent, above `## [1.2.0]`):

```markdown
- **Onset, time course, risk factors and monitoring now survive a rebuild.** The Desk
  could edit them since 1.2.0, but the columns existed only on one machine and the
  curator dump did not carry them, so a fresh clone or the published site would have
  silently dropped the edit. The columns are now added on open, idempotently, and the
  dump carries them. Nothing was lost: all four were still empty.
```

- [ ] **Step 7: Commit**

```bash
git add db/index.js scripts/curator-state.mjs test/schema-syndromic.test.js CHANGELOG.md
git commit -F - <<'EOF'
fix(ledger): the four syndromic columns exist everywhere and travel in the dump

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

---

### Task 2: `desk/desk-core.mjs` — change store and converter, with tests

**Goal:** A DOM-free, `node:`-free module that models per-receptor changes, merges them over a seed for display, converts them into a `format: 1` edits file, and summarises them in one line.

**Files:**
- Create: `desk/desk-core.mjs`
- Test: `test/desk-core.test.js`

**Acceptance Criteria:**
- [ ] `emptyChanges`, `setField`, `attachSource`, `detachSource`, `setSourceFlags`, `setReview`, `viewOf`, `toCuratorState`, `summarise`, `markPublished`, `rekey`, `countUnpublished`, `sourceKey` are exported and behave as the tests below say.
- [ ] `toCuratorState` output for a field set back to its pristine value contains no entry for that field.
- [ ] A seeded source cannot be detached: `detachSource` throws `Error('seeded source: flag it as conflicting instead')` when the key is in `seed` for that receptor and not in `changes.sources.add`.
- [ ] `node --test test/desk-core.test.js` passes; the module imports cleanly in a browser (`<script type="module">`) — verified in Task 6's walkthrough.

**Verify:** `node --test test/desk-core.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing tests**

```js
// test/desk-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../desk/desk-core.mjs';

// A hand-built seed with one receptor, small enough to reason about. Shape as Task 3 emits.
function seed() {
  return {
    format: 1, builtAt: '2026-09-26T12:00:00Z', commit: 'abc1234',
    baseState: { format: 1, review: {}, activity: [], bindingReview: [], sources: [], receptorSources: [], bindingSources: [],
      content: { claims: {}, archive: {}, clinical: {}, bindings: [] } },
    receptors: [{
      id: 'd2', label: 'Dopamine D2', system: 'dopamine', hall: 'dopamine', volumes: ['archive', 'cabinet', 'ledger'],
      archiveAlias: '3', clinicalNo: 3,
      archive: { abstract: 'Old abstract.', presentation: 'p', effect: 'e', receptor_class: 'GPCR', ligand: 'DA', figure_caption: 'Fig',
                 body: ['Para one.', 'Para two.'], tags: ['a', 'b'] },
      claim: 'D2 claim.',
      clinical: { no: 3, sys: 'dopamine', name: 'D2', cls: 'GPCR', baseline: 'b', mech: 'm', stahl: 's',
                  over: ['o1'], under: ['u1'], agonists: [], antagonists: ['haloperidol'],
                  onset: null, time_course: null, risk_factors: [], monitoring: [] },
      sources: [{ key: 'pmid:24463000', is_primary: 1, status: 'verified', correction_note: null }],
      review: { mechanism: 0, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: '' },
      activity: [],
    }],
    pristine: {
      archive: { d2: { abstract: 'Old abstract.', presentation: 'p', effect: 'e', receptor_class: 'GPCR', ligand: 'DA', figure_caption: 'Fig',
                       body_json: JSON.stringify(['Para one.', 'Para two.']), tags_json: JSON.stringify(['a', 'b']) } },
      claims: { d2: 'D2 claim.' },
      clinical: { 3: { sys: 'dopamine', name: 'D2', cls: 'GPCR', baseline: 'b', mech: 'm', over_json: JSON.stringify(['o1']), under_json: JSON.stringify(['u1']),
                       stahl: 's', agonists_json: '[]', antagonists_json: JSON.stringify(['haloperidol']),
                       onset: null, time_course: null, risk_factors_json: null, monitoring_json: null } },
      review: { d2: { mechanism: 0, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: '' } },
      receptorSources: { 'd2|pmid:24463000': { status: 'verified', is_primary: 1, correction_note: null } },
      sources: { 'pmid:24463000': { kind: 'article', authors: 'Beaulieu JM', year: 2011, title: 'Dopamine receptors', journal: 'Pharmacol Rev', pmid: '24463000', doi: null, url: null, notes: null } },
    },
    sources: { 'pmid:24463000': { kind: 'article', authors: 'Beaulieu JM', year: 2011, title: 'Dopamine receptors', journal: 'Pharmacol Rev', pmid: '24463000', doi: null, url: null, notes: null } },
  };
}
const AT = '2026-09-26T13:00:00.000Z';

test('sourceKey matches the repo rule', () => {
  assert.equal(core.sourceKey({ pmid: ' 123 ' }), 'pmid:123');
  assert.equal(core.sourceKey({ doi: '10.1/AB' }), 'doi:10.1/ab');
  assert.equal(core.sourceKey({ url: 'https://x' }), 'url:https://x');
  assert.equal(core.sourceKey({ kind: 'book', authors: 'S', year: 2021, title: 'T' }), 'cite:book|S|2021|T');
});

test('viewOf lays changes over the seed', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.abstract', 'New abstract.', AT);
  c = core.setField(c, 'clinical.over', ['o1', 'o2'], AT);
  const v = core.viewOf(s.receptors[0], c);
  assert.equal(v.archive.abstract, 'New abstract.');
  assert.deepEqual(v.clinical.over, ['o1', 'o2']);
  assert.equal(v.archive.body[0], 'Para one.', 'untouched fields come from the seed');
  assert.equal(s.receptors[0].archive.abstract, 'Old abstract.', 'the seed is not mutated');
});

test('a field edit exports as a content delta; setting it back removes the delta', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.abstract', 'New abstract.', AT);
  let out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.content.archive, { d2: { abstract: 'New abstract.' } });
  c = core.setField(c, 'archive.abstract', 'Old abstract.', AT);
  out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.content.archive, {}, 'equal to pristine means no line in the dump');
});

test('list fields serialise the way the router does', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.tags', ['a', 'b', 'c'], AT);
  c = core.setField(c, 'clinical.monitoring', ['ECG'], AT);
  const out = core.toCuratorState(s, [c]);
  assert.equal(out.content.archive.d2.tags_json, JSON.stringify(['a', 'b', 'c']));
  assert.equal(out.content.clinical['3'].monitoring_json, JSON.stringify(['ECG']));
});

test('claim edits go to content.claims', () => {
  const s = seed(); const c = core.setField(core.emptyChanges('d2', s.commit), 'claim', 'Better claim.', AT);
  assert.deepEqual(core.toCuratorState(s, [c]).content.claims, { d2: 'Better claim.' });
});

test('attaching a new source adds the library row and a verified edge', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  const meta = { kind: 'article', authors: 'Kapur S', year: 2003, title: 'Aberrant salience', journal: 'Am J Psychiatry', pmid: '12505794', doi: null, url: null, notes: null };
  c = core.attachSource(c, s, meta, { is_primary: 0 }, AT);
  const out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.sources, [{ key: 'pmid:12505794', ...meta }]);
  assert.deepEqual(out.receptorSources, [{ receptor_id: 'd2', source: 'pmid:12505794', status: 'verified', is_primary: 0, correction_note: null }]);
});

test('flagging a seeded source as conflicting changes only that edge; unflagging removes the line', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setSourceFlags(c, s, 'pmid:24463000', { conflicting: true, correction_note: 'year is 2011 not 2010' }, AT);
  let out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.receptorSources, [{ receptor_id: 'd2', source: 'pmid:24463000', status: 'conflicting', is_primary: 1, correction_note: 'year is 2011 not 2010' }]);
  assert.deepEqual(out.sources, [], 'the paper itself did not change');
  c = core.setSourceFlags(c, s, 'pmid:24463000', { conflicting: false, correction_note: null }, AT);
  out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.receptorSources, []);
});

test('a seeded source cannot be detached; a change-added one can', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  assert.throws(() => core.detachSource(c, s, 'pmid:24463000', AT), /seeded source/);
  const meta = { kind: 'article', authors: 'X', year: 2020, title: 'T', journal: 'J', pmid: '999', doi: null, url: null, notes: null };
  c = core.attachSource(c, s, meta, { is_primary: 0 }, AT);
  c = core.detachSource(c, s, 'pmid:999', AT);
  const out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.sources, []); assert.deepEqual(out.receptorSources, []);
});

test('review marks export only when something is set, in the repo key order', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setReview(c, { mechanism: 1, note: 'checked Gi coupling' }, AT);
  const out = core.toCuratorState(s, [c]);
  assert.deepEqual(Object.keys(out.review.d2), ['mechanism', 'affinity', 'clinical', 'citation', 'mastery', 'note']);
  assert.deepEqual(out.review.d2, { mechanism: 1, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: 'checked Gi coupling' });
  c = core.setReview(c, { mechanism: 0, note: '' }, AT);
  assert.deepEqual(core.toCuratorState(s, [c]).review, {});
});

test('activity is stamped per volume from the change timestamps', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.abstract', 'A', '2026-09-26T13:00:00.000Z');
  c = core.setField(c, 'clinical.onset', 'days', '2026-09-26T14:00:00.000Z');
  c = core.setReview(c, { clinical: 1 }, '2026-09-26T15:00:00.000Z');
  const a = core.toCuratorState(s, [c]).activity;
  assert.deepEqual(a.find(x => x.volume === 'archive'), { receptor_id: 'd2', volume: 'archive', last_edited_at: '2026-09-26T13:00:00.000Z', last_reviewed_at: '2026-09-26T15:00:00.000Z' });
  assert.deepEqual(a.find(x => x.volume === 'ledger'), { receptor_id: 'd2', volume: 'ledger', last_edited_at: '2026-09-26T14:00:00.000Z', last_reviewed_at: '2026-09-26T15:00:00.000Z' });
  assert.deepEqual(a.find(x => x.volume === 'cabinet'), { receptor_id: 'd2', volume: 'cabinet', last_edited_at: null, last_reviewed_at: '2026-09-26T15:00:00.000Z' });
});

test('baseState entries the changes do not touch are carried through untouched', () => {
  const s = seed();
  s.baseState.content.archive.d2 = { effect: 'Seed-era edit' };
  s.receptors[0].archive.effect = 'Seed-era edit';
  const c = core.setField(core.emptyChanges('d2', s.commit), 'archive.abstract', 'New', AT);
  const out = core.toCuratorState(s, [c]);
  assert.deepEqual(out.content.archive.d2, { abstract: 'New', effect: 'Seed-era edit' });
  assert.deepEqual(Object.keys(out), ['format', 'review', 'activity', 'bindingReview', 'sources', 'receptorSources', 'bindingSources', 'content']);
});

test('summarise, markPublished, countUnpublished, rekey', () => {
  const s = seed(); let c = core.emptyChanges('d2', s.commit);
  c = core.setField(c, 'archive.abstract', 'New', AT);
  c = core.setSourceFlags(c, s, 'pmid:24463000', { conflicting: true, correction_note: 'n' }, AT);
  assert.equal(core.summarise([c]), '1 content edit, 1 conflict noted');
  assert.equal(core.countUnpublished([c]), 2);
  const p = core.markPublished(c, 'deadbee');
  assert.equal(core.countUnpublished([p]), 0);
  assert.equal(p.fields['archive.abstract'].publishedAs, 'deadbee');
  const r = core.rekey(p, { ...s, commit: 'new1234' });
  assert.equal(r.seedCommit, 'new1234');
  assert.deepEqual(r.fields, {}, 'published fields fold into the new seed');
  const u = core.rekey(core.setField(p, 'claim', 'x', AT), { ...s, commit: 'new1234' });
  assert.deepEqual(Object.keys(u.fields), ['claim'], 'unpublished ones survive a re-seed');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/desk-core.test.js`
Expected: FAIL, `Cannot find module '../desk/desk-core.mjs'`.

- [ ] **Step 3: Write `desk/desk-core.mjs`**

```js
// The Desk's logic with nothing attached to it: no DOM, no node: imports, so the same
// file runs in the page and in scripts/desk-pull.mjs. Everything here is a pure function
// over plain objects; the page and the scripts own the side effects.
export const FORMAT = 1;
export const ARCHIVE_SCALAR = ['abstract', 'presentation', 'effect', 'receptor_class', 'ligand', 'figure_caption'];
export const ARCHIVE_LIST = { body: 'body_json', tags: 'tags_json' };
export const ARCHIVE_COLS = ['abstract', 'presentation', 'effect', 'receptor_class', 'ligand', 'figure_caption', 'body_json', 'tags_json'];
export const CLINICAL_SCALAR = ['sys', 'name', 'cls', 'baseline', 'mech', 'stahl', 'onset', 'time_course'];
export const CLINICAL_LIST = { over: 'over_json', under: 'under_json', agonists: 'agonists_json', antagonists: 'antagonists_json', risk_factors: 'risk_factors_json', monitoring: 'monitoring_json' };
export const CLINICAL_COLS = ['sys', 'name', 'cls', 'baseline', 'mech', 'over_json', 'under_json', 'stahl', 'agonists_json', 'antagonists_json', 'onset', 'time_course', 'risk_factors_json', 'monitoring_json'];
export const SOURCE_COLS = ['kind', 'authors', 'year', 'title', 'journal', 'pmid', 'doi', 'url', 'notes'];
export const REVIEW_COLS = ['mechanism', 'affinity', 'clinical', 'citation', 'mastery', 'note'];
export const REVIEW_MARKS = ['mechanism', 'affinity', 'clinical'];
const VOLUMES = ['archive', 'cabinet', 'ledger'];

const clone = o => JSON.parse(JSON.stringify(o));

/** Same rule as scripts/curator-state.mjs sourceKey(): identify a paper by what identifies it in the world. */
export function sourceKey(s) {
  if (s.pmid) return `pmid:${String(s.pmid).trim()}`;
  if (s.doi) return `doi:${String(s.doi).trim().toLowerCase()}`;
  if (s.url) return `url:${String(s.url).trim()}`;
  return `cite:${[s.kind, s.authors, s.year, s.title].map(v => String(v ?? '').trim()).join('|')}`;
}

export function emptyChanges(receptorId, seedCommit) {
  return { receptorId, seedCommit, fields: {}, sources: { add: [], remove: [], set: {} }, library: {}, spans: [], review: null };
}

/** Which volume a field path belongs to, for the activity stamp. */
function volumeOf(path) { return path === 'claim' ? 'cabinet' : path.startsWith('clinical.') ? 'ledger' : 'archive'; }

export function setField(changes, path, value, at) {
  const c = clone(changes);
  c.fields[path] = { value: Array.isArray(value) ? [...value] : value, at, publishedAs: null };
  return c;
}

const seededSource = (seedReceptor, key) => (seedReceptor.sources || []).some(s => s.key === key);
const seedReceptorOf = (seed, id) => seed.receptors.find(r => r.id === id);

/** meta: SOURCE_COLS object for a new paper (the library row). flags: { is_primary, conflicting, correction_note }. */
export function attachSource(changes, seed, meta, flags, at) {
  const c = clone(changes); const key = sourceKey(meta);
  const r = seedReceptorOf(seed, c.receptorId);
  if (seededSource(r, key) || c.sources.add.some(s => s.key === key)) throw new Error('already attached');
  if (!seed.sources[key]) c.library[key] = Object.fromEntries(SOURCE_COLS.map(k => [k, meta[k] ?? null]));
  c.sources.add.push({ key, is_primary: flags.is_primary ? 1 : 0, conflicting: !!flags.conflicting, correction_note: flags.correction_note ?? null, at, publishedAs: null });
  return c;
}

export function detachSource(changes, seed, key, at) {
  const c = clone(changes);
  const i = c.sources.add.findIndex(s => s.key === key);
  if (i < 0) throw new Error('seeded source: flag it as conflicting instead');
  c.sources.add.splice(i, 1); delete c.library[key]; delete c.sources.set[key];
  c.spans = c.spans.filter(sp => sp.sourceKey !== key);
  return c;
}

export function setSourceFlags(changes, seed, key, flags, at) {
  const c = clone(changes);
  const added = c.sources.add.find(s => s.key === key);
  if (added) { Object.assign(added, { is_primary: flags.is_primary ?? added.is_primary, conflicting: flags.conflicting ?? added.conflicting, correction_note: flags.correction_note ?? added.correction_note, at, publishedAs: null }); return c; }
  const r = seedReceptorOf(seed, c.receptorId);
  const seeded = (r.sources || []).find(s => s.key === key);
  if (!seeded) throw new Error('unknown source');
  const prev = c.sources.set[key] || { is_primary: seeded.is_primary, conflicting: seeded.status === 'conflicting', correction_note: seeded.correction_note };
  c.sources.set[key] = { is_primary: flags.is_primary ?? prev.is_primary, conflicting: flags.conflicting ?? prev.conflicting, correction_note: flags.correction_note ?? prev.correction_note, at, publishedAs: null };
  return c;
}

export function setReview(changes, marks, at) {
  const c = clone(changes);
  const prev = c.review || { mechanism: 0, affinity: 0, clinical: 0, note: '' };
  c.review = { ...prev, ...marks, at, publishedAs: null };
  return c;
}

/** The receptor as the page should show it: seed with every change laid over it. */
export function viewOf(seedReceptor, changes) {
  const v = clone(seedReceptor);
  for (const [path, f] of Object.entries(changes.fields)) {
    if (path === 'claim') v.claim = f.value;
    else { const [vol, field] = path.split('.'); if (!v[vol]) v[vol] = {}; v[vol][field] = f.value; }
  }
  const sources = (v.sources || []).map(s => {
    const set = changes.sources.set[s.key];
    return set ? { ...s, is_primary: set.is_primary, status: set.conflicting ? 'conflicting' : 'verified', correction_note: set.correction_note } : s;
  });
  for (const a of changes.sources.add) sources.push({ key: a.key, is_primary: a.is_primary, status: a.conflicting ? 'conflicting' : 'verified', correction_note: a.correction_note, added: true });
  v.sources = sources;
  if (changes.review) v.review = { ...v.review, mechanism: changes.review.mechanism, affinity: changes.review.affinity, clinical: changes.review.clinical, note: changes.review.note };
  return v;
}

const eq = (a, b) => (a ?? null) === (b ?? null);
const pickOrdered = (obj, cols) => Object.fromEntries(cols.filter(k => k in obj).map(k => [k, obj[k]]));

/** changes (one per receptor) → a format-1 edits file, a delta from the pristine seed. */
export function toCuratorState(seed, changesList) {
  const out = clone(seed.baseState);
  out.content = out.content || { claims: {}, archive: {}, clinical: {}, bindings: [] };
  const P = seed.pristine;
  const upsertEdge = (edge) => { const i = out.receptorSources.findIndex(e => e.receptor_id === edge.receptor_id && e.source === edge.source); if (i < 0) out.receptorSources.push(edge); else out.receptorSources[i] = edge; };
  const dropEdge = (id, key) => { out.receptorSources = out.receptorSources.filter(e => !(e.receptor_id === id && e.source === key)); };
  const upsertSource = (key, meta) => { const row = { key, ...pickOrdered(meta, SOURCE_COLS) }; const i = out.sources.findIndex(s => s.key === key); if (i < 0) out.sources.push(row); else out.sources[i] = row; };
  const dropSource = key => { out.sources = out.sources.filter(s => s.key !== key); };
  const stamp = (id, vol, edited, reviewed) => {
    let a = out.activity.find(x => x.receptor_id === id && x.volume === vol);
    if (!a) { a = { receptor_id: id, volume: vol, last_edited_at: null, last_reviewed_at: null }; out.activity.push(a); }
    if (edited && (!a.last_edited_at || edited > a.last_edited_at)) a.last_edited_at = edited;
    if (reviewed && (!a.last_reviewed_at || reviewed > a.last_reviewed_at)) a.last_reviewed_at = reviewed;
  };

  for (const c of changesList) {
    const id = c.receptorId; const r = seedReceptorOf(seed, id); const no = r.clinicalNo;
    // --- content fields ---
    const arch = { ...(out.content.archive[id] || {}) }, clin = { ...(no != null ? out.content.clinical[no] || {} : {}) };
    for (const [path, f] of Object.entries(c.fields)) {
      if (path === 'claim') { if (eq(f.value, P.claims[id])) delete out.content.claims[id]; else out.content.claims[id] = f.value; stamp(id, 'cabinet', f.at); continue; }
      const [vol, field] = path.split('.');
      if (vol === 'archive') {
        const col = ARCHIVE_LIST[field] || field; const raw = ARCHIVE_LIST[field] ? JSON.stringify(f.value ?? []) : f.value;
        if (eq(raw, (P.archive[id] || {})[col])) delete arch[col]; else arch[col] = raw;
        stamp(id, 'archive', f.at);
      } else {
        const col = CLINICAL_LIST[field] || field; const raw = CLINICAL_LIST[field] ? JSON.stringify(f.value ?? []) : f.value;
        if (eq(raw, (P.clinical[no] || {})[col])) delete clin[col]; else clin[col] = raw;
        stamp(id, 'ledger', f.at);
      }
    }
    if (Object.keys(arch).length) out.content.archive[id] = pickOrdered(arch, ARCHIVE_COLS); else delete out.content.archive[id];
    if (no != null) { if (Object.keys(clin).length) out.content.clinical[no] = pickOrdered(clin, CLINICAL_COLS); else delete out.content.clinical[no]; }
    // --- sources ---
    for (const [key, meta] of Object.entries(c.library)) { const pr = P.sources[key]; if (pr && SOURCE_COLS.every(k => eq(meta[k], pr[k]))) dropSource(key); else upsertSource(key, meta); }
    for (const a of c.sources.add) { upsertEdge({ receptor_id: id, source: a.key, status: a.conflicting ? 'conflicting' : 'verified', is_primary: a.is_primary ? 1 : 0, correction_note: a.correction_note ?? null }); stamp(id, 'archive', a.at); }
    for (const [key, s] of Object.entries(c.sources.set)) {
      const edge = { receptor_id: id, source: key, status: s.conflicting ? 'conflicting' : 'verified', is_primary: s.is_primary ? 1 : 0, correction_note: s.correction_note ?? null };
      const pr = P.receptorSources[`${id}|${key}`];
      if (pr && pr.status === edge.status && (pr.is_primary ? 1 : 0) === edge.is_primary && eq(pr.correction_note, edge.correction_note)) dropEdge(id, key); else upsertEdge(edge);
      stamp(id, 'archive', s.at);
    }
    // --- review ---
    if (c.review) {
      const base = out.review[id] || P.review[id] || { mechanism: 0, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: '' };
      const rv = { mechanism: c.review.mechanism | 0, affinity: c.review.affinity | 0, clinical: c.review.clinical | 0, citation: base.citation | 0, mastery: base.mastery | 0, note: c.review.note || '' };
      if (!rv.mechanism && !rv.affinity && !rv.clinical && !rv.citation && !rv.mastery && !rv.note) delete out.review[id]; else out.review[id] = rv;
      for (const vol of r.volumes || VOLUMES) stamp(id, vol, null, c.review.at);
    }
  }
  return { format: FORMAT, review: out.review, activity: out.activity, bindingReview: out.bindingReview || [], sources: out.sources, receptorSources: out.receptorSources, bindingSources: out.bindingSources || [], content: { claims: out.content.claims, archive: out.content.archive, clinical: out.content.clinical, bindings: out.content.bindings || [] } };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** One line for the publish prompt. Counts unpublished records only. */
export function summarise(changesList) {
  let edits = 0, attached = 0, conflicts = 0, reviews = 0;
  for (const c of changesList) {
    edits += Object.values(c.fields).filter(f => !f.publishedAs).length;
    attached += c.sources.add.filter(a => !a.publishedAs).length;
    conflicts += Object.values(c.sources.set).filter(s => !s.publishedAs && s.conflicting).length + c.sources.add.filter(a => !a.publishedAs && a.conflicting).length;
    if (c.review && !c.review.publishedAs) reviews++;
  }
  const parts = [];
  if (edits) parts.push(plural(edits, 'content edit'));
  if (attached) parts.push(plural(attached, 'source') + ' attached');
  if (conflicts) parts.push(plural(conflicts, 'conflict') + ' noted');
  if (reviews) parts.push(plural(reviews, 'review') + ' updated');
  return parts.join(', ') || 'nothing to publish';
}

export function countUnpublished(changesList) {
  let n = 0;
  for (const c of changesList) {
    n += Object.values(c.fields).filter(f => !f.publishedAs).length + c.sources.add.filter(a => !a.publishedAs).length + Object.values(c.sources.set).filter(s => !s.publishedAs).length + (c.review && !c.review.publishedAs ? 1 : 0);
  }
  return n;
}

export function markPublished(changes, sha) {
  const c = clone(changes);
  for (const f of Object.values(c.fields)) if (!f.publishedAs) f.publishedAs = sha;
  for (const a of c.sources.add) if (!a.publishedAs) a.publishedAs = sha;
  for (const s of Object.values(c.sources.set)) if (!s.publishedAs) s.publishedAs = sha;
  if (c.review && !c.review.publishedAs) c.review.publishedAs = sha;
  return c;
}

/** After a re-seed: published records are now in the seed, so drop them; keep the rest against the new commit. */
export function rekey(changes, newSeed) {
  const c = clone(changes); c.seedCommit = newSeed.commit;
  for (const [k, f] of Object.entries(c.fields)) if (f.publishedAs) delete c.fields[k];
  c.sources.add = c.sources.add.filter(a => !a.publishedAs);
  for (const [k, s] of Object.entries(c.sources.set)) if (s.publishedAs) delete c.sources.set[k];
  for (const k of Object.keys(c.library)) if (!c.sources.add.some(a => a.key === k)) delete c.library[k];
  if (c.review && c.review.publishedAs) c.review = null;
  return c;
}
```

- [ ] **Step 4: Run the tests until green**

Run: `node --test test/desk-core.test.js` → 12 pass. If `summarise` wording differs from the test, fix the function, not the test.

- [ ] **Step 5: Commit**

```bash
git add desk/desk-core.mjs test/desk-core.test.js
git commit -F - <<'EOF'
feat(desk): the Desk's logic as one pure module, with the converter to the edits file

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

---

### Task 3: `scripts/desk-seed.mjs` — build `desk/seed.json` from in-memory databases

**Goal:** `npm run desk:seed` writes `desk/seed.json`: the current editable state of every receptor, the pristine values it is a delta from, and the edits file it was built from, without opening `db/atlas.db`.

**Files:**
- Create: `scripts/desk-seed.mjs`
- Test: `test/desk-seed.test.js`
- Modify: `package.json` (add `"desk:seed": "node scripts/desk-seed.mjs"`)

**Acceptance Criteria:**
- [ ] `buildSeed({ baseState, commit })` returns the shape in Step 3; `receptors.length === 24`; every receptor with an archive entry has `archive.body` as an array; every receptor with a Ledger row has `clinical.no`.
- [ ] `seed.receptors[i].archive` equals the corresponding row of `archiveNarrative(db)` field for field, and `clinical` equals `ledgerClinical(db)` plus the four syndromic fields.
- [ ] `seed.baseState` deep-equals `readState()` (the repo's `db/curator-state.json`).
- [ ] `seed.pristine.*` equals the values from a database with no import applied.
- [ ] The CLI writes `desk/seed.json` with `JSON.stringify(seed, null, 1) + '\n'` and prints one line.

**Verify:** `node --test test/desk-seed.test.js && npm run desk:seed && node -e "const s=require('./desk/seed.json'); console.log(s.receptors.length, s.commit)"` → tests pass; prints `24 <sha>`

**Steps:**

- [ ] **Step 1: Write the failing tests**

```js
// test/desk-seed.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { importState, exportState, sourceKey } from '../scripts/curator-state.mjs';
import { archiveNarrative, ledgerClinical } from '../lib/queries.js';
import { buildSeed } from '../scripts/desk-seed.mjs';

const fresh = () => { const db = openDb(':memory:'); migrate(db); return db; };

test('seed carries every receptor, with the archive and ledger the API serves', () => {
  const db = fresh();
  db.prepare(`UPDATE archive_entries SET abstract='Edited abstract' WHERE receptor_id='sert'`).run();
  const baseState = exportState(db);
  const seed = buildSeed({ baseState, commit: 'abc1234' });
  assert.equal(seed.format, 1); assert.equal(seed.commit, 'abc1234'); assert.ok(seed.builtAt);
  assert.equal(seed.receptors.length, 24);
  assert.deepEqual(seed.baseState, baseState);
  const sert = seed.receptors.find(r => r.id === 'sert');
  assert.equal(sert.archive.abstract, 'Edited abstract', 'current state includes the edits file');
  assert.equal(seed.pristine.archive.sert.abstract !== 'Edited abstract', true, 'pristine is what the pages ship');
  // field-for-field against the API queries on an equivalent database
  const current = fresh(); importState(current, baseState);
  for (const row of archiveNarrative(current)) {
    const r = seed.receptors.find(x => x.id === row.receptor_id);
    assert.deepEqual(r.archive, { abstract: row.abstract, presentation: row.presentation, effect: row.effect, receptor_class: row.receptor_class, ligand: row.ligand, figure_caption: row.figure_caption, body: row.body, tags: row.tags });
    assert.equal(r.archiveAlias, row.alias);
  }
  for (const row of ledgerClinical(current)) {
    const r = seed.receptors.find(x => x.clinicalNo === row.no);
    assert.ok(r, `row ${row.no} has a receptor`);
    for (const k of ['sys', 'name', 'cls', 'baseline', 'mech', 'stahl', 'over', 'under', 'agonists', 'antagonists']) assert.deepEqual(r.clinical[k], row[k], k);
    assert.deepEqual(r.clinical.risk_factors, []); assert.equal(r.clinical.onset, null);
  }
});

test('seed sources are keyed by natural key and edges carry status, primary and note', () => {
  const seed = buildSeed({ baseState: exportState(fresh()), commit: 'x' });
  const d2 = seed.receptors.find(r => r.id === 'd2');
  assert.ok(d2.sources.length >= 1);
  for (const s of d2.sources) { assert.match(s.key, /^(pmid|doi|url|cite):/); assert.ok(seed.sources[s.key], 'library has the paper'); assert.ok('is_primary' in s && 'status' in s && 'correction_note' in s); }
  assert.deepEqual(seed.pristine.receptorSources[`d2|${d2.sources[0].key}`], { status: d2.sources[0].status, is_primary: d2.sources[0].is_primary, correction_note: d2.sources[0].correction_note });
  const db = fresh();
  const anyRow = db.prepare('SELECT * FROM sources LIMIT 1').get();
  assert.ok(seed.pristine.sources[sourceKey(anyRow)]);
});

test('review and volumes come through', () => {
  const db = fresh();
  db.prepare(`UPDATE review_state SET mechanism=1, note='n' WHERE receptor_id='d2'`).run();
  const seed = buildSeed({ baseState: exportState(db), commit: 'x' });
  const d2 = seed.receptors.find(r => r.id === 'd2');
  assert.deepEqual(d2.review, { mechanism: 1, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: 'n' });
  assert.deepEqual(d2.volumes, ['archive', 'cabinet', 'ledger']);
  assert.deepEqual(seed.pristine.review.d2, { mechanism: 0, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: '' });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/desk-seed.test.js` → FAIL, module not found.

- [ ] **Step 3: Write `scripts/desk-seed.mjs`**

```js
// Build desk/seed.json: what the Atlas currently is, for the editable surface, plus the
// pristine values that surface is a delta from, plus the edits file it was built from.
// Two in-memory databases, never db/atlas.db: one seeded exactly as the Actions runner
// does (migrate + import), one seeded with nothing imported.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { importState, readState, sourceKey } from './curator-state.mjs';
import { archiveNarrative, ledgerClinical } from '../lib/queries.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SEED_FILE = join(HERE, '..', 'desk', 'seed.json');
const SOURCE_COLS = ['kind', 'authors', 'year', 'title', 'journal', 'pmid', 'doi', 'url', 'notes'];
const ARCHIVE_COLS = ['abstract', 'presentation', 'effect', 'receptor_class', 'ligand', 'figure_caption', 'body_json', 'tags_json'];
const CLINICAL_COLS = ['sys', 'name', 'cls', 'baseline', 'mech', 'over_json', 'under_json', 'stahl', 'agonists_json', 'antagonists_json', 'onset', 'time_course', 'risk_factors_json', 'monitoring_json'];
const REVIEW_COLS = ['mechanism', 'affinity', 'clinical', 'citation', 'mastery', 'note'];
const pick = (row, cols) => Object.fromEntries(cols.map(c => [c, row[c] ?? null]));
const list = s => JSON.parse(s || '[]');

function freshDb(baseState) { const db = openDb(':memory:'); migrate(db); if (baseState) importState(db, baseState); return db; }

function receptorsOf(db) {
  const bySource = new Map(db.prepare('SELECT * FROM sources').all().map(s => [s.id, s]));
  const narrative = new Map(archiveNarrative(db).map(r => [r.receptor_id, r]));
  const clinical = new Map(ledgerClinical(db).map(r => [r.no, r]));
  const synd = new Map(db.prepare('SELECT no, onset, time_course, risk_factors_json, monitoring_json FROM clinical_rows').all().map(r => [r.no, r]));
  const clinicalNo = new Map(db.prepare('SELECT no, receptor_id FROM clinical_rows').all().map(r => [r.receptor_id, r.no]));
  const volumes = db.prepare('SELECT receptor_id, volume FROM receptor_volumes ORDER BY receptor_id, volume').all();
  const claims = new Map(db.prepare('SELECT receptor_id, text FROM claims').all().map(c => [c.receptor_id, c.text]));
  const reviews = new Map(db.prepare('SELECT * FROM review_state').all().map(r => [r.receptor_id, r]));
  const activity = db.prepare('SELECT receptor_id, volume, last_edited_at, last_reviewed_at FROM section_activity').all();
  const edges = db.prepare('SELECT * FROM receptor_sources ORDER BY rowid').all();
  return db.prepare('SELECT id, label, system, hall FROM receptors ORDER BY sort_order, id').all().map(r => {
    const n = narrative.get(r.id); const no = clinicalNo.get(r.id) ?? null; const c = no != null ? clinical.get(no) : null; const s = no != null ? synd.get(no) : null;
    const rv = reviews.get(r.id) || {};
    return {
      id: r.id, label: r.label, system: r.system, hall: r.hall,
      volumes: volumes.filter(v => v.receptor_id === r.id).map(v => v.volume),
      archiveAlias: n ? n.alias : null, clinicalNo: no,
      archive: n ? { abstract: n.abstract, presentation: n.presentation, effect: n.effect, receptor_class: n.receptor_class, ligand: n.ligand, figure_caption: n.figure_caption, body: n.body, tags: n.tags } : null,
      claim: claims.get(r.id) ?? null,
      clinical: c ? { no: c.no, sys: c.sys, name: c.name, cls: c.cls, baseline: c.baseline, mech: c.mech, stahl: c.stahl, over: c.over, under: c.under, agonists: c.agonists, antagonists: c.antagonists,
        onset: s.onset ?? null, time_course: s.time_course ?? null, risk_factors: list(s.risk_factors_json), monitoring: list(s.monitoring_json) } : null,
      sources: edges.filter(e => e.receptor_id === r.id).map(e => ({ key: sourceKey(bySource.get(e.source_id)), is_primary: e.is_primary ? 1 : 0, status: e.status, correction_note: e.correction_note ?? null })),
      review: { mechanism: rv.mechanism | 0, affinity: rv.affinity | 0, clinical: rv.clinical | 0, citation: rv.citation | 0, mastery: rv.mastery | 0, note: rv.note || '' },
      activity: activity.filter(a => a.receptor_id === r.id).map(a => ({ volume: a.volume, last_edited_at: a.last_edited_at, last_reviewed_at: a.last_reviewed_at })),
    };
  });
}

function pristineOf(db) {
  const bySource = new Map(db.prepare('SELECT * FROM sources').all().map(s => [s.id, s]));
  const archive = {}, clinical = {}, claims = {}, review = {}, receptorSources = {}, sources = {};
  for (const a of db.prepare('SELECT * FROM archive_entries').all()) archive[a.receptor_id] = pick(a, ARCHIVE_COLS);
  for (const c of db.prepare('SELECT * FROM clinical_rows').all()) clinical[c.no] = pick(c, CLINICAL_COLS);
  for (const c of db.prepare('SELECT * FROM claims').all()) claims[c.receptor_id] = c.text;
  for (const r of db.prepare('SELECT * FROM review_state').all()) review[r.receptor_id] = { mechanism: r.mechanism | 0, affinity: r.affinity | 0, clinical: r.clinical | 0, citation: r.citation | 0, mastery: r.mastery | 0, note: r.note || '' };
  for (const e of db.prepare('SELECT * FROM receptor_sources').all()) receptorSources[`${e.receptor_id}|${sourceKey(bySource.get(e.source_id))}`] = { status: e.status, is_primary: e.is_primary ? 1 : 0, correction_note: e.correction_note ?? null };
  for (const s of bySource.values()) sources[sourceKey(s)] = pick(s, SOURCE_COLS);
  return { archive, claims, clinical, review, receptorSources, sources };
}

export function buildSeed({ baseState, commit, builtAt = new Date().toISOString() }) {
  const current = freshDb(baseState), pristine = freshDb(null);
  const library = {};
  for (const s of current.prepare('SELECT * FROM sources').all()) library[sourceKey(s)] = pick(s, SOURCE_COLS);
  const seed = { format: 1, builtAt, commit, baseState, receptors: receptorsOf(current), pristine: pristineOf(pristine), sources: library };
  current.close(); pristine.close();
  return seed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseState = readState() || { format: 1, review: {}, activity: [], bindingReview: [], sources: [], receptorSources: [], bindingSources: [], content: { claims: {}, archive: {}, clinical: {}, bindings: [] } };
  let commit = 'uncommitted';
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: join(HERE, '..'), encoding: 'utf8' }).trim(); } catch {}
  const seed = buildSeed({ baseState, commit });
  writeFileSync(SEED_FILE, JSON.stringify(seed, null, 1) + '\n');
  console.log(`wrote desk/seed.json: ${seed.receptors.length} receptors, ${Object.keys(seed.sources).length} sources, from ${commit}`);
}
```

- [ ] **Step 4: Add the npm script and run**

`package.json` scripts: add `"desk:seed": "node scripts/desk-seed.mjs"`. Run `node --test test/desk-seed.test.js` → 3 pass; `npm run desk:seed` → writes the file; `git add -N desk/seed.json` so it is tracked.

- [ ] **Step 5: Commit**

```bash
git add scripts/desk-seed.mjs test/desk-seed.test.js package.json desk/seed.json
git commit -F - <<'EOF'
feat(desk): desk:seed builds the snapshot the Desk edits against, from memory only

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

---

### Task 4: `scripts/desk-pull.mjs` — changes → canonical edits file, with `--check`

**Goal:** `npm run desk:pull <changes.json>` turns a list of change objects into `db/curator-state.json` that is byte-identical to what the old Desk's `writeState` produces for the same state; `--check` refuses when the repo's edits file has moved since the seed, and shows the difference.

**Files:**
- Create: `scripts/desk-pull.mjs`
- Test: `test/desk-pull.test.js`
- Modify: `package.json` (add `"desk:pull": "node scripts/desk-pull.mjs"`)
- Modify: `docs/superpowers/specs/2026-09-26-hosted-desk-design.md` (one sentence, Step 5)

**Acceptance Criteria:**
- [ ] `canonicalise(state)` = import `state` into a fresh in-memory database, `exportState` it back; the result for a converter output equals what `exportState` gives for a database edited the same way by hand.
- [ ] `pull({ seed, changes, repoState })` returns `{ ok: true, state, summary }` when `repoState` deep-equals `seed.baseState`, and `{ ok: false, reason: 'seed moved', diff }` otherwise; `diff` lists the top-level keys that differ.
- [ ] The CLI writes `db/curator-state.json` with the same serialisation as `writeState` (`JSON.stringify(state, null, 1) + '\n'`) and prints the summary; with `--check` it writes nothing and exits 0 on ok, 2 on `seed moved`.

**Verify:** `node --test test/desk-pull.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing tests**

```js
// test/desk-pull.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { exportState, importState } from '../scripts/curator-state.mjs';
import { buildSeed } from '../scripts/desk-seed.mjs';
import * as core from '../desk/desk-core.mjs';
import { canonicalise, pull } from '../scripts/desk-pull.mjs';

const fresh = () => { const db = openDb(':memory:'); migrate(db); return db; };
const AT = '2026-09-26T13:00:00.000Z';

test('round trip: converter output, canonicalised, equals a hand-edited database export', () => {
  const seed = buildSeed({ baseState: exportState(fresh()), commit: 'x' });
  let c = core.emptyChanges('d2', 'x');
  c = core.setField(c, 'archive.abstract', 'Rewritten.', AT);
  c = core.setField(c, 'clinical.onset', 'days', AT);
  c = core.setReview(c, { mechanism: 1, note: 'ok' }, AT);
  const meta = { kind: 'article', authors: 'Kapur S', year: 2003, title: 'Aberrant salience', journal: 'Am J Psychiatry', pmid: '12505794', doi: null, url: null, notes: null };
  c = core.attachSource(c, seed, meta, { is_primary: 0 }, AT);
  const viaDesk = canonicalise(core.toCuratorState(seed, [c]));

  const byHand = fresh();
  byHand.prepare(`UPDATE archive_entries SET abstract='Rewritten.' WHERE receptor_id='d2'`).run();
  const no = byHand.prepare(`SELECT no FROM clinical_rows WHERE receptor_id='d2'`).get().no;
  byHand.prepare(`UPDATE clinical_rows SET onset='days' WHERE no=?`).run(no);
  byHand.prepare(`UPDATE review_state SET mechanism=1, note='ok' WHERE receptor_id='d2'`).run();
  const sid = byHand.prepare(`INSERT INTO sources (kind,authors,year,title,journal,pmid,doi,url,notes) VALUES (?,?,?,?,?,?,?,?,?)`).run('article', 'Kapur S', 2003, 'Aberrant salience', 'Am J Psychiatry', '12505794', null, null, null).lastInsertRowid;
  byHand.prepare(`INSERT INTO receptor_sources (receptor_id, source_id, status, is_primary, correction_note) VALUES ('d2', ?, 'verified', 0, NULL)`).run(sid);
  const expected = exportState(byHand);
  expected.activity = viaDesk.activity;   // timestamps are the Desk's; the hand edit has none
  assert.deepEqual(viaDesk, expected);
  assert.equal(JSON.stringify(viaDesk, null, 1), JSON.stringify(expected, null, 1), 'byte-identical after canonicalisation');
});

test('pull refuses when the repo edits file moved since the seed', () => {
  const base = exportState(fresh());
  const seed = buildSeed({ baseState: base, commit: 'x' });
  const c = core.setField(core.emptyChanges('d2', 'x'), 'claim', 'New claim', AT);
  const ok = pull({ seed, changes: [c], repoState: base });
  assert.equal(ok.ok, true); assert.equal(ok.state.content.claims.d2, 'New claim'); assert.equal(ok.summary, '1 content edit');
  const moved = { ...base, content: { ...base.content, claims: { sert: 'Someone edited this at the old Desk' } } };
  const no = pull({ seed, changes: [c], repoState: moved });
  assert.equal(no.ok, false); assert.equal(no.reason, 'seed moved'); assert.deepEqual(no.diff, ['content']);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/desk-pull.test.js` → FAIL, module not found.

- [ ] **Step 3: Write `scripts/desk-pull.mjs`**

```js
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
```

- [ ] **Step 4: Run tests; fix ordering mismatches in the core, not in the test**

Run: `node --test test/desk-pull.test.js`. If the first test's `deepEqual` fails on row order of `sources` or `receptorSources`, that is the point of `canonicalise`; if it fails on a field value, fix `toCuratorState`. Then `npm test` → `# fail 0`.

- [ ] **Step 5: Spec wording**

In `docs/superpowers/specs/2026-09-26-hosted-desk-design.md`, replace the sentence "so the two outputs are byte-identical by construction" with: "so the two outputs are the same edits; `desk:pull` canonicalises through a fresh database and is byte-identical to the old Desk's `writeState`, while the page's Download is a valid import that may order rows differently."

- [ ] **Step 6: Add the npm script and commit**

`package.json`: `"desk:pull": "node scripts/desk-pull.mjs"`.

```bash
git add scripts/desk-pull.mjs test/desk-pull.test.js package.json docs/superpowers/specs/2026-09-26-hosted-desk-design.md
git commit -F - <<'EOF'
feat(desk): desk:pull turns the page's changes into the canonical edits file

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

---

### Task 5: The page, part 1 — shell, storage, receptor picker, Ledger form, review marks, Download

**Goal:** `desk/desk.template.html` plus `scripts/desk-build.mjs` produce `desk/desk.html`, a page that loads the seed, lets the owner pick a receptor, edit every scalar and list field (Archive and Ledger) and the three review marks, persists changes (claude.ai `db` when present, else `localStorage`), shows the freshness banner, and downloads the edits file. No spans or source cards yet.

**Files:**
- Create: `desk/desk.template.html`
- Create: `scripts/desk-build.mjs`
- Modify: `package.json` (`"desk:build": "node scripts/desk-build.mjs"`)
- Test: `scripts/desk-walkthrough.mjs` (Playwright, dev-only; extended in Tasks 6 and 7)

**Acceptance Criteria:**
- [ ] `npm run desk:build` writes `desk/desk.html` with no external `<script src>` and no `fetch()`; the only external reference is the Google Fonts stylesheet for Inter.
- [ ] Opening `desk/desk.html` from disk in Chromium: the picker lists 24 receptors; selecting one shows its Archive fields and Ledger fields; typing into the abstract and reloading shows the typed text (localStorage).
- [ ] The banner reads `seed <builtAt date> · <n> unpublished · store: this browser` from disk, and `store: claude.ai` when `claude.use('db')` resolves.
- [ ] "Download edits file" produces `curator-state.json` whose parsed content equals `toCuratorState(seed, changes)`.
- [ ] Review marks toggle and persist; `citation`/`mastery` are not shown anywhere.

**Verify:** `npm run desk:build && node scripts/desk-walkthrough.mjs --mode local` → prints `PASS` lines for load, picker, edit-persist, download-equals-converter, review-persist

**Steps:**

- [ ] **Step 1: The template.** Write `desk/desk.template.html` with three placeholders the build replaces: `/*__CORE__*/`, `/*__SEED__*/`, `__BUILT_AT__`. Structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Receptor Atlas Desk</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;1,14..32,400&display=swap" rel="stylesheet">
<style>
/* Lifted from Provenance: the :root tokens, .hue, .btn/.field/.pill/.chip, .editor, .cite, .tag,
   .mcard, #flow, .pop, .srow, .toast, .modal — copy those blocks verbatim from
   /home/claude/atlas-ref/provenance.html lines 12–212, then add the Desk-only rules below. */
:root{ --bg:#FFFFFF; --paper:#FFFFFF; --paper-2:#F3F4F3; --ink:#000000; --ink-2:#3D444C; --ink-3:#7A828A; --line:#E3E5E7; --line-2:#EEF0F1;
  --ok:#2E7D5B; --bad:#B7472A; --warn:#B9831F; --info:#2F6F8F; --ok-soft:#E4F1EA; --bad-soft:#F7E6E0; --warn-soft:#F8EFDB; --info-soft:#E3EDF3;
  --hl:#FFF0A6; --sat:55%; --lum:36%; --bgsat:55%; --bglum:90%; --txtlum:22%;
  --sans:"Inter","Helvetica Neue",Arial,sans-serif; --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace; color-scheme: light only; }
html,body{ background:var(--bg); color:var(--ink); }   /* white/black holds whatever the device theme is */
/* … Provenance blocks here … */
/* Desk-only */
.top{ position:sticky; top:0; z-index:20; background:var(--bg); display:flex; align-items:center; gap:14px; padding:10px 20px; border-bottom:1px solid var(--line-2); flex-wrap:wrap }
.top select{ padding:4px 8px; border:1px solid var(--line); border-radius:7px; background:var(--paper); font-size:.92rem; max-width:60vw }
.banner{ font-size:.8rem; color:var(--ink-3) } .banner b{ color:var(--ink) } .banner .cloud{ color:var(--info) }
.main{ padding:30px 20px 140px } @media (min-width:1000px){ .main{ padding-left:clamp(40px,10vw,260px); padding-right:28px } }
.write{ position:relative } @media (min-width:1000px){ .write{ display:grid; grid-template-columns:minmax(0,36em) minmax(300px,360px); column-gap:clamp(40px,5vw,96px); align-items:start } }
.h-rx{ font-size:1.6rem; font-weight:600; margin:0 0 2px } .h-vol{ color:var(--ink-3); font-size:.8rem; margin-bottom:22px }
.fld{ margin:0 0 18px } .fld label{ display:block; font-size:.72rem; color:var(--ink-3); margin-bottom:4px; letter-spacing:.02em; text-transform:uppercase }
.fld [contenteditable]{ outline:0; min-height:1.4em } .fld [contenteditable]:focus{ box-shadow:inset 0 -1px 0 var(--ink-3) }
.fld.small [contenteditable]{ font-size:1rem }
.ledger{ margin-top:48px; padding-top:20px; border-top:1px solid var(--line) } .ledger h2{ font-size:1rem; font-weight:600; margin:0 0 14px }
.lgrid{ display:grid; grid-template-columns:1fr; gap:12px 18px } @media (min-width:760px){ .lgrid{ grid-template-columns:1fr 1fr } }
.lgrid textarea,.lgrid input{ width:100%; padding:7px 9px; border:1px solid var(--line); border-radius:7px; background:var(--paper); font:inherit; font-size:.92rem } .lgrid textarea{ min-height:64px; resize:vertical }
.review{ margin-top:40px; padding-top:16px; border-top:1px solid var(--line); display:flex; gap:18px; align-items:center; flex-wrap:wrap; font-size:.9rem }
.review label{ display:inline-flex; align-items:center; gap:6px } .review input[type=checkbox]{ width:16px; height:16px; accent-color:var(--ok) }
.review input[type=text]{ flex:1; min-width:200px; padding:6px 9px; border:1px solid var(--line); border-radius:7px }
.changed::before{ content:"●"; color:var(--warn); font-size:.6em; margin-right:6px; vertical-align:middle }
</style>
</head>
<body>
<div class="top">
  <select id="rx" aria-label="Receptor"></select>
  <span class="banner" id="banner"></span>
  <span class="grow" style="flex:1"></span>
  <button class="btn sm" id="dl" type="button">Download edits file</button>
</div>
<main class="main"><div class="write"><div id="editor"></div><aside class="margin" id="margin"></aside></div><svg id="flow" aria-hidden="true"></svg></main>
<div id="toastRoot"></div>
<script type="module">
/*__CORE__*/
const SEED = /*__SEED__*/;
const BUILT_AT = '__BUILT_AT__';
// ---------- storage: claude.ai db when it answers, else this browser ----------
const LS = 'atlas-desk-changes-v1';
const store = {
  mode: 'browser', db: null, all: {},          // all: receptorId -> changes
  async init() {
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        const db = await Promise.race([window.claude.use('db'), new Promise(r => setTimeout(() => r(null), 8000))]);
        if (db) { this.db = db; this.mode = 'claude.ai'; const snap = await db.collection('changes').get(); (snap.docs || []).forEach(d => { const data = typeof d.data === 'function' ? d.data() : d.data; if (data) this.all[d.id] = data; }); return; }
      }
    } catch (e) { /* fall through to the browser */ }
    try { const raw = localStorage.getItem(LS); if (raw) this.all = JSON.parse(raw); } catch (e) {}
  },
  get(id) { return this.all[id] || emptyChanges(id, SEED.commit); },
  put(changes) {
    this.all[changes.receptorId] = changes;
    if (this.db) { this.db.doc('changes/' + changes.receptorId).set(JSON.parse(JSON.stringify(changes))).catch(e => toast('Save failed (' + ((e && e.code) || 'unknown') + ').')); }
    else { try { localStorage.setItem(LS, JSON.stringify(this.all)); } catch (e) { toast('This browser refused to store the change.'); } }
  },
  list() { return Object.values(this.all); },
};
// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => new Date().toISOString();
let toastT = null; function toast(msg, ms) { const r = $('#toastRoot'); r.innerHTML = '<div class="toast">' + esc(msg) + '</div>'; clearTimeout(toastT); toastT = setTimeout(() => { r.innerHTML = ''; }, ms || 2600); }
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
let current = SEED.receptors[0].id;
const rx = () => SEED.receptors.find(r => r.id === current);
const view = () => viewOf(rx(), store.get(current));
function commit(mut) { store.put(mut(store.get(current))); renderBanner(); }
// ---------- banner + picker ----------
function renderBanner() {
  const all = store.list(); const unpub = countUnpublished(all);
  const published = all.reduce((n, c) => n + Object.values(c.fields).filter(f => f.publishedAs).length + c.sources.add.filter(a => a.publishedAs).length, 0);
  $('#banner').innerHTML = `seed <b>${esc(SEED.builtAt.slice(0, 10))}</b> · ${published} published since · <b>${unpub} unpublished</b> · <span class="${store.mode === 'claude.ai' ? 'cloud' : ''}">store: ${esc(store.mode)}</span>`;
  const sel = $('#rx'); for (const o of sel.options) { const c = store.all[o.value]; o.textContent = (c && countUnpublished([c]) ? '● ' : '') + SEED.receptors.find(r => r.id === o.value).label; }
}
function renderPicker() { $('#rx').innerHTML = SEED.receptors.map(r => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join(''); $('#rx').value = current; $('#rx').onchange = () => { current = $('#rx').value; render(); }; }
// ---------- editor ----------
const ARCHIVE_LABELS = { abstract: 'Abstract', presentation: 'Presentation', effect: 'Effect', receptor_class: 'Receptor class', ligand: 'Ligand', figure_caption: 'Figure caption' };
function fieldHTML(path, label, value, big) {
  const changed = store.get(current).fields[path] ? ' changed' : '';
  return `<div class="fld${big ? '' : ' small'}"><label class="${changed}">${esc(label)}</label><div class="editor" contenteditable="plaintext-only" data-path="${path}">${esc(value ?? '')}</div></div>`;
}
function listHTML(path, label, items) {
  const changed = store.get(current).fields[path] ? ' changed' : '';
  return `<div class="fld"><label class="${changed}">${esc(label)} · one per line</label><textarea data-list="${path}" rows="${Math.max(3, items.length + 1)}">${esc(items.join('\n'))}</textarea></div>`;
}
function render() {
  const v = view(); const ed = $('#editor');
  let html = `<div class="h-rx">${esc(v.label)}</div><div class="h-vol">${esc(v.volumes.join(' · '))}</div>`;
  if (v.archive) {
    html += fieldHTML('archive.abstract', 'Abstract', v.archive.abstract, true);
    html += `<div class="fld"><label class="${store.get(current).fields['archive.body'] ? 'changed' : ''}">Body</label><div class="editor" id="body" contenteditable="plaintext-only" data-paragraphs="archive.body">${v.archive.body.map(p => `<p>${esc(p)}</p>`).join('')}</div></div>`;
    for (const k of ['presentation', 'effect', 'receptor_class', 'ligand', 'figure_caption']) html += fieldHTML('archive.' + k, ARCHIVE_LABELS[k], v.archive[k], false);
    html += listHTML('archive.tags', 'Tags', v.archive.tags);
  }
  if (v.volumes.includes('cabinet')) html += fieldHTML('claim', 'Cabinet claim', v.claim, false);
  if (v.clinical) {
    html += `<section class="ledger"><h2>Ledger · Volume III</h2><div class="lgrid">`;
    for (const k of ['sys', 'name', 'cls', 'baseline', 'mech', 'stahl', 'onset', 'time_course']) html += `<div><label class="${store.get(current).fields['clinical.' + k] ? 'changed' : ''}">${esc(k.replace('_', ' '))}</label><textarea data-scalar="clinical.${k}" rows="2">${esc(v.clinical[k] ?? '')}</textarea></div>`;
    for (const k of ['over', 'under', 'agonists', 'antagonists', 'risk_factors', 'monitoring']) html += `<div>${listHTML('clinical.' + k, k.replace('_', ' '), v.clinical[k] || [])}</div>`;
    html += `</div></section>`;
  }
  const r = v.review;
  html += `<section class="review"><span class="tiny">reviewed:</span>` + REVIEW_MARKS.map(m => `<label><input type="checkbox" data-mark="${m}" ${r[m] ? 'checked' : ''}> ${m}</label>`).join('') + `<input type="text" data-note placeholder="note" value="${esc(r.note || '')}"></section>`;
  ed.innerHTML = html;
  // wiring
  ed.querySelectorAll('[data-path]').forEach(el => el.addEventListener('input', debounce(() => commit(c => setField(c, el.dataset.path, el.innerText, now())), 300)));
  const body = ed.querySelector('[data-paragraphs]');
  if (body) body.addEventListener('input', debounce(() => commit(c => setField(c, 'archive.body', [...body.querySelectorAll('p')].map(p => p.innerText).filter(t => t.trim()), now())), 300));
  ed.querySelectorAll('[data-scalar]').forEach(el => el.addEventListener('input', debounce(() => commit(c => setField(c, el.dataset.scalar, el.value, now())), 300)));
  ed.querySelectorAll('[data-list]').forEach(el => el.addEventListener('input', debounce(() => commit(c => setField(c, el.dataset.list, el.value.split('\n').map(s => s.trim()).filter(Boolean), now())), 300)));
  ed.querySelectorAll('[data-mark]').forEach(el => el.addEventListener('change', () => commit(c => setReview(c, { ...marksNow(), [el.dataset.mark]: el.checked ? 1 : 0 }, now()))));
  ed.querySelector('[data-note]').addEventListener('input', debounce(() => commit(c => setReview(c, { ...marksNow(), note: ed.querySelector('[data-note]').value }, now())), 300));
  renderMargin();   // Task 6 fills this in; a no-op until then
  renderBanner();
}
function marksNow() { const r = view().review; return { mechanism: r.mechanism | 0, affinity: r.affinity | 0, clinical: r.clinical | 0, note: r.note || '' }; }
function renderMargin() { /* Task 6 */ }
// ---------- download ----------
$('#dl').addEventListener('click', async () => {
  const text = JSON.stringify(toCuratorState(SEED, store.list()), null, 1) + '\n';
  try { if (window.claude && typeof window.claude.use === 'function') { const dl = await window.claude.use('downloads'); if (dl) { await dl.save({ filename: 'curator-state.json', data: text }); return; } } } catch (e) { /* fall through */ }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = 'curator-state.json'; a.click();
});
// expose for the walkthrough
window.__desk = { SEED, store, toCuratorState, view: () => view() };
// ---------- boot ----------
await store.init(); renderPicker(); render();
</script>
</body>
</html>
```

`emptyChanges`, `setField`, `setReview`, `viewOf`, `countUnpublished`, `toCuratorState`, `REVIEW_MARKS` come from the inlined core (`/*__CORE__*/` is the core file's text with its `export` keywords stripped; see the build).

- [ ] **Step 2: The build script**

```js
// scripts/desk-build.mjs — one file out: desk/desk.html = template + core + seed.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const DESK = join(HERE, '..', 'desk');
const core = readFileSync(join(DESK, 'desk-core.mjs'), 'utf8').replace(/^export (const|function) /gm, '$1 ');
const seedText = readFileSync(join(DESK, 'seed.json'), 'utf8').trim();
if (/<\/script/i.test(seedText)) throw new Error('seed.json contains </script>; refusing to inline');
const tpl = readFileSync(join(DESK, 'desk.template.html'), 'utf8');
for (const ph of ['/*__CORE__*/', '/*__SEED__*/', '__BUILT_AT__']) if (!tpl.includes(ph)) throw new Error(`template lacks ${ph}`);
const out = tpl.replace('/*__CORE__*/', () => core).replace('/*__SEED__*/', () => seedText).replace('__BUILT_AT__', new Date().toISOString());
writeFileSync(join(DESK, 'desk.html'), out);
console.log(`wrote desk/desk.html: ${(out.length / 1024).toFixed(0)} KB`);
```

Use function replacers (`() => core`) so `$&`/`$1` inside the core or seed text are not interpreted.

- [ ] **Step 3: The walkthrough script (dev-only, Playwright from the global install)**

```js
// scripts/desk-walkthrough.mjs — drives desk/desk.html as a tester would. Not part of
// npm test (needs Chromium). Usage: node scripts/desk-walkthrough.mjs --mode local
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import * as core from '../desk/desk-core.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(join(HERE, '..', 'desk', 'desk.html')).href;
const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) process.exitCode = 1; };
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext(); const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(PAGE); await page.waitForFunction(() => window.__desk);
ok('load without errors', errors.length === 0, errors.join(' | '));
ok('picker lists 24 receptors', await page.locator('#rx option').count() === 24);
ok('banner names the browser store', /store: this browser|store: browser/.test(await page.locator('#banner').innerText()));
await page.selectOption('#rx', 'd2');
await page.locator('[data-path="archive.abstract"]').fill('Walkthrough abstract.');
await page.waitForTimeout(500);
await page.reload(); await page.waitForFunction(() => window.__desk); await page.selectOption('#rx', 'd2');
ok('abstract edit persists across reload', (await page.locator('[data-path="archive.abstract"]').innerText()) === 'Walkthrough abstract.');
await page.locator('[data-mark="mechanism"]').check(); await page.waitForTimeout(300);
await page.reload(); await page.waitForFunction(() => window.__desk); await page.selectOption('#rx', 'd2');
ok('review mark persists', await page.locator('[data-mark="mechanism"]').isChecked());
ok('citation and mastery are not shown', (await page.locator('[data-mark="citation"], [data-mark="mastery"]').count()) === 0);
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
const got = JSON.parse(readFileSync(await download.path(), 'utf8'));
const expected = await page.evaluate(() => window.__desk.toCuratorState(window.__desk.SEED, window.__desk.store.list()));
ok('download equals the converter', JSON.stringify(got) === JSON.stringify(expected));
ok('download carries the edit', got.content.archive.d2 && got.content.archive.d2.abstract === 'Walkthrough abstract.');
await browser.close();
```

- [ ] **Step 4: Build and run**

`npm run desk:build && node scripts/desk-walkthrough.mjs --mode local` → all PASS. If Playwright is not resolvable, run with `NODE_PATH=$(npm root -g)`.

- [ ] **Step 5: Commit**

```bash
git add desk/desk.template.html desk/desk.html scripts/desk-build.mjs scripts/desk-walkthrough.mjs package.json
git commit -F - <<'EOF'
feat(desk): the hosted Desk page: fields, Ledger form, review marks, storage, download

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

---

### Task 6: The page, part 2 — spans, margin cards, flow lines, adding sources

**Goal:** Selecting text in the abstract or body and choosing a source draws a bracketed span in that source's colour; each attached source has a margin card joined to its spans by flow lines; a card opens on selecting its bracket and exposes primary, "conflicts with the text" + note, and detach (change-added sources only); sources can be added by PMID/DOI through the PubMed connector when present, or by hand.

**Files:**
- Modify: `desk/desk.template.html`
- Modify: `scripts/desk-walkthrough.mjs`

**Acceptance Criteria:**
- [ ] Spans are stored as `{ field, start, end, text, sourceKey, at }` in `changes.spans` and re-drawn on load from stored offsets; a span whose `text` no longer matches the field at `[start,end)` is dropped with a toast ("1 span no longer matches the text and was removed").
- [ ] Flow lines are one `<path>` per span in `#flow`, recomputed on render, resize and scroll, using the same hue as the span (`--h` from `HUES[index % 12]`, index = order of first appearance in `seed.sources` keys then `changes.library`).
- [ ] A seeded source's card has no Detach control; a change-added one does. "Conflicts with the text" checked reveals the correction note field; unchecking clears it.
- [ ] "Add source" with `12505794` when `claude.use('mcp')` resolves calls `PubMed.get_article_metadata` (via the lifted `fetchArticle`) and attaches the normalised paper; without `mcp`, the same button opens the by-hand form (title, authors, year, journal, PMID, DOI, URL).
- [ ] Walkthrough: `node scripts/desk-walkthrough.mjs --mode local` additionally PASSes: attach by hand, span drawn, card count, conflict flag round-trips through Download (`status: 'conflicting'`).

**Verify:** `npm run desk:build && node scripts/desk-walkthrough.mjs --mode local` → all PASS

**Steps:**

- [ ] **Step 1: Lift from Provenance** (`/home/claude/atlas-ref/provenance.html`): CSS blocks `.cite`, `.tag`, `.mcard`, `#flow`, `.pop`, `.gdot`, `.slist`; JS functions `parsePayload`, `normalizeArticle`, `mcpErrorText`, `callPubMed`, `fetchArticle` (lines 417–421) verbatim, with `caps.mcp` replaced by a module-level `let mcp = null` resolved once in boot: `try { if (window.claude?.use) mcp = await window.claude.use('mcp'); } catch { mcp = null; }`. `HUES` array and `hueOf` come from Provenance line ~370 (`const HUES=[165,275,20,330,210,95,45,250,190,350,130,300]`).

- [ ] **Step 2: Span model in the page** (add to the module script):

```js
const hueIndex = key => { const keys = [...Object.keys(SEED.sources), ...Object.keys(store.get(current).library).filter(k => !SEED.sources[k])]; return Math.max(0, keys.indexOf(key)); };
const hueOf = key => HUES[hueIndex(key) % HUES.length];
function spansFor(field) { return store.get(current).spans.filter(s => s.field === field); }
/** Draw the field's text with bracketed spans. Offsets are into the plain text of the field. */
function spanHTML(field, text) {
  const spans = spansFor(field).filter(s => text.slice(s.start, s.end) === s.text).sort((a, b) => a.start - b.start);
  let out = '', i = 0;
  for (const s of spans) { if (s.start < i) continue; out += esc(text.slice(i, s.start)); out += `<span class="cite hue" style="--h:${hueOf(s.sourceKey)}" data-span="${esc(s.sourceKey)}|${s.start}">${esc(text.slice(s.start, s.end))}</span>`; i = s.end; }
  return out + esc(text.slice(i));
}
function dropStaleSpans() {
  const v = view(); const c = store.get(current); const before = c.spans.length;
  const textOf = f => f === 'archive.abstract' ? v.archive.abstract || '' : f.startsWith('archive.body.') ? (v.archive.body[Number(f.split('.')[2])] || '') : '';
  const kept = c.spans.filter(s => textOf(s.field).slice(s.start, s.end) === s.text);
  if (kept.length !== before) { store.put({ ...c, spans: kept }); toast(`${before - kept.length} span${before - kept.length === 1 ? '' : 's'} no longer match the text and were removed`, 4000); }
}
function selectionOffsets(el) {
  const sel = window.getSelection(); if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0); if (!el.contains(range.commonAncestorContainer)) return null;
  const pre = range.cloneRange(); pre.selectNodeContents(el); pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length, end = start + range.toString().length;
  return end > start ? { start, end, text: el.innerText.slice(start, end) } : null;
}
```

Body paragraphs are addressed as `archive.body.<n>`; the body editor renders one `<p data-field="archive.body.n">` per paragraph, each with `spanHTML`. Editing a paragraph re-runs `setField('archive.body', …)` as in Task 5, then `dropStaleSpans()`.

- [ ] **Step 3: Attach popover.** On `mouseup`/`keyup` inside a spannable field, if `selectionOffsets` returns a range, show a `.pop` anchored at the selection with one `.chip.hue` per attached source (`view().sources`) plus `+ add source`. Clicking a chip:

```js
commit(c => ({ ...c, spans: [...c.spans, { field, start, end, text, sourceKey: key, at: now() }] })); render();
```

Clicking `+ add source` opens the modal (Provenance `.modal` markup): an input "PMID or DOI" with a Look up button when `mcp` is present, and always the by-hand fields. Look up → `fetchArticle(id)` → `meta = { kind:'article', authors: a.authors.map(x => x.last + (x.initials ? ' ' + x.initials : '')).join(', '), year: Number(a.year) || null, title: a.title, journal: a.journal, pmid: a.pmid || null, doi: a.doi || null, url: null, notes: null }` → `commit(c => attachSource(c, SEED, meta, { is_primary: 0 }, now()))`; on error `toast(mcpErrorText(e))`. By hand → same `meta` from the fields; `kind` is `'book'` when the PMID and DOI are empty and the journal is empty.

- [ ] **Step 4: Margin cards + flow lines.** `renderMargin()` builds one `.mcard.hue` per `view().sources` entry (label = first author surname + year from `SEED.sources[key] || changes.library[key]`; citation title; PMID/DOI; `attached` date for change-added ones; primary toggle; `conflicts with the text` checkbox; correction note textarea shown when checked; span count; Detach button only when `added`). Card handlers call `setSourceFlags(c, SEED, key, {...}, now())` / `detachSource(c, SEED, key, now())` inside `commit`, then `render()`. A card gets `.open` when a `.cite[data-span]` for its key is clicked; other cards `.dim`. `drawFlow()`: for each `.cite[data-span]` element, one `<path>` from its right edge midpoint to the card's left edge midpoint, cubic bezier with control points at ±60px x, `stroke = hsl(h 55% 36%)`; call on render, `resize`, and `scroll` (throttled with `requestAnimationFrame`).

- [ ] **Step 5: Extend the walkthrough** (append before `browser.close()`):

```js
// attach by hand, then span, then conflict
await page.selectOption('#rx', 'd2');
const abstractEl = page.locator('[data-path="archive.abstract"]');
await abstractEl.evaluate(el => { const r = document.createRange(); r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 11); const s = getSelection(); s.removeAllRanges(); s.addRange(r); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
await page.click('text=+ add source');
await page.fill('[name=title]', 'Walkthrough paper'); await page.fill('[name=authors]', 'Tester T'); await page.fill('[name=year]', '2026'); await page.fill('[name=journal]', 'J Test'); await page.fill('[name=pmid]', '999999');
await page.click('text=Attach'); await page.waitForTimeout(300);
ok('span drawn in the abstract', (await page.locator('[data-path="archive.abstract"] .cite').count()) === 1);
ok('one card per attached source', (await page.locator('#margin .mcard').count()) === (await page.evaluate(() => window.__desk.view().sources.length)));
ok('a flow line per span', (await page.locator('#flow path').count()) >= 1);
await page.locator('#margin .mcard[data-key="pmid:999999"] [data-flag="conflicting"]').check();
await page.fill('#margin .mcard[data-key="pmid:999999"] textarea', 'disagrees on onset'); await page.waitForTimeout(400);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
const got2 = JSON.parse(readFileSync(await dl2.path(), 'utf8'));
const edge = got2.receptorSources.find(e => e.receptor_id === 'd2' && e.source === 'pmid:999999');
ok('conflict flag reaches the edits file', edge && edge.status === 'conflicting' && edge.correction_note === 'disagrees on onset');
ok('seeded sources have no detach control', (await page.locator('#margin .mcard:not([data-added]) [data-detach]').count()) === 0);
```

Give cards `data-key` and `data-added` attributes and the checkbox `data-flag="conflicting"`, the detach button `data-detach`, the by-hand inputs `name=` attributes as used above, and the modal buttons the literal texts `+ add source` and `Attach`.

- [ ] **Step 6: Build, run, commit**

`npm run desk:build && node scripts/desk-walkthrough.mjs --mode local` → all PASS.

```bash
git add desk/desk.template.html desk/desk.html scripts/desk-walkthrough.mjs
git commit -F - <<'EOF'
feat(desk): spans, margin cards and flow lines; sources by PubMed or by hand

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

---

### Task 7: Serve the fallback at `/desk/` and document the Desk

**Goal:** The snapshot carries `desk/desk.html` as `dist/desk/index.html`, unlinked; README and CHANGELOG describe the hosted Desk and its two modes.

**Files:**
- Modify: `scripts/publish.js` (after the standalone pages are copied)
- Modify: `test/publish.test.js`
- Modify: `README.md`, `CHANGELOG.md`

**Acceptance Criteria:**
- [ ] `npm run snapshot` produces `dist/desk/index.html` identical to `desk/desk.html`; no page in `dist/` links to it.
- [ ] `test/publish.test.js` has a test `the hosted Desk ships at /desk/, unlinked` that passes.
- [ ] README gains a section "The hosted Desk" (below "Run it") stating: the artifact is the normal place to edit; the same file is at `/desk/` and on disk as fallback; `npm run desk:seed && npm run desk:build` regenerates it; `npm run desk:pull changes.json` publishes; the one-editor rule; the multi-author note.
- [ ] CHANGELOG `[Unreleased]` → `### Added` describes the Desk in the file's voice (for the curator, not the committer).

**Verify:** `npm test` → `# fail 0` and `npm run snapshot && cmp desk/desk.html dist/desk/index.html && ! grep -l 'desk/' dist/*.html`

**Steps:**

- [ ] **Step 1: Failing test** (append to `test/publish.test.js`, using that file's existing `outDir`/`publish` fixture):

```js
test('the hosted Desk ships at /desk/, unlinked', async () => {
  const html = await readFile(join(outDir, 'desk', 'index.html'), 'utf8');
  assert.equal(html, await readFile(new URL('../desk/desk.html', import.meta.url), 'utf8'));
  for (const page of await readdir(outDir)) if (page.endsWith('.html')) assert.doesNotMatch(await readFile(join(outDir, page), 'utf8'), /desk\//, `${page} links to the Desk`);
});
```

- [ ] **Step 2: In `scripts/publish.js`**, after the standalone pages copy (line ~130):

```js
  // The hosted Desk's fallback: the same single file the artifact publishes, reachable
  // without claude.ai. Deliberately unlinked from every page; it writes nothing.
  await mkdir(join(outDir, 'desk'), { recursive: true });
  await copyFile(join(HERE, '..', 'desk', 'desk.html'), join(outDir, 'desk', 'index.html'));
```

- [ ] **Step 3: README section and CHANGELOG entry**, then run `npm test`.

- [ ] **Step 4: Commit**

```bash
git add scripts/publish.js test/publish.test.js README.md CHANGELOG.md
git commit -F - <<'EOF'
feat(desk): the Desk ships unlinked at /desk/; README and CHANGELOG describe it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

---

### Task 8: Publish the artifact and run the cloud-mode check

**Goal:** `desk/desk.html` is published as a private artifact with `db`, `mcp` (PubMed) and `downloads`; one edit made in the live page is read back from the store with `ArtifactData` and converted by `desk:pull`.

**Files:**
- None in the repo. Operational: the Artifact tool, `ArtifactData`.

**Acceptance Criteria:**
- [ ] Artifact published from `desk/desk.html` with `capabilities: { db: {}, mcp: { servers: [{ server: 'PubMed', tools: ['get_article_metadata', 'search_articles'] }] }, downloads: true }`, icon `desk`, title from the page (`Receptor Atlas Desk`).
- [ ] `ArtifactData list changes` on the new artifact returns the documents the page wrote after the owner (or the coordinator, as owner) makes one edit; the banner in the page reads `store: claude.ai`.
- [ ] `node scripts/desk-pull.mjs --check /tmp/changes.json` on that listing prints `ok: 1 content edit`.
- [ ] The artifact URL is recorded in `README.md` under "The hosted Desk" (one line) and committed.

**Verify:** the `ArtifactData` listing shows ≥1 document under `changes`; `desk:pull --check` exits 0.

**Steps:**

- [ ] **Step 1:** Publish with the Artifact tool (`file_path: desk/desk.html`, the capabilities above, `description: "Edit the Receptor Atlas's Archive prose, sources and Ledger rows; publishes through the edits file in the repo."`).
- [ ] **Step 2:** Open it, make one edit as the owner (or have the owner do it), then `ArtifactData` `list` collection `changes`; save the documents as a JSON array to `/tmp/changes.json`.
- [ ] **Step 3:** `node scripts/desk-pull.mjs --check /tmp/changes.json` → `ok: …`.
- [ ] **Step 4:** Add the artifact link line to README, commit:

```bash
git add README.md
git commit -F - <<'EOF'
docs(desk): where the hosted Desk lives

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XM1BamaSyt6GbKbiB4Lq2n
EOF
```

---

### Task 9: Move the commits to the owner's machine, push, confirm the site

**Goal:** Every commit from Tasks 1–8 is on `origin/main`, GitHub Actions is green, `/desk/` serves the page, and the owner's working copy matches.

**Files:**
- None new. Operational.

**Acceptance Criteria:**
- [ ] `git format-patch origin/main` in the cloud clone produces N patches; `device_commit_files` places them under `O:\Receptor Museum\atlas-app\.patches\`; on the host `git am .patches\*.patch` applies cleanly; `git push origin main`; `.patches\` removed.
- [ ] `gh run list --limit 1` on the host shows the Pages workflow `completed success` for the pushed commit.
- [ ] `https://fresco-esio.github.io/receptor-atlas/desk/` returns 200 and contains `Receptor Atlas Desk`.
- [ ] `npm test` on the host → `fail 0`.

**Verify:** the three checks above, run from the host with Desktop Commander.

**Steps:**

- [ ] **Step 1:** `cd /home/claude/atlas && git format-patch origin/main -o /mnt/user-data/outputs/patches/` then `device_commit_files` each patch to `O:\Receptor Museum\atlas-app\.patches\`.
- [ ] **Step 2:** On the host: `git am .patches\*.patch`, `git push origin main`, `Remove-Item -Recurse .patches`, `npm test`.
- [ ] **Step 3:** Wait for Actions; `Invoke-WebRequest https://fresco-esio.github.io/receptor-atlas/desk/` → 200.

---

## Self-review

**Spec coverage.** Section 1 (seed, changes, converter, build) → Tasks 2, 3, 5. Section 2 (screen) → Tasks 5, 6. Section 3 (publish steps, stale-seed check, mark-not-clear, re-seed on request) → Task 4 (`--check`, `pull`), Task 2 (`markPublished`, `rekey`), Task 8 (the live loop). Section 4 (two modes, `/desk/`, tests) → Tasks 5, 6, 7. Prerequisites → Task 1. Out-of-scope items are not planned, by design. **"Re-seed the desk"** is an operational sequence (`desk:seed`, `desk:build`, republish, `rekey` every stored change via `ArtifactData`) documented in the README in Task 7; no code beyond `rekey`.

**Placeholders.** None: every code step is complete; the two "lift from Provenance" steps name the exact functions and line ranges in a file present in this environment.

**Type consistency.** `emptyChanges(receptorId, seedCommit)`, `setField(changes, path, value, at)`, `attachSource(changes, seed, meta, flags, at)`, `detachSource(changes, seed, key, at)`, `setSourceFlags(changes, seed, key, flags, at)`, `setReview(changes, marks, at)`, `viewOf(seedReceptor, changes)`, `toCuratorState(seed, changesList)`, `summarise(changesList)`, `markPublished(changes, sha)`, `rekey(changes, newSeed)`, `countUnpublished(changesList)` are used with these signatures in Tasks 2, 4, 5, 6. `buildSeed({ baseState, commit, builtAt })` in Tasks 3, 4. `canonicalise(state)`, `pull({ seed, changes, repoState })` in Task 4. Seed fields `receptors[].clinicalNo`, `archiveAlias`, `volumes`, `pristine.*`, `baseState`, `sources` are the same in Tasks 2, 3, 5.
