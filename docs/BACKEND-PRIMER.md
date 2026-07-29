# Backend Primer — for future maintenance

Written for someone who hasn't done backend work before. Keep this file with the
app; it explains what every moving part is and how to look after it.

---

## 1. The one big idea: a file vs. a server

Until now, your atlas pages were **files you double-click**. The browser opens the
file directly off the disk. That works great for showing things, but a plain file
**can't read or write a database** — it has no way to ask "give me the latest
sources" or to save "I reviewed M1 today."

A **server** fixes that. A server is just **a program that stays running and
answers questions over a local web address** (`http://localhost:3000`). Your
browser asks it for things; it answers. "Backend" is the umbrella word for this
running program + its database. "Frontend" is the HTML/CSS/JS the browser shows.

```
 Before:  Browser ── opens ──> file.html          (no database possible)

 After:   Browser ── asks ──> server (running) ── reads/writes ──> atlas.db
                  <── answers ──┘
```

`localhost` means "this same computer." Nothing is on the public internet; the
server only talks to your own browser.

---

## 2. The three pieces

### Node.js — *the engine that runs the server*
JavaScript normally runs **inside a browser**. **Node.js** is a program that runs
JavaScript **outside** the browser — on your computer directly. That's what lets a
`.js` file act as a long-running server instead of a web page script. You already
have it (v24). The command `node server.js` means "Node, run this file."

Think of Node as the *electricity*. `server.js` is the *appliance* you plug in.

### SQLite — *the database, as a single file*
A **database** is an organized store of data you can query precisely ("every source
with this PMID"). Most databases are themselves big server programs you have to
install and run separately. **SQLite is different: the entire database is one
ordinary file** (`atlas.db`). No separate program. To back it up, you copy the
file. To move it, you move the file. This is why it's perfect for a personal,
portable tool.

The data lives in **tables** — like spreadsheets with named columns. We have a
`sources` table, a `receptors` table, and so on (see the design doc). You ask
questions with **SQL**, a query language, e.g.:

```sql
SELECT authors, year, pmid FROM sources WHERE pmid = '24903776';
```

### better-sqlite3 — *the adapter between Node and the SQLite file*
Node can't speak to a `.db` file on its own. **`better-sqlite3`** is a small
add-on (a "package") that teaches Node how to open `atlas.db` and run SQL against
it. In `server.js` it looks like this:

```js
import Database from 'better-sqlite3';
const db = new Database('db/atlas.db');           // open the file

// read:
const rows = db.prepare('SELECT * FROM sources').all();

// write:
db.prepare('INSERT INTO sources (authors, year) VALUES (?, ?)')
  .run('Kruse et al.', 2014);
```

`prepare(...)` sets up a query; `.all()` returns many rows, `.get()` one row,
`.run()` performs a write. The `?` placeholders are filled by the values you pass —
this is also a safety feature (it stops malformed input from breaking the query).

> Why this and not Node's built-in SQLite? Node has one now, but it still prints an
> "experimental" warning and could change. `better-sqlite3` is stable and is the
> single outside package this project depends on.

---

## 3. How a request flows (the whole loop in one example)

You open the Conservator's Desk and it shows M1's citation:

1. The desk page runs `fetch('/api/receptors/m1')` — "server, give me M1."
2. `server.js` receives that request, matches the route `/api/receptors/:id`.
3. It runs an SQL query through `better-sqlite3` to read M1 + its source from
   `atlas.db`.
4. It sends the result back as **JSON** (a plain text data format).
5. The desk's JavaScript receives the JSON and draws the citation on screen.

Saving works the same way in reverse: you click a checkbox, the page sends a
`PATCH /api/receptors/m1/review`, the server runs an `UPDATE` on the database.

---

## 4. Running, stopping, moving, backing up

| Task | How |
|---|---|
| **Start it** | Double-click `start.bat` (it installs dependencies the first time, then starts the server) and open the address it prints, e.g. `http://localhost:3000`. |
| **Stop it** | Close the black terminal window, or press `Ctrl+C` in it. |
| **Back up** | Copy `db/atlas.db` somewhere safe. That single file *is* all your data. |
| **Move off OneDrive** | Stop the server, cut-and-paste the whole `atlas-app/` folder to e.g. `C:\dev\`, double-click `start.bat` there. |
| **Move to a new computer** | Copy the folder, delete `node_modules`, run `start.bat` (it reinstalls `better-sqlite3` for that machine). |
| **Rebuild the database** | See the warning immediately below. Not just `npm run migrate`. |

### The one trap: rebuilding is destructive

`npm run migrate` is **seed-only**. If `atlas.db` already holds receptors it does
nothing, on purpose, so a re-run can never overwrite your review marks. The flip side
is that loading new data means *deleting the file first*, and the delete takes one
thing with it that nothing regenerates: `section_activity`, the record of when each
section was last edited and reviewed. Everything else re-seeds from `scripts/seed-data.js`
and the page literals; those timestamps exist nowhere else.

So bracket every rebuild:

```bash
node scripts/preserve-activity.mjs save
rm -f db/atlas.db db/atlas.db-wal db/atlas.db-shm
npm run migrate
node scripts/preserve-activity.mjs restore
```

**Stop the server first**, or the delete fails with "Device or resource busy" — a
running server holds the file open.

---

## 5. The dependency folder (`node_modules`) and `package.json`

- `package.json` is a short text file listing what the app needs (here: just
  `better-sqlite3`). Think of it as the recipe's ingredient list.
- `node_modules` is the folder where `npm install` downloads those ingredients.
  It's large, auto-generated, and **disposable** — if it's ever missing or broken,
  delete it and run `npm install` (or `start.bat`) to recreate it.
- `npm` is the tool that reads `package.json` and fills `node_modules`. It came
  with Node.

---

## 6. Common problems & fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `start.bat` flashes and closes | An error happened | Open a terminal in the folder, run `node server.js`, read the message |
| "port already in use" | A server is already running | Close the old terminal window, or change the port in `server.js` |
| "Cannot find module better-sqlite3" | `node_modules` missing/broken | Delete `node_modules`, run `npm install` |
| Error mentioning a native build after moving machines | `better-sqlite3` was built for the old machine | Delete `node_modules`, run `npm install` to rebuild |
| Data looks stale / wrong | Editing the DB by hand, or two copies of the folder | Confirm which `atlas.db` is live; restore from a backup copy |

---

## 7. What's safe to touch vs. leave alone

- **Safe to edit:** the HTML files in `public/` (design/content), and `schema.sql`
  if you understand the change. Data is best changed *through the desk UI*.
- **Edit carefully:** `server.js` (the logic) — make a copy first.
- **Don't hand-edit:** `atlas.db` (use the app), and never edit inside
  `node_modules` (it's regenerated).

When in doubt, **back up `db/atlas.db` first** — then anything is recoverable.
