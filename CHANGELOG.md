# Changelog

All notable changes to the Receptor Atlas are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## How to keep this file

**Every change that a reader or a curator would notice gets a line here.** Internal
refactors that leave behaviour identical do not; a refactor that moves a number,
renames a control, or changes what the page claims does.

1. While working, add lines under `## [Unreleased]` as you go. Do not wait for release
   day and reconstruct from `git log` — the reason a change was made is the part that
   gets lost, and it is the part worth writing down.
2. Group under the standard headings: **Added**, **Changed**, **Deprecated**,
   **Removed**, **Fixed**, **Security**. Omit headings with nothing under them.
3. Write for the person using the atlas, not the person who wrote the commit. "Fluoxetine
   at SERT reads 8.45 rather than 8.24, because functional-assay rows no longer pool into
   a table headed binding affinity" beats "update sourcing filter".
4. When a value the atlas *displays* changes, say so explicitly and say why. Silent data
   movement is the one thing a reference work cannot do.
5. On release, rename `[Unreleased]` to the new version with today's date and open a
   fresh `[Unreleased]` block above it.

**Choosing the number.** MAJOR when the database must be rebuilt or a published URL
changes. MINOR for new capability. PATCH for corrections that leave the shape alone.
Data corrections that move displayed values are MINOR at least, never PATCH, because a
reader who wrote a number down needs to know it moved.

---

## [Unreleased]

### Changed

- **The Conservator's Desk is rebuilt around the source connection.** The old desk opened
  on five screens of protocol and filed sources in three places away from the content
  they support, so a curator could edit a claim without ever seeing whether a paper stood
  behind it. The source ledger is now the spine: it sits above the content it backs and
  stays there while you edit, and every binding carries its own citation on its own row.
  A queue beside a workspace beside the review card replaces the long scroll of
  expandable rows.
- **Unsourced is now vermilion.** The atlas spends its ceremonial accent on the one thing
  that matters in a view; in the Desk that is a claim with nothing behind it. It was
  previously the blue "todo" token, the quietest mark on screen, for the single condition
  the tool exists to eliminate.
- **The review checks report their own outstanding work** ("4 of 5 not verified yet",
  "12 of 55 have no source") instead of being a checklist you can tick having done none
  of it.
- **A specimen's 55 bindings are one scannable line each**, filterable by no-source,
  conflicting, or unchecked, with the Ki editor and provenance one click in. They were 55
  full cards and twelve thousand pixels.

### Fixed

- **A failed save could leave a ticked check over a database that disagreed.** Review
  state was mutated before the request resolved and the only warning vanished after two
  seconds, so a curator would have believed the work was recorded. Ticks, mastery and
  notes now roll back if the save fails.
- **Importing a review silently overwrote every specimen in the file.** It now names how
  many specimens and which ones, and lets you refuse.
- **Removing the last source left the citation check reporting on sources that were gone.**
- **Filtering to Unsourced and then attaching a source made the row vanish mid-task**,
  because you had just fixed the thing the filter selects for. The open specimen stays in
  the queue, marked cleared.
- Dialogs trap Tab and return focus to whatever opened them; the queue takes arrow keys;
  `j` jumps to the next specimen with nothing behind it; a skip link steps over the rail.
- The Desk joins the design-conformance sweep, and its type ramp collapses from ten
  invented sizes to three steps with every adjacent ratio above 1.3.

## [1.0.0] - 2026-07-29

The first version where every published page obeys the documented design system and
every number on the affinity plate can be traced to a stated rule. The atlas has been
publicly readable since 0.5.0; this is the release that makes it defensible.

### Added

- **Filter the agent matrix by name.** Finding one of 92 drugs no longer requires a
  scroll-and-scan. Group headings hide when nothing under them survives the filter, and
  filtering never disturbs which agents are pinned.
- **A pin affordance and an eviction notice.** Matrix rows now cue `pin` / `unpin` on
  hover and keyboard focus. Pinning a third agent names the one it dropped instead of
  shifting it off silently. Two remains the ceiling: the rose tells a pair apart by
  solid-versus-hatched fill, and there is no third fill that stays legible at petal size.
- **`scripts/preserve-activity.mjs`.** Saves and restores `section_activity` around a
  destructive rebuild. Everything else in the database re-seeds; those curator timestamps
  did not, and nothing else knows them.
- **Design-conformance tests across all five published pages**, plus a guard on the token
  layer. Previously one page was checked, which is how three separate rules drifted on
  three other pages without anything failing.

### Changed

- **Each view now fits the window; the page itself no longer scrolls** above 941px. The
  specimen rail and the exhibit plate scroll independently, so reading a long plate does
  not drag the receptor index out from under the cursor. Below 941px the columns stack
  and the document flows normally, because a pile of short scroll boxes on a phone reads
  worse than one honest page scroll.
- **A subtype is named only when it decisively beats the runner-up** by at least 0.3 log
  units (`MIN_SUBTYPE_MARGIN`). Below that the two are tied within between-laboratory
  noise and the cell reports the pooled median flagged low-confidence. 20 cells moved,
  all α1 and α2. Mirtazapine's α2 no longer claims Alpha2C on a 0.04 lead over Alpha2A;
  guanfacine's 1.23-log lead at Alpha2A survives, as it should.
- **Functional-assay rows are excluded from the K<sub>i</sub> spine.** PDSP writes the
  literal `Functional` into its hot-ligand column for those rows. 2,226 human rows in the
  export are functional; 14 of them fell inside this atlas's drug × target scope and were
  pooling into medians displayed under a heading that says binding affinity. 13 cells
  moved; **Fluoxetine at SERT reads 8.45 rather than 8.24**. The filter earns its place
  by what it guarantees, not by its volume.
- **Screened-and-inert now looks different from never-screened** without hovering. Four
  of five clinical reviewers could not tell a hollow ring from an empty cell. "We looked
  and found nothing" is evidence of selectivity; "nobody looked" is an absence of
  evidence, and the legend now names both cases.
- **One label type step across the site.** `--lbl-sm` was an undocumented second step at
  9.6px carrying real controls, and is retired to an alias of `--lbl` (11px). 35
  declarations across four pages that sat below the floor now sit on it.
- **The tooltip calls its spread an observed range**, not a confidence interval. `lo` and
  `hi` are the extremes of the measurements with no distributional model behind them.

### Fixed

- **The rose was drawing its tightest binder short.** The petal scale clamped at 9.75
  while re-sourcing had moved the catalogue's real maximum to 9.8, so asenapine at 5-HT2A
  rendered at exactly the ceiling: a tighter binding shown the same length as the ceiling,
  with nothing to say so. The ceiling is now checked by a test after every refresh.
- **The footer claimed geometric means of reported ranges.** The pipeline computes a
  median of pKi and always has. The methodology statement now says what the code does.
- **Five places still said the cabinet held thirteen targets.** It holds sixteen.
- **Three primer examples pointed at drugs the July re-scope removed** (fentanyl,
  dobutamine, flumazenil, amantadine), sending readers to look for rows that do not exist.
- **The affinity note now states that affinity is not occupancy**, where the numbers are
  read rather than 1,290 lines below in the footer. pKi describes binding in vitro at
  equilibrium, not how much receptor a drug occupies in a patient.
- **Two banned side-stripe accent borders** removed, on `.concept-eg` and `.stahl-note`.
- **25 em dashes in user-facing copy**, including seven `aria-label`s, replaced with the
  punctuation each sentence wanted.
- **28 decorative SVGs** were exposed to assistive technology with nothing to announce;
  they are now `aria-hidden`.
- **The walkthrough's footer ran 9.3px at 2.88:1**, under both the type floor and WCAG
  AA, on the one line telling the reader the tour is simulated.
- **The print stylesheet spent four near-blacks and three grays on three jobs.** The
  roles are named now and used exactly.

## [0.6.0] - 2026-07-26

### Changed

- Six pages moved onto one shared token layer (`public/assets/tokens.css`), with repeated
  spacing routed through a shared scale and one source of truth for what an action looks
  like in the Cabinet.
- The cross-volume bridge extracted as a factory; comments rewritten to describe the code
  rather than the plan that produced it.

### Fixed

- The Cabinet was reporting local ids to the shell, breaking cross-volume follow.
- Focus handling, accessible names, and table semantics for generated DOM.
- Three rendering regressions caught by actually loading the pages.

## [0.5.0] - 2026-07-21

### Added

- **Every affinity re-sourced from the NIMH PDSP K<sub>i</sub> Database** (human
  receptors, median of all human values) and presented as pKi. The sourcing pipeline
  lives in `scripts/sourcing/` so it travels with the repository.
- GitHub Pages deployment and `DEPLOY.md`; the atlas is publicly readable.

### Fixed

- Structured and archive migrations made seed-only, so Desk edits survive a restart.

## [0.4.0] - 2026-07-17

### Added

- Binding-affinity provenance: source edges and `value_status` keyed on the stable
  (agent, target) pair, a by-source bulk-verify panel, and a drug-first binding list with
  per-binding citations in the Desk.
- Sticky section tabs and a reordered Desk flow.

## [0.3.0] - 2026-07-08

### Added

- The three-volume shell: a rotunda arrival with a lights-up entrance, settling rings,
  and doorway nodes, wrapping the Archive, Cabinet, and Ledger as one reference.

## [0.2.0] - 2026-06-30

### Added

- Archive narrative editing end to end: `archive_entries`, entry-number aliases, the API,
  the Desk editor, and the Archive rendering from the database.
- Receptor citations modelled as a verifiable source list rather than a single slot.
- `npm run snapshot`: a static, backend-free export of the site, auto-refreshed after
  every Desk save.
- A standalone interactive walkthrough.

## [0.1.0] - 2026-06-29

### Added

- SQLite schema and connection module, with foreign-key enforcement and composite keys.
- Migration of the Desk's receptor data into `db/atlas.db`, idempotent and deduplicating
  sources by PMID.
- HTTP server with static file serving and explicit traversal containment.
- Read and write APIs: receptor list and detail, atlas volumes, sources library, citation
  links, review persistence, structured volume data, and the review-drift endpoint.
- The Conservator's Desk wired to the database, with edit mode and review stamps.
- `start.bat` launcher and the backend primer in `docs/`.

The 0.x entries were reconstructed from git history after the fact and are **not tagged**,
so they carry no compare links. Every release from 1.0.0 on is tagged as it ships.

[Unreleased]: https://github.com/Fresco-Esio/receptor-atlas/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Fresco-Esio/receptor-atlas/releases/tag/v1.0.0
