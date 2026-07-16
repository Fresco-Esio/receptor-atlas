# Binding-Affinity Provenance — Conservator's Desk — Design

**Date:** 2026-07-16
**Status:** Approved, ready for implementation planning.

## Goal

Make the Cabinet's binding-affinity numbers (the "Catalogue · binding matrix") as
verifiable as receptor citations already are, and give the Conservator's Desk a
**drug-first section** to review them. Two problems, one design:

1. **The sources are unfindable.** Every binding Ki carries a `src` tag, but it renders
   only in a hover tooltip — one dot at a time, nothing clickable, no list to scan, and
   no connection to the `sources` library the rest of the app cites through.
2. **The affinity data was never authenticated.** The Desk's masthead says
   "Authenticate every specimen before it goes on the wall," yet the binding matrix is
   the one exhibit with no review surface. The per-receptor "Affinity / pKi" checkbox is
   a bare boolean that certifies data the Desk never shows.

This design wires binding values into the existing citation machinery and adds the review
surface. It does **not** change the per-receptor specimen rows.

## Approach (reuse the proven citation pattern)

The app already models verifiable provenance once — `sources` + `receptor_sources` +
per-edge status (verified/provided/conflicting), surfaced in the Desk's "Sources &
citations" panel. Bindings get a **structurally identical twin**: a `binding_sources`
edge table, twin API routes, and the same `.srow` citation markup reused verbatim. No new
architecture; mirror what ships and works.

## Verified data facts (basis for scope)

Parsed directly from `public/neuroreceptor_pharmacology_explorer_dashboard.html`
(`AFF_AGENTS`), not from summaries:

- **71 agents (drugs), 136 binding entries** across 13 receptor targets. All 71 have a
  PubChem `cid`; all 136 have a `src` tag (100% populated, 0 empty).
- **Bindings per drug are lopsided:** 38 drugs have exactly 1 binding; only 8 have ≥4.
  The rich rows are the promiscuous antipsychotics — Chlorpromazine, Olanzapine, and
  Clozapine at 7 bindings each.
- **The citation edge must be per-binding, not per-drug:** 14 of 71 drugs cite *different*
  sources for *different* targets (Chlorpromazine's 7 bindings draw on 4 distinct
  sources; Haloperidol's 4 draw on 3). A per-drug edge would flatten real distinctions.
- **17 distinct `src` tags** collapse to ~13 real source records. Distribution:

  | Tag | Entries | Becomes |
  |---|---|---|
  | PDSP Ki DB | 40 | one `database` source |
  | IUPHAR/BPS | 34 | one `database` source |
  | literature | 14 | *unattributed → no edge* |
  | literature (tier) | 12 | *unattributed → no edge* |
  | Proudman 2020 | 12 | one `article` source |
  | qualitative | 5 | *unattributed → no edge* |
  | PMC5756147 | 5 | one `article` source |
  | Neuropsychopharmacology 2009 | 2 | one `article` source |
  | J Neural Transm 2003 | 2 | one `article` source |
  | Biol Psychiatry 2001 | 2 | one `article` source |
  | PMC4662164 | 2 | one `article` source |
  | Eur Neuropsychopharmacol 2020 | 1 | one `article` source |
  | StatPearls | 1 | one `database` source |
  | PMC10851641 | 1 | one `article` source |
  | PDSP / literature | 1 | maps to the PDSP source |
  | eLife 2020 | 1 | one `article` source |
  | PMC5437659 | 1 | one `article` source |

  → **13 sources cover 105 edges; 31 bindings (literature / literature (tier) /
  qualitative) resolve to `needs-source`.** 105 + 31 = 136. ✓

- **No existing link between the two provenance systems.** `binding_values.src` is free
  text; there is no foreign key or join to `sources` / `receptor_sources` anywhere in
  `lib/queries.js` or `lib/router.js`. The dashboard arrived fully formed in commit
  `61fbe0c`, staged from outside the repo — so the `src` tags are **self-reported labels,
  not a verified chain**. "PDSP Ki DB" asserts an origin; nothing in the repo confirms the
  number was ever in PDSP. This is why authentication (not just display) is the point.

## Data model

> **Verified constraint (probe, 2026-07-16):** `migrate()` runs on every server
> startup and, when the DB is already seeded, calls `migrateStructured()`, which does
> `DELETE FROM binding_values` and rebuilds it. A file-backed probe confirmed a binding
> row's `id` changes across a restart (1 → 137) and any column edit is wiped. Therefore
> **`binding_values.id` is NOT a stable key** and nothing durable may reference it. The
> stable identity of a binding is the pair **`(agent_name, target_alias)`**, which comes
> from the volume HTML and is reproduced identically on every rebuild. Both new tables key
> off that pair. (This also means the new provenance tables need no coupling to the
> destructive rebuild — they simply join on the stable pair.)

### New table — the citation edge (mirrors `receptor_sources`, keyed by the stable pair)

```sql
-- A binding (identified by the stable agent_name × target_alias pair, since
-- binding_values.id is regenerated on every migrate) can cite any number of library
-- sources. Per-edge status answers "is this citation sound?"; the number-vs-source
-- check lives separately in binding_review. A binding with zero rows here is
-- "needs-source" (same convention as rollupStatus for receptors).
CREATE TABLE IF NOT EXISTS binding_sources (
  agent_name   TEXT NOT NULL,
  target_alias TEXT NOT NULL,
  source_id    INTEGER NOT NULL REFERENCES sources(id),
  status       TEXT NOT NULL DEFAULT 'provided',  -- 'verified' | 'provided' | 'conflicting'
  PRIMARY KEY (agent_name, target_alias, source_id)
);
```

No `is_primary` — unlike receptors, bindings have no "atlas volume shows exactly one
citation" invariant to protect, so the primary-edge machinery is omitted.

### New table — the per-number transcription check (also keyed by the stable pair)

```sql
-- The "does our Ki match what the source says?" check, separate from citation
-- soundness. Keyed by the stable pair so a value_status survives the binding_values
-- rebuild. A binding with no row here is implicitly 'unchecked'.
CREATE TABLE IF NOT EXISTS binding_review (
  agent_name   TEXT NOT NULL,
  target_alias TEXT NOT NULL,
  value_status TEXT NOT NULL DEFAULT 'unchecked',  -- 'unchecked' | 'confirmed' | 'mismatch'
  PRIMARY KEY (agent_name, target_alias)
);
```

Two **independent** trust signals, as decided:

- **`binding_sources.status`** — *is the source sound?* Per-edge, verified/provided/conflicting.
- **`binding_review.value_status`** — *does our Ki match what the source says?*
  `mismatch` is first-class: "the paper is fine, our number is wrong" — the exact error
  class the hand-authored data cannot currently record.

`binding_values.src` is **preserved unchanged** as the as-imported label, so the original
hand-author claim stays visible even after a formal source is attached (and especially for
the 31 needs-source bindings, where it's the only starting hint).

### Schema-change handling

- Both `binding_sources` and `binding_review` are `CREATE TABLE IF NOT EXISTS` — free on
  existing DBs, no `ALTER TABLE`, no dependence on the unstable `binding_values.id`.
- `sources.kind` gains a third value `'database'` (for PDSP Ki DB, IUPHAR/BPS,
  StatPearls). The router already accepts any `kind` string (`body.kind ?? 'article'`),
  so **no validation change** is required — only the migration inserts it, and the Desk's
  source combobox learns to label it.

## Migration (runs every startup, seed-only, never clobbers)

New script `scripts/migrate-binding-sources.js`, following `migrate-structured.js` style.
Because `binding_values` is rebuilt on every startup, this **also runs on every startup**
(right after `migrateStructured`, since it reads the freshly-built `binding_values`). It is
**seed-only**, not destructive: it uses `INSERT OR IGNORE`, so it fills in any missing
migration edge but **never overwrites a status a curator has since changed**. It does not
touch `binding_review` at all (that is pure user data).

1. A hardcoded **tag → source template** map (16 template tags + 1 alias): kind, and
   whatever metadata the tag carries (databases get a name + `url`; `article` tags get
   `journal`+`year` or a PMC `url`; title/authors left blank where the tag never carried
   them — see the concrete map in the plan's Task 2).
2. For each `binding_values` row (reading `agent_name`, `target_alias`, `src`):
   - **Real tag** → **find-or-create** the `sources` row (dedup: reuse an existing row
     matching the template's defining fields, else insert once), then
     `INSERT OR IGNORE INTO binding_sources (agent_name, target_alias, source_id, status)`
     with `status='provided'` (carried, *not* verified — the migration attributes, it does
     not authenticate).
   - **Unattributed tag** (`literature`, `literature (tier)`, `qualitative`) → **no edge**;
     the binding is `needs-source`. `binding_values.src` stays as the label.
   - `PDSP / literature` → aliases to the `PDSP Ki DB` source (it names the database).
3. `binding_review` is left empty — every binding is implicitly `unchecked` until a
   curator sets it.

**End state on a fresh build:** 13 sources, 105 edges (all `provided`), 31 needs-source,
136 numbers `unchecked`. The backlog, made visible and truthful. PMC `url`s are resolvable,
so those citations become clickable immediately. **On a re-run** (restart), the 13 sources
are found-not-recreated and the 105 edges are `INSERT OR IGNORE`d — so a curator's
`verified`/`conflicting` statuses and any hand-attached sources are preserved.

Wire into the migrate chain (`migrate.js`) so both the fresh-build and the
already-seeded paths call it after `structuredBestEffort`, wrapped best-effort like its
neighbours so a volume-file problem can't break the core seed.

## API — twin the receptor-source routes (keyed by the stable pair)

Binding identity in URLs is the stable pair, `encodeURIComponent`-encoded:
`/api/bindings/:agent/:target/...` (handlers `decodeURIComponent` the two captures).
This avoids the unstable `binding_values.id` entirely.

- `GET /api/agents/binding` — drug-first payload: one object per agent, each with its
  bindings, and for each binding its attached sources (`{id, kind, authors, year, title,
  journal, pmid, doi, url, status}`) + `value_status` + preserved `src` label. New query
  `agentBindingProvenance(db)` in `lib/queries.js` (joins `binding_values` →
  `binding_sources` and `binding_review` on the stable pair).
- `GET /api/sources/binding-usage` — per source: the count of binding edges citing it and
  a rolled-up status (reusing `rollupStatus`), powering the by-source panel. Separate route,
  so the existing `GET /api/sources` stays byte-for-byte unchanged.
- `POST /api/bindings/:agent/:target/sources` — attach a library source (`source_id`) or
  create-inline (`source`) and attach, with `status`. Twin of the receptor
  `POST .../sources` handler; validates the pair exists in `binding_values`.
- `PATCH /api/bindings/:agent/:target/sources/:sid` — set edge `status`. Twin of the
  receptor edge PATCH.
- `DELETE /api/bindings/:agent/:target/sources/:sid` — unlink (keeps the shared library row).
- `PATCH /api/bindings/:agent/:target/review` — upsert `value_status` into `binding_review`
  (whitelisted to the three allowed values).
- `PATCH /api/sources/:id/binding-status` — **bulk**: set every `binding_sources` edge
  citing this source to a status in one call (the source `id` IS stable). The leverage
  route: verify PDSP Ki DB once → all 41 of its edges clear. Since two databases account
  for 75 of 105 edges, most curation happens here.

All routes parameterized (`?`), whitelisted values only — same SQL-injection discipline as
the existing router. Reuse the existing `sources` library routes (`POST`/`PATCH
/api/sources`) unchanged for creating/editing source records.

## The Desk section — "Binding affinities," drug-first

A new top-level section in `public/the-conservators-desk.html`, following house style
(`.panel` / `.pk` blocks, render-then-wire, expandable rows like `.spec`, CSS custom
properties, per-edge `.srow` markup reused verbatim). Two registers, because the data has
two natural shapes:

- **By source** (top) — the bulk-clearing surface. The 13 sources listed, each with
  "N bindings cite this," a verified/provided/conflicting toggle, and a "verify all N"
  action (→ `PATCH /api/sources/:id/binding-status`). Because 75/105 edges are two
  databases, most of the backlog collapses to a few decisions here.
- **By drug** (below) — all 71 agents. 38 are single-binding (shallow rows); the
  promiscuous antipsychotics are the rich ones. Each drug expands to its bindings:
  target · Ki · action · cited source(s) with status (reusing `.srow`) · a
  confirm/mismatch control for `value_status`. A filter rail mirrors the existing one:
  *needs-source · unverified · unconfirmed · has mismatch · cleared.*

A summary strip reports the two independent tallies: *X of 136 numbers confirmed* and
*Y of 13 sources verified · 31 needs-source.*

Saving follows the Desk's existing immediate-persist pattern (no dirty state / no save
button); source-combobox add-flow is reused from the receptor sources panel.

## Explicitly out of scope (YAGNI)

- **The per-receptor "Affinity / pKi" checkbox stays a bare boolean.** Drug-first was
  chosen *without* the receptor rollup, so specimen rows are untouched. (A later rollup —
  deriving that checkbox from real binding coverage — is a clean follow-on, not this work.)
- **The Cabinet matrix tooltip** keeps showing the `src` label. Upgrading it to show a
  "verified" badge is an attractive downstream benefit but is not part of "a Desk section
  to review the bindings."
- **Backfilling real citation metadata** (authors/titles/PMIDs for the blank article
  records) is curation work the new UI *enables*; the migration only seeds the shells.

## Testing

Mirror `test/` patterns (`node --test`, `createServer(':memory:', {seed:true})`):
- Unit: the tag→source map yields 13 sources / 105 edges / 31 needs-source over the real
  seeded DB; migration idempotency (re-run keeps counts and preserves a hand-set
  `verified` status); `agentBindingProvenance` shape (71 agents, edges + `value_status`).
- **Persistence regression** (the reason for the stable key): seed → set a binding edge to
  `verified` and a `value_status` to `confirmed` → re-run `migrate(db)` → assert both
  survive. This is the test that would have failed under the id-keyed design.
- Route: attach/status/unlink binding edges; `value_status` PATCH whitelist; bulk
  `binding-status` sets all edges for a source; 404/400 paths matching existing handlers.

## Open implementation questions (for the plan, not blocking)

- Exact `sources` template metadata for each of the 13 tags (journal names, PMC URLs) is
  pinned in the plan's Task 2 map; titles/authors for the article shells are left blank on
  purpose, for the curator to backfill through the new UI.
