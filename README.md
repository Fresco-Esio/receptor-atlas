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

## Learn how it works (for maintenance)

See [`docs/BACKEND-PRIMER.md`](docs/BACKEND-PRIMER.md) — a plain-English explainer
of Node, SQLite, and `better-sqlite3` written for someone new to backends. The
design and implementation plan live in `docs/` alongside it.

## Develop

- `npm start` — run the server (same as start.bat, without the browser/auto-setup).
- `npm test` — run the test suite (`node --test`).
- `npm run migrate` — build `db/atlas.db` from seed data (no-op if it already has data;
  delete the file first to rebuild).
