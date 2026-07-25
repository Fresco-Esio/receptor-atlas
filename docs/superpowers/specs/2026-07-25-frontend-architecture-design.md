# Frontend architecture pass: a shared design layer, token discipline, semantics, and accessibility

**Date:** 2026-07-25
**Status:** approved in principle, pending final spec review
**Supersedes:** `2026-07-23-frontend-readability-design.md` (the radar diagnosis there stands;
this widens the scope to the whole frontend).

## Why

A reviewer trying to change the Cabinet radar's colours could not find the code that set
them. That specific failure (diagnosed in the superseded spec) turned out to be one symptom
of a codebase-wide condition: the frontend has no shared foundation, so every page reinvents
its tokens, naming, and structure, and detail leaks out of the systems meant to contain it.

The goal is that an independent team can locate and understand the structure and logic
without archaeology.

## What the audit found

Five parallel audits (one Sonnet subagent per substantial page) reached a consistent verdict.
The headline is a course-correction: **this is not "div soup."** Every page already has a
semantic backbone (`<header>/<main>/<section>/<article>/<footer>`), a `:root` token block, and
a mostly-consistent naming convention. Static `<div>` ratios sit at a reasonable 18–20%.

The real problems are four, ordered by value-to-risk:

1. **No shared layer.** The palette is inlined in all six pages, in *three different
   vocabularies* for one set of hues: `--st-normal` (dashboard), `--green` (demo,
   `receptor-atlas-demo.html:16`), and the raw literal `oklch(78% 0.085 158)` (15 occurrences
   across 10 files). The cross-volume messaging protocol is reimplemented in four files.

2. **Token leakage.** `:root` exists everywhere but rules bypass it. The dashboard alone has
   **457 hardcoded spacing literals** and **48 hardcoded `oklch()` colours** in rules; the
   other pages are proportionally similar. There is no spacing scale anywhere.

3. **Accessibility gaps concentrated in generated DOM.** Static markup generally has
   `:focus-visible` and aria; the interactive elements built at runtime via `innerHTML` do not.
   Specific defects: the Ledger's `<table>` has no `<th scope="col">`; the Desk has ~89 form
   controls and 2 aria attributes; two anti-patterns appear — `.wf-item:focus { outline:none }`
   with no visible substitute (`receptor-function.html`), and `cursor:pointer` on non-button
   `<div>`s used as controls.

4. **A few genuine semantic misses.** Generated `.entry` should be `<article>`; the dashboard's
   `.plaque` alert should be `<aside role="alert">`; the Ledger needs `<th scope>`.

The backend is **not** implicated and is out of scope: `server.js`, `db/index.js`,
`lib/router.js`, and `lib/queries.js` are modular and their comments explain *why*.

## The governing constraint

Every page builds DOM by concatenating `innerHTML` strings with **class names embedded in the
string literals**. All five auditors independently rated a wholesale class rename MEDIUM–HIGH
risk: it is a two-front edit (CSS rule *and* every JS template) where a single missed usage
breaks a feature **silently**. Every decision below is shaped by this fact.

## Scope decisions

- **BEM where it's earned.** Strict BEM (`block__element--modifier`) in the new shared layer
  (free — it is new code) and a full BEM conversion of the **Cabinet** as the exemplar (it is
  the file that triggered this work). The other four pages keep their existing, already-
  consistent naming; instead of renaming them, we **decouple** their class names from JS (see
  §4) so any future rename becomes a one-line change. Rationale: the current naming is readable;
  a six-file BEM rename is the high-cost, high-risk, low-architectural-value option — the
  "statistically common" answer, not the appropriate one. The radar problem was a token-naming
  and duplication problem, not a separator problem.

- **Shared layer = tokens + base CSS + shared JS.** `assets/tokens.css`, `assets/base.css`,
  `assets/atlas.js`. Page-specific CSS/JS stays inline: these are standalone, iframe-embeddable
  volumes, and single-file delivery is a real property of the product, not an accident. We are
  not splitting every page into modules.

- **Six tracked pages in scope:** shell (`the-receptor-atlas.html`), Cabinet
  (`neuroreceptor_pharmacology_explorer_dashboard.html`), Archive (`receptor-function.html`),
  Ledger (`neuroreceptor_clinical_table.html`), Desk (`the-conservators-desk.html`), demo
  (`receptor-atlas-demo.html`).

- **Out:** the four untracked `the-threshold*.html` variants (unresolved scratch); any change
  to API payload shapes, DB schema, or the `dist/` data contract.

## Design

### 1. `assets/tokens.css` — one palette, one spacing scale

The single source of colour and spacing. Three layers so a name always states its concept:

```css
:root {
  /* palette: raw hues, referenced by name below, never used directly in a rule */
  --hue-green: oklch(78% 0.085 158);
  --hue-amber: oklch(66% 0.185 38);
  --hue-blue:  oklch(72% 0.10  245);

  /* what a drug DOES at a receptor — Cabinet radar + matrix */
  --action-agonist: var(--hue-green);  --action-partial: var(--brass);
  --action-antagonist: var(--hue-amber);  --action-reuptake-inhibitor: var(--hue-blue);

  /* what STATE a receptor is in — the exhibit wall */
  --state-normal: var(--hue-green);  --state-over: var(--hue-amber);  --state-under: var(--hue-blue);

  /* surfaces, ink, metal, motion, type — the existing --wall-*/--bone-*/--brass-*/--ease/font tokens */

  /* spacing scale — replaces the ~400 ad-hoc literals per page */
  --space-2xs: 0.25rem; --space-xs: 0.5rem; --space-sm: 0.75rem; --space-md: 1rem;
  --space-lg: 1.5rem; --space-xl: 2rem; --space-2xl: 3rem;
}
```

`--action-*` and `--state-*` resolve to identical values today (visually inert) but are now
separable and searchable — the fix for the original radar failure. The three page vocabularies
collapse onto this file; the demo's `--green`/`--wall` names are migrated, not aliased.

Fluid `clamp()` expressions that genuinely scale with viewport are kept as-is; only *fixed*
repeated literals move to the scale. We do not manufacture a token for every one-off value —
that would trade 400 literals for 400 tokens and call it progress.

### 2. `assets/base.css` — reset + shared primitives

The CSS reset, the `:focus-visible` baseline ring, `.sr-only`, and the handful of primitives
every page redefines. Page-specific rules stay in each page's own `<style>`.

### 3. `assets/atlas.js` — the cross-volume bridge, as a factory

The audit found the four bridges share a *protocol* but not their internals: each volume has its
own canonical-id↔local-id map (`CANON2NUM` / `CANON2LOCAL` / `CANON2NO`) and its own local
navigation (hash / `selectedReceptorId` / row click). So this is **not** a copy-paste dedup.

`atlas.js` exports the shared transport and envelope — `up(msg)`, the `atlas:subject` /
`atlas:trace` message-type constants, the `message` listener, embed/iframe detection — as a
small factory each page configures with its own id-map and "focus this subject locally" adapter:

```js
// each page:
createAtlasBridge({
  volume: 'cabinet',
  idMap: CANON2LOCAL,
  focusSubject: (localId) => selectReceptor(localId),  // page-specific adapter
});
```

The shell (`the-receptor-atlas.html`) is the parent side of the same protocol and consumes the
same constants. This removes the protocol duplication while keeping each page's genuinely
different navigation logic where it belongs.

### 4. Decoupling class names from JS (the four non-Cabinet pages)

The rename-risk fix. In each page, the class names currently inlined in `innerHTML` templates are
lifted into a single `CLASS` constant near the top of the script, so CSS ↔ JS agreement has one
authority and a future rename is a one-line edit:

```js
const CLASS = { row: 'rec-row', rowOpen: 'is-open', detail: 'detail-row' };
// template: `<tr class="${CLASS.row}" ...>`  — querySelector(`.${CLASS.row}`)
```

Existing names are preserved (no visual or behavioural change); only their *definition point*
moves. This is what makes the deferred BEM decision safe to defer.

### 5. Cabinet BEM exemplar + one source of truth for action colour

The Cabinet is converted to strict BEM and becomes the reference page. Within it:

- `ACT_COLOR` → `ACTION_COLOR`, hoisted out of `renderAffinityRadar()` to the domain-constants
  block at the top of the script, under a header comment naming it the single edit point.
- The hardcoded `oklch(...)` action colours at `:614` and `:815` become `--action-*` tokens, so
  CSS and JS both bottom out on the same token. The `:2934` comment that *promises* radar and
  matrix agree becomes true by construction.
- Local names in the affinity-plate functions are made legible (`bindingV` → `affinityToRadius`,
  `ccx`/`ccy` → `centreX`/`centreY`, `nm` → `agentName`, `leg` → `legendEl`).
- **Wire-format property names are NOT renamed.** `{name, g, cid, b:{}}` is produced by
  `cabinetBinding()` (`lib/queries.js:104`), served at `/api/atlas/cabinet/binding`, frozen into
  `dist/data/cabinet-binding.json`, and asserted on by five tests. It is documented at the point
  it enters the code, via destructuring, instead:
  `const { b: bindings, g: group } = agent;`

*Noted, not fixed:* `cabinetBinding()` returns `b:{}` (object) while `agentBindingProvenance()`
returns `bindings:[]` (array) for the same concept — a real inconsistency, but changing either is
an API change and belongs to its own work.

### 6. Accessibility pass (all six pages)

- Add `<th scope="col">` to the Ledger header cells; add a `<caption>` (may be `.sr-only`).
- Replace `outline:none`-without-substitute with a visible `:focus-visible` treatment.
- Give runtime-generated interactive elements a real `<button>`/role + `aria-label`; retire
  `cursor:pointer`-on-`<div>` controls.
- Desk: associate every form control with a `<label>` (or `aria-label` where layout forbids one).
- Apply the handful of semantic upgrades (`.entry`→`<article>`, `.plaque`→`<aside role="alert">`).

### 7. Publish pipeline

`publish.js` copies named pages only (`:94–107`) and has no concept of an asset directory.
Shipping external assets without changing it would deploy an **unstyled** site to GitHub Pages.

```js
const ASSET_DIR = 'assets';                 // shared css/js; pages link it relatively
await cp(join(PUBLIC, ASSET_DIR), join(outDir, ASSET_DIR), { recursive: true });
```

All page references use **relative** hrefs (`assets/tokens.css`, never `/assets/...`) because the
shim comment at `publish.js:39` documents that the bundle must work at a `/repo/` subpath on
Pages. Both dev servers already send `.css`/`.js` MIME types and apply directory containment, so
neither changes. A new assertion in `test/publish.test.js` fails the build if a published page
references an asset absent from the bundle — otherwise this breakage recurs silently.

## Risks and how we hold them

- **Silent breakage from class/DOM edits.** Mitigated by the `CLASS`-constant decoupling (§4),
  by doing the Cabinet BEM rename *after* extracting its class names, and by live per-page
  browser verification (below), not just unit tests.
- **CRLF template-literal mismatches.** These HTML files are CRLF; multi-line `Edit` matches have
  silently failed before on exactly these files. Every multi-line edit normalises or matches
  against the real line endings; changes are verified by re-render, not by assuming the edit took.
- **Unstyled published site.** Held by the publish §7 change landing with or before stage 1
  reaches deploy, plus the guard test.

## Testing and live verification

- The existing 24 test files must pass unchanged after every stage — the primary safety net; no
  API shape or schema is touched.
- One new publish guard test (§7).
- **Live app walkthrough** (explicitly requested). After the code work, run `npm run migrate`
  (the DB is not auto-seeded), start the server, and drive each page in the browser: Cabinet
  radar/matrix render with unchanged colours and pins/hover work; Archive hall navigation and
  entry pages; Ledger filter/search/row-expand and `scope` semantics; Desk edit-and-save round
  trip; shell wayfinding and cross-volume trace (the `atlas.js` bridge). Then `npm run snapshot
  && npm run preview` to confirm the published bundle is styled and functional. Proof captured
  as screenshots / console-clean checks, not asserted from memory.

## Delivery

Staged, independently reviewable commits on branch `readability/shared-design-tokens`:

1. `assets/tokens.css` + `assets/base.css`; relink all six pages; migrate the three token
   vocabularies onto one.
2. Publish pipeline: copy `assets/` into `dist/` + guard test.
3. `assets/atlas.js` bridge factory; the four bridge sites + shell adopt it.
4. Token discipline: spacing scale + fold stray colour literals into tokens, per page.
5. Decouple class names from JS (`CLASS` constants) in the four non-Cabinet pages.
6. Cabinet: strict-BEM exemplar + one-source-of-truth action colour + affinity-plate renames.
7. Accessibility pass across all six pages.
8. Comments: fix the stale radar axis count ("10 axes" → 13) and the ~20 `// Task N:` plan
   references in `lib/`/`scripts/`.

Each stage runs the test suite; stages 4–7 also get live-browser checks before commit.

## Success criteria

1. Searching the repo for `agonist` reaches the code that colours the radar.
2. One palette and one spacing scale exist; the three token vocabularies and the 15 raw-literal
   agonist-greens are gone.
3. Every interactive element — including runtime-generated ones — has a visible focus state and
   an accessible name; the Ledger table exposes `scope`.
4. All 24 existing tests pass, and every page's core interactions are verified working in a live
   browser.
