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

### New table — mirror `receptor_sources`

```sql
-- A binding value can cite any number of library sources (mirrors receptor_sources).
-- Per-edge status answers "is this citation sound?"; the number-vs-source check lives
-- separately on binding_values.value_status. A binding with zero rows here is
-- "needs-source" (same convention as rollupStatus for receptors).
CREATE TABLE IF NOT EXISTS binding_sources (
  binding_id INTEGER NOT NULL REFERENCES binding_values(id),
  source_id  INTEGER NOT NULL REFERENCES sources(id),
  status     TEXT NOT NULL DEFAULT 'provided',  -- 'verified' | 'provided' | 'conflicting'
  PRIMARY KEY (binding_id, source_id)
);
```

No `is_primary` — unlike receptors, bindings have no "atlas volume shows exactly one
citation" invariant to protect, so the primary-edge machinery is omitted.

### New column — the per-number transcription check

```sql
ALTER TABLE binding_values ADD COLUMN value_status TEXT NOT NULL DEFAULT 'unchecked';
-- 'unchecked' | 'confirmed' | 'mismatch'
```

Two **independent** trust signals, as decided:

- **`binding_sources.status`** — *is the source sound?* Per-edge, verified/provided/conflicting.
- **`binding_values.value_status`** — *does our Ki match what the source says?*
  `mismatch` is first-class: "the paper is fine, our number is wrong" — the exact error
  class the hand-authored data cannot currently record.

`binding_values.src` is **preserved unchanged** as the as-imported label, so the original
hand-author claim stays visible even after a formal source is attached (and especially for
the 31 needs-source bindings, where it's the only starting hint).

### Schema-change handling

- `binding_sources` is `CREATE TABLE IF NOT EXISTS` — free on existing DBs.
- `value_status` needs `ALTER TABLE ... ADD COLUMN` for the already-built `db/atlas.db`.
  Guard it (check `PRAGMA table_info(binding_values)` for the column before adding) so a
  re-run is a no-op. Add the column to `db/schema.sql` too, for fresh builds.
- `sources.kind` gains a third value `'database'` (for PDSP Ki DB, IUPHAR/BPS,
  StatPearls). The router already accepts any `kind` string (`body.kind ?? 'article'`),
  so **no validation change** is required — only the migration inserts it, and the Desk's
  source combobox learns to label it.

## Migration (one-time, idempotent)

New script `scripts/migrate-binding-sources.js`, following `migrate-structured.js` style
(idempotent: clears `binding_sources` and resets `value_status`, then rebuilds):

1. A hardcoded **tag → source template** map (17 tags): kind, and whatever metadata the
   tag carries (databases get a name + `url`; `article` tags get `journal`+`year` or a PMC
   `url`; title/authors left blank where the tag never carried them).
2. For each `binding_values` row: look up its `src` tag.
   - **Real tag** → find-or-create the `sources` row (dedup by the template), insert a
     `binding_sources` edge with `status='provided'` (carried, *not* verified — the
     migration attributes, it does not authenticate).
   - **Unattributed tag** (`literature`, `literature (tier)`, `qualitative`) → **no edge**;
     the binding is `needs-source`. `src` stays as the label.
   - `PDSP / literature` → maps to the PDSP source (it names the database).
3. All `value_status` stay `'unchecked'`.

**End state:** 13 sources, 105 edges (all `provided`), 31 needs-source, 136 numbers
`unchecked`. The backlog, made visible and truthful. PMC `url`s are resolvable, so those
citations become clickable immediately.

Wire into the migrate chain so a fresh `db/atlas.db` build runs it after
`migrate-structured` (which must populate `binding_values` first, since edges reference
`binding_values.id`).

## API — twin the receptor-source routes

New read shape for the drug-first section, and binding twins of the three receptor-source
write routes (copied from `lib/router.js` handlers):

- `GET /api/agents/binding` — drug-first payload: one object per agent, each with its
  bindings, and for each binding its attached sources (`{id, kind, authors, year, title,
  journal, pmid, doi, url, status}`) + `value_status` + preserved `src` label. New query
  `agentBindingProvenance(db)` in `lib/queries.js`.
- `GET /api/sources/binding-usage` (or fold into `GET /api/sources`) — per source, the
  count of binding edges and a rolled-up status, powering the by-source panel.
- `POST /api/bindings/:id/sources` — attach a library source (`source_id`) or create-inline
  (`source`) and attach, with `status`. Twin of the receptor `POST .../sources` handler.
- `PATCH /api/bindings/:id/sources/:sid` — set edge `status`. Twin of receptor edge PATCH.
- `DELETE /api/bindings/:id/sources/:sid` — unlink (keeps the shared library row).
- `PATCH /api/bindings/:id` — set `value_status` (whitelisted; only that column).
- `PATCH /api/sources/:id/binding-status` — **bulk**: set every binding edge citing this
  source to a status in one call. The leverage route: verify PDSP Ki DB once → 40 numbers
  clear. Since two databases account for 75 of 105 edges, most curation happens here.

All routes parameterized (`?`), whitelisted columns only — same SQL-injection discipline
as the existing router. Reuse the existing `sources` library routes (`POST`/`PATCH
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

Mirror `test/` patterns:
- Unit: `agentBindingProvenance` shape; migration idempotency; the tag→source map yields
  13 sources / 105 edges / 31 needs-source over the real `AFF_AGENTS`.
- Route: attach/status/unlink binding edges; `value_status` PATCH whitelist; bulk
  `binding-status` sets all edges for a source; 404/400 paths matching existing handlers.

## Open implementation questions (for the plan, not blocking)

- Whether `GET /api/sources/binding-usage` is a separate route or an enrichment on
  `GET /api/sources` (leaning: separate, to keep the library route unchanged).
- Exact `sources` template metadata for each of the 13 tags (journal names, PMC URLs) —
  a lookup table authored during implementation.
