# Conservator's Desk App — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Turn the static Conservator's Desk and Receptor Atlas into one local app where a single SQLite database is the source of truth — the atlas reads from it, the desk reads *and writes* it (review state, a sources/citation library, and editable structured data), kept in a portable `atlas-app/` folder.

**Architecture:** A minimal Node.js HTTP server (`server.js`) uses `better-sqlite3` to serve a JSON API over `http://localhost:3000` and to serve the existing HTML from `public/`. The HTML pages keep all their design/animation and only swap their embedded data objects for `fetch` calls to the API. See the design doc: `atlas-app/docs/2026-06-28-conservators-desk-app-design.md`.

**Tech Stack:** Node.js (ESM), `better-sqlite3` (only runtime dependency), SQLite, Node's built-in test runner (`node --test`, zero extra deps). Vanilla browser JS/HTML/CSS (no build step).

**Testing approach:** Backend logic (migration, DB queries, API routes) is built test-first with `node --test` against an in-memory or temp SQLite DB. Browser-rendering changes (HTML wiring) are verified by running the server and inspecting real responses/preview, since they have no unit-testable seam.

**Plan location note:** This plan and its `.tasks.json` live in `atlas-app/docs/` (not the repo's `docs/plans/`) so the whole app travels as one movable folder, per the design's portability requirement.

**Path note:** All shell commands assume the working directory is the `atlas-app/` folder unless stated. This project is not a git repo; `git` commit steps are included for when one is initialized (run `git init` in `atlas-app/` to enable them). If not using git, treat "Commit" steps as "checkpoint reached."

---

## PHASE 1 — Backbone (invisible: proves the whole loop, no visual change)

### Task 0: Scaffold the portable app folder

**Files:**
- Create: `atlas-app/package.json`
- Create: `atlas-app/.gitignore`
- Create: `atlas-app/db/` (empty dir, holds `atlas.db`)
- Create: `atlas-app/public/` (empty dir, will hold the HTML)
- Create: `atlas-app/scripts/` (empty dir)
- Create: `atlas-app/test/` (empty dir)

**Step 1: Create `package.json`**

```json
{
  "name": "atlas-app",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "migrate": "node scripts/migrate.js",
    "test": "node --test"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  }
}
```

**Step 2: Create `.gitignore`**

```
node_modules/
db/atlas.db
db/atlas.db-*
*.log
```

**Step 3: Install the dependency**

Run: `npm install`
Expected: `node_modules/` appears; `better-sqlite3` builds with no error. (On Windows this uses a prebuilt binary; if it tries to compile and fails, install build tools or a Node LTS — note in README.)

**Step 4: Verify better-sqlite3 loads**

Run: `node -e "import('better-sqlite3').then(m=>console.log('ok', typeof m.default))"`
Expected: `ok function`

**Step 5: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: scaffold atlas-app folder and dependency"
```

---

### Task 1: Database schema + connection module

**Files:**
- Create: `atlas-app/db/schema.sql`
- Create: `atlas-app/db/index.js`
- Test: `atlas-app/test/schema.test.js`

**Step 1: Write the failing test**

```js
// test/schema.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';

test('schema creates all expected tables', () => {
  const db = openDb(':memory:');
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);
  for (const t of [
    'receptors','receptor_volumes','sources','receptor_sources',
    'stahl_loci','claims','quizzes','review_state','section_activity'
  ]) assert.ok(names.includes(t), `missing table: ${t}`);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/schema.test.js`
Expected: FAIL — `Cannot find module '../db/index.js'`.

**Step 3: Write `db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS receptors (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  system TEXT,
  hall TEXT,
  sort_order INTEGER
);
CREATE TABLE IF NOT EXISTS receptor_volumes (
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  volume TEXT NOT NULL,
  PRIMARY KEY (receptor_id, volume)
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  authors TEXT, year INTEGER, title TEXT, journal TEXT,
  pmid TEXT, doi TEXT, url TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS receptor_sources (
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  source_id INTEGER REFERENCES sources(id),
  status TEXT NOT NULL DEFAULT 'needs-source',
  PRIMARY KEY (receptor_id)
);
CREATE TABLE IF NOT EXISTS stahl_loci (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  chapter INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS claims (
  receptor_id TEXT PRIMARY KEY REFERENCES receptors(id),
  text TEXT
);
CREATE TABLE IF NOT EXISTS quizzes (
  receptor_id TEXT PRIMARY KEY REFERENCES receptors(id),
  prompt TEXT
);
CREATE TABLE IF NOT EXISTS review_state (
  receptor_id TEXT PRIMARY KEY REFERENCES receptors(id),
  mechanism INTEGER DEFAULT 0,
  affinity INTEGER DEFAULT 0,
  clinical INTEGER DEFAULT 0,
  citation INTEGER DEFAULT 0,
  mastery INTEGER DEFAULT 0,
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS section_activity (
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  volume TEXT NOT NULL,
  last_edited_at TEXT,
  last_reviewed_at TEXT,
  PRIMARY KEY (receptor_id, volume)
);
```

**Step 4: Write `db/index.js`**

```js
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export function openDb(path = join(HERE, 'atlas.db')) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));
  return db;
}
```

**Step 5: Run test to verify it passes**

Run: `node --test test/schema.test.js`
Expected: PASS.

**Step 6: Commit**

```bash
git add db/schema.sql db/index.js test/schema.test.js
git commit -m "feat: sqlite schema and connection module"
```

---

### Task 2: Migrate the Conservator's Desk `RX` data into the DB

The desk's `RX` array (in `the-conservators-desk.html`) is the richest seed: receptors, volumes, Stahl loci, claims, quizzes, citations + status. Extract it into a reusable data module, then load it.

**Files:**
- Create: `atlas-app/scripts/seed-data.js` (the `RX` array + `HALLS` map, copied verbatim from the desk, exported)
- Create: `atlas-app/scripts/migrate.js`
- Test: `atlas-app/test/migrate.test.js`

**Step 1: Create `scripts/seed-data.js`**

Copy the `RX` array, the `HALLS` object, and `CHECK_KEYS` from `the-conservators-desk.html` (lines ~328–470) verbatim and export them:

```js
export const HALLS = { /* …copied from desk… */ };
export const RX = [ /* …copied from desk… */ ];
```

**Step 2: Write the failing test**

```js
// test/migrate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { RX } from '../scripts/seed-data.js';

test('migrate loads every receptor', () => {
  const db = openDb(':memory:');
  migrate(db);
  const n = db.prepare('SELECT COUNT(*) c FROM receptors').get().c;
  assert.equal(n, RX.length);
});

test('migrate loads sources and links them with status', () => {
  const db = openDb(':memory:');
  migrate(db);
  const m1 = db.prepare(`
    SELECT s.pmid, rs.status FROM receptor_sources rs
    JOIN sources s ON s.id = rs.source_id WHERE rs.receptor_id='m1'`).get();
  assert.equal(m1.pmid, '24903776');        // the corrected PMID
  assert.equal(m1.status, 'conflicting');
});

test('migrate seeds blank review_state for every receptor', () => {
  const db = openDb(':memory:');
  migrate(db);
  const n = db.prepare('SELECT COUNT(*) c FROM review_state').get().c;
  assert.equal(n, RX.length);
});
```

**Step 3: Run test to verify it fails**

Run: `node --test test/migrate.test.js`
Expected: FAIL — `migrate` not exported.

**Step 4: Write `scripts/migrate.js`**

```js
import { openDb } from '../db/index.js';
import { RX, HALLS } from './seed-data.js';

export function migrate(db) {
  const tx = db.transaction(() => {
    const rcpt = db.prepare(
      'INSERT OR REPLACE INTO receptors (id,label,system,hall,sort_order) VALUES (?,?,?,?,?)');
    const vol  = db.prepare('INSERT OR IGNORE INTO receptor_volumes (receptor_id,volume) VALUES (?,?)');
    const src  = db.prepare(
      'INSERT INTO sources (authors,year,title,journal,pmid,doi) VALUES (?,?,?,?,?,?)');
    const link = db.prepare(
      'INSERT OR REPLACE INTO receptor_sources (receptor_id,source_id,status) VALUES (?,?,?)');
    const st   = db.prepare('INSERT INTO stahl_loci (receptor_id,chapter) VALUES (?,?)');
    const clm  = db.prepare('INSERT OR REPLACE INTO claims (receptor_id,text) VALUES (?,?)');
    const qz   = db.prepare('INSERT OR REPLACE INTO quizzes (receptor_id,prompt) VALUES (?,?)');
    const rev  = db.prepare('INSERT OR IGNORE INTO review_state (receptor_id) VALUES (?)');

    RX.forEach((r, i) => {
      rcpt.run(r.id, r.nm, r.hall, r.hall, i);
      (r.vols || []).forEach(v => vol.run(r.id, v.toLowerCase()));
      (r.stahl || []).forEach(arr => st.run(r.id, arr[0]));
      if (r.claim) clm.run(r.id, r.claim);
      if (r.quiz)  qz.run(r.id, r.quiz);
      rev.run(r.id);
      let sourceId = null;
      if (r.ref) {
        const e = r.ref;
        sourceId = src.run(e.a, e.y, e.t, e.journal ?? null, e.pmid, e.doi).lastInsertRowid;
      }
      link.run(r.id, sourceId, r.cs || 'needs-source');
    });
  });
  tx();
}

// Allow `npm run migrate` to build the real file.
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  migrate(db);
  console.log('migrated', db.prepare('SELECT COUNT(*) c FROM receptors').get().c, 'receptors');
}
```

**Step 5: Run test to verify it passes**

Run: `node --test test/migrate.test.js`
Expected: PASS (all three tests).

**Step 6: Build the real database**

Run: `npm run migrate`
Expected: `migrated 24 receptors`; `db/atlas.db` now exists.

**Step 7: Commit**

```bash
git add scripts/seed-data.js scripts/migrate.js test/migrate.test.js
git commit -m "feat: migrate desk RX data into atlas.db"
```

---

### Task 3: HTTP server with static file serving

**Files:**
- Create: `atlas-app/server.js`
- Create: `atlas-app/lib/router.js` (tiny route matcher)
- Test: `atlas-app/test/server.test.js`

**Step 1: Write the failing test** (starts the server on an ephemeral port, fetches a static file)

```js
// test/server.test.js
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

test('serves the desk html at /', async () => {
  const res = await fetch(`${base}/the-conservators-desk.html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/server.test.js`
Expected: FAIL — `createServer` not exported.

**Step 3: Write `server.js`** (export `createServer` for tests; auto-start when run directly)

```js
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { openDb } from './db/index.js';
import { migrate } from './scripts/migrate.js';
import { apiRoutes } from './lib/router.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, 'public');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };

export function createServer(dbPath, { seed = false } = {}) {
  const db = openDb(dbPath);
  if (seed) migrate(db);
  const routes = apiRoutes(db);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    // API first
    for (const r of routes) {
      const m = url.pathname.match(r.pattern);
      if (m && r.method === req.method) return r.handler(req, res, m, url);
    }
    // static
    const safe = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC, safe === '/' ? 'the-receptor-atlas.html' : safe);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = process.env.PORT || 3000;
  createServer().listen(PORT, () => console.log(`Atlas app: http://localhost:${PORT}`));
}
```

**Step 4: Write `lib/router.js`** (empty route list for now — filled in next tasks)

```js
export function apiRoutes(db) {
  return [];
}
```

**Step 5: Run test to verify it passes**

Run: `node --test test/server.test.js`
Expected: PASS.

**Step 6: Commit**

```bash
git add server.js lib/router.js test/server.test.js
git commit -m "feat: http server with static file serving"
```

---

### Task 4: `GET /api/receptors` (registry list)

**Files:**
- Modify: `atlas-app/lib/router.js`
- Test: `atlas-app/test/api-receptors.test.js`

**Step 1: Write the failing test**

```js
// test/api-receptors.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

let server, base;
before(async () => { server = createServer(':memory:', { seed: true });
  await new Promise(r => server.listen(0, r)); base = `http://localhost:${server.address().port}`; });
after(() => server.close());

test('GET /api/receptors returns all receptors with status', async () => {
  const res = await fetch(`${base}/api/receptors`);
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.equal(list.length, 24);
  assert.ok(list[0].id && list[0].label && 'status' in list[0]);
});
```

**Step 2: Run test → fail** (`length` 0). Run: `node --test test/api-receptors.test.js`

**Step 3: Implement the route in `lib/router.js`**

```js
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

export function apiRoutes(db) {
  return [
    {
      method: 'GET', pattern: /^\/api\/receptors$/,
      handler: (req, res) => json(res, 200, db.prepare(`
        SELECT r.id, r.label, r.system, r.hall, r.sort_order,
               COALESCE(rs.status,'needs-source') AS status,
               (rv.mechanism + rv.affinity + rv.clinical + rv.citation) AS checks_done,
               rv.mastery
        FROM receptors r
        LEFT JOIN receptor_sources rs ON rs.receptor_id = r.id
        LEFT JOIN review_state rv ON rv.receptor_id = r.id
        ORDER BY r.sort_order`).all())
    },
  ];
}
```

**Step 4: Run test → pass.** **Step 5: Commit** `feat: GET /api/receptors`.

---

### Task 5: `GET /api/receptors/:id` (fully joined detail)

**Files:** Modify `lib/router.js`; Test `atlas-app/test/api-receptor-detail.test.js`

**Step 1: Failing test** — assert `/api/receptors/m1` returns `{ id, label, claim, quiz, stahl:[…], source:{pmid:'24903776'}, status:'conflicting', review:{…} }`.

**Step 2: Run → fail.**

**Step 3: Implement** a route `pattern: /^\/api\/receptors\/([\w-]+)$/` that assembles the receptor row + `stahl_loci` (array) + `claims` + `quizzes` + joined `sources` + `receptor_sources.status` + `review_state` into one object; 404 if missing.

**Step 4: Run → pass.** **Step 5: Commit** `feat: GET /api/receptors/:id`.

---

### Task 6: `GET /api/atlas/:volume` (data shaped for a volume render)

**Files:** Modify `lib/router.js`; Test `atlas-app/test/api-atlas-volume.test.js`

**Step 1: Failing test** — `GET /api/atlas/archive` returns only receptors whose `receptor_volumes.volume='archive'`, each with `{id,label,claim,source,status}`.

**Step 2: Run → fail.**

**Step 3: Implement** route `pattern: /^\/api\/atlas\/(archive|cabinet|ledger)$/`, query joining `receptor_volumes`.

**Step 4: Run → pass.** **Step 5: Commit** `feat: GET /api/atlas/:volume`.

---

### Task 7: Move HTML into `public/` and wire the desk to the API

**Files:**
- Move: the 5 HTML files → `atlas-app/public/`
  (`the-receptor-atlas.html`, `receptor-function.html`, `neuroreceptor_pharmacology_explorer_dashboard.html`, `neuroreceptor_clinical_table.html`, `the-conservators-desk.html`)
- Modify: `atlas-app/public/the-conservators-desk.html` (replace hardcoded `RX` + `localStorage` reads with API calls)

**Step 1:** Copy the 5 files into `public/` (keep originals in the repo root untouched until Phase 3 is verified, as a fallback).

**Step 2:** In the desk, replace the data source. Currently `const RX = [ … ]` is hardcoded and `STATE` is loaded from `localStorage`. Change `build()` to first `await fetch('/api/receptors')` for the list and lazy-load detail via `/api/receptors/:id`. Replace `save()` to `PATCH /api/receptors/:id/review` (added in Phase 2; until then keep `localStorage` write as a temporary shim and leave a `TODO`). Keep all rendering/markup identical.

**Step 3: Verify by running** (no unit test — this is browser rendering):

Run: `npm start`, open `http://localhost:3000/the-conservators-desk.html`.
Expected: the desk shows all 24 receptors exactly as before, now sourced from the DB. Check the browser console/network tab: a `GET /api/receptors` request returns 200.

**Step 4: Verify with a quick curl** of the underlying data:

Run: `curl -s http://localhost:3000/api/receptors | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).length))"`
Expected: `24`.

**Step 5: Commit** `feat: serve HTML from public and read desk list from API`.

---

### Task 8: `start.bat` launcher + README, end-to-end check

**Files:** Create `atlas-app/start.bat`, `atlas-app/README.md`.

**Step 1: Write `start.bat`**

```bat
@echo off
cd /d "%~dp0"
if not exist node_modules ( echo Installing dependencies... & call npm install )
if not exist db\atlas.db ( echo Building database... & call npm run migrate )
echo Starting Atlas app at http://localhost:3000
start "" http://localhost:3000/the-conservators-desk.html
node server.js
```

**Step 2:** Write `README.md` — one-paragraph "double-click `start.bat`", plus a pointer to `docs/BACKEND-PRIMER.md`.

**Step 3: Full smoke test** — delete `db/atlas.db`, double-click `start.bat`. Expected: it rebuilds the DB, opens the browser, the desk loads from the API.

**Step 4: Run the whole test suite** — `npm test`. Expected: all tests pass.

**Step 5: Commit** `feat: start.bat launcher and README; Phase 1 complete`.

---

## PHASE 2 — Sources & citations (the "save once, reuse" loop)

### Task 9: Sources library API — `GET/POST/PATCH /api/sources`
- Test-first in `test/api-sources.test.js`: POST creates and returns id; GET lists; PATCH edits a field and persists.
- Implement three routes in `lib/router.js` (body-reading helper for POST/PATCH).
- Commit.

### Task 10: Link a source to a receptor — `PUT /api/receptors/:id/citation`
- Test-first: PUT `{source_id, status}` upserts `receptor_sources`; `GET /api/receptors/:id` then shows the new source + status.
- Implement; commit.

### Task 11: Desk **Sources Library** UI
- Add a panel (in the existing brass/bone style) to `public/the-conservators-desk.html`: list sources, add/edit a source, and on a receptor a "pick from library" control that calls `PUT …/citation` and auto-fills the displayed citation.
- Replace the desk's temporary `localStorage` review shim with `PATCH /api/receptors/:id/review` (define that route here, test-first).
- Verify by running: fix the M1/M3 PMID once in the library → both rows update.
- Commit.

### Task 12: **Discovery** — map the atlas volume data structures
- Read `public/receptor-function.html`, `public/neuroreceptor_pharmacology_explorer_dashboard.html`, `public/neuroreceptor_clinical_table.html`.
- Document, in this plan's appendix, where each holds its embedded data (variable names, line ranges, shape) for: citations, binding/affinity values, clinical rows, claims.
- No code; output is a short data-map. (Gates Tasks 13–14, 19.)

### Task 13: Atlas volumes read citations from the API
- Based on Task 12's map, replace each volume's embedded citation data with `fetch('/api/atlas/:volume')` at init; render identically.
- Verify each volume visually + that the corrected PMID now appears in the atlas.
- Commit per volume.

---

## PHASE 3 — Structured editing & sync

### Task 14: Schema + migration for structured data
- Add `binding_values` and `clinical_rows` tables to `db/schema.sql` (exact columns from Task 12's map).
- Extend the migration (or add `scripts/migrate-structured.js`) to load them from the volume files. Test-first on row counts/spot values.
- Commit.

### Task 15: `PATCH /api/receptors/:id/structured` (+ activity stamping)
- Test-first: patching a binding/clinical/claim value persists it AND sets `section_activity.last_edited_at`.
- Implement; commit.

### Task 16: `GET /api/review/drift` (edited-since-reviewed)
- Test-first (mirrors the spike): seed one edited-after-reviewed and one not; assert only the first returns.
- Implement with a single SQL query; commit.

### Task 17: Desk **edit mode** for structured data
- Inline editing of binding values, clinical rows, claims in the desk → `PATCH …/structured`.
- `PATCH …/review` also stamps `section_activity.last_reviewed_at`.
- Verify by running; commit.

### Task 18: Desk **sync UI** — dates, drift filter, deep links
- Per receptor show *edited / reviewed* dates; add a "changed since last review" filter backed by `/api/review/drift`; add **Open in Archive / Cabinet / Ledger** deep-link buttons.
- Verify; commit.

### Task 19: Atlas volumes render structured data from the DB
- Based on Task 12's map, swap each volume's embedded binding/clinical/claim data for the API; render identically.
- Final end-to-end: edit a binding value in the desk → reload the Cabinet → value reflects.
- Remove the now-stale root-level HTML originals (kept as fallback since Task 7). Run full `npm test`. Commit `feat: atlas renders structured data from DB; project complete`.

---

## Appendix A — Volume data map (filled in by Task 12)

_(empty until discovery)_
