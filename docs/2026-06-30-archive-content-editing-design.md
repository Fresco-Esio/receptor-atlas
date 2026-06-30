# Atlas Content Editing — Archive (Wave 1) — Design

**Date:** 2026-06-30
**Status:** Approved, ready for implementation planning.

## Goal

Extend the Conservator's Desk + atlas-app so the **Archive's descriptive prose** becomes
database-backed and editable from the desk — turning the desk from structured-facts
control (citations, clinical rows, binding values) into **content control over what is
written on the Archive page**. Edit a receptor's narrative once in the desk; reload the
Archive (`public/receptor-function.html`) and the new text appears.

This is **Wave 1**. A later **Wave 2** repeats the pattern for the Cabinet's longer
descriptions (mechanism paragraph, the three nested state write-ups, drug lists). The
cover page is intentionally out of scope (mostly decorative copy).

## Approach (the proven pattern)

Reuse the exact loop already shipped three times (citations, clinical rows, binding
values): **move the text into the database → give the desk edit fields → have the volume
page read from the database on load (embedded text kept as an offline fallback).** Low
risk; no new architecture.

## What becomes editable (per receptor, Archive narrative)

From each Archive `ENTRIES[].exhibit` object in `public/receptor-function.html`:

- `abstract` — the summary paragraph
- `body[]` — the multi-paragraph story (array of paragraphs)
- `presentation` — the one-line bedside read
- `effect` — short effect line
- `receptorClass`, `ligand` — short identity fields
- `tags[]` — the chip labels
- `figureCaption` — the illustration caption

**Not editable** (structure / artwork, not "writing"): `figureSvg` / `figureLabel` (the
hand-drawn SVG), `domains[]` (the page's filter tags), `number` / `hall` (placement).

## Data model

New table, one row per receptor that has an Archive entry:

```sql
CREATE TABLE IF NOT EXISTS archive_entries (
  receptor_id    TEXT PRIMARY KEY REFERENCES receptors(id),
  abstract       TEXT,
  presentation   TEXT,
  effect         TEXT,
  receptor_class TEXT,
  ligand         TEXT,
  figure_caption TEXT,
  body_json      TEXT,   -- JSON array of paragraph strings
  tags_json      TEXT    -- JSON array of tag strings
);
```

List-valued fields (`body`, `tags`) are stored as JSON text — the same convention used
for the clinical `over`/`under` lists.

## Linking (the translation table, again)

Archive entries are keyed by `number` / `title`, not a DB id. Add an **`archive`** set to
the existing `receptor_aliases` table mapping each entry to its receptor — alias = the
entry's `number` (as a string). The implementation's first task is a small discovery step
that reads the ~23 `ENTRIES` and hand-maps `number → receptor_id` (by title), stored as
`ARCHIVE_ALIASES` in `scripts/seed-data.js`, then seeded like the cabinet/ledger aliases.
(Note: `m3` has no Archive entry; coverage is partial and joins stay optional.)

## Migration

`scripts/migrate-archive.js` (or extend `migrate-structured.js`):
- Read `public/receptor-function.html`, extract the `ENTRIES` array with the existing
  bracket-matching `extractLiteral` helper.
- For each entry, resolve `receptor_id` via the `archive` alias (entry number) and insert
  a row into `archive_entries`.
- Idempotent (clear + reload), wired into `migrate()` best-effort like the structured
  migration. Tested on row count and a spot value.

## API

- **GET `/api/atlas/archive/narrative`** → array of
  `{ alias (entry number), receptor_id, abstract, body[], presentation, effect, receptor_class, ligand, tags[], figure_caption }`,
  shaped for the Archive page's own render code.
- **Editing reuses the existing structured endpoint.** Extend
  **PATCH `/api/receptors/:id/structured`** to accept a whitelisted `narrative` object
  (`abstract`, `body`, `presentation`, `effect`, `receptor_class`, `ligand`, `tags`,
  `figure_caption`); `volume: "archive"` so it stamps `section_activity.last_edited_at`
  (already supported). **GET `/api/receptors/:id/structured`** also returns the
  `narrative` block. This keeps all desk editing on one endpoint and reuses the
  edited-date / drift plumbing for free.

## Desk editor

Add an **"Archive narrative"** section to the existing **"Edit structured data"** panel in
`public/the-conservators-desk.html`, alongside the Claim / Clinical / Binding sections:
- `abstract`, `presentation`, `effect`, `receptor_class`, `ligand`, `figure_caption` →
  text inputs / textareas.
- `body` → one textarea, paragraphs separated by blank lines (split on blank line to the
  array, like the clinical over/under "one per line" pattern).
- `tags` → one textarea, one tag per line.
- Each field debounced → `PATCH …/structured { volume: "archive", narrative: {…} }`,
  reusing the existing `markEdited` (live edited-date + drift flag) on success.
- Only render this section for receptors that have an Archive entry.

## Archive page rendering

In `public/receptor-function.html`, hydrate `ENTRIES` from
`GET /api/atlas/archive/narrative` before first render (mutate each entry's editable
fields in place, matched by entry `number` = alias), with the embedded text kept as the
offline / `file://` fallback — identical to how the Cabinet/Ledger hydrate.
Final end-to-end check: edit a receptor's abstract in the desk → reload the Archive →
the new abstract shows.

## Testing

Backend, test-first (`node --test`):
- Migration loads `archive_entries` (row count + a spot abstract/body value).
- Aliases: `archive` aliases resolve entries to the right receptors.
- GET `/api/atlas/archive/narrative` shape + a spot value.
- PATCH `…/structured` with a `narrative` object persists each field, round-trips list
  fields as arrays, and stamps `section_activity` for `archive`.

Browser-rendering changes (desk editor wiring, Archive hydration) are verified by running
the server and inspecting the live page (no unit-testable seam), as in earlier tasks.

## Wave 2 — Cabinet (outline, not built here)

Same five moves for `public/neuroreceptor_pharmacology_explorer_dashboard.html`:
`cabinet_descriptions` table for `mechanism_long`, `subtypes`, `class`, and the three
nested state objects (`normal_state` / `overstimulated` / `understimulated`, each with
title / status / presentation[] / warning{type,title,text}) + the `agents` lists; reuse
the `cabinet` alias; extend `…/structured` with a `cabinet` block; add a "Cabinet
description" desk section; hydrate `neuroceptors` on the Cabinet page. More fields and
nested warning blocks make the editor and the render-identical care fiddlier — hence its
own wave, built on this one's proven pattern.

## Out of scope

- The cover page (`the-receptor-atlas.html`).
- The desk **layout** cleanup (parked on branch `cleanup-desk-layout`; revisit separately
  with the impeccable skill now that `DESIGN.md` / `PRODUCT.md` are in place).
