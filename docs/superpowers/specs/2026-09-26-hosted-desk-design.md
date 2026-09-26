# The Hosted Desk: editing the Atlas without a server

**Status:** design, approved in conversation 2026-09-26; awaiting owner review of this file.
**Companion:** the pictures for every section are on the private page "Where the Atlas
Lives" (claude.ai artifact MyMrUn1MdM4D2rn7YdUx11). This file is the authority; the page
is the explanation.

## Why

The Conservator's Desk works, but only on the machine that runs it. The owner named four
things that fail in practice: starting it is friction (a terminal, a port, Node on every
machine); it is tied to one machine and the pull/migrate/push rule between two; the data
sits under a sync client with a "never edit on two machines" rule that nothing enforces;
and the editing itself is forms per volume rather than writing prose with the sources
attached where they are used, which is how the owner's Provenance app works.

The Node server, SQLite and the old Desk are only a way to produce one file:
`db/curator-state.json`, the delta the GitHub Actions build imports on every push. That
file, with the committed seed, is the source of truth. Everything below is a different
way to produce the same file.

## What stays exactly as it is

- The seed (page literals), `scripts/migrate.js`, `scripts/curator-state.mjs` (import
  side), `scripts/publish.js`, the Actions workflow, the public site.
- `db/curator-state.json` as the edits file and its `format: 1` shape. The hosted Desk
  emits it; it does not redefine it.
- The old Desk (`public/the-conservators-desk.html`, `server.js`) remains and still runs.
  It becomes a fallback, not a second editor: the one rule that survives is *do not edit
  in two places between publishes*.
- The Cabinet's affinity numbers stay script-driven (`scripts/sourcing/`). The hosted Desk
  does not edit bindings.

## Scope

In scope: the Archive prose per receptor (abstract, presentation, effect, receptor_class,
ligand, figure_caption, body paragraphs, tags) and the Cabinet claim line; the attached
sources per receptor and the shared source library; the Ledger row (the ten columns the
dump carries today plus onset, time_course, risk_factors, monitoring); the review marks
mechanism / affinity / clinical and the curator note.

Out of scope, recorded so they are not rediscovered: rendering sentence-level provenance
on the public Archive; rendering the four syndromic Ledger columns on the public Ledger;
binding edits; the `citation` and `mastery` review marks (kept in the file format at their
seed values, hidden in the UI); per-author attribution.

## Section 1 · the data, and how edits move

Three artefacts, two scripts, one converter.

**`desk/seed.json`** is produced by `npm run desk:seed` from a database built the way the
Actions runner builds it (`migrate` then `curator-state import`). It is what the Atlas
currently is, for the editable surface only:

```
{ format: 1,
  builtAt: ISO, commit: sha, baseState: <the curator-state.json it was built from>,
  receptors: [ { id, name, alias, volumes,
                 archive: { abstract, presentation, effect, receptor_class, ligand,
                            figure_caption, body: [..], tags: [..] },
                 claim: text,
                 clinical: { no, sys, name, cls, baseline, mech, over: [..], under: [..],
                             stahl, agonists: [..], antagonists: [..],
                             onset, time_course, risk_factors: [..], monitoring: [..] } | null,
                 sources: [ { key, is_primary, status, correction_note } ],
                 review: { mechanism, affinity, clinical, note } } ],
  sources: { key: { kind, authors, year, title, journal, pmid, doi, url, notes } } }
```

`baseState` is carried whole so the page can emit a complete edits file without the repo.

**`changes`** is the page's own store: what changed since `seed.json`, keyed by field, one
record per receptor.

```
changes/<receptorId> = {
  seedCommit: sha,                       // which seed these are relative to
  fields: { "archive.abstract": { value, at, publishedAs: sha|null }, ... },
  sources: { add: [ { key, is_primary, conflicting, correction_note, at, publishedAs } ],
             remove: [ { key, at, publishedAs } ], set: { key: { is_primary, conflicting,
             correction_note, at, publishedAs } } },
  library: { key: { kind, authors, year, title, journal, pmid, doi, url } },  // new sources
  spans: [ { field: "archive.body.1", start, end, text, sourceKey, at } ],
  review: { mechanism, affinity, clinical, note, at, publishedAs } }
```

Field-keyed, not keystroke-keyed: the second edit to a field replaces the first. The git
history of the edits file is the version history, one commit per publish. `spans` are
never exported; they are kept in a shape a later project can render.

**The converter** (`desk/desk-core.mjs`, `toCuratorState(seed, changes)`) merges every
change in the store, published or not, onto `seed.baseState` and returns a `format: 1`
edits file. Every attached source exports with `status: "verified"`; a source flagged
`conflicting` exports `status: "conflicting"` with its `correction_note`. It runs in Node
(`npm run desk:pull`) and in the page (Download), from the same module, so the two outputs
are the same edits; `desk:pull` canonicalises through a fresh database and is byte-identical
to the old Desk's `writeState`, while the page's Download is a valid import that may order
rows differently.

**`desk/desk.html`** is produced by `npm run desk:build`: the editor template with
`desk-core.mjs` and `seed.json` inlined. One file. It is committed (so the fallback in
section 4 exists) and it is what gets published as the artifact.

## Section 2 · the screen

One receptor per screen. Provenance's writing view with the Atlas's fields in it: black
on white regardless of device theme, one wide editor column set off-centre, sources in
the white space beside the text. None of the public site's museum styling.

- **Top bar:** receptor picker (23; each with a dot: unchanged / changed / reviewed),
  freshness line (`seed 26 Sep · 12 published since · 4 unpublished`), store indicator
  (`store: claude.ai` or `store: this browser`), Download edits file.
- **Editor:** abstract, body paragraphs, tags, claim, as one editable column. Selecting
  text and attaching a source draws a bracketed span in that source's colour (Provenance's
  `⌜ ⌝` marks and per-source hue). Spans with no source are dashed.
- **Margin:** one card per attached source, joined to its spans by flow lines; the card
  opens when a bracket is selected. Card contents: label and citation, PMID/DOI, attached
  date, *primary* toggle, *conflicts with the text* checkbox with correction note, span
  count. Adding a source: PMID or DOI through the viewer's PubMed connector when present;
  by hand otherwise (title, authors, year, journal, identifiers).
- **Ledger:** the row as a compact form below the prose. Scalars are inputs; the list
  fields (over, under, agonists, antagonists, risk_factors, monitoring) are one item per
  line and round-trip to JSON arrays.
- **Review:** three marks (mechanism, affinity, clinical) and the note.

The rule that connected the two designs, and the decision taken on it: Provenance offers
a verdict only after full text is read and the record is checked. The owner, as sole
curator, decided that attaching a source means it has been read. So the reading checks,
`citations verified` and `mastery` are removed, and every attached source exports as
verified. **If a second author ever edits, reinstate the gate first** (the store shape
already carries a timestamp per change; attribution is one more field).

## Section 3 · publishing, and what protects the edits

"Publish the atlas", in any Claude session, is six steps, and the order is the safety:

1. The owner asks.
2. Claude reads `changes/*` from the page's store and runs the converter.
3. Claude shows one line, the only pause: `3 content edits, 1 source attached, 1 conflict
   noted. Go?` (reuse `summarise()` in `lib/git-publish.js`).
4. `npm run desk:pull --check` then commit and push. The check refuses if the repo's
   `db/curator-state.json` differs from `seed.baseState` (the edits file moved by another
   route since the snapshot): the difference is shown, nothing is overwritten.
5. Actions rebuilds the site.
6. Claude marks those changes `publishedAs: sha` in the store and the page shows the
   receipt. **Nothing is cleared.** The editor is always seed + every change, published or
   not, which is why an old snapshot never shows stale text.

**Re-seed on request only.** `re-seed the desk` runs `desk:seed`, `desk:build`, republishes
the page (this is the only action that moves the artifact's version), and clears the
store's published changes; unpublished changes are re-keyed to the new seed. Worth doing
before a long session or when the published-since count is large; never required.

**Fallback publish:** Download edits file → replace `db/curator-state.json` → commit. Same
bytes as step 2.

## Section 4 · the fallback, and how it is tested

One file, two modes, decided once at load by whether `claude.use('db')` answers.

| | with claude.ai | without (Pages, or disk) |
|---|---|---|
| editor, spans, cards, Ledger form, review | same | same |
| where changes are kept | `db` store | browser storage |
| adding a source | PMID/DOI via the PubMed connector | typed in |
| edits into the repo | "publish the atlas" | Download, commit |
| converter output | byte-identical | byte-identical |

The page is served, unlinked, at `/desk/` on GitHub Pages: reachable without claude.ai,
writes nothing anywhere in that mode. The artifact declares `db` and `mcp` (PubMed:
`get_article_metadata`, `search_articles`) and `downloads`; declaring `mcp` makes the
artifact organisation-internal, which is fine for a private editor.

Tests (all `node --test`, in the existing suite):

- **Round trip:** seed → changes → converter → import into a fresh database →
  `writeState` again equals the converter's output. This is what makes byte-identical a
  fact.
- **Seed equality:** `seed.json` built from the database matches what the API serves for
  each receptor (the pattern of `test/publish.test.js`).
- **Converter cases:** field edit, list edit, source add/remove/primary/conflicting,
  review marks, unpublished + published mixed, a change whose seedCommit is stale.
- **Dump completeness:** `CLINICAL_COLS` in `scripts/curator-state.mjs` carries onset,
  time_course, risk_factors_json, monitoring_json; a test edits each and round-trips it.
- **Walkthrough (Playwright, not in `node --test`):** in both modes, edit an abstract,
  attach a source, set a review mark, download; compare bytes to the converter.
- **Design conformance:** the page is exempt from `test/design-conformance.test.js`
  (it is not a published page and deliberately uses Provenance's system, not the Atlas's).

## Prerequisites found during design

1. `scripts/curator-state.mjs` `CLINICAL_COLS` lacks the four syndromic columns the Desk
   has been able to edit since 1.2.0. Fix and test before anything else; no data has been
   lost yet (all four are null in the current database).
2. `desk:seed` needs a database built the Actions way; the script builds one in a temp
   path, never touching `db/atlas.db`.

## Files

```
desk/desk.template.html      editor (markup, styles, DOM layer)
desk/desk-core.mjs           state, change tracking, span model, converter; no DOM
desk/seed.json               generated; committed so the fallback works from a clone
desk/desk.html               generated; committed; published as artifact and at /desk/
scripts/desk-seed.mjs        npm run desk:seed
scripts/desk-build.mjs       npm run desk:build
scripts/desk-pull.mjs        npm run desk:pull [--check] [changes.json]
test/desk-core.test.js       converter and store tests
test/desk-seed.test.js       seed equality, dump completeness
```

`scripts/desk-pull.mjs` reads a `changes.json` written by the Claude session from the
store (or produced by the page's Download of raw changes, for the fallback), so the script
has no dependency on claude.ai either.
