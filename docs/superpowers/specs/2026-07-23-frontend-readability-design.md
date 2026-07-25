# Frontend readability: a shared design layer and one source of truth for action colour

**Date:** 2026-07-23
**Status:** SUPERSEDED by `2026-07-25-frontend-architecture-design.md`, which widens the
scope from the radar/tokens to a whole-frontend architecture pass. This document is kept
for the radar diagnosis, which the successor references rather than repeats.

## Why

A reviewer trying to change the Cabinet's radar chart colours could not find the code
that sets them. That failure is reproducible and has a specific cause, documented below.
The goal of this work is that an independent team can locate and understand the
structure without archaeology.

## The diagnosis

The radar's colour map lives at
`public/neuroreceptor_pharmacology_explorer_dashboard.html:2935`, nested 65 lines inside
`renderAffinityRadar()` in a 3,326-line file:

```js
const ACT_COLOR = { ag: 'var(--st-normal)', pa: 'var(--brass)', an: 'var(--st-over)', ri: 'var(--st-under)' };
```

Four compounding problems make this unfindable:

1. **The token names encode the wrong concept.** `--st-normal` was introduced for the
   clinical-state exhibit wall (`:355`). It is reused here to mean *agonist*. Searching
   for "agonist", "radar", or "colour" reaches none of it.
2. **One meaning, six declarations.** "Agonist is green" is independently restated at
   `:614`, `:684`, `:741`, `:815`, and `:2935`. Two of those hardcode the raw
   `oklch(78% 0.085 158 / 0.45)` rather than referencing the token, so they will drift
   silently the first time the green is retuned.
3. **No shared layer.** `public/` holds ten HTML files and zero `.css`/`.js`. Every page
   inlines its own copy of the palette; the agonist-green literal appears 15 times across
   10 files.
4. **Stale comments.** `:2869` reads "Radar SVG, 10 axes"; there are 13.

The backend is not implicated. `server.js`, `db/index.js`, `lib/router.js`, and
`lib/queries.js` are modular and explain *why* — the path-traversal containment check
(`server.js:79`) and the body-cap rejection rationale (`router.js:12`) are exemplary. The
frontend simply never received the same treatment.

## Scope

**In:** the six tracked pages — the shell (`the-receptor-atlas.html`), Cabinet
(`neuroreceptor_pharmacology_explorer_dashboard.html`), Archive (`receptor-function.html`),
Ledger (`neuroreceptor_clinical_table.html`), Desk (`the-conservators-desk.html`), and
demo (`receptor-atlas-demo.html`).

**Out:** the four untracked `the-threshold*.html` variants (unresolved scratch, 7–8 lines
apart from each other). Flagged for separate resolution; migrating them may be wasted work.

**Out:** any change to API payload shapes, database schema, or the `dist/` data contract.

## Design

### 1. `public/assets/tokens.css` — the one palette

Extracted from the six pages, which currently each carry a copy. Three layers, so that a
name always states which concept it serves:

```css
:root {
  /* palette: raw hues. Referenced by name below; never used directly in a rule. */
  --hue-green: oklch(78% 0.085 158);
  --hue-amber: oklch(66% 0.185 38);
  --hue-blue:  oklch(72% 0.10  245);

  /* what a drug DOES at a receptor — Cabinet radar and matrix */
  --action-agonist:            var(--hue-green);
  --action-partial:            var(--brass);
  --action-antagonist:         var(--hue-amber);
  --action-reuptake-inhibitor: var(--hue-blue);

  /* what STATE a receptor is in — the exhibit wall repaint */
  --state-normal: var(--hue-green);
  --state-over:   var(--hue-amber);
  --state-under:  var(--hue-blue);
}
```

`--action-*` and `--state-*` resolve to identical values today, so this is visually inert.
The point is that they are now *separable*: retuning the antagonist amber will no longer
silently repaint the overstimulated-state wall.

The remaining tokens (`--bone*`, `--brass*`, `--wall-*`, `--display`/`--body`/`--mono`,
`--ease`, stagger timings) move across unchanged.

Old names are **not** kept as aliases. A migration that leaves `--st-normal` working leaves
the original confusion in place; the rename is the deliverable.

### 2. Cabinet: one source of truth for action colour

The action vocabulary has exactly one consumer — the Cabinet. The Ledger and Archive use
"agonists"/"antagonists" only as plain-text lists (`clinical_table.html:480`), never as a
colour encoding. Extracting a shared `pharmacology.js` would therefore be speculative
reuse and is explicitly rejected.

Instead, within the Cabinet:

- `ACT_COLOR` is renamed `ACTION_COLOR` and hoisted out of `renderAffinityRadar()` to sit
  with the other domain constants at the top of the script block, under a header comment
  naming it as the single edit point.
- The two hardcoded `oklch(...)` literals at `:614` and `:815` are replaced with
  `--action-*` tokens.
- The CSS classes `.dot.ag` / `.lk.ag` / `.tag.agonist` / `.concept-chip.ag` are gathered
  into one contiguous, commented block rather than scattered across the 1,002-line style
  element.

After this, CSS and JS both bottom out on `--action-agonist`. The comment at `:2934` that
currently *promises* radar and matrix agree becomes true by construction.

### 3. Cabinet: naming inside the affinity plate

Scoped to the functions the reviewer was actually reading: `renderAffinityRadar`,
`polyPath`, `polyDots`, `drawPolys`, `bindingV`, `primaryAct`, `dotSize`.

Local variables and function names are renamed for legibility — `bindingV` →
`affinityToRadius`, `ccx`/`ccy` → `centreX`/`centreY`, `nm` → `agentName`, `leg` →
`legendEl`, and so on.

**Property names are not renamed.** `{name, g, cid, b:{}}` is a wire format: produced by
`cabinetBinding()` (`lib/queries.js:104`), served at `/api/atlas/cabinet/binding`, frozen
into `dist/data/cabinet-binding.json` by `publish.js`, and asserted on by five test files.
Renaming it is an API change, not a readability change, and is out of scope.

The boundary is instead *documented* by destructuring where the data enters:

```js
// Wire shape — both the embedded AFF_AGENTS literal and
// /api/atlas/cabinet/binding return: { name, g: <group>, cid, b: { [targetAlias]: binding } }
const { b: bindings, g: group } = agent;
```

Readable names in the code that is read; no churn in the contract.

*Noted, not fixed:* `cabinetBinding()` returns `b: {}` (object) while
`agentBindingProvenance()` returns `bindings: []` (array) for the same concept, in the same
file. A real inconsistency, but changing either is an API change and belongs to its own
piece of work.

### 4. Publish pipeline

`publish.js` copies named pages only (`:94–107`) and has no concept of an asset directory.
Extracting CSS without changing it would ship a **stylesheet-less** site to GitHub Pages.

Two changes:

```js
const ASSET_DIR = 'assets';   // shared css/js; every page links it relatively
await cp(join(PUBLIC, ASSET_DIR), join(outDir, ASSET_DIR), { recursive: true });
```

All page references use **relative** hrefs (`assets/tokens.css`, never `/assets/...`),
because the shim comment at `publish.js:39` documents that the bundle must work both at a
domain root and at a `/repo/` subpath on Pages.

Both dev servers (`server.js`, `scripts/serve-dist.js`) already register `.css` and `.js`
MIME types and both apply directory containment checks, so neither needs modification.

### 5. Comments

- Fix the stale count at `:2869` ("10 axes" → 13).
- Replace the ~20 `// Task 4:`-style comments in `lib/` and `scripts/` with statements of
  what the code does. They reference a plan document an independent team will not have,
  which is precisely the audience this work serves.

## Testing

The existing 24 test files must continue to pass unchanged — that is the primary safety
net, and no API shape or DB schema is touched.

One new assertion in `test/publish.test.js`: every asset referenced by a published page
must exist in the output bundle. Without it, the "extraction silently breaks the published
site" failure recurs the next time someone adds an asset, and it fails invisibly in
production rather than in CI.

Manual verification, per stage: run `npm run migrate` (the DB is not seeded automatically),
start the dev server, and confirm the Cabinet radar and matrix render with unchanged
colours; then `npm run snapshot && npm run preview` and confirm the published bundle is
styled.

## Delivery

Four independently reviewable and revertible commits:

1. Extract shared design tokens into `assets/tokens.css`; relink the six pages.
2. Publish pipeline: copy `assets/` into `dist/`, plus the guard test.
3. Cabinet: one source of truth for action colour; rename inside the affinity plate.
4. Comments: fix the stale axis count and the plan-referencing comments.

Stage 2 must land with or before stage 1 reaches a deploy, or the published site loses its
styling.

## Success criterion

Searching the repository for `agonist` reaches the code that colours the radar. That is the
concrete test of whether this work achieved its purpose.
