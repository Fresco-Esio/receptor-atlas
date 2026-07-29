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
| `npm test` | Run the suite (`node --test`). 148 tests. |
| `npm run migrate` | Build `db/atlas.db` from seed data. **Seed-only**: a no-op if the database already holds receptors. |
| `npm run snapshot` | Export the static, backend-free site into `dist/`. |
| `npm run preview` | Serve `dist/` to check the snapshot before publishing. |

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
