# The Receptor Atlas — app

A small local app: a Node + SQLite server that serves the Receptor Atlas and the
Conservator's Desk, with one database (`db/atlas.db`) as the single source of truth.

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
