# The Receptor Atlas — app

**Read the atlas online: <https://fresco-esio.github.io/receptor-atlas/>**

A small local app: a Node + SQLite server that serves the Receptor Atlas and the
Conservator's Desk, with one database (`db/atlas.db`) as the single source of truth.

The public site is a read-only snapshot of the three volumes, rebuilt automatically on
every push (see [`DEPLOY.md`](DEPLOY.md)). The Conservator's Desk — the review and
editing tool — is deliberately **not** published: it writes to the database, so it only
runs locally, and your review marks never leave your machine.

Binding affinities come from a single source, the NIMH PDSP Kᵢ Database (human receptors,
median of all human values), shown as **pKi**; agonist/antagonist direction is curated
separately by IUPHAR/BPS. See [`scripts/sourcing/README.md`](scripts/sourcing/README.md)
for the rules and how to refresh them.

## The three volumes

| Volume | Page | What it answers |
|---|---|---|
| I · Archive | `receptor-function.html` | What a receptor does |
| II · Cabinet | `neuroreceptor_pharmacology_explorer_dashboard.html` | What binds it |
| III · Ledger | `neuroreceptor_clinical_table.html` | How it presents |

`the-receptor-atlas.html` is the shell that wraps all three and is published as
`index.html`. The Cabinet's Binding Affinity Plate currently holds **92 agents across 16
targets**, 729 measured cells.

## Run it

**Double-click `start.bat`.** The first time, it installs dependencies and builds
the database; after that it just starts. It opens
`http://localhost:3000/the-conservators-desk.html` in your browser.

To stop it, close the black terminal window (or press `Ctrl+C` in it).

## The hosted Desk

There is a second way to edit the atlas that needs no terminal, no port, and no machine of
your own: the hosted Desk, a private claude.ai artifact. That is the normal place to edit.
The same single file is also reachable without claude.ai — at `/desk/` on the public site,
and as `desk/desk.html` in a clone. That fallback keeps your edits in the browser's own
storage instead of the artifact's store, and offers Download changes in place of "publish
the atlas" (see "Publishing from the fallback" below).

**Edit here:** <https://claude.ai/artifact/PkCQ5RJx4KXxppbTwXqaRg> (private to the owner).

| Script | What it does |
|---|---|
| `npm run desk:seed` | Builds `desk/seed.json` from the database, the way the Actions runner builds it: what the atlas currently is, for the editable surface. |
| `npm run desk:build` | Writes `desk/desk.html`: the editor template with `desk-core.mjs` and `seed.json` inlined into one file; also writes `desk/desk.artifact.html`, the same page without the doctype/html/head/body wrapper, for publishing as a claude.ai artifact. |
| `npm run desk:pull [--check] <changes.json>` | Turns a `changes.json` (what the page's store holds) into `db/curator-state.json`. `--check` reports what would change without writing it, and refuses unless the repo's edits file is the snapshot's, or what this Desk already published. |

**Publishing** is "publish the atlas", asked of any Claude session: it reads the changes
out of the page's store, runs `desk:pull`, commits, and pushes. A publish marks those
changes published in the store; it never clears them; the editor always shows the seed
plus every change, published or not, so an old snapshot never looks stale.

**Re-seeding** — "re-seed the desk" — runs `desk:seed`, `desk:build`, republishes the
artifact, and re-keys whatever changes are still unpublished onto the new seed. It is the
only action that moves the artifact's own version, and it is done only on request, never
automatically.

### How "publish the atlas" runs

1. Read the store: `ArtifactData list` on collection `changes` of that artifact with
   `out_dir` set, which writes one JSON file per receptor.
2. Build the array: concatenate the documents into `changes.json`, skipping any document
   whose `receptorId` is not in `desk/seed.json` (the page hides those too).
3. `npm run desk:pull -- --check changes.json` — it prints the one-line summary or
   refuses with "seed moved".
4. Show the summary to the owner and wait for "go".
5. `npm run desk:pull -- changes.json`, then `git add db/curator-state.json && git commit
   && git push` (Actions rebuilds the site).
6. Mark the published records: read each document again (the owner may have kept typing
   since step 1), apply `markPublishedFrom(current, pulled, sha)` from `desk/desk-core.mjs`
   — `pulled` is that document as it went into `changes.json` — which sets `publishedAs`
   to the commit sha only on records unchanged since the pull, and write the documents
   back with `ArtifactData set`, pinned with `if_version`. Nothing is deleted.

### Publishing from the fallback

1. **Download changes** (the first button in the fallback) saves `changes.json`: the raw
   changes this browser holds, not an edits file.
2. `npm run desk:pull -- --check changes.json` — the same check as step 3 above.
3. `npm run desk:pull -- changes.json`, then commit `db/curator-state.json` and push.

*Download edits file (full replacement)* builds a whole `db/curator-state.json` on the
page's own snapshot. Use it only when the repo's edits file is the snapshot's: after any
publish from the hosted Desk it would overwrite that publish, which `desk:pull` never does.

The `/desk/` copy on the public site is rebuilt on every push (`desk:seed` and
`desk:build` run in the Actions workflow before the snapshot), so it always starts from
the repo's current edits file.

`re-seed the desk` = `npm run desk:seed && npm run desk:build`, republish
`desk/desk.artifact.html` to the same artifact URL, then `rekey` every stored document to
the new seed commit and write it back.

**One editor at a time.** The old, local Desk (`the-conservators-desk.html`) still runs
and still works, as a fallback of its own. It is not a second editor: do not edit at the
old Desk and the hosted Desk between publishes.

**One curator, for now.** Attaching a source to a claim counts as having read it, so the
hosted Desk carries no separate "citation verified" check: every attached source exports
verified, and a seeded source keeps its seeded status unless you explicitly mark it as
conflicting with the text (or clear that mark). A source *you* attach exports verified
from the start. If a second author ever edits alongside you, reinstate the read-before-
verified gate first — the change record already carries a timestamp per edit, so
attribution is the only piece missing.

## Move it / back it up

- The whole `atlas-app` folder is self-contained — copy or move it anywhere
  (keep it **outside OneDrive** while running). After moving to a new machine,
  delete `node_modules` and run `start.bat` (it reinstalls automatically).
- **Back up** by copying `db/atlas.db` — that one file is all your data. You can
  also use the desk's Export button for a JSON backup.

## Develop

| Command | What it does |
|---|---|
| `npm start` | Run the server on port 3000 (same as `start.bat`, without the browser/auto-setup). Override with `PORT`. |
| `npm test` | Run the suite (`node --test`). 176 tests. |
| `npm run migrate` | Build `db/atlas.db` from seed data, then lay your saved work back over it. **Seed-only**: the seed is a no-op if the database already holds receptors. |
| `npm run snapshot` | Export the static, backend-free site into `dist/`. |
| `npm run preview` | Serve `dist/` to check the snapshot before publishing. |
| `npm run curator:export` | Write `db/curator-state.json` from the database. Normally automatic. |
| `npm run curator:import` | Lay `db/curator-state.json` back over the database. |

### Working on more than one machine

The app and all its content are in git; **your work in the Desk is not**, because it
lives in `db/atlas.db`, which is not tracked. That matters more than it sounds: the
migrations re-seed content from the committed HTML page literals, so a fresh clone does
not give you an obviously empty desk. It gives you a fully populated one showing the
*shipped* content, with your edits silently replaced.

`db/curator-state.json` closes that gap. It is a text dump of everything in the database
that did not come from the files in this repository: review checks, mastery and notes,
the timestamps, any source you added or corrected, every citation status, and any content
you edited away from what the pages ship. It holds only the difference from a fresh seed,
so `git diff` reads as a sentence: *this source was attached, this claim changed, this
pair was marked verified.*

You do not have to maintain it. The server rewrites it after every save, on the same
trigger that refreshes `dist/` (`NO_CURATOR_DUMP=1` turns that off).

**Ending a session: press Publish in the Desk.** It commits the dump, pushes it, and tells
you what went out. That single action does both jobs, because pushing is also what
triggers the site rebuild. It writes its own commit message from the diff, and stages only
`db/curator-state.json` — anything else you have edited is listed and left for you.

Starting on the other machine, `git pull` then `npm run migrate`, which applies the dump
after seeding. If the database there already holds work that differs from the dump, the
import **refuses** and tells you how to resolve it in either direction, rather than picking
a winner for you.

The one rule: **do not edit on two machines without syncing in between.** Nothing here
merges two divergent sets of edits. Pull first, push when you stop.

### Rebuilding the database

Migrations are seed-only, so `npm run migrate` will not overwrite a populated database.
To load new numbers you have to delete it, and deleting it destroys `section_activity` —
the record of when a curator last edited or reviewed each section. Nothing else
regenerates those timestamps, so bracket the rebuild:

```bash
node scripts/preserve-activity.mjs save
rm -f db/atlas.db db/atlas.db-wal db/atlas.db-shm
npm run migrate
node scripts/preserve-activity.mjs restore
```

**Stop the server first.** A running server holds `db/atlas.db` open and the delete fails
with "Device or resource busy".

### Re-sourcing the affinities

The pipeline in `scripts/sourcing/` fetches, filters, and splices the numbers into the
Cabinet. It is the only thing that should ever write `AFF_AGENTS`. Read
[`scripts/sourcing/README.md`](scripts/sourcing/README.md) before running it: the
filtering rules are what make the columns comparable, and changing one moves published
values.

After a re-source, check that `PETAL_MAX` in the Cabinet still covers the new maximum.
`npm test` fails if it does not, because the rose clamps silently and would otherwise
draw the tightest binder short.

## Documentation

| File | What it holds |
|---|---|
| [`CHANGELOG.md`](CHANGELOG.md) | Version history, and the convention for keeping it |
| [`DESIGN.md`](DESIGN.md) | The design system: colors, type, components, and the named rules |
| [`PRODUCT.md`](PRODUCT.md) | Who it is for, the voice, and what it must never look like |
| [`DEPLOY.md`](DEPLOY.md) | Publishing to GitHub Pages |
| [`docs/BACKEND-PRIMER.md`](docs/BACKEND-PRIMER.md) | Plain-English explainer of Node, SQLite, and `better-sqlite3`, for someone new to backends |
| [`scripts/sourcing/README.md`](scripts/sourcing/README.md) | Where every affinity number comes from and the rules that filter it |
| `docs/` | Dated design and implementation records, kept as history rather than current reference |

Three rules in `DESIGN.md` are enforced by `test/design-conformance.test.js` across every
published page: one label type step (0.6875rem), no side-stripe accent borders, and no em
dashes in copy. They are tested because each had already drifted on a page nobody was
checking.
