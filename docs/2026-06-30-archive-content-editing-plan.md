# Archive Content Editing (Wave 1) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Make the Receptor Archive's descriptive prose (abstract, body paragraphs, presentation, effect, class, ligand, tags, figure caption) database-backed and editable from the Conservator's Desk, so editing it once in the desk updates the Archive page on reload.

**Architecture:** Reuse the shipped pattern — move the text into a new `archive_entries` table, link entries to receptors via an `archive` set in the existing `receptor_aliases` table, edit through the existing `/api/receptors/:id/structured` endpoint (new `narrative` block), and have `public/receptor-function.html` hydrate its `ENTRIES` from the API on load (embedded text as offline fallback). See design: `docs/2026-06-30-archive-content-editing-design.md`.

**Tech Stack:** Node.js (ESM), `better-sqlite3`, Node's built-in test runner (`node --test`). Vanilla browser JS/HTML/CSS, no build step.

**Path note:** All commands assume the working directory is `C:\dev\atlas-app`. Tests use in-memory or temp SQLite DBs. After backend tasks, rebuild the real DB with `npm run migrate` (delete `db/atlas.db` first if a structured rebuild is needed).

**Reference — the 23 Archive entries → receptor ids** (from `public/receptor-function.html` `ENTRIES`; `m3` has no Archive entry):

| # | title | id | # | title | id |
|---|-------|----|----|-------|----|
| 1 | 5-HT1A | ht1a | 13 | NET | net |
| 2 | 5-HT2A | ht2a | 14 | NMDA | nmda |
| 3 | 5-HT2C | ht2c | 15 | AMPA | ampa |
| 4 | 5-HT3 | ht3 | 16 | GABA-A | gabaa |
| 5 | SERT | sert | 17 | GABA-B | gabab |
| 6 | D1 | d1 | 18 | Muscarinic M1 | m1 |
| 7 | D2 | d2 | 19 | nAChR | nachr |
| 8 | D3 | d3 | 20 | Histamine H1 | h1 |
| 9 | DAT | dat | 21 | μ-Opioid | mor |
| 10 | α1 | a1 | 22 | Melatonin MT1/MT2 | mt |
| 11 | α2 | a2 | 23 | Orexin OX1/OX2 | ox |
| 12 | β-Adrenergic | b1 | | | |

---

## Task 0: `archive_entries` schema

**Files:**
- Modify: `db/schema.sql`
- Test: `test/archive-schema.test.js`

**Step 1: Write the failing test**

```js
// test/archive-schema.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';

test('schema creates archive_entries', () => {
  const db = openDb(':memory:');
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(names.includes('archive_entries'), 'archive_entries table should exist');
});
```

**Step 2: Run → fail.** `node --test test/archive-schema.test.js` → FAIL (no such table).

**Step 3: Add the table** to `db/schema.sql` (place it just before `CREATE TABLE IF NOT EXISTS section_activity`):

```sql
-- Archive narrative prose (Task: archive content editing). One row per receptor that
-- has an Archive entry. List fields (body paragraphs, tags) stored as JSON text.
CREATE TABLE IF NOT EXISTS archive_entries (
  receptor_id    TEXT PRIMARY KEY REFERENCES receptors(id),
  abstract       TEXT,
  presentation   TEXT,
  effect         TEXT,
  receptor_class TEXT,
  ligand         TEXT,
  figure_caption TEXT,
  body_json      TEXT,
  tags_json      TEXT
);
```

**Step 4: Run → pass.**

**Step 5: Commit** `feat: archive_entries schema`.

---

## Task 1: Archive aliases (entry number → receptor id)

**Files:**
- Modify: `scripts/seed-data.js`
- Test: `test/archive-alias.test.js`

**Step 1: Write the failing test**

```js
// test/archive-alias.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';

test('archive aliases map entry numbers to receptor ids', () => {
  const db = openDb(':memory:');
  migrate(db);
  const get = (alias) => db.prepare(
    "SELECT receptor_id FROM receptor_aliases WHERE volume='archive' AND alias=?").get(alias)?.receptor_id;
  assert.equal(get('16'), 'gabaa');  // entry 16 = GABA-A
  assert.equal(get('21'), 'mor');    // entry 21 = μ-Opioid
  assert.equal(get('1'),  'ht1a');   // entry 1  = 5-HT1A
});
```

**Step 2: Run → fail** (no archive aliases yet).

**Step 3: Append the archive aliases** to the `ALIASES` array in `scripts/seed-data.js` (after the `// ---- Ledger ----` block, before the closing `];`):

```js
  // ---- Archive (alias = ENTRIES entry number, from receptor-function.html) ----
  ['archive','1','ht1a'], ['archive','2','ht2a'], ['archive','3','ht2c'], ['archive','4','ht3'],
  ['archive','5','sert'], ['archive','6','d1'], ['archive','7','d2'], ['archive','8','d3'],
  ['archive','9','dat'], ['archive','10','a1'], ['archive','11','a2'], ['archive','12','b1'],
  ['archive','13','net'], ['archive','14','nmda'], ['archive','15','ampa'], ['archive','16','gabaa'],
  ['archive','17','gabab'], ['archive','18','m1'], ['archive','19','nachr'], ['archive','20','h1'],
  ['archive','21','mor'], ['archive','22','mt'], ['archive','23','ox'],
```

(These are seeded by the existing `seedAliases()` — no other change needed.)

**Step 4: Run → pass.**

**Step 5: Commit** `feat: archive entry aliases`.

---

## Task 2: Extract the Archive narrative into the DB

The `ENTRIES` literal is NOT pure data — fields like `figureSvg: gpcrSvg({accent:6})` and `figureLabel: SVG_LABELS.gpcr` are function calls / identifier refs. The existing `extractLiteral` (which does `new Function('return ' + lit)()`) would throw a ReferenceError on it. So we (a) expose the raw-text slicer from `migrate-structured.js`, and (b) evaluate `ENTRIES` inside a Proxy sandbox where any unknown identifier resolves to a harmless no-op (so the figure fields become `undefined`, which we ignore).

**Files:**
- Modify: `scripts/migrate-structured.js` (export a `sliceLiteral` helper)
- Create: `scripts/migrate-archive.js`
- Modify: `scripts/migrate.js` (run it best-effort)
- Test: `test/migrate-archive.test.js`

**Step 1: Refactor `migrate-structured.js` to expose the raw slicer** (behavior of `extractLiteral` is unchanged). Replace the body of `extractLiteral` so the bracket-matching lives in an exported `sliceLiteral`:

```js
// Return the raw text of a balanced literal (array `[...]` or object `{...}`) by name.
export function sliceLiteral(src, declName, open = '[', close = ']') {
  const re = new RegExp(declName + '\\s*=\\s*\\' + open);
  const m = re.exec(src);
  if (!m) throw new Error('declaration not found: ' + declName);
  const start = src.indexOf(open, m.index);
  let depth = 0, str = null, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === str) str = null;
    } else if (c === '"' || c === "'" || c === '`') { str = c; }
    else if (c === open) { depth++; }
    else if (c === close) { if (--depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced literal: ' + declName);
}

// Evaluate a pure-data literal (used for AFF_AGENTS, DATA, CANON2NO).
export function extractLiteral(src, declName, open = '[', close = ']') {
  return new Function('return ' + sliceLiteral(src, declName, open, close))();
}
```

Run `node --test test/migrate-structured.test.js` → still PASS (no behavior change).

**Step 2: Write the failing test**

```js
// test/migrate-archive.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { migrateArchive } from '../scripts/migrate-archive.js';

test('migrate loads archive_entries for every Archive receptor', () => {
  const db = openDb(':memory:');
  migrate(db);
  const n = db.prepare('SELECT COUNT(*) c FROM archive_entries').get().c;
  assert.equal(n, 23);
});

test('archive_entries resolve to receptor ids and keep list fields as JSON', () => {
  const db = openDb(':memory:');
  migrate(db);
  const gabaa = db.prepare('SELECT * FROM archive_entries WHERE receptor_id=?').get('gabaa');
  assert.ok(gabaa && gabaa.abstract && gabaa.abstract.length > 10);
  const body = JSON.parse(gabaa.body_json);
  assert.ok(Array.isArray(body) && body.length > 0);
});

test('migrateArchive is idempotent (clear + reload)', () => {
  const db = openDb(':memory:');
  migrate(db);
  const first = db.prepare('SELECT COUNT(*) c FROM archive_entries').get().c;
  migrateArchive(db); migrateArchive(db);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM archive_entries').get().c, first);
});
```

**Step 3: Run → fail** (`migrateArchive` not exported).

**Step 4: Create `scripts/migrate-archive.js`**

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from '../db/index.js';
import { sliceLiteral } from './migrate-structured.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARCHIVE = join(HERE, '..', 'public', 'receptor-function.html');

// Evaluate the ENTRIES literal in a sandbox where any unknown identifier (e.g. the
// figure generators gpcrSvg/SVG_LABELS) resolves to a no-op, so figure fields become
// undefined and only the prose survives. Safe: input is our own repo file.
function evalEntries(src) {
  const lit = sliceLiteral(src, 'ENTRIES');
  const sandbox = new Proxy({}, { has: () => true, get: () => () => undefined });
  return new Function('__sb', 'with(__sb){ return (' + lit + '); }')(sandbox);
}

export function migrateArchive(db) {
  const ENTRIES = evalEntries(readFileSync(ARCHIVE, 'utf8'));
  const alias = (n) => db.prepare(
    "SELECT receptor_id FROM receptor_aliases WHERE volume='archive' AND alias=?").get(String(n))?.receptor_id ?? null;
  const ins = db.prepare(`
    INSERT OR REPLACE INTO archive_entries
      (receptor_id, abstract, presentation, effect, receptor_class, ligand, figure_caption, body_json, tags_json)
    VALUES (@receptor_id,@abstract,@presentation,@effect,@receptor_class,@ligand,@figure_caption,@body_json,@tags_json)`);
  let n = 0;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM archive_entries').run();
    for (const e of ENTRIES) {
      const rid = alias(e.number); if (!rid) continue;
      const x = e.exhibit || {};
      ins.run({
        receptor_id: rid,
        abstract: x.abstract ?? null, presentation: x.presentation ?? null, effect: x.effect ?? null,
        receptor_class: x.receptorClass ?? null, ligand: x.ligand ?? null, figure_caption: x.figureCaption ?? null,
        body_json: JSON.stringify(x.body ?? []), tags_json: JSON.stringify(x.tags ?? []),
      });
      n++;
    }
  });
  tx();
  return { archive: n };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDb();
  console.log('archive entries:', migrateArchive(db).archive);
}
```

**Step 5: Wire into `migrate()`** in `scripts/migrate.js`. Add an import and a best-effort runner, and call it in both `migrate()` return paths next to `structuredBestEffort(db)`:

```js
import { migrateArchive } from './migrate-archive.js';
// ...
function archiveBestEffort(db) {
  try { return migrateArchive(db); } catch (e) { return { archive: 0, error: e.message }; }
}
```
Then in `migrate()`: after each `structuredBestEffort(db);` add `archiveBestEffort(db);` (both the already-seeded branch and the fresh-seed branch).

**Step 6: Run → pass.** `node --test test/migrate-archive.test.js`.

**Step 7: Rebuild the real DB** (it needs the new table + data): stop any running server, then `rm -f db/atlas.db db/atlas.db-*` and `npm run migrate`. Confirm: `node -e "import('./db/index.js').then(m=>{const db=m.openDb();console.log(db.prepare('SELECT COUNT(*) c FROM archive_entries').get().c)})"` → `23`.

**Step 8: Commit** `feat: migrate Archive narrative into archive_entries`.

---

## Task 3: `GET /api/atlas/archive/narrative`

**Files:**
- Modify: `lib/queries.js` (add `archiveNarrative`)
- Modify: `lib/router.js` (import + route)
- Test: `test/api-archive-narrative.test.js`

**Step 1: Write the failing test**

```js
// test/api-archive-narrative.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

let server, base;
before(async () => { server = createServer(':memory:', { seed: true });
  await new Promise(r => server.listen(0, r)); base = `http://localhost:${server.address().port}`; });
after(() => server.close());

test('GET /api/atlas/archive/narrative returns all entries with array list fields', async () => {
  const rows = await (await fetch(`${base}/api/atlas/archive/narrative`)).json();
  assert.equal(rows.length, 23);
  const gabaa = rows.find(r => r.receptor_id === 'gabaa');
  assert.equal(gabaa.alias, '16');
  assert.ok(gabaa.abstract.length > 10);
  assert.ok(Array.isArray(gabaa.body) && gabaa.body.length > 0);
  assert.ok(Array.isArray(gabaa.tags));
});
```

**Step 2: Run → fail.**

**Step 3: Add `archiveNarrative` to `lib/queries.js`**

```js
export function archiveNarrative(db) {
  return db.prepare(`
    SELECT ae.receptor_id, ra.alias, ae.abstract, ae.presentation, ae.effect,
           ae.receptor_class, ae.ligand, ae.figure_caption, ae.body_json, ae.tags_json
    FROM archive_entries ae
    LEFT JOIN receptor_aliases ra ON ra.receptor_id = ae.receptor_id AND ra.volume = 'archive'
    ORDER BY CAST(ra.alias AS INTEGER)
  `).all().map(r => ({
    receptor_id: r.receptor_id, alias: r.alias,
    abstract: r.abstract, presentation: r.presentation, effect: r.effect,
    receptor_class: r.receptor_class, ligand: r.ligand, figure_caption: r.figure_caption,
    body: JSON.parse(r.body_json || '[]'), tags: JSON.parse(r.tags_json || '[]'),
  }));
}
```

**Step 4: Add the route** in `lib/router.js`. Update the import: `import { reviewDrift, cabinetBinding, ledgerClinical, archiveNarrative } from './queries.js';` and add (next to the cabinet/ledger structured routes):

```js
    {
      method: 'GET',
      pattern: /^\/api\/atlas\/archive\/narrative$/,
      handler: (req, res) => json(res, 200, archiveNarrative(db)),
    },
```

**Step 5: Run → pass.** **Step 6: Commit** `feat: GET /api/atlas/archive/narrative`.

---

## Task 4: Edit the narrative via `/api/receptors/:id/structured`

**Files:**
- Modify: `lib/router.js`
- Test: `test/api-narrative-edit.test.js`

**Step 1: Write the failing test**

```js
// test/api-narrative-edit.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

let server, base;
before(async () => { server = createServer(':memory:', { seed: true });
  await new Promise(r => server.listen(0, r)); base = `http://localhost:${server.address().port}`; });
after(() => server.close());

test('GET structured includes the narrative block', async () => {
  const s = await (await fetch(`${base}/api/receptors/gabaa/structured`)).json();
  assert.ok(s.narrative && typeof s.narrative.abstract === 'string');
  assert.ok(Array.isArray(s.narrative.body));
});

test('PATCH narrative persists fields, round-trips lists, stamps archive activity', async () => {
  const res = await fetch(`${base}/api/receptors/gabaa/structured`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume: 'archive', narrative: { abstract: 'NEW abstract', body: ['p1', 'p2'], tags: ['t1'] } }),
  });
  assert.equal(res.status, 200);
  const s = await (await fetch(`${base}/api/receptors/gabaa/structured`)).json();
  assert.equal(s.narrative.abstract, 'NEW abstract');
  assert.deepEqual(s.narrative.body, ['p1', 'p2']);
  assert.deepEqual(s.narrative.tags, ['t1']);
  assert.ok(s.activity.archive?.last_edited_at, 'archive section stamped');
});
```

**Step 2: Run → fail.**

**Step 3: Extend the structured handler** in `lib/router.js`:

- Add prepared read near the other structured statements:
  ```js
  const archiveRowStmt = db.prepare('SELECT * FROM archive_entries WHERE receptor_id = ?');
  const NARRATIVE_SCALAR = ['abstract', 'presentation', 'effect', 'receptor_class', 'ligand', 'figure_caption'];
  const NARRATIVE_LIST = { body: 'body_json', tags: 'tags_json' };
  ```
- In `structuredFor(id)`, build and include `narrative`:
  ```js
  const aRow = archiveRowStmt.get(id);
  const narrative = aRow ? {
    abstract: aRow.abstract, presentation: aRow.presentation, effect: aRow.effect,
    receptor_class: aRow.receptor_class, ligand: aRow.ligand, figure_caption: aRow.figure_caption,
    body: JSON.parse(aRow.body_json || '[]'), tags: JSON.parse(aRow.tags_json || '[]'),
  } : null;
  // add `narrative` to the returned object
  ```
- In the PATCH handler, add `hasNarrative` to the change detection and apply it inside the transaction:
  ```js
  const hasNarrative = body.narrative && typeof body.narrative === 'object';
  // include hasNarrative in the "nothing to change" guard:
  if (!hasClaim && !hasBinding && !hasClinical && !hasNarrative) return json(res, 400, { error: 'nothing to change' });
  // inside db.transaction(() => { ... }) :
  if (hasNarrative) {
    const nv = body.narrative, sets = [], params = { id };
    for (const k of NARRATIVE_SCALAR) if (k in nv) { sets.push(`${k} = @${k}`); params[k] = nv[k]; }
    for (const k in NARRATIVE_LIST) if (k in nv) { sets.push(`${NARRATIVE_LIST[k]} = @${k}`); params[k] = JSON.stringify(nv[k] ?? []); }
    if (sets.length) db.prepare(`UPDATE archive_entries SET ${sets.join(', ')} WHERE receptor_id = @id`).run(params);
  }
  ```
  (`volume: 'archive'` already stamps `section_activity` — no change needed there.)

**Step 4: Run → pass.** **Step 5: Commit** `feat: edit Archive narrative via /structured`.

---

## Task 5: Desk "Archive narrative" editor section

No unit test (browser wiring) — verified by running.

**Files:** Modify `public/the-conservators-desk.html`.

**Step 1: Render the section.** In `structEditorHtml(data)`, after the binding section and before the final `return html;`, add (only when a narrative exists):

```js
  if (data.narrative) {
    const nv = data.narrative;
    html += `<div class="struct-sec"><div class="pk">Archive narrative</div>
      <div class="struct-field"><span>abstract</span><textarea data-nk="abstract" rows="3">${esc(nv.abstract||'')}</textarea></div>
      <div class="struct-field"><span>body (one paragraph per blank-line block)</span><textarea data-nk="body" rows="6">${esc((nv.body||[]).join('\n\n'))}</textarea></div>
      <div class="struct-field"><span>presentation</span><textarea data-nk="presentation" rows="2">${esc(nv.presentation||'')}</textarea></div>
      <div class="struct-field"><span>effect</span><input data-nk="effect" value="${esc(nv.effect||'')}" /></div>
      <div class="struct-field"><span>receptor class</span><input data-nk="receptor_class" value="${esc(nv.receptor_class||'')}" /></div>
      <div class="struct-field"><span>ligand</span><input data-nk="ligand" value="${esc(nv.ligand||'')}" /></div>
      <div class="struct-field"><span>tags (one per line)</span><textarea data-nk="tags" rows="3">${esc((nv.tags||[]).join('\n'))}</textarea></div>
      <div class="struct-field"><span>figure caption</span><input data-nk="figure_caption" value="${esc(nv.figure_caption||'')}" /></div></div>`;
  }
```

**Step 2: Wire the inputs.** In `wireStructEditor(r,bodyEl)`, add:

```js
  bodyEl.querySelectorAll('[data-nk]').forEach(f => f.addEventListener('input', () => {
    const k = f.dataset.nk;
    let val = f.value;
    if (k === 'body') val = f.value.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);   // blank-line split
    else if (k === 'tags') val = f.value.split('\n').map(s => s.trim()).filter(Boolean);
    patchStructuredDebounced(r.id, r.id + ':n:' + k, { volume: 'archive', narrative: { [k]: val } }, bodyEl);
  }));
```

(Reuses the existing `patchStructuredDebounced` → `markEdited` so the edited-date and drift flag update live.)

**Step 3: Verify by running.** Stop any server; `node server.js`; open `http://localhost:3000/the-conservators-desk.html`. Expand a receptor that's in the Archive (e.g. GABA-A), open **Edit structured data**, confirm the **Archive narrative** fields appear and are populated. Edit the abstract; in the Network tab confirm a `PATCH …/structured` returns 200; reload and confirm the new abstract is still there. Confirm no console errors.

**Step 4: Commit** `feat: desk Archive narrative editor`.

---

## Task 6: Archive page renders narrative from the DB + end-to-end

No unit test (browser rendering) — verified by running.

**Files:** Modify `public/receptor-function.html`.

**Step 1: Add the hydrate function.** In the main `<script>` (the one that defines `ENTRIES` and `renderHalls`), add near the other helpers:

```js
  // Fill each ENTRIES entry's prose from the DB (the single source of truth) before
  // first render, matched by entry number. Best-effort: offline/file:// keeps embedded text.
  async function hydrateNarrativeFromApi() {
    try {
      const rows = await (await fetch('/api/atlas/archive/narrative')).json();
      const byNo = {}; rows.forEach(r => { byNo[r.alias] = r; });
      ENTRIES.forEach(e => {
        const a = byNo[String(e.number)]; if (!a || !e.exhibit) return;
        const x = e.exhibit;
        if (a.abstract != null) x.abstract = a.abstract;
        if (Array.isArray(a.body)) x.body = a.body;
        if (a.presentation != null) x.presentation = a.presentation;
        if (a.effect != null) x.effect = a.effect;
        if (a.receptor_class != null) x.receptorClass = a.receptor_class;
        if (a.ligand != null) x.ligand = a.ligand;
        if (Array.isArray(a.tags)) x.tags = a.tags;
        if (a.figure_caption != null) x.figureCaption = a.figure_caption;
      });
    } catch (e) { /* offline / file://: keep embedded ENTRIES */ }
  }
```

**Step 2: Await it before the initial render.** Find the boot sequence near the end of that script (the lines that call `renderHalls(); renderCatalog(); renderRailMarkers(); … route();`, around lines 2626–2642). Wrap that boot block in an async IIFE that awaits hydration first, e.g.:

```js
  (async () => {
    await hydrateNarrativeFromApi();
    renderHalls();
    renderCatalog();
    const railMarkers = renderRailMarkers();
    // …keep the rest of the existing boot block exactly as-is, through route();
  })();
```

(Only the wrapping + the `await` line are new; do not change the existing boot statements. This is a classic script, so top-level `await` is not available — the IIFE is required.)

**Step 3: End-to-end verify.** Stop any server; `node server.js`. In the desk (`/the-conservators-desk.html`), edit GABA-A's **abstract** in the Archive narrative editor to a distinctive string and let it save. Open the Archive (`/receptor-function.html`), navigate to the GABA-A entry, and confirm the new abstract text shows. Confirm the Archive still renders normally (figures, navigation) with no console errors.

**Step 4: Run the whole suite** — `npm test`. Expected: all tests pass (the prior 50 plus the new archive tests).

**Step 5: Commit** `feat: Archive renders narrative from the DB; Wave 1 complete`.

---

## Out of scope (future Wave 2)
Cabinet long descriptions / state write-ups / drug lists; the cover page; the desk **layout** cleanup (parked on branch `cleanup-desk-layout`).
