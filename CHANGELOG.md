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

### Added

- **The hosted Desk: a second way to edit the atlas, and the normal one.** A single-file
  editor, published as a private claude.ai artifact, that needs no terminal, no port, and
  no machine of your own. It edits the same ground the old Desk did — the Archive prose
  per receptor with sources attached where they are used, the Cabinet claim line, the
  Ledger row, and the three review marks — but the writing surface is prose with sources
  in the margin, not a form. "Publish the atlas" turns whatever changed into
  `db/curator-state.json`, the same file the old Desk wrote, and commits and pushes it;
  nothing is ever cleared from the working set, only marked published, so the editor
  never goes stale between sessions. Not in it, on purpose: binding-affinity edits, which
  stay with `scripts/sourcing/`, and a separate citation-verified check or mastery mark,
  because attaching a source to a claim is treated as having read it. The same file also ships unlinked at
  `/desk/` on the public site and as `desk/desk.html` in a clone, so editing never
  depends on claude.ai being reachable.
- The Desk's **Publish button** (outside claude.ai: `/desk/` on the site, `desk/desk.html`
  from a clone) commits `db/curator-state.json` to `main` through GitHub's API with a
  fine-grained token kept in that browser, after the same stale-seed check as `desk:pull`
  and a confirm showing the commit subject; then marks the changes published and shows the
  receipt in the banner.
- At load, `/desk/` re-keys changes stored against an older snapshot onto the current one
  (published records fold in; unpublished carry over), refusing and saying why in the same
  cases as `desk:rekey`.
- **Import changes** merges a `changes.json` from another copy of the Desk.

### Changed

- The edits file the converter writes orders its maps the way the database export does,
  so a publish from the page and one from `desk:pull` are byte-identical.

### Fixed

- **Onset, time course, risk factors and monitoring now survive a rebuild.** The Desk
  could edit them since 1.2.0, but the columns existed only on one machine and the
  curator dump did not carry them, so a fresh clone or the published site would have
  silently dropped the edit. The columns are now added on open, idempotently, and the
  dump carries them. Nothing was lost: all four were still empty.

## [1.2.0] - 2026-09-26

The Cabinet learns to answer "compared to what?", and the Desk gains the Ledger columns
it could never reach. No displayed value moved: every number here was already in the
database, and what changed is which of them the pages show and which the curator can edit.

### Added

- **An anchor in the Catalogue.** Click any target's column header and that target becomes
  the reference the whole plate is read against. Click another to move it, click the same
  one again to release it. The anchored header is vermilion over a rule; agents never
  screened at the anchor stay dimmed for as long as it stands.
- **A selectivity line in every affinity tooltip.** With D2 anchored, hovering clozapine's
  H1 cell reads `Δ vs D2: +1.89 · 77× toward H1`. Where the anchor was screened and showed
  no meaningful binding the figure is given as a bound rather than a point value, and where
  the anchor was never screened at all the tooltip says so instead of computing anything.
- **An anchored readout under the affinity rose.** For each pinned agent it lists the
  targets that agent engages *harder* than the anchor, worst first, each with its fold
  difference and the clinical axis that target carries. Two pinned agents at an anchored D2
  is the typical/atypical contrast in six lines.
- **Row re-ranking at the anchor.** Anchoring re-sorts the matrix inside each drug class by
  affinity at that target, tightest first, with screened-but-not-binding agents below the
  binders and never-screened agents last. Class grouping never breaks. Clearing the anchor
  restores the shipped order exactly.
- **`#anchor=<target>` in the URL,** so an anchored plate survives a reload and can be
  linked to. Tracing a receptor into the Catalogue from another volume anchors the plate
  on it.
- **A clinical axis on every target** (`AFF_TARGETS[].axis`): the side-effect or effect
  domain a target carries, such as `sedation, weight gain` for H1 and `orthostasis, falls`
  for α1. The anchored readout uses it to name what an off-target number costs, rather
  than only how large it is.
- **The Cabinet plate now states its own evidence base.** Each specimen's binding list is
  headed by a census — how many agents were screened at this target, how many bind, how
  many actions are curated, and how many measurements sit behind them.
- **Spread, drawn, on every binder row.** A bar shows the lo-to-hi range the median was
  taken over on a fixed pKi 5 to 10.5 scale, so haloperidol's 62 measurements spanning five
  log units no longer look identical to a single unreplicated value.
- **An off-target column on every binder row.** What that molecule binds harder than the
  specimen on the plate, with the fold difference: at D2, perphenazine reads `4.0× D3` and
  haloperidol reads `none`.
- **The Conservator's Desk reaches the Ledger's syndromic columns.** Onset, time course,
  risk factors and monitoring existed in the table and were unreachable at every layer
  above it: the API did not return them, neither write whitelist accepted them, and the
  Desk drew no control for them. All four are now editable, along with the Stahl note,
  the agonist and antagonist lists, and the row's name, class and system key. The
  clinical section goes from four fields to fourteen, ordered the way the Ledger reads a
  case: what the receptor does at rest, how it fails, when that failure arrives, who it
  happens to, and what to watch.
- **The quiz prompt is editable.** It was queryable and carried on the Desk's record but
  had no write path at all, so it could be read by the code and by nobody else.
- **Binding rows expose the four fields the API already accepted:** the reported-as text,
  the action code, the action in full, and the source label. Only the Ki and a note were
  reachable before.
- **Concept tags now link to the concept.** Each tag under Pharmacologic Action was a
  button that opened the Primer at its top, so every one of the 31 led to the same place
  and none led to a definition. The 14 that name a concept the Primer defines now scroll
  to it and light it; the other 17 are drawn as labels, because a label that cannot be
  followed should not look like a control.

### Changed

- The affinity rose's pinned-agent legend drops its top-three-target tail while an anchor
  is set, because the anchored readout below states the same thing organised around the
  anchor. The how-to-read paragraph gives way to the readout for the same reason: a reader
  who has anchored a target has demonstrated they know how to read the plate.
- **The plate figure is drawn at plate size.** The case column was 1009px wide holding
  prose capped at 70ch, so roughly 273px sat as a void down the right of every plate
  while the engraving was a 170px thumbnail. The figure takes that width instead and is
  now 327px, and the prose measure is unchanged. It is sized against height as well as
  width, because a square figure's width is also its vertical cost.
- **The exhibit plate fills its column.** It hugged its content and stopped 183px above
  the foot of a viewport-fit column, and spent another 57px on a grid row that held
  nothing. Both are reclaimed by the binding register, which now lists 16 agents rather
  than 12.
- **The specimen rail is ruled to its foot.** Thirteen entries end 45% of the way down a
  full-height rail; the hairlines continue at the row pitch below them, so the remainder
  reads as a catalogue with room left in it rather than a list that was cut off. No
  invented entries, only the ruling.

### Changed

- **A brass dot no longer means two different things.** Affinity known with no curated
  action was drawn in the positive-modulator colour, so 317 of the plate's 729 dots looked
  exactly like its 24 real positive modulators, and the same collision ran through the
  rose and the Cabinet's binder list. Nothing displayed moved: no pKi, no action, no
  count. What changed is that "we know how tightly this binds but nobody has curated what
  it does" is no longer drawn as a claim that the drug potentiates the receptor. The hue
  stays brass, because uncurated is not one of the three directional actions; the fill is
  what tells them apart. A curated action is filled, an uncurated one is hollow: a ring in
  the matrix and the binder list, an outline rather than a solid petal in the rose, and
  hatch lines with no ground where the second pinned agent is hatched.
- **The Catalogue's key is a key now.** It was three rows of swatches right-aligned to
  each other, which gave it a ragged left edge, and the middle row was not a key at all
  but a sentence about size encoding that the rose caption already made. The swatches are
  grouped and named instead: **Action** for the four colours a drug can carry at a target,
  **Evidence** for the three marks that say what is known there. A brass dot and a green
  dot answer different questions and nothing used to say so. The size-encoding sentence
  moves into the plate's subtitle, where it is stated once.
- **The key is legible at a window that is not full screen.** It used to throw itself
  under the title as soon as the head ran out of room, standing the header up from 130px
  to 217px and taking that height out of the matrix; the three rows then read as a centred
  stack. It shrinks beside the title first now, and when it does wrap it starts the line
  and shares the title's left edge. Both group names now end on one rule and both sets
  of swatches begin on one edge, which two independent flex groups could not manage: the
  names are different lengths, so each group started its items wherever its own name
  happened to end. Legend text moves from `bone-faint` to `bone-dim`,
  5.3:1 to 7.5:1 against the header ground, with the group names left faint so the step
  between naming a group and reading one survives. Type size does not move: 11px is the
  atlas's one label step and its floor.

### Fixed

- **`npm test` no longer overwrites your curator dump.** The auto-publish suite ran a
  server against a throwaway database with the curator dump left on, and the dump always
  writes to the repository's own `db/curator-state.json`. Every test run therefore
  replaced the committed record of your review marks, sources and content edits with the
  fixture's three-line burst, and the next Publish would have pushed that. The suite now
  runs with the dump off and fails if anything touches the file. Your real work was never
  lost: `db/atlas.db` was untouched, and the dump has been re-exported from it.
- **The hole down the middle of every specimen plate.** Mechanism of Action sat at the top
  of the plate and Pharmacologic Action ~170px below it, with nothing in between, and the
  plate stood a screenful taller than the reading it carried. The engraving was a square
  sized off its column, so on a wide screen the case ran 395px tall while the two fields
  beside it needed 225px, and the surplus was being distributed *between* those fields as
  though it were considered separation. The engraving now takes its height from the reading
  column rather than setting it: on a 1440px screen the plate is 80px shorter, the fields
  are one gap apart, and the drawing is smaller for it, which is the trade. Plates that
  carry clinical material as well as prose are unaffected, because there the reading column
  was always the taller of the two.
- **An engraving that never drew itself.** The reveal was asked for inside a
  `requestAnimationFrame`, which does not run while a tab is not painting, so a plate first
  rendered in a background tab held every stroke at zero length and showed an empty case
  until something re-rendered it in the foreground. It is asked for directly now.
- **The affinity rose kept a gap for an agent that had gone.** Unpinning one of two
  pinned agents left every remaining petal drawn at half width, offset to one side, until
  some later redraw cleared it. The tween interpolates a frame that is a union of the
  outgoing and incoming selections, so the departed agent survived in it at zero and was
  still counted when each slot's arc was divided; the tween ended by assigning the real
  target frame without ever painting it. Covered by a regression test.
- **Catalogue numerals no longer wrap.** Five of the thirteen (`№ VIII`, `№ XIII` and
  their kin) overflowed a fixed 2.4rem column and broke onto a second line, standing those
  rows 8px taller than their neighbours and putting every specimen name on a different
  baseline. The column is measured from the widest numeral and shared by all rows.
- **The page no longer scrolls sideways on a phone.** The widest unbreakable element in
  the explorer was the segmented Antagonism / Physiologic Tone / Agonism control at 364px,
  which set the floor for the whole single-column grid and dragged 447px of layout into a
  375px screen. That control wraps at narrow widths, the binding list may fall below its
  24rem track, and the binder row sheds its two comparative columns, which need
  neighbouring rows in view to mean anything.

### Known gaps

- The anchor and the axis field are Cabinet-page literals. `AFF_TARGETS`, `AFF_GROUPS` and
  `PHARM_ACTIONS` are not stored in the database and not editable in the Desk; they are
  committed page literals, which is where this project keeps that class of content, but it
  does mean the axis phrasing can only be corrected by editing the page.
- Affinity ordering is not occupancy. The plate can say which target a molecule reaches
  first as concentration rises; it cannot say what fraction of a receptor is occupied at a
  given dose. The drawers for dissociation kinetics, occupancy-against-dose and PK remain
  empty because the atlas holds no such data.

## [1.1.0] - 2026-07-30

The Conservator's Desk rebuilt around the source connection, and the curator's work
made portable: it now travels with the repository and reaches the published site,
neither of which it did before.

MINOR rather than MAJOR because nothing here forces a database rebuild or moves a
published URL. An existing `db/atlas.db` keeps working untouched; `db/curator-state.json`
is written beside it and only read on a fresh seed.

### Added

- **A Publish button in the Desk.** Ending a session meant a terminal trip to commit and
  push, which is both a bad ending and the kind of step that quietly does not happen. It
  commits `db/curator-state.json`, pushes it, and reports what went out and where to watch
  the build. It writes its own commit message from the diff, so the history reads
  `curate: 2 specimens reviewed, 1 citation verified` without anyone typing a summary.

  It stages exactly one path. Code or docs edited in the same tree are listed so you know
  they are there, and left for you to commit yourself rather than swept into a message
  about receptors. Every git call passes an argument array rather than a shell string, and
  the route accepts no request body, so nothing from the page can reach a shell.

- **`db/curator-state.json`: the Desk's work now travels between machines.** The app was
  always in git; the work done in it was not, because it lives in `db/atlas.db`, which is
  untracked. That was worse than it sounds: the migrations re-seed content from the
  committed HTML page literals, so a fresh clone did not show an obviously empty desk. It
  showed a fully populated one carrying the *shipped* content, with every edit silently
  replaced by the original.

  The dump is a text file holding only the **difference** from a fresh seed: review
  checks, mastery, notes, timestamps, sources you added or corrected, every citation
  status, and content edited away from what the pages ship. A full dump would be a second
  copy of the atlas whose diffs said nothing; restricted to the delta, `git diff` reads as
  a sentence. Every source is referenced by natural key (PMID, then DOI, then URL, then
  the citation itself) because `sources.id` is an autoincrement rowid that means nothing
  on another machine.

  It maintains itself: the server rewrites it after each save, on the same trigger that
  refreshes `dist/` (`NO_CURATOR_DUMP=1` disables). `npm run migrate` applies it after
  seeding. If the target database already holds work that differs from the dump, the
  import **refuses** and prints how to resolve it in either direction rather than picking
  a winner. Nothing here merges two divergent sets of edits, so the standing rule is pull
  before you start and push when you stop.

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

### Removed

- **The Threshold entrance experiment.** Six draft pages (`the-threshold*.html`,
  `the-receptor-atlas-threshold.html`, and two `_affinity-*` form studies) and the design
  brief that went with them. The Threshold was a proposed replacement for the rotunda
  arrival; the rotunda stayed, so the drafts were describing a door that was never built.
  The pages were never committed. The brief was, so it remains in git history if the idea
  is ever revived.

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

[Unreleased]: https://github.com/Fresco-Esio/receptor-atlas/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Fresco-Esio/receptor-atlas/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Fresco-Esio/receptor-atlas/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Fresco-Esio/receptor-atlas/releases/tag/v1.0.0
