# Frontend Architecture Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the frontend a shared foundation — one palette, one base layer, one cross-volume bridge — then fix token leakage, class/JS coupling, and accessibility gaps, without changing how anything looks or behaves.

**Architecture:** Six standalone HTML pages currently duplicate their design tokens, reset CSS, and inter-page messaging. We extract those three into `public/assets/` (`tokens.css`, `base.css`, `atlas.js`), teach the publish pipeline to carry that directory, then work page-by-page. Pages stay single-file for their own CSS/JS — they are independently iframe-embeddable volumes, and that is a real product property, not an accident.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step, no framework), Node 20+ ESM, `node --test`, better-sqlite3, GitHub Pages via `scripts/publish.js`.

**Spec:** `docs/superpowers/specs/2026-07-25-frontend-architecture-design.md`

**Branch:** `readability/shared-design-tokens`

---

## File Structure

**Create:**
- `public/assets/tokens.css` — the single palette, semantic colour vocabularies, spacing scale, type scale, shared motion. No selectors other than `:root`.
- `public/assets/base.css` — reset, focus ring, `.sr-only`, reduced-motion. Shared primitives only.
- `public/assets/atlas.js` — `createAtlasBridge()` factory: the cross-volume postMessage protocol, minus each page's own id-map and navigation.

**Modify:**
- `public/the-receptor-atlas.html` (shell), `public/neuroreceptor_pharmacology_explorer_dashboard.html` (Cabinet), `public/receptor-function.html` (Archive), `public/neuroreceptor_clinical_table.html` (Ledger), `public/the-conservators-desk.html` (Desk), `public/receptor-atlas-demo.html` (demo)
- `scripts/publish.js` — copy `assets/`, guard against missing references
- `test/publish.test.js` — asset-carrying + guard tests
- `lib/queries.js`, `lib/router.js`, `scripts/migrate.js`, `scripts/seed-data.js`, `db/schema.sql` — comment fixes only

**Do not touch:** `server.js`, `db/index.js`, API payload shapes, DB schema (beyond a comment), `public/the-threshold*.html` (untracked scratch).

---

## Cascade Contract (read before Task 2)

Every page loads, in this exact order:

```html
<link rel="stylesheet" href="assets/tokens.css">
<link rel="stylesheet" href="assets/base.css">
<style> /* the page's own rules — may override anything above */ </style>
```

**`tokens.css` holds only what is genuinely shared.** Page-specific values stay in the page's own `:root`, where they override the shared token by normal cascade. This is deliberate — do not hoist these:

| Token | Why it stays local |
|---|---|
| `--row-stagger` | Archive 70ms, Ledger 42ms, Cabinet 60ms — per-page animation pacing |
| `--mast-h` | shell `5.5rem`, Desk `70px` |
| `--lintel-h`, `--loupe-size`, `--light-radius` | single-page layout constants |
| `html { font-size: clamp(…) }` | Cabinet and Ledger tune their own root scale |

**hrefs are relative** (`assets/tokens.css`), never absolute (`/assets/…`) — the published bundle must work at a `/repo/` subpath on GitHub Pages. See `scripts/publish.js:39`.

---

## Known Risks

1. **CRLF.** These HTML files use CRLF line endings. Multi-line `Edit` matches have silently failed on exactly these files before. For any multi-line edit: match a **single line** where possible, or verify the edit landed by re-reading the specific lines. Never assume an edit took.
2. **Desk reset divergence.** `the-conservators-desk.html:28` has `*{box-sizing:border-box;}` **only** — no `margin:0; padding:0`. `base.css` adds that reset, which can collapse default margins on the Desk's headings/paragraphs. Task 2 has an explicit Desk visual check; if it shifts, the Desk keeps a local override rather than base.css losing the reset.
3. **Demo page colour drift.** `receptor-atlas-demo.html` has independently drifted values: `--verm 64%` vs canonical `62%`, `--brass 72%` vs `70%`, `--red 68%` vs `--state-over 66%`, `--blue 74%` vs `--state-under 72%`, `--recess 11%` vs `--wall-recess 14%`. Consolidating shifts the demo by 2–4% lightness. This is intended (it becomes consistent with the product) but must be eyeballed, not assumed.
4. **Publish breaks if assets aren't carried.** Task 1 lands the pipeline support *before* any page references an asset, so the site is never in a broken-publish state.

---

## Task 1: Publish pipeline carries `assets/`

**Goal:** `dist/` includes `public/assets/`, and the build fails loudly if a published page references an asset that isn't there.

**Files:**
- Create: `public/assets/tokens.css`
- Modify: `scripts/publish.js`
- Test: `test/publish.test.js`

**Acceptance Criteria:**
- [ ] `public/assets/tokens.css` exists with the full shared palette
- [ ] `publish()` copies `assets/` recursively into the output dir
- [ ] A page referencing a non-existent `assets/…` file makes `publish()` throw
- [ ] All existing publish tests still pass

**Verify:** `npm test` → all tests pass, including two new ones

**Steps:**

- [ ] **Step 1: Create the shared token file**

Create `public/assets/tokens.css`:

```css
/* ============================================================================
   The Receptor Atlas — design tokens

   The single source of colour, spacing, and type for every page. Loaded first,
   before base.css and before each page's own <style>, so a page can override
   any of these locally (see the Cascade Contract in the plan).

   Naming rule: a token says what a value MEANS, not what it looks like.
   --hue-* are raw paint; everything else is a meaning that points at paint.
   Never use a --hue-* directly in a rule.
   ============================================================================ */
:root {
  /* ---- raw paint -------------------------------------------------------- */
  --hue-green: oklch(78% 0.085 158);
  --hue-amber: oklch(66% 0.185 38);
  --hue-blue:  oklch(72% 0.10 245);

  /* ---- what a drug DOES at a receptor (Cabinet radar + matrix) ----------
     Search "agonist" and land here. These are the colours the affinity plate
     encodes actions with; ACTION_COLOR in the Cabinet points at exactly these. */
  --action-agonist:            var(--hue-green);
  --action-partial:            var(--brass);
  --action-antagonist:         var(--hue-amber);
  --action-reuptake-inhibitor: var(--hue-blue);

  /* ---- what STATE a receptor is in (the exhibit wall repaint) ------------ */
  --state-normal: var(--hue-green);
  --state-over:   var(--hue-amber);
  --state-under:  var(--hue-blue);

  /* ---- review status (Conservator's Desk) -------------------------------- */
  --status-verified: var(--hue-green);
  --status-conflict: var(--hue-amber);
  --status-todo:     var(--hue-blue);

  /* ---- wall paint -------------------------------------------------------- */
  --wall-vault:     oklch(14% 0.01 75);
  --wall-recess:    oklch(14% 0.011 75);
  --wall-atrium:    oklch(17% 0.012 75);
  --wall-panel:     oklch(20% 0.013 75);
  --wall-celestial: oklch(16% 0.018 280);
  --wall-verdigris: oklch(19% 0.028 155);
  --wall-umber:     oklch(22% 0.05 58);
  --wall-oxblood:   oklch(26% 0.065 25);
  --wall-cobalt:    oklch(17% 0.05 255);
  --wall-normal:    oklch(18% 0.030 158);
  --wall-over:      oklch(23% 0.060 28);
  --wall-under:     oklch(18% 0.045 255);

  /* ---- ink and metal ----------------------------------------------------- */
  --bone:        oklch(93% 0.012 85);
  --bone-read:   oklch(86% 0.013 85);
  --bone-dim:    oklch(72% 0.015 85);
  --bone-faint:  oklch(63% 0.013 85);
  --vermilion:   oklch(62% 0.19 35);
  --brass:       oklch(70% 0.055 80);
  --brass-line:  oklch(70% 0.055 80 / 0.28);
  --brass-faint: oklch(70% 0.055 80 / 0.14);

  /* ---- spacing scale -----------------------------------------------------
     Fixed, repeated spacing only. Fluid clamp() values that genuinely scale
     with the viewport stay inline — a token per one-off value is not progress. */
  --space-2xs: 0.25rem;
  --space-xs:  0.5rem;
  --space-sm:  0.75rem;
  --space-md:  1rem;
  --space-lg:  1.5rem;
  --space-xl:  2rem;
  --space-2xl: 3rem;

  /* ---- motion ------------------------------------------------------------ */
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --letter-stagger: 55ms;
  --line-stagger:   110ms;
  --stroke-stagger: 180ms;
  --entry-stagger:  90ms;
  --block-stagger:  80ms;

  /* ---- typography -------------------------------------------------------- */
  --display: "Marcellus", serif;
  --body:    "Schibsted Grotesk", sans-serif;
  --mono:    "Fragment Mono", monospace;
  --lbl:     0.6875rem;
  --lbl-sm:  0.6rem;

  /* ---- shared layout ----------------------------------------------------- */
  --rail-x: clamp(0.9rem, 2.5vw, 2.2rem);
}
```

- [ ] **Step 2: Write the failing tests**

Append to `test/publish.test.js`:

```js
test('shared assets are carried into the bundle', async () => {
  assert.ok((await stat(join(outDir, 'assets/tokens.css'))).isFile(),
    'assets/tokens.css should exist in dist');
});

test('publish fails when a page references a missing asset', async () => {
  // A page that links an asset the bundle does not contain must break the build,
  // not ship an unstyled site. Simulated by publishing into a fresh dir with a
  // page rewritten to reference a file that does not exist.
  const probeDir = join(dir, 'dist-probe');
  const db = openDb(join(dir, 'atlas.db'));
  await publish(db, probeDir);
  db.close();
  const page = join(probeDir, 'index.html');
  const html = await readFile(page, 'utf8');
  await writeFile(page, html.replace('<head>', '<head><link rel="stylesheet" href="assets/nope.css">'));
  await assert.rejects(
    verifyAssetRefs(probeDir, ['index.html']),
    /missing asset/,
    'a dangling asset reference must throw'
  );
});
```

Add to the imports at the top of `test/publish.test.js`:

```js
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { publish, verifyAssetRefs } from '../scripts/publish.js';
```

(Replace the two existing import lines for `node:fs/promises` and `../scripts/publish.js`.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `assets/tokens.css should exist in dist`, and `verifyAssetRefs is not a function`.

- [ ] **Step 4: Teach publish.js to carry and verify assets**

In `scripts/publish.js`, change the fs import line:

```js
import { readFile, writeFile, rm, mkdir, copyFile, cp, access } from 'node:fs/promises';
```

Add after the `SHELL` constant (~line 67):

```js
// Shared CSS/JS that every page links RELATIVELY (assets/tokens.css, …). Copied
// wholesale so the bundle is self-contained and works at a domain root or a
// /repo/ subpath. Pages reference these with relative hrefs — see SHIM above.
const ASSET_DIR = 'assets';
```

Add this exported function above `publish()`:

```js
/**
 * Fail the build if any published page references an assets/ file that isn't in
 * the bundle. Without this guard, extracting a new shared file silently ships an
 * unstyled site — a failure that only shows up in production.
 */
export async function verifyAssetRefs(outDir, pages) {
  for (const page of pages) {
    const html = await readFile(join(outDir, page), 'utf8');
    for (const m of html.matchAll(/(?:href|src)="(assets\/[^"]+)"/g)) {
      try { await access(join(outDir, m[1])); }
      catch { throw new Error(`publish: ${page} references missing asset ${m[1]}`); }
    }
  }
}
```

Inside `publish()`, immediately after the `mkdir` call:

```js
  // Shared assets first — the guard at the end checks every page reference
  // against what actually landed here.
  await cp(join(PUBLIC, ASSET_DIR), join(outDir, ASSET_DIR), { recursive: true });
```

At the end of `publish()`, after the existing Desk guard loop:

```js
  // 6. Guard the other invariant: no page may reference an asset we didn't ship.
  await verifyAssetRefs(outDir, ['index.html', ...VOLUME_PAGES, ...STANDALONE_PAGES]);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add public/assets/tokens.css scripts/publish.js test/publish.test.js
git commit -m "build: carry shared assets into the published bundle

Adds public/assets/tokens.css (the single palette, with --action-* and
--state-* as separate vocabularies) and teaches publish.js to copy assets/
into dist. A new guard fails the build if a published page references an
asset that was not shipped, so extracting a shared file can never silently
deploy an unstyled site.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Migrate all six pages onto the shared layer

**Goal:** Every page links `tokens.css` + `base.css` and no longer carries its own copy of the shared palette or reset. Nothing looks different (except the demo's intended 2–4% drift correction).

**Files:**
- Create: `public/assets/base.css`
- Modify: all six pages in `public/`

**Acceptance Criteria:**
- [ ] `base.css` exists with reset, focus ring, `.sr-only`, reduced-motion
- [ ] All six pages link both stylesheets with **relative** hrefs, before their own `<style>`
- [ ] Each page's `:root` retains only page-specific tokens (see Cascade Contract)
- [ ] The three token vocabularies are gone: no `--st-normal`, `--good`/`--warn`/`--info`, `--green`/`--red`/`--blue` definitions remain
- [ ] Every page renders visually unchanged; the Desk specifically is checked for margin collapse
- [ ] `npm test` passes

**Verify:** `npm test` → pass; then live browser check of all six pages

**Steps:**

- [ ] **Step 1: Create the base layer**

Create `public/assets/base.css`:

```css
/* ============================================================================
   The Receptor Atlas — base layer

   Reset and primitives shared by every page. Loaded after tokens.css and before
   the page's own <style>, so a page can override anything here.
   Page-specific rules do NOT belong in this file.
   ============================================================================ */

*, *::before, *::after { box-sizing: border-box; }
* { margin: 0; padding: 0; }

html { scroll-behavior: smooth; }

/* The visible keyboard focus ring. If a component needs a different treatment
   it must still show something — never `outline: none` with no replacement. */
:focus-visible { outline: 1px solid var(--brass); outline-offset: 3px; }

/* Visually hidden, still read by screen readers. */
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: Link the shared layer from every page**

In each of the six pages, insert immediately **before** the opening `<style>` tag:

```html
<link rel="stylesheet" href="assets/tokens.css">
<link rel="stylesheet" href="assets/base.css">
```

Pages and their `<style>` line (verify before editing — line numbers shift as you go):
`the-receptor-atlas.html:10`, `neuroreceptor_pharmacology_explorer_dashboard.html:10`,
`receptor-function.html:10`, `neuroreceptor_clinical_table.html:10`,
`the-conservators-desk.html:10`, `receptor-atlas-demo.html:11`.

- [ ] **Step 3: Strip the duplicated tokens from each page's `:root`**

Delete from each page's `:root` every declaration now provided by `tokens.css`. **Keep** the page-specific ones listed in the Cascade Contract. If a page's `:root` ends up empty, remove the empty block.

Per page, the tokens to delete are exactly those whose names and values now appear in `tokens.css` — the wall/bone/brass/vermilion/ease/font/label set. Specifically:

- **shell** — delete `--wall-*`, `--bone*`, `--vermilion`, `--brass*`, `--st-*`, `--ease`, `--letter-stagger`, `--rail-x`, `--display`, `--body`, `--mono`, `--lbl`, `--lbl-sm`. **Keep** `--lintel-h`, `--mast-h`, `--wall: var(--wall-vault)`, `--vol-accent: var(--brass)`.
- **Cabinet** — delete `--wall-*`, `--st-*`, `--bone*`, `--vermilion`, `--brass*`, `--ease`, `--block-stagger`, `--stroke-stagger`, `--display`, `--body`, `--mono`, `--lbl`, `--lbl-sm`. **Keep** `--row-stagger: 60ms`.
- **Archive** — delete `--wall-*`, `--bone*`, `--vermilion`, `--brass*`, `--ease`, `--letter-stagger`, `--line-stagger`, `--stroke-stagger`, `--entry-stagger`, `--rail-x`, `--display`, `--body`, `--mono`, `--lbl`, `--lbl-sm`. **Keep** `--row-stagger: 70ms`, `--loupe-size`, `--light-radius`.
- **Ledger** — delete `--wall-*`, `--st-*`, `--bone*`, `--vermilion`, `--brass*`, `--ease`, `--display`, `--body`, `--mono`, `--lbl`, `--lbl-sm`. **Keep** `--row-stagger: 42ms`.
- **Desk** — delete `--wall-*`, `--bone*`, `--vermilion`, `--brass*`, `--ease`. **Keep** `--mast-h: 70px`. Then rename its three status tokens to the shared ones: `--good` → `--status-verified`, `--warn` → `--status-conflict`, `--info` → `--status-todo` (delete the local definitions; update every usage).
- **demo** — delete the whole `:root` block. Then rename its local names to the shared vocabulary throughout the file: `--wall`→`--wall-vault`, `--recess`→`--wall-recess`, `--panel`→`--wall-panel`, `--dim`→`--bone-dim`, `--faint`→`--bone-faint`, `--verm`→`--vermilion`, `--green`→`--action-agonist`, `--red`→`--action-antagonist`, `--blue`→`--action-reuptake-inhibitor`, `--disp`→`--display`. `--bone`, `--brass*`, `--ease`, `--body`, `--mono` keep their names.

- [ ] **Step 4: Replace raw colour literals that duplicate a token**

Across all six pages, replace the bare agonist/antagonist literals with tokens (this is the 15-occurrence duplication):

- `oklch(78% 0.085 158)` → `var(--action-agonist)`
- `oklch(66% 0.185 38)` → `var(--action-antagonist)`
- `oklch(72% 0.10 245)` → `var(--action-reuptake-inhibitor)`

Where the literal carries an alpha suffix (e.g. `oklch(78% 0.085 158 / 0.45)`), keep the alpha by wrapping instead: `color-mix(in oklch, var(--action-agonist) 45%, transparent)`.

Known sites: `neuroreceptor_pharmacology_explorer_dashboard.html:614,815`, `receptor-atlas-demo.html:71,77,100`, `neuroreceptor_clinical_table.html:283`. Re-grep after editing to confirm none remain:

```bash
grep -rn "78% 0.085 158\|66% 0.185 38\|72% 0.10 245" public/*.html
```

- [ ] **Step 5: Verify tests and render**

Run: `npm test`
Expected: PASS (24 files, all green).

Then: `npm run migrate` (seeds the DB — it is not auto-seeded), start the server, and open each of the six pages. Confirm each renders with unchanged colour and layout.

**Desk check (risk 2):** compare the Desk against `git stash`-ed original side by side. If headings/paragraphs collapsed, add to the Desk's own `<style>`:

```css
/* The Desk predates the shared reset and sets its own vertical rhythm. */
h1, h2, h3, p, ul, ol { margin: revert; }
```

**Demo check (risk 3):** the demo's colours shift 2–4% lighter/darker by design. Confirm it now matches the other pages rather than sitting slightly apart.

- [ ] **Step 6: Commit**

```bash
git add public/assets/base.css public/*.html
git commit -m "refactor(css): move six pages onto one shared token layer

Every page carried its own copy of the palette under a different name:
--st-normal (shell/cabinet/ledger), --good (desk), --green (demo), plus the
raw literal in 15 places. All of it now resolves to assets/tokens.css, with
--action-* and --state-* as separate vocabularies so the name says which
concept it serves. base.css absorbs the duplicated reset and focus ring.

Page-specific values (row staggers, mast heights, loupe sizes) deliberately
stay in each page and override by cascade.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Extract the cross-volume bridge as a factory

**Goal:** One implementation of the shell↔volume messaging protocol; each volume supplies only its own id-map and navigation.

**Files:**
- Create: `public/assets/atlas.js`
- Modify: `public/receptor-function.html` (bridge block ~2731-2781), `public/neuroreceptor_pharmacology_explorer_dashboard.html` (~3268-3324), `public/neuroreceptor_clinical_table.html` (~912-969)

**Acceptance Criteria:**
- [ ] `createAtlasBridge()` handles: frame detection, `up()` transport, `atlas:ready`/`atlas:subject`/`atlas:nav` envelopes, `hashchange`, `message`, deferred start
- [ ] Each volume passes its own `idMap`, `currentSubject`, `applyNav`
- [ ] Cross-volume tracing still works in the shell
- [ ] `npm test` passes

**Verify:** `npm test` → pass; then trace a receptor from Archive → Cabinet → Ledger in the live shell

**Steps:**

- [ ] **Step 1: Create the bridge factory**

Create `public/assets/atlas.js`:

```js
/* ============================================================================
   Atlas bridge — how a volume talks to the shell.

   The three volumes speak one protocol but are internally unalike: each has its
   own id scheme (the Archive numbers entries, the Cabinet uses target aliases,
   the Ledger uses row numbers) and its own way of moving to a subject. So this
   is a factory, not a shared singleton: it owns the transport and the message
   envelopes, and each page supplies the two things only it knows.

   Messages, all via postMessage to the parent frame:
     up   atlas:ready    { volume }               volume has booted
     up   atlas:subject  { volume, subject, label }  the open subject changed
     down atlas:nav      { subject, station }     shell asks us to go somewhere

   `subject` is always a CANONICAL id ('5ht2a', 'd2', 'mu'), never a local one.
   ============================================================================ */

(function (global) {
  'use strict';

  function isFramed() {
    try { return global.self !== global.top; } catch (e) { return true; }
  }

  /**
   * Wire a volume into the shell.
   *
   * @param {object}   cfg
   * @param {string}   cfg.volume         'archive' | 'cabinet' | 'ledger'
   * @param {object}   cfg.idMap          canonical id -> this volume's local id
   * @param {function} cfg.currentSubject () => canonical id or null, right now
   * @param {function} cfg.applyNav       (canonicalSubject, station) => void
   * @param {number}   [cfg.startDelay]   ms to wait before first emit (default 130)
   * @returns {{emit: function}|null}     null when running standalone
   */
  global.createAtlasBridge = function createAtlasBridge(cfg) {
    // Standalone (not in the shell, no ?embed): the bridge is inert.
    if (!isFramed() && location.search.indexOf('embed') === -1) return null;

    var startDelay = cfg.startDelay == null ? 130 : cfg.startDelay;

    function up(msg) { try { parent.postMessage(msg, '*'); } catch (e) {} }

    function emit(subject) {
      var canon = subject === undefined ? cfg.currentSubject() : subject;
      up({ type: 'atlas:subject', volume: cfg.volume, subject: canon || null, label: '' });
    }

    global.addEventListener('hashchange', function () { emit(); });
    global.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || d.type !== 'atlas:nav') return;
      cfg.applyNav(d.subject, d.station);
    });

    function start() {
      var params;
      try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
      if (params) cfg.applyNav(params.get('subject'), params.get('station'));
      up({ type: 'atlas:ready', volume: cfg.volume });
      emit();
    }

    if (document.readyState === 'loading')
      global.addEventListener('DOMContentLoaded', function () { setTimeout(start, startDelay); });
    else setTimeout(start, startDelay);

    return { emit: emit };
  };

  /** Announce a cross-volume trace to the shell. Used by in-page "trace" links. */
  global.atlasTrace = function atlasTrace(toVolume, canonicalSubject) {
    if (!isFramed()) return;
    try {
      parent.postMessage({ type: 'atlas:trace', to: toVolume, subject: canonicalSubject }, '*');
    } catch (e) {}
  };
})(window);
```

- [ ] **Step 2: Load it from the three volumes**

In each of the three volume pages, add to `<head>` after the stylesheet links:

```html
<script src="assets/atlas.js"></script>
```

- [ ] **Step 3: Replace the Archive's bridge**

In `public/receptor-function.html`, replace the body of the final `<script>` block (the `ATLAS BRIDGE, Volume I` IIFE) with:

```js
  /* ════════════════════════════════════════════════════════════════
     ATLAS BRIDGE, Volume I speaks to the shell.
     The Archive's interior is sealed in a module, so the bridge drives
     it the way a visitor does: through the entry hash.
     Transport and envelopes live in assets/atlas.js.
     ════════════════════════════════════════════════════════════════ */
  (function () {
    var CANON2NUM = { '5ht1a':1, '5ht2a':2, '5ht2c':3, 'sert':5, 'd1':6, 'd2':7, 'dat':9,
      'alpha1':10, 'alpha2':11, 'beta1':12, 'net':13, 'nmda':14, 'gaba_a':16, 'm1':18, 'h1':20, 'mu':21 };
    var NUM2CANON = {}; for (var k in CANON2NUM) NUM2CANON[CANON2NUM[k]] = k;

    function currentSubject() {
      var m = (location.hash || '').match(/^#\/entry\/(\d+)/);
      var n = m ? parseInt(m[1], 10) : null;
      return n && NUM2CANON[n] ? NUM2CANON[n] : null;
    }
    function gotoHall(id) {
      if (location.hash) location.hash = '';
      setTimeout(function () {
        var el = document.getElementById(id);
        if (el) el.scrollIntoView({ block: 'start' });
      }, 60);
    }
    function applyNav(subject, station) {
      if (subject && CANON2NUM[subject]) { location.hash = '#/entry/' + CANON2NUM[subject]; return; }
      if (station && station.indexOf('hall') === 0) { gotoHall(station); return; }
      if (station === '') { if (location.hash) location.hash = ''; window.scrollTo({ top: 0 }); }
    }

    createAtlasBridge({ volume: 'archive', idMap: CANON2NUM, currentSubject: currentSubject, applyNav: applyNav });
  })();
```

- [ ] **Step 4: Replace the Cabinet's and Ledger's bridges the same way**

Apply the identical shape to the other two: keep each file's existing id-map (`CANON2LOCAL` in the Cabinet, `CANON2NO` in the Ledger) and its existing `applyNav`/current-subject logic **verbatim**, and replace only the boilerplate (`framed()`, the early return, `up()`, the listeners, `start()`) with a single `createAtlasBridge({…})` call.

The Cabinet additionally keeps its `STATION2VIEW` map and calls `bridge.emit(canonicalId)` explicitly when the selected receptor changes (it does not use `hashchange`). Capture the return value:

```js
    var bridge = createAtlasBridge({ volume: 'cabinet', idMap: CANON2LOCAL, currentSubject: currentSubject, applyNav: applyNav });
    // the Cabinet pushes on selection rather than on hashchange
    window.__atlasEmit = function (localId) { if (bridge) bridge.emit(LOCAL2CANON[localId] || null); };
```

- [ ] **Step 5: Replace the three in-page trace calls**

Each volume has a line like:

```js
if (window.self !== window.top) parent.postMessage({type:'atlas:trace', to:toVol, subject:canon}, '*');
```

(`receptor-function.html:1996`, `neuroreceptor_pharmacology_explorer_dashboard.html:2554`, `neuroreceptor_clinical_table.html:667`)

Replace each with:

```js
atlasTrace(toVol, canon);
```

- [ ] **Step 6: Verify**

Run: `npm test`
Expected: PASS.

Then live: open the shell, use the wayfinder to trace a receptor (e.g. 5-HT2A) into each volume in turn, and confirm the breadcrumb follows and each volume lands on the right subject. Check the browser console is free of errors.

- [ ] **Step 7: Commit**

```bash
git add public/assets/atlas.js public/receptor-function.html public/neuroreceptor_pharmacology_explorer_dashboard.html public/neuroreceptor_clinical_table.html
git commit -m "refactor(js): extract the cross-volume bridge as a factory

The three volume bridges shared a protocol but not their internals: each has
its own canonical-id map and its own way of navigating. assets/atlas.js now
owns the transport and message envelopes; each volume passes only its id map,
a currentSubject reader, and an applyNav adapter.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Token discipline — spacing scale and stray colours

**Goal:** Repeated fixed spacing values reference the scale; colour literals that duplicate a token reference the token.

**Files:** all six pages in `public/`

**Acceptance Criteria:**
- [ ] Repeated fixed spacing values (`0.5rem`, `1rem`, `1.5rem`, `2rem`, `3rem` and their common variants) use `var(--space-*)`
- [ ] Fluid `clamp()` values and genuine one-offs are left alone
- [ ] No colour literal remains that exactly duplicates a defined token
- [ ] Every page renders unchanged

**Verify:** `npm test` → pass; visual diff of each page against `git stash` original

**Steps:**

- [ ] **Step 1: Survey what actually repeats, per page**

```bash
grep -oE "(padding|margin|gap|inset)[a-z-]*:[^;]*" public/neuroreceptor_pharmacology_explorer_dashboard.html \
  | grep -oE "[0-9.]+rem" | sort | uniq -c | sort -rn | head -20
```

Only values appearing **3+ times** are worth tokenising. Record the list before editing.

- [ ] **Step 2: Replace, page by page**

Map each repeated literal to its scale entry: `0.25rem`→`--space-2xs`, `0.5rem`→`--space-xs`, `0.75rem`→`--space-sm`, `1rem`→`--space-md`, `1.5rem`→`--space-lg`, `2rem`→`--space-xl`, `3rem`→`--space-2xl`.

Do **not** replace: values inside `clamp()`, `calc()` operands tied to a specific layout constant, font sizes, border widths, or any value appearing once or twice.

Work one page at a time and re-render between pages.

- [ ] **Step 3: Fold remaining stray colour literals**

```bash
grep -oE "oklch\([^)]*\)" public/*.html | sort | uniq -c | sort -rn | head -30
```

Any literal that exactly equals a token's value becomes `var(--token)`. Literals that are genuinely unique (one-off tints inside gradients) stay.

- [ ] **Step 4: Verify and commit**

Run: `npm test` → PASS. Render all six pages; confirm no layout shift.

```bash
git add public/*.html
git commit -m "refactor(css): route repeated spacing and colour through tokens

Only values that repeat three or more times are tokenised; fluid clamp()
expressions and genuine one-offs stay inline, since a token per one-off value
trades 457 literals for 457 names and calls it progress.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Decouple class names from JavaScript

**Goal:** In the four non-Cabinet pages, class names used by JS live in one named list, so a future rename is a one-line change.

**Files:** `public/the-receptor-atlas.html`, `public/receptor-function.html`, `public/neuroreceptor_clinical_table.html`, `public/the-conservators-desk.html`

**Acceptance Criteria:**
- [ ] Each page declares a `CLASS` constant near the top of its main script
- [ ] Every class name previously inlined in an `innerHTML` template or a `querySelector`/`classList` call references `CLASS`
- [ ] Class name **values** are unchanged — no visual or behavioural difference
- [ ] `npm test` passes and each page's interactions still work

**Verify:** `npm test` → pass; exercise each page's interactive features in the browser

**Steps:**

- [ ] **Step 1: Inventory the coupled names per page**

For each page, list class names that appear in **both** the `<style>` block and the script:

```bash
grep -oE "class=\\\\?[\"'][^\"']*[\"']" public/neuroreceptor_clinical_table.html | grep -oE "[a-z][a-z0-9-]+" | sort -u
```

Cross-reference against `classList.` and `querySelector` calls in the same file.

- [ ] **Step 2: Declare the constant**

At the top of the page's main `<script>`, before any render function:

```js
  // Class names shared between the stylesheet and this script. The stylesheet is
  // the other half of every one of these — change a name here and in the <style>
  // block together, and nowhere else.
  const CLASS = {
    row:       'rec-row',
    rowOpen:   'is-open',
    detail:    'detail-row',
    detailInner: 'detail-inner',
    active:    'is-active',
  };
```

(The Ledger's set is shown; build the equivalent for each page from Step 1's inventory.)

- [ ] **Step 3: Route every usage through it**

Template strings:

```js
// before
row.innerHTML = '<td class="cell-no">…<div class="rec-name">…';
// after
row.innerHTML = `<td class="${CLASS.cellNo}">…<div class="${CLASS.recName}">…`;
```

Queries and toggles:

```js
// before
document.querySelector('tr.rec-row[data-id="' + no + '"]')
el.classList.toggle('is-open', open)
// after
document.querySelector(`tr.${CLASS.row}[data-id="${no}"]`)
el.classList.toggle(CLASS.rowOpen, open)
```

**CRLF caution (risk 1):** prefer single-line edits; verify each landed by re-reading the line.

- [ ] **Step 4: Verify and commit**

Run: `npm test` → PASS. In the browser, exercise each page: Ledger filter/search/row-expand; Archive hall nav and entry pages; shell search and wayfinding; Desk accordion, filters, and a save round-trip.

```bash
git add public/the-receptor-atlas.html public/receptor-function.html public/neuroreceptor_clinical_table.html public/the-conservators-desk.html
git commit -m "refactor(js): give class names one definition point per page

Class names were written twice — once in the stylesheet, once inside innerHTML
template strings — and agreed only because someone typed the same word in both
places. A missed rename broke features silently. Each page now declares them
once in a CLASS constant. Values are unchanged; only the definition point moves.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Cabinet — BEM exemplar and one source of truth for action colour

**Goal:** The file that started this becomes the reference: strict BEM, `ACTION_COLOR` hoisted and searchable, affinity-plate code legible.

**Files:** `public/neuroreceptor_pharmacology_explorer_dashboard.html`

**Acceptance Criteria:**
- [ ] `grep -n "agonist" public/neuroreceptor_pharmacology_explorer_dashboard.html` reaches the radar's colour logic
- [ ] `ACTION_COLOR` sits with the domain constants at the top of the main script, not inside `renderAffinityRadar()`
- [ ] Radar and matrix colours both resolve to `--action-*`; no action colour is written twice
- [ ] Class names follow `block__element--modifier`, routed through a `CLASS` constant as in Task 5
- [ ] Affinity-plate locals are legible; **wire-format properties `.b`/`.g`/`.cid`/`.name` are unchanged**
- [ ] The `role="img"` label and the axis-count comment match reality (13 axes)
- [ ] `npm test` passes; radar, matrix, pins, and hover behave exactly as before

**Verify:** `npm test` → pass; live check of radar pins, hover trace, matrix dots, legend

**Steps:**

- [ ] **Step 1: Hoist and rename the colour map**

Delete the `ACT_COLOR` line at ~2935 (inside `renderAffinityRadar`). Add to the domain-constants block near the top of the main script (beside `AFF_TARGETS`):

```js
    // ── One source of truth for what an action looks like ──────────────────
    // Every place the affinity plate paints an action — radar polygon, radar
    // dot, matrix dot, legend swatch — reads this map. The tokens live in
    // assets/tokens.css as --action-*. Edit the colour there, the name here.
    //   ag = agonist   pa = partial agonist
    //   an = antagonist   ri = reuptake inhibitor
    const ACTION_COLOR = {
      ag: 'var(--action-agonist)',
      pa: 'var(--action-partial)',
      an: 'var(--action-antagonist)',
      ri: 'var(--action-reuptake-inhibitor)',
    };
    const ACTION_COLOR_FALLBACK = 'var(--action-partial)';
```

Update the four former `ACT_COLOR` usages (~2955, 2967, 2984 and the matrix dot renderer) to `ACTION_COLOR`, replacing `|| 'var(--brass)'` with `|| ACTION_COLOR_FALLBACK`.

- [ ] **Step 2: Point the CSS action classes at the same tokens**

Replace the hardcoded literals so CSS and JS bottom out on one value:

```css
  .tag.agonist    { border-color: color-mix(in oklch, var(--action-agonist) 45%, transparent); color: var(--action-agonist); }
  .tag.antagonist { border-color: color-mix(in oklch, var(--action-antagonist) 45%, transparent); color: var(--action-antagonist); }
```

Do the same for `.lk.ag/.an/.ri`, `.dot.ag/.an/.ri`, and `.concept-chip.ag/.an`.

- [ ] **Step 3: Make the affinity-plate code legible**

Rename locals only (not properties): `bindingV` → `affinityToRadius`, `dotSize` → `affinityToDotRadius`, `primaryAct` → `dominantAction`, `ccx`/`ccy` → `centreX`/`centreY`, `Rmax` → `maxRadius`, `ang` → `axisAngle`, `nm` → `agentName`, `leg` → `legendEl`, `col` → `strokeColour`, `a` → `agent`, `b` → `binding`, `t` → `target`.

Document the wire format where data enters:

```js
      // Wire shape — the embedded AFF_AGENTS literal and /api/atlas/cabinet/binding
      // both return: { name, g: <group>, cid, b: { [targetAlias]: binding } }.
      // These property names are the API contract (lib/queries.js:104) and are
      // deliberately NOT renamed; unpack them here so the code below reads plainly.
      const { b: bindings, g: group } = agent;
```

- [ ] **Step 4: Fix the stale axis facts**

`renderAffinityRadar`'s header comment says "10 axes" — there are 13 (`AFF_TARGETS.length`). Replace the comment and make the label derive from the data rather than restating it:

```js
    // Radar: one axis per affinity target (currently 13 — see AFF_TARGETS).
```

```js
      let base = `<svg viewBox="0 0 ${V} ${V}" role="img" aria-label="Affinity radar across ${AFF_TARGETS.length} targets">`;
```

- [ ] **Step 5: Convert class names to strict BEM**

Extract the Cabinet's class names into a `CLASS` constant (as Task 5), **then** rename values to `block__element--modifier`: `plate-head` → `plate__head`, `plate-kicker` → `plate__kicker`, `index-col` → `index__col`, `monitor-label` → `monitor__label`, `is-active` → `plate--active` where it modifies a plate, and so on. State classes that apply to many blocks (`hidden`, `is-scrolled`) stay as standalone utilities.

Because the names now live in `CLASS`, each rename is: one line in `CLASS`, one selector in `<style>`.

- [ ] **Step 6: Verify and commit**

Run: `npm test` → PASS.

Live: open the Cabinet. Confirm the radar draws with Risperidone and Haloperidol pinned in their original colours, hovering a drug adds a bone-coloured trace, the legend matches, matrix dots match the radar, and the view switcher (explorer/matrix/primer) works. Then:

```bash
grep -n "agonist" public/neuroreceptor_pharmacology_explorer_dashboard.html | head
```

Expected: hits including `ACTION_COLOR` — the success criterion for this whole effort.

```bash
git add public/neuroreceptor_pharmacology_explorer_dashboard.html
git commit -m "refactor(cabinet): one source of truth for action colour, BEM exemplar

ACT_COLOR was buried 65 lines inside renderAffinityRadar() and keyed on tokens
named for a different concept (--st-normal meant 'agonist'), so searching for
'agonist' found nothing. It is now ACTION_COLOR, hoisted to the domain
constants and pointing at --action-*; the CSS action classes reference the same
tokens instead of restating the hex. Affinity-plate locals renamed for
legibility; wire-format properties (.b/.g/.cid) deliberately untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Accessibility pass

**Goal:** Every interactive element — including the ones JavaScript builds at runtime — has a visible focus state and an accessible name.

**Files:** all six pages in `public/`

**Acceptance Criteria:**
- [ ] Ledger table header cells carry `scope="col"`; the table has a `<caption>` (may be `.sr-only`)
- [ ] No `outline: none` without a visible replacement
- [ ] Runtime-generated controls are real `<button>`s (or carry `role` + `tabindex`) and have an accessible name
- [ ] Desk form controls each have a `<label>` or `aria-label`
- [ ] `.entry` renders as `<article>`; the Cabinet's `.plaque` renders as `<aside role="alert">`
- [ ] Keyboard-only traversal of each page reaches every control with a visible ring

**Verify:** `npm test` → pass; keyboard tab-through of each page; zero `outline:none`-without-replacement in grep

**Steps:**

- [ ] **Step 1: Ledger table semantics**

In `public/neuroreceptor_clinical_table.html`, add `scope="col"` to each `<th>` in the header row (~435-440), and add a caption immediately after `<table …>`:

```html
      <caption class="sr-only">Receptors by system, with clinical effect of over- and under-activity.</caption>
```

- [ ] **Step 2: Remove focus-suppressing rules**

```bash
grep -rn "outline:\s*none\|outline:0" public/*.html
```

Known: `receptor-function.html:1008,1042`. For each, either delete the rule (letting the base ring apply) or pair it with a visible substitute:

```css
  .wf-item:focus-visible { outline: 1px solid var(--brass); outline-offset: 2px; }
```

- [ ] **Step 3: Fix runtime-generated controls**

Find `cursor:pointer` on non-button elements that JS wires a click to, and convert the generated markup to `<button type="button">`. Where a `<div>` must stay for layout, add `role="button" tabindex="0"` **and** a keydown handler for Enter/Space, plus `aria-label`.

For generated SVG figures, add a `<title>` child or `role="img"` + `aria-label`; mark purely decorative ones `aria-hidden="true"`.

- [ ] **Step 4: Desk form labelling**

In `public/the-conservators-desk.html`, every `<input>`/`<select>`/`<textarea>` gets an associated label. Where the design has no room for a visible one:

```html
<input id="bindSearch" class="bind-search" aria-label="Filter bindings by drug or target" placeholder="Search bindings">
```

A placeholder is not a label — keep the placeholder, add the `aria-label`.

- [ ] **Step 5: Semantic upgrades**

- Archive: `entryMarkup()` emits `<div class="entry">` → `<article class="entry">`.
- Cabinet: `.plaque` warning box → `<aside class="plaque" role="alert">`.
- Cabinet: `<div class="masthead-in">` inside `<header>` → unwrap or make it the `<header>`'s own layout container.

- [ ] **Step 6: Verify and commit**

Run: `npm test` → PASS.

Keyboard check per page: Tab from the top through every control. Confirm the ring is always visible and never trapped. On the Ledger, confirm a row expands via Enter.

```bash
git add public/*.html
git commit -m "fix(a11y): focus, labels, and table semantics for generated DOM

Hand-written markup already had focus rings and landmarks; the elements built
at runtime did not. Adds scope/caption to the Ledger table, replaces
outline:none with visible rings, converts click-wired divs to real buttons,
labels the Desk's form controls, and upgrades .entry to <article> and the
Cabinet's warning plaque to <aside role=alert>.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Comment fixes in the backend

**Goal:** Comments describe the code, not a plan document an independent team will never see.

**Files:** `lib/router.js`, `lib/queries.js`, `scripts/migrate.js`, `scripts/seed-data.js`, `db/schema.sql`

**Acceptance Criteria:**
- [ ] No `// Task N:` references remain
- [ ] Each replaced comment states what the code does
- [ ] `npm test` passes

**Verify:** `grep -rn "Task [0-9]" lib/ scripts/ db/ server.js` → no output; `npm test` → pass

**Steps:**

- [ ] **Step 1: Replace each reference**

```bash
grep -rn "Task [0-9]" lib/ scripts/ db/ server.js
```

Rewrite each to describe purpose. Examples:

```js
// before:  // Task 4: registry list.
// after:   // The receptor registry: one row per receptor with its review progress.

// before:  * Reconstruct the Cabinet's AFF_AGENTS array from binding_values (Task 19), in the
// after:   * Reconstruct the Cabinet's AFF_AGENTS array from binding_values, in the

// before:  // Task 16: sections edited since their last review (review drift).
// after:   // Review drift: sections whose data was edited after it was last reviewed.
```

Keep any comment that names a *feature* ("Citation redesign", "binding-affinity provenance") — those are meaningful. Only the bare task numbers go.

- [ ] **Step 2: Verify and commit**

```bash
grep -rn "Task [0-9]" lib/ scripts/ db/ server.js && echo "STILL PRESENT" || echo "clean"
npm test
```

```bash
git add lib/ scripts/ db/schema.sql
git commit -m "docs: comments describe the code, not the plan that produced it

~20 comments referenced numbered tasks from a planning document a new reader
will not have. Each now states what the code does.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Full live verification

**Goal:** Prove every feature still works in the real app and in the published bundle — not from memory, from the running site.

**Files:** none modified (fix-forward if something is broken)

**Acceptance Criteria:**
- [ ] `npm test` passes in full
- [ ] All six pages render correctly in the browser with a clean console
- [ ] Every listed interaction below works
- [ ] `npm run snapshot && npm run preview` serves a fully styled, working bundle
- [ ] Screenshots captured as evidence

**Verify:** the checklist below, executed against a running server

**Steps:**

- [ ] **Step 1: Full test suite**

```bash
npm test
```
Expected: all tests pass. Record the count.

- [ ] **Step 2: Seed and serve**

```bash
npm run migrate
```

Then start the dev server via the preview tooling (never a bare `node server.js` in the background) and open each page.

- [ ] **Step 3: Per-page interaction checklist**

| Page | Must work |
|---|---|
| Shell | wayfinder opens; quick-lookup search returns hits; clicking a hit loads the right volume in the iframe; breadcrumb updates |
| Cabinet | radar draws with both pins in original colours; hovering a drug adds a trace; legend matches; matrix dots agree with radar; explorer/matrix/primer switch |
| Archive | hall navigation; opening an entry; loupe/flashlight instruments; back to catalogue |
| Ledger | system filter; search; row expand/collapse; keyboard Enter on a row; facet rail links |
| Desk | accordion opens; edit a field and save; the value persists after reload; source combobox |
| Demo | walkthrough steps advance; colours consistent with the rest of the product |
| Cross-volume | trace a receptor from Archive → Cabinet → Ledger; each lands on the right subject |

- [ ] **Step 4: Console and network**

Check browser console for errors on each page (expect none) and confirm `assets/tokens.css`, `assets/base.css`, `assets/atlas.js` all return 200.

- [ ] **Step 5: Published bundle**

```bash
npm run snapshot
```

```bash
npm run preview
```

Open the preview URL. Confirm: the site is **styled** (proves the asset copy works), volumes render from bundled JSON, and the Desk is absent.

- [ ] **Step 6: Capture evidence and report**

Take screenshots of the Cabinet radar, the Ledger, and the published preview. Report results honestly — if anything failed, say so with the output rather than claiming success.

---

## Self-Review

**Spec coverage:** §1 tokens.css → Task 1; §2 base.css → Task 2; §3 atlas.js → Task 3; §4 class decoupling → Task 5; §5 Cabinet BEM + action colour → Task 6; §6 accessibility → Task 7; §7 publish pipeline → Task 1; §8 comments → Task 8; testing/live verification → Task 9. All eight spec stages covered.

**Naming consistency:** `ACTION_COLOR` (Task 6) is used consistently; `CLASS` constant introduced in Task 5 and reused in Task 6 Step 5; `verifyAssetRefs` defined in Task 1 Step 4 and imported in Task 1 Step 2; `createAtlasBridge`/`atlasTrace` defined in Task 3 Step 1 and called in Steps 3–5.

**Ordering:** Task 1 lands publish support before any page references an asset, so the bundle is never broken. Task 5 (class extraction) precedes Task 6 Step 5 (BEM rename), so the rename is a one-line change per name.
