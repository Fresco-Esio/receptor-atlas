# The Receptor Atlas — App & Database Design

- **Date:** 2026-06-28
- **Status:** Approved / Locked
- **Author:** Obioe (with Claude)
- **Supersedes:** the static, hardcoded Conservator's Desk

---

## 1. Problem

Two artifacts exist today, both as standalone single-HTML files with their data
embedded as JavaScript objects:

- **The Receptor Atlas** — a shell (`the-receptor-atlas.html`) wrapping three
  volume files: Archive (`receptor-function.html`), Cabinet
  (`neuroreceptor_pharmacology_explorer_dashboard.html`), and Ledger
  (`neuroreceptor_clinical_table.html`). It holds a `SPECIMENS` registry of ~24
  receptors.
- **The Conservator's Desk** (`the-conservators-desk.html`) — a review tool whose
  receptor list (`RX`) is a **hand-maintained duplicate** of atlas content, with
  review progress saved only in `localStorage`.

Consequences the owner wants fixed:

1. The desk's receptor data is a static snapshot — it drifts out of sync with the
   atlas whenever the atlas changes.
2. There is no real place to **manage sources/citations** (save once, reuse, fix
   once → reflected everywhere).
3. `localStorage` is fragile (per-browser, wiped when site data is cleared).
4. The desk and atlas are not **linked** — you cannot follow material from a review
   item into its atlas section, nor track which sections are being edited/reviewed.

## 2. Decision

Introduce a small **local backend** so a single database becomes the **single
source of truth** that both the atlas (reads) and the desk (reads + writes) use.

**Stack:** a minimal **Node.js HTTP server** + **`better-sqlite3`** + one
**`atlas.db`** SQLite file.

### Why this stack (and not the popular default)

This was chosen by a weighted decision matrix scored against project-specific
criteria, then **validated with runnable spikes** comparing it head-to-head
against PocketBase (a single-binary DB + auto-API + admin UI). The spike findings:

- **PocketBase's main advantage — a free admin UI — is moot here.** The product
  thesis (see `PRODUCT.md`) is that the *bespoke museum interface is the point*;
  sources are to be managed *at the Conservator's Desk* in brass-and-bone, not in a
  generic gray admin panel. So the styled desk UI gets built either way, and
  PocketBase's headline feature goes unused.
- **Custom computed views are the spine of this feature** (edited-since-reviewed,
  drift filters, deep-link/section tracking, cross-volume views). In a plain Node
  server each is a one-line SQL query; in PocketBase each needs a hook file plus
  `DynamicModel` scaffolding. Measured once in the spike, this friction repeats
  many times in the real build.
- **Longevity & simplicity:** one language (JavaScript) across the whole project,
  no 32 MB external binary to track and update, a database that is a single file
  you can copy to back up.

`better-sqlite3` (a stable, prebuilt native module) is chosen over Node's built-in
`node:sqlite`, which still prints `ExperimentalWarning` and may change. Same code
shape; better stability for a tool meant to last across years of training.

### Rejected alternatives

| Option | Why not |
|---|---|
| Express + better-sqlite3 | Express adds a dependency for routing we barely need; a tiny built-in `http` router suffices. (We may add Express later only if routing grows.) |
| PocketBase | Free admin UI unused (bespoke desk replaces it); custom-view friction recurs; 32 MB binary to maintain. |
| Python / Go backend | Drags a second language into a JS project. |
| IndexedDB only (no server) | Cannot serve a shared source of truth the atlas reads from; per-browser only. |
| Hosted (Supabase, etc.) | Internet dependency + accounts; out of scope for a personal local tool. |

## 3. Portability (hard requirement)

The entire application lives in **one self-contained folder, `atlas-app/`**, so it
can be moved off OneDrive at any time (OneDrive sync can corrupt an open SQLite
database, and is a poor home for a running server).

**Rules that keep it portable:**

- All file paths in code are **relative to the app root** (resolved via
  `import.meta.url`), never absolute, never referencing the OneDrive path.
- The database file lives at `atlas-app/db/atlas.db` — inside the folder.
- To move it: stop the server, cut-and-paste the `atlas-app/` folder anywhere
  (ideally a non-synced path such as `C:\dev\atlas-app`), then run `start.bat`.
- `start.bat` runs `npm install` automatically if `node_modules` is missing, so a
  fresh copy on the same machine self-heals. (`better-sqlite3` is a compiled
  native module; after moving to a *different* OS/arch it must be reinstalled,
  which `npm install` handles.)
- **Recommendation:** keep `atlas-app/` outside OneDrive while running; back up by
  copying `db/atlas.db` (and exporting JSON from the desk as a second backup).

### Planned folder layout

```
atlas-app/
├── start.bat            ← double-click launcher (npm install if needed, then start)
├── package.json         ← declares better-sqlite3; "type":"module"
├── server.js            ← the HTTP server + API routes (relative paths only)
├── db/
│   ├── schema.sql       ← table definitions
│   └── atlas.db         ← the SQLite database (the single source of truth)
├── scripts/
│   └── migrate.js       ← one-time: extract embedded data from the HTML files → atlas.db
├── public/              ← the HTML the server serves
│   ├── the-receptor-atlas.html        (+ 3 volume files, moved here)
│   └── the-conservators-desk.html
└── docs/
    ├── 2026-06-28-conservators-desk-app-design.md   (this file)
    └── BACKEND-PRIMER.md                             (maintenance education)
```

## 4. Architecture

```
                  atlas.db  (SQLite — single source of truth)
                      │  better-sqlite3
                  server.js  (Node http)
            ┌─────────┴──────────┐
        serves /public        /api/… JSON
            │                      │
   ┌────────┴────────┐   ┌─────────┴─────────┐
   Atlas volumes        Conservator's Desk
   (READ: render        (READ + WRITE: review,
    from /api)           edit data, manage sources)
```

The browser opens `http://localhost:<port>/the-receptor-atlas.html` (or the desk).
Each page `fetch`es the API for its data and renders as it does today — all design,
SVG engravings, and animation stay in the HTML templates.

## 5. Data model

SQLite tables, mirroring the data objects already embedded in the files:

| Table | Purpose | Seeded from |
|---|---|---|
| `receptors` | registry: id, label, system, slug, sort order | `SPECIMENS` + desk `RX` |
| `receptor_volumes` | which volumes a receptor appears in (M:N) | `SPECIMENS.in` |
| `sources` | **citation library**: authors, year, title, journal, pmid, doi, url, notes | desk `RX[].ref` |
| `receptor_sources` | links receptor↔source with `status` (verified / provided / conflicting / needs-source) | desk `RX[].cs` |
| `stahl_loci` | Stahl chapter references per receptor | desk `RX[].stahl` |
| `claims` | Archive claim text per receptor | desk `RX[].claim` |
| `binding_values` | Cabinet affinity/binding values (per axis/drug) | Cabinet file |
| `clinical_rows` | Ledger baseline / overstim / understim signs | Ledger file |
| `quizzes` | self-quiz prompt per receptor | desk `RX[].quiz` |
| `review_state` | desk checks, mastery, note (replaces localStorage) | new (export stays as backup) |
| `section_activity` | `last_edited_at` / `last_reviewed_at` per receptor-section → powers sync/drift | new |

## 6. API surface (initial)

```
GET   /api/receptors                  list registry (+ status summary)
GET   /api/receptors/:id              one receptor, fully joined (sources, stahl, claim, review)
GET   /api/atlas/:volume              data shaped for a volume's render (archive|cabinet|ledger)

GET   /api/sources                    the citation library
POST  /api/sources                    add a source
PATCH /api/sources/:id                edit a source (fix once → reflected everywhere)

PUT   /api/receptors/:id/citation     link a source + set status
PATCH /api/receptors/:id/review       checks / mastery / note (stamps last_reviewed_at)
PATCH /api/receptors/:id/structured   binding / clinical / claim (stamps last_edited_at)

GET   /api/review/drift               receptors edited since last reviewed (custom computed)
```

## 7. The Conservator's Desk as a real app (UX)

Built in the existing brass-and-bone museum aesthetic:

- **Sources Library panel** — add/edit a source once; on any receptor, pick from
  the library and the citation auto-populates (authors, title, PMID, DOI). Fixing
  the M1/M3 PMID once updates every receptor citing it — and the atlas.
- **Edit mode** — inline-edit binding values, clinical rows, and claims; writes to
  the DB via `/api/receptors/:id/structured`.
- **Atlas sync** — each receptor shows *edited [date] / reviewed [date]*; a
  "changed since last review" filter (backed by `/api/review/drift`) surfaces
  drift; **Open in Archive / Cabinet / Ledger** buttons deep-link to that receptor
  inside the atlas.
- Review state (checks, mastery, notes) now persists in the DB; JSON export/import
  is retained as a manual backup.

## 8. The atlas renders from the DB

Each volume + the shell: replace the embedded data object with an async `fetch` to
`/api/atlas/:volume` at init, then render exactly as today. Citations and
structured data (binding, clinical, claims) now come from the database. No change
to layout, engravings, animation, or themes.

## 9. Migration (one time)

`scripts/migrate.js` reads the data already embedded in the four HTML files (the
desk's `RX` is richest for citations / Stahl / claims / quizzes; the atlas volume
files supply binding and clinical values) and inserts it into `atlas.db`. Nothing
is retyped; on day one the database already contains everything built so far.

## 10. Phased delivery

- **Phase 1 — Backbone:** folder + server + `schema.sql` + `migrate.js`; atlas
  volumes fetch their data and look *identical*; desk reads from the API. Proves
  the whole loop with zero visual change.
- **Phase 2 — Sources & citations:** the library + auto-populate; atlas citations
  come from the DB (the M1/M3 PMID fix flows through automatically).
- **Phase 3 — Structured editing & sync:** edit binding/clinical/claims in the
  desk → atlas reflects it; edited-vs-reviewed tracking + deep links.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| OneDrive corrupts an open SQLite DB | Run `atlas-app/` outside OneDrive; the folder is fully portable. |
| Native module breaks after moving machines | `start.bat` runs `npm install` to rebuild `better-sqlite3`. |
| Losing data | `db/atlas.db` is a single file — copy to back up; desk JSON export as secondary. |
| Forgetting how it works later | `docs/BACKEND-PRIMER.md` explains Node + better-sqlite3 for maintenance. |
| Running a server feels heavier than opening a file | `start.bat` makes it one double-click → opens `localhost`. |

## 12. Out of scope (YAGNI for now)

- User accounts / multi-user / hosting.
- Migrating descriptive prose into the DB (prose stays in the templates).
- Any build step, bundler, or framework.
```
