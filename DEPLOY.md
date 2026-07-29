# Putting the atlas online

> **Live now:** <https://fresco-esio.github.io/receptor-atlas/>
> Repo: <https://github.com/Fresco-Esio/receptor-atlas> (public — GitHub Pages requires it
> unless you have a paid plan). It republishes itself on every push to `main`.

The public atlas can be published to GitHub Pages. The Conservator's Desk cannot, and
that is intentional — the Desk *saves* things (review marks, citations, notes), which
needs the server and database behind it. A static host can only serve files.

So: **the atlas goes online, the Desk stays on your machine.**

Everything below is already prepared. What's left needs your GitHub login, which is why
it isn't done yet.

## Before you start: two decisions

**1. Public or private?**
GitHub Pages on a *private* repo requires a paid plan (Pro or Team). On a free account
the repo must be **public**, and public means the whole *repository* is visible, not just
the four pages the snapshot publishes: `docs/`, the design records, the sourcing pipeline,
and any unfinished pages sitting in `public/`. The stray `drug_mapping.txt` this file used
to warn about is gone. Anything you would not want read should leave `public/` or be
ignored before the repo goes public.

Note the distinction: **`npm run snapshot` publishes a fixed list** (the shell as
`index.html`, the three volumes, and the standalone walkthrough — see `VOLUME_PAGES` and
`STANDALONE_PAGES` in `scripts/publish.js`). Draft pages in `public/` are *not* published
to the site, but they are still visible in a public repo.

**2. Are you comfortable republishing the data?**
The affinity numbers come from the NIMH PDSP Kᵢ Database and the action labels from
IUPHAR/BPS. The atlas already credits both on the page, which is the right instinct, but
publishing a derived dataset publicly can carry conditions. Worth two minutes on each
database's terms before you make it public.

## How it was set up (already done — kept for reference)

```bash
gh auth login
gh repo create receptor-atlas --public --source=. --remote=origin --push
gh api -X POST repos/Fresco-Esio/receptor-atlas/pages -f build_type=workflow
```

The last line is the API equivalent of **Settings → Pages → Source: "GitHub Actions"**.
From then on the workflow at `.github/workflows/pages.yml` does everything.

You only need these again if you move the project to a different account or repo.

## What happens on every push

1. Installs dependencies
2. Rebuilds the database from the committed seed data
3. Freezes the atlas into a standalone site (`npm run snapshot`)
4. Publishes it

Your site lands at `https://fresco-esio.github.io/receptor-atlas/`.

Note the database is **rebuilt on the runner**, not uploaded. `db/atlas.db` is
deliberately not in the repo, so the published atlas always reflects what's committed —
and your personal review marks in the Desk never leave your machine.

## Checking it before you push

```bash
npm run snapshot     # builds dist/
npm run preview      # serves dist/ locally so you can click through it
```

What you see there is exactly what gets published.

## Updating the published atlas later

Push to `main` and it republishes itself. If you change the affinity numbers, remember
the extra step (see `scripts/sourcing/README.md`):

```bash
node scripts/sourcing/3-build.mjs --write
rm db/atlas.db db/atlas.db-wal db/atlas.db-shm && npm run migrate
git commit -am "refresh affinities" && git push
```

The database rebuild is only needed locally, to see the change before you commit — the
runner does its own.
