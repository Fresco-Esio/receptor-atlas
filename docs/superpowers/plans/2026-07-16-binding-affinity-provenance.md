# Binding-Affinity Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Cabinet's 136 binding-affinity Ki values into the existing `sources` citation library and give the Conservator's Desk a drug-first section to authenticate each number and its source.

**Architecture:** Mirror the shipped `sources`/`receptor_sources` provenance pattern. Two new tables (`binding_sources` for citation edges, `binding_review` for the per-number check) plus a tiny `binding_source_tags` map, all keyed on the **stable `(agent_name, target_alias)` pair** — never on `binding_values.id`, which is regenerated on every server restart (verified by probe). A seed migration converts the 17 free-text `src` tags into ~13 real source records; new read/write API routes twin the receptor-source routes; a new drug-first Desk section reuses the `.srow` citation markup.

**Tech Stack:** Node (ESM), `better-sqlite3`, `node:http`, `node --test`, single-file HTML+vanilla-JS front end.

**Spec:** `docs/superpowers/specs/2026-07-16-binding-affinity-provenance-design.md`

---

## Key facts the implementer must know

- **`binding_values` is rebuilt on every startup.** `server.js` calls `migrate(db)` on boot; `migrate()` (scripts/migrate.js:56) calls `structuredBestEffort` → `migrateStructured`, which does `DELETE FROM binding_values` and re-inserts. So `binding_values.id` is **not stable** (a probe saw id 1 → 137 across a restart). The stable identity is `(agent_name, target_alias)`. All durable provenance keys off that pair.
- **The seed migration must be non-destructive on re-run.** It runs every startup. It uses a persistent `binding_source_tags` map (tag → source_id) so it never creates duplicate `sources`, and `INSERT OR IGNORE` for edges so a curator's later `verified`/`conflicting` status is never reset.
- **`src` on `binding_values` is preserved** as the as-imported label. It is never deleted.
- **Test harness pattern:** `createServer(':memory:', { seed: true })`, `node:test`, `fetch` against `http://localhost:${server.address().port}`. Migration/query unit tests use `openDb(':memory:')` + `migrate(db)` directly. See `test/api-structured.test.js` and `test/api-atlas-alias.test.js`.
- **The seeded DB contains 71 agents / 136 bindings / 17 src tags → 13 sources / 105 edges / 31 needs-source.** These exact numbers are the migration's acceptance criteria.

---

### Task 1: Schema — three new tables

**Goal:** Add `binding_sources`, `binding_review`, and `binding_source_tags` to the schema so fresh and existing DBs both gain them (all `CREATE TABLE IF NOT EXISTS`, no `ALTER`).

**Files:**
- Modify: `db/schema.sql` (append after the `binding_values` table block, ~line 78)
- Test: `test/schema-binding-provenance.test.js` (create)

**Acceptance Criteria:**
- [ ] Opening a fresh in-memory DB creates all three tables with the columns below.
- [ ] `binding_sources` PK is `(agent_name, target_alias, source_id)`; `binding_review` PK is `(agent_name, target_alias)`; `binding_source_tags` PK is `tag`.

**Verify:** `node --test test/schema-binding-provenance.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/schema-binding-provenance.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';

function cols(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

test('binding provenance tables exist with the stable-pair keys', () => {
  const db = openDb(':memory:');
  assert.deepEqual(cols(db, 'binding_sources'), ['agent_name', 'target_alias', 'source_id', 'status']);
  assert.deepEqual(cols(db, 'binding_review'), ['agent_name', 'target_alias', 'value_status']);
  assert.deepEqual(cols(db, 'binding_source_tags'), ['tag', 'source_id']);
});

test('binding_sources primary key is the stable pair + source', () => {
  const db = openDb(':memory:');
  const pk = db.prepare(`PRAGMA table_info(binding_sources)`).all().filter(c => c.pk).map(c => c.name);
  assert.deepEqual(pk.sort(), ['agent_name', 'source_id', 'target_alias']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/schema-binding-provenance.test.js`
Expected: FAIL — `no such table: binding_sources`.

- [ ] **Step 3: Add the tables to `db/schema.sql`**

Append after the `binding_values` `CREATE TABLE ... );` block (before `clinical_rows`):

```sql
-- Binding-affinity provenance (binding-affinity provenance feature). Keyed on the
-- STABLE (agent_name, target_alias) pair, NOT binding_values.id — that id is
-- regenerated on every startup because migrateStructured rebuilds binding_values.
-- binding_sources is the citation edge (a binding may cite any number of library
-- sources); status mirrors receptor_sources ('verified'|'provided'|'conflicting').
CREATE TABLE IF NOT EXISTS binding_sources (
  agent_name   TEXT NOT NULL,
  target_alias TEXT NOT NULL,
  source_id    INTEGER NOT NULL REFERENCES sources(id),
  status       TEXT NOT NULL DEFAULT 'provided',
  PRIMARY KEY (agent_name, target_alias, source_id)
);
-- The per-number transcription check, separate from citation soundness: does OUR Ki
-- match what the cited source says? A binding with no row here is implicitly 'unchecked'.
CREATE TABLE IF NOT EXISTS binding_review (
  agent_name   TEXT NOT NULL,
  target_alias TEXT NOT NULL,
  value_status TEXT NOT NULL DEFAULT 'unchecked',  -- 'unchecked' | 'confirmed' | 'mismatch'
  PRIMARY KEY (agent_name, target_alias)
);
-- Stable tag → source_id map so the seed migration is idempotent even after a curator
-- backfills a migrated source's title/authors: the mapping (not the source's mutable
-- fields) is what dedupes, so re-runs never create a duplicate sources row.
CREATE TABLE IF NOT EXISTS binding_source_tags (
  tag       TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id)
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/schema-binding-provenance.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql test/schema-binding-provenance.test.js
git commit -m "feat(schema): binding provenance tables keyed on the stable (agent,target) pair"
```

---

### Task 2: Seed migration — 17 src tags → 13 sources + 105 edges

**Goal:** Convert each binding's free-text `src` tag into a real `sources` record and a `binding_sources` edge, non-destructively, running every startup.

**Files:**
- Create: `scripts/migrate-binding-sources.js`
- Modify: `scripts/migrate.js` (call it after `structuredBestEffort` in both the skipped and fresh paths)
- Test: `test/migrate-binding-sources.test.js` (create)

**Acceptance Criteria:**
- [ ] After `migrate(db)` on a fresh seeded DB: `binding_source_tags` has 13 rows, `binding_sources` has 105 rows, and 31 bindings have no edge (needs-source).
- [ ] Re-running `migrate(db)` keeps those counts identical (idempotent) and preserves a status a test manually set to `verified`.
- [ ] PDSP source's edge count is 41 (40 `PDSP Ki DB` + 1 `PDSP / literature`).

**Verify:** `node --test test/migrate-binding-sources.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/migrate-binding-sources.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';

test('migration seeds 13 sources, 105 edges, 31 needs-source', () => {
  const db = openDb(':memory:');
  migrate(db);
  const sources = db.prepare('SELECT COUNT(*) c FROM binding_source_tags').get().c;
  const edges   = db.prepare('SELECT COUNT(*) c FROM binding_sources').get().c;
  const total   = db.prepare('SELECT COUNT(*) c FROM binding_values').get().c;
  const withEdge = db.prepare(`
    SELECT COUNT(*) c FROM binding_values bv
    WHERE EXISTS (SELECT 1 FROM binding_sources bs
                  WHERE bs.agent_name = bv.agent_name AND bs.target_alias = bv.target_alias)
  `).get().c;
  assert.equal(sources, 13);
  assert.equal(edges, 105);
  assert.equal(total, 136);
  assert.equal(total - withEdge, 31);   // needs-source
});

test('PDSP Ki DB (incl. "PDSP / literature") owns 41 edges', () => {
  const db = openDb(':memory:');
  migrate(db);
  const sid = db.prepare(`SELECT source_id FROM binding_source_tags WHERE tag = 'PDSP Ki DB'`).get().source_id;
  const n = db.prepare('SELECT COUNT(*) c FROM binding_sources WHERE source_id = ?').get(sid).c;
  assert.equal(n, 41);
});

test('re-run is idempotent and preserves a curator-set status', () => {
  const db = openDb(':memory:');
  migrate(db);
  // curator verifies one edge
  const edge = db.prepare('SELECT * FROM binding_sources LIMIT 1').get();
  db.prepare('UPDATE binding_sources SET status = ? WHERE agent_name = ? AND target_alias = ? AND source_id = ?')
    .run('verified', edge.agent_name, edge.target_alias, edge.source_id);
  // restart: re-run migrate
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM binding_sources').get().c, 105);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM binding_source_tags').get().c, 13);
  const after = db.prepare('SELECT status FROM binding_sources WHERE agent_name = ? AND target_alias = ? AND source_id = ?')
    .get(edge.agent_name, edge.target_alias, edge.source_id).status;
  assert.equal(after, 'verified');   // NOT reset to 'provided'
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/migrate-binding-sources.test.js`
Expected: FAIL — migration not wired, counts are 0.

- [ ] **Step 3: Write `scripts/migrate-binding-sources.js`**

```js
import { pathToFileURL } from 'node:url';
import { openDb } from '../db/index.js';

// Each of the 17 binding `src` tags resolves to one of: a source TEMPLATE (real record),
// an ALIAS to another tag, or UNATTRIBUTED (no source — the binding is needs-source).
// Article shells intentionally leave authors/title blank for the curator to backfill via
// the Desk; dedup survives that backfill because binding_source_tags maps by tag, not by
// the source's mutable fields.
const SOURCE_TEMPLATES = {
  'PDSP Ki DB':      { kind: 'database', authors: 'NIMH PDSP', title: 'Ki Database (PDSP)', url: 'https://pdsp.unc.edu/databases/kidb.php' },
  'IUPHAR/BPS':      { kind: 'database', authors: 'IUPHAR/BPS', title: 'Guide to PHARMACOLOGY', url: 'https://www.guidetopharmacology.org/' },
  'StatPearls':      { kind: 'database', authors: 'StatPearls Publishing', title: 'StatPearls', url: 'https://www.ncbi.nlm.nih.gov/books/NBK430685/' },
  'Proudman 2020':   { kind: 'article', authors: 'Proudman et al.', year: 2020, notes: 'imported from binding tag "Proudman 2020" — verify & complete' },
  'Neuropsychopharmacology 2009': { kind: 'article', journal: 'Neuropsychopharmacology', year: 2009, notes: 'imported from binding tag — verify & complete' },
  'J Neural Transm 2003':         { kind: 'article', journal: 'J Neural Transm', year: 2003, notes: 'imported from binding tag — verify & complete' },
  'Biol Psychiatry 2001':         { kind: 'article', journal: 'Biol Psychiatry', year: 2001, notes: 'imported from binding tag — verify & complete' },
  'Eur Neuropsychopharmacol 2020':{ kind: 'article', journal: 'Eur Neuropsychopharmacol', year: 2020, notes: 'imported from binding tag — verify & complete' },
  'eLife 2020':      { kind: 'article', journal: 'eLife', year: 2020, notes: 'imported from binding tag — verify & complete' },
  'PMC5756147':      { kind: 'article', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5756147/', notes: 'PMCID PMC5756147 — verify & complete' },
  'PMC4662164':      { kind: 'article', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4662164/', notes: 'PMCID PMC4662164 — verify & complete' },
  'PMC5437659':      { kind: 'article', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5437659/', notes: 'PMCID PMC5437659 — verify & complete' },
  'PMC10851641':     { kind: 'article', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10851641/', notes: 'PMCID PMC10851641 — verify & complete' },
};
const TAG_ALIAS = { 'PDSP / literature': 'PDSP Ki DB' };
const UNATTRIBUTED = new Set(['literature', 'literature (tier)', 'qualitative']);

const SRC_COLS = ['kind', 'authors', 'year', 'title', 'journal', 'pmid', 'doi', 'url', 'notes'];

/**
 * Seed binding_sources + binding_source_tags from each binding's `src` tag. Runs every
 * startup (binding_values is rebuilt each boot). Non-destructive: INSERT OR IGNORE edges,
 * and reuse the tag→source_id map so a re-run neither duplicates sources nor resets a
 * curator's edge status. binding_review is never touched here (pure user data).
 * Returns { sources, edges, needs }.
 */
export function migrateBindingSources(db) {
  const bindings = db.prepare('SELECT agent_name, target_alias, src FROM binding_values').all();
  const getTag = db.prepare('SELECT source_id FROM binding_source_tags WHERE tag = ?');
  const putTag = db.prepare('INSERT OR IGNORE INTO binding_source_tags (tag, source_id) VALUES (?, ?)');
  const insSource = db.prepare(`
    INSERT INTO sources (kind, authors, year, title, journal, pmid, doi, url, notes)
    VALUES (@kind, @authors, @year, @title, @journal, @pmid, @doi, @url, @notes)
  `);
  const insEdge = db.prepare(`
    INSERT OR IGNORE INTO binding_sources (agent_name, target_alias, source_id, status)
    VALUES (?, ?, ?, 'provided')
  `);

  let needs = 0;
  const tx = db.transaction(() => {
    for (const b of bindings) {
      const raw = b.src;
      if (raw == null || UNATTRIBUTED.has(raw)) { needs++; continue; }
      const tag = TAG_ALIAS[raw] ?? raw;
      const tpl = SOURCE_TEMPLATES[tag];
      if (!tpl) { needs++; continue; }   // unknown tag → needs-source, never crash

      let sid = getTag.get(tag)?.source_id;
      if (sid == null) {
        const row = {};
        for (const c of SRC_COLS) row[c] = tpl[c] ?? null;
        sid = insSource.run(row).lastInsertRowid;
        putTag.run(tag, sid);
      }
      insEdge.run(b.agent_name, b.target_alias, sid);
    }
  });
  tx();

  return {
    sources: db.prepare('SELECT COUNT(*) c FROM binding_source_tags').get().c,
    edges: db.prepare('SELECT COUNT(*) c FROM binding_sources').get().c,
    needs,
  };
}

// Run directly with `node scripts/migrate-binding-sources.js`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDb();
  const r = migrateBindingSources(db);
  console.log(`binding provenance: ${r.sources} sources, ${r.edges} edges, ${r.needs} needs-source`);
}
```

- [ ] **Step 4: Wire it into the migrate chain — `scripts/migrate.js`**

Add the import near the top (after the `migrateArchive` import, line 4):

```js
import { migrateBindingSources } from './migrate-binding-sources.js';
```

Add a best-effort wrapper next to `archiveBestEffort` (after line 20):

```js
function bindingSourcesBestEffort(db) {
  try { return migrateBindingSources(db); }
  catch (e) { return { sources: 0, edges: 0, needs: 0, error: e.message }; }
}
```

Call it after `structuredBestEffort` in BOTH paths. Change the already-seeded return (line 56) to:

```js
  if (existing > 0) { seedAliases(db); structuredBestEffort(db); bindingSourcesBestEffort(db); archiveBestEffort(db); return { skipped: true, receptors: existing }; }
```

And add it after the fresh-build `structuredBestEffort(db);` (line 109), before `archiveBestEffort(db);`:

```js
  structuredBestEffort(db);
  bindingSourcesBestEffort(db);
  archiveBestEffort(db);
```

Order matters: `bindingSourcesBestEffort` must run AFTER `structuredBestEffort` (it reads the freshly-rebuilt `binding_values`).

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/migrate-binding-sources.test.js`
Expected: PASS (all three tests).

- [ ] **Step 6: Run the full suite (nothing regressed)**

Run: `npm test`
Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate-binding-sources.js scripts/migrate.js test/migrate-binding-sources.test.js
git commit -m "feat(migrate): seed binding citation edges from src tags (13 sources, 105 edges)"
```

---

### Task 3: Read API — drug-first payload + source usage

**Goal:** Expose the drug-first provenance data and per-source binding usage the Desk section will render.

**Files:**
- Modify: `lib/queries.js` (add `agentBindingProvenance` and `bindingSourceUsage`)
- Modify: `lib/router.js` (import them; add two GET routes)
- Test: `test/api-binding-provenance.test.js` (create)

**Acceptance Criteria:**
- [ ] `GET /api/agents/binding` returns 71 agents; each binding has `sources[]`, a rolled-up `status`, `value_status`, and the preserved `src` label.
- [ ] A binding with a `literature` tag has `sources: []` and `status: 'needs-source'`.
- [ ] `GET /api/sources/binding-usage` returns one row per cited source with `count` and rolled-up `status`; the PDSP row has `count: 41`.

**Verify:** `node --test test/api-binding-provenance.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/api-binding-provenance.test.js`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

let server, base;
before(async () => {
  server = createServer(':memory:', { seed: true });
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('GET /api/agents/binding is drug-first with rolled-up provenance', async () => {
  const agents = await (await fetch(`${base}/api/agents/binding`)).json();
  assert.equal(agents.length, 71);
  const halo = agents.find(a => a.name === 'Haloperidol');
  assert.ok(halo && halo.bindings.length === 4);
  const d2 = halo.bindings.find(b => b.target_alias === 'dopamine_d2');
  assert.ok(d2.sources.length >= 1);
  assert.equal(d2.sources[0].status, 'provided');   // migration default
  assert.equal(d2.value_status, 'unchecked');
  assert.ok('src' in d2);                            // as-imported label preserved
});

test('an unattributed binding is needs-source with no edges', async () => {
  const agents = await (await fetch(`${base}/api/agents/binding`)).json();
  // Xanomeline's bindings are all literature/literature(tier) → needs-source
  const xan = agents.find(a => a.name === 'Xanomeline');
  assert.ok(xan.bindings.every(b => b.sources.length === 0));
  assert.ok(xan.bindings.every(b => b.status === 'needs-source'));
});

test('GET /api/sources/binding-usage counts edges per source', async () => {
  const usage = await (await fetch(`${base}/api/sources/binding-usage`)).json();
  const pdsp = usage.find(u => u.title === 'Ki Database (PDSP)');
  assert.equal(pdsp.count, 41);
  assert.ok(['verified', 'provided', 'conflicting'].includes(pdsp.status));
  assert.equal(usage.reduce((n, u) => n + u.count, 0), 105);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/api-binding-provenance.test.js`
Expected: FAIL — 404 (routes not defined).

- [ ] **Step 3: Add the queries to `lib/queries.js`**

Append (after `cabinetBinding`, ~line 110). Note `rollupStatus` is already exported in this file:

```js
/**
 * Drug-first binding provenance (binding-affinity provenance feature): one object per
 * agent, each with its bindings; each binding carries its attached library sources (with
 * per-edge status), a rolled-up citation status, the per-number value_status, and the
 * preserved as-imported `src` label. Joined on the STABLE (agent_name, target_alias) pair.
 */
export function agentBindingProvenance(db) {
  const rows = db.prepare(`
    SELECT bv.agent_name, bv.agent_group, bv.cid, bv.target_alias, bv.receptor_id,
           bv.ki, bv.ki_text, bv.act, bv.act_full, bv.src, bv.note,
           br.value_status
    FROM binding_values bv
    LEFT JOIN binding_review br
      ON br.agent_name = bv.agent_name AND br.target_alias = bv.target_alias
    ORDER BY bv.agent_name, bv.target_alias
  `).all();
  const edgeStmt = db.prepare(`
    SELECT s.id, s.kind, s.authors, s.year, s.title, s.journal, s.pmid, s.doi, s.url, bs.status
    FROM binding_sources bs JOIN sources s ON s.id = bs.source_id
    WHERE bs.agent_name = ? AND bs.target_alias = ?
    ORDER BY s.kind, s.year DESC
  `);
  const byAgent = new Map();
  for (const r of rows) {
    if (!byAgent.has(r.agent_name))
      byAgent.set(r.agent_name, { name: r.agent_name, g: r.agent_group, cid: r.cid, bindings: [] });
    const sources = edgeStmt.all(r.agent_name, r.target_alias);
    byAgent.get(r.agent_name).bindings.push({
      target_alias: r.target_alias, receptor_id: r.receptor_id,
      ki: r.ki, ki_text: r.ki_text, act: r.act, act_full: r.act_full,
      src: r.src, note: r.note,
      value_status: r.value_status || 'unchecked',
      status: rollupStatus(sources.map(s => s.status)),
      sources,
    });
  }
  return [...byAgent.values()];
}

/**
 * Per-source binding usage (binding-affinity provenance feature): for every source cited
 * by at least one binding, its bibliographic fields plus the number of binding edges and
 * their rolled-up status. Powers the Desk's by-source bulk-verify panel.
 */
export function bindingSourceUsage(db) {
  const rows = db.prepare(`
    SELECT s.id, s.kind, s.authors, s.year, s.title, s.journal, s.pmid, s.doi, s.url, bs.status
    FROM binding_sources bs JOIN sources s ON s.id = bs.source_id
  `).all();
  const bySource = new Map();
  for (const r of rows) {
    if (!bySource.has(r.id))
      bySource.set(r.id, { id: r.id, kind: r.kind, authors: r.authors, year: r.year, title: r.title,
                           journal: r.journal, pmid: r.pmid, doi: r.doi, url: r.url, statuses: [] });
    bySource.get(r.id).statuses.push(r.status);
  }
  return [...bySource.values()].map(({ statuses, ...s }) => ({
    ...s, count: statuses.length, status: rollupStatus(statuses),
  }));
}
```

- [ ] **Step 4: Add the routes to `lib/router.js`**

Extend the import on line 5:

```js
import { reviewDrift, cabinetBinding, ledgerClinical, archiveNarrative, rollupStatus, receptorStatuses, receptorSources, atlasVolume, agentBindingProvenance, bindingSourceUsage } from './queries.js';
```

Add two GET routes inside the returned array (place them right after the `GET /api/atlas/cabinet/binding` route, ~line 410):

```js
    {
      method: 'GET',
      pattern: /^\/api\/agents\/binding$/,
      handler: (req, res) => json(res, 200, agentBindingProvenance(db)),
    },
    {
      method: 'GET',
      pattern: /^\/api\/sources\/binding-usage$/,
      handler: (req, res) => json(res, 200, bindingSourceUsage(db)),
    },
```

Note: `binding-usage` must be registered so its literal path can't be captured by the `\/api\/sources\/(\d+)$` PATCH route — that route is PATCH-only and numeric, so a GET to `/api/sources/binding-usage` won't match it. No ordering hazard.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/api-binding-provenance.test.js`
Expected: PASS (all three tests).

- [ ] **Step 6: Commit**

```bash
git add lib/queries.js lib/router.js test/api-binding-provenance.test.js
git commit -m "feat(api): drug-first binding provenance + per-source usage read routes"
```

---

### Task 4: Write API — attach/status/unlink edges, value_status, bulk verify

**Goal:** Twin the receptor-source write routes for bindings, plus the per-number `value_status` route and the by-source bulk route.

**Files:**
- Modify: `lib/router.js` (add prepared statements + five routes)
- Test: `test/api-binding-write.test.js` (create)

**Acceptance Criteria:**
- [ ] `POST /api/bindings/:agent/:target/sources` with `{source_id, status}` attaches an edge; with `{source:{…}}` creates a library source and attaches it.
- [ ] `PATCH /api/bindings/:agent/:target/sources/:sid` updates edge status; invalid status → 400.
- [ ] `DELETE /api/bindings/:agent/:target/sources/:sid` removes the edge; the shared `sources` row remains.
- [ ] `PATCH /api/bindings/:agent/:target/review` upserts `value_status`; invalid value → 400.
- [ ] `PATCH /api/sources/:id/binding-status` sets every binding edge for that source at once.
- [ ] Unknown `(agent, target)` pair → 404.

**Verify:** `node --test test/api-binding-write.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/api-binding-write.test.js`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

let server, base;
before(async () => {
  server = createServer(':memory:', { seed: true });
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const j = (method, path, body) => fetch(`${base}${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
});
const enc = encodeURIComponent;

test('attach an existing library source to a binding', async () => {
  // Xanomeline @ muscarinic_m1 is needs-source; attach an existing source (id 1 exists after seed)
  const agent = 'Xanomeline', target = 'muscarinic_m1';
  const res = await j('POST', `/api/bindings/${enc(agent)}/${enc(target)}/sources`, { source_id: 1, status: 'provided' });
  assert.equal(res.status, 201);
  const agents = await (await fetch(`${base}/api/agents/binding`)).json();
  const b = agents.find(a => a.name === agent).bindings.find(x => x.target_alias === target);
  assert.equal(b.sources.length, 1);
  assert.equal(b.status, 'provided');
});

test('create-inline + attach, then update status, then unlink', async () => {
  const agent = 'Benztropine', target = 'muscarinic_m1';
  const post = await j('POST', `/api/bindings/${enc(agent)}/${enc(target)}/sources`,
    { source: { kind: 'article', authors: 'New A', year: 2024, title: 'Fresh' }, status: 'provided' });
  assert.equal(post.status, 201);
  const created = await post.json();
  const sid = created.id;

  const patch = await j('PATCH', `/api/bindings/${enc(agent)}/${enc(target)}/sources/${sid}`, { status: 'verified' });
  assert.equal(patch.status, 200);

  const bad = await j('PATCH', `/api/bindings/${enc(agent)}/${enc(target)}/sources/${sid}`, { status: 'nonsense' });
  assert.equal(bad.status, 400);

  const del = await j('DELETE', `/api/bindings/${enc(agent)}/${enc(target)}/sources/${sid}`);
  assert.equal(del.status, 200);
  // shared library row kept
  assert.equal((await fetch(`${base}/api/sources/${sid}`)).status, 200);
});

test('value_status upsert with whitelist', async () => {
  const agent = 'Diazepam', target = 'gaba_a';
  assert.equal((await j('PATCH', `/api/bindings/${enc(agent)}/${enc(target)}/review`, { value_status: 'confirmed' })).status, 200);
  assert.equal((await j('PATCH', `/api/bindings/${enc(agent)}/${enc(target)}/review`, { value_status: 'bogus' })).status, 400);
  const agents = await (await fetch(`${base}/api/agents/binding`)).json();
  const b = agents.find(a => a.name === agent).bindings.find(x => x.target_alias === target);
  assert.equal(b.value_status, 'confirmed');
});

test('bulk: verify a source sets all its binding edges', async () => {
  const usage = await (await fetch(`${base}/api/sources/binding-usage`)).json();
  const pdsp = usage.find(u => u.title === 'Ki Database (PDSP)');
  const res = await j('PATCH', `/api/sources/${pdsp.id}/binding-status`, { status: 'verified' });
  assert.equal(res.status, 200);
  const after = await (await fetch(`${base}/api/sources/binding-usage`)).json();
  assert.equal(after.find(u => u.id === pdsp.id).status, 'verified');
});

test('unknown binding pair is 404', async () => {
  assert.equal((await j('POST', `/api/bindings/Nobody/nowhere/sources`, { source_id: 1 })).status, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/api-binding-write.test.js`
Expected: FAIL — 404s (routes not defined).

- [ ] **Step 3: Add prepared statements to `lib/router.js`**

Inside `apiRoutes(db)`, near the other binding statements (after `bindingForReceptorStmt`, ~line 129), add:

```js
  // Binding-affinity provenance: edges + per-number review keyed on the stable pair.
  const VALUE_STATUS = new Set(['unchecked', 'confirmed', 'mismatch']);
  const bindingPairExistsStmt = db.prepare(
    `SELECT 1 FROM binding_values WHERE agent_name = ? AND target_alias = ? LIMIT 1`);
  const attachBindingSourceStmt = db.prepare(`
    INSERT INTO binding_sources (agent_name, target_alias, source_id, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(agent_name, target_alias, source_id) DO UPDATE SET status = excluded.status
  `);
  const getBindingEdgeStmt = db.prepare(
    `SELECT 1 FROM binding_sources WHERE agent_name = ? AND target_alias = ? AND source_id = ?`);
  const updBindingEdgeStmt = db.prepare(
    `UPDATE binding_sources SET status = ? WHERE agent_name = ? AND target_alias = ? AND source_id = ?`);
  const delBindingEdgeStmt = db.prepare(
    `DELETE FROM binding_sources WHERE agent_name = ? AND target_alias = ? AND source_id = ?`);
  const upsertBindingReviewStmt = db.prepare(`
    INSERT INTO binding_review (agent_name, target_alias, value_status)
    VALUES (?, ?, ?)
    ON CONFLICT(agent_name, target_alias) DO UPDATE SET value_status = excluded.value_status
  `);
  const bulkBindingStatusStmt = db.prepare(
    `UPDATE binding_sources SET status = ? WHERE source_id = ?`);
  // Small read helper: the sources currently attached to one binding pair (for responses).
  const bindingEdgesStmt = db.prepare(`
    SELECT s.id, s.kind, s.authors, s.year, s.title, s.journal, s.pmid, s.doi, s.url, bs.status
    FROM binding_sources bs JOIN sources s ON s.id = bs.source_id
    WHERE bs.agent_name = ? AND bs.target_alias = ? ORDER BY s.kind, s.year DESC
  `);
```

- [ ] **Step 4: Add the five routes to `lib/router.js`**

Add after the two GET routes from Task 3 (they share the `CITATION_STATUS` set already defined at ~line 95, and `insertSourceStmt`/`getSourceStmt`/`sourceCols` defined at ~line 76–88):

```js
    // Binding-affinity provenance: attach a library source (or create-inline) to a binding.
    {
      method: 'POST',
      pattern: /^\/api\/bindings\/([^/]+)\/([^/]+)\/sources$/,
      handler: async (req, res, m) => {
        const agent = decodeURIComponent(m[1]), target = decodeURIComponent(m[2]);
        if (!bindingPairExistsStmt.get(agent, target)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        const status = body.status ?? 'provided';
        if (!CITATION_STATUS.has(status)) return json(res, 400, { error: 'invalid status' });

        let sourceId;
        if (body.source_id != null) {
          sourceId = Number(body.source_id);
          if (!getSourceStmt.get(sourceId)) return json(res, 400, { error: 'unknown source_id' });
        } else if (body.source && typeof body.source === 'object') {
          const row = {};
          for (const k of sourceCols) row[k] = body.source[k] ?? null;
          row.kind = body.source.kind ?? 'article';
          sourceId = insertSourceStmt.run(row).lastInsertRowid;
        } else {
          return json(res, 400, { error: 'source_id or source is required' });
        }

        attachBindingSourceStmt.run(agent, target, sourceId, status);
        json(res, 201, getSourceStmt.get(sourceId));
      },
    },
    // Update one binding edge's status.
    {
      method: 'PATCH',
      pattern: /^\/api\/bindings\/([^/]+)\/([^/]+)\/sources\/(\d+)$/,
      handler: async (req, res, m) => {
        const agent = decodeURIComponent(m[1]), target = decodeURIComponent(m[2]), sid = Number(m[3]);
        if (!getBindingEdgeStmt.get(agent, target, sid)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        if (!CITATION_STATUS.has(body.status)) return json(res, 400, { error: 'invalid status' });
        updBindingEdgeStmt.run(body.status, agent, target, sid);
        json(res, 200, bindingEdgesStmt.all(agent, target));
      },
    },
    // Unlink a source from a binding (keeps the shared library row).
    {
      method: 'DELETE',
      pattern: /^\/api\/bindings\/([^/]+)\/([^/]+)\/sources\/(\d+)$/,
      handler: (req, res, m) => {
        const agent = decodeURIComponent(m[1]), target = decodeURIComponent(m[2]), sid = Number(m[3]);
        if (!getBindingEdgeStmt.get(agent, target, sid)) return json(res, 404, { error: 'not found' });
        delBindingEdgeStmt.run(agent, target, sid);
        json(res, 200, { deleted: sid });
      },
    },
    // Set a binding's per-number value_status.
    {
      method: 'PATCH',
      pattern: /^\/api\/bindings\/([^/]+)\/([^/]+)\/review$/,
      handler: async (req, res, m) => {
        const agent = decodeURIComponent(m[1]), target = decodeURIComponent(m[2]);
        if (!bindingPairExistsStmt.get(agent, target)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        if (!VALUE_STATUS.has(body.value_status)) return json(res, 400, { error: 'invalid value_status' });
        upsertBindingReviewStmt.run(agent, target, body.value_status);
        json(res, 200, { agent_name: agent, target_alias: target, value_status: body.value_status });
      },
    },
    // Bulk: set every binding edge citing this source to one status.
    {
      method: 'PATCH',
      pattern: /^\/api\/sources\/(\d+)\/binding-status$/,
      handler: async (req, res, m) => {
        const sid = Number(m[1]);
        if (!getSourceStmt.get(sid)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        if (!CITATION_STATUS.has(body.status)) return json(res, 400, { error: 'invalid status' });
        const info = bulkBindingStatusStmt.run(body.status, sid);
        json(res, 200, { source_id: sid, status: body.status, updated: info.changes });
      },
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/api-binding-write.test.js`
Expected: PASS (all six tests).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass. (The `PATCH /api/sources/(\d+)$` library route and the new `PATCH /api/sources/(\d+)/binding-status$` route have distinct patterns — no collision.)

- [ ] **Step 7: Commit**

```bash
git add lib/router.js test/api-binding-write.test.js
git commit -m "feat(api): binding source edges, value_status, and bulk source-status routes"
```

---

### Task 5: Desk UI — data layer, section shell, summary strip

**Goal:** Load the new data into the Desk and render the empty section scaffold with a live summary strip. Teach the shared source helpers about `kind:'database'`.

**Files:**
- Modify: `public/the-conservators-desk.html` (data loaders, section HTML, summary render, `kindLabel`, `newSourceFormHtml`)

**Acceptance Criteria:**
- [ ] On load, the Desk fetches `/api/agents/binding` and `/api/sources/binding-usage` without console errors.
- [ ] A new "Binding affinities" section renders after the halls, showing a summary strip: numbers confirmed (0/136 initially), sources verified (0/13), needs-source (31).
- [ ] `kindLabel` returns "Database" for `kind:'database'`; the add-source form's Kind `<select>` includes a Database option.

**Verify:** Browser — load `http://localhost:3000/the-conservators-desk.html`, confirm the section and correct tallies; `read_console_messages` shows no errors.

**Steps:**

- [ ] **Step 1: Add data loaders**

Near `loadSources` (line 474), add globals and loaders:

```js
let AGENTS=[], BINDING_USAGE=[];
async function loadAgents(){ AGENTS = await (await fetch('/api/agents/binding')).json(); }
async function loadBindingUsage(){ BINDING_USAGE = await (await fetch('/api/sources/binding-usage')).json(); }
```

Add both to the `Promise.all` in `init()` (line 999):

```js
    await Promise.all([loadRX(), loadSources(), loadDrift(), loadAgents(), loadBindingUsage()]);
```

- [ ] **Step 2: Teach the shared helpers about databases**

Change `kindLabel` (line 657):

```js
function kindLabel(s){return s.kind==='book'?'Book':s.kind==='database'?'Database':'Article';}
```

Add a Database option in `newSourceFormHtml` (line 693), inside the Kind `<select>`:

```js
    <label class="srcfield"><span>Kind</span><select data-k="kind"><option value="article">Article</option><option value="book">Book</option><option value="database">Database</option></select></label>
```

- [ ] **Step 3: Add the section markup**

Insert immediately after `<div id="halls"></div>` (line 440), before `</main>`:

```html
  <!-- BINDING AFFINITIES (drug-first provenance review) -->
  <section id="bindingSection">
    <div class="src-head">
      <span class="eyebrow">Binding affinities &mdash; authenticate every Ki against its source</span>
    </div>
    <div id="bindSummary" class="bind-summary"></div>
    <div id="bindBySource"></div>
    <div id="bindByDrug"></div>
  </section>
```

- [ ] **Step 4: Add the summary render + wire into build/refresh**

Add a render function (near `refresh`, line 864):

```js
function renderBindSummary(){
  const bs=document.getElementById('bindSummary'); if(!bs) return;
  let total=0, confirmed=0, needs=0;
  for(const a of AGENTS) for(const b of a.bindings){
    total++;
    if(b.value_status==='confirmed') confirmed++;
    if(b.status==='needs-source') needs++;
  }
  const srcTotal=BINDING_USAGE.length;
  const srcVerified=BINDING_USAGE.filter(u=>u.status==='verified').length;
  bs.innerHTML=`
    <div class="bstat"><b>${confirmed}</b> / ${total} numbers confirmed</div>
    <div class="bstat"><b>${srcVerified}</b> / ${srcTotal} sources verified</div>
    <div class="bstat"><b>${needs}</b> bindings need a source</div>`;
}
```

Call `renderBindSummary()` at the end of `build()` (find `function build()` and append the call before it returns) and again at the end of `refresh()` so tallies stay live after edits.

- [ ] **Step 5: Add minimal CSS**

In the `<style>` block, near the other panel styles, add:

```css
#bindingSection{margin-top:2.5rem;}
.bind-summary{display:flex;gap:1.4rem;flex-wrap:wrap;margin:.8rem 0 1.2rem;}
.bstat{font-family:"Fragment Mono",monospace;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--bone-faint);}
.bstat b{font-size:1.1rem;color:var(--bone);}
```

- [ ] **Step 6: Verify in the browser**

Start the dev server (preview_start with the launch config), open `/the-conservators-desk.html`. Confirm the "Binding affinities" section appears after the halls with the summary strip reading `0 / 136`, `0 / 13`, `31`. Run `read_console_messages` — no errors.

- [ ] **Step 7: Commit**

```bash
git add public/the-conservators-desk.html
git commit -m "feat(desk): binding-affinities section shell + summary strip + database source kind"
```

---

### Task 6: Desk UI — by-source panel (bulk verify)

**Goal:** Render the 13 cited sources as the bulk-clearing surface, each with a status toggle and a "verify all N" action.

**Files:**
- Modify: `public/the-conservators-desk.html` (`renderBindBySource`, wiring, CSS)

**Acceptance Criteria:**
- [ ] The by-source panel lists each cited source with its citation, its binding count, and three status buttons (verified/provided/conflicting).
- [ ] Clicking a status button issues `PATCH /api/sources/:id/binding-status`, updates all that source's edges, and re-renders (summary "sources verified" increments).
- [ ] The PDSP row shows "41 bindings".

**Verify:** Browser — click "verified" on the PDSP row; summary jumps to `1 / 13 sources verified`; `read_network_requests` shows the PATCH with `updated: 41`.

**Steps:**

- [ ] **Step 1: Add the render + wire function**

Near `renderBindSummary` (Task 5), add:

```js
const BIND_STATUSES=["verified","provided","conflicting"];
function renderBindBySource(){
  const host=document.getElementById('bindBySource'); if(!host) return;
  if(!BINDING_USAGE.length){ host.innerHTML=''; return; }
  const sorted=[...BINDING_USAGE].sort((a,b)=>b.count-a.count);
  host.innerHTML=`<div class="bind-subhead">By source &mdash; verify a source to clear every Ki that cites it</div>`
    + sorted.map(u=>`
      <div class="bsrc-row" data-id="${u.id}">
        <div class="bsrc-cite"><span class="srow-kind">${kindLabel(u)}</span>
          ${esc(u.authors)||'—'}${u.year?' ('+u.year+')':''} · <i>${esc(u.title)||esc(u.journal)||'untitled'}</i></div>
        <div class="bsrc-count">${u.count} binding${u.count===1?'':'s'}</div>
        <div class="citestat">${BIND_STATUSES.map(v=>`<button type="button" class="cs${u.status===v?' on':''}" data-act="bulk" data-id="${u.id}" data-v="${v}">${v}</button>`).join('')}</div>
      </div>`).join('');
}
async function bulkSourceStatus(id,status){
  const r=await fetch('/api/sources/'+id+'/binding-status',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
  return r.ok;
}
function wireBindBySource(){
  const host=document.getElementById('bindBySource'); if(!host) return;
  host.addEventListener('click', async e=>{
    const btn=e.target.closest('button[data-act="bulk"]'); if(!btn) return;
    if(await bulkSourceStatus(Number(btn.dataset.id), btn.dataset.v)){
      await Promise.all([loadAgents(), loadBindingUsage()]);
      renderBindSummary(); renderBindBySource(); renderBindByDrug();
    }
  });
}
```

(`renderBindByDrug` is defined in Task 7; if implementing Task 6 alone, temporarily stub it as `function renderBindByDrug(){}` — Task 7 replaces the stub.)

- [ ] **Step 2: Call render + wire once from `build()`**

In `build()`, after `renderBindSummary()`, add:

```js
  renderBindBySource(); wireBindBySource();
```

- [ ] **Step 3: Add CSS**

```css
.bind-subhead{font-family:"Fragment Mono",monospace;font-size:.62rem;letter-spacing:.09em;text-transform:uppercase;color:var(--brass);margin:.6rem 0;}
.bsrc-row{display:grid;grid-template-columns:1fr auto auto;gap:1rem;align-items:center;padding:.6rem .2rem;border-bottom:1px solid var(--brass-line);}
.bsrc-cite{font-size:.86rem;color:var(--bone);}
.bsrc-count{font-family:"Fragment Mono",monospace;font-size:.62rem;letter-spacing:.06em;text-transform:uppercase;color:var(--bone-faint);white-space:nowrap;}
```

- [ ] **Step 4: Verify in the browser**

Reload the Desk. The by-source panel lists 13 rows sorted by count; PDSP shows "41 bindings". Click **verified** on PDSP → the three summary tallies update (`1 / 13 sources verified`), and `read_network_requests` shows `PATCH /api/sources/<id>/binding-status` returning `{updated:41}`.

- [ ] **Step 5: Commit**

```bash
git add public/the-conservators-desk.html
git commit -m "feat(desk): by-source panel with bulk verify"
```

---

### Task 7: Desk UI — by-drug list, per-binding citations, value_status, filter

**Goal:** Render all 71 drugs as expandable rows; each binding shows its target/Ki/action, its cited sources (reusing `.srow`-style markup wired to the binding routes), a confirm/mismatch control, and an add-source combobox. A filter rail scopes the list.

**Files:**
- Modify: `public/the-conservators-desk.html` (`renderBindByDrug` + wiring + filter + CSS)

**Acceptance Criteria:**
- [ ] Each drug is a collapsed row showing name + binding count + a per-drug status dot; expanding reveals one block per binding.
- [ ] Each binding block shows target label, `ki_text`, `act_full`, the as-imported `src` label, its attached sources with per-edge status buttons + Remove, an add-source combobox, and a 3-state value_status control (unchecked/confirmed/mismatch).
- [ ] Attaching/removing a source or changing a status or value_status persists (correct binding route) and re-renders the summary + by-source panel.
- [ ] A filter rail (all / needs-source / unverified / unconfirmed / has-mismatch / cleared) scopes which drugs show.

**Verify:** Browser — expand Chlorpromazine (7 bindings), attach a source to a needs-source binding, mark a number "confirmed", switch a source to "verified"; confirm each persists via `read_network_requests` and the summary strip updates. Filter to "needs-source" and confirm only drugs with an unsourced binding remain.

**Steps:**

- [ ] **Step 1: Add binding-provenance helpers (reuse the source combobox pattern)**

Near `srowHtml` (line 661), add binding-specific markup + persistence. These mirror the receptor source panel but target the binding routes and omit `is_primary`:

```js
const VALUE_LABEL={unchecked:"Number unchecked",confirmed:"Number confirmed",mismatch:"Number ≠ source"};
const VALUE_STATES=["confirmed","mismatch","unchecked"];

function bindSrowHtml(agent,target,s){
  return `<div class="srow" data-sid="${s.id}">
    <div class="srow-top"><span class="srow-kind">${kindLabel(s)}</span></div>
    <div class="srow-cite">${esc(s.authors)||'—'} (${s.year||'n.d.'}). <i>${esc(s.title)||esc(s.journal)||'untitled'}</i>${s.journal&&s.title?' · '+esc(s.journal):''}</div>
    <div class="srow-ids">
      ${s.pmid?`<a class="srclink" href="${pm(s.pmid)}" target="_blank" rel="noopener">PMID ${esc(s.pmid)} ↗</a>`:''}
      ${s.doi?`<a class="srclink" href="${doiU(s.doi)}" target="_blank" rel="noopener">DOI ↗</a>`:''}
      ${(!s.pmid&&!s.doi&&s.url)?`<a class="srclink" href="${esc(s.url)}" target="_blank" rel="noopener">Open ↗</a>`:''}
    </div>
    <div class="citestat">${CITATION_STATUSES.map(v=>`<button type="button" class="cs${s.status===v?' on':''}" data-bact="status" data-sid="${s.id}" data-v="${v}" title="${CS_HELP[v]}">${v}</button>`).join('')}</div>
    <div class="srow-actions"><button type="button" class="ctrl" data-bact="unlink" data-sid="${s.id}">Remove</button></div>
  </div>`;
}

async function bindAttach(agent,target,body){
  const r=await fetch(`/api/bindings/${encodeURIComponent(agent)}/${encodeURIComponent(target)}/sources`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return r.ok;
}
async function bindEdge(agent,target,sid,status){
  const r=await fetch(`/api/bindings/${encodeURIComponent(agent)}/${encodeURIComponent(target)}/sources/${sid}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
  return r.ok;
}
async function bindUnlink(agent,target,sid){
  const r=await fetch(`/api/bindings/${encodeURIComponent(agent)}/${encodeURIComponent(target)}/sources/${sid}`,{method:'DELETE'});
  return r.ok;
}
async function bindReview(agent,target,value_status){
  const r=await fetch(`/api/bindings/${encodeURIComponent(agent)}/${encodeURIComponent(target)}/review`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({value_status})});
  return r.ok;
}
```

- [ ] **Step 2: Add the by-drug render (with filter) + a status dot helper**

```js
let BIND_FILTER='all';
function bindStatusDot(b){ // per-binding colour: needs-source=info, mismatch=warn, verified&confirmed=good, else brass
  if(b.status==='needs-source') return 'info';
  if(b.value_status==='mismatch'||b.status==='conflicting') return 'warn';
  if(b.status==='verified'&&b.value_status==='confirmed') return 'good';
  return 'brass';
}
function agentPasses(a){
  if(BIND_FILTER==='all') return true;
  return a.bindings.some(b=>{
    if(BIND_FILTER==='needs') return b.status==='needs-source';
    if(BIND_FILTER==='unverified') return b.status!=='verified';
    if(BIND_FILTER==='unconfirmed') return b.value_status!=='confirmed';
    if(BIND_FILTER==='mismatch') return b.value_status==='mismatch';
    if(BIND_FILTER==='cleared') return b.status==='verified'&&b.value_status==='confirmed';
    return true;
  });
}
function targetLabel(alias){ // prefer the receptor label if we have it in RX, else the alias
  return alias;
}
function bindingBlockHtml(agent,b){
  const srcHtml = b.sources.length ? b.sources.map(s=>bindSrowHtml(agent,b.target_alias,s)).join('')
    : `<div class="srcline" style="color:var(--bone-faint)">No source cited yet · imported label: <i>${esc(b.src)||'—'}</i></div>`;
  return `<div class="bbind" data-target="${esc(b.target_alias)}">
    <div class="bbind-head">
      <span class="dot ${bindStatusDot(b)}"></span>
      <b>${esc(targetLabel(b.target_alias))}</b>
      <span class="bbind-ki">Ki ${esc(b.ki_text)||(b.ki!=null?b.ki+' nM':'—')}</span>
      <span class="bbind-act">${esc(b.act_full)||''}</span>
    </div>
    <div class="bbind-sources">${srcHtml}</div>
    <div class="src-add-combo"><input type="text" class="src-add-input" placeholder="Add a source — search by author, title, or PMID…" autocomplete="off"/><div class="src-add-menu hidden"></div></div>
    <div class="valctl">${VALUE_STATES.map(v=>`<button type="button" class="cs${b.value_status===v?' on':''}" data-vact="${v}" title="${VALUE_LABEL[v]}">${v}</button>`).join('')}</div>
  </div>`;
}
function renderBindByDrug(){
  const host=document.getElementById('bindByDrug'); if(!host) return;
  const agents=[...AGENTS].sort((a,b)=>a.name.localeCompare(b.name)).filter(agentPasses);
  host.innerHTML=`<div class="bind-subhead">By drug &mdash; ${agents.length} shown</div>`
    + agents.map(a=>{
        const worst=a.bindings.some(b=>b.status==='needs-source')?'info'
          :a.bindings.some(b=>b.value_status==='mismatch'||b.status==='conflicting')?'warn'
          :a.bindings.every(b=>b.status==='verified'&&b.value_status==='confirmed')?'good':'brass';
        return `<div class="bdrug" data-agent="${esc(a.name)}">
          <div class="bdrug-head"><span class="dot ${worst}"></span><b>${esc(a.name)}</b>
            <span class="bdrug-n">${a.bindings.length} binding${a.bindings.length===1?'':'s'}</span></div>
          <div class="bdrug-body">${a.bindings.map(b=>bindingBlockHtml(a.name,b)).join('')}</div>
        </div>`;
      }).join('');
}
```

- [ ] **Step 3: Add delegated wiring (expand, statuses, value_status, add-source combobox)**

```js
function wireBindByDrug(){
  const host=document.getElementById('bindByDrug'); if(!host) return;
  async function reloadAll(){ await Promise.all([loadAgents(),loadBindingUsage()]); renderBindSummary(); renderBindBySource(); renderBindByDrug(); }

  host.addEventListener('click', async e=>{
    const head=e.target.closest('.bdrug-head');
    if(head){ head.parentElement.classList.toggle('open'); return; }

    const bind=e.target.closest('.bbind'); if(!bind) return;
    const agent=e.target.closest('.bdrug').dataset.agent, target=bind.dataset.target;

    const statusBtn=e.target.closest('button[data-bact="status"]');
    if(statusBtn){ if(await bindEdge(agent,target,Number(statusBtn.dataset.sid),statusBtn.dataset.v)) reloadAll(); return; }
    const unlinkBtn=e.target.closest('button[data-bact="unlink"]');
    if(unlinkBtn){ if(!confirm('Remove this source from the binding? The shared library record is kept.'))return;
      if(await bindUnlink(agent,target,Number(unlinkBtn.dataset.sid))) reloadAll(); return; }
    const valBtn=e.target.closest('button[data-vact]');
    if(valBtn){ if(await bindReview(agent,target,valBtn.dataset.vact)) reloadAll(); return; }
    const opt=e.target.closest('.src-add-opt');
    if(opt){
      const menu=opt.closest('.src-add-menu');
      if(opt.dataset.sid){ if(await bindAttach(agent,target,{source_id:Number(opt.dataset.sid),status:'provided'})) reloadAll(); }
      else if(opt.dataset.act==='newform'){
        // reuse the library create form: create the source, then attach it
        const title=menu.dataset.q||'';
        if(await bindAttach(agent,target,{source:{kind:'article',title},status:'provided'})) reloadAll();
      }
      return;
    }
  });

  host.addEventListener('input', e=>{
    const input=e.target.closest('.src-add-input'); if(!input) return;
    const menu=input.parentElement.querySelector('.src-add-menu');
    const q=input.value.trim().toLowerCase();
    if(!q){ menu.classList.add('hidden'); menu.innerHTML=''; return; }
    menu.dataset.q=input.value.trim();
    const matches=SOURCES.filter(s=>matchesSourceQuery(s,q)).slice(0,8);
    menu.innerHTML=matches.map(s=>`<button type="button" class="src-add-opt" data-sid="${s.id}"><span class="srow-kind">${kindLabel(s)}</span>${esc(srcLabel(s))}</button>`).join('')
      + `<button type="button" class="src-add-opt src-add-new" data-act="newform">+ Create a new source for &ldquo;${esc(input.value.trim())}&rdquo;</button>`;
    menu.classList.remove('hidden');
  });
}
```

- [ ] **Step 4: Add the filter rail markup**

Inside `#bindingSection`, between `#bindBySource` and `#bindByDrug`, add:

```html
    <div class="rail" id="bindRail">
      <span class="lab">Show</span>
      <button class="seg active" data-bfilter="all">All</button>
      <button class="seg" data-bfilter="needs">Needs source</button>
      <button class="seg" data-bfilter="unverified">Unverified</button>
      <button class="seg" data-bfilter="unconfirmed">Unconfirmed</button>
      <button class="seg" data-bfilter="mismatch">Has mismatch</button>
      <button class="seg" data-bfilter="cleared">Cleared</button>
    </div>
```

Wire it (in `wireBindByDrug` or a small `wireBindRail`):

```js
function wireBindRail(){
  const rail=document.getElementById('bindRail'); if(!rail) return;
  rail.addEventListener('click',e=>{
    const seg=e.target.closest('.seg'); if(!seg) return;
    rail.querySelectorAll('.seg').forEach(s=>s.classList.remove('active')); seg.classList.add('active');
    BIND_FILTER={all:'all',needs:'needs',unverified:'unverified',unconfirmed:'unconfirmed',mismatch:'mismatch',cleared:'cleared'}[seg.dataset.bfilter];
    renderBindByDrug();
  });
}
```

- [ ] **Step 5: Call render + wire from `build()`**

Replace the Task-6 stub line so `build()` ends with:

```js
  renderBindSummary();
  renderBindBySource(); wireBindBySource();
  renderBindByDrug(); wireBindByDrug(); wireBindRail();
```

- [ ] **Step 6: Add CSS**

```css
.bdrug{border-bottom:1px solid var(--brass-line);}
.bdrug-head{display:flex;align-items:center;gap:.6rem;padding:.65rem .2rem;cursor:pointer;}
.bdrug-head b{font-size:.95rem;color:var(--bone);}
.bdrug-n{font-family:"Fragment Mono",monospace;font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;color:var(--bone-faint);margin-left:auto;}
.bdrug-body{display:none;padding:0 .2rem .8rem 1.4rem;}
.bdrug.open .bdrug-body{display:block;}
.bbind{border-left:2px solid var(--brass-line);padding:.5rem .8rem;margin:.5rem 0;}
.bbind-head{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;}
.bbind-ki{font-family:"Fragment Mono",monospace;font-size:.72rem;color:var(--brass);}
.bbind-act{font-size:.8rem;color:var(--bone-faint);}
.bbind-sources{margin:.5rem 0;}
.valctl{display:flex;gap:.3rem;margin-top:.5rem;}
```

(`.dot`, `.dot.good/.warn/.info`, `.cs`, `.srow*`, `.src-add-*`, `.seg`, `.rail` already exist and are reused.)

- [ ] **Step 7: Verify in the browser (the full flow)**

Reload the Desk. Then:
1. Expand **Chlorpromazine** → 7 binding blocks render, each with target/Ki/action.
2. On a **needs-source** binding, type in the add box, pick a source → `read_network_requests` shows `POST /api/bindings/Chlorpromazine/<target>/sources` 201; the binding's dot changes and the summary "needs a source" count drops by 1.
3. Click **confirmed** on a binding's value control → `PATCH .../review` 200; summary "numbers confirmed" +1.
4. Click **verified** on a source edge → `PATCH .../sources/<sid>` 200.
5. Click the **Needs source** filter → only drugs with an unsourced binding remain.
Confirm `read_console_messages` is clean.

- [ ] **Step 8: Commit**

```bash
git add public/the-conservators-desk.html
git commit -m "feat(desk): drug-first binding list with per-binding citations, value_status, and filter"
```

---

## Self-Review

**Spec coverage:**
- Data model (3 tables, stable pair) → Task 1. ✓
- Migration (17 tags → 13 sources / 105 edges / 31 needs-source, non-destructive) → Task 2. ✓
- Read API (`/api/agents/binding`, `/api/sources/binding-usage`) → Task 3. ✓
- Write API (edges, value_status, bulk) → Task 4. ✓
- Desk section (shell + summary) → Task 5; by-source panel → Task 6; by-drug list + filter + value_status → Task 7. ✓
- `sources.kind='database'` label → Task 5. ✓
- Persistence regression test → Task 2 (idempotency + preserved status). ✓
- Out-of-scope items (specimen checkbox, matrix tooltip, metadata backfill) → untouched. ✓

**Type/name consistency:** `agentBindingProvenance` / `bindingSourceUsage` defined in Task 3 and imported in Task 3's router edit; `CITATION_STATUS` (router) and `CITATION_STATUSES` (Desk JS) are two pre-existing names in two files — kept as-is, not cross-referenced. `renderBindByDrug` is stubbed in Task 6 and defined in Task 7. Binding routes use `(agent, target)` captures consistently across Tasks 4 and 7.

**Placeholders:** none — every step carries full code or an exact command.

**Note for the implementer:** Tasks 1–4 are backend and fully TDD'd with `node --test`. Tasks 5–7 are single-file front-end changes verified in the browser (the codebase has no DOM test harness), following the `preview_start` → interact → `read_network_requests`/`read_console_messages` workflow.
