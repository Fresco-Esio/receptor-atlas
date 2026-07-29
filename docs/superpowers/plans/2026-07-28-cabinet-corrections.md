# Receptor Cabinet Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the false, stale, and misleading statements a six-reviewer audit found in the Binding Affinity Plate, fix two sourcing-policy defects that bias the numbers, and close the usability gaps that make the plate hard to read or easy to misread.

**Architecture:** Three layers, in dependency order. (1) The **sourcing pipeline** (`scripts/sourcing/`) computes every number and splices it into the dashboard literal; changing policy here requires a rebuild and a database reseed. (2) The **database** (`db/schema.sql`, `scripts/migrate-structured.js`) stores those numbers; the page replaces its embedded snapshot with the DB feed on load, so anything the DB cannot hold never reaches the screen. (3) The **page** (`public/neuroreceptor_pharmacology_explorer_dashboard.html`) renders the rose and matrix and carries all user-facing copy. Copy fixes touch layer 3 only; policy fixes touch all three.

**Tech Stack:** Node 24 (ESM), `node:test`, better-sqlite3, Python 3 + openpyxl (XLSX import only), vanilla DOM/SVG in a single self-contained HTML file. No build step, no framework.

---

## Context an engineer needs before starting

**Run the app:** `npm start` serves on port 3000; the project's launch config uses 3100. The plate lives under the **Catalogue** view (segmented control, top right).

**The rebuild path is destructive.** Migrations are seed-only, so `npm run migrate` against a populated `db/atlas.db` is a no-op. To load new numbers you must delete the DB. Doing so re-seeds everything *except* `section_activity`, which is genuine user state that nothing regenerates. Task 1 builds the helper that protects it; Tasks 3 and 4 use it.

**Stop the server before any rebuild.** A running server holds `db/atlas.db` open and `rm` fails with "Device or resource busy".

**Line numbers drift.** Every task below anchors edits on unique text, not line numbers. If an anchor does not match, re-grep for it rather than guessing.

**Verify commands assume repo root:** `O:\Receptor Museum\atlas-app`.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `scripts/preserve-activity.mjs` | **New.** Save/restore `section_activity` around a DB rebuild | 1 |
| `test/preserve-activity.test.js` | **New.** Proves the round trip | 1 |
| `test/plate-copy.test.js` | **New.** Pins user-facing copy to the data it describes | 2, 6 |
| `public/neuroreceptor_pharmacology_explorer_dashboard.html` | The plate: copy, CSS, rose + matrix rendering | 2, 5, 6, 7, 8, 9 |
| `DESIGN.md`, `scripts/sourcing/README.md`, `scripts/sourcing/config.mjs` | Docs and comments carrying the stale "13 targets" claim | 2 |
| `scripts/sourcing/config.mjs` | Sourcing policy: subtype margin, assay-type filter | 3, 4 |
| `scripts/sourcing/3-build.mjs` | Aggregation and literal emission | 3, 4 |
| `test/binding-dispersion.test.js` | **Existing.** Extend for subtype margin and assay filter | 3, 4 |

---

### Task 1: Preserve `section_activity` across a database rebuild

**Goal:** A committed script that saves and restores the one table a rebuild destroys, so Tasks 3 and 4 cannot silently lose user data.

**Files:**
- Create: `scripts/preserve-activity.mjs`
- Test: `test/preserve-activity.test.js`

**Acceptance Criteria:**
- [ ] `node scripts/preserve-activity.mjs save` writes every `section_activity` row to `db/.section-activity.bak.json`
- [ ] `node scripts/preserve-activity.mjs restore` re-inserts them idempotently
- [ ] Restoring when the backup file is absent exits 0 with a message, not a crash
- [ ] Round trip preserves `receptor_id`, `volume`, `last_edited_at`, `last_reviewed_at`

**Verify:** `node --test test/preserve-activity.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/preserve-activity.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/preserve-activity.test.js`
Expected: FAIL — `Cannot find module '../scripts/preserve-activity.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/preserve-activity.mjs`:

```js
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
import { fileURLToPath } from 'node:url';
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/preserve-activity.test.js`
Expected: PASS, 2/2

- [ ] **Step 5: Ignore the backup artifact**

Append to `.gitignore`:

```
db/.section-activity.bak.json
```

- [ ] **Step 6: Commit**

```bash
git add scripts/preserve-activity.mjs test/preserve-activity.test.js .gitignore
git commit -m "feat(db): preserve section_activity across destructive rebuilds"
```

---

### Task 2: Correct false and stale statements in shipped copy

**Goal:** The page stops claiming a statistic the code does not compute, a target count that is wrong in five places, and drug examples that were removed from the atlas.

**Files:**
- Create: `test/plate-copy.test.js`
- Modify: `public/neuroreceptor_pharmacology_explorer_dashboard.html` (footer, plate subtitle, rose caption, two `.concept-eg` paragraphs)
- Modify: `DESIGN.md`, `scripts/sourcing/README.md`, `scripts/sourcing/config.mjs`

**Acceptance Criteria:**
- [ ] No occurrence of "geometric mean" anywhere in the dashboard
- [ ] No copy names a target count other than `AFF_TARGETS.length` (currently 16)
- [ ] No `.concept-eg` example cites a drug absent from `AFF_AGENTS`
- [ ] `npm test` stays green

**Verify:** `node --test test/plate-copy.test.js` → 3 tests pass, then `npm test` → 0 failures

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/plate-copy.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TARGETS, DASHBOARD } from '../scripts/sourcing/config.mjs';

const html = readFileSync(DASHBOARD, 'utf8');

// Drugs removed from AFF_AGENTS during the 2026-07 clinical re-scope. The primer's
// "Examples here:" lines promise the reader they can go find these on the plate.
const REMOVED_FROM_ROSTER = [
  'fentanyl', 'dobutamine', 'flumazenil', 'metoprolol', 'atenolol', 'atropine',
  'doxazosin', 'phenobarbital', 'amantadine', 'oxybutynin', 'glycopyrrolate',
];

test('the methodology statement names the statistic the pipeline actually computes', () => {
  assert.ok(!/geometric mean/i.test(html),
    'copy claims geometric means; 3-build.mjs computes a median of pKi');
  assert.match(html, /median of all human values/i);
});

test('no copy claims a target count that disagrees with AFF_TARGETS', () => {
  const words = {
    12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen',
    16: 'sixteen', 17: 'seventeen', 18: 'eighteen',
  };
  const wrong = Object.entries(words)
    .filter(([n]) => Number(n) !== TARGETS.length)
    .map(([, w]) => w)
    .filter(w => new RegExp(`${w}\\s+(targets|slots)`, 'i').test(html));
  assert.deepEqual(wrong, [],
    `copy names a target count that is not ${TARGETS.length}: ${wrong.join(', ')}`);
});

test('primer examples do not cite drugs removed from the atlas', () => {
  const egs = [...html.matchAll(/class="concept-eg">([\s\S]*?)<\/p>/g)].map(m => m[1].toLowerCase());
  const stale = REMOVED_FROM_ROSTER.filter(d => egs.some(e => e.includes(d)));
  assert.deepEqual(stale, [],
    `"Examples here" cites drugs no longer on the plate: ${stale.join(', ')}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plate-copy.test.js`
Expected: FAIL, 3/3 — "copy claims geometric means", "copy names a target count that is not 16: thirteen", "cites drugs no longer on the plate: fentanyl, dobutamine, flumazenil"

- [ ] **Step 3: Fix the footer methodology claim**

In `public/neuroreceptor_pharmacology_explorer_dashboard.html`, replace:

```
    An educational reference for clinicians and trainees, not a dosing or treatment guide. Binding-affinity values are representative and relative (geometric means of reported ranges, assay-dependent), not a verified Ki database; confirm specific figures before any high-stakes clinical use.
```

with:

```
    An educational reference for clinicians and trainees, not a dosing or treatment guide. Each value is the median of the human pKi values PDSP holds for that pair, pooled across radioligands and assay conditions without weighting; the tooltip gives the range and how many measurements sit behind it. Confirm specific figures against primary literature before any high-stakes use.
```

- [ ] **Step 4: Fix the target count in the plate subtitle**

Replace:

```
            <p>Affinity fingerprints across the cabinet's thirteen targets</p>
```

with:

```
            <p>Affinity fingerprints across the cabinet's sixteen targets</p>
```

- [ ] **Step 5: Fix the target count in the rose caption**

Replace:

```
                <p>Thirteen slots, one per target. A petal's length is its pKi and its colour is what the drug does there; an empty slot means nobody has screened it. Hover an agent to trace it; click to pin and compare.</p>
```

with:

```
                <p>Sixteen slots, one per target. A petal's length is its pKi and its colour is what the drug does there; an empty slot means nobody has screened it. Hover an agent to trace it; click to pin and compare.</p>
```

- [ ] **Step 6: Fix the two primer examples**

Replace:

```
                <p class="concept-eg">Examples here: morphine and fentanyl at μ-opioid; dopamine agonists; β1 agonists (dobutamine).</p>
```

with:

```
                <p class="concept-eg">Examples here: morphine and methadone at μ-opioid; bromocriptine at D2; epinephrine at β1.</p>
```

Replace:

```
                <p class="concept-eg">Examples here: naloxone at μ-opioid; flumazenil at the GABA-A benzodiazepine site; prazosin at α1.</p>
```

with:

```
                <p class="concept-eg">Examples here: naloxone and naltrexone at μ-opioid; prazosin at α1; yohimbine at α2.</p>
```

- [ ] **Step 7: Fix the three stale doc/comment claims**

In `DESIGN.md`, replace `A sticky 13-slot affinity rose` with `A sticky 16-slot affinity rose`.

In `scripts/sourcing/README.md`, replace `reads the drug list and the 13 receptor columns from the dashboard's own` with `reads the drug list and the receptor columns from the dashboard's own`.

In `scripts/sourcing/config.mjs`, replace `/** The 13 receptor columns, by the Cabinet's own alias. */` with `/** The receptor columns, by the Cabinet's own alias. */`.

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test test/plate-copy.test.js`
Expected: PASS, 3/3

Run: `npm test`
Expected: 0 failures

- [ ] **Step 9: Commit**

```bash
git add public/neuroreceptor_pharmacology_explorer_dashboard.html DESIGN.md scripts/sourcing/README.md scripts/sourcing/config.mjs test/plate-copy.test.js
git commit -m "fix(copy): state the real statistic, target count, and roster in shipped text"
```

---

### Task 3: Require a decisive margin before naming a receptor subtype

**Goal:** A generic column stops crowning a subtype that beats its runner-up by less than measurement noise. Mirtazapine's α2 currently reports "Alpha2C" on a 0.04 log-unit lead over α2A.

**Files:**
- Modify: `scripts/sourcing/config.mjs` (add `MIN_SUBTYPE_MARGIN`)
- Modify: `scripts/sourcing/3-build.mjs` (`represent()`)
- Modify: `test/binding-dispersion.test.js`

**Acceptance Criteria:**
- [ ] Mirtazapine `alpha_2` reports no `sub` and carries `weak: 1`
- [ ] Guanfacine `alpha_2` still reports `sub: "Alpha2A"` (it leads by 1.23 log units)
- [ ] `npm test` green after the rebuild

**Verify:** `node --test test/binding-dispersion.test.js` → all pass

**Background — the actual numbers.** Mirtazapine's human α2 medians are α2C 7.74 (n=2), α2A 7.70 (n=2), α2B 7.06 (n=1). The `n >= 2` gate keeps α2B out but does nothing about a 0.04 gap between the top two, which would flip on one new datapoint and contradicts the drug's clinical α2A story. Guanfacine's are α2A 7.16 (n=2), α2B 5.93 (n=2), α2C 5.68 (n=2) — a decisive 1.23 lead that must survive.

**Steps:**

- [ ] **Step 1: Write the failing test**

Append to `test/binding-dispersion.test.js`:

```js
test('a subtype is named only when it decisively beats the runner-up', () => {
  // alpha2C 7.74 vs alpha2A 7.70 is a 0.04 log-unit gap — inside measurement noise,
  // and it would flip on one new datapoint. Report the pooled median, flagged weak.
  const m = lit('Mirtazapine').b.alpha_2;
  assert.equal(m.sub, undefined, 'mirtazapine alpha_2 must not claim a subtype');
  assert.equal(m.weak, 1, 'and must be flagged low-confidence');
});

test('a decisive subtype lead is still reported', () => {
  // alpha2A 7.16 vs alpha2B 5.93 is a 1.23 log-unit lead — this is the drug's whole story.
  assert.equal(lit('Guanfacine').b.alpha_2.sub, 'Alpha2A');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/binding-dispersion.test.js`
Expected: FAIL — `mirtazapine alpha_2 must not claim a subtype`, actual `'Alpha2C'`

- [ ] **Step 3: Add the margin constant**

In `scripts/sourcing/config.mjs`, immediately after the `INACTIVE_PKI` export, add:

```js
/** How far a subtype must lead the runner-up before the plate names it.
 *  Between-laboratory pKi noise is routinely a few tenths of a log unit, so a lead
 *  smaller than this is not evidence of selectivity — it is the ordering of two
 *  indistinguishable numbers. Mirtazapine's alpha2C leads alpha2A by 0.04 and would
 *  flip on one new measurement. */
export const MIN_SUBTYPE_MARGIN = 0.3;
```

- [ ] **Step 4: Apply the guard in `represent()`**

In `scripts/sourcing/3-build.mjs`, add `MIN_SUBTYPE_MARGIN` to the import list from `./config.mjs`, then replace:

```js
  const best = eligible.reduce((a, b) => (b.m > a.m ? b : a));
  return { pki: best.m, sub: best.s, weak: false, ...spread(best.v) };
```

with:

```js
  const best = eligible.reduce((a, b) => (b.m > a.m ? b : a));
  const others = eligible.filter(x => x !== best).map(x => x.m);
  const runnerUp = others.length ? Math.max(...others) : -Infinity;
  if (others.length && best.m - runnerUp < MIN_SUBTYPE_MARGIN) {
    // Two subtypes are tied within noise. Naming either overstates the precision of
    // the data, so fall back to the pooled median and say it is low-confidence.
    const all = subs.flatMap(x => x.v);
    return { pki: median(all), sub: null, weak: true, ...spread(all) };
  }
  return { pki: best.m, sub: best.s, weak: false, ...spread(best.v) };
```

- [ ] **Step 5: Rebuild the literal and the database**

```bash
node scripts/sourcing/3-build.mjs
```

Expected: a `changes vs the shipping dashboard` list that includes `~ Mirtazapine/alpha_2` and does NOT include `Guanfacine/alpha_2`.

Then write and reseed. **Stop any running preview server first** or the `rm` fails:

```bash
node scripts/sourcing/3-build.mjs --write
node scripts/preserve-activity.mjs save
rm -f db/atlas.db db/atlas.db-wal db/atlas.db-shm
npm run migrate
node scripts/preserve-activity.mjs restore
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/binding-dispersion.test.js`
Expected: PASS

Run: `npm test`
Expected: 0 failures

- [ ] **Step 7: Document the rule**

In `scripts/sourcing/README.md`, in the `### Subtypes` section, append:

```markdown
A subtype must also lead the runner-up by at least `MIN_SUBTYPE_MARGIN` (0.3 log units)
to be named. Below that the two are tied within between-laboratory noise, so the cell
reports the pooled median flagged `weak:1` rather than ordering two indistinguishable
numbers. Mirtazapine's alpha-2 is the worked example: alpha2C 7.74 against alpha2A 7.70.
```

- [ ] **Step 8: Commit**

```bash
git add scripts/sourcing/config.mjs scripts/sourcing/3-build.mjs scripts/sourcing/README.md test/binding-dispersion.test.js public/neuroreceptor_pharmacology_explorer_dashboard.html
git commit -m "fix(sourcing): require a decisive margin before naming a subtype"
```

---

### Task 4: Exclude functional-assay rows from a table that claims Ki

**Goal:** The Ki spine stops pooling ~1,720 functional-assay readings in with radioligand binding.

**Files:**
- Modify: `scripts/sourcing/config.mjs` (add `isBindingAssay`)
- Modify: `scripts/sourcing/3-build.mjs` (apply the filter)
- Modify: `test/binding-dispersion.test.js`

**Acceptance Criteria:**
- [ ] `isBindingAssay` rejects rows whose hot-ligand column is `Functional` and accepts radioligands and `UNDEFINED`
- [ ] The shipped Fluoxetine/SERT cell matches a recomputation that excludes functional rows
- [ ] `npm test` green after the rebuild

**Verify:** `node --test test/binding-dispersion.test.js` → all pass

**Background.** PDSP's export stores the radioligand in the "Hot Ligands" column. For functional-assay results it stores the literal string `Functional` instead. Ki (competitive binding) and functional potency measure different phenomena; pooling them into one median is a category error in a table headed "binding affinity". Fluoxetine/SERT currently includes one such row (Deecher 2006, Ki 10.3 nM).

**Steps:**

- [ ] **Step 1: Write the failing test**

Append to `test/binding-dispersion.test.js` (add `isBindingAssay`, `drugMatcher`, `pdspTarget`, `isHumanSpecies`, `canonReceptor`, `median` to the imports from `../scripts/sourcing/config.mjs`, and `readFileSync` from `node:fs`):

```js
test('the hot-ligand column separates binding from functional assays', () => {
  assert.equal(isBindingAssay({ hot: 'Functional' }), false);
  assert.equal(isBindingAssay({ hot: '3H-CITALOPRAM' }), true);
  assert.equal(isBindingAssay({ hot: 'UNDEFINED' }), true, 'unannotated is still binding');
  assert.equal(isBindingAssay({ hot: '' }), true);
});

test('the shipped SERT value excludes functional-assay readings', () => {
  // Recompute from the cached source rows the way the build does, then compare.
  // Relational rather than a typed-in number, so a data refresh cannot turn a real
  // regression into a fixture edit.
  const rows = JSON.parse(readFileSync(
    new URL('../scripts/sourcing/cache/pdsp-rows.json', import.meta.url), 'utf8'));
  const md = drugMatcher();
  const seen = new Set(), vals = [];
  for (const r of rows) {
    if (md(r.test) !== 'Fluoxetine') continue;
    if (pdspTarget(r.receptor) !== 'sert') continue;
    if (!isHumanSpecies(r.species) || r.censored || !(r.ki > 0)) continue;
    if (!isBindingAssay(r)) continue;
    const sub = canonReceptor(r.receptor);
    const key = `${r.ki}|${sub}|${r.hot}|${r.cite}`;
    if (seen.has(key)) continue;
    seen.add(key);
    vals.push(9 - Math.log10(r.ki));
  }
  const want = lit('Fluoxetine').b.sert;
  assert.equal(want.n, vals.length, 'n must reflect binding-only rows');
  assert.equal(want.pki, +median(vals).toFixed(2));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/binding-dispersion.test.js`
Expected: FAIL — `isBindingAssay is not defined`

- [ ] **Step 3: Add the predicate**

In `scripts/sourcing/config.mjs`, after `isHumanSpecies`, add:

```js
/** PDSP stores the radioligand in the hot-ligand column, and the literal "Functional"
 *  where the row is a functional-assay result rather than a binding measurement. Ki and
 *  functional potency are different quantities; a table headed "binding affinity" must
 *  not average them together. ~1720 human rows in the current export are functional. */
export const isBindingAssay = row => !/^functional$/i.test(String(row.hot || '').trim());
```

- [ ] **Step 4: Apply the filter in the build**

In `scripts/sourcing/3-build.mjs`, add `isBindingAssay` to the import list from `./config.mjs`, then replace:

```js
  if (!isHumanSpecies(row.species)) continue;
```

with:

```js
  if (!isHumanSpecies(row.species)) continue;
  if (!isBindingAssay(row)) continue;          // Ki only; functional potency is not Ki
```

- [ ] **Step 5: Rebuild the literal and the database**

**Stop any running preview server first.**

```bash
node scripts/sourcing/3-build.mjs
```

Expected: the cell count drops and the change list includes `~ Fluoxetine/sert`.

```bash
node scripts/sourcing/3-build.mjs --write
node scripts/preserve-activity.mjs save
rm -f db/atlas.db db/atlas.db-wal db/atlas.db-shm
npm run migrate
node scripts/preserve-activity.mjs restore
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/binding-dispersion.test.js`
Expected: PASS

Run: `npm test`
Expected: 0 failures. If `test/api-atlas-structured.test.js` fails on Diazepam's `kiText`, update that expectation to the new value — the count legitimately changed.

- [ ] **Step 7: Document the exclusion**

In `scripts/sourcing/README.md`, under "The rule that matters", append a row to the source table:

```markdown
| **Assay type** | Radioligand **binding** only | The hot-ligand column reads `Functional` for functional-assay rows (~1720 human). Ki and functional potency are different quantities and are never averaged together |
```

- [ ] **Step 8: Commit**

```bash
git add scripts/sourcing/config.mjs scripts/sourcing/3-build.mjs scripts/sourcing/README.md test/binding-dispersion.test.js test/api-atlas-structured.test.js public/neuroreceptor_pharmacology_explorer_dashboard.html
git commit -m "fix(sourcing): exclude functional-assay rows from the Ki spine"
```

---

### Task 5: Make "screened and clean" visually distinct from "never screened"

**Goal:** A reader can tell the two apart without hovering. Four of five clinical reviewers reported they could not.

**Files:**
- Modify: `public/neuroreceptor_pharmacology_explorer_dashboard.html` (`.dot.inactive` CSS, legend markup)

**Acceptance Criteria:**
- [ ] An inactive dot renders with a visible centre mark, not just a faint ring
- [ ] The legend shows the empty-cell case explicitly beside the tested-inactive case
- [ ] `npm test` green

**Verify:** Load the Catalogue view; run in the browser console:
```js
getComputedStyle(document.querySelector('.dot.inactive')).backgroundImage !== 'none'
```
→ `true`

**Steps:**

- [ ] **Step 1: Strengthen the inactive dot**

Replace:

```css
  .dot.inactive { background: transparent; border: 1px solid var(--brass-line); opacity: .7; }
```

with:

```css
  /* Screened and found inert. This must not read as an empty cell: "we looked and found
     nothing" is evidence of selectivity, "nobody looked" is an absence of evidence, and
     four of five clinical reviewers could not tell them apart at a glance. A ring alone
     was too close to nothing; the centre dot gives it presence. */
  .dot.inactive {
    background: radial-gradient(circle, var(--bone-faint) 0 1.5px, transparent 1.6px);
    border: 1px solid var(--bone-faint);
    opacity: .75;
  }
```

- [ ] **Step 2: Name the empty case in the legend**

Replace:

```html
              <span><i class="lk" style="background:transparent;border:1px solid var(--brass-line)"></i> Tested &mdash; no meaningful binding (pKi &le; 5)</span>
```

with:

```html
              <span><i class="lk inactive-key"></i> Screened, no meaningful binding (pKi &le; 5)</span>
              <span><i class="lk" style="background:transparent;border:1px dashed var(--brass-faint)"></i> Never screened &mdash; not evidence of no binding</span>
```

- [ ] **Step 3: Style the legend key to match the dot**

Immediately after the `.dot.inactive` rule, add:

```css
  .lk.inactive-key {
    background: radial-gradient(circle, var(--bone-faint) 0 1.5px, transparent 1.6px);
    border: 1px solid var(--bone-faint);
  }
```

- [ ] **Step 4: Verify in the browser**

Start the server, open the Catalogue view, and confirm in the console:

```js
JSON.stringify({
  inactive: getComputedStyle(document.querySelector('.dot.inactive')).backgroundImage,
  legendKeys: document.querySelectorAll('.legend-row .lk').length
})
```

Expected: `inactive` contains `radial-gradient`; `legendKeys` is 6.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: 0 failures

- [ ] **Step 6: Commit**

```bash
git add public/neuroreceptor_pharmacology_explorer_dashboard.html
git commit -m "fix(plate): distinguish screened-clean from never-screened"
```

---

### Task 6: State the affinity/occupancy limit and what the range means

**Goal:** The two interpretation warnings appear where the numbers are read, not 1,290 lines below in the footer.

**Files:**
- Modify: `public/neuroreceptor_pharmacology_explorer_dashboard.html` (`.affinity-note`, tooltip spread wording)
- Modify: `test/plate-copy.test.js`

**Acceptance Criteria:**
- [ ] The affinity note states that pKi is not occupancy and not clinical effect
- [ ] The tooltip labels the spread as an observed range across laboratories, not a confidence interval
- [ ] `npm test` green

**Verify:** `node --test test/plate-copy.test.js` → 5 tests pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Append to `test/plate-copy.test.js`:

```js
test('the affinity note states that binding is not occupancy', () => {
  const note = html.match(/<div class="affinity-note">([\s\S]*?)<\/div>/);
  assert.ok(note, 'affinity-note block must exist');
  assert.match(note[1], /occupancy/i,
    'the note must say pKi is not receptor occupancy at a therapeutic dose');
});

test('the tooltip does not present the observed range as a confidence interval', () => {
  assert.ok(!/confidence interval/i.test(html));
  assert.match(html, /observed across labs|range across labs/i,
    'the spread must be labelled as an observed range');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plate-copy.test.js`
Expected: FAIL, 2 of 5 — "the note must say pKi is not receptor occupancy", "the spread must be labelled as an observed range"

- [ ] **Step 3: Extend the affinity note**

In the `.affinity-note` block, replace the trailing sentence:

```
A hollow ring means the pair was tested and showed no meaningful binding (pKi &le; 5); a blank cell means PDSP has no human value, which is not the same as no interaction.
```

with:

```
A ringed dot means the pair was screened and showed no meaningful binding (pKi &le; 5); a blank cell means PDSP has no human value, which is not the same as no interaction. <strong>Affinity is not occupancy.</strong> pKi describes how tightly a drug binds in vitro at equilibrium, not how much of the receptor it occupies in a patient: that depends on dose, unbound brain concentration, metabolites, and endogenous tone, none of which are shown here.
```

- [ ] **Step 4: Relabel the tooltip spread**

In the dot tooltip construction, replace:

```js
          const spread = (lo && hi && lo !== hi)
            ? ` <em style="font-size:.62rem;color:var(--bone-faint)">(range ${lo}&ndash;${hi})</em>` : '';
```

with:

```js
          // Deliberately "observed across labs" and not a confidence interval: lo/hi are
          // the extremes of the measurements, with no distributional model behind them.
          const spread = (lo && hi && lo !== hi)
            ? ` <em style="font-size:.62rem;color:var(--bone-faint)">(${lo}&ndash;${hi} observed across labs)</em>` : '';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/plate-copy.test.js`
Expected: PASS, 5/5

Run: `npm test`
Expected: 0 failures

- [ ] **Step 6: Verify the tooltip in the browser**

Open the Catalogue view and run:

```js
(() => { const d = [...document.querySelectorAll('.dot')].find(x => x.dataset.agent === 'Fluoxetine' && x.dataset.target === 'sert');
  d.dispatchEvent(new MouseEvent('mouseenter', { clientX: 100, clientY: 100 }));
  return document.querySelector('.affinity-tooltip').textContent.replace(/\s+/g, ' ').trim(); })()
```

Expected: contains `observed across labs`

- [ ] **Step 7: Commit**

```bash
git add public/neuroreceptor_pharmacology_explorer_dashboard.html test/plate-copy.test.js
git commit -m "fix(copy): state the occupancy limit and label the range honestly"
```

---

### Task 7: Restore design-system conformance

**Goal:** Functional text stops rendering below the documented 11px label step, and the banned side-stripe border is removed.

**Files:**
- Modify: `public/neuroreceptor_pharmacology_explorer_dashboard.html` (six `0.625rem` rules, `.concept-eg`)
- Create: `test/design-conformance.test.js`

**Acceptance Criteria:**
- [ ] No `font-size` below `0.6875rem` (`--lbl`) in the dashboard
- [ ] No colored `border-left`/`border-right` wider than 1px
- [ ] `npm test` green

**Verify:** `node --test test/design-conformance.test.js` → 2 tests pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/design-conformance.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DASHBOARD } from '../scripts/sourcing/config.mjs';

const html = readFileSync(DASHBOARD, 'utf8');

// DESIGN.md sets the label step at 0.6875rem (11px) and bans side-stripe accent borders.
// Both rules are the project's own; these tests stop them drifting silently.
test('no functional text is set below the documented label step', () => {
  const tooSmall = [...html.matchAll(/font-size:\s*(0?\.\d+)rem/g)]
    .map(m => Number(m[1]))
    .filter(rem => rem < 0.6875);
  assert.deepEqual([...new Set(tooSmall)], [],
    `font sizes below the 0.6875rem label step: ${[...new Set(tooSmall)].join(', ')}`);
});

test('no side-stripe accent borders', () => {
  const stripes = [...html.matchAll(/border-(left|right):\s*([2-9]|\d{2,})px/g)].map(m => m[0]);
  assert.deepEqual(stripes, [],
    `DESIGN.md bans colored border-left/right wider than 1px: ${stripes.join(', ')}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/design-conformance.test.js`
Expected: FAIL, 2/2 — sizes `0.625, 0.6` reported, and `border-left: 2px`

- [ ] **Step 3: Raise every sub-floor size to the label token**

Replace all six occurrences of `font-size: 0.625rem;` with `font-size: var(--lbl);`. They appear in the masthead ref line, the specimen index, the plate kicker, `.legend-row`, `.ref-list .ref-cls`, and `.dialog-head .dno`. Use a global replace and confirm the count:

```bash
node -e "
const fs=require('fs');const p='public/neuroreceptor_pharmacology_explorer_dashboard.html';
let s=fs.readFileSync(p,'utf8');
const n=(s.match(/font-size: 0\.625rem;/g)||[]).length;
s=s.split('font-size: 0.625rem;').join('font-size: var(--lbl);');
fs.writeFileSync(p,s);console.log('replaced',n,'occurrences');
"
```

Expected: `replaced 6 occurrences`

- [ ] **Step 4: Raise the remaining sub-floor sizes**

Any `0.6rem`, `0.62rem`, or `0.65rem` still reported by the test are inline styles in the tooltip and legend. Replace each with `var(--lbl)`:

```bash
node -e "
const fs=require('fs');const p='public/neuroreceptor_pharmacology_explorer_dashboard.html';
let s=fs.readFileSync(p,'utf8');
let n=0;
for (const size of ['0.6rem','.62rem','0.62rem','0.65rem','.6rem']) {
  const before=s.split('font-size:'+size).length-1 + (s.split('font-size: '+size).length-1);
  s=s.split('font-size:'+size).join('font-size:var(--lbl)')
     .split('font-size: '+size).join('font-size: var(--lbl)');
  n+=before;
}
fs.writeFileSync(p,s);console.log('replaced',n,'inline sizes');
"
```

- [ ] **Step 5: Remove the side-stripe**

Replace the `.concept-eg` rule:

```css
  .concept-eg {
    font-family: var(--mono);
    font-size: 0.78rem !important;
    color: var(--bone-faint);
    border-left: 2px solid var(--brass-line);
    padding-left: 0.8rem;
    line-height: 1.6 !important;
  }
```

with:

```css
  /* No side-stripe: DESIGN.md bans colored border-left/right above 1px. The example
     block is set apart by its ground and hairline instead. */
  .concept-eg {
    font-family: var(--mono);
    font-size: 0.78rem !important;
    color: var(--bone-faint);
    background: oklch(0% 0 0 / 0.12);
    border: 1px solid var(--brass-faint);
    border-radius: 2px;
    padding: 0.6rem 0.8rem;
    line-height: 1.6 !important;
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/design-conformance.test.js`
Expected: PASS, 2/2

Run: `npm test`
Expected: 0 failures

- [ ] **Step 7: Verify nothing overflowed**

Open the Catalogue view and confirm the legend still fits on one row group:

```js
JSON.stringify({ bodyOverflows: document.body.scrollWidth > innerWidth,
  legendRows: document.querySelectorAll('.legend-row').length })
```

Expected: `bodyOverflows` false, `legendRows` 3

- [ ] **Step 8: Commit**

```bash
git add public/neuroreceptor_pharmacology_explorer_dashboard.html test/design-conformance.test.js
git commit -m "fix(design): honour the label type floor and drop the side-stripe"
```

---

### Task 8: Make pinning discoverable and eviction visible

**Goal:** A first-time reader can tell that clicking a matrix row does something, and is told when their oldest pin is dropped.

**Files:**
- Modify: `public/neuroreceptor_pharmacology_explorer_dashboard.html` (`.agent-name` affordance, `togglePin`, matrix head copy)

**Acceptance Criteria:**
- [ ] Hovering an agent name shows a pin affordance cue
- [ ] Pinning a third agent announces which one was dropped
- [ ] The announcement clears on the next selection and is not a modal
- [ ] `npm test` green

**Verify:** In the browser, pin three agents in sequence and confirm the legend hint names the evicted one.

**Steps:**

- [ ] **Step 1: Add the hover affordance**

Immediately after the `.agent-name` rule, add:

```css
  /* The pin interaction was invisible: nothing cued that a row was clickable, and the
     result (petals changing) is far from the action (a click in the matrix). */
  .agent-name::after {
    content: "pin";
    float: right;
    font-family: var(--mono);
    font-size: var(--lbl-sm);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--brass);
    opacity: 0;
    transition: opacity 0.2s var(--ease);
  }
  .row:hover .agent-name::after { opacity: 0.9; }
  .row.pinned .agent-name::after { content: "unpin"; opacity: 0.9; }
```

- [ ] **Step 2: Announce eviction**

In `togglePin`, replace:

```js
        } else {
          // Two is the ceiling: the rose distinguishes a pair by solid-vs-hatched
          // fill, and there is no third fill that stays legible at petal size.
          if (window.affinityPins.length >= 2) window.affinityPins.shift();
          window.affinityPins.push(nm);
        }
```

with:

```js
        } else {
          // Two is the ceiling: the rose distinguishes a pair by solid-vs-hatched
          // fill, and there is no third fill that stays legible at petal size. Say so
          // rather than dropping the oldest pin silently.
          window.__pinEvicted = (window.affinityPins.length >= 2)
            ? window.affinityPins.shift()
            : null;
          window.affinityPins.push(nm);
        }
```

- [ ] **Step 3: Surface it in the legend hint**

In `renderLegend`, replace:

```js
        + (pins.length > 1
            ? `<span class="hint">solid petals are ${pins[0]} · hatched are ${pins[1]}</span>`
            : '');
```

with:

```js
        + (pins.length > 1
            ? `<span class="hint">solid petals are ${pins[0]} · hatched are ${pins[1]}</span>`
            : '')
        + (window.__pinEvicted
            ? `<span class="hint" style="color:var(--vermilion)">${window.__pinEvicted} unpinned — two is the maximum</span>`
            : '');
```

- [ ] **Step 4: Clear the notice on the next change**

At the top of `drawPolys`, immediately after `function drawPolys(hoverName) {`, add:

```js
        // The eviction notice belongs to one selection only.
        if (!hoverName) setTimeout(() => { window.__pinEvicted = null; }, 4000);
```

- [ ] **Step 5: Verify in the browser**

```js
(() => { const row = n => [...document.querySelectorAll('.row')].find(r => r.dataset.agent === n);
  ['Fluoxetine','Sertraline','Paroxetine'].forEach(n => row(n).dispatchEvent(new MouseEvent('click',{bubbles:true})));
  return JSON.stringify({ pins: window.affinityPins, evicted: window.__pinEvicted,
    hint: document.querySelector('#radar-legend .hint:last-child')?.textContent }); })()
```

Expected: `pins` is `["Sertraline","Paroxetine"]`, `evicted` is `"Fluoxetine"`, hint names Fluoxetine.

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: 0 failures

- [ ] **Step 7: Commit**

```bash
git add public/neuroreceptor_pharmacology_explorer_dashboard.html
git commit -m "feat(plate): cue the pin affordance and announce eviction"
```

---

### Task 9: Add search and class filter to the matrix

**Goal:** Finding one of 92 drugs stops requiring a scroll-and-scan.

**Files:**
- Modify: `public/neuroreceptor_pharmacology_explorer_dashboard.html` (matrix head markup, filter CSS, `renderAffinityMatrix`)

**Acceptance Criteria:**
- [ ] A text input filters rows by agent name, case-insensitively
- [ ] Group headings hide when every row beneath them is filtered out
- [ ] Clearing the input restores all 92 rows
- [ ] Filtering never changes which agents are pinned
- [ ] `npm test` green

**Verify:** In the browser, type `flu` and confirm only matching rows and their group headings remain.

**Steps:**

- [ ] **Step 1: Add the control markup**

Replace:

```html
            <div class="matrix-head">Agent × target affinity</div>
```

with:

```html
            <div class="matrix-head">
              <span>Agent × target affinity</span>
              <input id="agent-filter" class="agent-filter" type="search"
                     placeholder="Filter agents" aria-label="Filter agents by name" autocomplete="off">
            </div>
```

- [ ] **Step 2: Style it**

Immediately after the `.matrix-head` rule, add:

```css
  .matrix-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-md); }
  .agent-filter {
    font-family: var(--mono);
    font-size: var(--lbl);
    letter-spacing: 0.08em;
    color: var(--bone);
    background: var(--wall-recess);
    border: 1px solid var(--brass-line);
    border-radius: 2px;
    padding: 0.35rem 0.55rem;
    min-width: 12rem;
  }
  .agent-filter:focus { outline: none; border-color: var(--brass); }
  .agent-filter::placeholder { color: var(--bone-faint); }
  .row.filtered, .group-label.filtered { display: none; }
```

- [ ] **Step 3: Wire the filter**

At the end of `renderAffinityMatrix`, immediately before its closing brace, add:

```js
      // Filter by name. Rows use `display: contents`, so hiding one means hiding each of
      // its cells — the .filtered class on .row does that via the CSS rule above. A group
      // heading disappears once nothing under it survives.
      const filterInput = document.getElementById('agent-filter');
      if (filterInput) {
        filterInput.addEventListener('input', () => {
          const q = filterInput.value.trim().toLowerCase();
          let shown = 0;
          document.querySelectorAll('#grid .group-label').forEach(label => {
            let anyVisible = false;
            let node = label.nextElementSibling;
            while (node && !node.classList.contains('group-label')) {
              if (node.classList.contains('row')) {
                const hit = !q || node.dataset.agent.toLowerCase().includes(q);
                node.classList.toggle('filtered', !hit);
                if (hit) { anyVisible = true; shown++; }
              }
              node = node.nextElementSibling;
            }
            label.classList.toggle('filtered', !anyVisible);
          });
          filterInput.setAttribute('aria-label', `Filter agents by name, ${shown} shown`);
        });
      }
```

- [ ] **Step 4: Verify in the browser**

```js
(() => { const f = document.getElementById('agent-filter');
  f.value = 'flu'; f.dispatchEvent(new Event('input'));
  const visibleRows = [...document.querySelectorAll('.row')].filter(r => !r.classList.contains('filtered'));
  const visibleGroups = [...document.querySelectorAll('.group-label')].filter(g => !g.classList.contains('filtered'));
  const pinsBefore = window.affinityPins.slice();
  f.value = ''; f.dispatchEvent(new Event('input'));
  return JSON.stringify({ matched: visibleRows.map(r => r.dataset.agent),
    groupsShown: visibleGroups.length,
    restored: document.querySelectorAll('.row:not(.filtered)').length,
    pinsUnchanged: JSON.stringify(pinsBefore) === JSON.stringify(window.affinityPins) }); })()
```

Expected: `matched` contains Fluoxetine, Fluvoxamine, Fluphenazine; `restored` is 92; `pinsUnchanged` true.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: 0 failures

- [ ] **Step 6: Commit**

```bash
git add public/neuroreceptor_pharmacology_explorer_dashboard.html
git commit -m "feat(plate): filter the agent matrix by name"
```

---

## Self-Review

**Spec coverage.** The twelve recommendations map as: footer statistic → Task 2; target count → Task 2; stale drug examples → Task 2; occupancy caution → Task 6; hollow-vs-blank → Task 5; subtype tie-guard → Task 3; pin affordance and eviction → Task 8; search/filter → Task 9; undersized text → Task 7; side-stripe → Task 7; functional assays → Task 4; range-not-a-CI → Task 6. Task 1 is a prerequisite the recommendations implied but did not name: two tasks reseed the database, and without it each one silently discards `section_activity`.

**Deliberately out of scope**, and why. Confidence intervals, radioligand stratification, and censored-data modelling (Tobit/Kaplan-Meier) were raised by the peer reviewer and are genuine, but each changes what every number means and deserves its own spec rather than a step in a correction pass. Half-life, CYP interactions, and receptor occupancy were asked for by three clinical reviewers; they are a new data source and a new view, not a correction. The PGY-1's grouping objection (bupropion filed under "SNRIs & atypical antidepressants") is an editorial call that needs your decision, not a task.

**Type consistency.** `isBindingAssay(row)` takes a row object and is called with the same shape in Task 4's test and build. `MIN_SUBTYPE_MARGIN` is exported from `config.mjs` and imported by `3-build.mjs`. `saveActivity(db)` returns the array `restoreActivity(db, rows)` consumes. `window.__pinEvicted` is written in `togglePin` (Task 8 Step 2), read in `renderLegend` (Step 3), and cleared in `drawPolys` (Step 4).

**Ordering.** Tasks 3 and 4 both rebuild the database and must run after Task 1. Task 4 should follow Task 3 so only the later rebuild's diff needs reviewing against a moving baseline. Tasks 2 and 5 through 9 touch only the page and can run in any order.
